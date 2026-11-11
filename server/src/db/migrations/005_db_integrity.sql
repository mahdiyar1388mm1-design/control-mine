-- CENTRAL MINE — Migration 005: DB integrity hardening
-- 1) audit_log is append-only (block UPDATE/DELETE)
-- 2) LTH balances are TEXT bigints; SQLite CHECK can't compare them safely,
--    so block negative values with a trigger (values stored as '-...' are negative).
-- 3) indexes for treasury lookups and SLA queries

CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER trg_audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER trg_lth_wallets_no_negative_insert
BEFORE INSERT ON lth_wallets
WHEN substr(NEW.base_atoms,1,1) = '-' OR substr(NEW.staked_atoms,1,1) = '-'
  OR substr(NEW.withdrawable_reward_atoms,1,1) = '-' OR substr(NEW.reserved_atoms,1,1) = '-'
BEGIN
  SELECT RAISE(ABORT, 'lth wallet balance cannot be negative');
END;

CREATE TRIGGER trg_lth_wallets_no_negative_update
BEFORE UPDATE ON lth_wallets
WHEN substr(NEW.base_atoms,1,1) = '-' OR substr(NEW.staked_atoms,1,1) = '-'
  OR substr(NEW.withdrawable_reward_atoms,1,1) = '-' OR substr(NEW.reserved_atoms,1,1) = '-'
BEGIN
  SELECT RAISE(ABORT, 'lth wallet balance cannot be negative');
END;

CREATE INDEX IF NOT EXISTS idx_lth_treasury_ledger_user ON lth_treasury_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_sreq_due ON service_requests(due_at);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
