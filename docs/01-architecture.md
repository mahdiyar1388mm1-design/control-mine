# معماری فنی — CENTRAL MINE

## انتخاب فناوری و دلیل

| لایه | انتخاب | دلیل |
|---|---|---|
| بک‌اند | Node.js 22 + Express 4 | در محیط موجود، بدون Docker، جامعهٔ پایدار |
| پایگاه داده | SQLite (WAL، تراکنشی) از `node:sqlite` | بدون سرویس جانبی؛ migration نسخه‌بندی‌شده؛ قابل تعویض با PostgreSQL در تولید (لایهٔ دسترسی ساده نگه‌داشته شده) |
| فرانت‌اند | React 18 + Vite + React Router | سبک، سریع، RTL با `dir="rtl"` |
| احراز هویت | توکن امضاشده HMAC-SHA256 (JWT-compatible) + نشست قابل ابطال در DB | بدون وابستگی سنگین؛ logout/ابطال واقعی |
| رمز عبور | scrypt از `node:crypto` با salt اختصاصی | استاندارد، بدون وابستگی native |
| فایل | ذخیرهٔ محلی خصوصی (`storage/private`) + کنترل مجوز در دانلود | بدون لینک عمومی مستقیم |
| تست | `node:test` + fetch واقعی HTTP | بدون وابستگی؛ آزمون یکپارچگی روی DB واقعی |

وابستگی‌های زمان اجرا فقط: `express`، `multer` (بارگذاری فایل). مابقی از کتابخانهٔ استاندارد Node.

## لایه‌بندی سامانه

```
client/  (React SPA — رابط مشتری و کارکنان، RTL)
   │  fetch /api/v1/*
server/
   ├─ src/app.js            ساخت برنامه Express (بدون listen — برای تست)
   ├─ src/index.js          entrypoint: migration + listen
   ├─ src/db/               اتصال، migration، کمک‌های تراکنش
   ├─ src/middleware/       auth/نقش، خطا، rate-limit، درخواست‌ID، لاگ
   ├─ src/modules/*         هر ماژول: routes + service (مالک داده و منطق)
   ├─ src/utils/            توکن، رمز، کد انسانی، اعتبارسنجی
   └─ tests/                آزمون‌های یکپارچگی/واحد
```

**قاعده:** منطق تجاری فقط در service لایهٔ بک‌اند؛ فرانت‌اند مرجع قیمت، موجودی، مجوز یا وضعیت نیست.

## جریان درخواست

`route → middleware (requestId, rateLimit, auth) → validate → service (تراکنش) → response shaping per role → audit (در صورت نیاز)`

- خطاها قالب یکدست دارند: `{ error: { code, message, requestId, details? } }`
- stack trace / SQL / secret هرگز در پاسخ نیست.
- شماره تلفن در لاگ ماسک می‌شود.

## گردش‌کار وضعیت سفارش

```
pending_payment → paid → preparing → shipped → completed
pending_payment → canceled
paid → canceled (← استرداد در صورت پرداخت)
completed → return_in_progress → returned
```
انتقال‌ها با جدول مجاز نقش→وضعیت در `orders/service.js` کنترل و در `order_status_history` با actor/زمان/علت ثبت می‌شوند.

## گردش‌کار درخواست خدمت

```
draft → submitted → queued → assigned → in_progress → waiting_customer → completed
شاخه‌ها: canceled, rejected, failed, refunded
```
پیش‌نیازها سمت سرور: `in_progress` نیازمند تخصیص؛ `completed` نیازمند نتیجه؛ خدمت پولی پیش از `queued` باید پرداخت معتبر داشته باشد.

## پرداخت (sandbox — تا زمان credential واقعی)

- Payment مستقل از Order/ServiceRequest با شناسهٔ داخلی و `gateway_ref`.
- مبلغ فقط سمت سرور محاسبه می‌شود.
- callback با امضای HMAC (شبیه‌سازی تأیید درگاه) بررسی و در جدول `payment_events` با `callback_token` یکتا idempotent می‌شود.
- نتیجهٔ نامعلوم (`expired`) از شکست و موفق جدا است.
- رسید از دادهٔ سرور تولید می‌شود.

## صف کارهای پس‌زمینه

در نسخهٔ اجراپذیر فعلی، کارهای پس‌زمینه (اعلان، بررسی SLA) در فرایند اصلی با تایمر سبک انجام می‌شوند؛ برای تولید چندنمونه‌ای، صف خارجی (مانند Redis/BullMQ) پیشنهاد و در `06-deployment-ops.md` مستند شده است.

## PWA

فقط shell و دارایی‌های استاتیک cache می‌شوند؛ هیچ API کاربری/پرداخت/سفارش cache نمی‌شود. در حالت آفلاین نوار «اتصال قطع است» نمایش داده می‌شود و عملیات حساس در صف پنهان قرار نمی‌گیرد.
