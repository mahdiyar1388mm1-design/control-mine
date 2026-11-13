'use strict';

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let db = null;

/**
 * Removes expired/revoked sessions, expired OTP codes, stale idempotency keys and
 * old rate-limit buckets. Runs on boot, before every backup and every 6 hours.
 * Never throws — housekeeping must not take the app down.
 */
function housekeeping() {
  if (!db) return { skipped: true };
  const now = nowIso();
  const out = {};
  try {
    out.sessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)')
      .run(now, new Date(Date.now() - 24 * 3600 * 1000).toISOString()).changes;
  } catch { /* session shape may differ during migration */ }
  try {
    out.refresh_tokens = db.prepare('DELETE FROM auth_refresh_tokens WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)')
      .run(now, new Date(Date.now() - 24 * 3600 * 1000).toISOString()).changes;
  } catch { /* table may not exist yet */ }
  try {
    out.otp_codes = db.prepare('DELETE FROM otp_codes WHERE expires_at <= ? OR consumed_at IS NOT NULL')
      .run(new Date(Date.now() - 3600 * 1000).toISOString()).changes;
  } catch { /* ignore */ }
  try {
    out.login_attempts = db.prepare('DELETE FROM login_attempts WHERE created_at <= ?')
      .run(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()).changes;
  } catch { /* ignore */ }
  try {
    out.idempotency_keys = db.prepare('DELETE FROM idempotency_keys WHERE created_at <= ?')
      .run(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()).changes;
  } catch { /* ignore */ }
  try {
    out.expired_holds = db.prepare('DELETE FROM stock_holds WHERE expires_at <= ?')
      .run(now).changes;
  } catch { /* ignore */ }
  try {
    out.reauth_proofs = db.prepare('DELETE FROM reauth_proofs WHERE expires_at <= ?')
      .run(now).changes;
  } catch { /* ignore */ }
  try {
    out.mfa_challenges = db.prepare('DELETE FROM mfa_challenges WHERE expires_at <= ? OR consumed_at IS NOT NULL')
      .run(now).changes;
  } catch { /* migration 010 not applied yet */ }
  try {
    // Read notifications are kept for the configured retention window and then dropped.
    const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    out.notifications = db.prepare('DELETE FROM notifications WHERE is_read = 1 AND created_at <= ?')
      .run(cutoff).changes;
  } catch { /* ignore */ }
  try {
    db.prepare("INSERT INTO settings (key, value) VALUES ('db_last_housekeeping_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(now);
  } catch { /* settings table absent on very old schemas */ }
  try {
    // Refresh planner statistics after bulk deletes so query plans stay accurate.
    db.exec('PRAGMA optimize');
  } catch { /* ignore */ }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function getDb() {
  if (!db) {
    db = new DatabaseSync(config.dbPath);
    // Durability + integrity first: rollback journal on a tmpfs-less disk is slow but safe;
    // WAL keeps concurrent readers fast while writers stay serialized.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    // View/trigger subqueries must stay usable under the strict query planner.
    db.exec('PRAGMA trusted_schema = ON');
    // Unsigned 64-bit counters without silent precision loss.
    db.exec('PRAGMA cell_size_check = ON');
    // Optional: overwrite deleted pages so removed KYC/audit rows cannot be
    // recovered from free space. Off by default (costs write throughput).
    if (process.env.CM_SECURE_DELETE === '1') db.exec('PRAGMA secure_delete = ON');
    db.exec('PRAGMA temp_store = MEMORY');
    db.exec('PRAGMA cache_size = -20000');
    // Query-planner statistics; refreshed by housekeeping / optimize.
    try { db.exec('PRAGMA optimize'); } catch { /* older engines */ }
    // The database holds password hashes, session state and the audit chain:
    // make sure only the service account can read it. Best effort — a mounted
    // volume or a non-POSIX filesystem may refuse the chmod.
    for (const suffix of ['', '-wal', '-shm']) tightenDataPermissions(`${config.dbPath}${suffix}`);
  }
  return db;
}

/**
 * Restricts a path to the owner — used for the SQLite file, its WAL/SHM
 * companions, the upload/store directories and the backups directory.
 * Returns true when the mode is now owner-only (or already was).
 */
function tightenDataPermissions(target, { mode = 0o600 } = {}) {
  try {
    if (fs.statSync(target).mode & 0o077) fs.chmodSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

function get(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

/** Run fn inside an IMMEDIATE transaction (nested calls join the outer transaction). */
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) {
    txDepth += 1;
    try {
      return fn(getDb());
    } finally {
      txDepth -= 1;
    }
  }
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const result = fn(d);
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try { d.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    txDepth = 0;
  }
}

/** Fast integrity verification (used by /health and backups). */
function integrityCheck({ full = false } = {}) {
  const rows = all(full ? 'PRAGMA integrity_check' : 'PRAGMA quick_check');
  return rows.map((r) => Object.values(r)[0]);
}

function close() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

module.exports = {
  tightenDataPermissions,
  getDb,
  all,
  get,
  run,
  tx,
  close,
  housekeeping,
  integrityCheck
};
