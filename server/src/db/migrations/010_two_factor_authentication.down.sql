-- Rollback for 010_two_factor_authentication
DROP INDEX IF EXISTS idx_mfa_challenge_user;
DROP TABLE IF EXISTS mfa_challenges;
DROP INDEX IF EXISTS idx_mfa_recovery_user;
DROP TABLE IF EXISTS mfa_recovery_codes;
DROP TABLE IF EXISTS user_mfa;
DELETE FROM settings WHERE key IN (
  'security_mfa_enforced_roles', 'security_mfa_challenge_ttl_seconds', 'security_mfa_max_attempts'
);
