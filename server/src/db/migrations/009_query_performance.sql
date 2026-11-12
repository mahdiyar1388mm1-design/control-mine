-- CENTRAL MINE — Migration 009: query performance for dashboards and ops queues
-- Purely additive indexes; safe on large tables and reversible without data loss.

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_status ON orders(created_at, status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_order_status ON payments(order_id, status);
CREATE INDEX IF NOT EXISTS idx_refunds_created ON refunds(created_at);
CREATE INDEX IF NOT EXISTS idx_service_requests_created ON service_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_role_created ON audit_log(actor_role, created_at);
CREATE INDEX IF NOT EXISTS idx_people_source_seen ON people_directory(last_source, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sku_active ON skus(is_active, stock);
CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_code);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_default ON user_addresses(user_id, is_default);
CREATE INDEX IF NOT EXISTS idx_lth_ledger_created ON lth_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_treasury_cash_created_direction ON treasury_cash_ledger(created_at, direction);

INSERT OR IGNORE INTO settings (key, value) VALUES ('db_schema_version', '9');
