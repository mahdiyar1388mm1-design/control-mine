'use strict';

const express = require('express');
const { all, get, run } = require('../../db');
const { requireAuth } = require('../../middleware/auth');
const { ApiError } = require('../../utils/errors');
const { parsePagination } = require('../../utils/validate');

const router = express.Router();
router.use('/notifications', requireAuth);

router.get('/notifications', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const items = all(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.user.id, limit, offset]
    ).map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      is_read: Boolean(n.is_read),
      created_at: n.created_at
    }));
    const total = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?', [req.user.id]).c;
    const unread_count = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]).c;
    res.json({ items, page, limit, total, unread_count });
  } catch (err) { next(err); }
});

router.post('/notifications/read-all', (req, res) => {
  const result = run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ ok: true, updated: result.changes });
});

router.post('/notifications/:id/read', (req, res, next) => {
  try {
    const row = get('SELECT id FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!row) throw ApiError.notFound('اعلان یافت نشد.');
    run('UPDATE notifications SET is_read = 1 WHERE id = ?', [row.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
