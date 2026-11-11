'use strict';

const express = require('express');
const orders = require('./service');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { rateLimit } = require('../../middleware/rateLimit');

const router = express.Router();
router.use('/orders', requireAuth);
router.use('/staff/orders', requireAuth);

// ---------- customer / owner ----------

router.post('/orders', rateLimit({ name: 'create-order', windowSec: 60, max: 10 }), (req, res, next) => {
  try {
    const idempotencyKey = (req.header('idempotency-key') || '').slice(0, 100) || null;
    const result = orders.createOrder(req.user, req.body, idempotencyKey);
    res.status(result.idempotent_replay ? 200 : 201).json(result);
  } catch (err) { next(err); }
});

router.get('/orders', (req, res, next) => {
  try {
    res.json(orders.listOrders(req.user, { ...req.query, all: '0' }));
  } catch (err) { next(err); }
});

router.get('/orders/:code', (req, res, next) => {
  try {
    res.json({ order: orders.getOrder(req.user, req.params.code) });
  } catch (err) { next(err); }
});

router.get('/orders/:code/receipt', (req, res, next) => {
  try {
    res.json({ receipt: orders.receipt(req.user, req.params.code) });
  } catch (err) { next(err); }
});

router.post('/orders/:code/cancel', (req, res, next) => {
  try {
    res.json({ order: orders.cancelOrder(req.user, req.params.code, req.body) });
  } catch (err) { next(err); }
});

router.post('/orders/:code/confirm-delivery', (req, res, next) => {
  try {
    res.json({ order: orders.changeStatus(req.user, req.params.code, { to_status: 'completed', reason: 'تأیید تحویل توسط مشتری' }) });
  } catch (err) { next(err); }
});

// ---------- staff (warehouse / finance / support / admin) ----------

router.get('/staff/orders', requireRole('warehouse', 'finance', 'support', 'admin'), (req, res, next) => {
  try {
    res.json(orders.listOrders(req.user, { ...req.query, all: '1' }));
  } catch (err) { next(err); }
});

router.post('/staff/orders/:code/status', requireRole('warehouse', 'finance', 'support', 'admin'), (req, res, next) => {
  try {
    res.json({ order: orders.changeStatus(req.user, req.params.code, req.body) });
  } catch (err) { next(err); }
});

module.exports = router;
