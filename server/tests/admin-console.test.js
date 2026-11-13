'use strict';

/**
 * Admin Console end-to-end coverage:
 *  - manager-only access (RBAC)
 *  - live overview KPIs
 *  - people directory: full phone + username + every filled form (automatic)
 *  - one-shot product creation with price/stock
 *  - automatic rial treasury (payments → in, refunds → out, manual adjustment)
 *  - CSV export
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-console-'));
process.env.CM_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CM_STORAGE_DIR = path.join(tmpRoot, 'storage');
process.env.CM_SECRET = 'admin-console-test-secret-0123456789abcdef0123456789';
process.env.NODE_ENV = 'test';

const { seed } = require('../src/db/seed');
const { run, close } = require('../src/db');
const { createApp } = require('../src/app');
const { resetRateLimits } = require('../src/middleware/rateLimit');
const { uuid, nowIso } = require('../src/utils/validate');

let server;
let baseUrl;

async function api(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
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
  return res.data.token;
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

test('admin console: RBAC, overview KPIs and full-phone people directory with usernames', async () => {
  const customerToken = await loginAs('09120000010');
  const denied = await api('/api/v1/admin/console/overview', { token: customerToken });
  assert.equal(denied.status, 403);

  const adminToken = await loginAs('09120000001');
  const overview = await api('/api/v1/admin/console/overview', { token: adminToken });
  assert.equal(overview.status, 200);
  assert.ok(overview.data.kpis.users_total >= 8);
  assert.ok(overview.data.kpis.products.active >= 6);
  assert.equal(typeof overview.data.kpis.treasury.balance_toman, 'number');
  assert.equal(overview.data.sales_last_14_days.length, 14);
  assert.ok(Array.isArray(overview.data.recent_people));

  // Full phone numbers + usernames are visible to the manager (no masking).
  const people = await api('/api/v1/admin/console/people?limit=50', { token: adminToken });
  assert.equal(people.status, 200);
  const customer = people.data.items.find((p) => p.phone === '09120000010');
  assert.ok(customer, 'seeded customer must appear in the directory');
  assert.match(customer.username, /^cm912/);
  assert.equal(customer.has_shipping, true);
  assert.equal(customer.has_orders, true);
  assert.ok(customer.address_count >= 1);
  assert.ok(people.data.summary.filled_forms >= 2);

  // Directory detail exposes every filled form and an activity timeline.
  const detail = await api(`/api/v1/admin/console/people/${customer.id}`, { token: adminToken });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.user.phone, '09120000010');
  assert.ok(detail.data.addresses.length >= 1);
  assert.ok(detail.data.timeline.length >= 2);

  // CSV export is available and contains the real phone number.
  const csv = await api('/api/v1/admin/console/people.csv', { token: adminToken });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.data, /09120000010/);
});

test('admin console: automatic directory registration from any filled form', async () => {
  const adminToken = await loginAs('09120000001');
  resetRateLimits();
  const reg = await api('/api/v1/auth/register', {
    method: 'POST',
    body: {
      phone: '09120000099',
      full_name: 'کاربر آزمایشی کنسول',
      password: 'Cm@Test1405!',
      email: 'console-new@centralmine.test'
    }
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));

  const address = await api('/api/v1/me/addresses', {
    method: 'POST',
    token: reg.data.token,
    body: {
      title: 'دفتر آزمایشی',
      province: 'تهران',
      city: 'تهران',
      address_line: 'خیابان ولیعصر، برج آزمون، طبقهٔ پنجم، واحد ۱۲',
      postal_code: '1458896321',
      recipient_name: 'کاربر آزمایشی کنسول',
      recipient_phone: '09120000099',
      auto_fill: true
    }
  });
  assert.equal(address.status, 201, JSON.stringify(address.data));

  const found = await api('/api/v1/admin/console/people?q=09120000099', { token: adminToken });
  assert.equal(found.status, 200);
  assert.equal(found.data.items.length, 1);
  assert.equal(found.data.items[0].username, 'cm9120000099');
  assert.equal(found.data.items[0].has_shipping, true);
  assert.equal(found.data.items[0].address_count, 1);
  assert.equal(found.data.items[0].last_source, 'shipping_form');
});

test('admin console: create product with price/stock and edit username safely', async () => {
  const adminToken = await loginAs('09120000001');

  const created = await api('/api/v1/admin/console/products', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'محصول آزمایشی مرکز کنترل',
      description: 'ساخت شده از طریق تست خودکار',
      status: 'active',
      category_name: 'دستهٔ آزمایشی',
      brand_name: 'برند آزمایشی',
      sku: { price_toman: 850000, cost_price_toman: 600000, stock: 12, variant_attrs: { رنگ: 'صورتی' } }
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.product.name, 'محصول آزمایشی مرکز کنترل');
  assert.equal(created.data.product.skus.length, 1);
  assert.equal(created.data.product.skus[0].stock, 12);
  assert.equal(created.data.sku.price_toman, 850000);

  const list = await api(`/api/v1/admin/console/products?q=${encodeURIComponent('مرکز کنترل')}`, { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].sku_count, 1);
  assert.equal(list.data.items[0].total_stock, 12);

  const people = await api('/api/v1/admin/console/people?q=09120000011', { token: adminToken });
  const target = people.data.items[0];
  const renamed = await api(`/api/v1/admin/console/people/${target.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { username: 'elham_sharifi' }
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.user.username, 'elham_sharifi');

  // Username uniqueness is enforced.
  const conflict = await api(`/api/v1/admin/console/people/${target.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { username: 'cm9120000010' }
  });
  assert.equal(conflict.status, 409);
});

test('admin console: automatic cash treasury (payments in, refunds out, manual adjust)', async () => {
  const adminToken = await loginAs('09120000001');

  const before = await api('/api/v1/admin/console/treasury?limit=5', { token: adminToken });
  assert.equal(before.status, 200);
  const startBalance = before.data.summary.balance_toman;
  assert.ok(startBalance > 0, 'seeded paid payments must have fed the treasury automatically');

  // A settled payment inserted anywhere feeds the treasury through a DB trigger.
  const paymentId = uuid();
  run(
    `INSERT INTO payments (id, order_id, service_request_id, lth_purchase_id, amount_toman, status, gateway, callback_token, paid_at, created_at, updated_at)
     VALUES (?, NULL, NULL, 'test-lth-purchase', 1234000, 'paid', 'sandbox', ?, ?, ?, ?)`,
    [paymentId, `cb-${paymentId}`, nowIso(), nowIso(), nowIso()]
  );
  const afterPayment = await api('/api/v1/admin/console/treasury?limit=50', { token: adminToken });
  assert.equal(afterPayment.data.summary.balance_toman, startBalance + 1234000);
  assert.ok(afterPayment.data.ledger.some((row) => row.ref_id === paymentId && row.direction === 'in'));

  // Refunds are automatically recorded as outflow.
  run(
    `INSERT INTO refunds (id, payment_id, amount_toman, reason, reference, status, actor_id, created_at)
     VALUES (?, ?, 340000, 'آزمون استرداد خودکار', ?, 'done', NULL, ?)`,
    [uuid(), paymentId, `TEST-REF-${paymentId}`, nowIso()]
  );
  const afterRefund = await api('/api/v1/admin/console/treasury?limit=50', { token: adminToken });
  assert.equal(afterRefund.data.summary.balance_toman, startBalance + 1234000 - 340000);
  assert.ok(afterRefund.data.ledger.some((row) => row.entry_type === 'refund' && row.direction === 'out'));

  // Manual adjustment (audited) moves the balance exactly once.
  const adjustment = await api('/api/v1/admin/console/treasury/adjust', {
    method: 'POST',
    token: adminToken,
    body: { direction: 'out', amount_toman: 90000, reason: 'آزمون اصلاح دستی خزانه', note: 'تست' }
  });
  assert.equal(adjustment.status, 201, JSON.stringify(adjustment.data));
  assert.equal(adjustment.data.balance_toman, startBalance + 1234000 - 340000 - 90000);
});
