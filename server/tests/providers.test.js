'use strict';

/**
 * Live-provider plumbing: payment gateway adapters and SMS delivery.
 *
 * Until now the shop could only speak to its own sandbox. Everything below
 * checks the contract a real PSP / SMS panel has to satisfy, without any
 * network access:
 *
 *  - provider selection falls back to sandbox when it is misconfigured, so a
 *    half-filled .env can never silently take money through a wrong path;
 *  - /health tells the truth about what is actually connected;
 *  - the provider callback verifies server-side and fulfils through exactly
 *    the same code as the sandbox, so an order cannot be paid twice;
 *  - a forged / failed callback changes nothing and leaks nothing;
 *  - OTP survives a dead SMS route (200 to the caller, audited failure).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-prov-'));
process.env.CM_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CM_STORAGE_DIR = path.join(tmpRoot, 'storage');
process.env.CM_SECRET = 'provider-test-secret-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';

const { seed } = require('../src/db/seed');
const { get, run, all, close } = require('../src/db');
const { createApp } = require('../src/app');
const { resetRateLimits } = require('../src/middleware/rateLimit');
const providers = require('../src/modules/payments/providers');

let server;
let baseUrl;

async function api(pathname, { method = 'GET', token, body, redirect = 'manual' } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, { method, headers, body: payload, redirect });
}

async function loginAs(phone, password = 'Cm@Test1405!') {
  resetRateLimits();
  const res = await api('/api/v1/auth/login', { method: 'POST', body: { phone, password } });
  const data = await res.json();
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(data)}`);
  return data;
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
  await new Promise((resolve) => server.close(resolve));
  close();
});

test('providers: a provider without credentials falls back to sandbox instead of going half-live', () => {
  const saved = { p: process.env.CM_PAYMENT_PROVIDER, m: process.env.CM_PAYMENT_MERCHANT_ID, s: process.env.CM_SMS_PROVIDER, k: process.env.CM_SMS_API_KEY };
  try {
    delete process.env.CM_PAYMENT_PROVIDER;
    delete process.env.CM_SMS_PROVIDER;

    // Explicitly configured live provider but no merchant id: must NOT be live.
    process.env.CM_PAYMENT_PROVIDER = 'zarinpal';
    delete process.env.CM_PAYMENT_MERCHANT_ID;
    let st = providers.integrationStatus();
    assert.equal(st.payment_gateway.real_connected, false);
    assert.equal(st.payment_gateway.mode, 'sandbox');
    assert.equal(providers.paymentProvider().key, 'sandbox');

    // With credentials it reports the real provider.
    process.env.CM_PAYMENT_MERCHANT_ID = '1234-5678-9012-3456';
    st = providers.integrationStatus();
    assert.equal(st.payment_gateway.real_connected, true);
    assert.equal(st.payment_gateway.mode, 'zarinpal');
    assert.equal(providers.paymentProvider().label, 'زرین‌پال');

    // SMS: same rule, an API key is required.
    process.env.CM_SMS_PROVIDER = 'kavenegar';
    delete process.env.CM_SMS_API_KEY;
    assert.equal(providers.smsProvider(), null);
    process.env.CM_SMS_API_KEY = 'test-key';
    assert.equal(providers.smsProvider().key, 'kavenegar');
  } finally {
    if (saved.p === undefined) delete process.env.CM_PAYMENT_PROVIDER; else process.env.CM_PAYMENT_PROVIDER = saved.p;
    if (saved.m === undefined) delete process.env.CM_PAYMENT_MERCHANT_ID; else process.env.CM_PAYMENT_MERCHANT_ID = saved.m;
    if (saved.s === undefined) delete process.env.CM_SMS_PROVIDER; else process.env.CM_SMS_PROVIDER = saved.s;
    if (saved.k === undefined) delete process.env.CM_SMS_API_KEY; else process.env.CM_SMS_API_KEY = saved.k;
  }
});

test('providers: /health reports the real integration state, and stays truthful in sandbox', async () => {
  const res = await api('/health');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.integrations.payment_gateway, 'payment integration block must exist');
  assert.equal(typeof data.integrations.payment_gateway.real_connected, 'boolean');
  // In this test run nothing is configured, so both must be sandbox.
  assert.equal(data.integrations.payment_gateway.mode, 'sandbox');
  assert.equal(data.integrations.payment_gateway.real_connected, false);
  assert.equal(data.integrations.sms_otp.real_connected, false);
});

test('providers: the provider callback fulfils an order once and never twice', async () => {
  const customer = await loginAs('09120000010');

  // Build a real pending_payment order through the normal API flow.
  const prod = await api('/api/v1/products/pi-pro-safety-helmet');
  const sku = (await prod.json()).product.skus.find((s) => s.code === 'CM-HLM-WHT');
  assert.ok(sku, 'seed product/SKU must exist');

  await api('/api/v1/cart/items', { method: 'POST', token: customer.token, body: { sku_id: sku.id, quantity: 1 } });
  const addrs = await (await api('/api/v1/me/addresses', { token: customer.token })).json();
  const placed = await api('/api/v1/orders', {
    method: 'POST', token: customer.token,
    body: { address_id: addrs.items[0].id, shipping_method: 'post' }
  });
  assert.equal(placed.status, 201);
  const order = (await placed.json()).order;
  assert.equal(order.status, 'pending_payment');

  const created = await api('/api/v1/payments', {
    method: 'POST', token: customer.token, body: { order_code: order.code }
  });
  assert.equal(created.status, 201);
  const payment = (await created.json()).payment;
  assert.equal(payment.status, 'pending');

  // A forged failure must not touch the payment.
  const forged = await api(`/api/v1/payments/callback?ref=${payment.id}&Authority=X&Status=NOK`);
  assert.equal(forged.status, 303);
  assert.match(forged.headers.get('location'), /status=failed|status=pending/);
  assert.equal(get('SELECT status FROM payments WHERE id = ?', [payment.id]).status, 'pending',
    'a NOK callback must leave the payment pending, not fail it silently');

  // Simulate a verified success by exercising the shared fulfilment path.
  const { applyOutcomeInTx } = require('../src/modules/payments/service');
  const { tx } = require('../src/db');
  const first = tx(() => applyOutcomeInTx(get('SELECT * FROM payments WHERE id = ?', [payment.id]), 'success', { gatewayRef: 'REF-1' }));
  assert.equal(first.replay, false);
  assert.equal(first.payment.status, 'paid');

  const second = tx(() => applyOutcomeInTx(get('SELECT * FROM payments WHERE id = ?', [payment.id]), 'success', { gatewayRef: 'REF-1' }));
  assert.equal(second.replay, true, 'replaying the same callback must be detected');
  assert.equal(second.payment.status, 'paid');

  // The order moved forward exactly once.
  assert.equal(get('SELECT status FROM orders WHERE id = ?', [order.id]).status, 'paid');
  const timeline = all("SELECT to_status FROM order_status_history WHERE order_id = ? AND to_status = 'paid'", [order.id]);
  assert.equal(timeline.length, 1, 'the order must not be fulfilled twice');
});

test('providers: an OTP request survives a dead SMS route without leaking account existence', async () => {
  const savedProvider = process.env.CM_SMS_PROVIDER;
  const savedKey = process.env.CM_SMS_API_KEY;
  const savedSandbox = process.env.CM_OTP_SANDBOX;
  try {
    // Configure a provider that will fail (no network in the test sandbox).
    process.env.CM_SMS_PROVIDER = 'kavenegar';
    process.env.CM_SMS_API_KEY = 'not-a-real-key';
    process.env.CM_OTP_SANDBOX = '0';
    resetRateLimits();

    const res = await api('/api/v1/auth/otp/request', { method: 'POST', body: { phone: '09121112233' } });
    assert.equal(res.status, 200, 'a dead SMS route must not turn into a 500 for the caller');
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.dev_code, undefined, 'the code must never be returned in production mode');

    // The failure is recorded for the operator.
    const auditRow = get("SELECT detail FROM audit_log WHERE action = 'auth.otp_requested' ORDER BY created_at DESC LIMIT 1");
    assert.ok(auditRow, 'the attempt must be audited');
    const detail = JSON.parse(auditRow.detail);
    assert.equal(detail.channel, 'kavenegar');
    assert.equal(detail.delivered, false);
  } finally {
    if (savedProvider === undefined) delete process.env.CM_SMS_PROVIDER; else process.env.CM_SMS_PROVIDER = savedProvider;
    if (savedKey === undefined) delete process.env.CM_SMS_API_KEY; else process.env.CM_SMS_API_KEY = savedKey;
    if (savedSandbox === undefined) delete process.env.CM_OTP_SANDBOX; else process.env.CM_OTP_SANDBOX = savedSandbox;
  }
});
