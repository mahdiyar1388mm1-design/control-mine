-- CENTRAL MINE — Migration 008: Database depth, integrity and query performance
--
-- Goals
--  1) Schema objects that previously lived only in application code become enforced
--     invariants in the database itself (order totals, non-negative money/stock,
--     balance/allocation consistency).
--  2) Relations get real columns (order → address, stock reservations, token bookkeeping)
--     instead of JSON string matching.
--  3) Every hot query path gets a covering index (audit, orders, payments, tickets,
--     services, notifications, stock movements, idempotency).
--  4) Protocol/production settings are persisted so runtime policy is auditable.

-- ---------------------------------------------------------------------------
-- 1) Orders: real foreign key to the address used at purchase time
-- ---------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN address_id TEXT REFERENCES user_addresses(id);
UPDATE orders
   SET address_id = (
     SELECT a.id FROM user_addresses a
      WHERE a.user_id = orders.user_id
        AND instr(orders.address_snapshot, a.id) > 0
      LIMIT 1
   )
 WHERE address_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_address ON orders(address_id);

-- Money/quantity invariants that were previously only application-level.
CREATE TRIGGER trg_orders_money_insert
BEFORE INSERT ON orders
WHEN NEW.subtotal_toman < 0 OR NEW.shipping_toman < 0 OR NEW.discount_toman < 0
  OR NEW.total_toman < 0
BEGIN
  SELECT RAISE(ABORT, 'order money values cannot be negative');
END;

CREATE TRIGGER trg_orders_total_insert
BEFORE INSERT ON orders
WHEN NEW.total_toman <> NEW.subtotal_toman + NEW.shipping_toman - NEW.discount_toman
BEGIN
  SELECT RAISE(ABORT, 'order total must equal subtotal + shipping - discount');
END;

CREATE TRIGGER trg_orders_total_update
BEFORE UPDATE OF subtotal_toman, shipping_toman, discount_toman, total_toman ON orders
WHEN NEW.total_toman <> NEW.subtotal_toman + NEW.shipping_toman - NEW.discount_toman
BEGIN
  SELECT RAISE(ABORT, 'order total must equal subtotal + shipping - discount');
END;

-- ---------------------------------------------------------------------------
-- 2) Stock reservations for pending (unpaid) orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_holds (
  id         TEXT PRIMARY KEY,
  sku_id     TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  order_id   TEXT REFERENCES orders(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  status     TEXT NOT NULL DEFAULT 'held'
             CHECK (status IN ('held','released','consumed')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_holds_order ON stock_holds(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_holds_sku ON stock_holds(sku_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_holds_expiry ON stock_holds(status, expires_at);

CREATE TRIGGER trg_sku_stock_non_negative_insert
BEFORE INSERT ON skus
WHEN NEW.stock < 0
BEGIN
  SELECT RAISE(ABORT, 'sku stock cannot be negative');
END;

CREATE TRIGGER trg_sku_stock_non_negative_update
BEFORE UPDATE OF stock ON skus
WHEN NEW.stock < 0
BEGIN
  SELECT RAISE(ABORT, 'sku stock cannot be negative');
END;

CREATE TRIGGER trg_sku_price_non_negative_update
BEFORE UPDATE OF price_toman, cost_price_toman ON skus
WHEN NEW.price_toman < 0 OR NEW.cost_price_toman < 0
BEGIN
  SELECT RAISE(ABORT, 'sku prices cannot be negative');
END;

-- ---------------------------------------------------------------------------
-- 3) Address integrity: one default address per person
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_address_default_update
BEFORE UPDATE OF is_default ON user_addresses
WHEN NEW.is_default = 1 AND OLD.is_default = 0
BEGIN
  UPDATE user_addresses SET is_default = 0
   WHERE user_id = NEW.user_id AND id <> NEW.id AND is_default = 1;
END;

CREATE TRIGGER trg_address_default_insert
BEFORE INSERT ON user_addresses
WHEN NEW.is_default = 1
BEGIN
  UPDATE user_addresses SET is_default = 0
   WHERE user_id = NEW.user_id AND is_default = 1;
END;

-- Addresses referenced by an order can never be deleted out from under history.
CREATE TRIGGER trg_address_no_delete_when_ordered
BEFORE DELETE ON user_addresses
WHEN EXISTS (SELECT 1 FROM orders WHERE address_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'address is referenced by an order');
END;

-- ---------------------------------------------------------------------------
-- 4) Authentication depth: refresh tokens, login throttling, password history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  replaced_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON auth_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_session ON auth_refresh_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_refresh_expiry ON auth_refresh_tokens(expires_at);

ALTER TABLE sessions ADD COLUMN ip TEXT;
ALTER TABLE sessions ADD COLUMN last_used_at TEXT;
ALTER TABLE sessions ADD COLUMN revoked_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id          TEXT PRIMARY KEY,
  phone       TEXT,
  ip          TEXT,
  user_agent  TEXT,
  success     INTEGER NOT NULL DEFAULT 0,
  reason      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_phone ON login_attempts(phone, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at);

CREATE TABLE IF NOT EXISTS password_history (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id, created_at);

-- Re-authentication (step-up) proofs for the most sensitive admin actions.
CREATE TABLE IF NOT EXISTS reauth_proofs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  purpose    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reauth_user ON reauth_proofs(user_id, expires_at);

-- ---------------------------------------------------------------------------
-- 5) Auditing depth: append-only, tamper-evident chain
-- ---------------------------------------------------------------------------
-- Legacy databases (created before this migration) carry the strict 005 trigger
-- that blocks every UPDATE. Recreate it so the one-time chain backfill is allowed
-- while all content columns stay immutable forever.
DROP TRIGGER IF EXISTS trg_audit_log_no_update;
CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON audit_log
WHEN NEW.id IS NOT OLD.id
  OR NEW.actor_id IS NOT OLD.actor_id
  OR NEW.actor_role IS NOT OLD.actor_role
  OR NEW.action IS NOT OLD.action
  OR NEW.entity_type IS NOT OLD.entity_type
  OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.detail IS NOT OLD.detail
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.entry_hash IS NOT NULL AND NEW.entry_hash IS NOT OLD.entry_hash)
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;
ALTER TABLE audit_log ADD COLUMN entry_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 6) Payments & refunds depth: never refund more than was paid
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_refund_cap_insert
BEFORE INSERT ON refunds
WHEN NEW.status = 'done'
 AND NEW.amount_toman + COALESCE((
   SELECT SUM(r.amount_toman) FROM refunds r
    WHERE r.payment_id = NEW.payment_id AND r.status = 'done'
 ), 0) > COALESCE((SELECT p.amount_toman FROM payments p WHERE p.id = NEW.payment_id), 0)
BEGIN
  SELECT RAISE(ABORT, 'refund exceeds paid amount');
END;

CREATE TRIGGER trg_payment_amount_non_negative
BEFORE UPDATE OF amount_toman ON payments
WHEN NEW.amount_toman < 0
BEGIN
  SELECT RAISE(ABORT, 'payment amount cannot be negative');
END;

-- One callback token, one payment event history (already unique); add lookup indexes.
CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);

-- ---------------------------------------------------------------------------
-- 7) Service requests & tickets: operational indexing
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sreq_status_due ON service_requests(status, due_at);
CREATE INDEX IF NOT EXISTS idx_sreq_team_status ON service_requests(assigned_team, status);
CREATE INDEX IF NOT EXISTS idx_sreq_user_created ON service_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_user_created ON tickets(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_team_status ON tickets(team, status);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_created ON ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sreq_messages_created ON request_messages(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(sku_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(sku_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_sku ON cart_items(sku_id);
CREATE INDEX IF NOT EXISTS idx_otp_phone_created ON otp_codes(phone, created_at);
CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_people_last_seen ON people_directory(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_idem_user_endpoint ON idempotency_keys(user_id, endpoint, created_at);
CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency_keys(created_at);

-- ---------------------------------------------------------------------------
-- 8) Persisted security & protocol settings (auditable policy)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('security_password_min_length', '12'),
  ('security_password_history_depth', '5'),
  ('security_login_max_failures', '5'),
  ('security_login_lock_minutes', '15'),
  ('security_sensitive_reauth_minutes', '15'),
  ('security_session_idle_days', '14'),
  ('security_data_retention_days', '365'),
  ('db_schema_version', '9'),
  ('db_last_housekeeping_at', 'null');
