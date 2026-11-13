'use strict';

/**
 * Deployment readiness (what an operator needs before going live):
 *
 *  - `.env` is actually read (the documented workflow used to be a no-op),
 *    without ever overriding variables exported by the shell.
 *  - `/ready` answers 200 only when the DB is reachable, the schema is applied
 *    and every migration file on disk is recorded as applied.
 *  - Data files that hold password hashes and the audit chain are owner-only.
 *  - Production refuses to boot with the sandbox OTP channel on.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-deploy-'));
process.env.CM_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CM_STORAGE_DIR = path.join(tmpRoot, 'storage');
process.env.CM_SECRET = 'deploy-test-secret-0123456789abcdef0123456789abcd';
process.env.NODE_ENV = 'test';

const { parseEnv, loadEnv } = require('../src/utils/loadEnv');
const { seed } = require('../src/db/seed');
const { close, getDb, tightenDataPermissions } = require('../src/db');
const { createApp } = require('../src/app');

test('env parsing: comments, export prefix, quotes, empty values, junk lines', () => {
  const parsed = parseEnv(
    [
      '# a comment',
      'export CM_PUBLIC_BASE_URL="https://example.com"',
      "SINGLE='quoted value'",
      'PLAIN=value',
      'EMPTY=',
      'not a valid line',
      '=novalue',
      'BAD KEY=1',
      'TRAILING=  spaced  '
    ].join('\n')
  );
  assert.deepEqual(parsed, {
    CM_PUBLIC_BASE_URL: 'https://example.com',
    SINGLE: 'quoted value',
    PLAIN: 'value',
    EMPTY: '',
    TRAILING: 'spaced'
  });
});

test('env loading: server/.env wins, shell variables are never overridden', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-env-'));
  fs.mkdirSync(path.join(root, 'server'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'server', '.env'),
    'CM_TEST_FROM_FILE=file-value\nCM_TEST_SHELL=file-value\n'
  );
  // A root-level .env exists but must lose to server/.env.
  fs.writeFileSync(path.join(root, '.env'), 'CM_TEST_FROM_FILE=root-value\n');

  delete process.env.CM_TEST_FROM_FILE;
  process.env.CM_TEST_SHELL = 'shell-value';
  try {
    const result = loadEnv({ root });
    assert.equal(result.loaded, path.join(root, 'server', '.env'));
    assert.equal(process.env.CM_TEST_FROM_FILE, 'file-value');
    assert.equal(process.env.CM_TEST_SHELL, 'shell-value', 'shell must win');
    assert.ok(result.skipped.includes('CM_TEST_SHELL'));
  } finally {
    delete process.env.CM_TEST_FROM_FILE;
    delete process.env.CM_TEST_SHELL;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('env loading: missing file is a no-op, not a crash', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-env-empty-'));
  try {
    const result = loadEnv({ root: empty });
    assert.equal(result.loaded, null);
    assert.deepEqual(result.applied, []);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('/ready reports db + schema + migrations and 503s when a migration is missing', async () => {
  seed({ silent: true });
  getDb();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/ready`);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.status, 'ready');
    assert.deepEqual(body.checks, { db: true, schema: true, migrations: true });
    assert.match(String(body.schema_version), /^\d+$/);

    // A migration file that is not recorded makes the instance "not ready".
    const fake = path.join(__dirname, '..', 'src', 'db', 'migrations', '999_unapplied_test.sql');
    fs.writeFileSync(fake, 'SELECT 1;\n');
    try {
      const notReady = await fetch(`${base}/ready`);
      assert.equal(notReady.status, 503);
      const nb = await notReady.json();
      assert.equal(nb.status, 'not-ready');
      assert.equal(nb.checks.migrations, false);
    } finally {
      fs.unlinkSync(fake);
    }
    const recovered = await fetch(`${base}/ready`);
    assert.equal(recovered.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('data files are owner-only after the database opens', () => {
  const dbPath = path.join(tmpRoot, 'data', 'central-mine.db');
  getDb();
  const mode = fs.statSync(dbPath).mode & 0o777;
  assert.equal(mode, 0o600, `db must be 0600, got 0${mode.toString(8)}`);

  // The helper itself is what migrations/backups reuse.
  const loose = path.join(tmpRoot, 'loose.txt');
  fs.writeFileSync(loose, 'x', { mode: 0o644 });
  assert.equal(tightenDataPermissions(loose, { mode: 0o600 }), true);
  assert.equal(fs.statSync(loose).mode & 0o777, 0o600);
  // A missing path must not throw.
  assert.equal(tightenDataPermissions(path.join(tmpRoot, 'nope')), false);
});

test('production refuses to boot with the sandbox OTP channel enabled', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /CM_OTP_SANDBOX/);
  assert.match(src, /config\.isProd && config\.otpSandbox/);
  // And the .env example documents the same constraint.
  const example = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
  assert.match(example, /CM_OTP_SANDBOX=0/);
  assert.match(example, /CM_SECRET=/);
  assert.match(example, /CM_BACKUP_KEY=/);
});
