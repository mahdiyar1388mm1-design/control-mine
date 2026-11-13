-- 013_lth_regulator_lock
--
-- The operator decided the stakeholder split is fixed at 70% staked / 30%
-- withdrawable. Migration 002 already constrained the *shape* of the pair
-- (0..10000 each, sum = 10000); this migration adds the missing *value* lock:
--
--   * lth_settings can only ever hold stake_bps = 7000 / withdrawable_bps = 3000.
--
-- Per-contract snapshots (lth_holdings) do not store the split at all: they
-- store accrued_staked_atoms / accrued_withdrawable_atoms, which are derived
-- from lth_settings at settlement time. Locking the settings row therefore
-- locks every future settlement too — no second trigger is needed.
--
-- The guard is a BEFORE INSERT/UPDATE trigger, i.e. it sits below the service
-- layer: even a direct SQL write from a maintenance script cannot bypass it.
-- Reading the constants from a helper view keeps the numbers in exactly one place.
--
-- To change the split in the future, ship a new migration that drops and
-- recreates these triggers with the new values — deliberately a code change,
-- not a setting.

CREATE VIEW IF NOT EXISTS lth_regulator_lock AS
  SELECT 7000 AS stake_bps, 3000 AS withdrawable_bps, 10000 AS total_bps;

-- Settings row (single row, id = 1)
CREATE TRIGGER IF NOT EXISTS trg_lth_settings_regulator_lock_insert
BEFORE INSERT ON lth_settings
FOR EACH ROW
WHEN NEW.stake_bps IS NOT (SELECT stake_bps FROM lth_regulator_lock)
  OR NEW.withdrawable_bps IS NOT (SELECT withdrawable_bps FROM lth_regulator_lock)
BEGIN
  SELECT RAISE(ABORT, 'lth_settings: the 70/30 regulator ratio is locked; ship a migration to change it');
END;

CREATE TRIGGER IF NOT EXISTS trg_lth_settings_regulator_lock_update
BEFORE UPDATE OF stake_bps, withdrawable_bps ON lth_settings
FOR EACH ROW
WHEN NEW.stake_bps IS NOT (SELECT stake_bps FROM lth_regulator_lock)
  OR NEW.withdrawable_bps IS NOT (SELECT withdrawable_bps FROM lth_regulator_lock)
BEGIN
  SELECT RAISE(ABORT, 'lth_settings: the 70/30 regulator ratio is locked; ship a migration to change it');
END;

-- Normalise any drifted rows before the lock takes effect. If history holds a
-- different split, this is the moment it is corrected (and the operator is
-- told by the migration count in the audit trail).
UPDATE lth_settings
   SET stake_bps = (SELECT stake_bps FROM lth_regulator_lock),
       withdrawable_bps = (SELECT withdrawable_bps FROM lth_regulator_lock),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE stake_bps IS NOT (SELECT stake_bps FROM lth_regulator_lock)
    OR withdrawable_bps IS NOT (SELECT withdrawable_bps FROM lth_regulator_lock);
