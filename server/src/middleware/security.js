'use strict';

/**
 * HTTP security headers for the whole site (API + SPA + static assets).
 *
 * The CSP is deliberately strict: scripts only from self, styles from self plus
 * inline (Vite injects a small inline prelude), images from self/data/https,
 * and no embedding of arbitrary third-party frames. `frame-ancestors` follows
 * CM_DENY_IFRAME: the sandbox preview runs the app inside an iframe.
 */
const config = require('../config');

function cspHeader() {
  const frameAncestors = config.security.denyIframe ? "'self'" : "'self' https: http:";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self'",
    // Vite inlines a tiny style bootstrap; fonts are served locally via @fontsource.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests'
  ].join('; ');
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', config.security.denyIframe ? 'SAMEORIGIN' : 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Content-Security-Policy', cspHeader());
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (config.security.secureCookies) {
    res.setHeader('Strict-Transport-Security', `max-age=${config.security.hstsMaxAge}; includeSubDomains`);
  }
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

/** Block cross-site browser requests that arrive with a foreign Origin. */
function sameOriginGuard(req, res, next) {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!unsafe) return next();
  if (!req.originalUrl.startsWith('/api/')) return next();
  // Payment callbacks arrive from the gateway's domain by design.
  if (req.originalUrl.startsWith('/api/v1/payments/sandbox/callback')) return next();
  if (req.originalUrl.startsWith('/api/v1/payments/callback')) return next();
  const origin = req.header('origin');
  if (!origin) return next(); // same-origin form posts / server-side clients
  const host = req.header('x-forwarded-host') || req.header('host');
  try {
    const originUrl = new URL(origin);
    const isSameHost = host && originUrl.host === host;
    const isLocalDev = ['localhost', '127.0.0.1'].includes(originUrl.hostname);
    if (!isSameHost && !isLocalDev) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'درخواست از مبدأ غیرمجاز مسدود شد.', requestId: req.id }
      });
    }
  } catch {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'مبدأ درخواست نامعتبر است.', requestId: req.id }
    });
  }
  return next();
}

module.exports = { securityHeaders, sameOriginGuard, cspHeader };
