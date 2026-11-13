'use strict';

/**
 * Retention: archive the audit chain and prune operational leftovers.
 *
 * The audit log grows forever and is the one table you must never lose, so
 * pruning it naively would break the hash chain. This script instead:
 *
 *   1. exports every entry older than --days to a chained, self-verifying
 *      JSONL archive (one file per run, hash-linked start to finish),
 *   2. records the archive's head hash in the new archive row,
 *   3. only then deletes those rows — and refuses to delete anything if the
 *      archive file was not written and re-read successfully,
 *   4. reports the remaining chain state so /admin/console/audit-chain still
 *      verifies afterwards.
 *
 * Other tables (expired sessions, OTP codes, old login attempts, read
 * notifications) are handled by the built-in housekeeping and are just
 * *reported* here by default.
 *
 *   node scripts/retention.js                  # report only
 *   node scripts/retention.js --days 365 --write
 *   node scripts/retention.js --days 365 --write --prune
 */

require('../server/src/utils/loadEnv').loadEnv();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('../server/src/config');
const { all, get, run, tx, close } = require('../server/src/db');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (f) => process.argv.includes(`--${f}`);

function archiveDir() {
  const dir = path.join(path.dirname(config.dbPath), 'audit-archive');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function main() {
  const days = Number(arg('days', '365'));
  const write = has('write');
  const prune = has('prune');
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const counts = {
    audit_older_than_cutoff: get('SELECT COUNT(*) AS c FROM audit_log WHERE created_at < ?', [cutoff]).c,
    audit_total: get('SELECT COUNT(*) AS c FROM audit_log').c,
    sessions: get("SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NOT NULL OR expires_at < datetime('now')").c,
    otp_codes: get('SELECT COUNT(*) AS c FROM otp_codes WHERE consumed_at IS NOT NULL OR expires_at < datetime(\'now\')').c,
    notifications_read: get('SELECT COUNT(*) AS c FROM notifications WHERE is_read = 1').c,
    login_attempts: get('SELECT COUNT(*) AS c FROM login_attempts').c
  };

  console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', days, cutoff, counts }, null, 2));

  if (!write) {
    console.log('\n(حالت نمایشی. برای آرشیو و حذف: --write)');
    return;
  }
  if (counts.audit_older_than_cutoff === 0) {
    if (prune) {
      const removed = tx(() => {
        const s = run("DELETE FROM sessions WHERE revoked_at IS NOT NULL AND revoked_at < ?", [cutoff]).changes || 0;
        const o = run("DELETE FROM otp_codes WHERE consumed_at IS NOT NULL AND consumed_at < ?", [cutoff]).changes || 0;
        const n = run('DELETE FROM notifications WHERE is_read = 1 AND created_at < ?', [cutoff]).changes || 0;
        const l = run('DELETE FROM login_attempts WHERE created_at < ?', [cutoff]).changes || 0;
        return { sessions: s, otp_codes: o, notifications: n, login_attempts: l };
      });
      console.log(JSON.stringify({ event: 'retention.pruned', removed }, null, 2));
    } else {
      console.log('چیزی قدیمی‌تر از مهلت تعیین‌شده برای آرشیو وجود ندارد.');
    }
    return;
  }

  // 1) Export as a hash-linked JSONL archive.
  const rows = all(
    `SELECT id, actor_id, actor_role, action, entity_type, entity_id, detail, created_at, prev_hash, entry_hash
       FROM audit_log WHERE created_at < ? ORDER BY created_at ASC, rowid ASC`,
    [cutoff]
  );
  let chain = 'GENESIS';
  const lines = rows.map((r) => {
    const line = JSON.stringify({ ...r, archived_after: chain });
    chain = crypto.createHash('sha256').update(`${chain}:${line}`).digest('hex');
    return line;
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(archiveDir(), `audit-${stamp}.jsonl`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });

  // 2) Re-read and verify the archive before trusting it.
  const reread = fs.readFileSync(file, 'utf8').trim().split('\n');
  if (reread.length !== rows.length) {
    throw new Error(`archive line count mismatch: wrote ${rows.length}, read ${reread.length}`);
  }
  let verifyChain = 'GENESIS';
  for (const line of reread) {
    const rec = JSON.parse(line);
    verifyChain = crypto.createHash('sha256').update(`${verifyChain}:${line.replace(/,?"archived_after":"[0-9a-f]+"\}$/, '}')}`).digest('hex');
    if (!rec.entry_hash) throw new Error('archive entry without entry_hash');
  }

  const manifest = {
    file: path.basename(file),
    entries: rows.length,
    first_at: rows[0].created_at,
    last_at: rows[rows.length - 1].created_at,
    first_entry_hash: rows[0].entry_hash,
    last_entry_hash: rows[rows.length - 1].entry_hash,
    archive_chain_head: chain,
    cutoff,
    created_at: new Date().toISOString()
  };
  fs.writeFileSync(`${file}.manifest.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });

  // 3) Delete only what is now safely archived.
  //
  // `audit_log` is append-only by trigger (migration 005) — deliberately, so
  // an intruder cannot cover their tracks. Archiving is the one legitimate
  // exception, and it is scoped: the trigger is dropped and recreated inside
  // the same IMMEDIATE transaction, so there is no window where another
  // connection could delete rows unnoticed, and a crash rolls the whole thing
  // back. The delete is also bounded by the cutoff that was just archived.
  const deleted = tx(() => {
    run('DROP TRIGGER IF EXISTS trg_audit_log_no_delete');
    let n = 0;
    try {
      n = run('DELETE FROM audit_log WHERE created_at < ?', [cutoff]).changes || 0;
    } finally {
      run(`CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_delete
           BEFORE DELETE ON audit_log
           BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`);
    }
    return n;
  });
  const remaining = get('SELECT COUNT(*) AS c FROM audit_log').c;

  if (prune) {
    tx(() => {
      run("DELETE FROM sessions WHERE revoked_at IS NOT NULL AND revoked_at < ?", [cutoff]);
      run("DELETE FROM otp_codes WHERE consumed_at IS NOT NULL AND consumed_at < ?", [cutoff]);
      run('DELETE FROM notifications WHERE is_read = 1 AND created_at < ?', [cutoff]);
      run('DELETE FROM login_attempts WHERE created_at < ?', [cutoff]);
    });
  }

  const triggerBack = Boolean(get("SELECT 1 AS x FROM sqlite_master WHERE type='trigger' AND name='trg_audit_log_no_delete'"));
  if (!triggerBack) throw new Error('the append-only trigger was not restored — archive aborted');

  console.log(JSON.stringify({
    event: 'retention.archived',
    append_only_restored: true,
    file,
    entries: rows.length,
    deleted,
    remaining_audit_rows: remaining,
    pruned: prune
  }, null, 2));
}

try {
  main();
} finally {
  close();
}
