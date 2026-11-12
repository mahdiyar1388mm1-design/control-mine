# قرارداد API — CENTRAL MINE (v1)

پیشوند: `/api/v1`. داده: JSON. تاریخ‌ها: ISO-8601 UTC. مبالغ: تومان (صحیح).

## قراردادهای عمومی

- **احراز هویت:** هدر `Authorization: Bearer <token>` یا کوکی `cm_token` (httpOnly). توکن به نشست (sessions) گره خورده و با logout باطل می‌شود.
- **Idempotency:** هدر `Idempotency-Key` برای `POST /orders` و `POST /payments`؛ تکرار درخواست یکسان → همان پاسخ ذخیره‌شده.
- **صفحه‌بندی:** `?page=1&limit=20` (حداکثر limit=100) → `{ items, page, limit, total }`.
- **خطا:** وضعیت HTTP مناسب + بدنه:
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "…", "requestId": "…", "details": [{"field":"phone","message":"…"}] } }
  ```
  کدها: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_MISMATCH`, `RATE_LIMITED`, `INVALID_STATE`, `OUT_OF_STOCK`, `PAYMENT_REQUIRED`, `INTERNAL`.
- **نرخ:** محدودیت نرخ برای ورود/OTP/ثبت‌نام/جست‌وجو/ایجاد (پاسخ 429 با `RATE_LIMITED`).
- **لاگ/ممیزی:** عملیات حساس (تغییر نقش، استرداد، اصلاح موجودی، تغییر وضعیت) در audit_log.

## auth
| روش | مسیر | مجوز | توضیح |
|---|---|---|---|
| POST | /auth/register | عمومی | phone, full_name, password → کاربر customer |
| POST | /auth/login | عمومی | phone, password → توکن |
| POST | /auth/otp/request | عمومی | phone → کد OTP (کانال sandbox: کنسول/dev) |
| POST | /auth/otp/verify | عمومی | phone, code → توکن (بدون افشای وجود حساب) |
| POST | /auth/logout | ورود | ابطال نشست |
| GET | /auth/me | ورود | پروفایل + نقش |
| POST | /auth/change-password | ورود | old_password, new_password |

## catalog (عمومی خواندنی)
| GET | /categories, /brands | عمومی | برندها فقط فعال‌ها را برمی‌گردانند و شامل `logo_path` هر برند هستند |
| GET | /brands/:slug | عمومی | جزئیات یک برند فعال (شامل `logo_path`, `description`, `website_url`، `product_count`) |
| GET | /products?q&category&brand&min_price&max_price&page | عمومی | جست‌وجو/فیلتر سمت سرور |
| GET | /products/:slug | عمومی | + SKUها (بدون قیمت خرید) |
| POST/PATCH/DELETE | /admin/products, /admin/products/:id | admin | ثبت ممیزی؛ حذف فیزیکی دارای سفارش → 409 |
| POST/PATCH | /admin/skus … | admin | |
| POST | /admin/skus/:id/stock | admin, warehouse | delta + reason اجباری → stock_movements |

## cart / orders
| GET | /cart | ورود | |
| POST | /cart/items | ورود | sku_id, quantity |
| PATCH/DELETE | /cart/items/:id | ورود | |
| POST | /orders | ورید + Idempotency-Key | address_id → محاسبهٔ قیمت/موجودی/ارسال در سرور؛ خطاهای OUT_OF_STOCK / VALIDATION |
| GET | /orders, /orders/:code | مالک/نقش‌ها | |
| POST | /orders/:code/cancel | مالک/نقش‌ها | reason؛ قاعدهٔ موجودی فقط یک‌بار |
| GET | /orders/:code/receipt | مالک | رسید از دادهٔ سرور |

## payments
| POST | /payments | ورود | { order_code } یا { service_request_code } → payment + لینک sandbox |
| GET | /payments/:id | مالک/مالی | |
| POST | /payments/sandbox/callback | امضای sandbox | callback_token یکتا؛ تکراری → بدون اثر مالی |
| POST | /payments/:id/refund | finance, admin | reason, reference اجباری؛ ممیزی |

## services
| GET | /services, /services/:slug | عمومی | |
| POST | /service-requests | ورود | service_slug, form_data, files → snapshot فرم/شرایط/قیمت + کد «SR-…» |
| GET | /service-requests (mine) | ورود | |
| GET | /service-requests/:code | مالک/اپراتور مجاز | پیام‌ها: بدون internal_note برای مشتری |
| POST | /service-requests/:code/messages | مالک/اپراتور | kind بر اساس نقش |
| POST | /service-requests/:code/cancel | مالک | |

## staff (operator/support/warehouse/finance/admin طبق نقش)
| GET | /staff/service-requests?status&service&priority&sla=breached | operator, admin | صف + برجسته‌سازی SLA |
| POST | /staff/service-requests/:id/assign | operator, admin | به خود/همکار مجاز |
| POST | /staff/service-requests/:id/status | operator, admin | انتقال مجاز + پیش‌نیاز + علت |
| POST | /staff/service-requests/:id/messages | operator, admin | پیام عمومی یا internal_note |
| POST | /staff/service-requests/:id/files | operator, admin | نتیجه/فایل خروجی |
| GET | /staff/tickets … | support, admin | |
| POST | /staff/tickets/:code/messages|status|assign | support, admin | |
| GET | /staff/orders?status | warehouse, finance, admin | |
| POST | /staff/orders/:code/status | warehouse, admin | preparing→shipped (tracking_code اجباری) → completed |

## users / notifications / admin
| GET/PATCH | /me/profile | ورود | تغییر تماس حساس: تأیید رمز |
| GET/POST/PATCH/DELETE | /me/addresses | ورود | مالکیت |
| GET | /notifications, POST /notifications/read-all | ورود | |
| GET | /admin/users, PATCH /admin/users/:id | admin | تغییر نقش/وضعیت + ممیزی |
| GET | /admin/reports/sales?from&to | admin, finance | فروش کالا (جدا از خدمات) |
| GET | /admin/reports/services?from&to | admin | |
| GET | /admin/reports/tickets?from&to | admin, support | |
| GET | /admin/reports/payments?from&to | admin, finance | |
| GET | /admin/audit | admin | |
| GET | /files/:id | مالک/نقش مجاز | دانلود خصوصی با کنترل مجوز |

## lth (LOTH COIN — موتور محاسبه، کیف پول ۷ عنوانی، خزانه و سرچ پروتکل)
| GET | /lth/config | عمومی | نرخ ریالی `1.00 LTH`، پکیج‌های تومان، درصد ریگلاژ، لوگوی آپلودی و شاخص‌های مرجع |
| GET | /lth/treasury | عمومی | وضعیت لحظه‌ای **خزانه** (۵ ردیف مصوب: دارایی ۱۵٬۰۰۰٬۰۰۰ LTH، مقدار بازار، جمع بازگشت استیک، جمع بازگشت پایه، جمع کارمزد) + گواهی تراز عرضه |
| POST | /lth/calculate | عمومی | محاسبهٔ دوطرفهٔ دقیق `BigInt` (ریال ↔ LTH تا `10^-16` و تمام موازین ۲۴ ساعته) |
| GET | /lth/health-benchmark | عمومی | شاخص مرجع پاداش ۲۴ ساعته `1.00 LTH = 0.0034 LTH = 16,456,000 IRR` |
| GET | /lth/wallet | ورود | کیف پول ۷ عنوانی (با قالب‌بندی هوشمند ۸ تا ۱۲ رقم اعشار)، قراردادهای هوشمند PoS، تطبیق دفتر حسابداری و سوابق |
| POST | /lth/purchases | ورود + Idempotency-Key | خرید پکیج یا مبلغ دلخواه LTH و ایجاد تراکنش درگاه آزمایشی |
| POST | /lth/withdrawals | ورود | ثبت درخواست برداشت شبا یا فروش LTH از محل موجودی قابل برداشت |
| POST | /lth/withdrawals/:code/cancel | ورود (مالک) | لغو درخواست در انتظار و بازگشت اتمیک موجودی |
| POST | /lth/transfers | ورود | انتقال حساب به حساب (PAY) از محل موجودی قابل برداشت |
| GET | /staff/lth/withdrawals | finance, admin | صف درخواست‌های تسویه شبا و فروش LTH |
| POST | /staff/lth/withdrawals/:code/review | finance, admin | تأیید واریز پایا با مرجع بانکی (و ثبت خودکار بازگشت پایه/استیک در خزانه) یا رد با بازگشت اتمیک |
| GET | /admin/lth/reconciliation | finance, admin | تطبیق کامل دفتر کل حسابداری با کیف پول‌ها + تراز خزانه + وضعیت کلاستر سرورها |
| GET | /admin/lth/protocol-search | finance, admin | سرچ یکپارچهٔ پروتکل در بک‌اند (کیف پول‌ها، قراردادهای `POS-...`، خریدها، شبا، انتقال‌ها، دفتر کل و پیش‌بینی تعهد N روزه) |
| GET | /admin/lth/users/:userId/inspect | finance, admin | بازرسی ۳۶۰ درجهٔ موازین ۷گانه، قراردادهای PoS و دفتر کل یک کاربر مشخص |
| PATCH | /admin/lth/settings | admin | ریگلاژ ۱۰۰٪ استیک/قابل برداشت، نرخ ریالی، قفل ۳۲۸۵ روزه و پکیج‌ها + ممیزی |
| PATCH | /admin/lth/treasury | admin | کنترل سقف عرضهٔ خزانه و نرخ کارمزد انتقال/فروش + ممیزی |
| POST | /admin/lth/logo | admin | آپلود تصویر لوگوی LTH با بررسی امضای باینری |
| POST | /admin/lth/settle-due | admin | اجرای دستی پایش چرخه‌های ۲۴ ساعتهٔ سررسیدشده |

## health
`GET /health` → { status:"ok", version } — برای health check استقرار.

---

## برندها و لوگو (مهاجرت `011_brand_logos`)

برندها فراتر از یک نام هستند: لوگو، توضیح، وب‌سایت، ترتیب نمایش و وضعیت فعال/غیرفعال.

| متد | مسیر | نقش | توضیح |
|---|---|---|---|
| GET | `/api/v1/admin/brands` | `admin`، `warehouse` | فهرست کامل (شامل غیرفعال‌ها) با `product_count` |
| POST | `/api/v1/admin/brands` | `admin` | `{ name, description?, website_url?, sort_order?, is_active?, logo_path? }` |
| PATCH | `/api/v1/admin/brands/:id` | `admin` | همان فیلدها، همه اختیاری؛ `logo_path: null` لوگو را پاک می‌کند |
| POST | `/api/v1/admin/brands/:id/logo` | `admin` | `multipart/form-data` با فیلد `logo` |
| DELETE | `/api/v1/admin/brands/:id/logo` | `admin` | حذف لوگو + پاک‌سازی فایل |
| DELETE | `/api/v1/admin/brands/:id` | `admin` | حذف برند بی‌کالا؛ برند دارای کالا `is_active=0` می‌شود |
| PATCH | `/api/v1/admin/brands-order` | `admin` | `{ items: [{ id, sort_order }] }` |

**قالب پاسخ برند**

```json
{
  "id": "uuid",
  "name": "کاوش‌سنج",
  "slug": "kavosh-sanj",
  "logo_path": "/uploads/brand-logo-<uuid>.png",
  "description": "سازندهٔ تجهیزات اندازه‌گیری دقیق",
  "website_url": "https://example.com",
  "is_active": true,
  "sort_order": 0,
  "product_count": 3,
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z"
}
```

**خطاها:** نام تکراری → `409 CONFLICT`؛ فایل نامعتبر یا جعلی → `400 VALIDATION_ERROR`؛
مسیر لوگوی غیرمجاز → `400 VALIDATION_ERROR`؛ برند ناموجود → `404 NOT_FOUND`؛ نقش ناکافی → `403 FORBIDDEN`.

**در پاسخ‌های کاتالوگ:** هر محصول در `GET /products` فیلد `brand_logo_path` دارد و در
`GET /products/:slug` شیء `brand` شامل `id`, `name`, `slug`, `logo_path`, `website_url` است.
