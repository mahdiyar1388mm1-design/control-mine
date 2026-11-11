'use strict';

const { get } = require('../db');
const { ApiError } = require('../utils/errors');
const { verifyToken } = require('../utils/token');

function extractToken(req) {
  const header = req.header('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (req.cookies && req.cookies.cm_token) return req.cookies.cm_token;
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
        req.cookies[key] = decodeURIComponent(value);
      }
    }
  }
  next();
}

/** Attaches req.user = { id, role, phone, full_name, status } when a valid session exists. */
function attachUser(req, res, next) {
  req.user = null;
  const token = extractToken(req);
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload || !payload.sub || !payload.sid) return next();
  const session = get('SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE id = ?', [payload.sid]);
  if (!session || session.revoked_at || session.expires_at <= new Date().toISOString()) return next();
  const user = get('SELECT id, phone, full_name, role, status FROM users WHERE id = ?', [session.user_id]);
  if (!user || user.status !== 'active') return next();
  req.user = user;
  req.sessionId = session.id;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(ApiError.unauthorized());
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
}

const STAFF_ROLES = ['operator', 'support', 'warehouse', 'finance', 'admin'];

function requireStaff(req, res, next) {
  return requireRole(...STAFF_ROLES)(req, res, next);
}

module.exports = { parseCookies, attachUser, requireAuth, requireRole, requireStaff, extractToken, STAFF_ROLES };
