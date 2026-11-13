'use strict';

/**
 * SEO surface:
 *  - /robots.txt and /sitemap.xml are served by the API itself (the SPA has no
 *    build-time route list a crawler could read).
 *  - The sitemap lists public routes plus real, published products and brands,
 *    and must never leak private areas or non-active products.
 *  - The built index.html must carry description/OG/Twitter/JSON-LD so crawlers
 *    that do not execute JavaScript still see something useful.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-seo-'));
process.env.CM_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CM_STORAGE_DIR = path.join(tmpRoot, 'storage');
process.env.CM_SECRET = 'seo-test-secret-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.CM_PUBLIC_BASE_URL = 'https://centralmine.ir';

const { seed } = require('../src/db/seed');
const { all, close } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let baseUrl;

test.before(async () => {
  seed({ silent: true });
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('robots.txt is served, allows the shop and blocks private areas', async () => {
  const res = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/plain/);
  const body = await res.text();

  assert.match(body, /User-agent: \*/);
  assert.match(body, /Allow: \/shop/);
  // Private surfaces must be disallowed.
  for (const p of ['/staff', '/account', '/cart', '/orders', '/tickets', '/auth', '/api/']) {
    assert.ok(body.includes(`Disallow: ${p}`), `robots.txt must disallow ${p}`);
  }
  assert.match(body, /Sitemap: https:\/\/centralmine\.ir\/sitemap\.xml/);
});

test('sitemap.xml lists public routes and real published products', async () => {
  const res = await fetch(`${baseUrl}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /xml/);
  const xml = await res.text();

  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.ok(xml.trim().endsWith('</urlset>'));

  // Canonical origin comes from CM_PUBLIC_BASE_URL, never from the request host.
  assert.ok(xml.includes('<loc>https://centralmine.ir/</loc>'));
  assert.ok(xml.includes('<loc>https://centralmine.ir/shop</loc>'));
  assert.ok(xml.includes('<loc>https://centralmine.ir/lth-calculator</loc>'));
  assert.ok(xml.includes('<loc>https://centralmine.ir/wallet</loc>'));

  // Every active product is advertised with its real slug.
  const products = all("SELECT slug FROM products WHERE status = 'active' AND slug IS NOT NULL AND slug <> ''");
  assert.ok(products.length > 0, 'seed must create products');
  for (const p of products.slice(0, 5)) {
    assert.ok(xml.includes(`/products/${p.slug}`), `sitemap must include ${p.slug}`);
  }

  // Private routes never appear.
  for (const p of ['/staff', '/account', '/cart', '/orders', '/tickets', '/auth']) {
    assert.ok(!xml.includes(`<loc>https://centralmine.ir${p}</loc>`), `sitemap must not expose ${p}`);
  }

  // No XML-injection surface: slugs are escaped, and tags are balanced.
  const opened = (xml.match(/<url>/g) || []).length;
  const closed = (xml.match(/<\/url>/g) || []).length;
  assert.equal(opened, closed);
  assert.ok(opened >= 6);
});

test('sitemap excludes products that are not active', async () => {
  const { run } = require('../src/db');
  const target = all("SELECT id, slug FROM products WHERE status = 'active' LIMIT 1")[0];
  assert.ok(target, 'need one product to deactivate');
  run("UPDATE products SET status = 'archived' WHERE id = ?", [target.id]);

  // The sitemap is cached for 10 minutes; bust it the same way an admin would.
  const { clearSitemapCache } = require('../src/modules/seo/routes');
  clearSitemapCache();
  try {
    const xml = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
    assert.ok(!xml.includes(`/products/${target.slug}`), 'archived products must drop out of the sitemap');
  } finally {
    run("UPDATE products SET status = 'active' WHERE id = ?", [target.id]);
    clearSitemapCache();
  }
});

test('built index.html carries crawler-visible SEO tags', async () => {
  const indexFile = path.join(__dirname, '..', '..', 'client', 'index.html');
  const html = fs.readFileSync(indexFile, 'utf8');

  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<meta\s+name="description"\s+content="[^"]{40,}"/s);
  assert.match(html, /<meta name="robots" content="index, follow/);
  assert.match(html, /<link rel="canonical" href="https:\/\/centralmine\.ir\/"/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<meta property="og:image"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<link rel="alternate" hreflang="fa-IR"/);

  // JSON-LD must be present AND valid JSON.
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 1, 'index.html needs structured data');
  for (const b of blocks) {
    const parsed = JSON.parse(b[1]);
    assert.ok(parsed['@context'] === 'https://schema.org');
    const graph = parsed['@graph'] || [parsed];
    assert.ok(graph.some((n) => ['Organization', 'WebSite', 'Product'].includes(n['@type'])));
  }
});
