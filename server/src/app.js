'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { get } = require('./db');
const { requestId } = require('./middleware/requestId');
const { parseCookies, attachUser, csrfProtection } = require('./middleware/auth');
const { securityHeaders, sameOriginGuard } = require('./middleware/security');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { rateLimit } = require('./middleware/rateLimit');
const { ApiError } = require('./utils/errors');
const { integrityCheck, getDb } = require('./db');
const logger = require('./utils/logger');

const authRoutes = require('./modules/auth/routes');
const userRoutes = require('./modules/users/routes');
const catalogRoutes = require('./modules/catalog/routes');
const cartRoutes = require('./modules/cart/routes');
const orderRoutes = require('./modules/orders/routes');
const paymentRoutes = require('./modules/payments/routes');
const serviceRoutes = require('./modules/services/routes');
const supportRoutes = require('./modules/support/routes');
const fileRoutes = require('./modules/files/routes');
const notificationRoutes = require('./modules/notifications/routes');
const adminRoutes = require('./modules/admin/routes');
const adminConsoleRoutes = require('./modules/admin/console');
const adminSecurityRoutes = require('./modules/admin/security');
const lthRoutes = require('./modules/lth/routes');

const pkg = require('../package.json');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Only trust the reverse proxy in front of us (one hop), not arbitrary clients.
  app.set('trust proxy', config.security.trustProxy ? 1 : false);
  app.set('query parser', 'simple');
  app.set('json escape', true);

  app.use(requestId);
  app.use(securityHeaders);

  // Lightweight access log (skips static assets) so proxy/preview traffic stays visible in container logs.
  app.use((req, res, next) => {
    const p = req.path;
    if (p.startsWith('/assets/') || p.startsWith('/uploads/') || p === '/favicon.ico') return next();
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('http', {
        method: req.method,
        path: (req.originalUrl || p).split('?')[0],
        status: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
        requestId: req.id,
        host: req.header('x-forwarded-host') || req.header('host') || null,
        referer: req.header('referer') || null
      });
    });
    next();
  });

  // Strict JSON/urlencoded parsers: bounded size, no prototype pollution, no nested objects.
  app.use(express.json({ limit: '512kb', strict: true, type: ['application/json', 'application/*+json'] }));
  app.use(express.urlencoded({ extended: false, limit: '256kb', parameterLimit: 100 }));
  app.use(parseCookies);
  app.use(attachUser);

  // Cross-site request defence (origin check) + double-submit CSRF token.
  app.use('/api', sameOriginGuard);
  app.use('/api/v1', csrfProtection);
  // Global API budget per IP: protects every endpoint, including ones without their own limiter.
  app.use('/api/v1', rateLimit({ name: 'api-global', windowSec: 60, max: config.security.apiRateLimitPerMinute }));

  // Never cache private API responses (§16).
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Health check (§14 & §19)
  const healthHandler = (req, res) => {
    let dbOk = false;
    try {
      const row = get('SELECT 1 AS ok');
      dbOk = Boolean(row && row.ok === 1);
    } catch {
      dbOk = false;
    }
    let integrity = null;
    let migrations = 0;
    if (dbOk) {
      try { integrity = integrityCheck()[0] || 'unknown'; } catch { integrity = 'error'; }
      try { migrations = get('SELECT COUNT(*) AS c FROM schema_migrations').c; } catch { migrations = 0; }
      try { void getDb(); } catch { /* ensure the handle is open for integrity checks */ }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      service: 'central-mine-api',
      version: pkg.version,
      db: dbOk ? 'ok' : 'error',
      db_integrity: integrity,
      schema_version: migrations,
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      integrations: {
        payment_gateway: { mode: 'sandbox', real_connected: false },
        sms_otp: { mode: 'sandbox', real_connected: false },
        push_notifications: { mode: 'inactive', real_connected: false }
      }
    });
  };
  app.get('/health', healthHandler);
  app.get('/api/v1/health', healthHandler);

  // Housekeeping is an admin/maintenance operation, never public: protected by a token.
  app.post('/api/v1/maintenance/housekeeping', (req, res, next) => {
    const token = req.header('x-maintenance-token');
    if (!token || !process.env.CM_MAINTENANCE_TOKEN || token !== process.env.CM_MAINTENANCE_TOKEN) {
      return next(ApiError.forbidden('دسترسی به عملیات نگهداری مجاز نیست.'));
    }
    const { housekeeping } = require('./db');
    const out = housekeeping();
    return res.json({ ok: true, removed: out });
  });

  // Public product images directory
  const publicUploadsDir = path.join(config.storageDir, '..', 'public');
  fs.mkdirSync(publicUploadsDir, { recursive: true });
  app.use('/uploads', express.static(publicUploadsDir, {
    maxAge: '7d',
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
  }));

  // API v1 routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/me', userRoutes);
  app.use('/api/v1/cart', cartRoutes);
  app.use('/api/v1', catalogRoutes);
  app.use('/api/v1', orderRoutes);
  app.use('/api/v1', paymentRoutes);
  app.use('/api/v1', serviceRoutes);
  app.use('/api/v1', supportRoutes);
  app.use('/api/v1', fileRoutes);
  app.use('/api/v1', notificationRoutes);
  app.use('/api/v1/admin/console/security', adminSecurityRoutes);
  app.use('/api/v1/admin/console', adminConsoleRoutes);
  app.use('/api/v1', adminRoutes);
  app.use('/api/v1', lthRoutes);

  // Unknown API routes return JSON 404
  app.use('/api', notFoundHandler);

  // Serve built frontend SPA when present
  if (fs.existsSync(config.clientDist)) {
    app.get('/sw.js', (req, res, next) => {
      const swFile = path.join(config.clientDist, 'sw.js');
      if (!fs.existsSync(swFile)) return next();
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.sendFile(swFile);
    });
    app.use(
      '/assets',
      express.static(path.join(config.clientDist, 'assets'), {
        immutable: true,
        maxAge: '365d'
      }),
      (req, res) => res.status(404).type('text/plain').send('Asset not found')
    );
    app.use(express.static(config.clientDist, {
      index: false,
      maxAge: '1h'
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/assets/')) {
        return next();
      }
      const indexFile = path.join(config.clientDist, 'index.html');
      if (!fs.existsSync(indexFile)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(indexFile);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
