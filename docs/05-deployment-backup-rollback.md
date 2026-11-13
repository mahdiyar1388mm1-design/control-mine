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

---

# ۵. «APIها را کجا بگذارم؟» — نقشهٔ کامل استقرار

## ۵.۱. پاسخ کوتاه

در این پروژه **API جای جداگانه‌ای ندارد و سرور جداگانه‌ای لازم ندارد**:
یک پردازهٔ Node هم `/api/v1/*` را سرو می‌کند و هم فایل‌های ساخته‌شدهٔ فرانت‌اند
(`client/dist`) را. یعنی روی سرور فقط **پورت ۳۰۰۰** را با یک پردازه باز می‌کنید و
Nginx/Caddy در جلوی آن، دامنهٔ عمومی را به همان پورت می‌رساند.

```
اینترنت ──▶ Nginx/Caddy  (443, TLS)  ──▶  127.0.0.1:3000
                                            ├── /api/v1/*  → API (Express)
                                            ├── /uploads/* → فایل‌های عمومی (لوگو، عکس کالا)
                                            ├── /sitemap.xml, /robots.txt
                                            └── /*          → SPA (client/dist)
```

نکتهٔ کلیدی: در فرانت‌اند **هیچ آدرس API هاردکد نشده**؛ همهٔ درخواست‌ها نسبی‌اند
(`/api/v1/...` در `client/src/lib/api.js`). پس با هر دامنه‌ای کار می‌کند و لازم نیست
`VITE_API_URL` بسازید. فقط دامنه را در `CM_PUBLIC_BASE_URL` بگذارید (برای sitemap و
URL کانونیکال).

## ۵.۲. سه حالت استقرار

| حالت | کجا API می‌نشیند | مناسب برای |
|---|---|---|
| **الف) تک‌سرور (توصیه‌شده)** | همان پردازه، پورت `3000`، پشت Nginx/Caddy | همهٔ کسب‌وکارهای این پروژه |
| **ب) زیرمسیر** (`/app`) | همان پردازه روی پورت `3000`، Nginx مسیر `/app/` را پروکسی می‌کند | وقتی روی دامنه‌ای موجود جا می‌خواهید |
| **ج) تفکیک API و UI** | API روی `api.example.com` و UI روی `www.example.com` | فقط اگر CDN/چند-تیمی لازم است — **نیاز به تغییر کد دارد** (CORS و آدرس مطلق API) |

حالت (ج) را بدون نیاز شروع نکنید: کوکی‌های نشست `SameSite` دارند و CSP روی
`connect-src 'self'` تنظیم شده؛ تفکیک دامنه یعنی باز کردن CORS و تضعیف همین سیاست.

## ۵.۳. گام‌به‌گام روی سرور لینوکسی

```bash
# ۰) پیش‌نیاز: Node.js 22.5+ (ماژول توکار node:sqlite)
node -v

# ۱) گرفتن کد و نصب وابستگی‌ها
git clone <repo> /opt/central-mine && cd /opt/central-mine
npm run install:all

# ۲) ساخت فایل تنظیمات واقعی (سرور خودش .env را می‌خواند)
cp .env.example server/.env
node -e "console.log('CM_SECRET='+require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('CM_BACKUP_KEY='+require('crypto').randomBytes(32).toString('hex'))"
$EDITOR server/.env      # سه کلید بالا + CM_PUBLIC_BASE_URL + NODE_ENV=production + CM_OTP_SANDBOX=0
chmod 600 server/.env    # فقط کاربر سرویس بخواند

# ۳) ساخت فرانت‌اند (خروجی در client/dist — همان چیزی که سرور سرو می‌کند)
npm run build

# ۴) مهاجرت دیتابیس — و **بدون seed** روی تولید
npm run migrate
#    npm run seed  ← فقط برای دمو/آزمایش. روی دادهٔ واقعی اجرا نکنید.

# ۵) اجرا
npm start                # اسکریپت scripts/start-server.sh: نصب/بیلد/مهاجرت/اجرا
```

**دربارهٔ seed:** `seed` دادهٔ نمایشی می‌سازد (کاربران دمو با رمز `Cm@Test1405!`،
محصولات نمونه) و اگر مدیر از قبل وجود داشته باشد رد می‌شود. روی تولید اجرا نکنید؛
اولین مدیر را با ثبت‌نام عادی بسازید و بعد نقشش را در دیتابیس ارتقا دهید یا از
مسیر مدیریت کاربران استفاده کنید.

## ۵.۴. سرویس systemd

```ini
# /etc/systemd/system/central-mine.service
[Unit]
Description=CENTRAL MINE API + SPA
After=network.target

[Service]
Type=simple
User=centralmine
WorkingDirectory=/opt/central-mine
# تنظیمات از server/.env خوانده می‌شود؛ نیازی به Environment= نیست.
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=5
# سخت‌سازی
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/central-mine/server/data /opt/central-mine/server/storage
# محدودیت منابع
LimitNOFILE=4096
MemoryMax=1G

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now central-mine
sudo systemctl status central-mine
journalctl -u central-mine -f
```

## ۵.۵. Nginx کامل (TLS + پروکسی + محدودیت آپلود)

```nginx
server {
    listen 80;
    server_name example.ir www.example.ir;
    return 301 https://example.ir$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.ir;

    ssl_certificate     /etc/letsencrypt/live/example.ir/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.ir/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 12m;   # کمی بیشتر از CM_MAX_UPLOAD_BYTES (۱۰MB)

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # فایل‌های هش‌دار Vite: کش طولانی
    location /assets/ {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

`CM_TRUST_PROXY=true` را نگه دارید تا Express یک hop پروکسی را باور کند
(برای IP درست در rate-limit و کوکی Secure).

## ۵.۶. Docker (اختیاری)

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
COPY server/package*.json server/
COPY client/package*.json client/
RUN npm run install:all
COPY . .
RUN npm run build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
# CM_SECRET و CM_BACKUP_KEY را در زمان اجرا بدهید (نه در ایمیج)
EXPOSE 3000
CMD ["node", "server/src/index.js"]
```

```bash
docker build -t central-mine .
docker run -d --name central-mine -p 127.0.0.1:3000:3000 \
  -v cm-data:/app/server/data -v cm-storage:/app/server/storage \
  --env-file ./server/.env central-mine
```

دو volume بالا **اجباری** است: دیتابیس (`server/data`) و فایل‌های آپلودی
(`server/storage`). بدون آن‌ها با هر ری‌استارت داده از دست می‌رود.

## ۵.۷. بررسی سلامت بعد از استقرار

| مسیر | معنا |
|---|---|
| `GET /health` | سلامت کلی + نسخهٔ اسکیما + `integrations` (درگاه/پیامک: sandbox یا live) |
| `GET /ready` | **مخصوص load balancer**: فقط وقتی `200` می‌دهد که DB باز، اسکیما اعمال‌شده و همهٔ فایل‌های مهاجرت ثبت شده باشند (وگرنه `503`) |
| `GET /api/v1/admin/console/security/posture` | نمرهٔ امنیتی و چک‌لیست (نیازمند ورود مدیر) |
| `GET /api/v1/admin/console/security/database` | شمارش جدول‌ها/ایندکس‌ها/تریگرها، integrity و FK |

```bash
curl -fsS https://example.ir/ready   | jq .
curl -fsS https://example.ir/health  | jq '{status, schema_version, integrations}'
```

## ۵.۸. پشتیبان‌گیری (روی همان مسیر داده)

```bash
# پشتیبان رمزنگاری‌شده (AES-256-GCM با CM_BACKUP_KEY)
npm run backup
# تمرین بازیابی روی یک نسخهٔ جدا — ماهی یک‌بار
npm --prefix server run backup -- --verify
```

قاعدهٔ طلایی: **کلید `CM_BACKUP_KEY` را جدا از فایل‌های پشتیبان نگه دارید**؛
بدون آن، فایل `.enc` قابل بازیابی نیست.

## ۵.۹. اگر روی زیرمسیر می‌خواهید (`https://example.ir/app/`)

Nginx:

```nginx
location /app/ {
    proxy_pass http://127.0.0.1:3000/;   # اسلش انتهایی مهم است
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

و در `client/vite.config.js` مقدار `base: '/app/'` را اضافه کنید، سپس
`CM_PUBLIC_BASE_URL=https://example.ir/app` و دوباره `npm run build`.
(بدون `base`، فایل‌های `/assets/*` از ریشه درخواست می‌شوند و ۴۰۴ می‌گیرید.)

## ۵.۱۰. چک‌لیست «قبل از تحویل به مشتری»

- [ ] `NODE_ENV=production`
- [ ] `CM_SECRET` تصادفی ۹۶ نویسه‌ای (نه مقدار نمونه)
- [ ] `CM_BACKUP_KEY` تنظیم‌شده و **بیرون از سرور** هم نگه‌داری می‌شود
- [ ] `CM_OTP_SANDBOX=0` (با مقدار ۱ سرور در تولید عمداً بالا نمی‌آید)
- [ ] `CM_PUBLIC_BASE_URL` روی دامنهٔ واقعی
- [ ] `CM_DENY_IFRAME=1` (پیش‌نمایش Arena به ۰ نیاز دارد، تولید نه)
- [ ] `CM_MAINTENANCE_TOKEN` تنظیم یا عمداً خالی
- [ ] دادهٔ دمو پاک/جایگزین شده (کاربران `091200000xx` با رمز عمومی!)
- [ ] `npm run migrate` اجرا شده و `GET /ready` عدد `200` می‌دهد
- [ ] HTTPS و ریدایرکت ۸۰→۴۴۳ فعال
- [ ] پشتیبان اولیه گرفته و **یک بار بازیابی تمرین شده**
- [ ] ورود دومرحله‌ای برای حساب‌های مدیر فعال (مرکز امنیت `critical` ندهد)
      `npm run mfa:list` باید برای همهٔ `admin`/`finance` مقدار «فعال» بدهد؛
      در غیر این صورت `npm run mfa:provision -- --all-privileged --write`
- [ ] کدهای بازیابی هر حساب مدیر در جای امن (بیرون از سرور) ذخیره شده است
- [ ] `server/.env` و `server/data` و `server/storage` مالک/مجوز درست (`600`/`700`)

---

## ۱۱. تحویل بهره‌برداری — از نصب تا اولین روز کاری

این بخش دقیقاً همان کاری است که تا پیش از این فقط در گفتار بود و اکنون به فایل‌های
`deploy/` و `scripts/` تبدیل شده است.

### ۱۱.۱ نصب یک‌باره

```bash
# ۱) کاربر و مسیرها
sudo useradd --system --home /opt/central-mine --shell /usr/sbin/nologin central
sudo mkdir -p /opt/central-mine /var/lib/central-mine
sudo chown -R central:central /opt/central-mine /var/lib/central-mine

# ۲) کد و وابستگی‌ها (ساخت بیلد کلاینت بخشی از انتشار است)
sudo -u central git clone <repo> /opt/central-mine
cd /opt/central-mine && sudo -u central npm --prefix client ci && sudo -u central npm --prefix client run build
sudo -u central npm --prefix server ci --omit=dev

# ۳) پیکربندی (هیچ کلیدی داخل unit نوشته نمی‌شود)
sudo install -d -m 0750 -o central /etc/central-mine
sudo install -m 0600 -o central deploy/production.env.example /etc/central-mine/central-mine.env
sudo -u central nano /etc/central-mine/central-mine.env    # CM_SECRET و CM_BACKUP_KEY را پر کنید

# ۴) اولین مدیر واقعی + ۲FA
sudo -u central node scripts/create-admin.js --phone 09… --name "…"
sudo -u central node scripts/mfa-provision.js --phone 09… --write

# ۵) سرویس‌ها
sudo install -m 0644 deploy/central-mine.service /etc/systemd/system/
sudo install -m 0644 deploy/central-mine-backup.{service,timer} /etc/systemd/system/
sudo install -m 0644 deploy/central-mine-monitor.{service,timer} /etc/systemd/system/
sudo install -m 0644 deploy/central-mine-retention.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now central-mine central-mine-backup.timer central-mine-monitor.timer central-mine-retention.timer

# ۶) Nginx + TLS
sudo install -m 0644 deploy/nginx.conf.example /etc/nginx/sites-available/central-mine
sudo ln -sf /etc/nginx/sites-available/central-mine /etc/nginx/sites-enabled/
# فایل snippets/central-mine-proxy.conf را از انتهای همان نمونه بسازید
sudo certbot --nginx -d example.com
sudo nginx -t && sudo systemctl reload nginx

# ۷) بررسی نهایی — تا صفر «مانع» نرسیده، تحویل ندهید
sudo -u central node scripts/preflight.js --url https://example.com
```

### ۱۱.۲ نقشهٔ زمان‌بندها

| زمان‌بند | زمان | کار | نشانهٔ خرابی |
|---|---|---|---|
| `central-mine.service` | همیشه | سرویس API | `systemctl status central-mine` |
| `central-mine-backup.timer` | هر شب ۰۳:۱۵ | پشتیبان رمزنگاری‌شده + تأیید بازیابی + چرخش ۱۴ نسخه | `systemctl --failed` |
| `central-mine-monitor.timer` | هر ۵ دقیقه | ۵ بررسی سلامتی بیرونی، webhook اختیاری | کد خروج ۲ |
| `central-mine-retention.timer` | ماهی یک‌بار | آرشیو زنجیرهٔ ممیزی + پاک‌سازی کهنه‌ها | کد خروج غیرصفر |

همهٔ زمان‌بندها `WantedBy=timers.target` هستند؛ با `systemctl list-timers` ببینید
دفعهٔ بعد کِی اجرا می‌شوند.

### ۱۱.۳ ابزارهای بهره‌برداری

| فرمان | کار |
|---|---|
| `node scripts/backup.js --verify --keep 14` | پشتیبان + تأیید بازگردانی، خروجی JSON برای لاگ |
| `node scripts/monitor.js --url … --webhook …` | پایش بیرونی؛ خرابی = کد خروج ۲ |
| `node scripts/retention.js --days 365 --write --prune` | آرشیو ممیزی (پیش از حذف، فایل بازخوانی می‌شود) |
| `node scripts/create-admin.js --phone …` | ساخت مدیر واقعی؛ رمز به‌صورت تعاملی و بی‌نمایش |
| `node scripts/purge-demo.js --keep <شماره> --write` | حذف/ناشناس‌سازی حساب‌های دمو |
| `node scripts/mfa-provision.js --all-privileged --write` | ثبت ۲FA برای نقش‌های حساس |
| `node scripts/preflight.js --url …` | ۱۷ بررسی پیش از تحویل |

**نکتهٔ مهم دربارهٔ `purge-demo.js`:** حساب‌هایی که در زنجیرهٔ ممیزی ردیابی دارند حذف
فیزیکی نمی‌شوند (زنجیره باید به «یک نفر» ارجاع بدهد)؛ به‌جای آن **ناشناس** می‌شوند:
شماره به `anon-<uuid>`، نام به «حساب حذف‌شده»، رمز به مقدار غیرقابل‌ورود و وضعیت
`suspended`. این کار عمدی است — سابقهٔ مالی و ممیزی نباید ناپدید شود.

### ۱۱.۴ اتصال درگاه پرداخت و پیامک

تا وقتی `CM_PAYMENT_PROVIDER` و `CM_SMS_PROVIDER` خالی باشند، سیستم صادقانه در حالت
sandbox می‌ماند و `/health` مقدار `real_connected: false` می‌دهد. با پر کردن کلیدها،
همان مسیرها به درگاه واقعی وصل می‌شوند — بدون تغییر کد:

- **زرین‌پال:** `CM_PAYMENT_PROVIDER=zarinpal` و `CM_PAYMENT_MERCHANT_ID`. مبلغ به
  **ریال** ارسال می‌شود (تومان × ۱۰). تأیید در سمت سرور با `verify` انجام می‌شود، پس
  دستکاری query مرورگر بی‌اثر است.
- **پیامک:** `CM_SMS_PROVIDER=kavenegar` یا `smsir` با `CM_SMS_API_KEY`.

**اصل امنیتی که در آزمون پیدا و رفع شد:** یک callback با `Status=NOK` نباید پرداخت را
«ناموفق» کند. هر کسی می‌تواند آن URL را صدا بزند و پرداخت دیگران را از بین ببرد
(DoS رایگان روی تسویه). اکنون فقط **موفقیت تأییدشده** وضعیت را تغییر می‌دهد؛ نتیجهٔ
ناموفق ثبت می‌شود ولی پرداخت `pending` می‌ماند و با انقضای خودش بسته می‌شود.

### ۱۱.۵ چک‌لیست تحویل (همه باید ✔ باشند)

- [ ] `preflight.js --url …` صفر «مانع» می‌دهد
- [ ] `create-admin.js` اجرا شده و ورود مدیر تست شده است
- [ ] `mfa-provision.js --all-privileged` همهٔ `admin`/`finance` را پوشش داده
- [ ] کدهای بازیابی چاپ و بیرون از سرور بایگانی شده‌اند
- [ ] `purge-demo.js` اجرا شده: هیچ حساب با رمز `Cm@Test1405!` باقی نمانده
- [ ] `backup.js --verify` موفق، و `central-mine-backup.timer` فعال
- [ ] `monitor.js` سبز، و `central-mine-monitor.timer` فعال (با webhook اگر ممکن است)
- [ ] گواهی TLS معتبر و `CM_PUBLIC_BASE_URL` با `https://` تنظیم شده
- [ ] `NODE_ENV=production`، `CM_SECRET` ۶۴+ نویسه، `CM_BACKUP_KEY` تنظیم‌شده
- [ ] `CM_OTP_SANDBOX=0` — وگرنه کد ورود در پاسخ API برمی‌گردد
- [ ] درگاه و پیامک واقعی وصل‌اند، یا آگاهانه پذیرفته شده که sandbox بمانند
