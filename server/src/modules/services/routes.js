'use strict';

const express = require('express');
const path = require('path');
const multer = require('multer');
const services = require('./service');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { rateLimit } = require('../../middleware/rateLimit');
const config = require('../../config');
const { ApiError } = require('../../utils/errors');
const { uuid } = require('../../utils/validate');

const router = express.Router();

const privateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.storageDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
      cb(null, `${uuid()}${ext}`);
    }
  }),
  limits: { fileSize: config.maxUploadBytes, files: 5 },
  fileFilter: (req, file, cb) => {
    if (config.allowedUploadMimes.includes(file.mimetype)) cb(null, true);
    else cb(ApiError.validation('نوع فایل مجاز نیست.', [{ field: 'files', message: `نوع ${file.mimetype} مجاز نیست.` }]));
  }
});

// ---------- customer ----------

router.get('/service-categories', (req, res) => {
  res.json({ items: services.listServiceCategories() });
});

router.get('/services', (req, res, next) => {
  try {
    res.json(services.listServices(req.query));
  } catch (err) { next(err); }
});

router.get('/services/:slug', (req, res, next) => {
  try {
    res.json({ service: services.serviceBySlug(req.params.slug) });
  } catch (err) { next(err); }
});

router.post(
  '/service-requests',
  requireAuth,
  rateLimit({ name: 'create-sreq', windowSec: 60, max: 10 }),
  privateUpload.array('files', 5),
  (req, res, next) => {
    try {
      const result = services.createRequest(req.user, req.body, req.files || []);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

router.get('/service-requests', requireAuth, (req, res, next) => {
  try {
    res.json(services.listMine(req.user, req.query));
  } catch (err) { next(err); }
});

router.get('/service-requests/:code', requireAuth, (req, res, next) => {
  try {
    res.json({ request: services.getRequest(req.user, req.params.code) });
  } catch (err) { next(err); }
});

router.post('/service-requests/:code/messages', requireAuth, rateLimit({ name: 'sreq-msg', windowSec: 60, max: 30 }), (req, res, next) => {
  try {
    const result = services.postMessage(req.user, req.params.code, req.body, { internal: false });
    res.status(201).json({ request: result });
  } catch (err) { next(err); }
});

router.post('/service-requests/:code/cancel', requireAuth, (req, res, next) => {
  try {
    res.json({ request: services.cancelByCustomer(req.user, req.params.code, req.body) });
  } catch (err) { next(err); }
});

router.post(
  '/service-requests/:code/files',
  requireAuth,
  privateUpload.array('files', 5),
  (req, res, next) => {
    try {
      res.status(201).json({ request: services.customerUploadFiles(req.user, req.params.code, req.files || []) });
    } catch (err) { next(err); }
  }
);

// ---------- admin service catalog ----------

router.get('/admin/services', requireRole('admin'), (req, res, next) => {
  try {
    res.json(services.listServicesAdmin(req.query));
  } catch (err) { next(err); }
});

router.post('/admin/services', requireRole('admin'), (req, res, next) => {
  try {
    res.status(201).json({ service: services.createService(req.user, req.body) });
  } catch (err) { next(err); }
});

router.patch('/admin/services/:id', requireRole('admin'), (req, res, next) => {
  try {
    res.json({ service: services.updateService(req.user, req.params.id, req.body) });
  } catch (err) { next(err); }
});

// ---------- staff ----------

router.get('/staff/service-requests', requireRole('operator', 'admin', 'support'), (req, res, next) => {
  try {
    res.json(services.staffQueue(req.user, req.query));
  } catch (err) { next(err); }
});

router.get('/staff/service-requests/:id', requireRole('operator', 'admin', 'support', 'finance'), (req, res, next) => {
  try {
    res.json({ request: services.staffGetRequest(req.user, req.params.id) });
  } catch (err) { next(err); }
});

router.post('/staff/service-requests/:id/assign', requireRole('operator', 'admin'), (req, res, next) => {
  try {
    res.json({ request: services.assignRequest(req.user, req.params.id, req.body) });
  } catch (err) { next(err); }
});

router.post('/staff/service-requests/:id/team', requireRole('operator', 'admin'), (req, res, next) => {
  try {
    res.json({ request: services.transferTeam(req.user, req.params.id, req.body) });
  } catch (err) { next(err); }
});

router.post('/staff/service-requests/:id/status', requireRole('operator', 'admin', 'finance'), (req, res, next) => {
  try {
    res.json({ request: services.changeStatus(req.user, req.params.id, req.body) });
  } catch (err) { next(err); }
});

router.post('/staff/service-requests/:id/messages', requireRole('operator', 'admin'), (req, res, next) => {
  try {
    const internal = Boolean(req.body.internal);
    const result = services.postMessage(req.user, req.params.code || req.params.id, req.body, { internal });
    res.status(201).json({ request: result });
  } catch (err) { next(err); }
});

router.post(
  '/staff/service-requests/:id/files',
  requireRole('operator', 'admin'),
  privateUpload.array('files', 5),
  (req, res, next) => {
    try {
      const result = services.uploadFiles(req.user, req.params.id, req.files || [], req.body);
      res.status(201).json({ request: result });
    } catch (err) { next(err); }
  }
);

module.exports = router;
