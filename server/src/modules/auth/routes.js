'use strict';

const express = require('express');
const authService = require('./service');
const mfa = require('./mfa');
const { requireAuth, COOKIE_TOKEN, COOKIE_CSRF, cookieOptions, issueCsrfCookie } = require('../../middleware/auth');
const { rateLimit, clientIp } = require('../../middleware/rateLimit');
const config = require('../../config');
const { audit } = require('../platform/service');

const router = express.Router();

function setAuthCookies(res, result) {
  res.cookie(COOKIE_TOKEN, result.token, cookieOptions({ httpOnly: true, maxAgeMs: config.tokenTtlSec * 1000 }));
  if (result.refreshToken) {
    res.cookie('cm_refresh', result.refreshToken, cookieOptions({ httpOnly: true, maxAgeMs: config.refreshTtlSec * 1000 }));
  }
  issueCsrfCookie(res);
}

function clearAuthCookies(res) {
  res.clearCookie(COOKIE_TOKEN, { path: '/' });
  res.clearCookie('cm_refresh', { path: '/' });
  res.clearCookie(COOKIE_CSRF, { path: '/' });
}

function meta(req) {
  return { ip: clientIp(req), userAgent: req.header('user-agent') };
}

// Brute force slows down exponentially; 10 attempts per IP per 5 minutes is plenty
// for a human, and the per-phone lockout below is the real defence.
router.post('/register', rateLimit({ name: 'register', windowSec: 300, max: 10 }), (req, res, next) => {
  try {
    const result = authService.register(req.body, meta(req));
    setAuthCookies(res, result);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/login', rateLimit({ name: 'login', windowSec: 300, max: 30 }), (req, res, next) => {
  try {
    const result = authService.login(req.body, meta(req));
    setAuthCookies(res, result);
    res.json(result);
  } catch (err) {
    if (err && err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
    next(err);
  }
});

router.post('/refresh', rateLimit({ name: 'refresh', windowSec: 60, max: 60 }), (req, res, next) => {
  try {
    const refreshToken = (req.body && req.body.refresh_token) || (req.cookies && req.cookies.cm_refresh);
    if (!refreshToken) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'نشست منقضی شده است؛ دوباره وارد شوید.', requestId: req.id }
      });
    }
    const result = authService.refresh({ refresh_token: refreshToken }, meta(req));
    setAuthCookies(res, result);
    return res.json(result);
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

router.post('/mfa/verify', rateLimit({ name: 'mfa-verify', windowSec: 300, max: 20 }), (req, res, next) => {
  try {
    const user = mfa.verifyChallenge(req.body, meta(req));
    const result = authService.completeLogin(user, meta(req), 'auth.login_mfa');
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/mfa/status', requireAuth, (req, res, next) => {
  try {
    res.json({ ...mfa.status(req.user.id), enforced_for_role: mfa.enforcedRoles().includes(req.user.role) });
  } catch (err) { next(err); }
});

router.post('/mfa/setup', requireAuth, rateLimit({ name: 'mfa-setup', windowSec: 300, max: 10 }), (req, res, next) => {
  try { res.json(mfa.setup(req.user.id)); } catch (err) { next(err); }
});

router.post('/mfa/enable', requireAuth, rateLimit({ name: 'mfa-enable', windowSec: 300, max: 10 }), (req, res, next) => {
  try {
    res.json(mfa.enable(req.user.id, req.body));
  } catch (err) { next(err); }
});

router.post('/mfa/disable', requireAuth, rateLimit({ name: 'mfa-disable', windowSec: 300, max: 10 }), (req, res, next) => {
  try {
    if (mfa.enforcedRoles().includes(req.user.role)) {
      throw require('../../utils/errors').ApiError.forbidden(
        'برای نقش‌های مدیریتی، ورود دومرحله‌ای فقط توسط مدیر سامانه از مرکز امنیت قابل غیرفعال‌سازی است.'
      );
    }
    res.json(mfa.disable(req.user.id, req.body));
  } catch (err) { next(err); }
});

router.post('/mfa/recovery-codes', requireAuth, rateLimit({ name: 'mfa-recovery', windowSec: 600, max: 10 }), (req, res, next) => {
  try { res.json(mfa.regenerateRecoveryCodes(req.user.id, req.body)); } catch (err) { next(err); }
});

router.post('/otp/request', rateLimit({ name: 'otp-request', windowSec: 300, max: 10 }), (req, res, next) => {
  try {
    res.json(authService.requestOtp(req.body, meta(req)));
  } catch (err) { next(err); }
});

router.post('/otp/verify', rateLimit({ name: 'otp-verify', windowSec: 300, max: 20 }), (req, res, next) => {
  try {
    const result = authService.verifyOtp(req.body, meta(req));
    setAuthCookies(res, result);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, (req, res, next) => {
  try {
    const out = authService.logout(req.sessionId, req.user.id);
    clearAuthCookies(res);
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/logout-all', requireAuth, rateLimit({ name: 'logout-all', windowSec: 300, max: 10 }), (req, res, next) => {
  try {
    const out = authService.logoutAll(req.user.id, req.sessionId);
    clearAuthCookies(res);
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, (req, res, next) => {
  try {
    res.json({ user: authService.me(req.user.id) });
  } catch (err) { next(err); }
});

/** Plain CSRF token for browser clients (only meaningful alongside the session cookie). */
router.get('/csrf', (req, res) => {
  const existing = req.cookies && req.cookies[COOKIE_CSRF];
  const token = existing || issueCsrfCookie(res);
  res.json({ csrf_token: token });
});

router.get('/sessions', requireAuth, (req, res, next) => {
  try {
    res.json(authService.listSessions(req.user.id, req.sessionId));
  } catch (err) { next(err); }
});

router.delete('/sessions/:id', requireAuth, (req, res, next) => {
  try {
    res.json(authService.revokeSession(req.user.id, req.params.id, req.sessionId));
  } catch (err) { next(err); }
});

router.post('/change-password', requireAuth, rateLimit({ name: 'change-password', windowSec: 600, max: 10 }), (req, res, next) => {
  try {
    res.json(authService.changePassword(req.user.id, req.sessionId, req.body));
  } catch (err) { next(err); }
});

/** Step-up authentication: returns a short-lived proof for sensitive admin actions. */
router.post('/verify-identity', requireAuth, rateLimit({ name: 'verify-identity', windowSec: 600, max: 10 }), (req, res, next) => {
  try {
    const password = req.body && req.body.password;
    const out = authService.verifyIdentity(req.user.id, password, req.body && req.body.purpose, req.sessionId);
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/password-policy', (req, res) => {
  res.json({ policy: authService.passwordPolicy() });
});

router.get('/login-history', requireAuth, (req, res, next) => {
  try {
    const { all } = require('../../db');
    const items = all(
      `SELECT success, reason, ip, created_at FROM login_attempts
        WHERE phone = (SELECT phone FROM users WHERE id = ?)
        ORDER BY created_at DESC LIMIT 25`,
      [req.user.id]
    );
    res.json({ items });
  } catch (err) { next(err); }
});

module.exports = router;
// `audit` is imported for future route-level events; keep the binding referenced.
void audit;
