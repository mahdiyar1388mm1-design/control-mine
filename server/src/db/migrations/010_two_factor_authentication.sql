-- ---------------------------------------------------------------------------
-- 010_two_factor_authentication
-- Optional per-user TOTP second factor with recovery codes and replay defence.
-- Fully additive: nothing from 001..009 is modified or removed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc    TEXT NOT NULL,                       -- AES-256-GCM payload (utils/totp)
  enabled       INTEGER NOT NULL DEFAULT 0,
  confirmed_at  TEXT,
  last_step     INTEGER,                             -- last accepted TOTP step (replay guard)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,                         -- SHA-256 of the normalized code
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user ON mfa_recovery_codes(user_id, used_at);

-- Pending login challenges: password is verified, the second factor is not yet.
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,                 -- SHA-256 of the opaque challenge token
  user_agent   TEXT,
  ip           TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mfa_challenge_user ON mfa_challenges(user_id, expires_at);

-- Every security-relevant MFA event is attributable.
INSERT OR IGNORE INTO settings (key, value) VALUES ('security_mfa_enforced_roles', '["admin","finance"]');
INSERT OR IGNORE INTO settings (key, value) VALUES ('security_mfa_challenge_ttl_seconds', '300');
INSERT OR IGNORE INTO settings (key, value) VALUES ('security_mfa_max_attempts', '5');
