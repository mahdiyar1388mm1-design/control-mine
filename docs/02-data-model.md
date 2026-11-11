# مدل داده — CENTRAL MINE (SQLite)

همهٔ شناسه‌ها TEXT (UUID یا کد انسانی). مبالغ: INTEGER **تومان**. تاریخ‌ها: ISO-8601 UTC. تغییر schema فقط از طریق migration نسخه‌بندی‌شده (`server/src/db/migrations/`).

## identity
- **users**(id, phone UNIQUE, email UNIQUE NULL, full_name, password_hash, password_salt, role[customer|operator|support|warehouse|finance|admin], status[active|suspended], created_at, updated_at)
- **user_addresses**(id, user_id→users, title, province, city, address_line, postal_code, recipient_name, recipient_phone, is_default, created_at)
- **sessions**(id=jti, user_id, created_at, expires_at, revoked_at, user_agent) — نشست قابل ابطال
- **otp_codes**(id, phone, code_hash, expires_at, attempts, consumed_at, created_at) — کد خام ذخیره نمی‌شود

## catalog
- **categories**(id, name, slug UNIQUE, parent_id NULL, sort_order)
- **brands**(id, name, slug UNIQUE)
- **products**(id, name, slug UNIQUE, description, brand_id, category_id, status[active|draft|archived], image_path NULL, created_at, updated_at, deleted_at NULL) — soft-delete؛ حذف فیزیکی با سفارش قبلی ممنوع
- **product_images**(id, product_id, path, alt_text, sort_order)
- **skus**(id, product_id, code UNIQUE, variant_attrs JSON, price_toman, cost_price_toman(فقط نقش‌های مجاز), stock, weight_grams, dims JSON NULL, is_active, created_at, updated_at)
- **stock_movements**(id, sku_id, delta, reason, ref_type, ref_id, actor_id, created_at) — دفتر موجودی

## cart / orders
- **carts**(id, user_id UNIQUE, created_at, updated_at)
- **cart_items**(id, cart_id, sku_id, quantity, UNIQUE(cart_id, sku_id))
- **orders**(id, code UNIQUE «CM-…», user_id, status[pending_payment|paid|preparing|shipped|completed|canceled|return_in_progress|returned], subtotal_toman, shipping_toman, discount_toman, total_toman, address_snapshot JSON, shipping_method, tracking_code NULL, idempotency_key NULL UNIQUE, cancel_reason NULL, created_at, updated_at)
- **order_items**(id, order_id, sku_id, product_name, sku_code, variant_attrs JSON, unit_price_toman, unit_cost_toman(اسنپ‌شات برای گزارش سود), quantity, line_total_toman)
- **order_status_history**(id, order_id, from_status, to_status, actor_id, actor_role, reason, created_at)

## payments
- **payments**(id, order_id NULL, service_request_id NULL, amount_toman, status[pending|paid|failed|canceled|expired|refunded], gateway «sandbox», gateway_ref NULL, callback_token UNIQUE, paid_at NULL, created_at, updated_at, failure_reason NULL)
- **payment_events**(id, payment_id, event, payload_hash, created_at) — callback تکراری اثر مالی تکراری ندارد
- **refunds**(id, payment_id, amount_toman, reason, reference, status, actor_id, created_at)

## services
- **service_categories**(id, name, slug UNIQUE)
- **services**(id, name, slug UNIQUE, category_id, description, terms, exclusions, price_toman (0=رایگان), est_duration_text, sla_hours, priority_default, form_schema JSON, form_version, required_documents JSON, team_queue, capacity_per_day NULL, delivery_method, cancel_policy, is_active, created_at, updated_at)
- **service_form_versions**(id, service_id, version, form_schema JSON, terms_snapshot, price_toman, sla_hours, created_at) — اسنپ‌شات؛ تغییر خدمت پروندهٔ قدیمی را عوض نمی‌کند
- **service_requests**(id, code UNIQUE «SR-…», service_id, user_id, status[draft|submitted|queued|assigned|in_progress|waiting_customer|completed|canceled|rejected|failed|refunded], priority, form_data JSON, form_version, terms_snapshot, price_toman, assigned_to NULL, assigned_team, due_at (SLA), waiting_since NULL, result_summary NULL, payment_id NULL, cancel_reason NULL, created_at, updated_at, closed_at NULL)
- **request_status_history**(id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at)
- **request_messages**(id, request_id, author_id, author_role, kind[customer|operator|internal_note|system], body, created_at) — internal_note در API مشتری برنمی‌گردد
- **request_files**(id, request_id, uploader_id, kind[customer_document|result_file|internal], original_name, stored_name, mime, size_bytes, created_at)

## support
- **tickets**(id, code UNIQUE «TK-…», user_id, category, subject, priority, status[new|open|waiting_customer|waiting_team|resolved|closed], assigned_to NULL, team, created_at, updated_at, closed_at NULL)
- **ticket_messages**(id, ticket_id, author_id, author_role, body, created_at)
- **ticket_files**(id, ticket_id, uploader_id, original_name, stored_name, mime, size_bytes, created_at)

## platform
- **notifications**(id, user_id, type, title, body, link NULL, is_read, created_at)
- **audit_log**(id, actor_id, actor_role, action, entity_type, entity_id, detail JSON, created_at) — append-only
- **idempotency_keys**(key, user_id, endpoint, request_hash, response_json, status_code, created_at)
- **schema_migrations**(version PRIMARY KEY, applied_at)
- **settings**(key PRIMARY KEY, value JSON) — نرخ ارسال، آستانهٔ رایگان، نام فروشگاه

## قواعد کلیدی
- مبالغ صحیح (تومان)؛ محاسبات مالی با اعداد صحیح؛ هیچ float در مالی.
- قیمت/موجودی قطعی در لحظهٔ ثبت سفارش در تراکنش با `UPDATE … WHERE stock >= ?` (جلوگیری از فروش بیش از موجودی).
- موجودی با دلیل و سابقه تغییر می‌کند (stock_movements)؛ لغو/مرجوعی حداکثر یک‌بار موجودی را برمی‌گرداند.
- گزارش سود از `unit_cost_toman` اسنپ‌شات‌شده در order_items، نه قیمت خرید جاری.
