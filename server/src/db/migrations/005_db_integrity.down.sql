-- Revert DB integrity hardening (migration 005).
DROP INDEX IF EXISTS idx_orders_created;
DROP INDEX IF EXISTS idx_sreq_due;
DROP INDEX IF EXISTS idx_lth_treasury_ledger_user;
DROP TRIGGER IF EXISTS trg_lth_wallets_no_negative_update;
DROP TRIGGER IF EXISTS trg_lth_wallets_no_negative_insert;
DROP TRIGGER IF EXISTS trg_audit_log_no_delete;
DROP TRIGGER IF EXISTS trg_audit_log_no_update;
