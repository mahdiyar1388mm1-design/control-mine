'use strict';

const { get, run, tx } = require('../../db');
const { ApiError } = require('../../utils/errors');
const config = require('../../config');
const { hashPassword, verifyPassword, assertPasswordStrength } = require('../../utils/password');
const { signToken, hashOtp, randomOtpCode } = require('../../utils/token');
const { uuid, nowIso, validate, sha256 } = require('../../utils/validate');
const { notify, audit } = require('../platform/service');

const GENERIC_LOGIN_ERROR = 'شماره موبایل یا رمز عبور نادرست است.';
const GENERIC_OTP_ERROR = 'کد نادرست یا منقضی است.';

function publicUser(row) {
  return {
    id: row.id,
    phone: row.phone,
    full_name: row.full_name,
    email: row.email || null,
    role: row.role,
    status: row.status,
    created_at: row.created_at
  };
}

function createSession(userId, userAgent) {
  const sessionId = uuid();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + config.tokenTtlSec * 1000).toISOString();
  run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    [sessionId, userId, now, expiresAt, (userAgent || '').slice(0, 256)]
  );
  const token = signToken({ sub: userId, sid: sessionId });
  return { token, sessionId, expiresAt };
}

function register(input) {
  const data = validate(input)
    .phone('phone')
    .string('full_name', { min: 3, max: 80 })
    .string('password', { min: 8, max: 128 })
    .string('email', { required: false, max: 120, default: null })
    .done();
  assertPasswordStrength(data.password);
  const existing = get('SELECT id FROM users WHERE phone = ?', [data.phone]);
  if (existing) {
    throw ApiError.conflict('با این شماره موبایل قبلاً حسابی ساخته شده است.');
  }
  const { passwordHash, passwordSalt } = hashPassword(data.password);
  const now = nowIso();
  const id = uuid();
  run(
    'INSERT INTO users (id, phone, email, full_name, password_hash, password_salt, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.phone, data.email, data.full_name, passwordHash, passwordSalt, 'customer', 'active', now, now]
  );
  notify(id, 'welcome', 'به CENTRAL MINE خوش آمدید', 'حساب شما ساخته شد. اکنون می‌توانید خرید یا ثبت درخواست خدمت کنید.', '/');
  const session = createSession(id, input.user_agent);
  return { user: publicUser(get('SELECT * FROM users WHERE id = ?', [id])), ...session };
}

function login(input) {
  const data = validate(input)
    .phone('phone')
    .string('password', { min: 1, max: 128 })
    .done();
  const user = get('SELECT * FROM users WHERE phone = ?', [data.phone]);
  // Constant-ish work + generic error: do not reveal whether the account exists.
  const ok = user
    ? verifyPassword(data.password, user.password_hash, user.password_salt)
    : verifyPassword(data.password, 'x'.repeat(64), '0'.repeat(32));
  if (!ok || !user || user.status !== 'active') {
    throw ApiError.unauthorized(GENERIC_LOGIN_ERROR);
  }
  const session = createSession(user.id, input.user_agent);
  return { user: publicUser(user), ...session };
}

function requestOtp(input) {
  const data = validate(input).phone('phone').done();
  const now = Date.now();
  const recent = get(
    'SELECT created_at FROM otp_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
    [data.phone]
  );
  if (recent && now - new Date(recent.created_at).getTime() < config.otpResendCooldownSec * 1000) {
    throw ApiError.rateLimited('کمی صبر کنید سپس دوباره درخواست کد بدهید.');
  }
  const code = randomOtpCode();
  run(
    'INSERT INTO otp_codes (id, phone, code_hash, expires_at, attempts, consumed_at, created_at) VALUES (?, ?, ?, ?, 0, NULL, ?)',
    [uuid(), data.phone, hashOtp(code), new Date(now + config.otpTtlSec * 1000).toISOString(), new Date(now).toISOString()]
  );
  // NOTE: no real SMS provider is connected in v1. Sandbox channel only.
  const result = { ok: true, channel: 'sandbox', ttl_seconds: config.otpTtlSec };
  if (config.otpSandbox && !config.isProd) {
    result.dev_code = code;
  }
  return result;
}

function verifyOtp(input) {
  const data = validate(input)
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
  const session = createSession(user.id, input.user_agent);
  return { user: publicUser(user), ...session };
}

function logout(sessionId) {
  if (sessionId) {
    run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [nowIso(), sessionId]);
  }
  return { ok: true };
}

function me(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw ApiError.notFound('کاربر یافت نشد.');
  return publicUser(user);
}

function changePassword(userId, sessionId, input) {
  const data = validate(input)
    .string('old_password', { min: 1, max: 128 })
    .string('new_password', { min: 8, max: 128 })
    .done();
  assertPasswordStrength(data.new_password);
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!verifyPassword(data.old_password, user.password_hash, user.password_salt)) {
    throw ApiError.unauthorized('رمز عبور فعلی نادرست است.');
  }
  const { passwordHash, passwordSalt } = hashPassword(data.new_password);
  tx(() => {
    run('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?',
      [passwordHash, passwordSalt, nowIso(), userId]);
    // Revoke all other sessions after password change.
    run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
      [nowIso(), userId, sessionId]);
    audit(userId, 'customer', 'auth.change_password', 'user', userId, {});
  });
  return { ok: true, message: 'رمز عبور تغییر کرد و نشست‌های دیگر بسته شدند.' };
}

module.exports = { register, login, requestOtp, verifyOtp, logout, me, changePassword, publicUser };
