'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate test environment BEFORE loading config/db
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-unit-'));
process.env.CM_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CM_STORAGE_DIR = path.join(tmpRoot, 'storage');
process.env.CM_SECRET = 'unit-test-secret-key-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';

const { hashPassword, verifyPassword, assertPasswordStrength } = require('../src/utils/password');
const { signToken, verifyToken, hashOtp } = require('../src/utils/token');
const { validate } = require('../src/utils/validate');
const { maskPhone } = require('../src/modules/platform/service');
const { migrate, rollback } = require('../src/db/migrate');
const { createBackup, restoreEncryptedBackup } = require('../src/db/backup');
const { get, run, close } = require('../src/db');

test.after(() => {
  close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('unit: password hashing, verification, and strength rules', () => {
  assert.throws(() => assertPasswordStrength('short'), /رمز/);
  const { passwordHash, passwordSalt } = hashPassword('StrongPass123!');
  assert.equal(verifyPassword('StrongPass123!', passwordHash, passwordSalt), true);
  assert.equal(verifyPassword('WrongPass123!', passwordHash, passwordSalt), false);
});

test('unit: HMAC session token signing & tamper rejection', () => {
  const tok = signToken({ sub: 'user-1', sid: 'sess-1' }, 60);
  const decoded = verifyToken(tok);
  assert.equal(decoded.sub, 'user-1');
  assert.equal(decoded.sid, 'sess-1');

  const tampered = `${tok.slice(0, -2)}aa`;
  assert.equal(verifyToken(tampered), null);

  const expired = signToken({ sub: 'user-1', sid: 'sess-1' }, -10);
  assert.equal(verifyToken(expired), null);

  assert.notEqual(hashOtp('123456'), '123456');
});

test('unit: validator integer precision & Iranian phone validation (never float money)', () => {
  assert.throws(() => {
    validate({ price: 12500.5 }).int('price', { min: 0 }).done();
  });
  assert.throws(() => {
    validate({ phone: '08121234567' }).phone('phone').done();
  });
  const ok = validate({ phone: '09123456789', amount: '490000' })
    .phone('phone')
    .int('amount', { min: 0 })
    .done();
  assert.equal(ok.amount, 490000);
  assert.equal(maskPhone('09123456789'), '0912*****89');
});

test('unit: scenario #20 — versioned migration, rollback, and AES-256-GCM encrypted backup/restore', () => {
  migrate();
  const ver = get('SELECT version FROM schema_migrations WHERE version = ?', ['001_init']);
  assert.equal(ver.version, '001_init');

  run("INSERT INTO settings (key, value) VALUES ('canary_key', '\"ok\"')");

  // Create encrypted backup before simulated faulty release
  const pass = 'BackupTestPassphrase#2026';
  const bkp = createBackup({ destDir: path.join(tmpRoot, 'backups'), encryptionPassphrase: pass });
  assert.equal(bkp.encrypted, true);
  assert.ok(bkp.path.endsWith('.enc'));

  // Rollback migration 001_init and re-apply cleanly
  const rolled = rollback(1);
  assert.deepEqual(rolled, ['001_init']);
  const tablesAfterDown = get("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='orders'").c;
  assert.equal(tablesAfterDown, 0);

  // Re-migrate and verify clean schema
  migrate();
  assert.equal(get("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='orders'").c, 1);

  // Verify encrypted backup restores canary row into a separate DB file
  const restoredDbFile = path.join(tmpRoot, 'restored.db');
  const restored = restoreEncryptedBackup(bkp.path, restoredDbFile, pass);
  assert.ok(restored.size_bytes > 0);
  const { DatabaseSync } = require('node:sqlite');
  const checkDb = new DatabaseSync(restoredDbFile);
  const canary = checkDb.prepare("SELECT value FROM settings WHERE key = 'canary_key'").get();
  assert.equal(canary.value, '"ok"');
  checkDb.close();
});
