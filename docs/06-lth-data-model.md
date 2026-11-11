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

## تغییرات روی payments و user_addresses
- `payments.lth_purchase_id` (مایگریشن 002): پرداخت خرید LTH را به `lth_purchase_orders` وصل می‌کند.
- `user_addresses.recipient_email` (مایگریشن 004): ایمیل گیرنده اختیاری.

## هشدارهای باز
- مایگریشن 002 جدول `payments` را DROP و rebuild می‌کند. قبل از اجرای روی دیتای واقعی، اجرا را با `PRAGMA foreign_keys` روشن روی یک نسخهٔ کپی تست کن.
- `schema_migrations` در داک آمده ولی در ۰۰۱ تعریف نشده؛ باید در کد runner ساخته شود.
