'use strict';

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30s step) + RFC 4648 base32.
 * Implemented on node:crypto only — no third-party dependency, no secret ever
 * leaves the process unencrypted.
 */
const crypto = require('crypto');
const config = require('../config');

const DIGITS = 6;
const STEP_SECONDS = 30;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % (10 ** DIGITS)).padStart(DIGITS, '0');
}

/** Current TOTP code for a base32 secret (used by tests and provisioning). */
function generateCode(base32Secret, atMs = Date.now()) {
  return hotp(base32Decode(base32Secret), Math.floor(atMs / 1000 / STEP_SECONDS));
}

/**
 * Verifies a submitted code with a +/-1 step drift window.
 * Returns the matched step (so callers can prevent replay) or null.
 */
function verifyCode(base32Secret, submitted, { atMs = Date.now(), window = 1 } = {}) {
  if (typeof submitted !== 'string') return null;
  const code = submitted.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '');
  if (code.length !== DIGITS) return null;
  let secretBuf;
  try { secretBuf = base32Decode(base32Secret); } catch { return null; }
  const current = Math.floor(atMs / 1000 / STEP_SECONDS);
  for (let drift = -window; drift <= window; drift += 1) {
    const step = current + drift;
    if (step < 0) continue;
    const expected = hotp(secretBuf, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function otpauthUri({ secret, account, issuer = 'CENTRAL MINE' }) {
  // Keep the issuer/account separator literal; authenticator apps expect it.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Secret-at-rest protection (AES-256-GCM keyed from the app secret)
// ---------------------------------------------------------------------------

const encKey = crypto.createHash('sha256').update(`mfa-secret:${config.secret}`).digest();

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${enc.toString('base64url')}`;
}

function decryptSecret(payload) {
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('unsupported mfa secret format');
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const data = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Recovery codes: human-friendly groups, stored only as SHA-256 hashes. */
function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  DIGITS, STEP_SECONDS, base32Encode, base32Decode, generateCode, verifyCode,
  generateSecret, otpauthUri, encryptSecret, decryptSecret, generateRecoveryCodes, normalizeRecoveryCode
};
