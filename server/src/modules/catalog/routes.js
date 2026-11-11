'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const catalog = require('./service');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { rateLimit } = require('../../middleware/rateLimit');
const { uuid } = require('../../utils/validate');
const { ApiError } = require('../../utils/errors');
const config = require('../../config');
const { audit } = require('../platform/service');

const router = express.Router();

const publicUploadsDir = path.join(config.storageDir, '..', 'public');
fs.mkdirSync(publicUploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, publicUploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.png';
      cb(null, `${uuid()}${ext}`);
    }
  }),
  limits: { fileSize: config.maxUploadBytes, files: 5 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(ApiError.validation('فقط تصویر JPEG/PNG/WebP مجاز است.'));
  }
});

// ---------- public ----------

router.get('/categories', (req, res) => {
  res.json({ items: catalog.listCategories() });
});

router.get('/brands', (req, res) => {
  res.json({ items: catalog.listBrands() });
});

router.get('/products', rateLimit({ name: 'search', windowSec: 60, max: 60 }), (req, res) => {
  res.json(catalog.listProducts(req.query));
});

router.get('/products/:slug', (req, res, next) => {
  try {
    res.json({ product: catalog.productBySlug(req.params.slug) });
  } catch (err) { next(err); }
});

// ---------- admin ----------

router.use('/admin', requireAuth);

router.get('/admin/products', requireRole('admin'), (req, res) => {
  res.json(catalog.listProductsAdmin(req.query));
});

router.get('/admin/products/:slug', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    res.json({ product: catalog.productBySlug(req.params.slug, { includeCost: true, includeInactive: true }) });
  } catch (err) { next(err); }
});

router.post('/admin/categories', requireRole('admin'), (req, res, next) => {
  try {
    res.status(201).json({ category: catalog.createCategory(req.user, req.body) });
  } catch (err) { next(err); }
});

router.post('/admin/brands', requireRole('admin'), (req, res, next) => {
  try {
    res.status(201).json({ brand: catalog.createBrand(req.user, req.body) });
  } catch (err) { next(err); }
});

router.get('/admin/skus', requireRole('admin', 'warehouse'), (req, res) => {
  res.json(catalog.listSkusAdmin(req.query));
});

router.get('/admin/skus/:id/movements', requireRole('admin', 'warehouse'), (req, res) => {
  res.json({ items: catalog.listStockMovements(req.params.id) });
});

router.post('/admin/products', requireRole('admin'), (req, res, next) => {
  try {
    res.status(201).json({ product: catalog.createProduct(req.user, req.body) });
  } catch (err) { next(err); }
});

router.patch('/admin/products/:id', requireRole('admin'), (req, res, next) => {
  try {
    res.json({ product: catalog.updateProduct(req.user, req.params.id, req.body) });
  } catch (err) { next(err); }
});

router.delete('/admin/products/:id', requireRole('admin'), (req, res, next) => {
  try {
    res.json(catalog.deleteProduct(req.user, req.params.id));
  } catch (err) { next(err); }
});

router.post('/admin/products/:id/images', requireRole('admin'), upload.array('images', 5), (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) throw ApiError.validation('فایل تصویری دریافت نشد.');
    const ids = [];
    files.forEach((file, index) => {
      const id = uuid();
      ids.push(id);
      const alt = (req.body.alt_text || req.body.alt || '').slice(0, 200);
      // eslint-disable-next-line global-require
      require('../../db').run(
        'INSERT INTO product_images (id, product_id, path, alt_text, sort_order) VALUES (?, ?, ?, ?, ?)',
        [id, req.params.id, `/uploads/${file.filename}`, alt, index]
      );
    });
    audit(req.user.id, req.user.role, 'catalog.upload_images', 'product', req.params.id, { count: files.length });
    res.status(201).json({ ok: true, ids, paths: files.map((f) => `/uploads/${f.filename}`) });
  } catch (err) { next(err); }
});

router.post('/admin/products/:id/skus', requireRole('admin'), (req, res, next) => {
  try {
    res.status(201).json({ sku: catalog.createSku(req.user, req.params.id, req.body) });
  } catch (err) { next(err); }
});

router.patch('/admin/skus/:id', requireRole('admin'), (req, res, next) => {
  try {
    res.json({ sku: catalog.updateSku(req.user, req.params.id, req.body) });
  } catch (err) { next(err); }
});

router.post('/admin/skus/:id/stock', requireRole('admin', 'warehouse'), (req, res, next) => {
  try {
    res.json({ sku: catalog.adjustStock(req.user, req.params.id, req.body) });
  } catch (err) { next(err); }
});

module.exports = router;
