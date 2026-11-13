/**
 * SEO for the CENTRAL MINE single-page app.
 *
 * The site is a client-rendered SPA, so every route has to advertise its own
 * title, description, canonical URL and social-card data. This module keeps the
 * route table plus the DOM helpers used by <Seo /> (see components/Seo.jsx).
 *
 * Rules that keep this safe:
 *  - Persian copy only, matching the rest of the site.
 *  - Absolute URLs everywhere (crawlers reject relative canonicals).
 *  - Private areas (account, staff, cart, checkout, payment result) are marked
 *    `noindex` — they must never appear in search results.
 *  - JSON-LD is generated from plain data, never from user input, so a product
 *    name can never inject markup into <script type="application/ld+json">.
 */

export const SITE_NAME = 'CENTRAL MINE';
export const SITE_NAME_FA = 'سنترال ماین';

/** Origin used for canonical/OG URLs. Overridable at build time. */
export function siteOrigin() {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin;
  }
  return 'https://centralmine.ir';
}

const DEFAULT_DESCRIPTION =
  'سنترال ماین — فروشگاه تجهیزات ماینینگ، کیف پول دیجیتال LTH و خدمات عملیاتی آنلاین؛ خرید پکیج، استیک ۷۰/۳۰، برداشت شبا و گزارش شفاف خزانه.';

const DEFAULT_KEYWORDS =
  'سنترال ماین, CENTRAL MINE, تجهیزات ماینینگ, کیف پول LTH, لات کوین, استیک, پکیج ماین, خرید ریگ, برداشت شبا';

/**
 * Route table. Keys are matched with exact paths first, then with RegExp.
 * `noindex` pages render fine for logged-in users but are hidden from crawlers.
 */
export const ROUTES = [
  {
    path: '/',
    title: 'سنترال ماین | فروشگاه تجهیزات ماینینگ و کیف پول LTH',
    description:
      'خرید تجهیزات و خدمات ماینینگ، محاسبه‌گر و پکیج‌های LTH، کیف پول دیجیتال با استیک ۷۰/۳۰ و برداشت شبا — همه در یک سامانهٔ شفاف.',
    keywords: DEFAULT_KEYWORDS,
    priority: '1.0',
    changefreq: 'daily',
    jsonLd: () => [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        alternateName: SITE_NAME_FA,
        url: siteOrigin(),
        logo: `${siteOrigin()}/central-mine-logo.jpg`,
        description: DEFAULT_DESCRIPTION,
        areaServed: 'IR',
        knowsLanguage: 'fa-IR'
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: siteOrigin(),
        inLanguage: 'fa-IR',
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${siteOrigin()}/shop?q={search_term_string}` },
          'query-input': 'required name=search_term_string'
        }
      }
    ]
  },
  {
    path: '/lth-calculator',
    title: 'محاسبه‌گر و خرید پکیج LTH | سنترال ماین',
    description:
      'با محاسبه‌گر دقیق LTH، ارزش پکیج را به لات‌کوین تبدیل کن؛ پاداش ۲۴ساعته، تفکیک ۷۰٪ استیک و ۳۰٪ قابل برداشت و ریال معادل را همان‌جا ببین.',
    keywords: 'محاسبه گر LTH, خرید پکیج LTH, لات کوین, پاداش استیک, سنترال ماین',
    priority: '0.9',
    changefreq: 'weekly',
    jsonLd: () => [
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'پکیج لات‌کوین LTH — سنترال ماین',
        brand: { '@type': 'Brand', name: SITE_NAME },
        description:
          'پکیج‌های LTH با قرارداد هوشمند استیک ۳۲۸۵ روزه، واریز پاداش ۲۴ساعته و تفکیک ثابت ۷۰٪ استیک / ۳۰٪ قابل برداشت.',
        category: 'Cryptocurrency',
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'IRR',
          lowPrice: '2200000',
          highPrice: '220000000',
          offerCount: '5',
          availability: 'https://schema.org/InStock'
        }
      }
    ]
  },
  {
    path: '/shop',
    title: 'فروشگاه تجهیزات ماینینگ | سنترال ماین',
    description:
      'خرید کارت گرافیک، پاور، مادربرد ماینینگ و تجهیزات جانبی با موجودی واقعی انبار، ضمانت اصالت و ارسال سراسری.',
    keywords: 'خرید کارت گرافیک, تجهیزات ماینینگ, ریگ ماینر, پاور ماینینگ, فروشگاه سنترال ماین',
    priority: '0.9',
    changefreq: 'daily',
    jsonLd: () => [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'فروشگاه تجهیزات ماینینگ',
        url: `${siteOrigin()}/shop`,
        inLanguage: 'fa-IR',
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: siteOrigin() },
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'خانه', item: siteOrigin() },
            { '@type': 'ListItem', position: 2, name: 'فروشگاه', item: `${siteOrigin()}/shop` }
          ]
        }
      }
    ]
  },
  {
    path: '/wallet',
    title: 'کیف پول LTH | استیک، فروش و برداشت شبا — سنترال ماین',
    description:
      'کیف پول دیجیتال LTH: دارایی پایه، استیک قفل‌شده، پاداش قابل برداشت، انتقال حساب به حساب، فروش به نرخ سرور و برداشت ریالی شبا.',
    keywords: 'کیف پول LTH, برداشت شبا, فروش LTH, استیک LTH, انتقال حساب به حساب',
    priority: '0.8',
    changefreq: 'weekly',
    jsonLd: () => [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'کیف پول LTH',
        url: `${siteOrigin()}/wallet`,
        inLanguage: 'fa-IR',
        description:
          'مدیریت دارایی LTH با شفافیت کامل ردیف‌های کیف پول، قرارداد هوشمند استیک و درخواست برداشت ریالی از طریق شبا.'
      }
    ]
  },
  {
    path: '/treasury',
    title: 'خزانهٔ پروتکل LTH | سنترال ماین',
    description:
      'گزارش عمومی خزانه: دارایی، میزان پایه، بازگشتی‌ها، کارمزد و مالیات — با تطبیق کامل دفتر حسابداری پروتکل.',
    keywords: 'خزانه LTH, شفافیت خزانه, میزان پایه, کارمزد, مالیات پروتکل',
    priority: '0.6',
    changefreq: 'daily'
  },
  {
    path: '/treasury-full',
    title: 'گزارش کامل خزانه و تراز پروتکل | سنترال ماین',
    description: 'ریز ردیف‌های خزانهٔ LTH، تراز عرضه و گزارش تطبیق دفتر حسابداری.',
    priority: '0.4',
    changefreq: 'daily',
    noindex: true
  },
  { path: '/auth', title: 'ورود و ثبت‌نام | سنترال ماین', description: 'ورود امن با رمز عبور یا کد یک‌بارمصرف به حساب کاربری سنترال ماین.', noindex: true },
  { path: '/account', title: 'حساب کاربری | سنترال ماین', description: 'پیشخوان حساب کاربری: سفارش‌ها، نشانی‌ها، اعلان‌ها و امنیت ورود.', noindex: true },
  { path: '/account/shipping', title: 'نشانی‌های ارسال | سنترال ماین', description: 'مدیریت نشانی‌های تحویل سفارش.', noindex: true },
  { path: '/account/notifications', title: 'اعلان‌ها | سنترال ماین', description: 'اعلان‌های حساب کاربری.', noindex: true },
  { path: '/notifications', title: 'اعلان‌ها | سنترال ماین', description: 'اعلان‌های حساب کاربری.', noindex: true },
  { path: '/cart', title: 'سبد خرید و تسویه | سنترال ماین', description: 'بازبینی سبد خرید، انتخاب نشانی و پرداخت امن.', noindex: true },
  { path: '/pay/result', title: 'نتیجهٔ پرداخت | سنترال ماین', description: 'وضعیت نهایی تراکنش پرداخت.', noindex: true },
  { path: '/orders', title: 'سفارش‌های من | سنترال ماین', description: 'پیگیری سفارش‌ها، مرسوله‌ها و رسیدهای رسمی.', noindex: true },
  { path: '/tickets', title: 'تیکت‌های پشتیبانی | سنترال ماین', description: 'ارتباط با پشتیبانی و پیگیری درخواست‌ها.', noindex: true },
  { path: '/staff', title: 'میزکار کارکنان | سنترال ماین', description: 'میزکار عملیاتی کارکنان.', noindex: true },
  { path: '/support', title: 'پشتیبانی و تماس | سنترال ماین', description: 'راه‌های ارتباط با پشتیبانی سنترال ماین.', noindex: true }
];

/** Patterns for dynamic routes (`/products/:slug`, `/orders/:code`, …). */
export const DYNAMIC_ROUTES = [
  {
    pattern: /^\/products\/([^/]+)$/,
    build: (match) => ({
      title: 'جزئیات کالا | سنترال ماین',
      description: 'مشخصات کامل کالا، موجودی انبار و شرایط خرید در سنترال ماین.',
      priority: '0.7',
      changefreq: 'weekly',
      slug: decodeURIComponent(match[1])
    })
  },
  {
    pattern: /^\/orders\/([^/]+)$/,
    build: () => ({ title: 'جزئیات سفارش | سنترال ماین', description: 'پیگیری سفارش.', noindex: true })
  },
  {
    pattern: /^\/tickets\/([^/]+)$/,
    build: () => ({ title: 'جزئیات تیکت | سنترال ماین', description: 'گفت‌وگوی پشتیبانی.', noindex: true })
  },
  { pattern: /^\/wallet\/[^/]+$/, build: () => ({ title: 'کیف پول LTH | سنترال ماین', description: 'عملیات کیف پول LTH.', priority: '0.6' }) }
];

/** Resolves metadata for a pathname. Never throws — unknown paths get sane defaults. */
export function resolveMeta(pathname) {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  const exact = ROUTES.find((r) => r.path === path);
  if (exact) return normalize(exact, path);
  for (const dyn of DYNAMIC_ROUTES) {
    const m = path.match(dyn.pattern);
    if (m) return normalize({ path, ...dyn.build(m) }, path);
  }
  return normalize(
    {
      path,
      title: 'صفحه پیدا نشد | سنترال ماین',
      description: 'این نشانی در سنترال ماین وجود ندارد.',
      noindex: true
    },
    path
  );
}

function normalize(route, path) {
  const origin = siteOrigin();
  return {
    path,
    title: route.title || SITE_NAME,
    description: route.description || DEFAULT_DESCRIPTION,
    keywords: route.keywords || DEFAULT_KEYWORDS,
    canonical: `${origin}${path === '/' ? '/' : path}`,
    image: `${origin}/central-mine-logo.jpg`,
    noindex: Boolean(route.noindex),
    priority: route.priority || '0.5',
    changefreq: route.changefreq || 'monthly',
    jsonLd: typeof route.jsonLd === 'function' ? route.jsonLd() : route.jsonLd || null,
    type: route.type || 'website'
  };
}

/* ------------------------------------------------------------------ */
/* Page-level override handshake                                       */
/* ------------------------------------------------------------------ */

/**
 * React runs child effects before parent effects, so a page that knows more
 * than the route table (product detail) can claim the current pathname and the
 * global <Seo /> will skip it for that navigation. Without this the generic
 * route metadata would overwrite the richer page metadata on every mount.
 */
let overridePath = null;

export function claimSeoOverride(pathname) {
  overridePath = pathname || '/';
}

export function seoOverrideClaimed(pathname) {
  const claimed = overridePath === (pathname || '/');
  return claimed;
}

export function releaseSeoOverride() {
  overridePath = null;
}

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

function upsertMeta(attr, key, content) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href, extra = {}) {
  if (typeof document === 'undefined') return;
  const selector = Object.keys(extra).length
    ? `link[rel="${rel}"]${Object.entries(extra).map(([k, v]) => `[${k}="${v}"]`).join('')}`
    : `link[rel="${rel}"]`;
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(blocks) {
  if (typeof document === 'undefined') return;
  document.head.querySelectorAll('script[data-cm-jsonld]').forEach((n) => n.remove());
  (blocks || []).forEach((block) => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-cm-jsonld', '');
    script.textContent = JSON.stringify(block);
    document.head.appendChild(script);
  });
}

/** Applies resolved metadata to the live document. */
export function applyMeta(meta, { jsonLd } = {}) {
  if (typeof document === 'undefined' || !meta) return;
  document.title = meta.title;
  document.documentElement.setAttribute('lang', 'fa');
  document.documentElement.setAttribute('dir', 'rtl');

  upsertMeta('name', 'description', meta.description);
  upsertMeta('name', 'keywords', meta.keywords);
  upsertMeta('name', 'robots', meta.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1');
  upsertMeta('name', 'googlebot', meta.noindex ? 'noindex, nofollow' : 'index, follow');
  upsertMeta('name', 'author', SITE_NAME);

  upsertLink('canonical', meta.canonical);

  upsertMeta('property', 'og:type', meta.type);
  upsertMeta('property', 'og:site_name', SITE_NAME);
  upsertMeta('property', 'og:locale', 'fa_IR');
  upsertMeta('property', 'og:title', meta.title);
  upsertMeta('property', 'og:description', meta.description);
  upsertMeta('property', 'og:url', meta.canonical);
  upsertMeta('property', 'og:image', meta.image);
  upsertMeta('property', 'og:image:alt', `${SITE_NAME} — ${SITE_NAME_FA}`);

  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:title', meta.title);
  upsertMeta('name', 'twitter:description', meta.description);
  upsertMeta('name', 'twitter:image', meta.image);

  if (jsonLd !== undefined) setJsonLd(jsonLd);
  else setJsonLd(meta.jsonLd);
}

/** JSON-LD for a single product page, built from API data only. */
export function productJsonLd(product, origin = siteOrigin()) {
  if (!product) return null;
  // `price_irr` must already be in Rial (ISO 4217 IRR). Callers convert from
  // Toman first; anything non-numeric is dropped rather than emitted as NaN.
  const price = product.price_irr && /^\d+$/.test(String(product.price_irr)) ? String(product.price_irr) : null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: (product.description || '').slice(0, 500),
    sku: product.sku || product.slug,
    category: product.category_name || undefined,
    brand: product.brand_name ? { '@type': 'Brand', name: product.brand_name } : { '@type': 'Brand', name: SITE_NAME },
    image: product.image_url ? [product.image_url] : [`${origin}/central-mine-logo.jpg`],
    url: `${origin}/products/${product.slug || product.id}`,
    offers: price
      ? {
          '@type': 'Offer',
          price,
          priceCurrency: 'IRR',
          availability: Number(product.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: `${origin}/products/${product.slug || product.id}`
        }
      : undefined
  };
}

/** Breadcrumb JSON-LD helper for nested pages. */
export function breadcrumbJsonLd(trail, origin = siteOrigin()) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.path.startsWith('http') ? item.path : `${origin}${item.path}`
    }))
  };
}

/** Routes that belong in sitemap.xml (public, indexable). */
export function sitemapPaths() {
  return ROUTES.filter((r) => !r.noindex).map((r) => ({
    path: r.path,
    priority: r.priority || '0.5',
    changefreq: r.changefreq || 'monthly'
  }));
}
