'use strict';

const crypto = require('crypto');
const config = require('../config');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload, ttlSec = config.tokenTtlSec) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
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
  return payload;
}

function hashOtp(code) {
  return crypto.createHmac('sha256', config.secret).update(`otp:${code}`).digest('hex');
}

function randomOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

module.exports = { signToken, verifyToken, hashOtp, randomOtpCode };
