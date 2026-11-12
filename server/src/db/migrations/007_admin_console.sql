-- CENTRAL MINE — Migration 007: Admin Console
-- 1) Unique, human-friendly username per account (auto-generated everywhere)
-- 2) people_directory: every person who registered OR filled any form anywhere
--    (signup, shipping profile, order, service request, support ticket) is
--    registered automatically by database triggers — no manual bookkeeping.
-- 3) treasury_cash_ledger: automatic rial cash treasury fed by paid payments,
--    refunds and manual adjustments, with an auditable running balance.

-- ---------------------------------------------------------------------------
-- 1) usernames
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN username TEXT;

-- Deterministic, collision-free username derived from the unique phone number:
-- 09121234567 -> cm9121234567
UPDATE users
   SET username = 'cm' || substr(replace(phone, ' ', ''), 2)
 WHERE username IS NULL OR trim(username) = '';

CREATE UNIQUE INDEX idx_users_username ON users(username);

CREATE TRIGGER trg_users_auto_username
AFTER INSERT ON users
WHEN NEW.username IS NULL OR trim(NEW.username) = ''
BEGIN
  UPDATE users
     SET username = 'cm' || substr(replace(NEW.phone, ' ', ''), 2)
   WHERE id = NEW.id
     AND NOT EXISTS (
       SELECT 1 FROM users u
        WHERE u.username = 'cm' || substr(replace(NEW.phone, ' ', ''), 2)
     );
END;

-- ---------------------------------------------------------------------------
-- 2) people directory
-- ---------------------------------------------------------------------------
CREATE TABLE people_directory (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone               TEXT NOT NULL,
  username            TEXT,
  full_name           TEXT NOT NULL,
  email               TEXT,
  has_signup          INTEGER NOT NULL DEFAULT 1,
  has_shipping        INTEGER NOT NULL DEFAULT 0,
  has_orders          INTEGER NOT NULL DEFAULT 0,
  has_services        INTEGER NOT NULL DEFAULT 0,
  has_tickets         INTEGER NOT NULL DEFAULT 0,
  address_count       INTEGER NOT NULL DEFAULT 0,
  order_count         INTEGER NOT NULL DEFAULT 0,
  service_count       INTEGER NOT NULL DEFAULT 0,
  ticket_count        INTEGER NOT NULL DEFAULT 0,
  last_source         TEXT,
  last_source_at      TEXT,
  first_seen_at       TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL
);
CREATE INDEX idx_people_phone ON people_directory(phone);
CREATE INDEX idx_people_seen ON people_directory(last_seen_at);

-- Backfill from existing users.
INSERT INTO people_directory (
  user_id, phone, username, full_name, email,
  has_signup, has_shipping, has_orders, has_services, has_tickets,
  address_count, order_count, service_count, ticket_count,
  last_source, last_source_at, first_seen_at, last_seen_at
)
SELECT
  u.id, u.phone, u.username, u.full_name, u.email,
  1,
  EXISTS (SELECT 1 FROM user_addresses a WHERE a.user_id = u.id),
  EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id),
  EXISTS (SELECT 1 FROM service_requests r WHERE r.user_id = u.id),
  EXISTS (SELECT 1 FROM tickets t WHERE t.user_id = u.id),
  (SELECT COUNT(*) FROM user_addresses a WHERE a.user_id = u.id),
  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id),
  (SELECT COUNT(*) FROM service_requests r WHERE r.user_id = u.id),
  (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id),
  CASE
    WHEN EXISTS (SELECT 1 FROM tickets t WHERE t.user_id = u.id) THEN 'support_ticket'
    WHEN EXISTS (SELECT 1 FROM service_requests r WHERE r.user_id = u.id) THEN 'service_form'
    WHEN EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id) THEN 'order'
    WHEN EXISTS (SELECT 1 FROM user_addresses a WHERE a.user_id = u.id) THEN 'shipping_form'
    ELSE 'signup'
  END,
  u.updated_at,
  u.created_at,
  u.updated_at
FROM users u;

CREATE TRIGGER trg_dir_user_insert
AFTER INSERT ON users
BEGIN
  INSERT OR IGNORE INTO people_directory (
    user_id, phone, username, full_name, email,
    has_signup, has_shipping, has_orders, has_services, has_tickets,
    address_count, order_count, service_count, ticket_count,
    last_source, last_source_at, first_seen_at, last_seen_at
  ) VALUES (
    NEW.id, NEW.phone, NEW.username, NEW.full_name, NEW.email,
    1, 0, 0, 0, 0,
    0, 0, 0, 0,
    'signup', NEW.created_at, NEW.created_at, NEW.created_at
  );
END;

CREATE TRIGGER trg_dir_user_sync
AFTER UPDATE OF phone, username, full_name, email ON users
BEGIN
  UPDATE people_directory
     SET phone = NEW.phone,
         username = NEW.username,
         full_name = NEW.full_name,
         email = NEW.email
   WHERE user_id = NEW.id;
END;

CREATE TRIGGER trg_dir_address_insert
AFTER INSERT ON user_addresses
BEGIN
  INSERT INTO people_directory (
    user_id, phone, username, full_name, email,
    has_signup, has_shipping, has_orders, has_services, has_tickets,
    address_count, order_count, service_count, ticket_count,
    last_source, last_source_at, first_seen_at, last_seen_at
  )
  SELECT
    u.id, u.phone, u.username, u.full_name, u.email,
    1, 1, 0, 0, 0,
    1, 0, 0, 0,
    'shipping_form', NEW.created_at, NEW.created_at, NEW.created_at
    FROM users u WHERE u.id = NEW.user_id
  ON CONFLICT(user_id) DO UPDATE SET
    has_shipping   = 1,
    address_count  = people_directory.address_count + 1,
    phone          = excluded.phone,
    username       = excluded.username,
    full_name      = excluded.full_name,
    last_source    = 'shipping_form',
    last_source_at = NEW.created_at,
    last_seen_at   = NEW.created_at;
END;

CREATE TRIGGER trg_dir_address_delete
AFTER DELETE ON user_addresses
BEGIN
  UPDATE people_directory
     SET address_count = (SELECT COUNT(*) FROM user_addresses a WHERE a.user_id = OLD.user_id),
         has_shipping  = EXISTS (SELECT 1 FROM user_addresses a WHERE a.user_id = OLD.user_id)
   WHERE user_id = OLD.user_id;
END;

CREATE TRIGGER trg_dir_order_insert
AFTER INSERT ON orders
BEGIN
  INSERT INTO people_directory (
    user_id, phone, username, full_name, email,
    has_signup, has_shipping, has_orders, has_services, has_tickets,
    address_count, order_count, service_count, ticket_count,
    last_source, last_source_at, first_seen_at, last_seen_at
  )
  SELECT
    u.id, u.phone, u.username, u.full_name, u.email,
    1, 0, 1, 0, 0,
    0, 1, 0, 0,
    'order', NEW.created_at, NEW.created_at, NEW.created_at
    FROM users u WHERE u.id = NEW.user_id
  ON CONFLICT(user_id) DO UPDATE SET
    has_orders    = 1,
    order_count   = people_directory.order_count + 1,
    phone         = excluded.phone,
    username      = excluded.username,
    full_name     = excluded.full_name,
    last_source   = 'order',
    last_source_at = NEW.created_at,
    last_seen_at  = NEW.created_at;
END;

CREATE TRIGGER trg_dir_service_insert
AFTER INSERT ON service_requests
BEGIN
  INSERT INTO people_directory (
    user_id, phone, username, full_name, email,
    has_signup, has_shipping, has_orders, has_services, has_tickets,
    address_count, order_count, service_count, ticket_count,
    last_source, last_source_at, first_seen_at, last_seen_at
  )
  SELECT
    u.id, u.phone, u.username, u.full_name, u.email,
    1, 0, 0, 1, 0,
    0, 0, 1, 0,
    'service_form', NEW.created_at, NEW.created_at, NEW.created_at
    FROM users u WHERE u.id = NEW.user_id
  ON CONFLICT(user_id) DO UPDATE SET
    has_services  = 1,
    service_count = people_directory.service_count + 1,
    phone         = excluded.phone,
    username      = excluded.username,
    full_name     = excluded.full_name,
    last_source   = 'service_form',
    last_source_at = NEW.created_at,
    last_seen_at  = NEW.created_at;
END;

CREATE TRIGGER trg_dir_ticket_insert
AFTER INSERT ON tickets
BEGIN
  INSERT INTO people_directory (
    user_id, phone, username, full_name, email,
    has_signup, has_shipping, has_orders, has_services, has_tickets,
    address_count, order_count, service_count, ticket_count,
    last_source, last_source_at, first_seen_at, last_seen_at
  )
  SELECT
    u.id, u.phone, u.username, u.full_name, u.email,
    1, 0, 0, 0, 1,
    0, 0, 0, 1,
    'support_ticket', NEW.created_at, NEW.created_at, NEW.created_at
    FROM users u WHERE u.id = NEW.user_id
  ON CONFLICT(user_id) DO UPDATE SET
    has_tickets   = 1,
    ticket_count  = people_directory.ticket_count + 1,
    phone         = excluded.phone,
    username      = excluded.username,
    full_name     = excluded.full_name,
    last_source   = 'support_ticket',
    last_source_at = NEW.created_at,
    last_seen_at  = NEW.created_at;
END;

-- ---------------------------------------------------------------------------
-- 3) automatic rial cash treasury
-- ---------------------------------------------------------------------------
CREATE TABLE treasury_cash_ledger (
  id           TEXT PRIMARY KEY,
  direction    TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  entry_type   TEXT NOT NULL
               CHECK (entry_type IN ('product_sale', 'service_sale', 'lth_sale', 'refund', 'payout', 'adjustment', 'opening')),
  amount_toman INTEGER NOT NULL CHECK (amount_toman >= 0),
  ref_type     TEXT,
  ref_id       TEXT,
  note         TEXT,
  actor_id     TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_treasury_cash_created ON treasury_cash_ledger(created_at);
CREATE INDEX idx_treasury_cash_type ON treasury_cash_ledger(entry_type, direction);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('treasury_opening_balance_toman', '0'),
  ('treasury_low_balance_toman', '5000000');

-- Historic backfill: every payment that was actually settled is income.
INSERT OR IGNORE INTO treasury_cash_ledger (
  id, direction, entry_type, amount_toman, ref_type, ref_id, note, actor_id, created_at
)
SELECT
  'TX-IN-' || p.id,
  'in',
  CASE
    WHEN p.lth_purchase_id IS NOT NULL THEN 'lth_sale'
    WHEN p.service_request_id IS NOT NULL THEN 'service_sale'
    ELSE 'product_sale'
  END,
  p.amount_toman,
  'payment',
  p.id,
  'دریافت خودکار از پرداخت تسویه‌شده',
  NULL,
  COALESCE(p.paid_at, p.created_at)
FROM payments p
WHERE p.status = 'paid' OR p.paid_at IS NOT NULL;

INSERT OR IGNORE INTO treasury_cash_ledger (
  id, direction, entry_type, amount_toman, ref_type, ref_id, note, actor_id, created_at
)
SELECT
  'TX-OUT-' || r.id, 'out', 'refund', r.amount_toman,
  'refund', r.id, r.reason, r.actor_id, r.created_at
FROM refunds r;

-- Automatic income when a payment is created already settled.
CREATE TRIGGER trg_cash_payment_paid_insert
AFTER INSERT ON payments
WHEN NEW.status = 'paid'
BEGIN
  INSERT OR IGNORE INTO treasury_cash_ledger (
    id, direction, entry_type, amount_toman, ref_type, ref_id, note, actor_id, created_at
  ) VALUES (
    'TX-IN-' || NEW.id,
    'in',
    CASE
      WHEN NEW.lth_purchase_id IS NOT NULL THEN 'lth_sale'
      WHEN NEW.service_request_id IS NOT NULL THEN 'service_sale'
      ELSE 'product_sale'
    END,
    NEW.amount_toman,
    'payment',
    NEW.id,
    'دریافت خودکار از پرداخت تسویه‌شده',
    NULL,
    COALESCE(NEW.paid_at, NEW.created_at)
  );
END;

-- Automatic income when an existing payment settles.
CREATE TRIGGER trg_cash_payment_paid_update
AFTER UPDATE OF status ON payments
WHEN NEW.status = 'paid' AND OLD.status <> 'paid'
BEGIN
  INSERT OR IGNORE INTO treasury_cash_ledger (
    id, direction, entry_type, amount_toman, ref_type, ref_id, note, actor_id, created_at
  ) VALUES (
    'TX-IN-' || NEW.id,
    'in',
    CASE
      WHEN NEW.lth_purchase_id IS NOT NULL THEN 'lth_sale'
      WHEN NEW.service_request_id IS NOT NULL THEN 'service_sale'
      ELSE 'product_sale'
    END,
    NEW.amount_toman,
    'payment',
    NEW.id,
    'دریافت خودکار از پرداخت تسویه‌شده',
    NULL,
    COALESCE(NEW.paid_at, NEW.updated_at, NEW.created_at)
  );
END;

-- Automatic outflow when a refund is issued.
CREATE TRIGGER trg_cash_refund_insert
AFTER INSERT ON refunds
BEGIN
  INSERT OR IGNORE INTO treasury_cash_ledger (
    id, direction, entry_type, amount_toman, ref_type, ref_id, note, actor_id, created_at
  ) VALUES (
    'TX-OUT-' || NEW.id, 'out', 'refund', NEW.amount_toman,
    'refund', NEW.id, NEW.reason, NEW.actor_id, NEW.created_at
  );
END;
