-- Rollback for 009_query_performance

DROP INDEX IF EXISTS idx_orders_user_created;
DROP INDEX IF EXISTS idx_orders_status_created;
DROP INDEX IF EXISTS idx_orders_created_status;
DROP INDEX IF EXISTS idx_payments_created;
DROP INDEX IF EXISTS idx_payments_order_status;
DROP INDEX IF EXISTS idx_refunds_created;
DROP INDEX IF EXISTS idx_service_requests_created;
DROP INDEX IF EXISTS idx_tickets_created;
DROP INDEX IF EXISTS idx_audit_role_created;
DROP INDEX IF EXISTS idx_people_source_seen;
DROP INDEX IF EXISTS idx_sku_active;
DROP INDEX IF EXISTS idx_orders_tracking;
DROP INDEX IF EXISTS idx_users_role_status;
DROP INDEX IF EXISTS idx_user_addresses_user_default;
DROP INDEX IF EXISTS idx_lth_ledger_created;
DROP INDEX IF EXISTS idx_treasury_cash_created_direction;
