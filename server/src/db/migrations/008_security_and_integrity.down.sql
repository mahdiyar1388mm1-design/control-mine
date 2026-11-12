-- Rollback for 008_security_and_integrity (data added by newer features is dropped).

DROP TRIGGER IF EXISTS trg_orders_money_insert;
DROP TRIGGER IF EXISTS trg_orders_total_insert;
DROP TRIGGER IF EXISTS trg_orders_total_update;
DROP TRIGGER IF EXISTS trg_sku_stock_non_negative_insert;
DROP TRIGGER IF EXISTS trg_sku_stock_non_negative_update;
DROP TRIGGER IF EXISTS trg_sku_price_non_negative_update;
DROP TRIGGER IF EXISTS trg_address_default_update;
DROP TRIGGER IF EXISTS trg_address_default_insert;
DROP TRIGGER IF EXISTS trg_address_no_delete_when_ordered;
DROP TRIGGER IF EXISTS trg_refund_cap_insert;
DROP TRIGGER IF EXISTS trg_payment_amount_non_negative;

DROP INDEX IF EXISTS idx_orders_address;
DROP INDEX IF EXISTS idx_stock_holds_order;
DROP INDEX IF EXISTS idx_stock_holds_sku;
DROP INDEX IF EXISTS idx_stock_holds_expiry;
DROP INDEX IF EXISTS idx_refresh_user;
DROP INDEX IF EXISTS idx_refresh_session;
DROP INDEX IF EXISTS idx_refresh_expiry;
DROP INDEX IF EXISTS idx_sessions_expiry;
DROP INDEX IF EXISTS idx_login_attempts_phone;
DROP INDEX IF EXISTS idx_login_attempts_ip;
DROP INDEX IF EXISTS idx_password_history_user;
DROP INDEX IF EXISTS idx_reauth_user;
DROP INDEX IF EXISTS idx_audit_actor;
DROP INDEX IF EXISTS idx_audit_action;
DROP INDEX IF EXISTS idx_audit_entity;
DROP INDEX IF EXISTS idx_payments_status_created;
DROP INDEX IF EXISTS idx_payments_paid_at;
DROP INDEX IF EXISTS idx_sreq_status_due;
DROP INDEX IF EXISTS idx_sreq_team_status;
DROP INDEX IF EXISTS idx_sreq_user_created;
DROP INDEX IF EXISTS idx_tickets_user_created;
DROP INDEX IF EXISTS idx_tickets_team_status;
DROP INDEX IF EXISTS idx_ticket_messages_created;
DROP INDEX IF EXISTS idx_sreq_messages_created;
DROP INDEX IF EXISTS idx_notifications_user_created;
DROP INDEX IF EXISTS idx_notifications_unread;
DROP INDEX IF EXISTS idx_stock_movements_created;
DROP INDEX IF EXISTS idx_stock_movements_ref;
DROP INDEX IF EXISTS idx_order_items_sku;
DROP INDEX IF EXISTS idx_cart_items_sku;
DROP INDEX IF EXISTS idx_otp_phone_created;
DROP INDEX IF EXISTS idx_products_created;
DROP INDEX IF EXISTS idx_products_name;
DROP INDEX IF EXISTS idx_people_last_seen;
DROP INDEX IF EXISTS idx_idem_user_endpoint;
DROP INDEX IF EXISTS idx_idem_created;

DROP TABLE IF EXISTS stock_holds;
DROP TABLE IF EXISTS auth_refresh_tokens;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS password_history;
DROP TABLE IF EXISTS reauth_proofs;

ALTER TABLE sessions DROP COLUMN ip;
ALTER TABLE sessions DROP COLUMN last_used_at;
ALTER TABLE sessions DROP COLUMN revoked_reason;
-- Restore the strict append-only trigger before dropping the chain columns it references.
DROP TRIGGER IF EXISTS trg_audit_log_no_update;
CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
ALTER TABLE audit_log DROP COLUMN prev_hash;
ALTER TABLE audit_log DROP COLUMN entry_hash;
ALTER TABLE orders DROP COLUMN address_id;

DELETE FROM settings WHERE key IN (
  'security_password_min_length','security_password_history_depth','security_login_max_failures',
  'security_login_lock_minutes','security_sensitive_reauth_minutes','security_session_idle_days',
  'security_data_retention_days','db_schema_version','db_last_housekeeping_at'
);
