'use strict';

const crypto = require('crypto');
const { all, get, run } = require('../../db');
const { uuid, nowIso } = require('../../utils/validate');
const config = require('../../config');

function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)]
  );
}

function shippingConfig() {
  return {
    flatToman: Number(getSetting('shipping_flat_toman', 39000)),
    freeOverToman: Number(getSetting('shipping_free_over_toman', 1500000))
  };
}

function notify(userId, type, title, body = '', link = null) {
  run(
    'INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    [uuid(), userId, type, title, body, link, nowIso()]
  );
}

function maskDetailPii(detailObj) {
  const raw = JSON.stringify(detailObj || {});
  return raw.replace(/(09\d{2})\d{5}(\d{2})/g, '$1*****$2');
}

/**
 * Append-only, tamper-evident audit entry.
 * Each row stores the hash of the previous entry plus its own chained hash, so
 * deleting or editing any historical row breaks `verifyAuditChain()` immediately.
 */
function audit(actorId, actorRole, action, entityType, entityId, detail = {}) {
  const id = uuid();
  const createdAt = nowIso();
  const detailText = maskDetailPii(detail);
  const prev = get('SELECT entry_hash FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT 1');
  const prevHash = (prev && prev.entry_hash) || 'GENESIS';
  const entryHash = computeEntryHash(prevHash, {
    id,
    actor_id: actorId,
    actor_role: actorRole,
    action,
    entity_type: entityType,
    entity_id: entityId,
    detail: detailText,
    created_at: createdAt
  });
  run(
    'INSERT INTO audit_log (id, actor_id, actor_role, action, entity_type, entity_id, detail, created_at, prev_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, actorId || null, actorRole || null, action, entityType, entityId || null, detailText, createdAt, prevHash, entryHash]
  );
  return { id, entry_hash: entryHash };
}

function computeEntryHash(prevHash, row) {
  return crypto
    .createHmac('sha256', config.secret)
    .update([prevHash, row.id, row.actor_id || '', row.actor_role || '', row.action,
      row.entity_type, row.entity_id || '', row.detail, row.created_at].join('|'))
    .digest('hex');
}

/**
 * One-time upgrade path: audit rows written before the hash chain existed get
 * their hashes computed in order, so historical logs are covered too.
 * Returns the number of rows backfilled.
 */
function backfillAuditChain() {
  const pending = get('SELECT COUNT(*) AS c FROM audit_log WHERE entry_hash IS NULL').c;
  if (!pending) return 0;
  const rows = all(
    `SELECT id, actor_id, actor_role, action, entity_type, entity_id, detail, created_at
       FROM audit_log WHERE entry_hash IS NULL ORDER BY created_at ASC, rowid ASC`
  );
  let prev = get('SELECT entry_hash FROM audit_log WHERE entry_hash IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1');
  let prevHash = (prev && prev.entry_hash) || 'GENESIS';
  // Rebuild from the first hashed ancestor so links stay continuous.
  const firstNull = get('SELECT MIN(rowid) AS r FROM audit_log WHERE entry_hash IS NULL');
  const ancestor = get('SELECT entry_hash FROM audit_log WHERE rowid < ? AND entry_hash IS NOT NULL ORDER BY rowid DESC LIMIT 1', [firstNull.r]);
  prevHash = ancestor ? ancestor.entry_hash : 'GENESIS';
  for (const row of rows) {
    const hash = computeEntryHash(prevHash, row);
    run('UPDATE audit_log SET prev_hash = ?, entry_hash = ? WHERE id = ?', [prevHash, hash, row.id]);
    prevHash = hash;
  }
  return rows.length;
}

// Full-chain verification is O(n) HMAC work; the security center polls it, so the
// result is memoised until the log actually changes (count + head hash).
let chainCache = { key: null, result: null, at: 0 };

/** Recomputes the full chain and reports the first broken link (integrity audit). */
function verifyAuditChain({ limit = 0 } = {}) {
  if (!limit) {
    const stats = get('SELECT COUNT(*) AS c, MAX(rowid) AS last FROM audit_log');
    const head = get('SELECT entry_hash FROM audit_log ORDER BY rowid DESC LIMIT 1');
    const key = `${stats.c}:${stats.last}:${head ? head.entry_hash : ''}`;
    if (chainCache.key === key && Date.now() - chainCache.at < 60000) return chainCache.result;
    const result = verifyAuditChainRows(rows0());
    chainCache = { key, result, at: Date.now() };
    return result;
  }
  return verifyAuditChainRows(verifyRows(limit));
}

function rows0() {
  return all(
    `SELECT id, actor_id, actor_role, action, entity_type, entity_id, detail, created_at, prev_hash, entry_hash
       FROM audit_log ORDER BY created_at ASC, rowid ASC`
  );
}

function verifyRows(limit) {
  return all(
    `SELECT id, actor_id, actor_role, action, entity_type, entity_id, detail, created_at, prev_hash, entry_hash
       FROM audit_log ORDER BY created_at ASC, rowid ASC LIMIT ?`,
    [limit]
  );
}

function verifyAuditChainRows(rows) {
  let expectedPrev = 'GENESIS';
  for (const row of rows) {
    if (!row.entry_hash) {
      // Legacy row awaiting backfill at boot: it cannot be verified yet.
      return { ok: false, checked: rows.length, broken_at: row.id, reason: 'missing_hash' };
    }
    if ((row.prev_hash || 'GENESIS') !== expectedPrev) {
      return { ok: false, checked: rows.length, broken_at: row.id, reason: 'prev_hash_mismatch' };
    }
    const recomputed = computeEntryHash(expectedPrev, row);
    if (recomputed !== row.entry_hash) {
      // A different HMAC key (e.g. CM_SECRET rotated, or a restored backup opened
      // with another key) looks exactly like tampering. Report it precisely so an
      // operator fixes the key instead of chasing a ghost attacker.
      return {
        ok: false,
        checked: rows.length,
        broken_at: row.id,
        reason: 'entry_hash_mismatch',
        hint: 'اگر CM_SECRET عوض شده یا پشتیبان با کلید دیگری باز شده است، این نتیجه «دستکاری» نیست؛ کلید امضای اصلی را برگردانید.'
      };
    }
    expectedPrev = row.entry_hash;
  }
  return { ok: true, checked: rows.length, head: expectedPrev };
}

function listAudit({ limit, offset, action, entity_type }) {
  const where = [];
  const params = [];
  if (action) { where.push('a.action = ?'); params.push(action); }
  if (entity_type) { where.push('a.entity_type = ?'); params.push(entity_type); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const items = all(
    `SELECT a.*, u.full_name AS actor_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ${whereSql}
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map((row) => {
    let parsedDetail = {};
    try { parsedDetail = JSON.parse(row.detail || '{}'); } catch { parsedDetail = {}; }
    return {
      id: row.id,
      actor_id: row.actor_id,
      actor_name: row.actor_name,
      actor_role: row.actor_role,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      detail: parsedDetail,
      created_at: row.created_at
    };
  });
  const total = get(`SELECT COUNT(*) AS c FROM audit_log a ${whereSql}`, params).c;
  return { items, total };
}

function maskPhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/(09\d{2})\d{5}(\d{2})/, '$1*****$2');
}

module.exports = {
  getSetting, setSetting, shippingConfig, notify, audit, listAudit, maskPhone,
  verifyAuditChain, backfillAuditChain, computeEntryHash
};
