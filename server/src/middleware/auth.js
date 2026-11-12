'use strict';

const { get, run } = require('../db');
const { ApiError } = require('../utils/errors');
const { verifyToken, generateCsrfToken, timingSafeEqualStrings } = require('../utils/token');
const config = require('../config');

const COOKIE_TOKEN = config.security.cookieName;
const COOKIE_CSRF = config.security.csrfCookieName;

function extractToken(req) {
  const header = req.header('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (req.cookies && req.cookies[COOKIE_TOKEN]) return req.cookies[COOKIE_TOKEN];
  return null;
}

function parseCookies(req, res, next) {
  req.cookies = {};
  const raw = req.header('cookie');
  if (raw) {
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        try {
          req.cookies[key] = decodeURIComponent(value);
        } catch {
          req.cookies[key] = value;
        }
      }
    }
  }
  next();
}

function cookieOptions({ httpOnly = true, maxAgeMs } = {}) {
  return {
    httpOnly,
    sameSite: 'lax',
    secure: config.security.secureCookies,
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {})
  };
}

/** Attaches req.user = { id, role, phone, full_name, status } when a valid session exists. */
function attachUser(req, res, next) {
  req.user = null;
  const token = extractToken(req);
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload || !payload.sub || !payload.sid) return next();
  const session = get(
    'SELECT id, user_id, expires_at, revoked_at, last_used_at FROM sessions WHERE id = ?',
    [payload.sid]
  );
  if (!session || session.revoked_at) return next();
  const nowIso = new Date().toISOString();
  if (session.expires_at <= nowIso) return next();

  // Idle timeout: a stolen token that is not used for a long time stops working.
  const idleMs = config.sessionIdleSec * 1000;
  if (session.last_used_at && Date.now() - new Date(session.last_used_at).getTime() > idleMs) {
    run('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL',
      [nowIso, 'idle_timeout', session.id]);
    return next();
  }

  const user = get('SELECT id, phone, full_name, role, status FROM users WHERE id = ?', [session.user_id]);
  if (!user || user.status !== 'active') return next();
  req.user = user;
  req.sessionId = session.id;

  // Throttled "last seen" bookkeeping (at most once per minute per session).
  if (!session.last_used_at || Date.now() - new Date(session.last_used_at).getTime() > 60000) {
    run('UPDATE sessions SET last_used_at = ? WHERE id = ?', [nowIso, session.id]);
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(ApiError.unauthorized());
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      // Do not leak which roles exist; log the attempt for audit visibility.
      return next(ApiError.forbidden());
    }
    next();
  };
}

const STAFF_ROLES = ['operator', 'support', 'warehouse', 'finance', 'admin'];

function requireStaff(req, res, next) {
  return requireRole(...STAFF_ROLES)(req, res, next);
}

/**
 * Authentication endpoints that must never be blocked by CSRF.
 *
 * They either create the session (login/register/otp/refresh) or exist precisely
 * to recover from a broken one (logout/otp). Blocking them turns a stale cookie
 * into a lockout: with `cm_token` still set but `cm_csrf` missing, even *logging
 * in again* would answer 403 and the user cannot fix anything from the UI.
 * None of them is exploitable as CSRF:
 *  - login/register/otp-request/otp-verify require credentials in the body,
 *  - refresh requires the httpOnly refresh cookie (unreadable by an attacker),
 *  - logout with a cookie only ends the session — an attacker forcing a logout is
 *    a nuisance, not a compromise, and the header token is still required.
 */
const CSRF_EXEMPT_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/otp/request',
  '/api/v1/auth/otp/verify',
  '/api/v1/auth/mfa/verify',
  '/api/v1/admin/console/security/unlock'
]);

/**
 * Double-submit CSRF protection for cookie-authenticated state-changing requests.
 * Bearer-token clients (the SPA after login) are not vulnerable to CSRF because
 * the browser never attaches the header automatically; they are exempt.
 */
function csrfProtection(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();
  // The bank/SMS gateway posts here without our cookies; it is signature-verified instead.
  if (req.originalUrl && req.originalUrl.startsWith('/api/v1/payments/sandbox/callback')) return next();

  const hasBearer = (req.header('authorization') || '').toLowerCase().startsWith('bearer ');
  if (hasBearer) return next();

  const hasSessionCookie = Boolean(req.cookies && req.cookies[COOKIE_TOKEN]);
  if (!hasSessionCookie) return next();

  // Session-creating / session-recovering endpoints stay reachable (see above).
  const pathOnly = (req.originalUrl || '').split('?')[0].replace(/\/$/, '');
  if (CSRF_EXEMPT_PATHS.has(pathOnly)) return next();

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

  const headerToken = req.header(config.security.csrfHeaderName);
  const cookieToken = req.cookies[COOKIE_CSRF];
  if (!headerToken || !cookieToken || !timingSafeEqualStrings(headerToken, cookieToken)) {
    return next(ApiError.forbidden('توکن امنیتی درخواست نامعتبر است (CSRF).'));
  }
  return next();
}

/** Sets the rotating double-submit CSRF cookie for the browser client. */
function issueCsrfCookie(res) {
  const token = generateCsrfToken();
  res.cookie(COOKIE_CSRF, token, cookieOptions({ httpOnly: false, maxAgeMs: config.refreshTtlSec * 1000 }));
  return token;
}

module.exports = {
  COOKIE_TOKEN, COOKIE_CSRF, cookieOptions,
  parseCookies, attachUser, requireAuth, requireRole, requireStaff,
  extractToken, csrfProtection, issueCsrfCookie, STAFF_ROLES
};
