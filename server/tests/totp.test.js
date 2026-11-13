'use strict';

/**
 * RFC 6238 conformance for the in-house TOTP implementation.
 * Vectors come from the RFC appendix B (SHA-1 rows), truncated to 6 digits.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../src/utils/totp');

const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_B32 = totp.base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii'));

test('totp: base32 round-trips and rejects invalid alphabet', () => {
  const raw = Buffer.from('12345678901234567890', 'ascii');
  const encoded = totp.base32Encode(raw);
  assert.equal(encoded, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(totp.base32Decode(encoded), raw);
  assert.deepEqual(totp.base32Decode('gezd gnbv'), totp.base32Decode('GEZDGNBV'));
  assert.throws(() => totp.base32Decode('GEZD1NBV'), /invalid base32/);
});

test('totp: matches RFC 6238 SHA-1 test vectors (6 digits)', () => {
  const vectors = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130']
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(totp.generateCode(RFC_SECRET_B32, seconds * 1000), expected, `t=${seconds}`);
  }
});

test('totp: verification honours the drift window and rejects stale codes', () => {
  const now = 1_700_000_000_000;
  const current = totp.generateCode(RFC_SECRET_B32, now);
  const previous = totp.generateCode(RFC_SECRET_B32, now - 30_000);
  const twoStepsBack = totp.generateCode(RFC_SECRET_B32, now - 60_000);

  assert.equal(typeof totp.verifyCode(RFC_SECRET_B32, current, { atMs: now }), 'number');
  assert.notEqual(totp.verifyCode(RFC_SECRET_B32, previous, { atMs: now }), null, 'one step of clock drift is tolerated');
  assert.equal(totp.verifyCode(RFC_SECRET_B32, twoStepsBack, { atMs: now }), null, 'two steps back is refused');
  assert.equal(totp.verifyCode(RFC_SECRET_B32, 'abcdef', { atMs: now }), null);
  assert.equal(totp.verifyCode(RFC_SECRET_B32, '000000', { atMs: now }), null);
});

test('totp: Persian digits are accepted for user input', () => {
  const now = 1_700_000_000_000;
  const code = totp.generateCode(RFC_SECRET_B32, now);
  const persian = code.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  assert.notEqual(totp.verifyCode(RFC_SECRET_B32, persian, { atMs: now }), null);
});

test('totp: secrets are encrypted at rest with authenticated encryption', () => {
  const secret = totp.generateSecret();
  const payload = totp.encryptSecret(secret);
  assert.ok(payload.startsWith('v1:'));
  assert.equal(payload.includes(secret), false);
  assert.equal(totp.decryptSecret(payload), secret);

  // Any flipped byte in the payload fails the GCM tag check.
  const parts = payload.split(':');
  const tampered = [parts[0], parts[1], parts[2], `${parts[3].slice(0, -2)}AA`].join(':');
  assert.throws(() => totp.decryptSecret(tampered));
  assert.throws(() => totp.decryptSecret('v2:aa:bb:cc'), /unsupported/);
});

test('totp: recovery codes are grouped and normalized for comparison', () => {
  const codes = totp.generateRecoveryCodes(4);
  assert.equal(codes.length, 4);
  assert.equal(new Set(codes).size, 4);
  for (const code of codes) assert.match(code, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
  assert.equal(totp.normalizeRecoveryCode(codes[0].toLowerCase()), totp.normalizeRecoveryCode(codes[0]));
  assert.equal(totp.normalizeRecoveryCode(' ab cde-fghij '), 'ABCDEFGHIJ');
});

test('totp: provisioning URI carries issuer, period and secret', () => {
  const secret = totp.generateSecret();
  const uri = totp.otpauthUri({ secret, account: 'cm9120000001' });
  assert.ok(uri.startsWith('otpauth://totp/CENTRAL%20MINE:cm9120000001?'));
  const params = new URLSearchParams(uri.split('?')[1]);
  assert.equal(params.get('secret'), secret);
  assert.equal(params.get('period'), '30');
  assert.equal(params.get('digits'), '6');
  assert.equal(params.get('issuer'), 'CENTRAL MINE');
});
