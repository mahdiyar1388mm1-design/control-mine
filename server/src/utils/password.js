'use strict';

const crypto = require('crypto');
const { ApiError } = require('./errors');

const KEYLEN = 64;

function hashPassword(password) {
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.scryptSync(password, passwordSalt, KEYLEN).toString('hex');
  return { passwordHash, passwordSalt };
}

function verifyPassword(password, passwordHash, passwordSalt) {
  if (typeof password !== 'string' || !passwordSalt || !passwordHash) return false;
  const candidate = crypto.scryptSync(password, passwordSalt, KEYLEN);
  const expected = Buffer.from(passwordHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function assertPasswordStrength(password) {
  const problems = [];
  if (typeof password !== 'string' || password.length < 8) problems.push({ field: 'password', message: 'رمز عبور باید حداقل ۸ حرف باشد.' });
  else if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) problems.push({ field: 'password', message: 'رمز عبور باید شامل حرف و عدد باشد.' });
  if (problems.length) throw ApiError.validation('رمز عبور قوی نیست.', problems);
}

module.exports = { hashPassword, verifyPassword, assertPasswordStrength };
