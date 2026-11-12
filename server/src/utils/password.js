'use strict';

const crypto = require('crypto');
const config = require('../config');
const { ApiError } = require('./errors');

// scrypt cost parameters. N=2^15 keeps ~50–100ms per hash on a small VPS
// while making offline brute force far more expensive than the Node defaults.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

/**
 * Hash format: `scrypt$N$r$p$<hex>` stored in password_hash.
 * Bare 128-char hex hashes (no prefix) are legacy rows created with Node's
 * default scrypt parameters; they keep verifying so deployments can upgrade
 * without locking anyone out, and are re-hashed transparently on next change.
 */
const LEGACY_SCRYPT = { N: 16384, r: 8, p: 1 };

function hashPassword(password) {
  const passwordSalt = crypto.randomBytes(24).toString('hex');
  const digest = crypto.scryptSync(password, passwordSalt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem
  }).toString('hex');
  return { passwordHash: `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${digest}`, passwordSalt };
}

function parseHash(passwordHash) {
  const parts = String(passwordHash).split('$');
  if (parts.length === 5 && parts[0] === 'scrypt') {
    return { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), digest: parts[4], legacy: false };
  }
  return { ...LEGACY_SCRYPT, digest: String(passwordHash), legacy: true };
}

function verifyPassword(password, passwordHash, passwordSalt) {
  if (typeof password !== 'string' || !passwordSalt || !passwordHash) return false;
  const parsed = parseHash(passwordHash);
  if (!Number.isInteger(parsed.N) || parsed.N <= 0 || !/^[0-9a-f]+$/i.test(parsed.digest)) return false;
  let candidate;
  try {
    candidate = crypto.scryptSync(password, passwordSalt, SCRYPT.keylen, {
      N: parsed.N, r: parsed.r || 8, p: parsed.p || 1, maxmem: SCRYPT.maxmem
    });
  } catch {
    return false;
  }
  const expected = Buffer.from(parsed.digest, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/** True when a stored hash still uses the old (weaker) work factor. */
function needsRehash(passwordHash) {
  const parsed = parseHash(passwordHash);
  return parsed.legacy || parsed.N < SCRYPT.N;
}

/**
 * Constant-time dummy verification used when an account does not exist, so that
 * login timing does not reveal whether a phone number is registered.
 */
function dummyVerify(password) {
  try {
    crypto.scryptSync(String(password || ''), '0'.repeat(48), SCRYPT.keylen, {
      N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem
    });
  } catch { /* ignore */ }
  return false;
}

function policy() {
  return {
    min_length: config.security.passwordMinLength,
    require_upper: true,
    require_lower: true,
    require_digit: true,
    require_symbol: true,
    forbid_common: true,
    forbid_personal: true,
    history_depth: config.security.passwordHistoryDepth
  };
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'admin123', 'admin1234', 'welcome1', 'iloveyou',
  'letmein1', 'centralmine', 'central123', 'mine1234', 'iran1234', 'test1234',
  'passw0rd', 'p@ssw0rd', 'abcd1234', 'a1b2c3d4', '11111111', '00000000'
]);

/**
 * Password policy for every new/changed password.
 * `personal` may contain full name / phone / email fragments to make sure the
 * password is not a trivial derivative of the account owner's identity.
 */
function assertPasswordStrength(password, { personal = [] } = {}) {
  const problems = [];
  const policyCfg = policy();
  if (typeof password !== 'string' || password.length < policyCfg.min_length) {
    problems.push({ field: 'password', message: `رمز عبور باید حداقل ${policyCfg.min_length} نویسه باشد.` });
  } else {
    if (!/[a-z]/.test(password)) problems.push({ field: 'password', message: 'رمز عبور باید حداقل یک حرف کوچک لاتین داشته باشد.' });
    if (!/[A-Z]/.test(password)) problems.push({ field: 'password', message: 'رمز عبور باید حداقل یک حرف بزرگ لاتین داشته باشد.' });
    if (!/\d/.test(password)) problems.push({ field: 'password', message: 'رمز عبور باید حداقل یک رقم داشته باشد.' });
    if (!/[^A-Za-z0-9]/.test(password)) problems.push({ field: 'password', message: 'رمز عبور باید حداقل یک نشانهٔ ویژه (مانند !@#$) داشته باشد.' });
    if (/(.)\1{3,}/.test(password)) problems.push({ field: 'password', message: 'تکرار پشت‌سرهم یک نویسه مجاز نیست.' });
    if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwerty|asdf)/i.test(password)) {
      problems.push({ field: 'password', message: 'دنباله‌های ساده مانند 1234 یا qwerty مجاز نیست.' });
    }
  }
  if (typeof password === 'string' && COMMON_PASSWORDS.has(password.toLowerCase())) {
    problems.push({ field: 'password', message: 'این رمز عبور بسیار رایج است؛ رمز دیگری انتخاب کنید.' });
  }
  if (typeof password === 'string' && password) {
    const lowered = password.toLowerCase();
    for (const raw of personal) {
      const token = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (token.length >= 4 && lowered.replace(/[^a-z0-9]/g, '').includes(token)) {
        problems.push({ field: 'password', message: 'رمز عبور نباید شامل نام، شماره یا ایمیل حساب باشد.' });
        break;
      }
    }
  }
  if (problems.length) throw ApiError.validation('رمز عبور به‌اندازهٔ کافی قوی نیست.', problems);
}

/** Rough entropy score for the UI meter (0–100). Never used for enforcement. */
function passwordScore(password) {
  if (typeof password !== 'string' || !password) return 0;
  let score = Math.min(40, password.length * 3);
  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 12;
  if (/\d/.test(password)) score += 10;
  if (/[^A-Za-z0-9]/.test(password)) score += 14;
  if (new Set(password).size >= password.length * 0.7) score += 8;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) score = Math.min(score, 15);
  return Math.max(0, Math.min(100, score));
}

module.exports = {
  hashPassword, verifyPassword, dummyVerify, needsRehash,
  assertPasswordStrength, passwordScore, policy, COMMON_PASSWORDS
};
