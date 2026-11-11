'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-e2e-'));
process.env.CM_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CM_STORAGE_DIR = path.join(tmpRoot, 'storage');
process.env.CM_SECRET = 'acceptance-test-secret-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';

const { seed } = require('../src/db/seed');
const { get, run, close } = require('../src/db');
const { createApp } = require('../src/app');
const { resetRateLimits } = require('../src/middleware/rateLimit');
const { signCallback } = require('../src/modules/payments/service');

let server;
let baseUrl;

async function api(pathname, { method = 'GET', token, body, headers = {}, rawBody } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = rawBody;
  if (body !== undefined && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (body instanceof FormData) {
    payload = body;
  }
  const res = await fetch(`${baseUrl}${pathname}`, { method, headers: h, body: payload, redirect: 'manual' });
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

test.before(async () => {
  seed({ silent: true });
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('scenario #1 & #17: health check honesty, public catalog browse, search, filter, and cost-price hiding', async () => {
  const health = await api('/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'ok');
  assert.equal(health.data.integrations.payment_gateway.real_connected, false);
  assert.equal(health.data.integrations.sms_otp.real_connected, false);

  const cats = await api('/api/v1/categories');
  assert.equal(cats.status, 200);
  assert.ok(cats.data.items.length >= 4);

  const search = await api(`/api/v1/products?q=${encodeURIComponent('مولتی‌متر')}`);
  assert.equal(search.status, 200);
  assert.equal(search.data.items.length, 1);

  const detail = await api(`/api/v1/products/${search.data.items[0].slug}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.data.product.skus.length >= 2);
  // Customer/public must NEVER see cost_price_toman (§6)
  for (const sku of detail.data.product.skus) {
    assert.equal(sku.cost_price_toman, undefined);
  }
});

test('scenario #2 & #3: select SKU, add to cart, and stock-drop before order placement rejects oversell', async () => {
  const cust = await loginAs('09120000010');
  const wh = await loginAs('09120000004');

  // Pick low-stock SKU CM-SS94-12 (initial stock = 2)
  const prod = await api('/api/v1/products/ss-46pc-socket-wrench-set');
  const lowSku = prod.data.product.skus.find((s) => s.code === 'CM-SS94-12');
  assert.equal(lowSku.stock, 2);

  await api('/api/v1/cart', { method: 'DELETE', token: cust.token });
  const addRes = await api('/api/v1/cart/items', {
    method: 'POST',
    token: cust.token,
    body: { sku_id: lowSku.id, quantity: 2 }
  });
  assert.equal(addRes.status, 201);
  assert.equal(addRes.data.subtotal_toman, lowSku.price_toman * 2);

  // Warehouse adjusts stock down by -1 with mandatory reason before customer checks out
  const adj = await api(`/api/v1/admin/skus/${lowSku.id}/stock`, {
    method: 'POST',
    token: wh.token,
    body: { delta: -1, reason: 'آسیب بسته‌بندی در انبارگردانی' }
  });
  assert.equal(adj.status, 200);
  assert.equal(adj.data.sku.stock, 1);

  const addrs = await api('/api/v1/me/addresses', { token: cust.token });
  const orderAttempt = await api('/api/v1/orders', {
    method: 'POST',
    token: cust.token,
    headers: { 'Idempotency-Key': 'idem-stock-drop-1' },
    body: { address_id: addrs.data.items[0].id, shipping_method: 'post' }
  });
  assert.equal(orderAttempt.status, 409);
  assert.equal(orderAttempt.data.error.code, 'OUT_OF_STOCK');

  // Restore stock back +1 and clear cart
  await api(`/api/v1/admin/skus/${lowSku.id}/stock`, {
    method: 'POST',
    token: wh.token,
    body: { delta: 1, reason: 'بازگشت کالا به قفسه پس از تعویض جعبه' }
  });
  await api('/api/v1/cart', { method: 'DELETE', token: cust.token });
});

test('scenario #4, #5, #6: idempotent order creation, sandbox payment, duplicate callback safety, warehouse shipping & cancel restock-once', async () => {
  const cust = await loginAs('09120000010');
  const wh = await loginAs('09120000004');

  const prod = await api('/api/v1/products/pi-pro-safety-helmet');
  const sku = prod.data.product.skus.find((s) => s.code === 'CM-HLM-WHT');
  const stockBefore = sku.stock;

  await api('/api/v1/cart/items', {
    method: 'POST',
    token: cust.token,
    body: { sku_id: sku.id, quantity: 2 }
  });
  const addrs = await api('/api/v1/me/addresses', { token: cust.token });

  // Place order with Idempotency-Key
  const ord1 = await api('/api/v1/orders', {
    method: 'POST',
    token: cust.token,
    headers: { 'Idempotency-Key': 'idem-order-main-1' },
    body: { address_id: addrs.data.items[0].id, shipping_method: 'post' }
  });
  assert.equal(ord1.status, 201);
  // Subtotal = 2 * 485000 = 970000 (< 1500000 free threshold) → shipping = 39000
  assert.equal(ord1.data.order.subtotal_toman, 970000);
  assert.equal(ord1.data.order.shipping_toman, 39000);
  assert.equal(ord1.data.order.total_toman, 1009000);

  // Replay exact same Idempotency-Key → 200 replay, stock decremented only ONCE
  const ordReplay = await api('/api/v1/orders', {
    method: 'POST',
    token: cust.token,
    headers: { 'Idempotency-Key': 'idem-order-main-1' },
    body: { address_id: addrs.data.items[0].id, shipping_method: 'post' }
  });
  assert.equal(ordReplay.status, 200);
  assert.equal(ordReplay.data.order.code, ord1.data.order.code);

  const afterOrderProd = await api('/api/v1/products/pi-pro-safety-helmet');
  const afterOrderSku = afterOrderProd.data.product.skus.find((s) => s.code === 'CM-HLM-WHT');
  assert.equal(afterOrderSku.stock, stockBefore - 2);

  // Sandbox payment callback + duplicate callback idempotency (#5)
  const payRow = get('SELECT * FROM payments WHERE id = ?', [ord1.data.payment.id]);
  const cbPayload = {
    token: payRow.callback_token,
    outcome: 'success',
    signature: signCallback(payRow.callback_token, 'success')
  };
  const cb1 = await api('/api/v1/payments/sandbox/callback', { method: 'POST', body: cbPayload });
  assert.equal(cb1.status, 200);
  assert.equal(cb1.data.payment.status, 'paid');
  assert.equal(cb1.data.replay, false);

  const cb2 = await api('/api/v1/payments/sandbox/callback', { method: 'POST', body: cbPayload });
  assert.equal(cb2.status, 200);
  assert.equal(cb2.data.payment.status, 'paid');
  assert.equal(cb2.data.replay, true);

  // Receipt from server data
  const rcpt = await api(`/api/v1/orders/${ord1.data.order.code}/receipt`, { token: cust.token });
  assert.equal(rcpt.status, 200);
  assert.equal(rcpt.data.receipt.payment_status, 'paid');
  assert.equal(rcpt.data.receipt.total_toman, 1009000);

  // Warehouse flow: paid -> preparing -> shipped (requires tracking_code) -> customer confirm delivery
  const prep = await api(`/api/v1/staff/orders/${ord1.data.order.code}/status`, {
    method: 'POST',
    token: wh.token,
    body: { to_status: 'preparing', reason: 'تحویل به واحد بسته‌بندی' }
  });
  assert.equal(prep.status, 200);
  assert.equal(prep.data.order.tracking_code, null);

  const shipNoTrack = await api(`/api/v1/staff/orders/${ord1.data.order.code}/status`, {
    method: 'POST',
    token: wh.token,
    body: { to_status: 'shipped' }
  });
  assert.equal(shipNoTrack.status, 400);

  const shipOk = await api(`/api/v1/staff/orders/${ord1.data.order.code}/status`, {
    method: 'POST',
    token: wh.token,
    body: { to_status: 'shipped', tracking_code: 'POST-IR-88776655', reason: 'تحویل به پست پیشتاز' }
  });
  assert.equal(shipOk.status, 200);
  assert.equal(shipOk.data.order.tracking_code, 'POST-IR-88776655');

  // Separate order to test cancellation & single-restock policy (#6)
  await api('/api/v1/cart/items', {
    method: 'POST',
    token: cust.token,
    body: { sku_id: sku.id, quantity: 1 }
  });
  const ordCancel = await api('/api/v1/orders', {
    method: 'POST',
    token: cust.token,
    headers: { 'Idempotency-Key': 'idem-order-cancel-1' },
    body: { address_id: addrs.data.items[0].id, shipping_method: 'courier' }
  });
  assert.equal(ordCancel.status, 201);
  const stockDuringPending = get('SELECT stock FROM skus WHERE id = ?', [sku.id]).stock;

  const cancel1 = await api(`/api/v1/orders/${ordCancel.data.order.code}/cancel`, {
    method: 'POST',
    token: cust.token,
    body: { reason: 'انصراف پیش از پرداخت' }
  });
  assert.equal(cancel1.status, 200);
  assert.equal(cancel1.data.order.status, 'canceled');
  assert.equal(get('SELECT stock FROM skus WHERE id = ?', [sku.id]).stock, stockDuringPending + 1);

  // Attempting to cancel again fails and does NOT restock a second time
  const cancel2 = await api(`/api/v1/orders/${ordCancel.data.order.code}/cancel`, {
    method: 'POST',
    token: cust.token,
    body: { reason: 'تلاش دوم لغو' }
  });
  assert.equal(cancel2.status, 409);
  assert.equal(get('SELECT stock FROM skus WHERE id = ?', [sku.id]).stock, stockDuringPending + 1);
});

test('scenario #7, #8, #9, #10, #11, #12, #13: full services operational workflow, versioned forms, paid vs free, SLA, internal notes, and private result files', async () => {
  const cust = await loginAs('09120000010');
  const cust2 = await loginAs('09120000011');
  const op = await loginAs('09120000002');
  const admin = await loginAs('09120000001');

  // #7: Incomplete form submission rejected with field validation details
  const badForm = await api('/api/v1/service-requests', {
    method: 'POST',
    token: cust.token,
    body: {
      service_slug: 'instrument-calibration-certificate',
      form_data: { device_type: 'مولتی‌متر دیجیتال' }
    }
  });
  assert.equal(badForm.status, 400);
  assert.equal(badForm.data.error.code, 'VALIDATION_ERROR');
  assert.ok(badForm.data.error.details.length >= 2);

  // #8a: Free service enters 'queued' immediately
  const freeReq = await api('/api/v1/service-requests', {
    method: 'POST',
    token: cust.token,
    body: {
      service_slug: 'free-initial-diagnostics',
      form_data: {
        equipment_name: 'متر لیزری KS-L80',
        fault_category: 'روشن نشدن دستگاه',
        fault_description: 'پس از تعویض باتری روشن نمی‌شود.',
        contact_phone: '09120000010'
      }
    }
  });
  assert.equal(freeReq.status, 201);
  assert.equal(freeReq.data.request.status, 'queued');

  // #8b: Paid service starts as 'submitted' and CANNOT enter queue before payment
  const paidForm = new FormData();
  paidForm.append('service_slug', 'instrument-calibration-certificate');
  paidForm.append('form_data', JSON.stringify({
    device_type: 'مولتی‌متر دیجیتال',
    brand_model: 'KS-420',
    serial_number: 'SN-774411',
    last_calibration_note: 'نیاز به گواهی رسمی'
  }));
  paidForm.append('files', new Blob(['plate photo'], { type: 'text/plain' }), 'serial-plate.txt');

  const paidReq = await api('/api/v1/service-requests', {
    method: 'POST',
    token: cust.token,
    body: paidForm
  });
  assert.equal(paidReq.status, 201);
  assert.equal(paidReq.data.request.status, 'submitted');
  assert.equal(paidReq.data.request.form_version, 1);
  const originalPrice = paidReq.data.request.price_toman;
  const srCode = paidReq.data.request.code;
  const srId = paidReq.data.request.id;

  // Admin updates service price & terms -> bumps form_version to 2, WITHOUT mutating existing request (#8.1)
  const svcDetail = await api('/api/v1/services/instrument-calibration-certificate');
  const svcUpdate = await api(`/api/v1/admin/services/${svcDetail.data.service.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { price_toman: 530000, terms: 'شرایط نسخهٔ ۲: گواهی دیجیتال دوزبانه' }
  });
  assert.equal(svcUpdate.status, 200);
  assert.equal(svcUpdate.data.service.form_version, 2);

  const checkOldSnapshot = await api(`/api/v1/service-requests/${srCode}`, { token: cust.token });
  assert.equal(checkOldSnapshot.data.request.form_version, 1);
  assert.equal(checkOldSnapshot.data.request.price_toman, originalPrice);

  // Operator trying to move unpaid paid-service to queued -> 402 PAYMENT_REQUIRED
  const prematureQueue = await api(`/api/v1/staff/service-requests/${srId}/status`, {
    method: 'POST',
    token: op.token,
    body: { to_status: 'queued', reason: 'تلاش بدون پرداخت' }
  });
  assert.equal(prematureQueue.status, 402);

  // Customer pays via sandbox -> automatically transitions submitted -> queued
  const payInit = await api('/api/v1/payments', {
    method: 'POST',
    token: cust.token,
    headers: { 'Idempotency-Key': 'idem-pay-sr-1' },
    body: { service_request_code: srCode }
  });
  assert.equal(payInit.status, 201);
  const srPayRow = get('SELECT * FROM payments WHERE id = ?', [payInit.data.payment.id]);
  const srCb = await api('/api/v1/payments/sandbox/callback', {
    method: 'POST',
    body: {
      token: srPayRow.callback_token,
      outcome: 'success',
      signature: signCallback(srPayRow.callback_token, 'success')
    }
  });
  assert.equal(srCb.status, 200);

  const afterPay = await api(`/api/v1/service-requests/${srCode}`, { token: cust.token });
  assert.equal(afterPay.data.request.status, 'queued');

  // #9: Operator cannot jump queued -> in_progress without assignment; assigns first -> in_progress
  const skipAssign = await api(`/api/v1/staff/service-requests/${srId}/status`, {
    method: 'POST',
    token: op.token,
    body: { to_status: 'in_progress' }
  });
  assert.equal(skipAssign.status, 409);

  const assigned = await api(`/api/v1/staff/service-requests/${srId}/assign`, {
    method: 'POST',
    token: op.token,
    body: { reason: 'پذیرش پرونده در آزمایشگاه کالیبراسیون' }
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.data.request.status, 'assigned');

  const inProg = await api(`/api/v1/staff/service-requests/${srId}/status`, {
    method: 'POST',
    token: op.token,
    body: { to_status: 'in_progress', reason: 'شروع تست نقاط مرجع' }
  });
  assert.equal(inProg.status, 200);

  // #10 & #11: Operator posts internal note + asks customer for supplemental info (waiting_customer)
  await api(`/api/v1/staff/service-requests/${srId}/messages`, {
    method: 'POST',
    token: op.token,
    body: { body: 'یادداشت محرمانهٔ آزمایشگاه: پراب دوم مقاومت ۰.۲ اهم دارد.', internal: true }
  });
  await api(`/api/v1/staff/service-requests/${srId}/messages`, {
    method: 'POST',
    token: op.token,
    body: { body: 'لطفاً شمارهٔ اموال سازمانی دستگاه را برای درج در گواهی اعلام فرمایید.', internal: false }
  });
  const waitCust = await api(`/api/v1/staff/service-requests/${srId}/status`, {
    method: 'POST',
    token: op.token,
    body: { to_status: 'waiting_customer', reason: 'استعلام شماره اموال سازمانی برای گواهی' }
  });
  assert.equal(waitCust.status, 200);
  assert.equal(waitCust.data.request.status, 'waiting_customer');

  // Customer fetches case -> sees public operator message, NEVER sees internal_note!
  const custView = await api(`/api/v1/service-requests/${srCode}`, { token: cust.token });
  assert.equal(custView.data.request.messages.some((m) => m.kind === 'internal_note'), false);
  assert.equal(custView.data.request.messages.length, 1);

  // Customer replies -> status automatically resumes 'in_progress'
  const custReply = await api(`/api/v1/service-requests/${srCode}/messages`, {
    method: 'POST',
    token: cust.token,
    body: { body: 'شماره اموال: AM-44091' }
  });
  assert.equal(custReply.status, 201);
  assert.equal(custReply.data.request.status, 'in_progress');

  // #12: Cannot complete without result_summary; upload result file + internal file; verify file ACLs
  const completeNoResult = await api(`/api/v1/staff/service-requests/${srId}/status`, {
    method: 'POST',
    token: op.token,
    body: { to_status: 'completed' }
  });
  assert.equal(completeNoResult.status, 400);

  const resForm = new FormData();
  resForm.append('kind', 'result_file');
  resForm.append('files', new Blob(['%PDF-1.4 Calibration Certificate SN-774411'], { type: 'application/pdf' }), 'certificate.pdf');
  const upRes = await api(`/api/v1/staff/service-requests/${srId}/files`, {
    method: 'POST',
    token: op.token,
    body: resForm
  });
  assert.equal(upRes.status, 201);
  const resultFile = upRes.data.request.files.find((f) => f.kind === 'result_file');

  const intForm = new FormData();
  intForm.append('kind', 'internal');
  intForm.append('files', new Blob(['raw bench log'], { type: 'text/plain' }), 'raw-log.txt');
  const upInt = await api(`/api/v1/staff/service-requests/${srId}/files`, {
    method: 'POST',
    token: op.token,
    body: intForm
  });
  const internalFile = upInt.data.request.files.find((f) => f.kind === 'internal');

  const doneReq = await api(`/api/v1/staff/service-requests/${srId}/status`, {
    method: 'POST',
    token: op.token,
    body: { to_status: 'completed', result_summary: 'آزمون کالیبراسیون در ۵ رنج ولتاژ و جریان با موفقیت تایید شد و گواهی PDF پیوست گردید.' }
  });
  assert.equal(doneReq.status, 200);
  assert.equal(doneReq.data.request.status, 'completed');

  // Owner can download result_file, CANNOT download internal file (#12), and cust2 gets 403 (#15)
  const dlOwner = await api(`/api/v1/files/${resultFile.id}`, { token: cust.token });
  assert.equal(dlOwner.status, 200);
  assert.ok(String(dlOwner.data).includes('Calibration Certificate'));

  const dlInternalByOwner = await api(`/api/v1/files/${internalFile.id}`, { token: cust.token });
  assert.equal(dlInternalByOwner.status, 403);

  const dlByStranger = await api(`/api/v1/files/${resultFile.id}`, { token: cust2.token });
  assert.equal(dlByStranger.status, 403);

  // #13: SLA breach detection in operator queue
  run("UPDATE service_requests SET due_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [freeReq.data.request.id]);
  const breachedQueue = await api('/api/v1/staff/service-requests?sla=breached', { token: op.token });
  assert.equal(breachedQueue.status, 200);
  assert.ok(breachedQueue.data.items.some((r) => r.code === freeReq.data.request.code && r.sla_breached === true));
});

test('scenario #14 & #15: support tickets lifecycle + strict cross-customer isolation across all modules', async () => {
  const cust1 = await loginAs('09120000010');
  const cust2 = await loginAs('09120000011');
  const sup = await loginAs('09120000003');

  const tk = await api('/api/v1/tickets', {
    method: 'POST',
    token: cust1.token,
    body: {
      subject: 'سؤال دربارهٔ نحوهٔ نگهداری پراب مولتی‌متر',
      category: 'orders',
      priority: 'normal',
      body: 'آیا پراب سیلیکونی قابل شست‌وشو با الکل ایزوپروپیل است؟'
    }
  });
  assert.equal(tk.status, 201);
  const tkCode = tk.data.ticket.code;

  // Support replies & marks resolved
  const reply = await api(`/api/v1/tickets/${tkCode}/messages`, {
    method: 'POST',
    token: sup.token,
    body: { body: 'بله، استفاده از ایزوپروپیل الکل روی بدنهٔ عایق بلامانع است.' }
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.data.ticket.status, 'open');

  const resolved = await api(`/api/v1/staff/tickets/${tkCode}/status`, {
    method: 'POST',
    token: sup.token,
    body: { to_status: 'resolved', reason: 'پاسخ فنی ارائه شد' }
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.data.ticket.status, 'resolved');

  // #15: cust2 cannot read cust1's ticket, order, or service request
  assert.equal((await api(`/api/v1/tickets/${tkCode}`, { token: cust2.token })).status, 403);
  assert.equal((await api('/api/v1/orders/CM-SEED2401', { token: cust2.token })).status, 403);
  assert.equal((await api('/api/v1/orders/CM-SEED2401/receipt', { token: cust2.token })).status, 403);
  assert.equal((await api('/api/v1/service-requests/SR-SEED3101', { token: cust2.token })).status, 403);
});

test('scenario #16 & #17: session persistence, OTP single-use & cooldown, logout revocation, failed/expired payment handling', async () => {
  const reg = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { phone: '09129998877', full_name: 'کاربر آزمایشی نشست', password: 'UserPass@1405' }
  });
  assert.equal(reg.status, 201);
  const token1 = reg.data.token;

  // Survives refresh via /auth/me
  const me1 = await api('/api/v1/auth/me', { token: token1 });
  assert.equal(me1.status, 200);
  assert.equal(me1.data.user.phone, '09129998877');

  // OTP request + cooldown + single-use verification
  const otpReq = await api('/api/v1/auth/otp/request', {
    method: 'POST',
    body: { phone: '09129998877' }
  });
  assert.equal(otpReq.status, 200);
  assert.equal(otpReq.data.channel, 'sandbox');
  assert.match(otpReq.data.dev_code, /^\d{6}$/);

  const otpCooldown = await api('/api/v1/auth/otp/request', {
    method: 'POST',
    body: { phone: '09129998877' }
  });
  assert.equal(otpCooldown.status, 429);

  const otpVerify1 = await api('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { phone: '09129998877', code: otpReq.data.dev_code }
  });
  assert.equal(otpVerify1.status, 200);
  const otpToken = otpVerify1.data.token;

  // Reusing consumed OTP fails with generic error
  const otpReuse = await api('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { phone: '09129998877', code: otpReq.data.dev_code }
  });
  assert.equal(otpReuse.status, 401);

  // Logout revokes token immediately
  const lo = await api('/api/v1/auth/logout', { method: 'POST', token: otpToken });
  assert.equal(lo.status, 200);
  assert.equal((await api('/api/v1/auth/me', { token: otpToken })).status, 401);

  // Expired/unknown payment outcome keeps order pending_payment (#17)
  const addrs = await api('/api/v1/me/addresses', {
    method: 'POST',
    token: token1,
    body: {
      title: 'منزل', province: 'تهران', city: 'تهران',
      address_line: 'خیابان ولیعصر، بالاتر از میدان ونک، پلاک ۱۰۲',
      postal_code: '1991944556', recipient_name: 'کاربر آزمایشی', recipient_phone: '09129998877'
    }
  });
  const prod = await api('/api/v1/products/pi-pro-safety-helmet');
  await api('/api/v1/cart/items', {
    method: 'POST',
    token: token1,
    body: { sku_id: prod.data.product.skus[0].id, quantity: 1 }
  });
  const ord = await api('/api/v1/orders', {
    method: 'POST',
    token: token1,
    headers: { 'Idempotency-Key': 'idem-exp-pay-1' },
    body: { address_id: addrs.data.address.id }
  });
  const payRow = get('SELECT * FROM payments WHERE id = ?', [ord.data.payment.id]);
  const expCb = await api('/api/v1/payments/sandbox/callback', {
    method: 'POST',
    body: {
      token: payRow.callback_token,
      outcome: 'expired',
      signature: signCallback(payRow.callback_token, 'expired')
    }
  });
  assert.equal(expCb.status, 200);
  assert.equal(expCb.data.payment.status, 'expired');
  const ordAfterExp = await api(`/api/v1/orders/${ord.data.order.code}`, { token: token1 });
  assert.equal(ordAfterExp.data.order.status, 'pending_payment');
});

test('scenario #18: RBAC separation of duties, CSRF defense, admin re-auth + audit log, and historical-cost profit report', async () => {
  const cust = await loginAs('09120000010');
  const op = await loginAs('09120000002');
  const sup = await loginAs('09120000003');
  const wh = await loginAs('09120000004');
  const fin = await loginAs('09120000005');
  const admin = await loginAs('09120000001');

  // Unauthorized roles rejected server-side
  assert.equal((await api('/api/v1/admin/users', { token: cust.token })).status, 403);
  assert.equal((await api('/api/v1/admin/users', { token: op.token })).status, 403);
  assert.equal((await api('/api/v1/admin/audit', { token: fin.token })).status, 403);
  assert.equal((await api('/api/v1/payments', { token: wh.token })).status, 403);
  assert.equal((await api('/api/v1/admin/reports/sales', { token: sup.token })).status, 403);

  // Support cannot adjust warehouse stock (§3.4)
  const anySku = get('SELECT id FROM skus LIMIT 1');
  assert.equal((await api(`/api/v1/admin/skus/${anySku.id}/stock`, {
    method: 'POST',
    token: sup.token,
    body: { delta: 5, reason: 'تلاش غیرمجاز پشتیبانی' }
  })).status, 403);

  // CSRF check: cookie-authenticated cross-origin POST is blocked
  const csrfAttempt = await api('/api/v1/auth/logout', {
    method: 'POST',
    headers: {
      Cookie: `cm_token=${cust.token}`,
      Origin: 'https://evil.example',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    rawBody: 'a=1'
  });
  assert.equal(csrfAttempt.status, 403);

  // Admin role change requires admin password re-confirmation and records audit_log
  const targetUser = get("SELECT id FROM users WHERE phone = '09129998877'");
  const badReauth = await api(`/api/v1/admin/users/${targetUser.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { role: 'support', reason: 'ارتقای آزمایشی', current_password: 'WrongPassword!' }
  });
  assert.equal(badReauth.status, 401);

  const okRoleChange = await api(`/api/v1/admin/users/${targetUser.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { role: 'support', reason: 'پیوستن به تیم پشتیبانی شیفت عصر', current_password: 'Cm@Test1405!' }
  });
  assert.equal(okRoleChange.status, 200);
  assert.equal(okRoleChange.data.user.role, 'support');

  const auditRes = await api('/api/v1/admin/audit?action=user.admin_update', { token: admin.token });
  assert.equal(auditRes.status, 200);
  assert.ok(auditRes.data.items.length >= 1);

  // §17: Sales profit report uses historical unit_cost_toman at time of sale, NOT current SKU cost!
  const repBefore = await api('/api/v1/admin/reports/sales', { token: fin.token });
  assert.equal(repBefore.status, 200);
  const profitBefore = repBefore.data.kpis.gross_profit_toman;
  assert.ok(profitBefore > 0);
  // Phones in report must be masked
  for (const row of repBefore.data.recent_orders) {
    assert.match(row.customer_phone, /^09\d{2}\*{5}\d{2}$/);
  }

  // Change current cost_price_toman on ALL SKUs -> historical gross_profit_toman MUST stay identical!
  const ksSku = get("SELECT id FROM skus WHERE code = 'CM-KS420-STD'");
  await api(`/api/v1/admin/skus/${ksSku.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { cost_price_toman: 9999999 }
  });
  const repAfter = await api('/api/v1/admin/reports/sales', { token: fin.token });
  assert.equal(repAfter.data.kpis.gross_profit_toman, profitBefore);
});

test('scenario #7-concurrency & #19: concurrent orders never oversell stock + Persian RTL, mobile viewport, accessibility & safe PWA shell', async () => {
  // Concurrency test (§7: دو سفارش هم‌زمان نباید بیش از موجودی بفروشند)
  const cust1 = await loginAs('09120000010');
  const cust2 = await loginAs('09120000011');
  const lowSku = get("SELECT id FROM skus WHERE code = 'CM-SS94-12'");
  run('UPDATE skus SET stock = 1 WHERE id = ?', [lowSku.id]);

  await api('/api/v1/cart', { method: 'DELETE', token: cust1.token });
  await api('/api/v1/cart', { method: 'DELETE', token: cust2.token });
  await api('/api/v1/cart/items', { method: 'POST', token: cust1.token, body: { sku_id: lowSku.id, quantity: 1 } });
  await api('/api/v1/cart/items', { method: 'POST', token: cust2.token, body: { sku_id: lowSku.id, quantity: 1 } });

  const addr1 = (await api('/api/v1/me/addresses', { token: cust1.token })).data.items[0].id;
  const addr2 = (await api('/api/v1/me/addresses', { token: cust2.token })).data.items[0].id;

  const [r1, r2] = await Promise.all([
    api('/api/v1/orders', { method: 'POST', token: cust1.token, headers: { 'Idempotency-Key': 'race-1' }, body: { address_id: addr1 } }),
    api('/api/v1/orders', { method: 'POST', token: cust2.token, headers: { 'Idempotency-Key': 'race-2' }, body: { address_id: addr2 } })
  ]);
  const statuses = [r1.status, r2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(get('SELECT stock FROM skus WHERE id = ?', [lowSku.id]).stock, 0);

  // Scenario #19: SPA HTML RTL, mobile viewport, skip-link, PWA manifest & safe SW
  const htmlRes = await api('/');
  assert.equal(htmlRes.status, 200);
  assert.match(String(htmlRes.data), /lang="fa"\s+dir="rtl"/);
  assert.match(String(htmlRes.data), /name="viewport"\s+content="width=device-width,\s*initial-scale=1\.0"/);
  assert.match(String(htmlRes.data), /class="skip-link"/);

  const manifestRes = await api('/manifest.webmanifest');
  assert.equal(manifestRes.status, 200);
  const manifestObj = typeof manifestRes.data === 'string' ? JSON.parse(manifestRes.data) : manifestRes.data;
  assert.equal(manifestObj.dir, 'rtl');
  assert.equal(manifestObj.lang, 'fa-IR');

  const swRes = await api('/sw.js');
  assert.equal(swRes.status, 200);
  assert.match(String(swRes.data), /url\.pathname\.startsWith\('\/api\/'\)/);

  // Private API endpoints must carry Cache-Control: no-store
  const catRes = await api('/api/v1/categories');
  assert.equal(catRes.headers.get('cache-control'), 'no-store');
});

test('LTH (LOTH COIN) end-to-end: calculator, packages, 7 wallet titles, 24h multi-server rewards, 3285d PoS lockup, 71/29 regulator, logo upload, Sheba & ledger reconciliation', async () => {
  const { runCoordinatedRewardTick } = require('../src/modules/lth/scheduler');
  const cust1 = await loginAs('09120000010');
  const cust2 = await loginAs('09120000011');
  const fin = await loginAs('09120000005');
  const admin = await loginAs('09120000001');

  // 1) Public config & calculator precision
  const cfgRes = await api('/api/v1/lth/config');
  assert.equal(cfgRes.status, 200);
  assert.equal(cfgRes.data.config.price_irr, '4840000000');
  assert.equal(cfgRes.data.config.stake_percent, 70);
  assert.equal(cfgRes.data.config.withdrawable_percent, 30);
  assert.equal(cfgRes.data.config.lockup_days, 3285);
  assert.deepEqual(cfgRes.data.config.packages_toman, [22000000, 11000000, 8000000, 1000000, 220000]);
  const pkg220k = cfgRes.data.config.packages.find((p) => p.amount_toman === 220000);
  assert.equal(pkg220k.amount_irr, '2200000');

  const calcPico = await api('/api/v1/lth/calculate', {
    method: 'POST',
    body: { mode: 'lth', value: '0.000000000001' }
  });
  assert.equal(calcPico.status, 200);
  assert.equal(calcPico.data.input_summary.irr_exact, '0.00484');

  // 2) Customer2 purchases 11,000,000 Toman (110,000,000 IRR) package via sandbox payment
  const purRes = await api('/api/v1/lth/purchases', {
    method: 'POST',
    token: cust2.token,
    headers: { 'Idempotency-Key': 'lth-buy-c2-1' },
    body: { amount_toman: 11000000, package_toman: 11000000 }
  });
  assert.equal(purRes.status, 201);
  const payRow = get('SELECT * FROM payments WHERE id = ?', [purRes.data.payment.id]);
  const cbBody = {
    token: payRow.callback_token,
    outcome: 'success',
    signature: signCallback(payRow.callback_token, 'success')
  };
  const cb1 = await api('/api/v1/payments/sandbox/callback', { method: 'POST', body: cbBody });
  assert.equal(cb1.status, 200);
  assert.equal(cb1.data.payment.lth_purchase_code, purRes.data.purchase.code);
  // Replay callback must be idempotent (never double-credit base_atoms!)
  const cbReplay = await api('/api/v1/payments/sandbox/callback', { method: 'POST', body: cbBody });
  assert.equal(cbReplay.data.replay, true);

  // 3) Simulate 25 hours elapsed -> multi-server reward tick settles exact-once 24h cycle
  const holdRow = get('SELECT * FROM lth_holdings WHERE purchase_order_id = ?', [purRes.data.purchase.id]);
  const past25hMs = Date.now() - 25 * 3600 * 1000;
  run(
    'UPDATE lth_holdings SET purchased_at_ms = ?, next_reward_at_ms = ? WHERE id = ?',
    [past25hMs, past25hMs + 86400000, holdRow.id]
  );
  // Clear existing lease to let server-A acquire, then server-B attempt concurrently
  run('DELETE FROM distributed_scheduler_leases');
  const tickA = runCoordinatedRewardTick({ instanceId: 'server-node-A' });
  const tickB = runCoordinatedRewardTick({ instanceId: 'server-node-B' });
  assert.equal(tickA.acquired_lease, true);
  assert.equal(tickA.cycles_settled, 1);
  assert.equal(tickB.acquired_lease, false);
  assert.equal(tickB.cycles_settled, 0);

  // Verify 7 wallet titles on Customer2
  const w2Res = await api('/api/v1/lth/wallet', { token: cust2.token });
  assert.equal(w2Res.status, 200);
  const w2 = w2Res.data.wallet;
  assert.ok(BigInt(w2.base_atoms) > 0n);
  assert.ok(BigInt(w2.staked_atoms) > 0n);
  assert.ok(BigInt(w2.withdrawable_reward_atoms) > 0n);
  assert.equal(
    BigInt(w2.total_withdrawable_atoms),
    BigInt(w2.base_atoms) + BigInt(w2.withdrawable_reward_atoms)
  );
  assert.equal(
    BigInt(w2.total_lth_atoms),
    BigInt(w2.base_atoms) + BigInt(w2.staked_atoms) + BigInt(w2.withdrawable_reward_atoms)
  );
  assert.equal(w2Res.data.reconciliation.healthy, true);

  // 4) Attempting to sell/withdraw total_lth (including locked 3285-day stake) MUST fail server-side!
  const illegalSell = await api('/api/v1/lth/withdrawals', {
    method: 'POST',
    token: cust2.token,
    body: {
      kind: 'sell_lth',
      sheba_iban: 'IR062960000000100324200001',
      account_holder_name: 'الهام شریفی',
      lth_amount: w2.total_lth_exact
    }
  });
  assert.equal(illegalSell.status, 409);

  // 5) Account-to-Account ("حساب به حساب") transfer of withdrawable LTH keeps recipient's base_atoms untouched
  const w1Before = (await api('/api/v1/lth/wallet', { token: cust1.token })).data.wallet;
  const p2pRes = await api('/api/v1/lth/transfers', {
    method: 'POST',
    token: cust2.token,
    body: {
      recipient: '09120000010',
      lth_amount: '0.00001000',
      note: 'انتقال تست حساب به حساب'
    }
  });
  assert.equal(p2pRes.status, 201);
  const w1After = (await api('/api/v1/lth/wallet', { token: cust1.token })).data.wallet;
  // Base LTH ("حجم پایه = فقط خریدهای اولیه") must NOT change on P2P receipt!
  assert.equal(w1After.base_atoms, w1Before.base_atoms);
  assert.ok(BigInt(w1After.withdrawable_reward_atoms) > BigInt(w1Before.withdrawable_reward_atoms));

  // 6) Valid Sheba withdrawal + Finance settlement with bank reference
  const shebaReq = await api('/api/v1/lth/withdrawals', {
    method: 'POST',
    token: cust2.token,
    body: {
      kind: 'sheba_withdrawal',
      sheba_iban: 'IR062960000000100324200001',
      account_holder_name: 'الهام شریفی',
      amount_irr: '2200000'
    }
  });
  assert.equal(shebaReq.status, 201);
  const wdCode = shebaReq.data.withdrawal.code;

  const finReview = await api(`/api/v1/staff/lth/withdrawals/${wdCode}/review`, {
    method: 'POST',
    token: fin.token,
    body: { action: 'approve_paid', bank_ref: 'PAYA-99887766', review_note: 'تسویه پایا انجام شد' }
  });
  assert.equal(finReview.status, 200);
  assert.equal(finReview.data.withdrawal.status, 'paid');

  // 7) Admin coupled 100% Regulator (71% stake -> auto 29% withdrawable) + RBAC + Logo upload validation
  assert.equal((await api('/api/v1/admin/lth/settings', {
    method: 'PATCH',
    token: fin.token,
    body: { stake_percent: 71, reason: 'تلاش غیرمجاز مالی' }
  })).status, 403);

  const regUpdate = await api('/api/v1/admin/lth/settings', {
    method: 'PATCH',
    token: admin.token,
    body: { stake_percent: 71, reason: 'ریگلاژ تست ۷۱ به ۲۹ درصد' }
  });
  assert.equal(regUpdate.status, 200);
  assert.equal(regUpdate.data.config.stake_percent, 71);
  assert.equal(regUpdate.data.config.withdrawable_percent, 29);

  // Restore 70/30 default after verifying regulator
  await api('/api/v1/admin/lth/settings', {
    method: 'PATCH',
    token: admin.token,
    body: { stake_percent: 70, reason: 'بازگشت به پیش‌فرض ۷۰ به ۳۰ درصد' }
  });

  // Malicious SVG upload blocked; valid PNG upload accepted
  const badForm = new FormData();
  badForm.append('logo', new Blob(['<svg><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'bad.svg');
  const badLogoRes = await api('/api/v1/admin/lth/logo', { method: 'POST', token: admin.token, body: badForm });
  assert.equal(badLogoRes.status, 400);

  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const okForm = new FormData();
  okForm.append('logo', new Blob([tinyPng], { type: 'image/png' }), 'lth-logo.png');
  const okLogoRes = await api('/api/v1/admin/lth/logo', { method: 'POST', token: admin.token, body: okForm });
  assert.equal(okLogoRes.status, 200);
  assert.match(okLogoRes.data.logo_path, /^\/uploads\/lth-logo-.*\.png$/);
  const serveLogo = await api(okLogoRes.data.logo_path);
  assert.equal(serveLogo.status, 200);

  // 8) Simulate 3285-day PoS maturity unlock & verify global double-entry ledger reconciliation === 0 discrepancy!
  run('UPDATE lth_holdings SET stake_unlock_at_ms = ? WHERE id = ?', [Date.now() - 1000, holdRow.id]);
  const afterUnlockWallet = await api('/api/v1/lth/wallet', { token: cust2.token });
  assert.equal(afterUnlockWallet.data.wallet.staked_atoms, '0');

  const globalRec = await api('/api/v1/admin/lth/reconciliation', { token: admin.token });
  assert.equal(globalRec.status, 200);
  assert.equal(globalRec.data.reconciliation.healthy, true);
  assert.equal(globalRec.data.reconciliation.mismatch_count, 0);
  assert.equal(globalRec.data.reconciliation.reward_split_conservation_ok, true);
});

