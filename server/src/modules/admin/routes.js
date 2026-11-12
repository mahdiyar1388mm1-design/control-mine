'use strict';

const express = require('express');
const { all, get, run, tx } = require('../../db');
const { requireAuth, requireRole, requireStaff } = require('../../middleware/auth');
const { ApiError } = require('../../utils/errors');
const { nowIso, validate, parsePagination } = require('../../utils/validate');
const { verifyPassword } = require('../../utils/password');
const { getSetting, setSetting, shippingConfig, notify, audit, listAudit, maskPhone } = require('../platform/service');

const router = express.Router();
router.use('/staff', requireAuth);
router.use('/admin', requireAuth);

const ALL_ROLES = ['customer', 'operator', 'support', 'warehouse', 'finance', 'admin'];

function parseDateRange(query) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
  const from = query.from ? new Date(query.from).toISOString() : defaultFrom;
  const to = query.to ? new Date(query.to).toISOString() : now.toISOString();
  if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
    throw ApiError.validation('بازهٔ زمانی نامعتبر است.');
  }
  return { from, to };
}

// ---------- staff operational helpers ----------

router.get('/staff/directory', requireStaff, (req, res) => {
  const roleFilter = req.query.role;
  const where = ["status = 'active'", "role != 'customer'"];
  const params = [];
  if (roleFilter && ALL_ROLES.includes(roleFilter)) {
    where.push('role = ?');
    params.push(roleFilter);
  }
  const items = all(
    `SELECT id, full_name, role FROM users WHERE ${where.join(' AND ')} ORDER BY full_name`,
    params
  );
  res.json({ items });
});

router.get('/staff/overview', requireStaff, (req, res) => {
  const role = req.user.role;
  const now = nowIso();
  const soon24h = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const out = { role, generated_at: now, queues: {} };

  if (['operator', 'admin'].includes(role)) {
    out.queues.services = {
      queued_unassigned: get("SELECT COUNT(*) AS c FROM service_requests WHERE status = 'queued' AND assigned_to IS NULL").c,
      my_active: get("SELECT COUNT(*) AS c FROM service_requests WHERE assigned_to = ? AND status IN ('assigned','in_progress')", [req.user.id]).c,
      waiting_customer: get("SELECT COUNT(*) AS c FROM service_requests WHERE status = 'waiting_customer'").c,
      sla_breached: get("SELECT COUNT(*) AS c FROM service_requests WHERE status NOT IN ('completed','canceled','rejected','failed','refunded') AND due_at < ?", [now]).c,
      sla_at_risk_24h: get("SELECT COUNT(*) AS c FROM service_requests WHERE status NOT IN ('completed','canceled','rejected','failed','refunded') AND due_at >= ? AND due_at < ?", [now, soon24h]).c
    };
  }
  if (['support', 'admin'].includes(role)) {
    out.queues.tickets = {
      new_tickets: get("SELECT COUNT(*) AS c FROM tickets WHERE status = 'new'").c,
      open_tickets: get("SELECT COUNT(*) AS c FROM tickets WHERE status = 'open'").c,
      waiting_team: get("SELECT COUNT(*) AS c FROM tickets WHERE status = 'waiting_team'").c,
      waiting_customer: get("SELECT COUNT(*) AS c FROM tickets WHERE status = 'waiting_customer'").c
    };
  }
  if (['warehouse', 'admin'].includes(role)) {
    out.queues.warehouse = {
      paid_ready_to_prepare: get("SELECT COUNT(*) AS c FROM orders WHERE status = 'paid'").c,
      preparing: get("SELECT COUNT(*) AS c FROM orders WHERE status = 'preparing'").c,
      returns_in_progress: get("SELECT COUNT(*) AS c FROM orders WHERE status = 'return_in_progress'").c,
      low_stock_skus: get('SELECT COUNT(*) AS c FROM skus s JOIN products p ON p.id = s.product_id WHERE p.deleted_at IS NULL AND s.stock <= 5').c
    };
  }
  if (['finance', 'admin'].includes(role)) {
    out.queues.finance = {
      pending_payments: get("SELECT COUNT(*) AS c FROM payments WHERE status = 'pending'").c,
      failed_or_expired_payments: get("SELECT COUNT(*) AS c FROM payments WHERE status IN ('failed','expired')").c,
      paid_payments: get("SELECT COUNT(*) AS c FROM payments WHERE status = 'paid'").c,
      refunded_payments: get("SELECT COUNT(*) AS c FROM payments WHERE status = 'refunded'").c,
      pending_lth_withdrawals: get("SELECT COUNT(*) AS c FROM lth_sheba_withdrawals WHERE status = 'pending'").c
    };
  }
  res.json(out);
});

// ---------- admin user & role management ----------

router.get('/admin/users', requireRole('admin'), (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = ['1 = 1'];
    const params = [];
    if (req.query.role && ALL_ROLES.includes(req.query.role)) {
      where.push('role = ?');
      params.push(req.query.role);
    }
    if (req.query.status && ['active', 'suspended'].includes(req.query.status)) {
      where.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      where.push('(full_name LIKE ? OR phone LIKE ? OR username LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    }
    const revealPhone = req.query.reveal_phone === '1';
    if (revealPhone) {
      audit(req.user.id, req.user.role, 'admin.reveal_user_phones', 'user', null, { page });
    }
    const whereSql = where.join(' AND ');
    const rows = all(
      `SELECT id, phone, username, email, full_name, role, status, created_at, updated_at
         FROM users WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const total = get(`SELECT COUNT(*) AS c FROM users WHERE ${whereSql}`, params).c;
    res.json({
      items: rows.map((u) => ({
        id: u.id,
        phone: revealPhone ? u.phone : maskPhone(u.phone),
        username: u.username || null,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        status: u.status,
        created_at: u.created_at,
        updated_at: u.updated_at
      })),
      page, limit, total
    });
  } catch (err) { next(err); }
});

router.patch('/admin/users/:id', requireRole('admin'), (req, res, next) => {
  try {
    const data = validate(req.body)
      .string('role', { required: false, enum: ALL_ROLES })
      .string('status', { required: false, enum: ['active', 'suspended'] })
      .string('reason', { min: 3, max: 300 })
      .string('current_password', { min: 1, max: 128 })
      .done();

    const adminRow = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(data.current_password, adminRow.password_hash, adminRow.password_salt)) {
      throw ApiError.unauthorized('رمز عبور مدیر برای تأیید مجدد عملیات حساس نادرست است.');
    }

    const target = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!target) throw ApiError.notFound('کاربر یافت نشد.');
    if (target.id === req.user.id && (data.status === 'suspended' || (data.role && data.role !== 'admin'))) {
      throw ApiError.conflict('مدیر نمی‌تواند حساب یا نقش خودش را غیرفعال/تنزل دهد.');
    }

    const nextRole = data.role || target.role;
    const nextStatus = data.status || target.status;
    const now = nowIso();

    tx(() => {
      run('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?',
        [nextRole, nextStatus, now, target.id]);
      if (nextStatus === 'suspended' || nextRole !== target.role) {
        run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, target.id]);
      }
      if (nextRole !== target.role) {
        notify(target.id, 'role_changed', 'نقش حساب کاربری تغییر کرد', `نقش جدید: ${nextRole}`, '/account');
      }
      audit(req.user.id, req.user.role, 'user.admin_update', 'user', target.id, {
        from_role: target.role, to_role: nextRole,
        from_status: target.status, to_status: nextStatus,
        reason: data.reason
      });
    });

    const updated = get('SELECT id, phone, username, email, full_name, role, status, created_at, updated_at FROM users WHERE id = ?', [target.id]);
    res.json({ user: { ...updated, phone: maskPhone(updated.phone) } });
  } catch (err) { next(err); }
});

// ---------- admin settings ----------

router.get('/admin/settings', requireRole('admin', 'finance'), (req, res) => {
  res.json({
    settings: {
      store_name: getSetting('store_name', 'CENTRAL MINE'),
      currency_label: getSetting('currency_label', 'تومان'),
      ...shippingConfig()
    }
  });
});

router.patch('/admin/settings', requireRole('admin'), (req, res, next) => {
  try {
    const data = validate(req.body)
      .string('store_name', { required: false, min: 2, max: 80 })
      .int('shipping_flat_toman', { required: false, min: 0, max: 10000000 })
      .int('shipping_free_over_toman', { required: false, min: 0, max: 1000000000 })
      .string('reason', { min: 3, max: 300 })
      .done();
    tx(() => {
      if (data.store_name !== undefined) setSetting('store_name', data.store_name);
      if (data.shipping_flat_toman !== undefined) setSetting('shipping_flat_toman', data.shipping_flat_toman);
      if (data.shipping_free_over_toman !== undefined) setSetting('shipping_free_over_toman', data.shipping_free_over_toman);
      audit(req.user.id, req.user.role, 'settings.update', 'settings', 'global', data);
    });
    res.json({
      settings: {
        store_name: getSetting('store_name', 'CENTRAL MINE'),
        currency_label: getSetting('currency_label', 'تومان'),
        ...shippingConfig()
      }
    });
  } catch (err) { next(err); }
});

// ---------- reports (§17: clear source, unit, timeframe, permissions, historical cost, masked PII) ----------

router.get('/admin/reports/sales', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);
    const fulfilledStatuses = ['paid', 'preparing', 'shipped', 'completed'];
    const placeholders = fulfilledStatuses.map(() => '?').join(',');

    const summary = get(
      `SELECT COUNT(*) AS order_count,
              COALESCE(SUM(subtotal_toman), 0) AS gross_goods_toman,
              COALESCE(SUM(shipping_toman), 0) AS shipping_collected_toman,
              COALESCE(SUM(discount_toman), 0) AS discount_toman,
              COALESCE(SUM(total_toman), 0) AS net_order_total_toman
         FROM orders
        WHERE status IN (${placeholders}) AND created_at >= ? AND created_at <= ?`,
      [...fulfilledStatuses, from, to]
    );

    // Profit strictly uses order_items.unit_cost_toman captured AT THE TIME OF SALE, never current SKU cost.
    const costAndProfit = get(
      `SELECT COALESCE(SUM(oi.unit_cost_toman * oi.quantity), 0) AS historical_cogs_toman,
              COALESCE(SUM((oi.unit_price_toman - oi.unit_cost_toman) * oi.quantity), 0) AS gross_profit_toman,
              COALESCE(SUM(oi.quantity), 0) AS units_sold
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status IN (${placeholders}) AND o.created_at >= ? AND o.created_at <= ?`,
      [...fulfilledStatuses, from, to]
    );

    const byStatus = all(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_toman), 0) AS total_toman
         FROM orders WHERE created_at >= ? AND created_at <= ?
        GROUP BY status`,
      [from, to]
    );

    const recentOrders = all(
      `SELECT o.code, o.status, o.subtotal_toman, o.shipping_toman, o.total_toman, o.created_at,
              u.full_name AS customer_name, u.phone AS customer_phone
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE o.created_at >= ? AND o.created_at <= ?
        ORDER BY o.created_at DESC LIMIT 50`,
      [from, to]
    ).map((r) => ({
      code: r.code,
      status: r.status,
      subtotal_toman: r.subtotal_toman,
      shipping_toman: r.shipping_toman,
      total_toman: r.total_toman,
      customer_name: r.customer_name,
      customer_phone: maskPhone(r.customer_phone),
      created_at: r.created_at
    }));

    res.json({
      meta: {
        report: 'sales',
        title: 'گزارش فروش کالاهای فیزیکی',
        source: 'جداول orders و order_items (فقط سفارش‌های کالای فیزیکی با وضعیت پرداخت‌شده/در حال ارسال/تکمیل‌شده)',
        unit: 'تومان',
        from,
        to,
        generated_at: nowIso(),
        permission: 'admin, finance',
        distinction_note: 'این گزارش صرفاً شامل فروش کالا است و درآمد خدمات، تیکت‌ها، پرداخت‌های در انتظار یا استردادهای مرجوعی در آن مخلوط نشده است. سود ناخالص بر پایهٔ قیمت خرید ثبت‌شده در لحظهٔ ثبت سفارش (unit_cost_toman) محاسبه شده، نه قیمت خرید جاری کالا.'
      },
      kpis: {
        fulfilled_order_count: summary.order_count,
        units_sold: costAndProfit.units_sold,
        gross_goods_toman: summary.gross_goods_toman,
        shipping_collected_toman: summary.shipping_collected_toman,
        discount_toman: summary.discount_toman,
        net_order_total_toman: summary.net_order_total_toman,
        historical_cogs_toman: costAndProfit.historical_cogs_toman,
        gross_profit_toman: costAndProfit.gross_profit_toman
      },
      by_status: byStatus,
      recent_orders: recentOrders
    });
  } catch (err) { next(err); }
});

router.get('/admin/reports/services', requireRole('admin', 'operator', 'finance'), (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);
    const now = nowIso();
    const byStatus = all(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(price_toman), 0) AS quoted_toman
         FROM service_requests WHERE created_at >= ? AND created_at <= ?
        GROUP BY status`,
      [from, to]
    );
    const completedPaid = get(
      `SELECT COUNT(*) AS completed_count,
              COALESCE(SUM(sr.price_toman), 0) AS completed_value_toman
         FROM service_requests sr
        WHERE sr.status = 'completed' AND sr.created_at >= ? AND sr.created_at <= ?`,
      [from, to]
    );
    const slaStats = get(
      `SELECT COUNT(*) AS open_breached
         FROM service_requests
        WHERE status NOT IN ('completed','canceled','rejected','failed','refunded')
          AND due_at < ?`,
      [now]
    );
    const byService = all(
      `SELECT s.name AS service_name, s.slug, COUNT(sr.id) AS request_count,
              SUM(CASE WHEN sr.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
              COALESCE(SUM(CASE WHEN sr.status = 'completed' THEN sr.price_toman ELSE 0 END), 0) AS completed_toman
         FROM services s
         LEFT JOIN service_requests sr ON sr.service_id = s.id AND sr.created_at >= ? AND sr.created_at <= ?
        GROUP BY s.id ORDER BY request_count DESC`,
      [from, to]
    );

    res.json({
      meta: {
        report: 'services',
        title: 'گزارش عملیاتی درخواست‌های خدمات',
        source: 'جدول service_requests (مستقل از سفارش‌های کالا و تیکت‌های پشتیبانی)',
        unit: 'تومان / تعداد پرونده',
        from,
        to,
        generated_at: now,
        permission: 'admin, operator, finance',
        distinction_note: 'این گزارش فقط پرونده‌های خدماتی را پوشش می‌دهد و فروش کالا یا تیکت‌های پشتیبانی در آن لحاظ نشده است.'
      },
      kpis: {
        completed_count: completedPaid.completed_count,
        completed_value_toman: completedPaid.completed_value_toman,
        open_sla_breached_count: slaStats.open_breached
      },
      by_status: byStatus,
      by_service: byService
    });
  } catch (err) { next(err); }
});

router.get('/admin/reports/tickets', requireRole('admin', 'support'), (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);
    const byStatus = all(
      'SELECT status, COUNT(*) AS count FROM tickets WHERE created_at >= ? AND created_at <= ? GROUP BY status',
      [from, to]
    );
    const byCategory = all(
      'SELECT category, COUNT(*) AS count FROM tickets WHERE created_at >= ? AND created_at <= ? GROUP BY category',
      [from, to]
    );
    const byPriority = all(
      'SELECT priority, COUNT(*) AS count FROM tickets WHERE created_at >= ? AND created_at <= ? GROUP BY priority',
      [from, to]
    );
    res.json({
      meta: {
        report: 'tickets',
        title: 'گزارش تیکت‌های پشتیبانی',
        source: 'جدول tickets (مستقل از درخواست‌های خدمات تجاری)',
        unit: 'تعداد تیکت',
        from,
        to,
        generated_at: nowIso(),
        permission: 'admin, support',
        distinction_note: 'تیکت‌های پشتیبانی برای پرسش و پیگیری مشکل هستند و با پرونده‌های خدمات تجاری ترکیب نمی‌شوند.'
      },
      by_status: byStatus,
      by_category: byCategory,
      by_priority: byPriority
    });
  } catch (err) { next(err); }
});

router.get('/admin/reports/payments', requireRole('admin', 'finance'), (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);
    const byStatus = all(
      `SELECT status,
              COUNT(*) AS count,
              COALESCE(SUM(amount_toman), 0) AS total_toman,
              SUM(CASE WHEN order_id IS NOT NULL THEN 1 ELSE 0 END) AS for_orders,
              SUM(CASE WHEN service_request_id IS NOT NULL THEN 1 ELSE 0 END) AS for_services
         FROM payments
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY status`,
      [from, to]
    );
    const refundSummary = get(
      `SELECT COUNT(*) AS refund_count, COALESCE(SUM(amount_toman), 0) AS refunded_toman
         FROM refunds WHERE created_at >= ? AND created_at <= ?`,
      [from, to]
    );
    const recentRefunds = all(
      `SELECT r.id, r.payment_id, r.amount_toman, r.reason, r.reference, r.status, r.created_at, u.full_name AS actor_name
         FROM refunds r LEFT JOIN users u ON u.id = r.actor_id
        WHERE r.created_at >= ? AND r.created_at <= ?
        ORDER BY r.created_at DESC LIMIT 50`,
      [from, to]
    );
    res.json({
      meta: {
        report: 'payments',
        title: 'گزارش تراکنش‌های پرداخت و استرداد (آزمایشی/Sandbox)',
        source: 'جداول payments و refunds (درگاه فعلی: Sandbox آزمایشی — تراکنش بانکی واقعی متصل نیست)',
        unit: 'تومان',
        from,
        to,
        generated_at: nowIso(),
        permission: 'admin, finance',
        distinction_note: 'تراکنش‌های موفق، ناموفق، منقضی و مستردشده جداگانه گزارش شده‌اند و تا زمان اتصال درگاه واقعی، همگی از نوع آزمایشی (sandbox) هستند.'
      },
      by_status: byStatus,
      refunds_summary: refundSummary,
      recent_refunds: recentRefunds
    });
  } catch (err) { next(err); }
});

router.get('/admin/audit', requireRole('admin'), (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { items, total } = listAudit({
      limit,
      offset,
      action: req.query.action,
      entity_type: req.query.entity_type
    });
    res.json({ items, page, limit, total });
  } catch (err) { next(err); }
});

module.exports = router;
