'use strict';

/**
 * Operational readiness: the things that must keep working when nobody is
 * looking at the screen.
 *
 *  - seed refuses to run in production (the demo passwords are public),
 *  - the scheduled backup produces a verified, encrypted archive and rotates,
 *  - retention archives the audit chain *before* deleting, restores the
 *    append-only trigger, and leaves the chain verifiable,
 *  - monitor.js reports failure through its exit code, which is what cron
 *    and systemd actually act on.
 *
 * The scripts are spawned as real child processes on purpose: their exit
 * codes and stdout are their entire contract with the scheduler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-ops-'));
const dataDir = path.join(tmpRoot, 'data');

const env = {
  ...process.env,
  CM_DATA_DIR: dataDir,
  CM_STORAGE_DIR: path.join(tmpRoot, 'storage'),
  CM_DB_PATH: path.join(dataDir, 'ops.db'),
  CM_SECRET: 'ops-test-secret-0123456789abcdef0123456789abcdef01',
  CM_BACKUP_KEY: 'ops-backup-passphrase-2026',
  NODE_ENV: 'test'
};

/** Runs a script and returns { status, stdout, stderr } without throwing. */
function run(script, args = [], extraEnv = {}) {
  const res = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', script), ...args], {
    env: { ...env, ...extraEnv },
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

test.before(() => {
  // A migrated+seeded database to operate on.
  execFileSync(process.execPath, ['-e', `
    process.env.CM_DATA_DIR = ${JSON.stringify(dataDir)};
    process.env.CM_STORAGE_DIR = ${JSON.stringify(path.join(tmpRoot, 'storage'))};
    process.env.CM_DB_PATH = ${JSON.stringify(path.join(dataDir, 'ops.db'))};
    process.env.CM_SECRET = ${JSON.stringify(env.CM_SECRET)};
    process.env.NODE_ENV = 'test';
    const { seed } = require(${JSON.stringify(path.join(repoRoot, 'server', 'src', 'db', 'seed'))});
    seed({ silent: true });
  `], { env, cwd: repoRoot, stdio: 'pipe' });
});

test('operations: seed refuses to run in production unless explicitly forced', () => {
  const blocked = spawnSync(process.execPath, ['-e', `
    process.env.CM_DATA_DIR = ${JSON.stringify(path.join(tmpRoot, 'prod-data'))};
    process.env.CM_STORAGE_DIR = ${JSON.stringify(path.join(tmpRoot, 'prod-storage'))};
    process.env.CM_SECRET = ${JSON.stringify(env.CM_SECRET)};
    process.env.NODE_ENV = 'production';
    const { seed } = require(${JSON.stringify(path.join(repoRoot, 'server', 'src', 'db', 'seed'))});
    seed({ silent: true });
  `], { env: { ...env, NODE_ENV: 'production' }, cwd: repoRoot, encoding: 'utf8' });

  assert.notEqual(blocked.status, 0, 'seeding production must fail');
  assert.match(String(blocked.stderr) + String(blocked.stdout), /seed در محیط تولید اجرا نمی‌شود/);
});

test('operations: backup writes an encrypted archive, verifies it, and rotates old ones', () => {
  const first = run('backup.js', ['--keep', '2', '--verify']);
  assert.equal(first.status, 0, first.stderr);
  const record = JSON.parse(first.stdout.trim().split('\n').pop());
  assert.equal(record.event, 'backup.done');
  assert.equal(record.encrypted, true);
  assert.ok(record.size_bytes > 0);
  assert.equal(record.verified.integrity, 'ok', 'a backup must be restorable, not just written');
  assert.ok(record.verified.tables > 20);

  const file = path.join(dataDir, 'backups', record.file);
  assert.ok(fs.existsSync(file), 'the archive must exist on disk');
  // CMBK1 is the project's encrypted-container magic; a plain SQLite file
  // starting with "SQLite format 3" here would mean encryption silently failed.
  assert.equal(fs.readFileSync(file).subarray(0, 5).toString('utf8'), 'CMBK1');

  // A last-run marker exists for the monitor to read.
  const marker = JSON.parse(fs.readFileSync(path.join(dataDir, 'backups', 'last-backup.json'), 'utf8'));
  assert.equal(marker.file, record.file);

  // Rotation: three more runs with --keep 2 must leave only two archives.
  for (let i = 0; i < 3; i += 1) {
    const r = run('backup.js', ['--keep', '2']);
    assert.equal(r.status, 0, r.stderr);
  }
  const archives = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('.enc'));
  assert.equal(archives.length, 2, `rotation must keep exactly 2 archives, found ${archives.length}`);
});

test('operations: retention archives the audit chain before deleting and re-arms the append-only guard', () => {
  const dbFile = path.join(dataDir, 'ops.db');

  // The dry run prints a first JSON report followed by a Persian hint line;
  // take the JSON object only.
  const dryOut = run('retention.js', ['--days', '0']).stdout;
  const dryJson = dryOut.slice(dryOut.indexOf('{'), dryOut.lastIndexOf('}') + 1);
  const before = JSON.parse(dryJson);
  assert.ok(before.counts.audit_total > 0, 'there must be audit rows to archive');
  assert.equal(before.mode, 'dry-run');

  // --days 0 archives everything already written.
  const out = run('retention.js', ['--days', '0', '--write']);
  assert.equal(out.status, 0, out.stderr);
  // --write prints the counts report first, then the result object.
  const writeJson = out.stdout.slice(out.stdout.indexOf('{\n  "event"'));
  const result = JSON.parse(writeJson.slice(0, writeJson.lastIndexOf('}') + 1));
  assert.equal(result.event, 'retention.archived');
  assert.equal(result.append_only_restored, true);
  assert.equal(result.deleted, before.counts.audit_total);

  // The archive file is hash-linked and carries a manifest.
  const archive = fs.readFileSync(result.file, 'utf8').trim().split('\n');
  assert.equal(archive.length, result.entries);
  const manifest = JSON.parse(fs.readFileSync(`${result.file}.manifest.json`, 'utf8'));
  assert.equal(manifest.entries, result.entries);
  assert.match(manifest.archive_chain_head, /^[0-9a-f]{64}$/);

  // The chain still verifies after the prune (empty or rebuilt, but valid).
  const { verifyAuditChain } = require('../src/modules/platform/service');
  process.env.CM_DB_PATH = dbFile; // module-level db handle still points at this file
  const chain = verifyAuditChain();
  assert.equal(chain.ok, true, 'pruning must not corrupt the remaining chain');

  // And the append-only trigger really is back: deleting by hand must abort.
  const { run: dbRun } = require('../src/db');
  assert.throws(() => dbRun('DELETE FROM audit_log'), /append-only/);
  assert.throws(() => dbRun("UPDATE audit_log SET action = 'x'"), /append-only/);
});

test('operations: monitor exits non-zero when the server is unreachable', () => {
  // Nothing listens on this port, so every network check fails.
  const res = run('monitor.js', ['--url', 'http://127.0.0.1:9']);
  assert.equal(res.status, 2, 'exit code 2 is what cron/systemd turn into an alert');
  assert.match(res.stdout, /FAIL/);
  assert.match(res.stdout, /health/);
});
