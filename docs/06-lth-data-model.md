# مدل داده LTH (LOTH COIN) — CENTRAL MINE

این سند تکمیل‌کنندهٔ `02-data-model.md` است و جدول‌های مایگریشن 002 و 003 و 005 را پوشش می‌دهد.

## قانون واحد پول (اصلاح‌شده)
- سفارش‌های فروشگاه: مبالغ `INTEGER` به **تومان**.
- LTH: مقدار دارایی به **اتم** (TEXT، عدد صحیح بزرگ، هر LTH = 10^12 اتم) و نرخ/مبلغ ریالی به **IRR** (TEXT).
- `lth_purchase_orders` هر دو نوع را دارد: `amount_toman` (مبلغ پرداختی) و `amount_irr`/`unit_price_irr`/`lth_atoms` (معادل دارایی). هنگام گزارش، همیشه واحد را صریح بنویس.
- هیچ‌جا float استفاده نشود.

## جدول‌های LTH
- **lth_settings** (تک‌ردیفی): قیمت IRR، نرخ پاداش، درصد استیک و قابل برداشت (جمعشان ۱۰۰۰۰ bps)، مدت قفل (پیش‌فرض ۳۲۸۵ روز)، فاصلهٔ پاداش (پیش‌فرض ۲۴ ساعت)، پکیج‌های تومانی و لوگو.
- **lth_treasury_config** (تک‌ردیفی): کل عرضه، کارمزد انتقال و فروش (bps، حداکثر ۲۰۰۰).
- **lth_wallets**: موجودی هر کاربر (base، staked، withdrawable_reward، reserved). منفی شدن با trigger مایگریشن 005 بلاک می‌شود.
- **lth_purchase_orders**: خرید از درگاه؛ `payment_id` یکتا و FK به `payments`.
- **lth_holdings**: هر قرارداد خرید، تاریخ قفل و زمان پاداش بعدی. `status` = active|closed.
- **lth_reward_cycles**: هر چرخهٔ پاداش یک‌بار (یکتا روی holding + cycle_number)، همراه با `server_instance_id` برای ردیابی.
- **lth_ledger**: دفتر حرکت‌ها با نوع مشخص (purchase، reward، unlock، برداشت شبا، فروش، انتقال P2P، بازگشت خرید). هر ردیف snapshot قیمت دارد.
- **lth_sheba_withdrawals**: برداشت شبا و فروش LTH، با وضعیت pending|paid|rejected|canceled و بازبین.
- **lth_transfers**: انتقال P2P بین کاربرها.
- **lth_unlocked_stake_pools**: استیک باز شده هر کاربر.
- **lth_treasury_ledger**: حرکت‌های خزانه (return_base، return_stake، return_reward، collect_fee).
- **distributed_scheduler_leases**: قفل توزیع‌شده برای job پاداش بین چند سرور.

### مهاجرت ۰۱۲ — حسابداری پایه و مالیات (`012_lth_protocol_tax_and_base_flow`)

- `lth_treasury_ledger` بازسازی شد (copy → drop → rename) تا `CHECK(event_type)` انواع
  جدید را بپذیرد: `issue_base`, `return_base`, `return_stake`, `return_reward`,
  `collect_fee`, `tax_accrued`, `tax_settled`. برای هر نوع رویداد جدید در آینده هم
  همین الگوی بازسازی لازم است؛ ALTER روی CHECK در SQLite کار نمی‌کند.
- ایندکس‌های جدید: `idx_lth_treasury_ledger_type (event_type, created_at)` و
  `idx_lth_treasury_ledger_ref (ref_type, ref_id)`.
- Backfill ایذمپوتنت: برای هر `lth_purchase_orders` با وضعیت `fulfilled` که رویداد
  `issue_base` ندارد، یک ردیف با `id = 'bf-issue-' || p.id` و
  `ref_type='lth_purchase'` درج می‌شود (`NOT EXISTS` مانع تکرار است). اجرای دوبارهٔ
  مهاجرت هیچ ردیف تکراری نمی‌سازد.
- تنظیمات جدید در `settings`: `lth_protocol_tax_bps` (پیش‌فرض `1000` = ۱۰٪)،
  `lth_protocol_tax_label` (برچسب فارسی مالیات) و `lth_base_row_label`
  («میزان پایه») تا برچسب ردیف خزانه بدون تغییر کد قابل تنظیم باشد.
- `013` به بعد ندارد؛ `012.down.sql` جدول را به شکل قبلی برمی‌گرداند و تنظیمات را پاک می‌کند.

### قواعد نگهداری LTH پس از ۰۱۲
- **۷۰/۳۰ همیشگی:** `stake_bps` = ۷۰۰۰ و `withdrawable_bps` = ۳۰۰۰ در هر ردیف پاداش؛
  مجموع همیشه ۱۰۰۰۰ و `withdrawable = total − staked` محاسبه می‌شود، نه گرد کردن مستقل.
- **پایه:** `base_flow = Σissue_base − Σreturn_base` و باید با `Σ wallets.base_atoms`
  بخواند؛ اختلاف به‌صورت `opening_atoms` گزارش می‌شود
  (`base_flow + opening = wallet_base`).
- **مالیات:** هر `collect_fee` بلافاصله یک `tax_accrued` هم‌اندازه می‌سازد؛
  `tax_settled` فقط با پرداخت واقعی (`POST /admin/lth/tax/settle`).
- **بازگشت‌ها:** `return_stake` و `return_reward` و `return_base` هر کدام ردیف خودشان
  را دارند و با ردیف «کارمزد» جمع نمی‌شوند.

## تغییرات روی payments و user_addresses
- `payments.lth_purchase_id` (مایگریشن 002): پرداخت خرید LTH را به `lth_purchase_orders` وصل می‌کند.
- `user_addresses.recipient_email` (مایگریشن 004): ایمیل گیرنده اختیاری.

## هشدارهای باز
- مایگریشن 002 جدول `payments` را DROP و rebuild می‌کند. قبل از اجرای روی دیتای واقعی، اجرا را با `PRAGMA foreign_keys` روشن روی یک نسخهٔ کپی تست کن.
- `schema_migrations` در داک آمده ولی در ۰۰۱ تعریف نشده؛ باید در کد runner ساخته شود.
