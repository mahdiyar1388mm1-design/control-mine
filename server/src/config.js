'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const dataDir = process.env.CM_DATA_DIR || path.join(root, 'data');
const storageDir = process.env.CM_STORAGE_DIR || path.join(root, 'storage');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(storageDir, 'private'), { recursive: true });

// Secret: from env for production; otherwise generated once and persisted locally (dev only).
function loadSecret() {
  if (process.env.CM_SECRET) return process.env.CM_SECRET;
  const secretFile = path.join(dataDir, 'dev-secret.key');
  try {
    return fs.readFileSync(secretFile, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    return secret;
  }
}

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.CM_DB_PATH || path.join(dataDir, 'central-mine.db'),
  storageDir: path.join(storageDir, 'private'),
  secret: loadSecret(),
  tokenTtlSec: Number(process.env.CM_TOKEN_TTL || 60 * 60 * 24 * 7),
  otpTtlSec: 300,
  otpMaxAttempts: 5,
  otpResendCooldownSec: 60,
  clientDist: path.join(root, '..', 'client', 'dist'),
  // When true (dev/test), OTP codes are returned in API response instead of a real SMS channel.
  otpSandbox: process.env.CM_OTP_SANDBOX !== '0',
  maxUploadBytes: 10 * 1024 * 1024,
  allowedUploadMimes: [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'application/zip',
    'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
};
