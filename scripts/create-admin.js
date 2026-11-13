'use strict';

/**
 * Create the first real administrator.
 *
 * The seed script is for development only and its accounts share a published
 * password, so a fresh production installation reaches this point with *no*
 * usable login. This tool is the supported way in: it creates exactly one
 * admin, enforces the same password policy as the API, and refuses to run if
 * the phone already exists.
 *
 *   node scripts/create-admin.js --phone 09123456789 --name "نام و نام خانوادگی"
 *
 * Password is read interactively (never from the command line, where it would
 * land in shell history and `ps`). For automation, set CM_ADMIN_PASSWORD.
 */

require('../server/src/utils/loadEnv').loadEnv();

const readline = require('readline');
const config = require('../server/src/config');
const { get, run, tx, close } = require('../server/src/db');
const { migrate } = require('../server/src/db/migrate');
const { hashPassword, assertPasswordStrength } = require('../server/src/utils/password');
const { audit } = require('../server/src/modules/platform/service');
const { uuid, nowIso } = require('../server/src/utils/validate');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function normalizePhone(raw) {
  let s = String(raw || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '');
  if (s.startsWith('98')) s = `0${s.slice(2)}`;
  if (/^9\d{9}$/.test(s)) s = `0${s}`;
  return /^09\d{9}$/.test(s) ? s : null;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      // Re-render the prompt without echoing the typed characters.
      if (['\n', '\r', '\u0004'].includes(String(char))) {
        process.stdin.removeListener('data', onData);
      } else {
        process.stdout.write(`\r${question}${'*'.repeat(rl.line.length)}`);
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`استفاده:
  node scripts/create-admin.js --phone 09123456789 --name "نام کامل"

رمز عبور به‌صورت تعاملی و بدون نمایش پرسیده می‌شود. برای خودکارسازی:
  CM_ADMIN_PASSWORD='…' node scripts/create-admin.js --phone 09123456789 --name "…"`);
    return;
  }

  const phone = normalizePhone(arg('phone', ''));
  const fullName = String(arg('name', '')).trim();
  if (!phone) {
    console.error('❌ شمارهٔ موبایل معتبر بدهید: --phone 09123456789');
    process.exitCode = 1;
    return;
  }
  if (fullName.length < 3) {
    console.error('❌ نام کامل لازم است: --name "نام و نام خانوادگی"');
    process.exitCode = 1;
    return;
  }

  migrate();

  const existing = get('SELECT id, role, status FROM users WHERE phone = ?', [phone]);
  if (existing) {
    console.error(`❌ این شماره قبلاً ثبت شده است (نقش: ${existing.role}، وضعیت: ${existing.status}).`);
    console.error('   برای ارتقا به مدیر از پنل مدیریت استفاده کنید.');
    process.exitCode = 1;
    return;
  }

  let password = process.env.CM_ADMIN_PASSWORD || '';
  if (!password) {
    password = await promptHidden('رمز عبور (حداقل ۱۲ نویسه، حرف بزرگ/کوچک/رقم/نماد): ');
    const again = await promptHidden('تکرار رمز عبور: ');
    if (password !== again) {
      console.error('❌ رمزها یکسان نیستند.');
      process.exitCode = 1;
      return;
    }
  }

  // Same policy object the API enforces (throws with a Persian message).
  try {
    assertPasswordStrength(password, { personal: [fullName, phone] });
  } catch (err) {
    console.error(`❌ ${err.message || 'رمز عبور با سیاست امنیتی سازگار نیست.'}`);
    process.exitCode = 1;
    return;
  }

  const id = uuid();
  const now = nowIso();
  const { passwordHash, passwordSalt } = hashPassword(password);
  tx(() => {
    run(
      `INSERT INTO users (id, phone, email, full_name, password_hash, password_salt, role, status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'admin', 'active', ?, ?)`,
      [id, phone, fullName, passwordHash, passwordSalt, now, now]
    );
    // So "do not reuse one of your last N passwords" works from day one.
    run('INSERT INTO password_history (id, user_id, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
      [uuid(), id, passwordHash, passwordSalt, now]);
    audit(null, 'system', 'admin.bootstrap_created', 'user', id, {
      phone_masked: `${phone.slice(0, 4)}*****${phone.slice(-2)}`,
      role: 'admin',
      note: 'اولین مدیر واقعی ساخته شد؛ حساب‌های دمو از این پس لازم نیستند.'
    });
  });

  console.log(`\n✔ مدیر ساخته شد: ${phone} (${fullName})`);
  console.log('  گام بعدی (خیلی مهم): ورود دومرحله‌ای را برای همین حساب فعال کنید.');
  console.log(`  node scripts/mfa-provision.js --phone ${phone} --write`);
  console.log('  سپس حساب‌های دمو را پاک کنید:');
  if (get("SELECT id FROM users WHERE phone = '09120000001'")) {
    console.log(`  node scripts/purge-demo.js --phone ${phone} --write`);
  }
}

main()
  .catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => close());
