'use strict';

const express = require('express');
const payments = require('./service');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { rateLimit } = require('../../middleware/rateLimit');

const router = express.Router();

// Sandbox callback accepts HTML form posts (urlencoded) as well as JSON.
router.post(
  '/payments/sandbox/callback',
  rateLimit({ name: 'pay-callback', windowSec: 60, max: 30 }),
  (req, res, next) => {
    try {
      const result = payments.sandboxCallback(req.body);
      const wantsHtml = (req.header('content-type') || '').includes('urlencoded') || (req.header('accept') || '').includes('text/html');
      if (wantsHtml) {
        const status = result.payment.status;
        const target = status === 'paid'
          ? `/pay/result?status=paid&ref=${result.payment.id}`
          : `/pay/result?status=${status}&ref=${result.payment.id}`;
        res.redirect(303, target);
        return;
      }
      res.json(result);
    } catch (err) { next(err); }
  }
);

router.post('/payments', requireAuth, rateLimit({ name: 'create-payment', windowSec: 60, max: 15 }), (req, res, next) => {
  try {
    const idempotencyKey = (req.header('idempotency-key') || '').slice(0, 100) || null;
    const result = payments.createPayment(req.user, req.body, idempotencyKey);
    res.status(result.idempotent_replay ? 200 : 201).json(result);
  } catch (err) { next(err); }
});

router.get('/payments', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    res.json(payments.listPayments(req.user, req.query));
  } catch (err) { next(err); }
});

router.get('/payments/:id', requireAuth, (req, res, next) => {
  try {
    const row = payments.getPaymentFor(req.user, req.params.id);
    res.json({ payment: payments.paymentToJson(row) });
  } catch (err) { next(err); }
});

router.get('/payments/:id/gateway', requireAuth, (req, res, next) => {
  try {
    const row = payments.getPaymentFor(req.user, req.params.id);
    if (row.status !== 'pending') {
      res.status(409).json({
        error: { code: 'INVALID_STATE', message: 'این پرداخت دیگر در انتظار نیست.', requestId: req.id }
      });
      return;
    }
    res.type('html').send(payments.gatewayHtml(row));
  } catch (err) { next(err); }
});

router.post('/payments/:id/refund', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    res.json(payments.refundPayment(req.user, req.params.id, req.body));
  } catch (err) { next(err); }
});

module.exports = router;
