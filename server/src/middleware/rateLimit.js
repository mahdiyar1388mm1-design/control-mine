'use strict';

/**
 * In-memory sliding-window rate limiter with route-aware budgets.
 *
 * Suitable for a single-process deployment; swap `buckets` for a shared store
 * (Redis) when running multiple instances. Identity defaults to the session user
 * when authenticated, otherwise the client IP (honouring X-Forwarded-For through
 * Express' `trust proxy` setting).
 */
const buckets = new Map();
const MAX_BUCKETS = 50000;

function clientIp(req) {
  const forwarded = String(req.header('x-forwarded-for') || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimit({ name, windowSec = 60, max = 30, keyFn, skipOnSuccess = false } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const identity = keyFn ? keyFn(req) : (req.user ? `u:${req.user.id}` : `ip:${clientIp(req)}`);
    const key = `${name}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowSec * 1000, blockedUntil: 0 };
      buckets.set(key, bucket);
    }
    if (bucket.blockedUntil && bucket.blockedUntil > now) {
      const retry = Math.ceil((bucket.blockedUntil - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return next(ApiError.rateLimited(`تعداد درخواست‌ها زیاد است؛ ${retry} ثانیه دیگر تلاش کنید.`));
    }
    bucket.count += 1;
    if (bucket.count > max) {
      // Exponential back-off for abusive clients: the more they hammer, the longer the block.
      const overage = bucket.count - max;
      const penaltySec = Math.min(windowSec * 8, windowSec * Math.pow(1.6, Math.min(overage, 8)));
      bucket.blockedUntil = now + penaltySec * 1000;
      res.setHeader('Retry-After', String(Math.ceil(penaltySec)));
      return next(ApiError.rateLimited());
    }
    if (skipOnSuccess) {
      const originalEnd = res.end;
      res.end = function patchedEnd(...args) {
        if (res.statusCode >= 400) bucket.count -= 1;
        return originalEnd.apply(this, args);
      };
    }
    if (buckets.size > MAX_BUCKETS) {
      for (const [k, v] of buckets) if (v.resetAt <= now && (!v.blockedUntil || v.blockedUntil <= now)) buckets.delete(k);
    }
    next();
  };
}

function resetRateLimits() {
  buckets.clear();
}

// Circular require is fine here (errors.js does not import this module).
const { ApiError } = require('../utils/errors');

module.exports = { rateLimit, resetRateLimits, clientIp };
