'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { get } = require('./db');
const { requestId } = require('./middleware/requestId');
const { parseCookies, attachUser } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { ApiError } = require('./utils/errors');

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
const lthRoutes = require('./modules/lth/routes');

const pkg = require('../package.json');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);

  // Baseline security headers (iframe-friendly unless CM_DENY_IFRAME=1 for standalone prod).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (process.env.CM_DENY_IFRAME === '1') {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(parseCookies);
  app.use(attachUser);

  // CSRF defense for cookie-authenticated state-changing API calls.
  app.use('/api/v1', (req, res, next) => {
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) return next();
    if (req.path === '/payments/sandbox/callback') return next();
    const hasBearer = (req.header('authorization') || '').toLowerCase().startsWith('bearer ');
    if (hasBearer) return next();
    if (req.cookies && req.cookies.cm_token) {
      const origin = req.header('origin');
      const host = req.header('x-forwarded-host') || req.header('host');
      if (origin) {
        try {
          const originHost = new URL(origin).host;
          if (host && originHost !== host) {
            return next(ApiError.forbidden('درخواست از مبدأ غیرمجاز (CSRF) مسدود شد.'));
          }
        } catch {
          return next(ApiError.forbidden('مبدأ درخواست نامعتبر است.'));
        }
      }
      const ct = (req.header('content-type') || '').toLowerCase();
      const customClient = req.header('x-cm-client');
      if (!customClient && !ct.includes('application/json') && !ct.includes('multipart/form-data')) {
        return next(ApiError.forbidden('هدر امنیتی درخواست نامعتبر است.'));
      }
    }
    return next();
  });

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
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      service: 'central-mine-api',
      version: pkg.version,
      db: dbOk ? 'ok' : 'error',
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

  // Public product images directory
  const publicUploadsDir = path.join(config.storageDir, '..', 'public');
  fs.mkdirSync(publicUploadsDir, { recursive: true });
  app.use('/uploads', express.static(publicUploadsDir, {
    maxAge: '7d',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
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
  app.use('/api/v1', adminRoutes);
  app.use('/api/v1', lthRoutes);

  // Unknown API routes return JSON 404
  app.use('/api', notFoundHandler);

  // Serve built frontend SPA when present
  if (fs.existsSync(config.clientDist)) {
    app.use('/assets', express.static(path.join(config.clientDist, 'assets'), {
      immutable: true,
      maxAge: '365d'
    }));
    app.use(express.static(config.clientDist, {
      index: false,
      maxAge: '1h'
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
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
