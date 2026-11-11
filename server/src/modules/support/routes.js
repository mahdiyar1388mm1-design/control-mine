'use strict';

const express = require('express');
const path = require('path');
const multer = require('multer');
const { all, get, run, tx } = require('../../db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { rateLimit } = require('../../middleware/rateLimit');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, humanCode, validate, parsePagination } = require('../../utils/validate');
const config = require('../../config');
const { notify, audit } = require('../platform/service');

const router = express.Router();

const TICKET_STATUS = ['new', 'open', 'waiting_customer', 'waiting_team', 'resolved', 'closed'];
const STATUS_LABEL = {
  new: 'جدید', open: 'باز', waiting_customer: 'منتظر پاسخ مشتری',
  waiting_team: 'منتظر تیم', resolved: 'حل‌شده', closed: 'بسته'
};

const privateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.storageDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
      cb(null, `${uuid()}${ext}`);
    }
  }),
  limits: { fileSize: config.maxUploadBytes, files: 3 },
  fileFilter: (req, file, cb) => {
    if (config.allowedUploadMimes.includes(file.mimetype)) cb(null, true);
    else cb(ApiError.validation('نوع فایل مجاز نیست.'));
  }
});

function ticketView(row, user) {
  const isOwner = row.user_id === user.id;
  const isStaff = ['support', 'admin'].includes(user.role);
  if (!isOwner && !isStaff) throw ApiError.forbidden('شما به این تیکت دسترسی ندارید.');
  const messages = all(
    `SELECT m.*, u.full_name AS author_name FROM ticket_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = ? ORDER BY m.created_at`,
    [row.id]
  );
  const files = all('SELECT * FROM ticket_files WHERE ticket_id = ? ORDER BY created_at', [row.id]);
  return {
    id: row.id,
    code: row.code,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    status_label: STATUS_LABEL[row.status],
    user_id: row.user_id,
    customer_name: get('SELECT full_name FROM users WHERE id = ?', [row.user_id]).full_name,
    assigned_to: row.assigned_to,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
    messages: messages.map((m) => ({
      id: m.id, author_name: m.author_name, author_role: m.author_role,
      body: m.body, created_at: m.created_at
    })),
    files: files.map((f) => ({
      id: f.id, original_name: f.original_name, mime: f.mime,
      size_bytes: f.size_bytes, created_at: f.created_at
    }))
  };
}

function ownedTicketFor(user, idOrCode) {
  const row = get('SELECT * FROM tickets WHERE code = ? OR id = ?', [idOrCode, idOrCode]);
  if (!row) throw ApiError.notFound('تیکت یافت نشد.');
  return row;
}

router.use('/tickets', requireAuth);
router.use('/staff/tickets', requireAuth);

// ---------- customer ----------

router.post('/tickets', rateLimit({ name: 'create-ticket', windowSec: 60, max: 8 }), privateUpload.array('files', 3), (req, res, next) => {
  try {
    const data = validate(req.body)
      .string('subject', { min: 3, max: 200 })
      .string('category', { enum: ['general', 'orders', 'payments', 'services', 'account', 'other'], default: 'general' })
      .string('priority', { enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' })
      .string('body', { min: 1, max: 4000 })
      .done();
    const id = uuid();
    const code = humanCode('TK');
    const now = nowIso();
    tx(() => {
      run(
        `INSERT INTO tickets (id, code, user_id, category, subject, priority, status, assigned_to, team, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'new', NULL, 'support', ?, ?, NULL)`,
        [id, code, req.user.id, data.category, data.subject, data.priority, now, now]
      );
      run('INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuid(), id, req.user.id, req.user.role, data.body, now]);
      for (const file of req.files || []) {
        run('INSERT INTO ticket_files (id, ticket_id, uploader_id, original_name, stored_name, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid(), id, req.user.id, file.originalname, file.filename, file.mimetype, file.size, now]);
      }
    });
    res.status(201).json({ ticket: ticketView(get('SELECT * FROM tickets WHERE id = ?', [id]), req.user) });
  } catch (err) { next(err); }
});

router.get('/tickets', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const items = all('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [req.user.id, limit, offset]);
    const total = get('SELECT COUNT(*) AS c FROM tickets WHERE user_id = ?', [req.user.id]).c;
    res.json({
      items: items.map((t) => ({
        code: t.code, subject: t.subject, category: t.category, priority: t.priority,
        status: t.status, status_label: STATUS_LABEL[t.status], created_at: t.updated_at
      })),
      page, limit, total
    });
  } catch (err) { next(err); }
});

router.get('/tickets/:code', (req, res, next) => {
  try {
    const row = ownedTicketFor(req.user, req.params.code);
    if (row.user_id !== req.user.id && !['support', 'admin'].includes(req.user.role)) {
      throw ApiError.forbidden('شما به این تیکت دسترسی ندارید.');
    }
    res.json({ ticket: ticketView(row, req.user) });
  } catch (err) { next(err); }
});

router.post('/tickets/:code/messages', rateLimit({ name: 'ticket-msg', windowSec: 60, max: 30 }), (req, res, next) => {
  try {
    const data = validate(req.body).string('body', { min: 1, max: 4000 }).done();
    const row = ownedTicketFor(req.user, req.params.code);
    const isOwner = row.user_id === req.user.id;
    const isSupport = ['support', 'admin'].includes(req.user.role);
    if (!isOwner && !isSupport) throw ApiError.forbidden('شما به این تیکت دسترسی ندارید.');
    if (row.status === 'closed') throw ApiError.invalidState('این تیکت بسته شده است.');
    const now = nowIso();
    tx(() => {
      run('INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuid(), row.id, req.user.id, req.user.role, data.body, now]);
      let nextStatus = row.status;
      if (isSupport && ['new', 'waiting_customer'].includes(row.status)) nextStatus = 'open';
      else if (isOwner && row.status === 'waiting_customer') nextStatus = 'open';
      else if (isSupport && row.status === 'new') nextStatus = 'open';
      run('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', [nextStatus, now, row.id]);
      if (isSupport && isOwner === false) {
        notify(row.user_id, 'ticket_reply', `پاسخ تیکت ${row.code}`, data.body.slice(0, 120), `/tickets/${row.code}`);
      } else if (isOwner && row.assigned_to) {
        notify(row.assigned_to, 'ticket_message', `پیام جدید در تیکت ${row.code}`, data.body.slice(0, 120), `/staff/tickets/${row.code}`);
      }
    });
    res.status(201).json({ ticket: ticketView(get('SELECT * FROM tickets WHERE id = ?', [row.id]), req.user) });
  } catch (err) { next(err); }
});

// ---------- staff (support / admin) ----------

router.get('/staff/tickets', requireRole('support', 'admin'), (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = [];
    const params = [];
    if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
    if (req.query.q) { where.push('(t.code LIKE ? OR t.subject LIKE ? OR u.full_name LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const items = all(
      `SELECT t.*, u.full_name AS customer_name FROM tickets t JOIN users u ON u.id = t.user_id
        ${whereSql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const total = get(`SELECT COUNT(*) AS c FROM tickets t JOIN users u ON u.id = t.user_id ${whereSql}`, params).c;
    res.json({
      items: items.map((t) => ({
        id: t.id, code: t.code, subject: t.subject, category: t.category,
        priority: t.priority, status: t.status, status_label: STATUS_LABEL[t.status],
        customer_name: t.customer_name, created_at: t.created_at, updated_at: t.updated_at
      })),
      page, limit, total
    });
  } catch (err) { next(err); }
});

router.post('/staff/tickets/:code/status', requireRole('support', 'admin'), (req, res, next) => {
  try {
    const data = validate(req.body)
      .string('to_status', { enum: TICKET_STATUS })
      .string('reason', { required: false, max: 300, default: '' })
      .done();
    const row = ownedTicketFor(req.user, req.params.code);
    const now = nowIso();
    run('UPDATE tickets SET status = ?, updated_at = ?, closed_at = ?, assigned_to = COALESCE(assigned_to, ?) WHERE id = ?',
      [data.to_status, now, ['closed', 'resolved'].includes(data.to_status) ? now : null, req.user.id, row.id]);
    if (data.reason) {
      run('INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuid(), row.id, req.user.id, req.user.role, `تغییر وضعیت به «${STATUS_LABEL[data.to_status]}»: ${data.reason}`, now]);
    }
    notify(row.user_id, 'ticket_status', `تیکت ${row.code}: ${STATUS_LABEL[data.to_status]}`, data.reason, `/tickets/${row.code}`);
    audit(req.user.id, req.user.role, 'ticket.status_change', 'ticket', row.id, { from: row.status, to: data.to_status, reason: data.reason });
    res.json({ ticket: ticketView(get('SELECT * FROM tickets WHERE id = ?', [row.id]), req.user) });
  } catch (err) { next(err); }
});

router.post('/staff/tickets/:code/assign', requireRole('support', 'admin'), (req, res, next) => {
  try {
    const data = validate(req.body)
      .string('team', { required: false, enum: ['support', 'services', 'finance', 'warehouse'], default: undefined })
      .string('assignee_id', { required: false, max: 64, default: undefined })
      .string('reason', { required: false, max: 300, default: '' })
      .done();
    const row = ownedTicketFor(req.user, req.params.code);
    if (data.assignee_id) {
      const target = get("SELECT id, role FROM users WHERE id = ? AND status = 'active'", [data.assignee_id]);
      if (!target || !['support', 'admin'].includes(target.role)) {
        throw ApiError.validation('کارشناس انتخابی مجاز نیست.', [{ field: 'assignee_id', message: 'نامعتبر است.' }]);
      }
    }
    const nextTeam = data.team || row.team;
    const nextAssignee = data.assignee_id !== undefined ? (data.assignee_id || null) : row.assigned_to;
    const nextStatus = data.team && data.team !== 'support' ? 'waiting_team' : (row.status === 'new' ? 'open' : row.status);
    const now = nowIso();
    run('UPDATE tickets SET team = ?, assigned_to = ?, status = ?, updated_at = ? WHERE id = ?',
      [nextTeam, nextAssignee, nextStatus, now, row.id]);
    audit(req.user.id, req.user.role, 'ticket.assign', 'ticket', row.id, { team: nextTeam, assignee_id: nextAssignee, reason: data.reason });
    res.json({ ticket: ticketView(get('SELECT * FROM tickets WHERE id = ?', [row.id]), req.user) });
  } catch (err) { next(err); }
});

module.exports = router;
