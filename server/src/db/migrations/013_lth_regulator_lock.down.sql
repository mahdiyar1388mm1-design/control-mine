-- 013_lth_regulator_lock (down)
--
-- Restores the pre-013 flexibility: the ratio can be edited again through the
-- service (still constrained to a 0..100% pair summing to 100%).

-- Also drop the (mistaken) holdings triggers from the first revision of this
-- migration, in case a deployment applied it before the correction.
DROP TRIGGER IF EXISTS trg_lth_holdings_regulator_lock_update;
DROP TRIGGER IF EXISTS trg_lth_holdings_regulator_lock_insert;
DROP TRIGGER IF EXISTS trg_lth_settings_regulator_lock_update;
DROP TRIGGER IF EXISTS trg_lth_settings_regulator_lock_insert;
DROP VIEW IF EXISTS lth_regulator_lock;
