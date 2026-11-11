'use strict';

const express = require('express');
const multer = require('multer');
const lth = require('./service');
const scheduler = require('./scheduler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { rateLimit } = require('../../middleware/rateLimit');

const router = express.Router();

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

// ---------- Public LTH Ticker, Config, Precision Calculator & Benchmark ----------

router.get('/lth/config', (req, res, next) => {
  try {
    res.json({ config: lth.getPublicConfig() });
  } catch (err) { next(err); }
});

router.post('/lth/calculate', rateLimit({ name: 'lth-calc', windowSec: 60, max: 120 }), (req, res, next) => {
  try {
    res.json(lth.calculateEndpoint(req.body || {}));
  } catch (err) { next(err); }
});

router.get('/lth/health-benchmark', (req, res, next) => {
  try {
    const cfg = lth.getPublicConfig();
    res.json({
      benchmark_1_lth_24h: cfg.benchmarks,
      price_irr: cfg.price_irr,
      stake_percent: cfg.stake_percent,
      withdrawable_percent: cfg.withdrawable_percent,
      lockup_days: cfg.lockup_days
    });
  } catch (err) { next(err); }
});

// ---------- Authenticated Customer LTH Wallet, Packages, Withdrawals & P2P ----------

router.get('/lth/wallet', requireAuth, (req, res, next) => {
  try {
    res.json(lth.getWalletView(req.user));
  } catch (err) { next(err); }
});

router.post('/lth/purchases', requireAuth, rateLimit({ name: 'lth-purchase', windowSec: 60, max: 15 }), (req, res, next) => {
  try {
    const idempotencyKey = (req.header('idempotency-key') || '').slice(0, 100) || null;
    const result = lth.createPurchase(req.user, req.body, idempotencyKey);
    res.status(result.idempotent_replay ? 200 : 201).json(result);
  } catch (err) { next(err); }
});

router.post('/lth/withdrawals', requireAuth, rateLimit({ name: 'lth-withdraw', windowSec: 60, max: 10 }), (req, res, next) => {
  try {
    const result = lth.createShebaWithdrawalOrSell(req.user, req.body || {});
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/lth/withdrawals/:code/cancel', requireAuth, (req, res, next) => {
  try {
    res.json(lth.cancelOwnWithdrawal(req.user, req.params.code));
  } catch (err) { next(err); }
});

router.post('/lth/transfers', requireAuth, rateLimit({ name: 'lth-transfer', windowSec: 60, max: 15 }), (req, res, next) => {
  try {
    const result = lth.createAccountTransfer(req.user, req.body || {});
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ---------- Staff (Finance / Admin) Withdrawal Settlement & Reconciliation ----------

router.get('/staff/lth/withdrawals', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    res.json(lth.listStaffWithdrawals(req.user, req.query));
  } catch (err) { next(err); }
});

router.post('/staff/lth/withdrawals/:code/review', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    res.json(lth.reviewWithdrawal(req.user, req.params.code, req.body || {}));
  } catch (err) { next(err); }
});

router.get('/admin/lth/reconciliation', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    res.json({
      reconciliation: lth.reconcileLedger(),
      treasury: lth.getTreasuryView(),
      scheduler: lth.getClusterSchedulerStatus()
    });
  } catch (err) { next(err); }
});

router.get('/admin/lth/protocol-search', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    res.json(lth.searchProtocol(req.user, req.query || {}));
  } catch (err) { next(err); }
});

router.get('/admin/lth/users/:userId/inspect', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    res.json(lth.inspectUserProtocol(req.user, req.params.userId));
  } catch (err) { next(err); }
});

// ---------- Admin Only: LTH Regulator, Treasury Cap/Fees, Logo Upload & Manual Settlement Tick ----------

router.patch('/admin/lth/settings', requireRole('admin'), (req, res, next) => {
  try {
    res.json(lth.updateSettings(req.user, req.body || {}));
  } catch (err) { next(err); }
});

router.patch('/admin/lth/treasury', requireRole('admin'), (req, res, next) => {
  try {
    res.json(lth.updateTreasurySettings(req.user, req.body || {}));
  } catch (err) { next(err); }
});

router.post('/admin/lth/logo', requireRole('admin'), logoUpload.single('logo'), (req, res, next) => {
  try {
    res.json(lth.updateLogo(req.user, req.file));
  } catch (err) { next(err); }
});

router.post('/admin/lth/settle-due', requireRole('admin'), (req, res, next) => {
  try {
    res.json(scheduler.runCoordinatedRewardTick());
  } catch (err) { next(err); }
});

module.exports = router;
