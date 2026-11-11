# راهنمای استقرار، پشتیبان‌گیری و بازگشت (Rollback) — CENTRAL MINE

## ۱. تفکیک محیط‌ها و اصول امنیتی (بند ۱۹)

1. **جداسازی کامل محیط‌ها:** محیط توسعه (`development`)، آزمون (`test`) و تولید (`production`) باید مسیر داده (`CM_DATA_DIR`)، ذخیره‌ساز خصوصی (`CM_STORAGE_DIR`) و کلید امضا (`CM_SECRET`) کاملاً جدا داشته باشند.
2. **حفاظت کلیدها:** هیچ فایل `.env`، کلید `.key`، فایل دیتابیس `.db` یا پشتیبان `.enc` در گیت یا ایمیج عمومی قرار نمی‌گیرد (در `.gitignore` مسدود شده است).
3. **عدم باز بودن دیتابیس به شبکهٔ عمومی:** پایگاه دادهٔ SQLite به‌صورت فایل محلی با دسترسی محدود سیستم‌عامل (`0600`) فقط در اختیار پردازهٔ API است و پورت شبکه‌ای عمومی ندارد. در صورت مهاجرت آتی به PostgreSQL نیز فقط روی شبکهٔ خصوصی داخلی بسته می‌شود.
4. **Reverse Proxy و TLS:** ترافیک بیرونی فقط روی پورت `443` با گواهی معتبر TLS توسط Nginx / Caddy پذیرفته شده و به پورت داخلی اپلیکیشن (`127.0.0.1:3000`) هدایت می‌شود.

نمونهٔ پیکربندی پایهٔ Nginx برای محیط تولید:

```nginx
server {
    listen 443 ssl http2;
    server_name example.ir;

    ssl_certificate     /etc/ssl/certs/example.crt;
    ssl_certificate_key /etc/ssl/private/example.key;
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## ۲. پشتیبان‌گیری رمزنگاری‌شده و تمرین بازیابی

### تهیهٔ نسخهٔ پشتیبان آنلاین و رمزنگاری‌شده (AES-256-GCM)

اسکریپت `server/src/db/backup.js` با دستور اتمیک `VACUUM INTO` بدون متوقف‌کردن سرویس یک کپی سازگار از دیتابیس می‌گیرد و در صورت تنظیم `CM_BACKUP_KEY` آن را با الگوریتم استاندارد `AES-256-GCM` رمزنگاری کرده و فایل خام را پاک می‌کند:

```bash
CM_BACKUP_KEY="یک-عبارت-رمزنگاری-بلند-و-مستقل" npm run backup
```

فایل `.db.enc` خروجی باید به ذخیره‌ساز خارج از سرور اصلی (Off-site Object Storage / سرور پشتیبان جداگانه) منتقل شود. برای فایل‌های خصوصی پیوست‌شده نیز دایرکتوری `CM_STORAGE_DIR` باید با ابزار رمزنگاری‌شده (مانند `restic` یا `age` + `tar`) پشتیبان‌گیری شود.

### تمرین بازیابی (Restore Drill)

```bash
node -e "
const { restoreEncryptedBackup } = require('./server/src/db/backup');
console.log(restoreEncryptedBackup('./path/to/backup.db.enc', '/tmp/drill-restored.db', process.env.CM_BACKUP_KEY));
"
```

این چرخه به‌طور خودکار در `server/tests/unit.test.js` در هر بار اجرای `npm test` تمرین و راستی‌آزمایی می‌شود.

## ۳. چک‌لیست انتشار نسخهٔ جدید (Release Procedure)

1. **ثبت نسخه و Commit مشخص:** از تگ گیت مشخص (مثلاً `v1.0.0`) بیلد بگیرید و مطمئن شوید `npm test` بدون خطا پاس شده است.
2. **پشتیبان‌گیری پیش از Migration:** پیش از هرگونه تغییر کد یا اسکیمای تولید، دستور `npm run backup` را اجرا و صحت فایل پشتیبان خارج از سرور را بررسی کنید.
3. **اجرای Migration نسخه‌بندی‌شده:**
   ```bash
   npm run migrate
   ```
   (هیچ همگام‌سازی خودکارِ تخریبی روی دیتابیس انجام نمی‌شود؛ فقط فایل‌های نسخه‌دار `migrations/*.sql` که قبلاً در `schema_migrations` ثبت نشده‌اند درون تراکنش اجرا می‌شوند.)
4. **بیلد فرانت‌اند و راه‌اندازی مجدد کنترل‌شده:**
   ```bash
   npm run build
   # ری‌استارت سرویس systemd (توجه: سرویس‌های قدیمی قبلاً disable شده باشند تا به صورت ناخواسته بالا نیایند)
   systemctl restart central-mine
   ```
5. **بررسی Health Check و مسیرهای کلیدی:**
   ```bash
   curl -fsS http://127.0.0.1:3000/health
   ```
   بررسی کنید `status: "ok"` و `db: "ok"` برگردد، سپس لاگ‌های ساختاریافته را کنترل نمایید.

## ۴. روش بازگشت در صورت شکست انتشار (Rollback)

اگر پس از انتشار در مرحلهٔ Health Check یا پایش خطا مشکلی مشاهده شد:

1. سرویس جدید را متوقف کنید (`systemctl stop central-mine`).
2. اگر migration جدیدی اعمال شده که دارای اسکریپت بازگشت (`.down.sql`) است:
   ```bash
   npm run migrate:down
   ```
   و در صورتی که تغییر دادهٔ غیرقابل‌برگشت رخ داده باشد، فایل دیتابیس را از آخرین نسخهٔ پشتیبانِ پیش از انتشار (`restoreEncryptedBackup`) بازیابی کنید.
3. کد را روی تگ پایدار قبلی (`git checkout <previous-tag>`) برگردانید، `npm run build` را اجرا کنید و سرویس را بالا بیاورید.
4. مجدداً `/health` و مسیرهای اصلی خرید و ثبت خدمت را بررسی کنید.
