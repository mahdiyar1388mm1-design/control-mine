'use strict';

require('../utils/loadEnv').loadEnv();

/**
 * CENTRAL MINE — Synthetic seed data for local development & automated testing.
 * Contains ONLY freshly generated test accounts, physical equipment catalog,
 * and operational services. No data from any legacy or external system.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { migrate } = require('./migrate');
const { get, run, tx, close } = require('./index');
const { hashPassword } = require('../utils/password');
const { audit } = require('../modules/platform/service');
const { uuid, nowIso } = require('../utils/validate');
const lthService = require('../modules/lth/service');
const lthMath = require('../modules/lth/math');

function seedLthDemoIfEmpty({ silent = false } = {}) {
  lthService.ensureDefaultLogo();
  const existingHolding = get('SELECT id FROM lth_holdings LIMIT 1');
  if (existingHolding) return false;
  const cust = get("SELECT id FROM users WHERE phone = '09120000010'");
  if (!cust) return false;

  const purchasedMs = Date.now() - 50 * 3600 * 1000; // 50 hours ago -> 2 full 24h reward cycles due
  const purchasedIso = new Date(purchasedMs).toISOString();
  const settings = lthService.getSettingsRow();
  const priceIrr = BigInt(settings.price_irr);
  const amountToman = 22000000; // 22,000,000 Toman package
  const amountIrr = BigInt(amountToman) * 10n; // 220,000,000 IRR
  const lthAtoms = (amountIrr * lthMath.ONE_LTH_ATOMS) / priceIrr;
  const unlockMs = purchasedMs + Number(settings.lockup_days) * 86400000;
  const unlockIso = new Date(unlockMs).toISOString();
  const intervalMs = Number(settings.reward_interval_sec) * 1000;

  tx(() => {
    const wallet = lthService.ensureWalletInTx(cust.id);
    const payId = uuid();
    const purId = uuid();
    const holdId = uuid();

    run(
      `INSERT INTO payments (
        id, order_id, service_request_id, lth_purchase_id, amount_toman, status, gateway,
        gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at
      ) VALUES (?, NULL, NULL, ?, ?, 'paid', 'sandbox', 'SBX-SEED-LTH1', ?, ?, NULL, ?, ?)`,
      [payId, purId, amountToman, crypto.randomBytes(24).toString('hex'), purchasedIso, purchasedIso, purchasedIso]
    );

    run(
      `INSERT INTO lth_purchase_orders (
        id, code, user_id, payment_id, package_toman, amount_toman, amount_irr,
        unit_price_irr, lth_atoms, lockup_days, status, fulfilled_at, created_at, updated_at
      ) VALUES (?, 'LP-SEED5101', ?, ?, ?, ?, ?, ?, ?, ?, 'fulfilled', ?, ?, ?)`,
      [
        purId, cust.id, payId, amountToman, amountToman, amountIrr.toString(),
        priceIrr.toString(), lthAtoms.toString(), settings.lockup_days,
        purchasedIso, purchasedIso, purchasedIso
      ]
    );

    run(
      `INSERT INTO lth_holdings (
        id, contract_code, user_id, purchase_order_id, initial_base_atoms, active_base_atoms,
        accrued_staked_atoms, accrued_withdrawable_atoms, unit_price_irr_snapshot, lockup_days,
        purchased_at_ms, purchased_at, stake_unlock_at_ms, stake_unlock_at, stake_unlocked,
        last_reward_cycle, next_reward_at_ms, status, created_at, updated_at
      ) VALUES (?, 'POS-SEED5101', ?, ?, ?, ?, '0', '0', ?, ?, ?, ?, ?, ?, 0, 0, ?, 'active', ?, ?)`,
      [
        holdId, cust.id, purId, lthAtoms.toString(), lthAtoms.toString(),
        priceIrr.toString(), settings.lockup_days,
        purchasedMs, purchasedIso, unlockMs, unlockIso,
        purchasedMs + intervalMs, purchasedIso, purchasedIso
      ]
    );

    run(
      `UPDATE lth_wallets
       SET base_atoms = ?, total_purchased_atoms = ?, updated_at = ?
       WHERE user_id = ?`,
      [
        (BigInt(wallet.base_atoms) + lthAtoms).toString(),
        (BigInt(wallet.total_purchased_atoms) + lthAtoms).toString(),
        purchasedIso,
        cust.id
      ]
    );

    run(
      `INSERT INTO lth_ledger (
        id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
        delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
        irr_value_snapshot, ref_type, ref_id, note, created_at
      ) VALUES (?, ?, 'purchase_base', ?, '0', '0', '0', ?, ?, 'lth_purchase', ?, ?, ?)`,
      [
        uuid(), cust.id, lthAtoms.toString(), priceIrr.toString(), amountIrr.toString(),
        purId, 'خرید اولیه نمونه (LP-SEED5101) — پکیج ۲۲٬۰۰۰٬۰۰۰ تومان', purchasedIso
      ]
    );
  });

  lthService.settleDueRewards({ userId: cust.id });
  if (!silent) console.log('seed: LTH PoS contract & 24h reward cycles seeded.');
  return true;
}

function makeProductSvg(title, subtitle, accentHex, iconShape) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420" width="600" height="420">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="600" height="420" rx="24" fill="url(#bg)"/>
  <circle cx="490" cy="90" r="110" fill="${accentHex}" opacity="0.16"/>
  <circle cx="110" cy="340" r="90" fill="${accentHex}" opacity="0.12"/>
  <g transform="translate(240, 82)" stroke="${accentHex}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${iconShape}
  </g>
  <text x="300" y="290" text-anchor="middle" fill="#f8fafc" font-family="Tahoma, sans-serif" font-size="24" font-weight="bold">${title}</text>
  <text x="300" y="328" text-anchor="middle" fill="#94a3b8" font-family="Tahoma, sans-serif" font-size="15">${subtitle}</text>
  <rect x="235" y="352" width="130" height="28" rx="14" fill="${accentHex}" opacity="0.22"/>
  <text x="300" y="371" text-anchor="middle" fill="#e2e8f0" font-family="Tahoma, sans-serif" font-size="12">CENTRAL MINE</text>
</svg>`;
}

function seed({ silent = false } = {}) {
  // A production database that gets seeded is a production database with nine
  // accounts whose password is published in the README. Refuse outright; the
  // supported way to create the first real admin is scripts/create-admin.js.
  if (config.isProd && process.env.CM_ALLOW_SEED !== '1') {
    throw new Error(
      'seed در محیط تولید اجرا نمی‌شود (حساب‌های دمو رمز عمومی دارند). ' +
      'برای ساخت مدیر واقعی از `node scripts/create-admin.js` استفاده کنید. ' +
      'اگر واقعاً برای آزمون تولید لازم است: CM_ALLOW_SEED=1'
    );
  }
  migrate(silent ? () => {} : (m) => console.log(m));

  const existingAdmin = get("SELECT id FROM users WHERE phone = '09120000001'");
  if (existingAdmin) {
    seedLthDemoIfEmpty({ silent });
    if (!silent) console.log('seed: database already contains seed accounts; skipping.');
    return { skipped: true };
  }

  const publicDir = path.join(config.storageDir, '..', 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(config.storageDir, { recursive: true });

  const now = nowIso();
  const past2d = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const past5h = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
  const future40h = new Date(Date.now() + 40 * 3600 * 1000).toISOString();
  const future8h = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  const past3h = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

  // Default test password for synthetic staff & demo accounts (documented in docs/04-testing-and-seed.md).
  // Seeded accounts are development/test fixtures only; production deployments must not seed.
  const defaultPass = hashPassword('Cm@Test1405!');

  const users = {
    admin: { id: uuid(), phone: '09120000001', email: 'admin@centralmine.test', full_name: 'سارا احمدی (مدیر سامانه)', role: 'admin' },
    operator: { id: uuid(), phone: '09120000002', email: 'operator@centralmine.test', full_name: 'کاوه رضایی (اپراتور خدمات)', role: 'operator' },
    operator2: { id: uuid(), phone: '09120000007', email: 'operator2@centralmine.test', full_name: 'نیلوفر مرادی (اپراتور خدمات)', role: 'operator' },
    support: { id: uuid(), phone: '09120000003', email: 'support@centralmine.test', full_name: 'مریم کریمی (پشتیبانی)', role: 'support' },
    warehouse: { id: uuid(), phone: '09120000004', email: 'warehouse@centralmine.test', full_name: 'بهرام حسینی (انبار و ارسال)', role: 'warehouse' },
    finance: { id: uuid(), phone: '09120000005', email: 'finance@centralmine.test', full_name: 'فرهاد نادری (مسئول مالی)', role: 'finance' },
    customer: { id: uuid(), phone: '09120000010', email: 'customer1@centralmine.test', full_name: 'امیرحسین محمدی', role: 'customer' },
    customer2: { id: uuid(), phone: '09120000011', email: 'customer2@centralmine.test', full_name: 'الهام شریفی', role: 'customer' }
  };

  const categories = [
    { id: uuid(), name: 'ابزار اندازه‌گیری و دقیق', slug: 'precision-measuring', sort_order: 1 },
    { id: uuid(), name: 'تجهیزات ایمنی و کارگاهی', slug: 'workshop-safety', sort_order: 2 },
    { id: uuid(), name: 'تجهیزات برق و تغذیهٔ صنعتی', slug: 'industrial-power', sort_order: 3 },
    { id: uuid(), name: 'ابزار دستی و تعمیراتی', slug: 'hand-repair-tools', sort_order: 4 }
  ];

  const brands = [
    { id: uuid(), name: 'کاوش‌سنج', slug: 'kavosh-sanj' },
    { id: uuid(), name: 'پارس‌ایمن', slug: 'pars-imen' },
    { id: uuid(), name: 'بهین‌برق', slug: 'behin-bargh' },
    { id: uuid(), name: 'سپهرصنعت', slug: 'sepehr-sanat' }
  ];

  const productDefs = [
    {
      name: 'مولتی‌متر دیجیتال صنعتی True-RMS مدل KS-420',
      slug: 'ks-420-industrial-multimeter',
      description: 'مولتی‌متر دقیق صنعتی با قابلیت اندازه‌گیری True-RMS، صفحهٔ نمایش نورپس‌زمینه، محافظ اضافه‌بار CAT IV و بدنهٔ ضدضربه مناسب تکنسین‌های برق و کارگاه.',
      brand: brands[0].id,
      category: categories[0].id,
      svgFile: 'seed-multimeter.svg',
      accent: '#0ea5e9',
      icon: '<rect x="28" y="8" width="64" height="104" rx="10"/><rect x="38" y="20" width="44" height="26" rx="4"/><circle cx="60" cy="72" r="16"/><line x1="60" y1="72" x2="70" y2="62"/>',
      skus: [
        { code: 'CM-KS420-STD', attrs: { پکیج: 'استاندارد با پراب سیلیکونی', رنگ: 'زرد صنعتی' }, price: 2450000, cost: 1820000, stock: 18, weight: 420 },
        { code: 'CM-KS420-CAL', attrs: { پکیج: 'همراه گواهی کالیبراسیون و کیف ضدضربه', رنگ: 'زرد صنعتی' }, price: 2980000, cost: 2190000, stock: 9, weight: 680 }
      ]
    },
    {
      name: 'کلاه ایمنی مهندسی استاندارد با بند چانهٔ چهارنقطه‌ای',
      slug: 'pi-pro-safety-helmet',
      description: 'کلاه ایمنی سبک از جنس پلی‌اتیلن فشرده (HDPE) با عایق الکتریکی، تهویهٔ جانبی قابل تنظیم و هدبند ضدتعریق برای محیط‌های عمرانی و صنعتی.',
      brand: brands[1].id,
      category: categories[1].id,
      svgFile: 'seed-helmet.svg',
      accent: '#f59e0b',
      icon: '<path d="M16 78 C16 38, 104 38, 104 78 Z"/><line x1="8" y1="78" x2="112" y2="78"/><path d="M46 42 L46 28 L74 28 L74 42"/>',
      skus: [
        { code: 'CM-HLM-WHT', attrs: { رنگ: 'سفید (مهندسی)', سایز: 'قابل تنظیم ۵۳ تا ۶۲' }, price: 485000, cost: 330000, stock: 35, weight: 390 },
        { code: 'CM-HLM-YLW', attrs: { رنگ: 'زرد (عملیاتی)', سایز: 'قابل تنظیم ۵۳ تا ۶۲' }, price: 465000, cost: 315000, stock: 42, weight: 390 },
        { code: 'CM-HLM-RED', attrs: { رنگ: 'قرمز (ایمنی/آتش‌نشانی)', سایز: 'قابل تنظیم ۵۳ تا ۶۲' }, price: 495000, cost: 340000, stock: 4, weight: 390 }
      ]
    },
    {
      name: 'منبع تغذیهٔ آزمایشگاهی متغیر ۳۰ ولت ۱۰ آمپر مدل BB-3010',
      slug: 'bb-3010-dc-bench-power-supply',
      description: 'منبع تغذیهٔ سوئیچینگ دقیق با نمایشگر چهاررقمی ولتاژ و جریان، تنظیم دقیق Coarse/Fine، محافظت اتصال کوتاه و فن هوشمند کم‌صدا.',
      brand: brands[2].id,
      category: categories[2].id,
      svgFile: 'seed-psu.svg',
      accent: '#10b981',
      icon: '<rect x="12" y="24" width="96" height="72" rx="8"/><rect x="24" y="38" width="42" height="22" rx="3"/><circle cx="86" cy="48" r="8"/><circle cx="86" cy="74" r="8"/><circle cx="34" cy="76" r="5"/><circle cx="52" cy="76" r="5"/>',
      skus: [
        { code: 'CM-BB3010-1CH', attrs: { کانال: 'تک‌کانال ۳۰V / ۱۰A' }, price: 4750000, cost: 3650000, stock: 11, weight: 2100 },
        { code: 'CM-BB3010-2CH', attrs: { کانال: 'دوکانال هم‌زمان ۳۰V / ۵A' }, price: 7850000, cost: 6100000, stock: 3, weight: 3800 }
      ]
    },
    {
      name: 'متر لیزری صنعتی برد ۸۰ متر مدل KS-L80',
      slug: 'ks-l80-laser-distance-meter',
      description: 'متر لیزری ضدغبار و پاشش آب (IP54) با محاسبهٔ مساحت، حجم و فیثاغورث، حافظهٔ ۳۰ اندازه‌گیری اخیر و تراز دیجیتال داخلی.',
      brand: brands[0].id,
      category: categories[0].id,
      svgFile: 'seed-laser.svg',
      accent: '#6366f1',
      icon: '<rect x="34" y="14" width="52" height="92" rx="8"/><line x1="60" y1="2" x2="60" y2="14" stroke-dasharray="4 4"/><rect x="44" y="26" width="32" height="24" rx="3"/><circle cx="60" cy="72" r="10"/>',
      skus: [
        { code: 'CM-KSL80', attrs: { برد: '۸۰ متر', دقت: '±۱.۵ میلی‌متر' }, price: 1920000, cost: 1390000, stock: 15, weight: 185 },
        { code: 'CM-KSL120', attrs: { برد: '۱۲۰ متر', دقت: '±۱.۵ میلی‌متر' }, price: 2640000, cost: 1910000, stock: 7, weight: 195 }
      ]
    },
    {
      name: 'مجموعه آچار بکس و جغجغهٔ کروم‌وانادیوم ۴۶ پارچه',
      slug: 'ss-46pc-socket-wrench-set',
      description: 'ست کاربردی تعمیرات صنعتی و کارگاهی ساخته‌شده از فولاد کروم‌وانادیوم آبکاری‌شده همراه جعبهٔ قفل‌فلزی مقاوم.',
      brand: brands[3].id,
      category: categories[3].id,
      svgFile: 'seed-wrench.svg',
      accent: '#ec4899',
      icon: '<path d="M26 94 L76 44 A20 20 0 1 0 62 30 L12 80 Z"/><circle cx="24" cy="84" r="4"/>',
      skus: [
        { code: 'CM-SS46-14', attrs: { درایو: '۱/۴ اینچ — ۴۶ پارچه' }, price: 1380000, cost: 980000, stock: 24, weight: 1450 },
        { code: 'CM-SS94-12', attrs: { درایو: '۱/۴ و ۱/۲ اینچ — ۹۴ پارچه' }, price: 3420000, cost: 2540000, stock: 2, weight: 5900 }
      ]
    },
    {
      name: 'کفش ایمنی سرپنجهٔ کامپوزیت ضدلغزش مدل PI-S3',
      slug: 'pi-s3-composite-safety-boot',
      description: 'کفش ایمنی استاندارد S3 با سرپنجهٔ کامپوزیت سبک عایق برق، زیرهٔ PU دوگانه مقاوم در برابر روغن و سایش و کفی طبی تنفس‌پذیر.',
      brand: brands[1].id,
      category: categories[1].id,
      svgFile: 'seed-boot.svg',
      accent: '#14b8a6',
      icon: '<path d="M24 24 L56 24 L60 62 L104 72 A12 12 0 0 1 108 88 L20 88 Z"/><line x1="20" y1="80" x2="106" y2="80"/>',
      skus: [
        { code: 'CM-PIS3-41', attrs: { سایز: '۴۱', رنگ: 'مشکی-طوسی' }, price: 1650000, cost: 1180000, stock: 10, weight: 980 },
        { code: 'CM-PIS3-42', attrs: { سایز: '۴۲', رنگ: 'مشکی-طوسی' }, price: 1650000, cost: 1180000, stock: 14, weight: 1020 },
        { code: 'CM-PIS3-43', attrs: { سایز: '۴۳', رنگ: 'مشکی-طوسی' }, price: 1650000, cost: 1180000, stock: 12, weight: 1060 },
        { code: 'CM-PIS3-44', attrs: { سایز: '۴۴', رنگ: 'مشکی-طوسی' }, price: 1690000, cost: 1210000, stock: 8, weight: 1100 }
      ]
    }
  ];

  const serviceCategories = [
    { id: uuid(), name: 'کالیبراسیون و آزمون فنی', slug: 'calibration-testing' },
    { id: uuid(), name: 'تعمیرات تخصصی تجهیزات', slug: 'specialized-repair' },
    { id: uuid(), name: 'بازرسی و مشاورهٔ کارگاهی', slug: 'workshop-inspection' }
  ];

  const serviceDefs = [
    {
      id: uuid(),
      name: 'کالیبراسیون و صدور گواهی سلامت تجهیزات اندازه‌گیری',
      slug: 'instrument-calibration-certificate',
      category_id: serviceCategories[0].id,
      description: 'آزمون دقت و کالیبراسیون انواع مولتی‌متر، متر لیزری، کلمپ‌متر و منابع تغذیهٔ آزمایشگاهی همراه با گزارش عدم قطعیت و گواهی قابل استناد.',
      terms: 'دستگاه باید بدون آسیب فیزیکی شدید یا نشتی باتری تحویل داده شود. گواهی نهایی به‌صورت فایل PDF مهرشده در پروندهٔ مشتری بارگذاری می‌شود.',
      exclusions: 'تعمیر قطعات سوخته یا تعویض سنسور خارج از شمول کالیبراسیون است و نیازمند ثبت درخواست تعمیر جداگانه خواهد بود.',
      price_toman: 480000,
      est_duration_text: '۲ روز کاری پس از تأیید پرداخت',
      sla_hours: 48,
      priority_default: 'normal',
      form_schema: [
        { name: 'device_type', label: 'نوع دستگاه', type: 'select', required: true, options: ['مولتی‌متر دیجیتال', 'متر لیزری', 'منبع تغذیه', 'کلمپ‌متر', 'سایر'] },
        { name: 'brand_model', label: 'برند و مدل دستگاه', type: 'text', required: true, max: 120 },
        { name: 'serial_number', label: 'شماره سریال دستگاه', type: 'text', required: true, max: 80 },
        { name: 'last_calibration_note', label: 'توضیحات یا تاریخ آخرین کالیبراسیون', type: 'textarea', required: false, max: 800 }
      ],
      required_documents: ['تصویر پلاک مشخصات یا شماره سریال دستگاه (اختیاری ولی توصیه‌شده)'],
      team_queue: 'calibration',
      capacity_per_day: 25,
      delivery_method: 'فایل گواهی PDF در پنل کاربری + برچسب فیزیکی',
      cancel_policy: 'تا پیش از شروع آزمون (وضعیت در صف) امکان لغو کامل و استرداد وجه وجود دارد.'
    },
    {
      id: uuid(),
      name: 'عیب‌یابی اولیه و برآورد هزینهٔ تعمیر تجهیزات (رایگان)',
      slug: 'free-initial-diagnostics',
      category_id: serviceCategories[1].id,
      description: 'بررسی اولیهٔ علائم خرابی ابزار یا تجهیزات برقی کارگاهی توسط کارشناس فنی و اعلام نظر کارشناسی و برآورد شفاف پیش از هرگونه اقدام تعمیراتی.',
      terms: 'این خدمت رایگان است و صرفاً شامل بررسی شرح خرابی، تصاویر ارسالی و اعلام نظر فنی اولیه در سامانه است.',
      exclusions: 'بازکردن فیزیکی بردهای پلمب گارانتی بدون رضایت کتبی مشتری انجام نمی‌شود.',
      price_toman: 0,
      est_duration_text: 'حداکثر ۲۴ ساعت کاری',
      sla_hours: 24,
      priority_default: 'normal',
      form_schema: [
        { name: 'equipment_name', label: 'نام و مدل تجهیز', type: 'text', required: true, max: 120 },
        { name: 'fault_category', label: 'نوع ایراد مشاهده‌شده', type: 'select', required: true, options: ['روشن نشدن دستگاه', 'خطای نمایشگر یا دقت', 'داغ شدن یا بوی سوختگی', 'ایراد مکانیکی/ضربه', 'سایر'] },
        { name: 'fault_description', label: 'شرح دقیق مشکل و شرایط بروز', type: 'textarea', required: true, max: 1500 },
        { name: 'contact_phone', label: 'شماره تماس هماهنگی', type: 'phone', required: true }
      ],
      required_documents: ['تصویر واضح از دستگاه و نمایشگر یا بخش آسیب‌دیده'],
      team_queue: 'repairs',
      capacity_per_day: 40,
      delivery_method: 'گزارش کارشناسی متنی و فایل پیوست در پرونده',
      cancel_policy: 'خدمت رایگان است و در هر مرحله پیش از تکمیل قابل لغو توسط مشتری است.'
    },
    {
      id: uuid(),
      name: 'تعمیر تخصصی برد و منبع تغذیهٔ صنعتی',
      slug: 'industrial-psu-board-repair',
      category_id: serviceCategories[1].id,
      description: 'تعمیر تخصصی مدارات سوئیچینگ، تعویض المان‌های قدرت، تست بار کامل ۴ ساعته و ارائهٔ برگهٔ تست خروجی.',
      terms: 'هزینهٔ پایه مربوط به اجرت عیب‌یابی عمقی و تعمیر مدار اصلی است. پیش از آغاز کار پرداخت در سامانه انجام می‌شود.',
      exclusions: 'بردهای دچار سوختگی عمیق چندلایه (کربنه‌شدن کامل فیبر) در صورت غیرقابل‌ترمیم بودن با ثبت گزارش مسترد می‌شوند.',
      price_toman: 950000,
      est_duration_text: '۲ تا ۳ روز کاری',
      sla_hours: 72,
      priority_default: 'high',
      form_schema: [
        { name: 'board_model', label: 'مدل دستگاه یا منبع تغذیه', type: 'text', required: true, max: 120 },
        { name: 'nominal_voltage', label: 'ولتاژ نامی خروجی (ولت)', type: 'number', required: true },
        { name: 'symptom', label: 'علائم خرابی و سابقهٔ تعمیر قبلی', type: 'textarea', required: true, max: 1500 }
      ],
      required_documents: ['تصویر نمای نزدیک از برد یا برچسب مشخصات فنی'],
      team_queue: 'repairs',
      capacity_per_day: 15,
      delivery_method: 'گزارش تست بار + هماهنگی تحویل فیزیکی',
      cancel_policy: 'پیش از ورود به مرحلهٔ در حال انجام، لغو و بازپرداخت کامل انجام می‌شود.'
    },
    {
      id: uuid(),
      name: 'ارزیابی ایمنی برق و چیدمان تجهیزات کارگاه',
      slug: 'workshop-electrical-safety-audit',
      category_id: serviceCategories[2].id,
      description: 'بررسی چک‌لیست ایمنی تابلو برق، ارتینگ، روشنایی اضطراری و چیدمان تجهیزات کارگاهی بر اساس مستندات ارسالی و ارائهٔ برنامهٔ اصلاحی اولویت‌بندی‌شده.',
      terms: 'مشتری نقشه یا تصاویر تابلوها و محیط کارگاه را بارگذاری می‌کند و چک‌لیست تحلیلی دریافت می‌نماید.',
      exclusions: 'این خدمت جایگزین تاییدیهٔ رسمی ادارهٔ کار یا آتش‌نشانی نیست و جنبهٔ فنی-مشاوره‌ای دارد.',
      price_toman: 620000,
      est_duration_text: '۳ تا ۴ روز کاری',
      sla_hours: 96,
      priority_default: 'normal',
      form_schema: [
        { name: 'workshop_area_m2', label: 'متراژ تقریبی کارگاه (متر مربع)', type: 'number', required: true },
        { name: 'staff_count', label: 'تعداد نفرات شاغل در شیفت', type: 'number', required: true },
        { name: 'power_phase', label: 'نوع انشعاب برق', type: 'select', required: true, options: ['تک‌فاز', 'سه‌فاز صنعتی'] },
        { name: 'current_concerns', label: 'مهم‌ترین دغدغه یا حادثهٔ قبلی', type: 'textarea', required: true, max: 1500 }
      ],
      required_documents: ['تصویر تابلو برق اصلی و محیط کارگاه'],
      team_queue: 'inspection',
      capacity_per_day: 10,
      delivery_method: 'فایل گزارش ارزیابی و چک‌لیست اصلاحی PDF',
      cancel_policy: 'تا پیش از شروع بررسی کارشناس امکان لغو و استرداد وجه برقرار است.'
    }
  ];

  tx(() => {
    for (const u of Object.values(users)) {
      run(
        'INSERT INTO users (id, phone, email, full_name, password_hash, password_salt, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [u.id, u.phone, u.email, u.full_name, defaultPass.passwordHash, defaultPass.passwordSalt, u.role, 'active', past2d, past2d]
      );
      run(
        'INSERT INTO password_history (id, user_id, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
        [uuid(), u.id, defaultPass.passwordHash, defaultPass.passwordSalt, past2d]
      );
    }

    // Customer default addresses
    const addr1Id = uuid();
    run(
      `INSERT INTO user_addresses (id, user_id, title, province, city, address_line, postal_code, recipient_name, recipient_phone, is_default, created_at)
       VALUES (?, ?, 'کارگاه مرکزی', 'تهران', 'تهران', 'خیابان آزادی، بعد از دانشگاه شریف، کوچهٔ صادقی، پلاک ۱۴، واحد ۲', '1458896321', 'امیرحسین محمدی', '09120000010', 1, ?)`,
      [addr1Id, users.customer.id, past2d]
    );
    const addr2Id = uuid();
    run(
      `INSERT INTO user_addresses (id, user_id, title, province, city, address_line, postal_code, recipient_name, recipient_phone, is_default, created_at)
       VALUES (?, ?, 'دفتر فنی', 'اصفهان', 'اصفهان', 'خیابان چهارباغ بالا، مجتمع فنی پارسیان، طبقهٔ سوم، واحد ۳۱۲', '8163945120', 'الهام شریفی', '09120000011', 1, ?)`,
      [addr2Id, users.customer2.id, past2d]
    );

    for (const c of categories) {
      run('INSERT INTO categories (id, name, slug, parent_id, sort_order) VALUES (?, ?, ?, NULL, ?)', [c.id, c.name, c.slug, c.sort_order]);
    }
    for (const b of brands) {
      run('INSERT INTO brands (id, name, slug) VALUES (?, ?, ?)', [b.id, b.name, b.slug]);
    }

    const createdSkus = [];
    for (const p of productDefs) {
      const pid = uuid();
      const svgContent = makeProductSvg(p.name.slice(0, 32), p.slug, p.accent, p.icon);
      fs.writeFileSync(path.join(publicDir, p.svgFile), svgContent, 'utf8');
      const imgPath = `/uploads/${p.svgFile}`;

      run(
        `INSERT INTO products (id, name, slug, description, brand_id, category_id, status, image_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [pid, p.name, p.slug, p.description, p.brand, p.category, imgPath, past2d, past2d]
      );
      run('INSERT INTO product_images (id, product_id, path, alt_text, sort_order) VALUES (?, ?, ?, ?, 0)',
        [uuid(), pid, imgPath, p.name]);

      for (const s of p.skus) {
        const sid = uuid();
        run(
          `INSERT INTO skus (id, product_id, code, variant_attrs, price_toman, cost_price_toman, stock, weight_grams, dims, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
          [sid, pid, s.code, JSON.stringify(s.attrs), s.price, s.cost, s.stock, s.weight, past2d, past2d]
        );
        run('INSERT INTO stock_movements (id, sku_id, delta, reason, ref_type, ref_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid(), sid, s.stock, 'initial_stock', 'sku', sid, users.admin.id, past2d]);
        createdSkus.push({ id: sid, product_name: p.name, ...s });
      }
    }

    for (const sc of serviceCategories) {
      run('INSERT INTO service_categories (id, name, slug) VALUES (?, ?, ?)', [sc.id, sc.name, sc.slug]);
    }
    for (const sv of serviceDefs) {
      const schemaJson = JSON.stringify(sv.form_schema);
      const docsJson = JSON.stringify(sv.required_documents);
      run(
        `INSERT INTO services (id, name, slug, category_id, description, terms, exclusions, price_toman,
           est_duration_text, sla_hours, priority_default, form_schema, form_version, required_documents,
           team_queue, capacity_per_day, delivery_method, cancel_policy, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [sv.id, sv.name, sv.slug, sv.category_id, sv.description, sv.terms, sv.exclusions, sv.price_toman,
          sv.est_duration_text, sv.sla_hours, sv.priority_default, schemaJson, docsJson,
          sv.team_queue, sv.capacity_per_day, sv.delivery_method, sv.cancel_policy, past2d, past2d]
      );
      run(
        `INSERT INTO service_form_versions (id, service_id, version, form_schema, terms_snapshot, price_toman, sla_hours, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
        [uuid(), sv.id, schemaJson, sv.terms, sv.price_toman, sv.sla_hours, past2d]
      );
    }

    // Sample Order 1 (paid — ready in warehouse queue)
    const ord1Id = uuid();
    const sku0 = createdSkus[0];
    const addrSnap1 = JSON.stringify({
      id: addr1Id, title: 'کارگاه مرکزی', province: 'تهران', city: 'تهران',
      address_line: 'خیابان آزادی، بعد از دانشگاه شریف، کوچهٔ صادقی، پلاک ۱۴، واحد ۲',
      postal_code: '1458896321', recipient_name: 'امیرحسین محمدی', recipient_phone: '09120000010'
    });
    run(
      `INSERT INTO orders (id, code, user_id, status, subtotal_toman, shipping_toman, discount_toman, total_toman,
         address_snapshot, address_id, shipping_method, tracking_code, idempotency_key, cancel_reason, created_at, updated_at)
       VALUES (?, 'CM-SEED2401', ?, 'paid', ?, 0, 0, ?, ?, ?, 'post', NULL, 'seed-ord-1', NULL, ?, ?)`,
      [ord1Id, users.customer.id, sku0.price, sku0.price, addrSnap1, addr1Id, past5h, past5h]
    );
    run(
      `INSERT INTO order_items (id, order_id, sku_id, product_name, sku_code, variant_attrs, unit_price_toman, unit_cost_toman, quantity, line_total_toman)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [uuid(), ord1Id, sku0.id, sku0.product_name, sku0.code, JSON.stringify(sku0.attrs), sku0.price, sku0.cost, sku0.price]
    );
    run('INSERT INTO order_status_history (id, order_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
      [uuid(), ord1Id, 'pending_payment', users.customer.id, 'customer', 'ثبت سفارش', past5h]);
    run('INSERT INTO order_status_history (id, order_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
      [uuid(), ord1Id, 'pending_payment', 'paid', 'system', 'پرداخت موفق آزمایشی', past5h]);
    run(
      `INSERT INTO payments (id, order_id, service_request_id, amount_toman, status, gateway, gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'paid', 'sandbox', 'SBX-SEED-1001', ?, ?, NULL, ?, ?)`,
      [uuid(), ord1Id, sku0.price, crypto.randomBytes(24).toString('hex'), past5h, past5h, past5h]
    );

    // Sample Service Request 1 (queued paid calibration — ready for operator assignment)
    const sr1Id = uuid();
    const paySr1Id = uuid();
    run(
      `INSERT INTO service_requests (id, code, service_id, user_id, status, priority, form_data, form_version, terms_snapshot,
         price_toman, assigned_to, assigned_team, due_at, waiting_since, result_summary, payment_id, cancel_reason, created_at, updated_at, closed_at)
       VALUES (?, 'SR-SEED3101', ?, ?, 'queued', 'high', ?, 1, ?, ?, NULL, 'calibration', ?, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
      [sr1Id, serviceDefs[0].id, users.customer.id,
        JSON.stringify({ device_type: 'مولتی‌متر دیجیتال', brand_model: 'کاوش‌سنج KS-420', serial_number: 'SN-9981204', last_calibration_note: 'اولین دورهٔ کالیبراسیون سالانه' }),
        serviceDefs[0].terms, serviceDefs[0].price_toman, future40h, past5h, past5h]
    );
    run(
      `INSERT INTO payments (id, order_id, service_request_id, amount_toman, status, gateway, gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at)
       VALUES (?, NULL, ?, ?, 'paid', 'sandbox', 'SBX-SEED-1002', ?, ?, NULL, ?, ?)`,
      [paySr1Id, sr1Id, serviceDefs[0].price_toman, crypto.randomBytes(24).toString('hex'), past5h, past5h, past5h]
    );
    run('UPDATE service_requests SET payment_id = ? WHERE id = ?', [paySr1Id, sr1Id]);
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
      [uuid(), sr1Id, 'submitted', users.customer.id, 'customer', 'ثبت درخواست توسط مشتری', past5h]);
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
      [uuid(), sr1Id, 'submitted', 'queued', 'system', 'پرداخت موفق — ورود به صف', past5h]);

    // Sample Service Request 2 (in_progress & SLA at risk within 8h — assigned to operator)
    const sr2Id = uuid();
    run(
      `INSERT INTO service_requests (id, code, service_id, user_id, status, priority, form_data, form_version, terms_snapshot,
         price_toman, assigned_to, assigned_team, due_at, waiting_since, result_summary, payment_id, cancel_reason, created_at, updated_at, closed_at)
       VALUES (?, 'SR-SEED3102', ?, ?, 'in_progress', 'urgent', ?, 1, ?, 0, ?, 'repairs', ?, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
      [sr2Id, serviceDefs[1].id, users.customer2.id,
        JSON.stringify({ equipment_name: 'منبع تغذیه BB-3010', fault_category: 'خطای نمایشگر یا دقت', fault_description: 'جریان نمایش‌داده‌شده در بار ۲ آمپر حدود ۰.۳ آمپر انحراف دارد.', contact_phone: '09120000011' }),
        serviceDefs[1].terms, users.operator.id, future8h, past2d, past3h]
    );
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
      [uuid(), sr2Id, 'queued', users.customer2.id, 'customer', 'خدمت رایگان — ورود به صف', past2d]);
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), sr2Id, 'queued', 'assigned', users.operator.id, 'operator', 'تخصیص به کاوه رضایی', past5h]);
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), sr2Id, 'assigned', 'in_progress', users.operator.id, 'operator', 'شروع بررسی فنی', past3h]);
    run('INSERT INTO request_messages (id, request_id, author_id, author_role, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid(), sr2Id, users.operator.id, 'operator', 'internal_note', 'یادداشت داخلی اپراتور: شانت جریان نیاز به بررسی مقاومتی دارد (این پیام نباید برای مشتری نمایش داده شود).', past3h]);
    run('INSERT INTO request_messages (id, request_id, author_id, author_role, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid(), sr2Id, users.operator.id, 'operator', 'operator', 'پروندهٔ شما در حال بررسی توسط واحد فنی است؛ نتیجه تا پایان امروز اعلام می‌شود.', past3h]);

    // Sample Support Ticket
    const tk1Id = uuid();
    run(
      `INSERT INTO tickets (id, code, user_id, category, subject, priority, status, assigned_to, team, created_at, updated_at, closed_at)
       VALUES (?, 'TK-SEED4101', ?, 'orders', 'هماهنگی ساعت تحویل سفارش CM-SEED2401', 'normal', 'new', NULL, 'support', ?, ?, NULL)`,
      [tk1Id, users.customer.id, past3h, past3h]
    );
    run('INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), tk1Id, users.customer.id, 'customer', 'سلام، لطفاً در صورت امکان بستهٔ سفارش CM-SEED2401 بین ساعت ۹ تا ۱۴ به نگهبانی کارگاه تحویل داده شود.', past3h]);

    // Initial audit entry (written through the hash-chained helper so verification passes).
    audit(users.admin.id, 'admin', 'system.seed', 'system', 'v1', { note: 'initial synthetic seed' });
  });

  seedLthDemoIfEmpty({ silent });

  if (!silent) console.log('seed: synthetic data created successfully.');
  return { skipped: false };
}

if (require.main === module) {
  seed();
  close();
}

module.exports = { seed };
