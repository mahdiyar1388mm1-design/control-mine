'use strict';

const { ApiError } = require('../utils/errors');

/**
 * In-memory sliding-window rate limiter.
 * Suitable for a single-process deployment; use a shared store (e.g. Redis)
 * when running multiple instances (see docs/06-deployment-ops.md).
 */
const buckets = new Map();

function rateLimit({ name, windowSec = 60, max = 30, keyFn } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const identity = keyFn ? keyFn(req) : (req.user ? req.user.id : req.ip);
    const key = `${name}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowSec * 1000 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return next(ApiError.rateLimited());
    }
    if (buckets.size > 20000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    next();
  };
}

function resetRateLimits() {
  buckets.clear();
}

module.exports = { rateLimit, resetRateLimits };
