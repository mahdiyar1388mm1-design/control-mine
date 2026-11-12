'use strict';

/**
 * Brand management end-to-end:
 *  - brands are real records (logo, description, ordering, activation)
 *  - only admins may manage them; customers are refused
 *  - the logo upload validates real bytes (a text file renamed .png is refused)
 *  - a product can carry its brand's logo into the storefront API
 *  - a brand in use is deactivated instead of deleted (record retention)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-brands-'));
process.env.CM_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CM_STORAGE_DIR = path.join(tmpRoot, 'storage');
process.env.CM_SECRET = 'brands-test-secret-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';

const { seed } = require('../src/db/seed');
const { run, get, close } = require('../src/db');
const { createApp } = require('../src/app');
const { resetRateLimits } = require('../src/middleware/rateLimit');

let server;
let baseUrl;

// A real 1x1 PNG: the server checks magic bytes, not the file extension.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function api(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (body instanceof FormData) {
    payload = body;
  }
  const res = await fetch(`${baseUrl}${pathname}`, { method, headers: h, body: payload });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, data };
}

async function loginAs(phone, password = 'Cm@Test1405!') {
  resetRateLimits();
  const res = await api('/api/v1/auth/login', { method: 'POST', body: { phone, password } });
  assert.equal(res.status, 200, `login failed for ${phone}: ${JSON.stringify(res.data)}`);
  return res.data;
}

function logoForm(buffer, declaredType, filename) {
  const fd = new FormData();
  fd.append('logo', new Blob([buffer], { type: declaredType }), filename);
  return fd;
}

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

test('brands: admin creates a brand with a logo and the storefront returns it', async () => {
  const customer = await loginAs('09120000010');
  const admin = await loginAs('09120000001');

  // RBAC: a customer can read the public list but never manage brands.
  const customerCreate = await api('/api/v1/admin/brands', {
    method: 'POST', token: customer.token, body: { name: 'برند غیرمجاز' }
  });
  assert.equal(customerCreate.status, 403);

  const created = await api('/api/v1/admin/brands', {
    method: 'POST',
    token: admin.token,
    body: { name: 'نوآوران صنعت', description: 'سازندهٔ تجهیزات دقیق آزمایشگاهی', sort_order: 5 }
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const brand = created.data.brand;
  assert.equal(brand.name, 'نوآوران صنعت');
  assert.equal(brand.logo_path, null);
  assert.equal(brand.is_active, true);
  assert.ok(brand.slug);

  // A duplicate name is a conflict, not a silent second row.
  const duplicate = await api('/api/v1/admin/brands', {
    method: 'POST', token: admin.token, body: { name: 'نوآوران صنعت' }
  });
  assert.equal(duplicate.status, 409);

  // Upload the logo: real PNG bytes are accepted.
  const uploaded = await api(`/api/v1/admin/brands/${brand.id}/logo`, {
    method: 'POST', token: admin.token, body: logoForm(TINY_PNG, 'image/png', 'novin.png')
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.match(uploaded.data.brand.logo_path, /^\/uploads\/brand-logo-[\w-]+\.png$/);

  // The file is really served and the storefront list exposes it.
  const served = await api(uploaded.data.brand.logo_path);
  assert.equal(served.status, 200);

  const publicList = await api('/api/v1/brands');
  assert.equal(publicList.status, 200);
  const publicBrand = publicList.data.items.find((b) => b.id === brand.id);
  assert.ok(publicBrand, 'the new brand must appear in the public list');
  assert.equal(publicBrand.logo_path, uploaded.data.brand.logo_path);

  // The admin list also reports how many products use the brand.
  const adminList = await api('/api/v1/admin/brands', { token: admin.token });
  assert.equal(adminList.status, 200);
  const adminBrand = adminList.data.items.find((b) => b.id === brand.id);
  assert.equal(adminBrand.product_count, 0);
});

test('brands: a text file renamed .png is rejected and no brand is polluted', async () => {
  const admin = await loginAs('09120000001');
  const created = await api('/api/v1/admin/brands', {
    method: 'POST', token: admin.token, body: { name: 'برند سخت‌گیر' }
  });
  assert.equal(created.status, 201);
  const brand = created.data.brand;

  const fake = await api(`/api/v1/admin/brands/${brand.id}/logo`, {
    method: 'POST', token: admin.token, body: logoForm(Buffer.from('<script>alert(1)</script>'), 'image/png', 'evil.png')
  });
  assert.equal(fake.status, 400);
  assert.match(JSON.stringify(fake.data), /هم‌خوانی ندارد|مجاز/);

  const after = await api(`/api/v1/admin/brands`, { token: admin.token });
  const row = after.data.items.find((b) => b.id === brand.id);
  assert.equal(row.logo_path, null, 'a rejected upload must not touch the row');

  // SVG is a stored-XSS vector and must never be accepted as a logo.
  const svg = await api(`/api/v1/admin/brands/${brand.id}/logo`, {
    method: 'POST', token: admin.token,
    body: logoForm(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml', 'x.svg')
  });
  assert.equal(svg.status, 400);
});

test('brands: a product carries its brand logo into the storefront API', async () => {
  const admin = await loginAs('09120000001');

  const brandRes = await api('/api/v1/admin/brands', {
    method: 'POST', token: admin.token,
    body: { name: 'لوگودار آزمایشی', description: 'برند آزمون لوگو' }
  });
  assert.equal(brandRes.status, 201);
  const brand = brandRes.data.brand;
  await api(`/api/v1/admin/brands/${brand.id}/logo`, {
    method: 'POST', token: admin.token, body: logoForm(TINY_PNG, 'image/png', 'logo.png')
  });

  // Existing seed product with a real slug, so the detail endpoint is exercised.
  const product = get("SELECT id, slug FROM products WHERE status = 'active' AND deleted_at IS NULL LIMIT 1");
  assert.ok(product, 'seed data must contain an active product');
  // The admin PATCH route is keyed by product id (the public one uses the slug).
  const patched = await api(`/api/v1/admin/products/${product.id}`, {
    method: 'PATCH', token: admin.token, body: { brand_id: brand.id }
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.product.brand.id, brand.id);

  const detail = await api(`/api/v1/products/${encodeURIComponent(product.slug)}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.data.product.brand, 'the product must expose its brand');
  assert.equal(detail.data.product.brand.name, 'لوگودار آزمایشی');
  assert.match(detail.data.product.brand.logo_path || '', /^\/uploads\/brand-logo-/);

  const list = await api('/api/v1/products?limit=100');
  assert.equal(list.status, 200);
  const card = list.data.items.find((p) => p.slug === product.slug);
  assert.ok(card);
  assert.match(card.brand_logo_path || '', /^\/uploads\/brand-logo-/);

  // Deactivating the brand hides it from the storefront filter but keeps the
  // product edit form usable, so the console reads the admin list instead.
  const hidden = await api(`/api/v1/admin/brands/${brand.id}`, {
    method: 'PATCH', token: admin.token, body: { is_active: false }
  });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.data.brand.is_active, false);

  const publicAfter = await api('/api/v1/brands');
  assert.equal(publicAfter.data.items.some((b) => b.id === brand.id), false);
  const adminAfter = await api('/api/v1/admin/brands', { token: admin.token });
  assert.equal(adminAfter.data.items.some((b) => b.id === brand.id), true);
});

test('brands: a brand in use is deactivated instead of deleted, an unused one is removed', async () => {
  const admin = await loginAs('09120000001');

  const used = get('SELECT b.id FROM brands b JOIN products p ON p.brand_id = b.id AND p.deleted_at IS NULL LIMIT 1');
  assert.ok(used, 'seed data must link at least one product to a brand');

  const deactivated = await api(`/api/v1/admin/brands/${used.id}`, { method: 'DELETE', token: admin.token });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.data.deactivated, true);
  assert.equal(deactivated.data.deleted, undefined);
  const row = get('SELECT is_active FROM brands WHERE id = ?', [used.id]);
  assert.equal(row.is_active, 0, 'the brand must stay in the database');
  // The products that use it are untouched.
  assert.ok(get('SELECT COUNT(*) AS c FROM products WHERE brand_id = ? AND deleted_at IS NULL', [used.id]).c > 0);

  const spare = await api('/api/v1/admin/brands', {
    method: 'POST', token: admin.token, body: { name: 'برند بدون کالا' }
  });
  const deleted = await api(`/api/v1/admin/brands/${spare.data.brand.id}`, { method: 'DELETE', token: admin.token });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.deleted, true);
  assert.equal(get('SELECT 1 AS x FROM brands WHERE id = ?', [spare.data.brand.id]), undefined);

  // Deleting a brand also removes its logo file, so uploads never become orphans.
  const orphan = await api('/api/v1/admin/brands', {
    method: 'POST', token: admin.token, body: { name: 'برند لوگودار برای حذف' }
  });
  const orphanId = orphan.data.brand.id;
  const orphanLogo = await api(`/api/v1/admin/brands/${orphanId}/logo`, {
    method: 'POST', token: admin.token, body: logoForm(TINY_PNG, 'image/png', 'logo.png')
  });
  const orphanPath = orphanLogo.data.brand.logo_path;
  assert.equal((await api(orphanPath)).status, 200);
  await api(`/api/v1/admin/brands/${orphanId}`, { method: 'DELETE', token: admin.token });
  const gone = await api(orphanPath);
  assert.equal(gone.status, 404, 'the logo file must be deleted with the brand');
});

test('brands: renaming keeps a unique slug and logo removal cleans up the record', async () => {
  const admin = await loginAs('09120000001');
  const created = await api('/api/v1/admin/brands', {
    method: 'POST', token: admin.token, body: { name: 'برند قابل تغییر' }
  });
  const brand = created.data.brand;
  const withLogo = await api(`/api/v1/admin/brands/${brand.id}/logo`, {
    method: 'POST', token: admin.token, body: logoForm(TINY_PNG, 'image/png', 'logo.png')
  });
  assert.equal(withLogo.status, 201);
  const logoPath = withLogo.data.brand.logo_path;
  assert.match(logoPath, /^\/uploads\/brand-logo-/);

  // Rename to a name that already exists → 409, nothing changes.
  const clash = await api(`/api/v1/admin/brands/${brand.id}`, {
    method: 'PATCH', token: admin.token, body: { name: 'کاوش‌سنج' }
  });
  assert.equal(clash.status, 409);

  const renamed = await api(`/api/v1/admin/brands/${brand.id}`, {
    method: 'PATCH', token: admin.token, body: { name: 'برند تغییر یافته', sort_order: 3 }
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.brand.name, 'برند تغییر یافته');
  assert.equal(renamed.data.brand.sort_order, 3);
  assert.ok(renamed.data.brand.slug);
  assert.notEqual(renamed.data.brand.slug, brand.slug);
  // A rename never disturbs the logo that is already attached.
  assert.equal(renamed.data.brand.logo_path, logoPath);

  const cleared = await api(`/api/v1/admin/brands/${brand.id}/logo`, { method: 'DELETE', token: admin.token });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.brand.logo_path, null);

  // Every write above is traceable in the append-only audit log.
  const actions = ['catalog.create_brand', 'catalog.update_brand', 'catalog.brand_logo_upload', 'catalog.brand_logo_remove'];
  for (const action of actions) {
    const entry = get('SELECT 1 AS x FROM audit_log WHERE action = ? LIMIT 1', [action]);
    assert.ok(entry, `audit log must contain ${action}`);
  }
});
