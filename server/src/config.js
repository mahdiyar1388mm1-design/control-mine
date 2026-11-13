'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const dataDir = process.env.CM_DATA_DIR || path.join(root, 'data');
const storageDir = process.env.CM_STORAGE_DIR || path.join(root, 'storage');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(storageDir, 'private'), { recursive: true });

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';

// Secret: from env for production; otherwise generated once and persisted locally (dev only).
function loadSecret() {
  if (process.env.CM_SECRET) return process.env.CM_SECRET;
  if (isProd) {
    throw new Error(
      'CM_SECRET در محیط تولید الزامی است (حداقل ۶۴ نویسهٔ تصادفی). ' +
      'مقدار امن با دستور `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"` بسازید.'
    );
  }
  const secretFile = path.join(dataDir, 'dev-secret.key');
  try {
    return fs.readFileSync(secretFile, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    return secret;
  }
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const secret = loadSecret();

/**
 * Backup encryption key. Production requires an explicit CM_BACKUP_KEY;
 * development gets a persisted random key so the backup flow is testable.
 */
function loadBackupKey() {
  if (process.env.CM_BACKUP_KEY) return process.env.CM_BACKUP_KEY;
  if (isProd) return null;
  const keyFile = path.join(dataDir, 'dev-backup.key');
  try {
    return fs.readFileSync(keyFile, 'utf8').trim();
  } catch {
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
    return key;
  }
}

module.exports = {
  env,
  isProd,
  isTest,
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.CM_DB_PATH || path.join(dataDir, 'central-mine.db'),
  storageDir: path.join(storageDir, 'private'),
  backupsDir: path.join(path.dirname(process.env.CM_DB_PATH || path.join(dataDir, 'central-mine.db')), 'backups'),
  secret,
  backupKey: loadBackupKey(),
  // Access-token lifetime (short-lived) and rotating refresh-token lifetime.
  tokenTtlSec: num(process.env.CM_TOKEN_TTL, 60 * 60 * 12),
  refreshTtlSec: num(process.env.CM_REFRESH_TTL, 60 * 60 * 24 * 30),
  sessionIdleSec: num(process.env.CM_SESSION_IDLE, 60 * 60 * 24 * 14),
  otpTtlSec: 300,
  otpMaxAttempts: 5,
  otpResendCooldownSec: 60,
  clientDist: path.join(root, '..', 'client', 'dist'),
  // Canonical origin for sitemap/canonical URLs (set CM_PUBLIC_BASE_URL in production).
  publicBaseUrl: process.env.CM_PUBLIC_BASE_URL || '',
  // When true (dev/test), OTP codes are returned in API response instead of a real SMS channel.
  otpSandbox: process.env.CM_OTP_SANDBOX !== '0',
  maxUploadBytes: num(process.env.CM_MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
  allowedUploadMimes: [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'application/zip',
    'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ],
  // ---------- security policy ----------
  security: {
    // Secure cookies are the default in production; only an explicit override disables them.
    secureCookies: isProd ? !bool(process.env.CM_INSECURE_COOKIES, false) : false,
    cookieName: 'cm_token',
    csrfCookieName: 'cm_csrf',
    csrfHeaderName: 'x-csrf-token',
    // Minimum password length (letters + digits required by policy).
    passwordMinLength: num(process.env.CM_PASSWORD_MIN_LENGTH, 12),
    passwordHistoryDepth: num(process.env.CM_PASSWORD_HISTORY, 5),
    // Account lockout after N failed attempts inside the window.
    loginMaxFailures: num(process.env.CM_LOGIN_MAX_FAILURES, 5),
    loginLockMinutes: num(process.env.CM_LOGIN_LOCK_MINUTES, 15),
    loginAttemptWindowMinutes: num(process.env.CM_LOGIN_ATTEMPT_WINDOW, 30),
    // Re-authentication window for the most sensitive admin actions.
    sensitiveReauthMinutes: num(process.env.CM_SENSITIVE_REAUTH_MINUTES, 15),
    // Deny embedding in iframes (default: allow, the preview environment needs it).
    denyIframe: bool(process.env.CM_DENY_IFRAME, false),
    hstsMaxAge: num(process.env.CM_HSTS_MAX_AGE, 15552000),
    trustProxy: bool(process.env.CM_TRUST_PROXY, true),
    // Global API budget per IP per minute.
    apiRateLimitPerMinute: num(process.env.CM_API_RATE_LIMIT, 600),
    authRateLimitPerMinute: num(process.env.CM_AUTH_RATE_LIMIT, 20),
    dataRetentionDays: num(process.env.CM_DATA_RETENTION_DAYS, 365),
    mfaEnforce: bool(process.env.CM_MFA_ENFORCE, true)
  }
};
