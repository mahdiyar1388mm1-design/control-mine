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

const { hashPassword, verifyPassword, assertPasswordStrength, passwordScore } = require('../src/utils/password');
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
  // Policy: length + upper + lower + digit + symbol, no sequences, no personal data.
  assert.throws(() => assertPasswordStrength('alllowercase123!'), /رمز/);
  assert.throws(() => assertPasswordStrength('ALLUPPERCASE123!'), /رمز/);
  assert.throws(() => assertPasswordStrength('NoDigitsHere!!'), /رمز/);
  assert.throws(() => assertPasswordStrength('NoSymbols12345'), /رمز/);
  assert.throws(() => assertPasswordStrength('StrongPass1234'), /رمز/);
  assert.throws(() => assertPasswordStrength('Qwerty1234!'), /رمز/);
  assert.throws(() => assertPasswordStrength('SaraPass1234!', { personal: ['sara.ahmadi'] }), /رمز/);
  assert.doesNotThrow(() => assertPasswordStrength('StrongPass123!'));
  assert.ok(passwordScore('StrongPass123!') > passwordScore('password'));
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

  // Rollback all migrations (011..001) and re-apply cleanly
  const rolled = rollback(11);
  assert.deepEqual(rolled, [
    '011_brand_logos',
    '010_two_factor_authentication',
    '009_query_performance', '008_security_and_integrity',
    '007_admin_console', '006_shipping_profile', '005_db_integrity',
    '004_address_recipient_email', '003_lth_treasury_protocol', '002_lth_wallet', '001_init'
  ]);
  const tablesAfterDown = get("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name IN ('orders','lth_wallets','lth_treasury_config','user_addresses')").c;
  assert.equal(tablesAfterDown, 0);

  // Re-migrate and verify clean schema
  migrate();
  assert.equal(get("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='orders'").c, 1);
  assert.equal(get("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='lth_wallets'").c, 1);
  assert.equal(get("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='lth_treasury_config'").c, 1);

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

test('unit: LTH exact BigInt calculation engine (0.000000000001 LTH = 0.00484 IRR, 1.00 LTH 24h = 16,456,000 IRR, zero float drift)', () => {
  const lthMath = require('../src/modules/lth/math');
  const defaultSettings = {
    price_irr: '4840000000',
    reward_per_min_unit_atoms: '340000', // 0.000000000034 LTH per 0.00000001 LTH
    stake_bps: 7000,
    withdrawable_bps: 3000,
    lockup_days: 3285
  };

  // 1) Micro-unit: 0.000000000001 LTH === 0.00484 IRR (exact bidirectional)
  const picoRes = lthMath.calculateAllMetrics({ mode: 'lth', value: '0.000000000001', settings: defaultSettings });
  assert.equal(picoRes.input_summary.irr_exact, '0.00484');
  const reversePico = lthMath.calculateAllMetrics({ mode: 'irr', value: '0.00484', settings: defaultSettings });
  assert.equal(reversePico.input_summary.lth_exact, '0.000000000001');

  // 2) Smallest token unit: 0.00000001 LTH -> 24h reward = 0.000000000034 LTH
  const minUnitRes = lthMath.calculateAllMetrics({ mode: 'lth', value: '0.00000001', settings: defaultSettings });
  assert.equal(minUnitRes.metrics_24h.total_reward_lth_exact, '0.000000000034');

  // 3) 1.00 LTH -> 24h reward = 0.0034 LTH = 16,456,000 IRR (1,645,600 Toman)
  const oneLthRes = lthMath.calculateAllMetrics({ mode: 'lth', value: '1', settings: defaultSettings });
  assert.equal(oneLthRes.metrics_24h.total_reward_lth_exact, '0.0034');
  assert.equal(oneLthRes.metrics_24h.total_reward_irr_exact, '16456000');
  assert.equal(oneLthRes.metrics_24h.total_reward_toman_exact, '1645600');

  // 4) Regulator split conservation for 71% / 29% on smallest unit
  const split71 = lthMath.computeDailyRewardSplit(lthMath.MIN_TOKEN_UNIT_ATOMS, '340000', 7100);
  assert.equal(split71.stakedAtoms + split71.withdrawableAtoms, split71.totalRewardAtoms);
  assert.equal(lthMath.formatAtomsCompact(split71.stakedAtoms), '0.00000000002414');
  assert.equal(lthMath.formatAtomsCompact(split71.withdrawableAtoms), '0.00000000000986');

  // 5) Smart 8-to-12 decimal formatting (0 -> 0.00000000, sub-10^-8 -> up to 12 digits)
  assert.equal(lthMath.formatAtomsDisplay12(0n), '0.00000000');
  const sampleBase = lthMath.parseLthToAtoms('0.003088636363');
  assert.equal(lthMath.formatAtomsDisplay12(sampleBase), '0.003088636363');
});
