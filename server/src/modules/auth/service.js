'use strict';

const crypto = require('crypto');
const { all, get, run, tx } = require('../../db');
const { ApiError } = require('../../utils/errors');
const config = require('../../config');
const providers = require('../payments/providers');
const {
  hashPassword, verifyPassword, dummyVerify, assertPasswordStrength, policy, needsRehash
} = require('../../utils/password');
const {
  signToken, hashOtp, randomOtpCode, generateRefreshToken, hashRefreshToken
} = require('../../utils/token');
const { uuid, nowIso, validate, sha256 } = require('../../utils/validate');
const { notify, audit } = require('../platform/service');
const mfa = require('./mfa');

const GENERIC_LOGIN_ERROR = 'شماره موبایل یا رمز عبور نادرست است.';
const GENERIC_OTP_ERROR = 'کد نادرست یا منقضی است.';

function normalizePhone(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s\-()]/g, '')
    .replace(/^\+?98/, '0');
}

function publicUser(row) {
  return {
    id: row.id,
    phone: row.phone,
    username: row.username || null,
    full_name: row.full_name,
    email: row.email || null,
    role: row.role,
    status: row.status,
    created_at: row.created_at
  };
}

/** Persists a hashed refresh token bound to a specific session. */
function issueRefreshToken({ userId, sessionId, device, ip }) {
  const token = generateRefreshToken();
  run(
    `INSERT INTO auth_refresh_tokens (id, user_id, session_id, token_hash, device, ip, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), userId, sessionId, hashRefreshToken(token), (device || '').slice(0, 200), ip || null,
      nowIso(), new Date(Date.now() + config.refreshTtlSec * 1000).toISOString()]
  );
  return token;
}

function createSession(userId, userAgent, ip) {
  const sessionId = uuid();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + config.tokenTtlSec * 1000).toISOString();
  run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sessionId, userId, now, expiresAt, (userAgent || '').slice(0, 256), ip || null, now]
  );
  const token = signToken({ sub: userId, sid: sessionId });
  const refreshToken = issueRefreshToken({ userId, sessionId, device: userAgent, ip });
  return { token, refreshToken, sessionId, expiresAt };
}

function recordAttempt({ phone, ip, userAgent, success, reason }) {
  run(
    'INSERT INTO login_attempts (id, phone, ip, user_agent, success, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuid(), phone || null, ip || null, (userAgent || '').slice(0, 200), success ? 1 : 0, reason || null, nowIso()]
  );
}

/**
 * Only *password* failures count towards the lockout. A failed second factor has
 * its own per-challenge cap (and is audited) — counting it here would let anyone
 * who knows the password lock the owner out of their own account.
 */
const PASSWORD_FAILURE_FILTER = "success = 0 AND (reason IS NULL OR reason NOT LIKE 'mfa%')";

function recentFailureCount(phone) {
  const since = new Date(Date.now() - config.security.loginAttemptWindowMinutes * 60 * 1000).toISOString();
  return get(
    `SELECT COUNT(*) AS c FROM login_attempts WHERE phone = ? AND ${PASSWORD_FAILURE_FILTER} AND created_at >= ?`,
    [phone, since]
  ).c;
}

function retryAfterSeconds(phone) {
  const since = new Date(Date.now() - config.security.loginAttemptWindowMinutes * 60 * 1000).toISOString();
  const first = get(
    `SELECT created_at FROM login_attempts WHERE phone = ? AND ${PASSWORD_FAILURE_FILTER} AND created_at >= ?
     ORDER BY created_at ASC LIMIT 1`,
    [phone, since]
  );
  if (!first) return config.security.loginLockMinutes * 60;
  const unlockAt = new Date(first.created_at).getTime() + config.security.loginLockMinutes * 60 * 1000;
  return Math.max(30, Math.ceil((unlockAt - Date.now()) / 1000));
}

function register(input, meta = {}) {
  const data = validate({ ...input, phone: normalizePhone(input && input.phone) })
    .phone('phone')
    .string('full_name', { min: 3, max: 80 })
    .string('password', { min: 8, max: 128 })
    .string('email', { required: false, max: 120, default: null })
    .done();
  assertPasswordStrength(data.password, {
    personal: [data.phone, data.full_name, (data.email || '').split('@')[0]]
  });
  const existing = get('SELECT id FROM users WHERE phone = ?', [data.phone]);
  if (existing) {
    throw ApiError.conflict('با این شماره موبایل قبلاً حسابی ساخته شده است.');
  }
  if (data.email && get('SELECT id FROM users WHERE email = ?', [data.email])) {
    throw ApiError.conflict('این ایمیل قبلاً برای حساب دیگری ثبت شده است.');
  }
  const { passwordHash, passwordSalt } = hashPassword(data.password);
  const now = nowIso();
  const id = uuid();
  const baseUsername = `cm${data.phone.replace(/\D/g, '').replace(/^0/, '')}`;
  let username = baseUsername;
  let suffix = 1;
  while (get('SELECT 1 AS x FROM users WHERE username = ?', [username])) {
    username = `${baseUsername}${suffix}`;
    suffix += 1;
  }
  tx(() => {
    run(
      'INSERT INTO users (id, phone, email, full_name, username, password_hash, password_salt, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, data.phone, data.email, data.full_name, username, passwordHash, passwordSalt, 'customer', 'active', now, now]
    );
    run(
      'INSERT INTO password_history (id, user_id, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
      [uuid(), id, passwordHash, passwordSalt, now]
    );
    notify(id, 'welcome', 'به CENTRAL MINE خوش آمدید', 'حساب شما ساخته شد. اکنون می‌توانید خرید یا ثبت درخواست خدمت کنید.', '/');
  });
  const session = createSession(id, meta.userAgent || input.user_agent, meta.ip);
  recordAttempt({ phone: data.phone, ip: meta.ip, userAgent: meta.userAgent, success: true, reason: 'register' });
  return { user: publicUser(get('SELECT * FROM users WHERE id = ?', [id])), ...session };
}

function login(input, meta = {}) {
  const data = validate({ ...input, phone: normalizePhone(input && input.phone) })
    .phone('phone')
    .string('password', { min: 1, max: 128 })
    .done();

  const failures = recentFailureCount(data.phone);
  if (failures >= config.security.loginMaxFailures) {
    const retry = retryAfterSeconds(data.phone);
    const err = ApiError.rateLimited(
      `حساب به‌دلیل تلاش‌های ناموفق موقتاً قفل شده است؛ ${Math.ceil(retry / 60)} دقیقه دیگر تلاش کنید.`
    );
    err.retryAfter = retry;
    throw err;
  }

  const user = get('SELECT * FROM users WHERE phone = ?', [data.phone]);
  // Constant-ish work + generic error: do not reveal whether the account exists.
  const ok = user
    ? verifyPassword(data.password, user.password_hash, user.password_salt)
    : dummyVerify(data.password);

  if (!ok || !user || user.status !== 'active') {
    recordAttempt({
      phone: data.phone, ip: meta.ip, userAgent: meta.userAgent,
      success: false, reason: !user ? 'unknown_account' : (user.status !== 'active' ? 'suspended' : 'bad_password')
    });
    if (failures + 1 === config.security.loginMaxFailures) {
      audit(user ? user.id : null, user ? user.role : 'anonymous', 'auth.lockout', 'user', user ? user.id : null,
        { phone: data.phone, failures: failures + 1 });
    }
    throw ApiError.unauthorized(GENERIC_LOGIN_ERROR);
  }

  // Transparent upgrade of legacy/weak hashes right after a successful password check.
  if (needsRehash(user.password_hash)) {
    const upgraded = hashPassword(data.password);
    run('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?',
      [upgraded.passwordHash, upgraded.passwordSalt, nowIso(), user.id]);
    audit(user.id, user.role, 'auth.password_rehash', 'user', user.id, {});
  }

  // Second factor: the password alone must not create a session.
  if (mfa.needsChallenge(user)) {
    // Not a failed password: no row in login_attempts, the challenge carries the state.
    return { user: { id: user.id, phone: user.phone }, ...mfa.createChallenge(user, meta) };
  }
  // Privileged roles that have not enrolled yet are nudged (and flagged in the security center).
  recordAttempt({ phone: data.phone, ip: meta.ip, userAgent: meta.userAgent, success: true });
  return completeLogin(user, meta, 'auth.login');
}

/** Issues the real session + refresh token once every factor has passed. */
function completeLogin(user, meta = {}, action = 'auth.login') {
  const session = createSession(user.id, meta.userAgent, meta.ip);
  audit(user.id, user.role, action, 'user', user.id, { ip: meta.ip || null });
  const fresh = get('SELECT * FROM users WHERE id = ?', [user.id]) || user;
  return {
    user: publicUser(fresh),
    ...session,
    mfa: {
      enabled: Boolean(mfa.status(user.id).enabled),
      recommended: mfa.enforcedRoles().includes(fresh.role) && !mfa.status(user.id).enabled
    }
  };
}

/** Rotating refresh: the presented token is revoked and replaced atomically. */
function refresh(input, meta = {}) {
  const data = validate(input)
    .string('refresh_token', { min: 20, max: 200 })
    .done();
  const hash = hashRefreshToken(data.refresh_token);
  const row = get('SELECT * FROM auth_refresh_tokens WHERE token_hash = ?', [hash]);
  const invalid = ApiError.unauthorized('نشست منقضی شده است؛ دوباره وارد شوید.');
  if (!row || row.revoked_at || row.expires_at <= nowIso()) throw invalid;

  const session = get('SELECT * FROM sessions WHERE id = ?', [row.session_id]);
  if (!session || session.revoked_at || session.expires_at <= nowIso()) throw invalid;
  const user = get('SELECT * FROM users WHERE id = ?', [row.user_id]);
  if (!user || user.status !== 'active') throw invalid;

  const result = tx(() => {
    const newRefresh = generateRefreshToken();
    const newId = uuid();
    run('UPDATE auth_refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ? AND revoked_at IS NULL',
      [nowIso(), newId, row.id]);
    run(
      `INSERT INTO auth_refresh_tokens (id, user_id, session_id, token_hash, device, ip, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, row.user_id, row.session_id, hashRefreshToken(newRefresh), row.device, meta.ip || row.ip,
        nowIso(), new Date(Date.now() + config.refreshTtlSec * 1000).toISOString()]
    );
    run('UPDATE sessions SET expires_at = ?, last_used_at = ? WHERE id = ?',
      [new Date(Date.now() + config.tokenTtlSec * 1000).toISOString(), nowIso(), row.session_id]);
    const token = signToken({ sub: row.user_id, sid: row.session_id });
    return { token, refreshToken: newRefresh, sessionId: row.session_id };
  });
  audit(user.id, user.role, 'auth.refresh', 'session', row.session_id, { ip: meta.ip || null });
  return { user: publicUser(user), ...result, expiresAt: new Date(Date.now() + config.tokenTtlSec * 1000).toISOString() };
}

async function requestOtp(input, meta = {}) {
  const data = validate({ ...input, phone: normalizePhone(input && input.phone) }).phone('phone').done();
  const now = Date.now();
  const recent = get(
    'SELECT created_at FROM otp_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
    [data.phone]
  );
  if (recent && now - new Date(recent.created_at).getTime() < config.otpResendCooldownSec * 1000) {
    throw ApiError.rateLimited('کمی صبر کنید سپس دوباره درخواست کد بدهید.');
  }
  const user = get('SELECT status FROM users WHERE phone = ?', [data.phone]);
  if (user && user.status !== 'active') {
    throw ApiError.forbidden('این حساب غیرفعال است؛ با پشتیبانی تماس بگیرید.');
  }
  const code = randomOtpCode();
  run(
    'INSERT INTO otp_codes (id, phone, code_hash, expires_at, attempts, consumed_at, created_at) VALUES (?, ?, ?, ?, 0, NULL, ?)',
    [uuid(), data.phone, hashOtp(code), new Date(now + config.otpTtlSec * 1000).toISOString(), new Date(now).toISOString()]
  );
  // Deliver the code. A provider failure must not tell the caller whether the
  // phone belongs to an account, so the response shape stays identical; the
  // failure is audited and logged instead.
  const channel = await deliverOtp(data.phone, code);
  audit(null, 'anonymous', 'auth.otp_requested', 'phone', null, {
    phone: data.phone,
    ip: meta.ip || null,
    channel: channel.mode,
    delivered: channel.delivered
  });
  const result = { ok: true, channel: channel.mode, ttl_seconds: config.otpTtlSec };
  // The code only ever comes back when nothing was actually sent (pure sandbox)
  // and never in production. Tying this to the real delivery channel instead of
  // a flag means a live SMS provider can never leak the code by misconfiguration.
  if (channel.mode === 'sandbox' && config.otpSandbox && !config.isProd) {
    result.dev_code = code;
  }
  return result;
}

/**
 * Sends a login code through the configured provider, or reports 'sandbox'
 * when none is configured. Never throws: a dead SMS route should surface as a
 * delivered:false in the audit trail, not as a 500 that hints the number
 * exists.
 */
async function deliverOtp(phone, code) {
  const provider = providers.smsProvider();
  if (!provider) return { mode: 'sandbox', delivered: false };
  try {
    const out = await provider.send({ phone, code, template: process.env.CM_SMS_TEMPLATE_ID || null });
    return { mode: out.provider || provider.key, delivered: Boolean(out.ok) };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', message: 'otp delivery failed', provider: provider.key, error: String(err.message).slice(0, 200) }));
    return { mode: provider.key, delivered: false };
  }
}

function verifyOtp(input, meta = {}) {
  const data = validate({
    ...input,
    phone: normalizePhone(input && input.phone),
    code: typeof (input && input.code) === 'string'
      ? input.code.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      : input && input.code
  })
    .phone('phone')
    .string('code', { min: 6, max: 6, pattern: /^\d{6}$/, patternMessage: 'کد باید ۶ رقم باشد.' })
    .done();
  const row = get(
    `SELECT * FROM otp_codes
      WHERE phone = ? AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [data.phone]
  );
  const genericError = ApiError.unauthorized(GENERIC_OTP_ERROR);
  if (!row) throw genericError;
  if (row.expires_at <= nowIso()) throw genericError;
  if (row.attempts >= config.otpMaxAttempts) throw genericError;
  run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
  if (row.code_hash !== hashOtp(data.code)) throw genericError;
  run('UPDATE otp_codes SET consumed_at = ? WHERE id = ?', [nowIso(), row.id]);
  const user = get('SELECT * FROM users WHERE phone = ?', [data.phone]);
  if (!user || user.status !== 'active') throw genericError;
  const session = createSession(user.id, meta.userAgent || input.user_agent, meta.ip);
  audit(user.id, user.role, 'auth.login_otp', 'user', user.id, { ip: meta.ip || null });
  return { user: publicUser(user), ...session };
}

function logout(sessionId, userId) {
  if (sessionId) {
    tx(() => {
      run('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL',
        [nowIso(), 'logout', sessionId]);
      run('UPDATE auth_refresh_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL',
        [nowIso(), sessionId]);
    });
    if (userId) audit(userId, null, 'auth.logout', 'session', sessionId, {});
  }
  return { ok: true };
}

/** Revokes every session of the current user except the current one. */
function logoutAll(userId, keepSessionId) {
  const res = tx(() => {
    const out = run(
      'UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
      [nowIso(), 'logout_all', userId, keepSessionId || '']
    );
    run(
      `UPDATE auth_refresh_tokens SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND session_id != ?`,
      [nowIso(), userId, keepSessionId || '']
    );
    return out;
  });
  audit(userId, null, 'auth.logout_all', 'user', userId, { revoked_sessions: res.changes });
  return { ok: true, revoked_sessions: res.changes };
}

function me(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw ApiError.notFound('کاربر یافت نشد.');
  return publicUser(user);
}

/** Active devices/sessions of the current account (never exposes tokens). */
function listSessions(userId, currentSessionId) {
  const items = all(
    `SELECT id, created_at, expires_at, last_used_at, user_agent, ip, revoked_at, revoked_reason
       FROM sessions WHERE user_id = ? ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT 50`,
    [userId]
  ).map((s) => ({
    id: s.id,
    current: s.id === currentSessionId,
    created_at: s.created_at,
    last_used_at: s.last_used_at,
    expires_at: s.expires_at,
    revoked: Boolean(s.revoked_at),
    revoked_reason: s.revoked_reason || null,
    user_agent: s.user_agent || null,
    ip: s.ip || null
  }));
  return { items };
}

function revokeSession(userId, sessionId, currentSessionId) {
  const row = get('SELECT id FROM sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
  if (!row) throw ApiError.notFound('نشست یافت نشد.');
  if (sessionId === currentSessionId) {
    throw ApiError.conflict('برای بستن نشست فعلی از «خروج» استفاده کنید.');
  }
  tx(() => {
    run('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL',
      [nowIso(), 'user_revoked', sessionId]);
    run('UPDATE auth_refresh_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL',
      [nowIso(), sessionId]);
  });
  audit(userId, null, 'auth.session_revoked', 'session', sessionId, {});
  return { ok: true };
}

function isPasswordReused(userId, password) {
  const depth = config.security.passwordHistoryDepth;
  const rows = all(
    'SELECT password_hash, password_salt FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, depth]
  );
  return rows.some((r) => verifyPassword(password, r.password_hash, r.password_salt));
}

function changePassword(userId, sessionId, input) {
  const data = validate(input)
    .string('old_password', { min: 1, max: 128 })
    .string('new_password', { min: 8, max: 128 })
    .done();
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!verifyPassword(data.old_password, user.password_hash, user.password_salt)) {
    recordAttempt({ phone: user.phone, success: false, reason: 'bad_old_password_in_change' });
    throw ApiError.unauthorized('رمز عبور فعلی نادرست است.');
  }
  assertPasswordStrength(data.new_password, {
    personal: [user.phone, user.full_name, (user.email || '').split('@')[0]]
  });
  if (isPasswordReused(userId, data.new_password)) {
    throw ApiError.validation('این رمز قبلاً استفاده شده است؛ رمز تازه‌ای انتخاب کنید.', [
      { field: 'new_password', message: `تکرار ${config.security.passwordHistoryDepth} رمز اخیر مجاز نیست.` }
    ]);
  }
  const { passwordHash, passwordSalt } = hashPassword(data.new_password);
  tx(() => {
    run('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?',
      [passwordHash, passwordSalt, nowIso(), userId]);
    run('INSERT INTO password_history (id, user_id, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
      [uuid(), userId, passwordHash, passwordSalt, nowIso()]);
    // Revoke all other sessions after password change (current session stays valid).
    run('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
      [nowIso(), 'password_change', userId, sessionId || '']);
    run('UPDATE auth_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND session_id != ? AND revoked_at IS NULL',
      [nowIso(), userId, sessionId || '']);
    audit(userId, user.role, 'auth.change_password', 'user', userId, {});
  });
  return { ok: true, message: 'رمز عبور تغییر کرد و نشست‌های دیگر بسته شدند.' };
}

/** Verifies a password for step-up authentication and returns a short-lived proof. */
function verifyIdentity(userId, password, purpose, sessionId) {
  const user = get('SELECT password_hash, password_salt FROM users WHERE id = ?', [userId]);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    recordAttempt({ phone: null, success: false, reason: 'bad_reauth' });
    throw ApiError.unauthorized('رمز عبور نادرست است.');
  }
  const id = uuid();
  const expiresAt = new Date(Date.now() + config.security.sensitiveReauthMinutes * 60 * 1000).toISOString();
  run('INSERT INTO reauth_proofs (id, user_id, session_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, sessionId || null, purpose || 'sensitive', nowIso(), expiresAt]);
  audit(userId, null, 'auth.step_up_verified', 'user', userId, { purpose: purpose || 'sensitive' });
  return { ok: true, proof: id, expires_at: expiresAt, valid_minutes: config.security.sensitiveReauthMinutes };
}

function hasValidProof(userId, proofId, purpose) {
  if (!proofId) return false;
  const row = get(
    'SELECT id FROM reauth_proofs WHERE id = ? AND user_id = ? AND purpose = ? AND expires_at > ?',
    [proofId, userId, purpose || 'sensitive', nowIso()]
  );
  return Boolean(row);
}

function passwordPolicy() {
  return policy();
}

module.exports = {
  completeLogin,
  normalizePhone,
  register, login, refresh, requestOtp, verifyOtp,
  logout, logoutAll, me, listSessions, revokeSession,
  changePassword, verifyIdentity, hasValidProof, passwordPolicy,
  publicUser, recordAttempt, recentFailureCount
};
