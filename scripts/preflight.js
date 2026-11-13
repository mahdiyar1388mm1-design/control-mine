#!/usr/bin/env node
'use strict';

/**
 * Go-live self-check for CENTRAL MINE.
 *
 * Run this on the machine that will host the app, right before handing it over:
 *
 *   node scripts/preflight.js                 # checks the current environment
 *   node scripts/preflight.js --url https://example.com   # also probes a live server
 *
 * It reports what is ready, what is missing and what is dangerous, and exits
 * with code 1 when a blocking problem is found (usable in CI / deploy hooks).
 *
 * Nothing here writes to the database or prints secret values.
 */

require('../server/src/utils/loadEnv').loadEnv();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const urlArgIndex = args.indexOf('--url');
const liveUrl = urlArgIndex >= 0 ? String(args[urlArgIndex + 1] || '').replace(/\/+$/, '') : null;

const BLOCKING = 'BLOCKING';
const WARN = 'WARN';
const OK = 'OK';
const INFO = 'INFO';

const rows = [];
function push(level, title, detail, fix) {
  rows.push({ level, title, detail, fix });
}

function envFileInfo() {
  const candidates = [path.join(ROOT, 'server', '.env'), path.join(ROOT, '.env')];
  const found = candidates.filter((f) => fs.existsSync(f));
  return found;
}

function statMode(target) {
  try {
    return fs.statSync(target).mode & 0o777;
  } catch {
    return null;
  }
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  const ok = major > 22 || (major === 22 && minor >= 5);
  push(
    ok ? OK : BLOCKING,
    'نسخهٔ Node.js',
    `اجرای فعلی: v${process.versions.node}`,
    ok ? null : 'Node.js 22.5 یا بالاتر لازم است (ماژول توکار node:sqlite).'
  );
}

function checkEnvFile() {
  const found = envFileInfo();
  if (found.length === 0) {
    push(
      WARN,
      'فایل .env',
      'هیچ فایل .env پیدا نشد؛ تنظیمات فقط از متغیرهای محیطی شل خوانده می‌شود.',
      'cp .env.example server/.env و مقادیر تولید را پر کنید.'
    );
    return;
  }
  push(OK, 'فایل .env', found.map((f) => path.relative(ROOT, f)).join(', ') + ' خوانده می‌شود.');
  for (const file of found) {
    const mode = statMode(file);
    if (mode !== null && mode & 0o077) {
      push(WARN, 'مجوز فایل .env', `${path.relative(ROOT, file)} با مجوز 0${mode.toString(8)} قابل خواندن برای دیگران است.`, `chmod 600 ${path.relative(ROOT, file)}`);
    }
  }
}

function checkSecrets() {
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.CM_SECRET || '';
  if (!secret) {
    push(isProd ? BLOCKING : WARN, 'CM_SECRET', 'تنظیم نشده است.', 'مقدار ۹۶ نویسه‌ای هگز تصادفی بگذارید.');
  } else if (secret.length < 64) {
    push(isProd ? BLOCKING : WARN, 'CM_SECRET', `طول فعلی ${secret.length} نویسه؛ حداقل ۶۴ لازم است.`, 'کلید را با randomBytes(48) بازسازی کنید.');
  } else if (/replace|example|changeme|secret-0123/i.test(secret)) {
    push(BLOCKING, 'CM_SECRET', 'مقدار نمونه/قابل حدس به‌نظر می‌رسد.', 'کلید واقعی تولید کنید.');
  } else {
    push(OK, 'CM_SECRET', `${secret.length} نویسه (مقدار نمایش داده نمی‌شود).`);
  }

  const backupKey = process.env.CM_BACKUP_KEY || '';
  if (!backupKey) {
    push(isProd ? BLOCKING : WARN, 'CM_BACKUP_KEY', 'خالی؛ پشتیبان‌ها رمزنگاری نمی‌شوند.', 'کلید ۶۴ نویسه‌ای هگز بگذارید.');
  } else if (!/^[0-9a-f]{64}$/i.test(backupKey)) {
    push(WARN, 'CM_BACKUP_KEY', 'قالب استاندارد نیست (۳۲ بایت هگز انتظار می‌رفت).');
  } else {
    push(OK, 'CM_BACKUP_KEY', 'تنظیم‌شده (۳۲ بایت).');
  }
}

function checkProdMode() {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') {
    push(OK, 'NODE_ENV', 'production');
  } else {
    push(WARN, 'NODE_ENV', `مقدار فعلی: ${env}. در این حالت کوکی Secure خاموش و OTP سندباکس مجاز است.`, 'NODE_ENV=production در server/.env');
  }
  const sandbox = process.env.CM_OTP_SANDBOX !== '0';
  if (env === 'production' && sandbox) {
    push(BLOCKING, 'CM_OTP_SANDBOX', 'در تولید روشن است؛ کد ورود در پاسخ API برگردانده می‌شود.', 'CM_OTP_SANDBOX=0 — سرور با این تنظیم بالا نمی‌آید.');
  } else if (sandbox) {
    push(INFO, 'CM_OTP_SANDBOX', 'سندباکس (مناسب توسعه).');
  } else {
    push(OK, 'CM_OTP_SANDBOX', 'off — کد ورود فقط از کانال پیامک می‌آید.');
  }
}

function checkPublicUrl() {
  const base = process.env.CM_PUBLIC_BASE_URL || '';
  if (!base) {
    push(WARN, 'CM_PUBLIC_BASE_URL', 'خالی؛ sitemap و canonical از هدر درخواست ساخته می‌شوند.', 'دامنهٔ نهایی مثل https://example.ir را بگذارید.');
    return;
  }
  if (!/^https:\/\//.test(base)) {
    push(WARN, 'CM_PUBLIC_BASE_URL', `مقدار فعلی ${base} با https شروع نمی‌شود.`);
  } else {
    push(OK, 'CM_PUBLIC_BASE_URL', base);
  }
}

function checkDataPermissions() {
  const dataDir = process.env.CM_DATA_DIR || path.join(ROOT, 'server', 'data');
  const storageDir = process.env.CM_STORAGE_DIR || path.join(ROOT, 'server', 'storage');
  const dbPath = process.env.CM_DB_PATH || path.join(dataDir, 'central-mine.db');

  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    const mode = statMode(file);
    if (mode === null) continue;
    if (mode & 0o077) {
      push(WARN, 'مجوز فایل دیتابیس', `${path.basename(file)} = 0${mode.toString(8)}؛ دیگران می‌توانند بخوانند.`, `chmod 600 ${file} (سرور در بوت خودش هم اصلاح می‌کند).`);
    } else {
      push(OK, 'مجوز فایل دیتابیس', `${path.basename(file)} = 0${mode.toString(8)}`);
    }
  }

  for (const dir of [storageDir, path.join(dataDir, 'backups')]) {
    const mode = statMode(dir);
    if (mode === null) continue;
    if (mode & 0o077) push(WARN, 'مجوز پوشه داده', `${path.relative(ROOT, dir)} = 0${mode.toString(8)}`, `chmod 700 ${dir}`);
  }

  // Secret material must never be tracked by git.
  try {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /(^|\/)(\.env|.*\.key|.*\.db|.*\.enc)$/.test(f) && !f.endsWith('.example'));
    if (tracked.length) {
      push(BLOCKING, 'فایل حساس در گیت', tracked.join(', '), 'این فایل‌ها را از مخزن حذف و در .gitignore نگه دارید.');
    } else {
      push(OK, 'فایل حساس در گیت', 'هیچ .env / .key / .db / .enc ردیابی نمی‌شود.');
    }
  } catch {
    push(INFO, 'بررسی گیت', 'git در دسترس نیست؛ بررسی ردیابی فایل‌های حساس انجام نشد.');
  }
}

function checkBuild() {
  const dist = path.join(ROOT, 'client', 'dist', 'index.html');
  if (!fs.existsSync(dist)) {
    push(BLOCKING, 'بیلد فرانت‌اند', 'client/dist/index.html وجود ندارد؛ سرور فقط API می‌دهد.', 'npm run build');
    return;
  }
  const html = fs.readFileSync(dist, 'utf8');
  push(OK, 'بیلد فرانت‌اند', `client/dist/index.html (${(fs.statSync(dist).size / 1024).toFixed(0)}KB)`);
  const hasSeo = /og:title/.test(html) && /application\/ld\+json/.test(html);
  push(hasSeo ? OK : WARN, 'متادیتای SEO در بیلد', hasSeo ? 'description/OG/JSON-LD موجود است.' : 'در بیلد پیدا نشد.', hasSeo ? null : 'npm run build را دوباره اجرا کنید.');
}

function checkMigrations() {
  const dir = path.join(ROOT, 'server', 'src', 'db', 'migrations');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'));
  } catch {
    push(BLOCKING, 'پوشهٔ مهاجرت', 'پیدا نشد.', 'ساختار مخزن ناقص است.');
    return;
  }
  let applied = null;
  try {
    process.env.CM_SECRET = process.env.CM_SECRET || crypto.randomBytes(48).toString('hex');
    const { get } = require('../server/src/db');
    applied = get('SELECT COUNT(*) AS c FROM schema_migrations').c;
  } catch (err) {
    push(INFO, 'وضعیت مهاجرت', `دیتابیس باز نشد (${String(err.message).slice(0, 60)}).`, 'npm run migrate');
    return;
  }
  if (applied === files.length) {
    push(OK, 'مهاجرت دیتابیس', `${applied} از ${files.length} مهاجرت اعمال شده.`);
  } else {
    push(BLOCKING, 'مهاجرت دیتابیس', `${applied} از ${files.length} اعمال شده.`, 'npm run migrate');
  }
}

function checkDemoData() {
  try {
    process.env.CM_SECRET = process.env.CM_SECRET || crypto.randomBytes(48).toString('hex');
    const { all } = require('../server/src/db');
    const demo = all("SELECT phone, role FROM users WHERE phone LIKE '091200000%' OR phone LIKE '0912000%'");
    if (demo.length) {
      push(
        WARN,
        'دادهٔ نمایشی',
        `${demo.length} حساب دمو با رمز عمومی Cm@Test1405! پیدا شد (${demo.slice(0, 4).map((u) => `${u.role}:${u.phone}`).join(', ')}…).`,
        'روی تولید این حساب‌ها را حذف/تغییر رمز دهید یا بدون seed استقرار کنید.'
      );
    } else {
      push(OK, 'دادهٔ نمایشی', 'حساب دموی شناخته‌شده‌ای پیدا نشد.');
    }
  } catch {
    push(INFO, 'دادهٔ نمایشی', 'قابل بررسی نبود (دیتابیس در دسترس نیست).');
  }
}

async function checkLive(url) {
  if (!url) {
    push(INFO, 'بررسی سرور زنده', 'با --url https://example.com می‌توانید سلامت سرور را هم بسنجید.');
    return;
  }
  for (const [p, expect] of [['/health', 200], ['/ready', 200], ['/robots.txt', 200], ['/sitemap.xml', 200]]) {
    try {
      const res = await fetch(`${url}${p}`, { redirect: 'manual' });
      push(res.status === expect ? OK : BLOCKING, `زنده: ${p}`, `وضعیت ${res.status} (انتظار ${expect})`);
    } catch (err) {
      push(BLOCKING, `زنده: ${p}`, `اتصال ناموفق: ${String(err.message).slice(0, 80)}`);
    }
  }
  try {
    const api = await fetch(`${url}/api/v1/products?limit=1`);
    const ct = api.headers.get('content-type') || '';
    push(api.ok && /json/.test(ct) ? OK : BLOCKING, 'زنده: API فروشگاه', `${api.status} ${ct.split(';')[0]}`);
  } catch {
    push(WARN, 'زنده: API فروشگاه', 'پاسخ نداد.');
  }
  try {
    const headers = (await fetch(`${url}/`)).headers;
    const missing = ['x-content-type-options', 'content-security-policy', 'x-frame-options'].filter((h) => !headers.get(h));
    push(missing.length === 0 ? OK : WARN, 'زنده: هدرهای امنیتی', missing.length ? `غایب: ${missing.join(', ')}` : 'CSP + nosniff + frame-options فعال.');
  } catch {
    push(WARN, 'زنده: هدرهای امنیتی', 'صفحهٔ اصلی پاسخ نداد.');
  }
}

async function main() {
  console.log('CENTRAL MINE — بررسی پیش از تحویل (preflight)\n');
  checkNodeVersion();
  checkEnvFile();
  checkSecrets();
  checkProdMode();
  checkPublicUrl();
  checkBuild();
  checkDataPermissions();
  checkMigrations();
  checkDemoData();
  await checkLive(liveUrl);

  const order = { [BLOCKING]: 0, [WARN]: 1, [INFO]: 2, [OK]: 3 };
  rows.sort((a, b) => order[a.level] - order[b.level]);

  const icon = { [BLOCKING]: '✖', [WARN]: '!', [INFO]: 'i', [OK]: '✔' };
  for (const r of rows) {
    console.log(`${icon[r.level]} [${r.level}] ${r.title} — ${r.detail}`);
    if (r.fix) console.log(`    → ${r.fix}`);
  }

  const blocking = rows.filter((r) => r.level === BLOCKING).length;
  const warnings = rows.filter((r) => r.level === WARN).length;
  console.log(`\nنتیجه: ${blocking} مانع، ${warnings} هشدار، ${rows.filter((r) => r.level === OK).length} مورد سالم.`);
  if (blocking) {
    console.log('تا رفع موارد BLOCKING، استقرار تولید را انجام ندهید.');
    process.exit(1);
  }
  console.log('هیچ مانع سختی پیدا نشد. هشدارها را قبل از تحویل بررسی کنید.');
  process.exit(0);
}

main().catch((err) => {
  console.error('preflight failed:', err && err.message);
  process.exit(1);
});
