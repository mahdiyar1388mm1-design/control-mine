#!/usr/bin/env node
'use strict';

/**
 * Provision TOTP two-factor authentication for one account.
 *
 * Unlike the web flow (which is per-user and requires logging in as that user),
 * this script runs on the server host and is meant for the initial hand-over:
 * you have nine demo/staff accounts and no phone to scan a QR code with.
 *
 *   node scripts/mfa-provision.js --list
 *   node scripts/mfa-provision.js --phone 09120000001            # dry run
 *   node scripts/mfa-provision.js --phone 09120000001 --write    # writes
 *   node scripts/mfa-provision.js --role admin --write           # all admins
 *   node scripts/mfa-provision.js --all-privileged --write
 *
 * What it prints is the secret + otpauth URI + first recovery codes. Capture
 * that output ONCE: the secret is what the authenticator app needs, and the
 * recovery codes are stored server-side only as hashes.
 *
 * Safety rules:
 *  - Never prints or rewrites an account that already has 2FA enabled unless
 *    --force is given (and --force rotates the secret, invalidating the old app).
 *  - `--write` is required to touch the database; without it nothing changes.
 *  - Every write is audited as `auth.mfa_provisioned` (system actor) so the
 *    security center and the audit chain both see it.
 */

require('../server/src/utils/loadEnv').loadEnv();

const crypto = require('crypto');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const WRITE = has('--write');
const FORCE = has('--force');

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function table(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  console.log(rows.map((r) => r.join('')).join('\n'));
}

function main() {
  const { all, get, run, tx } = require('../server/src/db');
  const totp = require('../server/src/utils/totp');
  const { audit } = require('../server/src/modules/platform/service');

  if (has('--help') || has('-h')) {
    console.log('usage: node scripts/mfa-provision.js [--phone 09...] [--role admin] [--all-privileged] [--list] [--write] [--force]');
    return;
  }

  const coverage = all(
    `SELECT u.id, u.phone, u.role, u.status, COALESCE(m.enabled, 0) AS mfa_enabled,
            (SELECT COUNT(*) FROM mfa_recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL) AS codes_left
       FROM users u LEFT JOIN user_mfa m ON m.user_id = u.id
      WHERE u.status = 'active'
      ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'finance' THEN 1 ELSE 2 END, u.phone`
  );

  if (has('--list') || (!valueOf('--phone') && !valueOf('--role') && !has('--all-privileged'))) {
    console.log('حساب‌های فعال و وضعیت ورود دومرحله‌ای:\n');
    table([
      ['نقش', ' ', 'شماره', ' ', '2FA', ' ', 'کدهای بازیابی'].map((c) => c.padEnd(10)),
      ...coverage.map((u) => [
        String(u.role).padEnd(10),
        String(u.phone).padEnd(12),
        (u.mfa_enabled ? 'فعال' : '—').padEnd(8),
        String(u.codes_left || 0).padEnd(6)
      ])
    ]);
    const missing = coverage.filter((u) => ['admin', 'finance'].includes(u.role) && !u.mfa_enabled);
    console.log(`\nبدون 2FA از نقش‌های حساس: ${missing.length}`);
    if (missing.length) {
      console.log('فعال‌سازی با: node scripts/mfa-provision.js --phone <شماره> --write');
    }
    return;
  }

  let targets = [];
  if (valueOf('--phone')) {
    const phone = String(valueOf('--phone'));
    const row = coverage.find((u) => u.phone === phone);
    if (!row) fail(`کاربر فعالی با شمارهٔ ${phone} پیدا نشد.`);
    targets = [row];
  } else if (valueOf('--role')) {
    targets = coverage.filter((u) => u.role === valueOf('--role'));
  } else {
    targets = coverage.filter((u) => ['admin', 'finance'].includes(u.role));
  }
  if (!targets.length) fail('هیچ حسابی برای این فیلتر پیدا نشد.');

  for (const user of targets) {
    const existing = get('SELECT enabled FROM user_mfa WHERE user_id = ?', [user.id]);
    if (existing && existing.enabled && !FORCE) {
      console.log(`— ${user.phone} (${user.role}): 2FA از قبل فعال است؛ رد شد. برای چرخش کلید --force بدهید.`);
      continue;
    }
    if (existing && existing.enabled && FORCE) {
      console.log(`! ${user.phone}: کلید فعلی باطل و کلید تازه صادر می‌شود (--force).`);
    }

    const secret = totp.generateSecret();
    const codes = totp.generateRecoveryCodes(8);
    const uri = totp.otpauthUri({ secret, account: user.phone });
    const now = new Date().toISOString();

    console.log(`\n${'='.repeat(64)}`);
    console.log(`حساب: ${user.phone}  (${user.role})  ${WRITE ? '' : '— حالت نمایشی، چیزی نوشته نشد'}`);
    console.log(`secret : ${secret}`);
    console.log(`otpauth: ${uri}`);
    console.log(`کدهای بازیابی (فقط یک بار نمایش داده می‌شوند):`);
    console.log(codes.map((c) => `  - ${c}`).join('\n'));

    if (!WRITE) continue;

    tx(() => {
      run(
        `INSERT INTO user_mfa (user_id, secret_enc, enabled, confirmed_at, last_step, created_at, updated_at)
         VALUES (?, ?, 1, ?, NULL, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           secret_enc = excluded.secret_enc, enabled = 1, confirmed_at = excluded.confirmed_at,
           last_step = NULL, updated_at = excluded.updated_at`,
        [user.id, totp.encryptSecret(secret), now, now, now]
      );
      run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [user.id]);
      for (const plain of codes) {
        run(
          'INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
          [crypto.randomUUID(), user.id, crypto.createHash('sha256').update(totp.normalizeRecoveryCode(plain)).digest('hex'), now]
        );
      }
      // Old challenges must not survive a secret rotation.
      run('DELETE FROM mfa_challenges WHERE user_id = ?', [user.id]);
    });
    audit(null, 'system', 'auth.mfa_provisioned', 'user', user.id, {
      role: user.role, rotated: Boolean(existing && existing.enabled), recovery_codes: codes.length, via: 'cli'
    });
    console.log(`✔ نوشته شد — از این پس ورود ${user.phone} کد ۶ رقمی می‌خواهد.`);
  }

  if (!WRITE) {
    console.log(`\nبرای اعمال، همین دستور را با --write اجرا کنید.`);
  } else {
    console.log(`\nیادآوری: خروجی را در جای امن نگه دارید؛ کدهای بازیابی دیگر قابل بازیابی نیستند.`);
    console.log(`بازنشانی اضطراری هر حساب: پنل مدیریت → مرکز امنیت → بازنشانی 2FA (نیازمند احراز مجدد).`);
  }
}

main();
