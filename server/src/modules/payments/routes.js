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

/**
 * Live provider callback (Zarinpal & friends) — public, because the customer's
 * browser is the one that arrives here. Trust comes from verifying the payment
 * against the provider's API, not from the caller.
 */
router.get('/payments/callback', rateLimit({ name: 'pay-provider-cb', windowSec: 60, max: 60 }), async (req, res, next) => {
  try {
    const ref = req.query.ref || req.query.payment_id;
    if (!ref) {
      res.redirect(303, '/pay/result?status=failed');
      return;
    }
    const result = await payments.providerCallback(String(ref), req.query);
    const status = result.payment.status;
    res.redirect(303, `/pay/result?status=${status}&ref=${encodeURIComponent(result.payment.id)}`);
  } catch (err) {
    // Never leak a stack trace to a customer coming back from a bank.
    res.redirect(303, '/pay/result?status=failed');
  }
});

router.get('/payments/:id', requireAuth, (req, res, next) => {
  try {
    const row = payments.getPaymentFor(req.user, req.params.id);
    res.json({ payment: payments.paymentToJson(row) });
  } catch (err) { next(err); }
});

/**
 * Entry point the customer is sent to after "pay".
 *
 * With a live provider configured this creates the provider session and
 * redirects; otherwise it renders the built-in signed sandbox page. The
 * decision lives in providers.paymentProvider(), never in the route.
 */
router.get('/payments/:id/gateway', requireAuth, async (req, res, next) => {
  try {
    const row = payments.getPaymentFor(req.user, req.params.id);
    if (row.status !== 'pending') {
      res.status(409).json({
        error: { code: 'INVALID_STATE', message: 'این پرداخت دیگر در انتظار نیست.', requestId: req.id }
      });
      return;
    }
    const started = await payments.gatewayStart(row);
    if (started.mode === 'redirect') {
      res.redirect(303, started.url);
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
