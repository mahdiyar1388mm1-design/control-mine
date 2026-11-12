'use strict';

const crypto = require('crypto');
const { all, get, run, tx } = require('../../db');
const { ApiError } = require('../../utils/errors');
const config = require('../../config');
const { uuid, nowIso, validate, parsePagination, hashBody } = require('../../utils/validate');
const { notify, audit } = require('../platform/service');
const ordersService = require('../orders/service');
const lthService = require('../lth/service');

function signCallback(token, outcome) {
  return crypto.createHmac('sha256', config.secret).update(`${token}:${outcome}`).digest('hex');
}

function paymentToJson(row) {
  const lthPurchase = get('SELECT code FROM lth_purchase_orders WHERE payment_id = ?', [row.id]);
  return {
    id: row.id,
    order_id: row.order_id,
    service_request_id: row.service_request_id,
    lth_purchase_code: lthPurchase ? lthPurchase.code : null,
    amount_toman: row.amount_toman,
    status: row.status,
    status_label: {
      pending: 'در انتظار پرداخت', paid: 'پرداخت‌شده', failed: 'ناموفق',
      canceled: 'لغوشده', expired: 'منقضی‌شده', refunded: 'مستردشده'
    }[row.status] || row.status,
    gateway: row.gateway,
    gateway_ref: row.gateway_ref,
    paid_at: row.paid_at,
    failure_reason: row.failure_reason,
    created_at: row.created_at,
    pay_url: `/api/v1/payments/${row.id}/gateway`
  };
}

function createPayment(user, input, idempotencyKey) {
  const data = validate(input)
    .string('order_code', { required: false, max: 30, default: null })
    .string('service_request_code', { required: false, max: 30, default: null })
    .done();
  if (!data.order_code && !data.service_request_code) {
    throw ApiError.validation('سفارش یا درخواست خدمت مشخص نیست.', [{ field: 'order_code', message: 'الزامی است.' }]);
  }
  return tx(() => {
    if (idempotencyKey) {
      const prev = get(
        'SELECT request_hash, response_json FROM idempotency_keys WHERE key = ? AND user_id = ? AND endpoint = ?',
        [idempotencyKey, user.id, 'POST /payments']
      );
      if (prev) {
        return { ...JSON.parse(prev.response_json), idempotent_replay: true };
      }
    }

    let paymentRow;
    if (data.order_code) {
      const { order, isOwner } = ordersService.orderByCodeFor(data.order_code, user);
      if (!isOwner && !['admin', 'finance'].includes(user.role)) throw ApiError.forbidden();
      if (order.status !== 'pending_payment') {
        throw ApiError.invalidState('این سفارش نیاز به پرداخت ندارد.');
      }
      const existing = get("SELECT * FROM payments WHERE order_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1", [order.id]);
      if (existing) {
        paymentRow = existing;
      } else {
        const id = uuid();
        const now = nowIso();
        run(
          `INSERT INTO payments (id, order_id, service_request_id, amount_toman, status, gateway, gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'pending', 'sandbox', NULL, ?, NULL, NULL, ?, ?)`,
          [id, order.id, order.total_toman, crypto.randomBytes(24).toString('hex'), now, now]
        );
        paymentRow = get('SELECT * FROM payments WHERE id = ?', [id]);
      }
    } else {
      const reqRow = get('SELECT * FROM service_requests WHERE code = ?', [data.service_request_code]);
      if (!reqRow) throw ApiError.notFound('درخواست خدمت یافت نشد.');
      if (reqRow.user_id !== user.id && !['admin', 'finance'].includes(user.role)) throw ApiError.forbidden();
      if (reqRow.price_toman <= 0) throw ApiError.invalidState('این خدمت رایگان است و نیاز به پرداخت ندارد.');
      if (reqRow.payment_id) {
        const paid = get('SELECT * FROM payments WHERE id = ?', [reqRow.payment_id]);
        if (paid && paid.status === 'paid') throw ApiError.invalidState('پرداخت این درخواست قبلاً انجام شده است.');
        if (paid && paid.status === 'pending') {
          paymentRow = paid;
        }
      }
      if (!paymentRow) {
        const id = uuid();
        const now = nowIso();
        run(
          `INSERT INTO payments (id, order_id, service_request_id, amount_toman, status, gateway, gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at)
           VALUES (?, NULL, ?, ?, 'pending', 'sandbox', NULL, ?, NULL, NULL, ?, ?)`,
          [id, reqRow.id, reqRow.price_toman, crypto.randomBytes(24).toString('hex'), now, now]
        );
        run('UPDATE service_requests SET payment_id = ?, updated_at = ? WHERE id = ?', [id, now, reqRow.id]);
        paymentRow = get('SELECT * FROM payments WHERE id = ?', [id]);
      }
    }

    const payload = { payment: paymentToJson(paymentRow) };
    if (idempotencyKey) {
      run(
        'INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response_json, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [idempotencyKey, user.id, 'POST /payments', hashBody(data), JSON.stringify(payload), 201, nowIso()]
      );
    }
    return payload;
  });
}

function getPaymentFor(user, id) {
  const row = get('SELECT * FROM payments WHERE id = ?', [id]);
  if (!row) throw ApiError.notFound('پرداخت یافت نشد.');
  let allowed = ['admin', 'finance'].includes(user.role);
  if (row.order_id) {
    const order = get('SELECT user_id FROM orders WHERE id = ?', [row.order_id]);
    if (order && order.user_id === user.id) allowed = true;
  }
  if (row.service_request_id) {
    const reqRow = get('SELECT user_id FROM service_requests WHERE id = ?', [row.service_request_id]);
    if (reqRow && reqRow.user_id === user.id) allowed = true;
  }
  const lthPurchase = get('SELECT user_id FROM lth_purchase_orders WHERE payment_id = ?', [row.id]);
  if (lthPurchase && lthPurchase.user_id === user.id) {
    allowed = true;
  }
  if (!allowed) throw ApiError.forbidden('شما به این پرداخت دسترسی ندارید.');
  return row;
}

/**
 * Sandbox gateway page — stands in for a real PSP until verified credentials exist.
 * Each button posts a signed callback (HMAC over token:outcome).
 */
function gatewayHtml(payment) {
  const sign = (outcome) => signCallback(payment.callback_token, outcome);
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>درگاه پرداخت آزمایشی — CENTRAL MINE</title>
<style>
  body { font-family: Vazirmatn, Tahoma, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  .card { background: #1e293b; border-radius: 16px; padding: 32px; max-width: 420px; width: 92%; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .badge { display: inline-block; background: #b45309; color: #fff; border-radius: 999px; padding: 2px 12px; font-size: 12px; margin-bottom: 16px; }
  .amount { font-size: 28px; font-weight: 800; margin: 12px 0; }
  .muted { color: #94a3b8; font-size: 13px; }
  form { margin-top: 8px; }
  button { width: 100%; border: 0; border-radius: 12px; padding: 14px; font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 10px; font-family: inherit; }
  .ok { background: #16a34a; color: #fff; }
  .fail { background: #dc2626; color: #fff; }
  .exp { background: #475569; color: #fff; }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">درگاه آزمایشی (SANDBOX) — پرداخت واقعی انجام نمی‌شود</span>
    <h1>پرداخت سفارش/درخواست</h1>
    <div class="muted">شناسهٔ پرداخت: ${payment.id}</div>
    <div class="amount">${payment.amount_toman.toLocaleString('fa-IR')} تومان</div>
    <div class="muted">این صفحه جایگزین درگاه بانکی است تا زمانی که درگاه واقعی متصل شود. یکی از گزینه‌ها را انتخاب کنید:</div>
    <form method="POST" action="/api/v1/payments/sandbox/callback">
      <input type="hidden" name="token" value="${payment.callback_token}">
      <input type="hidden" name="outcome" value="success">
      <input type="hidden" name="signature" value="${sign('success')}">
      <button class="ok" type="submit">پرداخت موفق</button>
    </form>
    <form method="POST" action="/api/v1/payments/sandbox/callback">
      <input type="hidden" name="token" value="${payment.callback_token}">
      <input type="hidden" name="outcome" value="fail">
      <input type="hidden" name="signature" value="${sign('fail')}">
      <button class="fail" type="submit">پرداخت ناموفق</button>
    </form>
    <form method="POST" action="/api/v1/payments/sandbox/callback">
      <input type="hidden" name="token" value="${payment.callback_token}">
      <input type="hidden" name="outcome" value="expired">
      <input type="hidden" name="signature" value="${sign('expired')}">
      <button class="exp" type="submit">نتیجهٔ نامعلوم / انقضا</button>
    </form>
    <p class="muted">توجه: در محیط واقعی، تأیید پرداخت با روش ارائه‌دهندهٔ درگاه و بدون دخالت مرورگر انجام می‌شود.</p>
  </div>
</body>
</html>`;
}

/**
 * Idempotent callback: a replayed callback never double-fulfills an order/request.
 */
function sandboxCallback(body) {
  const data = validate(body)
    .string('token', { min: 10, max: 200 })
    .string('outcome', { enum: ['success', 'fail', 'expired'] })
    .string('signature', { min: 32, max: 128 })
    .done();
  const expected = signCallback(data.token, data.outcome);
  const a = Buffer.from(data.signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw ApiError.forbidden('امضای callback معتبر نیست.');
  }

  return tx(() => {
    const payment = get('SELECT * FROM payments WHERE callback_token = ?', [data.token]);
    if (!payment) throw ApiError.notFound('پرداخت یافت نشد.');

    // Idempotency: record the event; if this exact event was already processed, return current state.
    const payloadHash = hashBody(data);
    let replay = false;
    try {
      run('INSERT INTO payment_events (id, payment_id, event, payload_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [uuid(), payment.id, `callback:${data.outcome}`, payloadHash, nowIso()]);
    } catch {
      replay = true;
    }

    const now = nowIso();
    if (!replay) {
      if (data.outcome === 'success') {
        if (payment.status === 'pending') {
          run("UPDATE payments SET status = 'paid', gateway_ref = ?, paid_at = ?, updated_at = ? WHERE id = ?",
            [`SBX-${Date.now()}`, now, now, payment.id]);
          if (payment.order_id) {
            const order = get('SELECT * FROM orders WHERE id = ?', [payment.order_id]);
            if (order && order.status === 'pending_payment') {
              run("UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ?", [now, order.id]);
              run('INSERT INTO order_status_history (id, order_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
                [uuid(), order.id, 'pending_payment', 'paid', 'system', 'پرداخت موفق', now]);
              notify(order.user_id, 'payment_success', 'پرداخت تأیید شد', `سفارش ${order.code} پرداخت شد.`, `/orders/${order.code}`);
            }
          }
          if (payment.service_request_id) {
            const reqRow = get('SELECT * FROM service_requests WHERE id = ?', [payment.service_request_id]);
            if (reqRow && reqRow.status === 'submitted') {
              run("UPDATE service_requests SET status = 'queued', updated_at = ? WHERE id = ?", [now, reqRow.id]);
              run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
                [uuid(), reqRow.id, 'submitted', 'queued', 'system', 'پرداخت موفق — ورود به صف', now]);
              notify(reqRow.user_id, 'service_paid', 'پرداخت درخواست تأیید شد', `درخواست ${reqRow.code} وارد صف انجام شد.`, `/service-requests/${reqRow.code}`);
            }
          }
          lthService.handlePaymentOutcomeInTx(payment.id, 'success', now);
        }
      } else if (data.outcome === 'fail') {
        if (payment.status === 'pending') {
          run("UPDATE payments SET status = 'failed', failure_reason = 'user_abort', updated_at = ? WHERE id = ?", [now, payment.id]);
          lthService.handlePaymentOutcomeInTx(payment.id, 'fail', now);
        }
      } else if (data.outcome === 'expired') {
        if (payment.status === 'pending') {
          run("UPDATE payments SET status = 'expired', failure_reason = 'expired_or_unknown', updated_at = ? WHERE id = ?", [now, payment.id]);
          // An expired payment releases any stock reservation held for the pending order.
          if (payment.order_id) {
            let holds = [];
            try {
              holds = all("SELECT * FROM stock_holds WHERE order_id = ? AND status = 'held'", [payment.order_id]);
            } catch { holds = []; }
            if (holds.length > 0) {
              for (const h of holds) {
                run('UPDATE skus SET stock = stock + ?, updated_at = ? WHERE id = ?', [h.quantity, now, h.sku_id]);
                run('INSERT INTO stock_movements (id, sku_id, delta, reason, ref_type, ref_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
                  [crypto.randomUUID(), h.sku_id, h.quantity, 'hold_expired', 'order', payment.order_id, now]);
                run("UPDATE stock_holds SET status = 'released' WHERE id = ?", [h.id]);
              }
            }
          }
          lthService.handlePaymentOutcomeInTx(payment.id, 'expired', now);
        }
      }
      audit(null, 'system', 'payment.callback', 'payment', payment.id, { outcome: data.outcome, replay: false });
    }

    const updated = get('SELECT * FROM payments WHERE id = ?', [payment.id]);
    return { payment: paymentToJson(updated), replay };
  });
}

function refundPayment(user, id, input) {
  const data = validate(input)
    .string('reason', { min: 3, max: 300 })
    .string('reference', { min: 3, max: 100 })
    .int('amount_toman', { required: false, min: 1, default: null })
    .done();
  return tx(() => {
    const payment = get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!payment) throw ApiError.notFound('پرداخت یافت نشد.');
    if (payment.status !== 'paid') {
      throw ApiError.invalidState('فقط پرداخت موفق قابل استرداد است.');
    }
    const refundedSoFar = get('SELECT COALESCE(SUM(amount_toman), 0) AS s FROM refunds WHERE payment_id = ? AND status = ?', [id, 'done']).s;
    const amount = data.amount_toman || (payment.amount_toman - refundedSoFar);
    if (amount > payment.amount_toman - refundedSoFar) {
      throw ApiError.validation('مبلغ استرداد بیش از مبلغ پرداخت است.', [{ field: 'amount_toman', message: 'بیش از مانده است.' }]);
    }
    const now = nowIso();
    run('INSERT INTO refunds (id, payment_id, amount_toman, reason, reference, status, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), id, amount, data.reason, data.reference, 'done', user.id, now]);
    const newRefunded = refundedSoFar + amount;
    if (newRefunded >= payment.amount_toman) {
      run("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?", [now, id]);
    }
    audit(user.id, user.role, 'payment.refund', 'payment', id, { amount, reason: data.reason, reference: data.reference });
    return { payment: paymentToJson(get('SELECT * FROM payments WHERE id = ?', [id])), refunded_toman: amount };
  });
}

function listPayments(user, query) {
  const { page, limit, offset } = parsePagination(query);
  if (!['admin', 'finance'].includes(user.role)) throw ApiError.forbidden();
  const where = [];
  const params = [];
  if (query.status) { where.push('status = ?'); params.push(query.status); }
  if (query.from) { where.push('created_at >= ?'); params.push(query.from); }
  if (query.to) { where.push('created_at <= ?'); params.push(query.to); }
  const whereSql = where.length ? where.join(' AND ') : '1 = 1';
  const items = all(`SELECT * FROM payments WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = get(`SELECT COUNT(*) AS c FROM payments WHERE ${whereSql}`, params).c;
  return { items: items.map(paymentToJson), page, limit, total };
}

module.exports = { createPayment, getPaymentFor, paymentToJson, gatewayHtml, sandboxCallback, refundPayment, listPayments, signCallback };
