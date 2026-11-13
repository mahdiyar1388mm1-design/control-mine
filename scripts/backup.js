'use strict';

/**
 * Scheduled-backup entry point for cron / systemd timer.
 *
 * The application already knows how to take a consistent encrypted backup
 * (VACUUM INTO + AES-256-GCM). What was missing is everything an operator
 * needs to *schedule* it: rotation, a machine-readable last-run marker, and a
 * non-zero exit code when something is wrong, so a timer unit can alert.
 *
 *   node scripts/backup.js                 # one backup, rotate, done
 *   node scripts/backup.js --keep 14       # keep the newest 14 archives
 *   node scripts/backup.js --verify        # + decrypt and integrity-check it
 *
 * Exit codes: 0 ok · 1 backup failed · 2 backup made but verification failed.
 * cron: 15 3 * * *  cd /srv/central-mine && /usr/bin/node scripts/backup.js >> logs/backup.log 2>&1
 */

require('../server/src/utils/loadEnv').loadEnv();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('../server/src/config');
const { createBackup, restoreEncryptedBackup } = require('../server/src/db/backup');
const { close } = require('../server/src/db');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function has(flag) {
  return process.argv.includes(`--${flag}`);
}

/** Deletes the oldest archives beyond `keep`, never touching non-backup files. */
function rotate(dir, keep) {
  const files = fs.readdirSync(dir)
    .filter((f) => /^central-mine-.*\.(db|db\.enc)$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const doomed = files.slice(keep);
  for (const { f } of doomed) fs.unlinkSync(path.join(dir, f));
  return { total: files.length, removed: doomed.map((d) => d.f) };
}

function main() {
  const keep = Number(arg('keep', '14'));
  const dir = path.join(path.dirname(config.dbPath), 'backups');
  const startedAt = new Date().toISOString();

  let made;
  try {
    made = createBackup({ destDir: dir, encryptionPassphrase: config.backupKey || undefined });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'backup.failed', at: startedAt, error: String(err.message).slice(0, 300) }));
    process.exitCode = 1;
    return;
  }

  const rotated = rotate(dir, keep);

  // Verification: decrypt to a temp file and run PRAGMA integrity_check on it.
  // A backup you have never restored is a hope, not a backup.
  let verified = null;
  if (has('verify') && made.encrypted) {
    const tmp = path.join(dir, `.verify-${crypto.randomBytes(4).toString('hex')}.db`);
    try {
      restoreEncryptedBackup(made.path, tmp, config.backupKey);
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(tmp);
      const row = db.prepare('PRAGMA integrity_check').get();
      const tables = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'").get().c;
      db.close();
      verified = { integrity: row ? Object.values(row)[0] : 'unknown', tables };
      if (verified.integrity !== 'ok') process.exitCode = 2;
    } catch (err) {
      verified = { integrity: 'error', error: String(err.message).slice(0, 200) };
      process.exitCode = 2;
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    }
  }

  const record = {
    level: process.exitCode === 2 ? 'error' : 'info',
    event: 'backup.done',
    at: startedAt,
    file: path.basename(made.path),
    encrypted: made.encrypted,
    size_bytes: made.size_bytes,
    keep,
    rotated_removed: rotated.removed.length,
    archives_total: rotated.total - rotated.removed.length + 1,
    verified
  };
  console.log(JSON.stringify(record));

  // A machine-readable marker so monitoring can alert on "no backup in 48h"
  // without parsing log lines.
  try {
    fs.writeFileSync(path.join(dir, 'last-backup.json'), JSON.stringify({
      at: startedAt,
      file: record.file,
      encrypted: record.encrypted,
      size_bytes: record.size_bytes,
      verified
    }, null, 2), { mode: 0o600 });
  } catch { /* read-only mount: the log line is still authoritative */ }

  if (!made.encrypted) {
    console.error(JSON.stringify({
      level: 'warn',
      event: 'backup.unencrypted',
      hint: 'CM_BACKUP_KEY تنظیم نشده است؛ پشتیبان بدون رمزنگاری ذخیره شد.'
    }));
  }
}

try {
  main();
} finally {
  close();
}
