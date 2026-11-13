-- Rollback of migration 007 (Admin Console additions)
DROP TRIGGER IF EXISTS trg_cash_refund_insert;
DROP TRIGGER IF EXISTS trg_cash_payment_paid_update;
DROP TRIGGER IF EXISTS trg_cash_payment_paid_insert;
DROP TABLE IF EXISTS treasury_cash_ledger;
DROP TRIGGER IF EXISTS trg_dir_ticket_insert;
DROP TRIGGER IF EXISTS trg_dir_service_insert;
DROP TRIGGER IF EXISTS trg_dir_order_insert;
DROP TRIGGER IF EXISTS trg_dir_address_delete;
DROP TRIGGER IF EXISTS trg_dir_address_insert;
DROP TRIGGER IF EXISTS trg_dir_user_sync;
DROP TRIGGER IF EXISTS trg_dir_user_insert;
DROP TABLE IF EXISTS people_directory;
DROP TRIGGER IF EXISTS trg_users_auto_username;
DROP INDEX IF EXISTS idx_users_username;
ALTER TABLE users DROP COLUMN username;
DELETE FROM settings WHERE key IN ('treasury_opening_balance_toman', 'treasury_low_balance_toman');
