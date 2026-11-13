'use strict';

/**
 * XML sitemap for the storefront.
 *
 * The SPA has no build-time route manifest the crawler can see, so the server
 * generates /sitemap.xml from the same static routes the client uses plus every
 * published product. Cached for 10 minutes; regenerated cheaply on demand.
 */

const express = require('express');
const { all } = require('../../db');
const config = require('../../config');

const router = express.Router();

const STATIC_ROUTES = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/shop', priority: '0.9', changefreq: 'daily' },
  { path: '/lth-calculator', priority: '0.9', changefreq: 'weekly' },
  { path: '/wallet', priority: '0.8', changefreq: 'weekly' },
  { path: '/treasury', priority: '0.6', changefreq: 'daily' },
  { path: '/support', priority: '0.4', changefreq: 'monthly' }
];

// Cached per origin so a proxy host and the canonical host never leak into each
// other's absolute URLs. `clearSitemapCache()` exists for tests and admin tools.
const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

function clearSitemapCache() {
  cache.clear();
}

function originFor(req) {
  const configured = config.publicBaseUrl || process.env.CM_PUBLIC_BASE_URL;
  if (configured) return String(configured).replace(/\/+$/, '');
  const proto = (req.header('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = (req.header('x-forwarded-host') || req.header('host') || 'centralmine.ir').split(',')[0].trim();
  return `${proto}://${host}`;
}

function esc(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function lastmod(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function buildXml(origin) {
  const urls = [];

  for (const route of STATIC_ROUTES) {
    urls.push(
      `<url><loc>${esc(origin + route.path)}</loc><changefreq>${route.changefreq}</changefreq><priority>${route.priority}</priority></url>`
    );
  }

  // Published products only — drafts and archived rows must never be advertised.
  let products = [];
  try {
    products = all(
      `SELECT slug, updated_at FROM products
        WHERE status = 'active' AND slug IS NOT NULL AND slug <> ''
        ORDER BY updated_at DESC LIMIT 5000`
    );
  } catch (err) {
    products = [];
  }
  for (const p of products) {
    const lm = lastmod(p.updated_at);
    urls.push(
      `<url><loc>${esc(`${origin}/products/${p.slug}`)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.7</priority></url>`
    );
  }

  // Active brands get their filtered shop listing indexed too.
  let brands = [];
  try {
    brands = all('SELECT slug, updated_at FROM brands WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 500');
  } catch (err) {
    brands = [];
  }
  for (const b of brands) {
    const lm = lastmod(b.updated_at);
    urls.push(
      `<url><loc>${esc(`${origin}/shop?brand=${b.slug}`)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.6</priority></url>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

router.get('/sitemap.xml', (req, res) => {
  try {
    const now = Date.now();
    const origin = originFor(req);
    const hit = cache.get(origin);
    let xml;
    if (hit && now - hit.at <= TTL_MS) {
      xml = hit.xml;
    } else {
      xml = buildXml(origin);
      cache.set(origin, { at: now, xml });
    }
    res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(xml);
  } catch (err) {
    res.status(500).type('text/plain').send('sitemap unavailable');
  }
});

module.exports = { router, buildXml, clearSitemapCache, STATIC_ROUTES };
