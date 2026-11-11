'use strict';

const { all, get, run } = require('../../db');
const { uuid, nowIso } = require('../../utils/validate');

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

function audit(actorId, actorRole, action, entityType, entityId, detail = {}) {
  run(
    'INSERT INTO audit_log (id, actor_id, actor_role, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [uuid(), actorId || null, actorRole || null, action, entityType, entityId || null, maskDetailPii(detail), nowIso()]
  );
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

module.exports = { getSetting, setSetting, shippingConfig, notify, audit, listAudit, maskPhone };
