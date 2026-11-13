'use strict';

/**
 * Admin security center API (`/api/v1/admin/console/security/*`).
 * Everything here is admin-only, read-mostly and fully audited:
 *  - real-time security posture of the deployment
 *  - database inventory, integrity and growth
 *  - audit-chain verification (tamper evidence)
 *  - session/attempt review, per-user unlocking
 *  - on-demand encrypted backup and housekeeping
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { all, get, run, tx, integrityCheck, housekeeping } = require('../../db');
const { requireRole } = require('../../middleware/auth');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, validate, parsePagination } = require('../../utils/validate');
const { audit, verifyAuditChain, getSetting, notify } = require('../platform/service');
const authService = require('../auth/service');
const { createBackup } = require('../../db/backup');
const config = require('../../config');
const pkg = require('../../../package.json');

const router = express.Router();
router.use(requireRole('admin'));

function count(sql, params = []) {
  const row = get(sql, params);
  if (!row) return 0;
  const first = Object.values(row)[0];
  return Number.isFinite(Number(first)) ? Number(first) : 0;
}

// ---------------------------------------------------------------------------
// Security posture
// ---------------------------------------------------------------------------

router.get('/posture', (req, res, next) => {
  try {
    const checks = [];
    // `dev_only` checks describe gaps that are acceptable in a local/preview
    // environment; they are reported but excluded from the production score.
    const push = (id, label, ok, detail, severity = 'high', { devOnly = false } = {}) => checks.push({
      id, label, ok: Boolean(ok), severity: ok ? 'ok' : severity,
      failed_severity: severity, detail, dev_only: devOnly
    });

    push('secret', 'کلید امضای نشست از محیط خوانده می‌شود', Boolean(process.env.CM_SECRET),
      process.env.CM_SECRET ? 'CM_SECRET تنظیم شده است.' : 'کلید توسعهٔ محلی پایدار در حال استفاده است.',
      config.isProd ? 'critical' : 'low', { devOnly: !config.isProd });
    push('secret_length', 'طول کلید امضا حداقل ۶۴ نویسه', String(config.secret || '').length >= 64,
      `طول فعلی: ${String(config.secret || '').length}`, 'high');
    push('prod_mode', 'حالت تولید (NODE_ENV=production)', config.isProd,
      `حالت فعلی: ${config.env}`, config.isProd ? 'medium' : 'low', { devOnly: !config.isProd });
    push('secure_cookies', 'کوکی نشست با پرچم Secure', config.security.secureCookies,
      config.security.secureCookies ? 'فعال' : 'غیرفعال (در پیش‌نمایش بدون TLS طبیعی است).',
      config.isProd ? 'high' : 'low', { devOnly: !config.isProd });
    push('otp_sandbox', 'کانال پیامک واقعی متصل است', !config.otpSandbox || config.isProd,
      config.otpSandbox ? 'کد OTP در پاسخ API برگردانده می‌شود (Sandbox).' : 'کانال واقعی.',
      config.isProd ? 'medium' : 'low', { devOnly: !config.isProd });
    push('backup_key', 'کلید رمزنگاری پشتیبان‌گیری تنظیم شده', Boolean(config.backupKey),
      process.env.CM_BACKUP_KEY
        ? 'CM_BACKUP_KEY از محیط خوانده می‌شود.'
        : (config.backupKey
          ? 'کلید توسعهٔ محلی فعال است؛ در تولید CM_BACKUP_KEY را تنظیم کنید.'
          : 'پشتیبان‌ها رمزنگاری نمی‌شوند.'), config.isProd ? 'high' : 'low', { devOnly: !config.isProd });
    push('maintenance_token', 'توکن عملیات نگهداری تنظیم شده', Boolean(process.env.CM_MAINTENANCE_TOKEN),
      process.env.CM_MAINTENANCE_TOKEN ? 'تنظیم شده.' : 'CM_MAINTENANCE_TOKEN خالی است.', 'low',
      { devOnly: true });

    // Second factor coverage for privileged accounts (real, production-relevant).
    const mfaCoverage = require('../auth/mfa').adminCoverage();
    push('mfa_privileged', 'ورود دومرحله‌ای برای همهٔ حساب‌های مدیریتی فعال است',
      mfaCoverage.privileged_users === 0 || mfaCoverage.without_mfa === 0,
      mfaCoverage.without_mfa === 0
        ? `هر ${mfaCoverage.privileged_users} حساب مدیریتی TOTP دارد.`
        : `${mfaCoverage.without_mfa} از ${mfaCoverage.privileged_users} حساب مدیریتی بدون ورود دومرحله‌ای است.`,
      'critical');
    push('audit_chain', 'زنجیرهٔ هش لاگ حسابرسی سالم است', verifyAuditChain().ok,
      'بررسی کامل زنجیره در هر بار بارگذاری این صفحه.', 'critical');

    const users = {
      total: count('SELECT COUNT(*) AS c FROM users'),
      active: count("SELECT COUNT(*) AS c FROM users WHERE status = 'active'"),
      suspended: count("SELECT COUNT(*) AS c FROM users WHERE status != 'active'"),
      admins: count("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'"),
      without_mfa_hint: count("SELECT COUNT(*) AS c FROM users WHERE role IN ('admin','finance')")
    };
    const auth = {
      sessions_active: count('SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NULL AND expires_at > ?', [nowIso()]),
      sessions_expired: count('SELECT COUNT(*) AS c FROM sessions WHERE expires_at <= ?', [nowIso()]),
      refresh_active: count('SELECT COUNT(*) AS c FROM auth_refresh_tokens WHERE revoked_at IS NULL AND expires_at > ?', [nowIso()]),
      // Same definition as the lockout itself: password failures only.
      locked_phones: count(
        `SELECT COUNT(DISTINCT phone) AS c FROM login_attempts
          WHERE success = 0 AND (reason IS NULL OR reason NOT LIKE 'mfa%') AND created_at >= ?`,
        [new Date(Date.now() - config.security.loginAttemptWindowMinutes * 60000).toISOString()]
      ),
      failed_last_24h: count('SELECT COUNT(*) AS c FROM login_attempts WHERE success = 0 AND created_at >= ?',
        [new Date(Date.now() - 86400000).toISOString()]),
      successful_last_24h: count('SELECT COUNT(*) AS c FROM login_attempts WHERE success = 1 AND created_at >= ?',
        [new Date(Date.now() - 86400000).toISOString()])
    };
    const auditHead = get('SELECT entry_hash, created_at FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT 1');

    res.json({
      generated_at: nowIso(),
      environment: {
        node: process.version,
        platform: process.platform,
        uptime_seconds: Math.round(process.uptime()),
        version: pkg.version,
        env: config.env
      },
      policy: {
        password: require('../../utils/password').policy(),
        login_max_failures: config.security.loginMaxFailures,
        lock_minutes: config.security.loginLockMinutes,
        session_ttl_seconds: config.tokenTtlSec,
        refresh_ttl_seconds: config.refreshTtlSec,
        idle_timeout_seconds: config.sessionIdleSec,
        sensitive_reauth_minutes: config.security.sensitiveReauthMinutes,
        api_rate_limit_per_minute: config.security.apiRateLimitPerMinute,
        secure_cookies: config.security.secureCookies,
        hsts_max_age: config.security.hstsMaxAge,
        deny_iframe: config.security.denyIframe
      },
      checks,
      // Weighted: critical=4, high=3, medium=2, low=1. Development-only gaps
      // (sandbox SMS, non-secure local cookies) must not mask a real production issue.
      score: (() => {
        // `dev_only` gaps are shown but only weigh in when they matter
        // (i.e. the deployment claims to be production).
        const weight = { critical: 4, high: 3, medium: 2, low: 1 };
        const counted = checks.filter((c) => !c.dev_only || config.isProd);
        let total = 0;
        let earned = 0;
        for (const c of counted) {
          const w = weight[c.failed_severity || c.severity] || 1;
          total += w;
          if (c.ok) earned += w;
        }
        return Math.round((earned / Math.max(1, total)) * 100);
      })(),
      score_scope: config.isProd ? 'production' : 'development',
      users,
      mfa: mfaCoverage,
      auth,
      audit: {
        entries: count('SELECT COUNT(*) AS c FROM audit_log'),
        head_hash: auditHead ? auditHead.entry_hash : null,
        last_entry_at: auditHead ? auditHead.created_at : null
      }
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Database depth: inventory, integrity, growth
// ---------------------------------------------------------------------------

router.get('/database', (req, res, next) => {
  try {
    const tables = all(
      `SELECT name, type FROM sqlite_master
        WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
        ORDER BY name`
    ).map((t) => {
      if (t.type !== 'table') return { name: t.name, type: t.type, rows: null };
      let rows = null;
      try { rows = count(`SELECT COUNT(*) AS c FROM "${t.name.replace(/"/g, '""')}"`); } catch { rows = null; }
      return { name: t.name, type: t.type, rows };
    });
    const indexes = count("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'");
    const triggers = count("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'trigger'");
    const foreignKeys = count('PRAGMA foreign_key_check');
    const schemaVersion = getSetting('db_schema_version', null) || count('SELECT COUNT(*) AS c FROM schema_migrations');
    const journal = get('PRAGMA journal_mode');

    let disk = null;
    try {
      const stat = fs.statSync(config.dbPath);
      disk = {
        path: path.basename(config.dbPath),
        size_bytes: stat.size,
        wal_size_bytes: fs.existsSync(`${config.dbPath}-wal`) ? fs.statSync(`${config.dbPath}-wal`).size : 0,
        modified_at: stat.mtime.toISOString()
      };
    } catch { disk = null; }

    const backups = [];
    try {
      if (fs.existsSync(config.backupsDir)) {
        for (const file of fs.readdirSync(config.backupsDir).sort().reverse().slice(0, 10)) {
          const st = fs.statSync(path.join(config.backupsDir, file));
          backups.push({ name: file, size_bytes: st.size, created_at: st.mtime.toISOString(),
            encrypted: file.endsWith('.enc') });
        }
      }
    } catch { /* ignore */ }

    let quick = null;
    try { quick = integrityCheck({ full: req.query.full === '1' }); } catch { quick = ['error']; }

    res.json({
      generated_at: nowIso(),
      schema_version: schemaVersion,
      journal_mode: journal ? journal.journal_mode : null,
      integrity: { ok: quick && quick[0] === 'ok', result: quick },
      foreign_key_violations: foreignKeys,
      counts: { tables: tables.filter((t) => t.type === 'table').length, indexes, triggers },
      tables,
      disk,
      backups,
      retention: {
        data_retention_days: Number(getSetting('security_data_retention_days', config.security.dataRetentionDays)),
        last_housekeeping_at: getSetting('db_last_housekeeping_at', null)
      }
    });
  } catch (err) { next(err); }
});

router.post('/database/housekeeping', (req, res, next) => {
  try {
    const data = validate(req.body || {}).string('reason', { required: false, max: 300, default: 'دستور مدیر' }).done();
    const removed = housekeeping();
    try { run("INSERT INTO settings (key, value, updated_at) VALUES ('db_last_housekeeping_at', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(nowIso()), nowIso()]); } catch { /* older schema */ }
    audit(req.user.id, req.user.role, 'admin.housekeeping', 'database', null, { removed, reason: data.reason });
    res.json({ ok: true, removed, at: nowIso() });
  } catch (err) { next(err); }
});

router.post('/database/backup', (req, res, next) => {
  try {
    const data = validate(req.body || {}).string('reason', { required: false, max: 300, default: 'پشتیبان‌گیری دستی' }).done();
    const passphrase = config.backupKey;
    if (!passphrase) {
      throw ApiError.validation('برای پشتیبان‌گیری امن، CM_BACKUP_KEY را روی سرور تنظیم کنید.');
    }
    const info = createBackup({ destDir: config.backupsDir, encryptionPassphrase: passphrase });
    audit(req.user.id, req.user.role, 'admin.backup_created', 'database', null, {
      encrypted: info.encrypted, size_bytes: info.size_bytes, reason: data.reason
    });
    res.status(201).json({
      ok: true,
      backup: { name: path.basename(info.path), size_bytes: info.size_bytes, encrypted: info.encrypted }
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Audit-chain verification & sessions / login attempts
// ---------------------------------------------------------------------------

router.get('/audit-chain', (req, res, next) => {
  try {
    const result = verifyAuditChain();
    audit(req.user.id, req.user.role, 'admin.verify_audit_chain', 'audit_log', null, result);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/sessions', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination({ ...req.query, limit: req.query.limit || 30 });
    const items = all(
      `SELECT s.id, s.user_id, s.created_at, s.expires_at, s.last_used_at, s.revoked_at, s.revoked_reason,
              s.user_agent, s.ip, u.full_name, u.phone, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        ORDER BY COALESCE(s.last_used_at, s.created_at) DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    ).map((s) => ({
      ...s,
      phone: s.phone ? String(s.phone).replace(/(09\d{2})\d{5}(\d{2})/, '$1*****$2') : null,
      active: !s.revoked_at && s.expires_at > nowIso(),
      current: s.id === req.sessionId
    }));
    res.json({ items, page, limit, total: count('SELECT COUNT(*) AS c FROM sessions') });
  } catch (err) { next(err); }
});

router.delete('/sessions/:id', (req, res, next) => {
  try {
    const row = get('SELECT id, user_id FROM sessions WHERE id = ?', [req.params.id]);
    if (!row) throw ApiError.notFound('نشست یافت نشد.');
    tx(() => {
      run('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL',
        [nowIso(), 'admin_revoked', row.id]);
      run('UPDATE auth_refresh_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL',
        [nowIso(), row.id]);
    });
    audit(req.user.id, req.user.role, 'admin.revoke_session', 'session', row.id, { user_id: row.user_id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * Break-glass MFA reset. This is the only way a privileged account can lose its
 * second factor, so the loss of a phone cannot permanently lock the platform out
 * of its own admin console. Heavily guarded:
 *   - admin only, and never for your own account (no self-service bypass),
 *   - requires a fresh step-up proof (password confirmation, 15 min),
 *   - requires an explicit written reason,
 *   - revokes every session/refresh token of the target,
 *   - writes an immutable, chained audit entry.
 */
router.get('/mfa', (req, res, next) => {
  try {
    const rows = all(
      `SELECT u.id, u.full_name, u.role, u.phone, COALESCE(m.enabled, 0) AS enabled,
              m.confirmed_at,
              (SELECT COUNT(*) FROM mfa_recovery_codes c WHERE c.user_id = u.id AND c.used_at IS NULL) AS recovery_left
         FROM users u LEFT JOIN user_mfa m ON m.user_id = u.id
        WHERE u.role IN ('admin','finance','operator','support')
        ORDER BY u.role, u.full_name`
    ).map((r) => ({
      ...r,
      phone: r.phone ? String(r.phone).replace(/(09\d{2})\d{5}(\d{2})/, '$1*****$2') : null,
      enabled: Boolean(r.enabled)
    }));
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.post('/mfa/:userId/reset', (req, res, next) => {
  try {
    const data = validate(req.body || {})
      .string('reauth_proof', { required: true, max: 64 })
      .string('reason', { min: 10, max: 300 })
      .done();
    if (!authService.hasValidProof(req.user.id, data.reauth_proof, 'sensitive')) {
      throw ApiError.forbidden('برای بازنشانی ورود دومرحله‌ای، هویت خود را دوباره تأیید کنید.');
    }
    if (req.params.userId === req.user.id) {
      throw ApiError.forbidden('بازنشانی ورود دومرحله‌ای حساب خودتان از این مسیر مجاز نیست.');
    }
    const target = get('SELECT id, phone, role, full_name FROM users WHERE id = ?', [req.params.userId]);
    if (!target) throw ApiError.notFound('کاربر یافت نشد.');
    const had = get('SELECT enabled FROM user_mfa WHERE user_id = ?', [target.id]);
    tx(() => {
      run('DELETE FROM user_mfa WHERE user_id = ?', [target.id]);
      run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [target.id]);
      run('DELETE FROM mfa_challenges WHERE user_id = ?', [target.id]);
      // Force a fresh login everywhere: the reset must not leave old sessions alive.
      run('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL',
        [nowIso(), 'mfa_reset', target.id]);
      run('UPDATE auth_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        [nowIso(), target.id]);
      notify(target.id, 'security', 'ورود دومرحله‌ای بازنشانی شد',
        'ورود دومرحله‌ای حساب شما توسط مدیر سامانه بازنشانی شد و همهٔ نشست‌ها بسته شدند. اگر این کار را شما درخواست نکرده‌اید، فوراً رمز عبور خود را تغییر دهید.');
    });
    audit(req.user.id, req.user.role, 'admin.mfa_reset', 'user', target.id, {
      reason: data.reason,
      target_role: target.role,
      was_enabled: Boolean(had && had.enabled)
    });
    res.json({ ok: true, user_id: target.id, was_enabled: Boolean(had && had.enabled) });
  } catch (err) { next(err); }
});

router.get('/login-attempts', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination({ ...req.query, limit: req.query.limit || 50 });
    const where = ['1 = 1'];
    const params = [];
    if (req.query.only_failures === '1') where.push('success = 0');
    if (req.query.phone) { where.push('phone = ?'); params.push(String(req.query.phone)); }
    const whereSql = where.join(' AND ');
    const items = all(
      `SELECT phone, ip, success, reason, created_at FROM login_attempts
        WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ).map((r) => ({
      ...r,
      phone: r.phone ? String(r.phone).replace(/(09\d{2})\d{5}(\d{2})/, '$1*****$2') : null
    }));
    res.json({ items, page, limit, total: count(`SELECT COUNT(*) AS c FROM login_attempts WHERE ${whereSql}`, params) });
  } catch (err) { next(err); }
});

/** Clears the lockout for one phone number after identity verification by an admin. */
router.post('/unlock', (req, res, next) => {
  try {
    const data = validate(req.body || {})
      .string('phone', { min: 11, max: 11 })
      .string('reason', { min: 3, max: 300 })
      .done();
    const removed = run('DELETE FROM login_attempts WHERE phone = ? AND success = 0', [data.phone]).changes;
    audit(req.user.id, req.user.role, 'admin.unlock_account', 'user', null, { phone: data.phone, removed, reason: data.reason });
    res.json({ ok: true, cleared_attempts: removed });
  } catch (err) { next(err); }
});

module.exports = router;
void uuid;
