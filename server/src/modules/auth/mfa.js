'use strict';

/**
 * Two-factor authentication (TOTP + recovery codes) for any account, with an
 * optional hard requirement for privileged roles.
 *
 * Flow:
 *   1. POST /auth/login          → password ok, MFA enabled  ⇒ { mfa_required, challenge_token }
 *   2. POST /auth/mfa/verify     → { challenge_token, code } ⇒ real session + refresh token
 *   3. POST /auth/mfa/setup      → secret + otpauth URI (not active yet)
 *   4. POST /auth/mfa/enable     → verified code ⇒ enabled + one-time recovery codes
 *   5. POST /auth/mfa/disable    → password + code ⇒ disabled
 */
const crypto = require('crypto');
const { get, run, tx, all } = require('../../db');
const { ApiError } = require('../../utils/errors');
const config = require('../../config');
const { uuid, nowIso, validate } = require('../../utils/validate');
const { audit, getSetting } = require('../platform/service');
const { hashPassword } = require('../../utils/password');
const totp = require('../../utils/totp');

const CHALLENGE_ERROR = 'کد تأیید دومرحله‌ای نادرست یا منقضی است.';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function challengeTtlSeconds() {
  return Number(getSetting('security_mfa_challenge_ttl_seconds', 300)) || 300;
}

function maxAttempts() {
  return Number(getSetting('security_mfa_max_attempts', 5)) || 5;
}

function enforcedRoles() {
  let roles = [];
  try {
    roles = JSON.parse(getSetting('security_mfa_enforced_roles', '["admin","finance"]')) || [];
  } catch {
    roles = ['admin', 'finance'];
  }
  return config.security.mfaEnforce ? roles : [];
}

function mfaRow(userId) {
  return get('SELECT * FROM user_mfa WHERE user_id = ?', [userId]);
}

/** Public status for the account page. */
function status(userId) {
  const row = mfaRow(userId);
  return {
    available: true,
    enabled: Boolean(row && row.enabled),
    confirmed_at: row ? row.confirmed_at : null,
    recovery_codes_left: get(
      'SELECT COUNT(*) AS c FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL', [userId]
    ).c,
    enforced: Boolean(row && row.enabled) || enforcedRoles().length === 0 ? false : undefined
  };
}

/** Called from auth.login when the password step already succeeded. */
function needsChallenge(user) {
  const row = mfaRow(user.id);
  if (!row || !row.enabled) return false;
  return true;
}

function createChallenge(user, meta = {}) {
  const token = crypto.randomBytes(40).toString('base64url');
  const expiresAt = new Date(Date.now() + challengeTtlSeconds() * 1000).toISOString();
  run(
    `INSERT INTO mfa_challenges (id, user_id, token_hash, user_agent, ip, attempts, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [uuid(), user.id, sha256(token), (meta.userAgent || '').slice(0, 200), meta.ip || null, nowIso(), expiresAt]
  );
  audit(user.id, user.role, 'auth.mfa_challenge', 'user', user.id, { ip: meta.ip || null });
  return {
    mfa_required: true,
    challenge_token: token,
    expires_at: expiresAt,
    methods: ['totp', 'recovery_code']
  };
}

function consumeRecoveryCode(userId, code) {
  const normalized = totp.normalizeRecoveryCode(code);
  if (normalized.length < 6) return false;
  const hash = sha256(normalized);
  const row = get(
    'SELECT id FROM mfa_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', [userId, hash]
  );
  if (!row) return false;
  run('UPDATE mfa_recovery_codes SET used_at = ? WHERE id = ?', [nowIso(), row.id]);
  audit(userId, null, 'auth.mfa_recovery_used', 'user', userId, { remaining: status(userId).recovery_codes_left });
  return true;
}

/**
 * Verifies a challenge and returns the owning user row; the caller then issues a
 * normal session. Replay of a TOTP code is blocked through `last_step`.
 */
function verifyChallenge({ challenge_token: challengeToken, code, recovery_code: recoveryCode } = {}, meta = {}) {
  const data = validate({ challenge_token: challengeToken })
    .string('challenge_token', { min: 20, max: 200 })
    .done();
  const hash = sha256(data.challenge_token);
  const challenge = get('SELECT * FROM mfa_challenges WHERE token_hash = ?', [hash]);
  if (!challenge || challenge.consumed_at || challenge.expires_at <= nowIso()) {
    throw ApiError.unauthorized(CHALLENGE_ERROR);
  }
  if (challenge.attempts >= maxAttempts()) {
    // Bounded brute force: this challenge is dead, but the password step is
    // untouched, so the owner can immediately request a fresh challenge.
    run('UPDATE mfa_challenges SET consumed_at = ? WHERE id = ?', [nowIso(), challenge.id]);
    audit(challenge.user_id, null, 'auth.mfa_challenge_locked', 'user', challenge.user_id, {});
    throw ApiError.unauthorized('این مرحلهٔ تأیید باطل شد؛ دوباره وارد شوید و کد تازه بگیرید.');
  }
  const user = get('SELECT * FROM users WHERE id = ?', [challenge.user_id]);
  if (!user || user.status !== 'active') throw ApiError.unauthorized(CHALLENGE_ERROR);

  const row = mfaRow(user.id);
  if (!row || !row.enabled) throw ApiError.unauthorized(CHALLENGE_ERROR);

  let ok = false;
  let usedRecovery = false;
  if (recoveryCode) {
    ok = consumeRecoveryCode(user.id, recoveryCode);
    usedRecovery = ok;
  } else {
    const secret = totp.decryptSecret(row.secret_enc);
    const step = totp.verifyCode(secret, String(code || ''));
    if (step !== null && (row.last_step === null || step > row.last_step)) {
      run('UPDATE user_mfa SET last_step = ?, updated_at = ? WHERE user_id = ?', [step, nowIso(), user.id]);
      ok = true;
    } else if (step !== null && row.last_step !== null && step <= row.last_step) {
      // A valid but already-used code: treat as a replay attempt and count it.
      const replay = { step, last_step: row.last_step, delta_steps: row.last_step - step };
      audit(user.id, user.role, 'auth.mfa_replay_blocked', 'user', user.id, replay);
      // A large delta means the device clock is far behind the server clock —
      // that is the single most common cause of "the code is always wrong".
      if (replay.delta_steps >= 10) {
        throw ApiError.unauthorized(
          'ساعت دستگاه شما با سرور اختلاف زیادی دارد؛ زمان گوشی را روی «تنظیم خودکار» بگذارید و دوباره وارد شوید.'
        );
      }
    }
  }

  if (!ok) {
    // Deliberately NOT counted in `login_attempts`: that table drives the account
    // lockout, and letting a wrong second factor lock the owner out would be a
    // denial-of-service gift to anyone who knows the password. Brute force stays
    // bounded by the per-challenge attempt cap, the IP rate limit and the audit
    // trail; only the challenge (never the account) is killed.
    run('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?', [challenge.id]);
    audit(user.id, user.role, 'auth.mfa_failed', 'user', user.id,
      { ip: meta.ip || null, attempts: challenge.attempts + 1 });
    throw ApiError.unauthorized(CHALLENGE_ERROR);
  }

  run('UPDATE mfa_challenges SET consumed_at = ? WHERE id = ?', [nowIso(), challenge.id]);
  audit(user.id, user.role, usedRecovery ? 'auth.mfa_login_recovery' : 'auth.mfa_login', 'user', user.id,
    { ip: meta.ip || null });
  return user;
}

/** Starts (or restarts) enrollment. The secret stays inactive until `enable`. */
function setup(userId) {
  const existing = mfaRow(userId);
  if (existing && existing.enabled) {
    throw ApiError.conflict('ورود دومرحله‌ای از قبل فعال است.');
  }
  const secret = totp.generateSecret();
  const now = nowIso();
  run(
    `INSERT INTO user_mfa (user_id, secret_enc, enabled, confirmed_at, last_step, created_at, updated_at)
     VALUES (?, ?, 0, NULL, NULL, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET secret_enc = excluded.secret_enc, enabled = 0, confirmed_at = NULL,
       last_step = NULL, updated_at = excluded.updated_at`,
    [userId, totp.encryptSecret(secret), now, now]
  );
  const user = get('SELECT phone, username FROM users WHERE id = ?', [userId]);
  audit(userId, null, 'auth.mfa_setup_started', 'user', userId, {});
  return {
    secret,
    otpauth_uri: totp.otpauthUri({ secret, account: user.username || user.phone }),
    digits: totp.DIGITS,
    period: totp.STEP_SECONDS,
    algorithm: 'SHA1'
  };
}

function enable(userId, { code } = {}) {
  const row = mfaRow(userId);
  if (!row) throw ApiError.validation('ابتدا فرایند فعال‌سازی را آغاز کنید.');
  if (row.enabled) throw ApiError.conflict('ورود دومرحله‌ای از قبل فعال است.');
  const secret = totp.decryptSecret(row.secret_enc);
  const step = totp.verifyCode(secret, String(code || ''));
  if (step === null) throw ApiError.validation('کد برنامهٔ احراز هویت نادرست است.');

  const codes = totp.generateRecoveryCodes(8);
  const now = nowIso();
  tx(() => {
    // `last_step` stays NULL on purpose. Setting it to the step just used for
    // enrolment would reject that same code at the very next login (replay
    // protection is `step > last_step`), i.e. the user would enable 2FA and be
    // unable to log in again for up to 30 seconds — and would burn an attempt
    // each try. Replay protection starts with the first *login* code instead.
    run('UPDATE user_mfa SET enabled = 1, confirmed_at = ?, last_step = NULL, updated_at = ? WHERE user_id = ?',
      [now, now, userId]);
    run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
    for (const plain of codes) {
      run('INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
        [uuid(), userId, sha256(totp.normalizeRecoveryCode(plain)), now]);
    }
  });
  const user = get('SELECT role FROM users WHERE id = ?', [userId]);
  audit(userId, user ? user.role : null, 'auth.mfa_enabled', 'user', userId, { recovery_codes: codes.length });
  return { enabled: true, recovery_codes: codes };
}

function disable(userId, { password, code, recovery_code: recoveryCode } = {}) {
  const row = mfaRow(userId);
  if (!row || !row.enabled) throw ApiError.validation('ورود دومرحله‌ای فعال نیست.');
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw ApiError.unauthorized();
  const { verifyPassword } = require('../../utils/password');
  if (!verifyPassword(String(password || ''), user.password_hash, user.password_salt)) {
    throw ApiError.unauthorized('رمز عبور نادرست است.');
  }
  let ok = false;
  if (recoveryCode) {
    ok = consumeRecoveryCode(userId, recoveryCode);
  } else {
    const secret = totp.decryptSecret(row.secret_enc);
    ok = totp.verifyCode(secret, String(code || '')) !== null;
  }
  if (!ok) throw ApiError.unauthorized('کد تأیید نادرست است.');
  tx(() => {
    run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
    run('DELETE FROM user_mfa WHERE user_id = ?', [userId]);
    run('DELETE FROM mfa_challenges WHERE user_id = ?', [userId]);
  });
  audit(userId, user.role, 'auth.mfa_disabled', 'user', userId, {});
  return { enabled: false };
}

/** Re-issues recovery codes after re-authentication (old codes die immediately). */
function regenerateRecoveryCodes(userId, { password, code } = {}) {
  const row = mfaRow(userId);
  if (!row || !row.enabled) throw ApiError.validation('ورود دومرحله‌ای فعال نیست.');
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user || !verifyPassword(String(password || ''), user.password_hash, user.password_salt)) {
    throw ApiError.unauthorized('رمز عبور نادرست است.');
  }
  const secret = totp.decryptSecret(row.secret_enc);
  if (totp.verifyCode(secret, String(code || '')) === null) {
    throw ApiError.unauthorized('کد تأیید نادرست است.');
  }
  const codes = totp.generateRecoveryCodes(8);
  const now = nowIso();
  tx(() => {
    run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
    for (const plain of codes) {
      run('INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
        [uuid(), userId, sha256(totp.normalizeRecoveryCode(plain)), now]);
    }
  });
  audit(userId, user.role, 'auth.mfa_recovery_regenerated', 'user', userId, { recovery_codes: codes.length });
  return { recovery_codes: codes };
}

function adminCoverage() {
  const rows = all(
    `SELECT u.id, u.phone, u.role, COALESCE(m.enabled, 0) AS enabled
       FROM users u LEFT JOIN user_mfa m ON m.user_id = u.id
      WHERE u.role IN ('admin','finance') AND u.status = 'active'`
  );
  const enabled = rows.filter((r) => r.enabled).length;
  return { privileged_users: rows.length, with_mfa: enabled, without_mfa: rows.length - enabled };
}

module.exports = {
  status, needsChallenge, createChallenge, verifyChallenge, setup, enable, disable,
  regenerateRecoveryCodes, adminCoverage, enforcedRoles, maxAttempts
};
