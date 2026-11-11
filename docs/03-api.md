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
| GET | /categories, /brands | عمومی | |
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

## health
`GET /health` → { status:"ok", version } — برای health check استقرار.
