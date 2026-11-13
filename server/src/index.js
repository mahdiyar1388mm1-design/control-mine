'use strict';

// `.env` must be read before anything captures configuration.
const envInfo = require('./utils/loadEnv').loadEnv();

const config = require('./config');
const { migrate } = require('./db/migrate');
const { close, housekeeping } = require('./db');
const { createApp } = require('./app');
const { startRewardScheduler } = require('./modules/lth/scheduler');
const logger = require('./utils/logger');

if (envInfo.loaded) {
  logger.info('environment file loaded', {
    file: envInfo.loaded.replace(process.cwd(), '.'),
    applied: envInfo.applied.length,
    kept_from_shell: envInfo.skipped.length
  });
} else if (config.isProd) {
  logger.warn('no .env file found; relying on exported environment variables only');
}

if (config.isProd && config.otpSandbox) {
  // In production a sandbox OTP channel hands the login code to anyone who asks.
  throw new Error(
    'CM_OTP_SANDBOX در محیط تولید باید 0 باشد؛ وگرنه کد ورود در پاسخ API برگردانده می‌شود.'
  );
}

const { tightenDataPermissions } = require('./db');

// Private storage + backups hold KYC documents and encrypted dumps: owner-only.
for (const dir of [config.storageDir, config.backupsDir]) tightenDataPermissions(dir, { mode: 0o700 });

migrate((msg) => logger.info(msg));

// Cover audit rows created before the hash chain existed (idempotent, cheap).
try {
  const { backfillAuditChain, verifyAuditChain } = require('./modules/platform/service');
  const filled = backfillAuditChain();
  if (filled) logger.info(`audit chain backfilled for ${filled} legacy rows`);
  const chain = verifyAuditChain();
  if (!chain.ok) logger.warn('audit chain verification failed', chain);
} catch (err) {
  logger.warn(`audit chain check skipped: ${err && err.message}`);
}

// Startup housekeeping keeps expired sessions/OTP codes from accumulating.
try {
  const removed = housekeeping();
  logger.info('housekeeping finished', removed);
} catch (err) {
  logger.warn(`housekeeping skipped: ${err && err.message}`);
}

// Periodic housekeeping (every 6 hours).
const housekeepingTimer = setInterval(() => {
  try { housekeeping(); } catch (err) { logger.warn(`periodic housekeeping failed: ${err && err.message}`); }
}, 6 * 3600 * 1000);
housekeepingTimer.unref();

const rewardScheduler = startRewardScheduler({ intervalMs: 30000 });
const app = createApp();
const server = app.listen(config.port, config.host, () => {
  logger.info(`CENTRAL MINE API listening on http://${config.host}:${config.port} (${config.env})`);
});

// Refuse to keep running with an expired/invalid TLS-terminated proxy setup in prod.
if (config.isProd && !config.security.secureCookies) {
  logger.warn('WARNING: secure cookies are disabled in production (CM_INSECURE_COOKIES=1).');
}

function shutdown(signal) {
  logger.info(`received ${signal}, shutting down gracefully`);
  clearInterval(housekeepingTimer);
  rewardScheduler.stop();
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaught exception', { message: err && err.message, stack: err && err.stack });
  shutdown('uncaughtException');
});
