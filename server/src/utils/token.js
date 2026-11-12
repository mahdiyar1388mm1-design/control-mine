'use strict';

const crypto = require('crypto');
const config = require('../config');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Session access token (HMAC-SHA256 JWT). The `jti` claim is unique per token and
 * `ver` distinguishes auth generations so a password change invalidates every
 * previously issued token for that account.
 */
function signToken(payload, ttlSec = config.tokenTtlSec) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, jti: crypto.randomUUID(), iat: now, exp: now + ttlSec }));
  const signature = crypto
    .createHmac('sha256', config.secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  // Reject anything that is not the exact algorithm we issue (alg confusion).
  let headerObj;
  try {
    headerObj = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!headerObj || headerObj.alg !== 'HS256' || headerObj.typ !== 'JWT') return null;

  const expected = crypto
    .createHmac('sha256', config.secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload || !payload.exp || payload.exp < now) return null;
  if (!payload.sub || !payload.sid) return null;
  return payload;
}

function hashOtp(code) {
  return crypto.createHmac('sha256', config.secret).update(`otp:${code}`).digest('hex');
}

function randomOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/** Refresh tokens are opaque random strings; only their SHA-256 hash is stored. */
function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Double-submit CSRF token. */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  signToken, verifyToken, hashOtp, randomOtpCode,
  generateRefreshToken, hashRefreshToken, generateCsrfToken, timingSafeEqualStrings
};
