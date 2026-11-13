'use strict';

const crypto = require('crypto');
const { all, get, run, tx } = require('../../db');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, humanCode, parsePagination, parseJsonObject, validate, hashBody } = require('../../utils/validate');
const { shippingConfig, notify, audit } = require('../platform/service');

const ORDER_STATUS = ['pending_payment', 'paid', 'preparing', 'shipped', 'completed', 'canceled', 'return_in_progress', 'returned'];

// role -> allowed transitions (validated server-side)
const TRANSITIONS = {
  pending_payment: { paid: ['system'], canceled: ['customer', 'admin', 'support', 'finance'] },
  paid: { preparing: ['warehouse', 'admin'], canceled: ['admin', 'support', 'finance', 'customer'] },
  preparing: { shipped: ['warehouse', 'admin'], canceled: ['admin', 'finance'] },
  shipped: { completed: ['customer', 'warehouse', 'admin'], return_in_progress: ['admin', 'support'] },
  completed: { return_in_progress: ['admin', 'support', 'finance'] },
  return_in_progress: { returned: ['admin', 'finance', 'warehouse'] },
  canceled: {},
  returned: {}
};

function orderToJson(row, items, history) {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    status_label: STATUS_LABEL[row.status] || row.status,
    subtotal_toman: row.subtotal_toman,
    shipping_toman: row.shipping_toman,
    discount_toman: row.discount_toman,
    total_toman: row.total_toman,
    address: parseJsonObject(row.address_snapshot),
    shipping_method: row.shipping_method,
    tracking_code: ['shipped', 'completed', 'return_in_progress', 'returned'].includes(row.status) ? row.tracking_code : null,
    cancel_reason: row.cancel_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: items || [],
    history: history || []
  };
}

const STATUS_LABEL = {
  pending_payment: 'در انتظار پرداخت',
  paid: 'پرداخت‌شده',
  preparing: 'در حال آماده‌سازی',
  shipped: 'ارسال‌شده',
  completed: 'تکمیل‌شده',
  canceled: 'لغوشده',
  return_in_progress: 'مرجوعی در جریان',
  returned: 'مستردشده'
};

function itemsOf(orderId) {
  return all('SELECT * FROM order_items WHERE order_id = ?', [orderId]).map((it) => ({
    id: it.id,
    sku_id: it.sku_id,
    product_name: it.product_name,
    sku_code: it.sku_code,
    variant_attrs: parseJsonObject(it.variant_attrs),
    unit_price_toman: it.unit_price_toman,
    quantity: it.quantity,
    line_total_toman: it.line_total_toman
  }));
}

function historyOf(orderId) {
  return all(
    `SELECT h.*, u.full_name AS actor_name FROM order_status_history h
       LEFT JOIN users u ON u.id = h.actor_id
      WHERE h.order_id = ? ORDER BY h.created_at`,
    [orderId]
  ).map((h) => ({
    from_status: h.from_status, to_status: h.to_status,
    actor_role: h.actor_role, actor_name: h.actor_name,
    reason: h.reason, created_at: h.created_at
  }));
}

function orderByCodeFor(code, user) {
  const order = get('SELECT * FROM orders WHERE code = ?', [code]);
  if (!order) throw ApiError.notFound('سفارش یافت نشد.');
  const isOwner = order.user_id === user.id;
  const isStaff = ['admin', 'finance', 'warehouse', 'support'].includes(user.role);
  if (!isOwner && !isStaff) throw ApiError.forbidden('شما به این سفارش دسترسی ندارید.');
  return { order, isOwner };
}

/**
 * Create order from server-side cart. Idempotent via Idempotency-Key.
 * Stock is decremented atomically inside one transaction.
 */
function createOrder(user, input, idempotencyKey) {
  const data = validate(input)
    .string('address_id', { min: 1, max: 64 })
    .string('shipping_method', { enum: ['post', 'courier'], default: 'post' })
    .string('note', { required: false, max: 500, default: '' })
    .done();

  const requestHash = hashBody({ ...data, idempotencyKey });

  return tx(() => {
    if (idempotencyKey) {
      const prev = get(
        'SELECT request_hash, response_json, status_code FROM idempotency_keys WHERE key = ? AND user_id = ? AND endpoint = ?',
        [idempotencyKey, user.id, 'POST /orders']
      );
      if (prev) {
        if (prev.request_hash !== requestHash) {
          throw new ApiError(409, 'IDEMPOTENCY_MISMATCH', 'این کلید تکرارپذیری قبلاً با درخواست متفاوتی استفاده شده است.');
        }
        const parsed = JSON.parse(prev.response_json);
        return { ...parsed, idempotent_replay: true };
      }
    }

    const address = get('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?', [data.address_id, user.id]);
    if (!address) throw ApiError.validation('نشانی ارسال معتبر نیست.', [{ field: 'address_id', message: 'نشانی یافت نشد.' }]);

    const cart = get('SELECT * FROM carts WHERE user_id = ?', [user.id]);
    const lines = cart
      ? all(
        `SELECT ci.quantity, s.*, p.name AS product_name, p.status AS product_status, p.deleted_at
           FROM cart_items ci JOIN skus s ON s.id = ci.sku_id JOIN products p ON p.id = s.product_id
          WHERE ci.cart_id = ?`,
        [cart.id]
      )
      : [];
    if (!lines.length) throw ApiError.validation('سبد خرید خالی است.');

    const problems = [];
    let subtotal = 0;
    for (const line of lines) {
      if (line.deleted_at || line.product_status !== 'active' || !line.is_active) {
        problems.push({ field: line.code, message: 'این کالا دیگر قابل خرید نیست.' });
      } else if (line.quantity > line.stock) {
        problems.push({ field: line.code, message: `موجودی کافی نیست (موجودی: ${line.stock}).` });
      }
      subtotal += line.price_toman * line.quantity;
    }
    if (problems.length) throw ApiError.outOfStock('برخی اقلام سبد موجودی کافی ندارند.', problems);

    const shipCfg = shippingConfig();
    const shipping = subtotal >= shipCfg.freeOverToman ? 0 : shipCfg.flatToman;
    const total = subtotal + shipping;

    const orderId = uuid();
    const code = humanCode('CM');
    const now = nowIso();
    run(
      `INSERT INTO orders (id, code, user_id, status, subtotal_toman, shipping_toman, discount_toman, total_toman,
         address_snapshot, address_id, shipping_method, tracking_code, idempotency_key, cancel_reason, created_at, updated_at)
       VALUES (?, ?, ?, 'pending_payment', ?, ?, 0, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
      [orderId, code, user.id, subtotal, shipping, total,
        JSON.stringify({
          id: address.id, title: address.title, province: address.province, city: address.city,
          address_line: address.address_line, postal_code: address.postal_code,
          recipient_name: address.recipient_name, recipient_phone: address.recipient_phone,
          recipient_email: address.recipient_email || null
        }),
        address.id,
        data.shipping_method, idempotencyKey || null, now, now]
    );

    for (const line of lines) {
      // Atomic stock decrement: never sell beyond available stock, even under concurrency.
      const res = run(
        'UPDATE skus SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?',
        [line.quantity, now, line.id, line.quantity]
      );
      if (res.changes !== 1) {
        throw ApiError.outOfStock('موجودی کالا تغییر کرد؛ دوباره تلاش کنید.', [{ field: line.code, message: 'موجودی ناکافی.' }]);
      }
      run(
        `INSERT INTO order_items (id, order_id, sku_id, product_name, sku_code, variant_attrs, unit_price_toman, unit_cost_toman, quantity, line_total_toman)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), orderId, line.id, line.product_name, line.code, line.variant_attrs,
          line.price_toman, line.cost_price_toman, line.quantity, line.price_toman * line.quantity]
      );
      run(
        'INSERT INTO stock_movements (id, sku_id, delta, reason, ref_type, ref_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), line.id, -line.quantity, 'order', 'order', orderId, user.id, now]
      );
    }

    run('INSERT INTO order_status_history (id, order_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
      [uuid(), orderId, 'pending_payment', user.id, user.role, 'ثبت سفارش', now]);

    run('DELETE FROM cart_items WHERE cart_id = ?', [cart.id]);

    // Auto-create the pending payment record (sandbox gateway).
    const paymentId = uuid();
    run(
      `INSERT INTO payments (id, order_id, service_request_id, amount_toman, status, gateway, gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'pending', 'sandbox', NULL, ?, NULL, NULL, ?, ?)`,
      [paymentId, orderId, total, crypto.randomBytes(24).toString('hex'), now, now]
    );

    const payload = {
      order: orderToJson(
        get('SELECT * FROM orders WHERE id = ?', [orderId]),
        itemsOf(orderId),
        historyOf(orderId)
      ),
      payment: { id: paymentId, amount_toman: total, status: 'pending', pay_url: `/api/v1/payments/${paymentId}/gateway` }
    };

    if (idempotencyKey) {
      run(
        'INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response_json, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [idempotencyKey, user.id, 'POST /orders', requestHash, JSON.stringify(payload), 201, now]
      );
    }
    return payload;
  });
}

function listOrders(user, query) {
  const { page, limit, offset } = parsePagination(query);
  const isStaff = ['admin', 'finance', 'warehouse', 'support'].includes(user.role) && query.all === '1';
  const where = isStaff ? '1 = 1' : 'user_id = ?';
  const params = isStaff ? [] : [user.id];
  if (query.status) {
    if (!ORDER_STATUS.includes(query.status)) throw ApiError.validation('وضعیت نامعتبر است.');
    params.push(query.status);
  }
  const statusSql = query.status ? ` AND status = ?` : '';
  const items = all(
    `SELECT * FROM orders WHERE ${where}${statusSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = get(`SELECT COUNT(*) AS c FROM orders WHERE ${where}${statusSql}`, params).c;
  return {
    items: items.map((o) => ({
      code: o.code, status: o.status, status_label: STATUS_LABEL[o.status],
      total_toman: o.total_toman, tracking_code: ['shipped', 'completed'].includes(o.status) ? o.tracking_code : null,
      created_at: o.created_at, item_count: get('SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?', [o.id]).c
    })),
    page, limit, total
  };
}

function getOrder(user, code) {
  const { order } = orderByCodeFor(code, user);
  return orderToJson(order, itemsOf(order.id), historyOf(order.id));
}

function cancelOrder(user, code, input) {
  const data = validate(input).string('reason', { min: 3, max: 300 }).done();
  return tx(() => {
    const { order, isOwner } = orderByCodeFor(code, user);
    const allowed = TRANSITIONS[order.status] && TRANSITIONS[order.status].canceled;
    if (!allowed) {
      throw ApiError.invalidState(`سفارش در وضعیت «${STATUS_LABEL[order.status]}» قابل لغو نیست.`);
    }
    if (isOwner && !allowed.includes('customer')) {
      throw ApiError.forbidden('لغو این سفارش فقط توسط پشتیبانی/مدیریت انجام می‌شود.');
    }

    const now = nowIso();
    // Restore stock exactly once (order-scoped movement acts as the guard).
    const alreadyRestored = get(
      "SELECT 1 AS x FROM stock_movements WHERE ref_type = 'order' AND ref_id = ? AND reason = 'order_cancel'",
      [order.id]
    );
    if (!alreadyRestored) {
      const items = all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      for (const it of items) {
        run('UPDATE skus SET stock = stock + ?, updated_at = ? WHERE id = ?', [it.quantity, now, it.sku_id]);
        run('INSERT INTO stock_movements (id, sku_id, delta, reason, ref_type, ref_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid(), it.sku_id, it.quantity, 'order_cancel', 'order', order.id, user.id, now]);
      }
    }

    run('UPDATE orders SET status = ?, cancel_reason = ?, updated_at = ? WHERE id = ?',
      ['canceled', data.reason, now, order.id]);
    run('INSERT INTO order_status_history (id, order_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), order.id, order.status, 'canceled', user.id, user.role, data.reason, now]);

    // If already paid, create the refund record (sandbox) exactly once.
    const payment = get("SELECT * FROM payments WHERE order_id = ? AND status = 'paid'", [order.id]);
    if (payment) {
      run("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?", [now, payment.id]);
      run('INSERT INTO refunds (id, payment_id, amount_toman, reason, reference, status, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), payment.id, payment.amount_toman, `لغو سفارش ${order.code}: ${data.reason}`, `ORDER-CANCEL-${order.code}`, 'done', user.id, now]);
    }

    if (isOwner) {
      notify(order.user_id, 'order_canceled', 'سفارش لغو شد', `سفارش ${order.code} لغو شد.`, `/orders/${order.code}`);
    } else {
      notify(order.user_id, 'order_canceled', 'سفارش شما لغو شد', `سفارش ${order.code} توسط پشتیبانی لغو شد.`, `/orders/${order.code}`);
    }
    audit(user.id, user.role, 'order.cancel', 'order', order.id, { reason: data.reason });

    return orderToJson(get('SELECT * FROM orders WHERE id = ?', [order.id]), itemsOf(order.id), historyOf(order.id));
  });
}

function changeStatus(user, code, input) {
  const data = validate(input)
    .string('to_status', { enum: ORDER_STATUS })
    .string('reason', { required: false, max: 300, default: '' })
    .string('tracking_code', { required: false, max: 60, default: '' })
    .done();
  return tx(() => {
    const { order } = orderByCodeFor(code, user);
    const allowed = (TRANSITIONS[order.status] || {})[data.to_status];
    if (!allowed) {
      throw ApiError.invalidState(`تغییر وضعیت از «${STATUS_LABEL[order.status]}» به «${STATUS_LABEL[data.to_status]}» مجاز نیست.`);
    }
    if (!allowed.includes(user.role) && !(user.role === 'admin')) {
      throw ApiError.forbidden('شما مجوز این تغییر وضعیت را ندارید.');
    }
    if (data.to_status === 'shipped' && !data.tracking_code) {
      throw ApiError.validation('شمارهٔ رهگیری برای ارسال الزامی است.', [{ field: 'tracking_code', message: 'الزامی است.' }]);
    }
    if (data.to_status === 'return_in_progress' && !data.reason) {
      throw ApiError.validation('علت مرجوعی الزامی است.', [{ field: 'reason', message: 'الزامی است.' }]);
    }
    const now = nowIso();
    run('UPDATE orders SET status = ?, tracking_code = COALESCE(?, tracking_code), updated_at = ? WHERE id = ?',
      [data.to_status, data.tracking_code || null, now, order.id]);
    run('INSERT INTO order_status_history (id, order_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), order.id, order.status, data.to_status, user.id, user.role, data.reason || null, now]);

    if (data.to_status === 'returned') {
      const alreadyRestored = get(
        "SELECT 1 AS x FROM stock_movements WHERE ref_type = 'order' AND ref_id = ? AND reason = 'order_return'",
        [order.id]
      );
      if (!alreadyRestored) {
        const items = all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
        for (const it of items) {
          run('UPDATE skus SET stock = stock + ?, updated_at = ? WHERE id = ?', [it.quantity, now, it.sku_id]);
          run('INSERT INTO stock_movements (id, sku_id, delta, reason, ref_type, ref_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [uuid(), it.sku_id, it.quantity, 'order_return', 'order', order.id, user.id, now]);
        }
        const payment = get("SELECT * FROM payments WHERE order_id = ? AND status = 'paid'", [order.id]);
        if (payment) {
          run("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?", [now, payment.id]);
          run('INSERT INTO refunds (id, payment_id, amount_toman, reason, reference, status, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [uuid(), payment.id, payment.amount_toman, `مرجوعی سفارش ${order.code}`, `ORDER-RETURN-${order.code}`, 'done', user.id, now]);
        }
      }
    }

    const notifyStatus = {
      paid: ['پرداخت سفارش تأیید شد', 'سفارش شما در صف آماده‌سازی قرار گرفت.'],
      preparing: ['سفارش در حال آماده‌سازی است', ''],
      shipped: ['سفارش شما ارسال شد', data.tracking_code ? `شمارهٔ رهگیری: ${data.tracking_code}` : ''],
      completed: ['سفارش تکمیل شد', 'از خرید شما سپاسگزاریم.'],
      returned: ['مرجوعی انجام شد', 'مبلغ سفارش مسترد شد.']
    };
    if (notifyStatus[data.to_status]) {
      notify(order.user_id, 'order_status', notifyStatus[data.to_status][0], notifyStatus[data.to_status][1], `/orders/${order.code}`);
    }
    audit(user.id, user.role, 'order.status_change', 'order', order.id, { from: order.status, to: data.to_status, reason: data.reason });
    return orderToJson(get('SELECT * FROM orders WHERE id = ?', [order.id]), itemsOf(order.id), historyOf(order.id));
  });
}

function receipt(user, code) {
  const { order } = orderByCodeFor(code, user);
  const payment = get('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', [order.id]);
  return {
    order_code: order.code,
    status: order.status,
    status_label: STATUS_LABEL[order.status],
    paid_at: payment ? payment.paid_at : null,
    payment_status: payment ? payment.status : 'none',
    total_toman: order.total_toman,
    subtotal_toman: order.subtotal_toman,
    shipping_toman: order.shipping_toman,
    items: itemsOf(order.id),
    address: parseJsonObject(order.address_snapshot),
    generated_at: nowIso()
  };
}

module.exports = {
  ORDER_STATUS, STATUS_LABEL, TRANSITIONS,
  createOrder, listOrders, getOrder, cancelOrder, changeStatus, receipt, orderByCodeFor
};
