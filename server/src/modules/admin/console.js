'use strict';

/**
 * CENTRAL MINE — Admin Console API (v1)
 * A single, coherent surface for the new admin control center:
 *  - live overview KPIs
 *  - people directory (full phone + username + every filled form)
 *  - products & one-shot product creation
 *  - automatic rial treasury + LTH treasury
 *  - orders console
 *
 * Everything is permission-gated server-side (`admin` only) and every
 * sensitive read/write is written to the append-only audit log.
 */

const express = require('express');
const { all, get, run, tx } = require('../../db');
const { requireRole } = require('../../middleware/auth');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, validate, parsePagination } = require('../../utils/validate');
const { verifyPassword } = require('../../utils/password');
const { audit, getSetting, setSetting, verifyAuditChain } = require('../platform/service');
const { likeContains } = require('../../utils/dbGuards');
const authService = require('../auth/service');
const catalog = require('../catalog/service');
const lth = require('../lth/service');

const router = express.Router();
router.use(requireRole('admin'));

const ROLES = ['customer', 'operator', 'support', 'warehouse', 'finance', 'admin'];
const SOURCE_LABEL = {
  signup: 'ثبت‌نام',
  shipping_form: 'فرم ارسال و نشانی',
  order: 'سفارش کالا',
  service_form: 'فرم درخواست خدمت',
  support_ticket: 'تیکت پشتیبانی'
};

const ENTRY_LABEL = {
  product_sale: 'فروش کالا',
  service_sale: 'فروش خدمت',
  lth_sale: 'فروش LTH',
  refund: 'استرداد وجه',
  payout: 'تسویه / پرداخت',
  adjustment: 'اصلاح دستی',
  opening: 'موجودی افتتاحیه'
};

function todayStartIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeJson(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

function publicIdentity(row) {
  return {
    id: row.id,
    phone: row.phone,
    username: row.username || null,
    full_name: row.full_name,
    email: row.email || null,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

router.get('/overview', (req, res, next) => {
  try {
    const today = todayStartIso();
    const last7 = daysAgoIso(6);
    const last30 = daysAgoIso(30);

    const usersTotal = get('SELECT COUNT(*) AS c FROM users').c;
    const customers = get("SELECT COUNT(*) AS c FROM users WHERE role = 'customer'").c;
    const staff = get("SELECT COUNT(*) AS c FROM users WHERE role <> 'customer'").c;
    const newUsers7d = get('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', [last7]).c;
    const newUsersToday = get('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', [today]).c;

    const directory = get(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(has_shipping), 0) AS shipping,
              COALESCE(SUM(has_orders), 0) AS orders,
              COALESCE(SUM(has_services), 0) AS services,
              COALESCE(SUM(has_tickets), 0) AS tickets,
              COALESCE(SUM(CASE WHEN has_shipping = 1 OR has_orders = 1 OR has_services = 1 OR has_tickets = 1 THEN 1 ELSE 0 END), 0) AS filled_forms
         FROM people_directory`
    );

    const products = get(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
              COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft,
              COALESCE(SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END), 0) AS archived
         FROM products WHERE deleted_at IS NULL`
    );
    const skuStats = get(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN s.stock <= 5 THEN 1 ELSE 0 END), 0) AS low_stock,
              COALESCE(SUM(CASE WHEN s.stock = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock,
              COALESCE(SUM(s.stock * s.cost_price_toman), 0) AS inventory_cost_toman,
              COALESCE(SUM(s.stock * s.price_toman), 0) AS inventory_retail_toman
         FROM skus s JOIN products p ON p.id = s.product_id
        WHERE p.deleted_at IS NULL AND s.is_active = 1`
    );

    const orders = get(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'pending_payment' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN status IN ('paid','preparing','shipped') THEN 1 ELSE 0 END), 0) AS in_progress,
              COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
              COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS today
         FROM orders`,
      [today]
    );
    const revenue = get(
      `SELECT COALESCE(SUM(CASE WHEN paid_at >= ? THEN amount_toman ELSE 0 END), 0) AS today,
              COALESCE(SUM(CASE WHEN paid_at >= ? THEN amount_toman ELSE 0 END), 0) AS last7,
              COALESCE(SUM(CASE WHEN paid_at >= ? THEN amount_toman ELSE 0 END), 0) AS last30,
              COALESCE(SUM(amount_toman), 0) AS all_time
         FROM payments
        WHERE status = 'paid' OR paid_at IS NOT NULL`,
      [today, last7, last30]
    );

    const treasury = get(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_toman ELSE 0 END), 0) AS total_in,
              COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_toman ELSE 0 END), 0) AS total_out,
              COALESCE(SUM(CASE WHEN direction = 'in' AND created_at >= ? THEN amount_toman ELSE 0 END), 0) AS today_in,
              COALESCE(SUM(CASE WHEN direction = 'out' AND created_at >= ? THEN amount_toman ELSE 0 END), 0) AS today_out
         FROM treasury_cash_ledger`,
      [today, today]
    );
    const opening = num(getSetting('treasury_opening_balance_toman', 0));
    const pendingPayments = get("SELECT COUNT(*) AS c, COALESCE(SUM(amount_toman), 0) AS total FROM payments WHERE status = 'pending'");

    const openTickets = get("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('new','open','waiting_team','waiting_customer')").c;
    const pendingServices = get("SELECT COUNT(*) AS c FROM service_requests WHERE status IN ('submitted','queued','assigned','in_progress','waiting_customer')").c;

    const salesSeries = all(
      `SELECT substr(COALESCE(paid_at, created_at), 1, 10) AS day,
              COALESCE(SUM(amount_toman), 0) AS total_toman,
              COUNT(*) AS count
         FROM payments
        WHERE (status = 'paid' OR paid_at IS NOT NULL)
          AND COALESCE(paid_at, created_at) >= ?
        GROUP BY day ORDER BY day`,
      [daysAgoIso(13)]
    );
    const seriesMap = new Map(salesSeries.map((r) => [r.day, r]));
    const last14Days = [];
    for (let i = 13; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const row = seriesMap.get(day);
      last14Days.push({
        day,
        total_toman: row ? row.total_toman : 0,
        count: row ? row.count : 0
      });
    }

    const recentOrders = all(
      `SELECT o.code, o.status, o.total_toman, o.created_at,
              u.id AS user_id, u.full_name, u.phone, u.username,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
         FROM orders o JOIN users u ON u.id = o.user_id
        ORDER BY o.created_at DESC LIMIT 6`
    ).map((o) => ({
      ...o,
      source: 'order'
    }));

    const recentPeople = all(
      `SELECT pd.user_id, pd.full_name, pd.phone, pd.username, pd.last_source,
              pd.last_seen_at, u.role
         FROM people_directory pd JOIN users u ON u.id = pd.user_id
        ORDER BY pd.last_seen_at DESC LIMIT 6`
    );

    const lowStock = all(
      `SELECT s.id, s.code, s.stock, s.price_toman, p.name AS product_name, p.slug AS product_slug
         FROM skus s JOIN products p ON p.id = s.product_id
        WHERE p.deleted_at IS NULL AND s.is_active = 1 AND s.stock <= 5
        ORDER BY s.stock ASC, p.name ASC LIMIT 6`
    );

    const topProducts = all(
      `SELECT oi.product_name,
              SUM(oi.quantity) AS units,
              SUM(oi.line_total_toman) AS revenue_toman
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status IN ('paid','preparing','shipped','completed')
        GROUP BY oi.product_name
        ORDER BY revenue_toman DESC LIMIT 5`
    );

    let lthSummary = null;
    try {
      const view = lth.getTreasuryView();
      lthSummary = {
        title: view.title,
        symbol: view.symbol,
        total_supply_lth_headline: view.total_supply_lth_headline,
        asset_lth_headline: view.asset_lth_headline,
        market_lth_headline: view.market_lth_headline,
        conservation_ok: view.conservation_ok,
        collected_fee_lth_display_8: view.collected_fee_lth_display_8,
        returned_stake_lth_display_8: view.returned_stake_lth_display_8,
        returned_base_lth_display_8: view.returned_base_lth_display_8,
        updated_at: view.updated_at
      };
    } catch {
      lthSummary = null;
    }

    res.json({
      generated_at: nowIso(),
      kpis: {
        users_total: usersTotal,
        customers,
        staff,
        new_users_7d: newUsers7d,
        new_users_today: newUsersToday,
        directory: {
          total: directory.total,
          filled_forms: directory.filled_forms,
          with_shipping: directory.shipping,
          with_orders: directory.orders,
          with_services: directory.services,
          with_tickets: directory.tickets
        },
        products: {
          total: products.total,
          active: products.active,
          draft: products.draft,
          archived: products.archived,
          skus: skuStats.total,
          low_stock: skuStats.low_stock,
          out_of_stock: skuStats.out_of_stock,
          inventory_cost_toman: skuStats.inventory_cost_toman,
          inventory_retail_toman: skuStats.inventory_retail_toman
        },
        orders,
        revenue: {
          today_toman: revenue.today,
          last7_toman: revenue.last7,
          last30_toman: revenue.last30,
          all_time_toman: revenue.all_time,
          pending_payments: pendingPayments.c,
          pending_payments_toman: pendingPayments.total
        },
        treasury: {
          opening_toman: opening,
          total_in_toman: treasury.total_in,
          total_out_toman: treasury.total_out,
          balance_toman: opening + treasury.total_in - treasury.total_out,
          today_in_toman: treasury.today_in,
          today_out_toman: treasury.today_out,
          low_balance_toman: num(getSetting('treasury_low_balance_toman', 5000000))
        },
        operations: {
          open_tickets: openTickets,
          pending_services: pendingServices
        },
        lth: lthSummary
      },
      sales_last_14_days: last14Days,
      recent_orders: recentOrders,
      recent_people: recentPeople,
      low_stock_skus: lowStock,
      top_products: topProducts
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// People (users + everyone who filled any form anywhere)
// ---------------------------------------------------------------------------

function buildPeopleWhere(query) {
  const where = ['1 = 1'];
  const params = [];
  if (query.q) {
    const like = likeContains(String(query.q).trim().replace(/^@/, ''));
    where.push("(pd.full_name LIKE ? ESCAPE '\\' OR pd.phone LIKE ? ESCAPE '\\' OR pd.username LIKE ? ESCAPE '\\' OR COALESCE(pd.email, '') LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  if (query.role && ROLES.includes(query.role)) {
    where.push('u.role = ?');
    params.push(query.role);
  }
  if (query.status && ['active', 'suspended'].includes(query.status)) {
    where.push('u.status = ?');
    params.push(query.status);
  }
  const sourceColumn = {
    shipping: 'has_shipping',
    orders: 'has_orders',
    services: 'has_services',
    tickets: 'has_tickets',
    signup: 'has_signup'
  }[query.source];
  if (sourceColumn) {
    where.push(`pd.${sourceColumn} = 1`);
  }
  if (query.with_activity === '1') {
    where.push('(pd.has_shipping = 1 OR pd.has_orders = 1 OR pd.has_services = 1 OR pd.has_tickets = 1)');
  }
  return { whereSql: where.join(' AND '), params };
}

router.get('/people', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { whereSql, params } = buildPeopleWhere(req.query);
    const items = all(
      `SELECT pd.*, u.role, u.status, u.created_at,
              (SELECT COUNT(*) FROM user_addresses a WHERE a.user_id = pd.user_id) AS address_count_live,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = pd.user_id) AS order_count_live,
              (SELECT COUNT(*) FROM service_requests r WHERE r.user_id = pd.user_id) AS service_count_live,
              (SELECT COUNT(*) FROM tickets t WHERE t.user_id = pd.user_id) AS ticket_count_live,
              (SELECT COUNT(*) FROM lth_holdings h WHERE h.user_id = pd.user_id AND h.status = 'active') AS lth_holdings_live,
              (SELECT COALESCE(SUM(o.total_toman), 0) FROM orders o
                WHERE o.user_id = pd.user_id AND o.status IN ('paid','preparing','shipped','completed')) AS spent_toman
         FROM people_directory pd JOIN users u ON u.id = pd.user_id
        WHERE ${whereSql}
        ORDER BY pd.last_seen_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const total = get(
      `SELECT COUNT(*) AS c FROM people_directory pd JOIN users u ON u.id = pd.user_id WHERE ${whereSql}`,
      params
    ).c;

    const summary = get(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(has_shipping), 0) AS shipping,
              COALESCE(SUM(has_orders), 0) AS orders,
              COALESCE(SUM(has_services), 0) AS services,
              COALESCE(SUM(has_tickets), 0) AS tickets,
              COALESCE(SUM(CASE WHEN has_shipping = 1 OR has_orders = 1 OR has_services = 1 OR has_tickets = 1 THEN 1 ELSE 0 END), 0) AS active_people
         FROM people_directory`
    );

    res.json({
      items: items.map((p) => ({
        id: p.user_id,
        full_name: p.full_name,
        username: p.username,
        phone: p.phone,
        email: p.email,
        role: p.role,
        status: p.status,
        has_shipping: Boolean(p.has_shipping),
        has_orders: Boolean(p.has_orders),
        has_services: Boolean(p.has_services),
        has_tickets: Boolean(p.has_tickets),
        address_count: p.address_count_live,
        order_count: p.order_count_live,
        service_count: p.service_count_live,
        ticket_count: p.ticket_count_live,
        lth_holdings: p.lth_holdings_live,
        spent_toman: p.spent_toman,
        last_source: p.last_source,
        last_source_label: SOURCE_LABEL[p.last_source] || '—',
        last_seen_at: p.last_seen_at,
        created_at: p.created_at
      })),
      page, limit, total,
      summary: {
        total: summary.total,
        with_shipping: summary.shipping,
        with_orders: summary.orders,
        with_services: summary.services,
        with_tickets: summary.tickets,
        filled_forms: summary.active_people
      }
    });
  } catch (err) { next(err); }
});

router.get('/people.csv', (req, res, next) => {
  try {
    const { whereSql, params } = buildPeopleWhere(req.query);
    const rows = all(
      `SELECT pd.full_name, pd.username, pd.phone, pd.email, u.role, u.status,
              pd.address_count, pd.order_count, pd.service_count, pd.ticket_count,
              pd.last_source, pd.last_seen_at, pd.first_seen_at
         FROM people_directory pd JOIN users u ON u.id = pd.user_id
        WHERE ${whereSql} ORDER BY pd.last_seen_at DESC LIMIT 5000`,
      params
    );
    audit(req.user.id, req.user.role, 'admin.export_people', 'people_directory', null, { count: rows.length, query: req.query });
    const header = ['نام و نام خانوادگی', 'نام کاربری', 'شماره موبایل', 'ایمیل', 'نقش', 'وضعیت', 'نشانی‌ها', 'سفارش‌ها', 'درخواست خدمت', 'تیکت‌ها', 'آخرین فرم', 'آخرین فعالیت', 'تاریخ عضویت'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.full_name, r.username || '', r.phone, r.email || '', r.role, r.status,
        r.address_count, r.order_count, r.service_count, r.ticket_count,
        SOURCE_LABEL[r.last_source] || '', r.last_seen_at, r.first_seen_at
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="central-mine-people.csv"');
    res.send(`\uFEFF${lines.join('\n')}`);
  } catch (err) { next(err); }
});

router.get('/people/:id', (req, res, next) => {
  try {
    const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) throw ApiError.notFound('کاربر یافت نشد.');

    const identity = publicIdentity(user);
    const addresses = all(
      `SELECT id, title, province, city, address_line, postal_code, recipient_name, recipient_phone,
              recipient_email, refund_card_number, refund_sheba, auto_fill, is_default, created_at
         FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC`,
      [user.id]
    );
    const orders = all(
      `SELECT o.id, o.code, o.status, o.total_toman, o.created_at,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
         FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 40`,
      [user.id]
    );
    const services = all(
      `SELECT r.id, r.code, r.status, r.price_toman, r.created_at, s.name AS service_name
         FROM service_requests r LEFT JOIN services s ON s.id = r.service_id
        WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 40`,
      [user.id]
    );
    const tickets = all(
      `SELECT id, code, subject, status, priority, created_at
         FROM tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`,
      [user.id]
    );
    const payments = all(
      `SELECT p.id, p.amount_toman, p.status, p.gateway, p.paid_at, p.created_at,
              o.code AS order_code
         FROM payments p LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.order_id IN (SELECT id FROM orders WHERE user_id = ?)
           OR p.service_request_id IN (SELECT id FROM service_requests WHERE user_id = ?)
           OR p.lth_purchase_id IN (SELECT id FROM lth_purchase_orders WHERE user_id = ?)
        ORDER BY p.created_at DESC LIMIT 40`,
      [user.id, user.id, user.id]
    );
    const wallet = get('SELECT * FROM lth_wallets WHERE user_id = ?', [user.id]);
    const holdings = all(
      `SELECT id, contract_code, status, initial_base_atoms, active_base_atoms,
              accrued_staked_atoms, accrued_withdrawable_atoms, stake_unlock_at, purchased_at
         FROM lth_holdings WHERE user_id = ? ORDER BY purchased_at DESC`,
      [user.id]
    );
    const directory = get('SELECT * FROM people_directory WHERE user_id = ?', [user.id]);
    const spent = get(
      `SELECT COALESCE(SUM(total_toman), 0) AS total
         FROM orders WHERE user_id = ? AND status IN ('paid','preparing','shipped','completed')`,
      [user.id]
    ).total;

    const timeline = [];
    if (directory) {
      timeline.push({
        kind: 'signup',
        at: directory.first_seen_at,
        title: 'ثبت‌نام در سامانه',
        detail: 'نام کاربری و شماره موبایل ثبت شد.'
      });
    }
    for (const a of addresses) {
      timeline.push({ kind: 'shipping_form', at: a.created_at, title: 'تکمیل فرم نشانی و ارسال', detail: `${a.province} — ${a.city}` });
    }
    for (const o of orders) {
      timeline.push({ kind: 'order', at: o.created_at, title: `سفارش ${o.code}`, detail: o.status });
    }
    for (const s of services) {
      timeline.push({ kind: 'service_form', at: s.created_at, title: `درخواست خدمت ${s.code}`, detail: s.service_name || s.status });
    }
    for (const t of tickets) {
      timeline.push({ kind: 'support_ticket', at: t.created_at, title: `تیکت ${t.code}`, detail: t.subject });
    }
    timeline.sort((a, b) => String(b.at).localeCompare(String(a.at)));

    audit(req.user.id, req.user.role, 'admin.view_person_profile', 'user', user.id, {});

    res.json({
      user: identity,
      directory: directory ? {
        has_shipping: Boolean(directory.has_shipping),
        has_orders: Boolean(directory.has_orders),
        has_services: Boolean(directory.has_services),
        has_tickets: Boolean(directory.has_tickets),
        last_source: directory.last_source,
        last_source_label: SOURCE_LABEL[directory.last_source] || '—',
        first_seen_at: directory.first_seen_at,
        last_seen_at: directory.last_seen_at
      } : null,
      addresses,
      orders,
      services,
      tickets,
      payments,
      lth: {
        wallet: wallet ? {
          base_lth: wallet.base_atoms,
          staked_lth: wallet.staked_atoms,
          withdrawable_lth: wallet.withdrawable_reward_atoms,
          total_purchased_lth: wallet.total_purchased_atoms
        } : null,
        holdings: holdings.map((h) => ({ ...h }))
      },
      summary: { spent_toman: spent, orders: orders.length, addresses: addresses.length, services: services.length, tickets: tickets.length },
      timeline: timeline.slice(0, 60)
    });
  } catch (err) { next(err); }
});

router.patch('/people/:id', (req, res, next) => {
  try {
    const target = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!target) throw ApiError.notFound('کاربر یافت نشد.');

    const body = req.body || {};
    const data = validate(body)
      .string('full_name', { required: false, min: 3, max: 80 })
      .string('username', { required: false, min: 3, max: 24 })
      .string('email', { required: false, max: 120, default: undefined })
      .string('role', { required: false, enum: ROLES })
      .string('status', { required: false, enum: ['active', 'suspended'] })
      .string('reason', { required: false, min: 3, max: 300 })
      .string('current_password', { required: false, max: 128 })
      .done();

    if (data.username !== undefined) {
      const nextUsername = data.username.trim();
      if (!/^[a-z0-9_.]{3,24}$/i.test(nextUsername)) {
        throw ApiError.validation('نام کاربری باید ۳ تا ۲۴ کاراکتر و شامل حروف لاتین، رقم، نقطه یا زیرخط باشد.', [
          { field: 'username', message: 'قالب نام کاربری نادرست است.' }
        ]);
      }
      const taken = get('SELECT id FROM users WHERE username = ? AND id <> ?', [nextUsername, target.id]);
      if (taken) throw ApiError.conflict('این نام کاربری قبلاً ثبت شده است.');
      data.username = nextUsername;
    }

    const roleChanged = data.role !== undefined && data.role !== target.role;
    const statusChanged = data.status !== undefined && data.status !== target.status;
    if ((roleChanged || statusChanged) && !data.reason) {
      throw ApiError.validation('برای تغییر نقش یا وضعیت حساب، ثبت علت الزامی است.', [
        { field: 'reason', message: 'علت تغییر را وارد کنید.' }
      ]);
    }
    if (roleChanged || statusChanged) {
      // Two accepted proofs: a password sent with this request, or a fresh step-up proof
      // obtained from POST /auth/verify-identity a few minutes ago.
      const proofOk = authService.hasValidProof(req.user.id, body.reauth_proof, 'sensitive');
      if (!proofOk) {
        const adminRow = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (!data.current_password || !verifyPassword(data.current_password, adminRow.password_hash, adminRow.password_salt)) {
          throw ApiError.unauthorized('برای تغییر نقش یا وضعیت حساب، رمز عبور مدیر را دوباره وارد کنید.');
        }
      }
      if (target.id === req.user.id && (data.status === 'suspended' || (data.role && data.role !== 'admin'))) {
        throw ApiError.conflict('مدیر نمی‌تواند حساب یا نقش خودش را غیرفعال/تنزل دهد.');
      }
      if (get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'").c <= 1 && target.role === 'admin' && (roleChanged || data.status === 'suspended')) {
        throw ApiError.conflict('حداقل یک مدیر فعال باید در سامانه باقی بماند.');
      }
    }

    const now = nowIso();
    const next = {
      full_name: data.full_name !== undefined ? data.full_name : target.full_name,
      username: data.username !== undefined ? data.username : target.username,
      email: data.email !== undefined ? (data.email || null) : target.email,
      role: data.role || target.role,
      status: data.status || target.status
    };

    tx(() => {
      run('UPDATE users SET full_name = ?, username = ?, email = ?, role = ?, status = ?, updated_at = ? WHERE id = ?',
        [next.full_name, next.username, next.email, next.role, next.status, now, target.id]);
      if (next.status === 'suspended' || next.role !== target.role) {
        run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, target.id]);
      }
      audit(req.user.id, req.user.role, 'admin.update_person', 'user', target.id, {
        from_role: target.role,
        to_role: next.role,
        from_status: target.status,
        to_status: next.status,
        username_changed: next.username !== target.username,
        reason: data.reason || null
      });
    });

    res.json({ user: publicIdentity(get('SELECT * FROM users WHERE id = ?', [target.id])) });
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(String(err && err.message))) {
      return next(ApiError.conflict('نام کاربری یا ایمیل واردشده قبلاً برای حساب دیگری ثبت شده است.'));
    }
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

router.get('/products', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = ['p.deleted_at IS NULL'];
    const params = [];
    if (req.query.q) {
      const like = likeContains(String(req.query.q).trim());
      where.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR COALESCE(b.name, '') LIKE ? ESCAPE '\\' OR s.code LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like);
    }
    if (req.query.status && ['active', 'draft', 'archived'].includes(req.query.status)) {
      where.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.low_stock === '1') {
      where.push('(SELECT MIN(s2.stock) FROM skus s2 WHERE s2.product_id = p.id AND s2.is_active = 1) <= 5');
    }
    const whereSql = where.join(' AND ');
    const items = all(
      `SELECT p.id, p.name, p.slug, p.description, p.status, p.image_path, p.created_at, p.updated_at,
              c.id AS category_id, c.name AS category_name,
              b.id AS brand_id, b.name AS brand_name,
              (SELECT COUNT(*) FROM skus s2 WHERE s2.product_id = p.id) AS sku_count,
              (SELECT COALESCE(SUM(s2.stock), 0) FROM skus s2 WHERE s2.product_id = p.id) AS total_stock,
              (SELECT MIN(s2.price_toman) FROM skus s2 WHERE s2.product_id = p.id AND s2.is_active = 1) AS min_price_toman,
              (SELECT MAX(s2.price_toman) FROM skus s2 WHERE s2.product_id = p.id AND s2.is_active = 1) AS max_price_toman,
              (SELECT path FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS cover_image
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN skus s ON s.product_id = p.id
        WHERE ${whereSql}
        GROUP BY p.id
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const total = get(
      `SELECT COUNT(DISTINCT p.id) AS c FROM products p
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN skus s ON s.product_id = p.id
        WHERE ${whereSql}`,
      params
    ).c;

    res.json({
      items: items.map((p) => ({
        ...p,
        sku_count: num(p.sku_count),
        total_stock: num(p.total_stock),
        min_price_toman: p.min_price_toman === null ? null : num(p.min_price_toman),
        max_price_toman: p.max_price_toman === null ? null : num(p.max_price_toman),
        cover_image: p.cover_image || p.image_path || null
      })),
      page, limit, total,
      categories: catalog.listCategories(),
      brands: catalog.listBrands()
    });
  } catch (err) { next(err); }
});

router.post('/products', (req, res, next) => {
  try {
    const body = req.body || {};
    const data = validate(body)
      .string('name', { min: 2, max: 120 })
      .string('description', { required: false, default: '' })
      .string('status', { required: false, enum: ['active', 'draft', 'archived'], default: 'active' })
      .string('category_id', { required: false, default: null })
      .string('category_name', { required: false, default: null, max: 80 })
      .string('brand_id', { required: false, default: null })
      .string('brand_name', { required: false, default: null, max: 80 })
      .done();

    const created = tx(() => {
      let categoryId = data.category_id || null;
      let brandId = data.brand_id || null;
      if (data.category_name && !categoryId) {
        const existing = get('SELECT id FROM categories WHERE name = ?', [data.category_name.trim()]);
        categoryId = existing ? existing.id : catalog.createCategory(req.user, { name: data.category_name.trim() }).id;
      }
      if (data.brand_name && !brandId) {
        const existing = get('SELECT id FROM brands WHERE name = ?', [data.brand_name.trim()]);
        brandId = existing ? existing.id : catalog.createBrand(req.user, { name: data.brand_name.trim() }).id;
      }
      const product = catalog.createProduct(req.user, {
        name: data.name,
        description: data.description,
        status: data.status,
        category_id: categoryId,
        brand_id: brandId
      });

      const skuInput = body.sku && typeof body.sku === 'object' ? body.sku : null;
      let sku = null;
      if (skuInput && skuInput.price_toman !== undefined && skuInput.price_toman !== '' && Number(skuInput.price_toman) >= 0) {
        sku = catalog.createSku(req.user, product.id, {
          code: skuInput.code || undefined,
          price_toman: Number(skuInput.price_toman),
          cost_price_toman: Number(skuInput.cost_price_toman || 0),
          stock: Number(skuInput.stock || 0),
          weight_grams: skuInput.weight_grams ? Number(skuInput.weight_grams) : undefined,
          variant_attrs: skuInput.variant_attrs || { نوع: 'استاندارد' }
        });
      }
      const imagePath = typeof body.image_path === 'string' && body.image_path.startsWith('/uploads/')
        ? body.image_path.slice(0, 300)
        : null;
      if (imagePath) {
        run('UPDATE products SET image_path = ?, updated_at = ? WHERE id = ?', [imagePath, nowIso(), product.id]);
      }
      audit(req.user.id, req.user.role, 'admin.console_create_product', 'product', product.id, {
        name: data.name,
        sku_created: Boolean(sku),
        stock: sku ? sku.stock : 0
      });
      return { product, sku };
    });

    res.status(201).json({
      product: catalog.productBySlug(created.product.slug, { includeCost: true, includeInactive: true }),
      sku: created.sku
    });
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(String(err && err.message))) {
      return next(ApiError.conflict('نام یا کد مشابه قبلاً ثبت شده است. نام محصول، دسته یا برند را کمی تغییر دهید.'));
    }
    return next(err);
  }
});

router.post('/products/:id/archive', (req, res, next) => {
  try {
    const result = catalog.deleteProduct(req.user, req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Orders console
// ---------------------------------------------------------------------------

router.get('/orders', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = ['1 = 1'];
    const params = [];
    if (req.query.q) {
      const like = likeContains(String(req.query.q).trim().replace(/^@/, ''));
      where.push("(o.code LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like);
    }
    if (req.query.status) {
      const valid = ['pending_payment', 'paid', 'preparing', 'shipped', 'completed', 'canceled', 'return_in_progress', 'returned'];
      if (!valid.includes(req.query.status)) throw ApiError.validation('وضعیت سفارش نامعتبر است.');
      where.push('o.status = ?');
      params.push(req.query.status);
    }
    const whereSql = where.join(' AND ');
    const items = all(
      `SELECT o.id, o.code, o.status, o.subtotal_toman, o.shipping_toman, o.total_toman,
              o.tracking_code, o.created_at, u.id AS user_id, u.full_name, u.phone, u.username,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE ${whereSql}
        ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const total = get(
      `SELECT COUNT(*) AS c FROM orders o JOIN users u ON u.id = o.user_id WHERE ${whereSql}`,
      params
    ).c;
    const counts = all('SELECT status, COUNT(*) AS c FROM orders GROUP BY status');
    res.json({
      items: items.map((o) => ({ ...o, item_count: num(o.item_count) })),
      page, limit, total,
      counts: Object.fromEntries(counts.map((r) => [r.status, r.c]))
    });
  } catch (err) { next(err); }
});

router.get('/orders/:code', (req, res, next) => {
  try {
    const order = get(
      `SELECT o.*, u.full_name, u.phone, u.username, u.email
         FROM orders o JOIN users u ON u.id = o.user_id WHERE o.code = ?`,
      [req.params.code]
    );
    if (!order) throw ApiError.notFound('سفارش یافت نشد.');
    const items = all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    const history = all(
      `SELECT h.*, u.full_name AS actor_name FROM order_status_history h
         LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.order_id = ? ORDER BY h.created_at DESC`,
      [order.id]
    );
    res.json({
      order: {
        id: order.id,
        code: order.code,
        status: order.status,
        subtotal_toman: order.subtotal_toman,
        shipping_toman: order.shipping_toman,
        discount_toman: order.discount_toman,
        total_toman: order.total_toman,
        shipping_method: order.shipping_method,
        tracking_code: order.tracking_code,
        created_at: order.created_at,
        updated_at: order.updated_at,
        address: safeJson(order.address_snapshot),
        customer: {
          id: order.user_id,
          full_name: order.full_name,
          phone: order.phone,
          username: order.username,
          email: order.email
        }
      },
      items: items.map((i) => ({
        ...i,
        variant_attrs: safeJson(i.variant_attrs)
      })),
      history
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Treasury (خزانه)
// ---------------------------------------------------------------------------

router.get('/treasury', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = ['1 = 1'];
    const params = [];
    if (req.query.direction && ['in', 'out'].includes(req.query.direction)) {
      where.push('direction = ?');
      params.push(req.query.direction);
    }
    if (req.query.entry_type && ENTRY_LABEL[req.query.entry_type]) {
      where.push('entry_type = ?');
      params.push(req.query.entry_type);
    }
    const whereSql = where.join(' AND ');

    const opening = num(getSetting('treasury_opening_balance_toman', 0));
    const totals = get(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_toman ELSE 0 END), 0) AS total_in,
              COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_toman ELSE 0 END), 0) AS total_out,
              COUNT(*) AS entries
         FROM treasury_cash_ledger`
    );
    const byType = all(
      `SELECT entry_type, direction, COUNT(*) AS count, COALESCE(SUM(amount_toman), 0) AS total_toman
         FROM treasury_cash_ledger GROUP BY entry_type, direction ORDER BY total_toman DESC`
    ).map((r) => ({ ...r, label: ENTRY_LABEL[r.entry_type] || r.entry_type }));

    const today = todayStartIso();
    const todayTotals = get(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_toman ELSE 0 END), 0) AS today_in,
              COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_toman ELSE 0 END), 0) AS today_out
         FROM treasury_cash_ledger WHERE created_at >= ?`,
      [today]
    );

    const series = all(
      `SELECT substr(created_at, 1, 10) AS day,
              COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_toman ELSE 0 END), 0) AS in_toman,
              COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_toman ELSE 0 END), 0) AS out_toman
         FROM treasury_cash_ledger WHERE created_at >= ?
        GROUP BY day ORDER BY day`,
      [daysAgoIso(29)]
    );
    const map = new Map(series.map((r) => [r.day, r]));
    const last30Days = [];
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const row = map.get(day);
      last30Days.push({
        day,
        in_toman: row ? row.in_toman : 0,
        out_toman: row ? row.out_toman : 0
      });
    }

    const ledger = all(
      `SELECT t.*, u.full_name AS actor_name
         FROM treasury_cash_ledger t LEFT JOIN users u ON u.id = t.actor_id
        WHERE ${whereSql}
        ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ).map((r) => ({ ...r, entry_label: ENTRY_LABEL[r.entry_type] || r.entry_type }));
    const total = get(`SELECT COUNT(*) AS c FROM treasury_cash_ledger WHERE ${whereSql}`, params).c;

    const pendingPayments = get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount_toman), 0) AS total_toman
         FROM payments WHERE status = 'pending'`
    );
    const refundsTotal = get("SELECT COUNT(*) AS count, COALESCE(SUM(amount_toman), 0) AS total_toman FROM refunds");

    let lthTreasury = null;
    try {
      const view = lth.getTreasuryView();
      lthTreasury = {
        title: view.title,
        symbol: view.symbol,
        logo_path: view.logo_path,
        total_supply_lth_headline: view.total_supply_lth_headline,
        total_supply_lth_display_8: view.total_supply_lth_display_8,
        asset_lth_headline: view.asset_lth_headline,
        asset_lth_display_8: view.asset_lth_display_8,
        asset_lth_exact: view.asset_lth_exact,
        market_lth_display_8: view.market_lth_display_8,
        market_lth_exact: view.market_lth_exact,
        market_breakdown: view.market_breakdown,
        returned_stake_lth_display_8: view.returned_stake_lth_display_8,
        returned_base_lth_display_8: view.returned_base_lth_display_8,
        collected_fee_lth_display_8: view.collected_fee_lth_display_8,
        returned_reward_lth_display_12: view.returned_reward_lth_display_12,
        conservation_ok: view.conservation_ok,
        conservation_label: view.conservation_label,
        treasury_events_count: view.treasury_events_count,
        updated_at: view.updated_at
      };
    } catch {
      lthTreasury = null;
    }

    res.json({
      generated_at: nowIso(),
      summary: {
        opening_toman: opening,
        total_in_toman: totals.total_in,
        total_out_toman: totals.total_out,
        balance_toman: opening + totals.total_in - totals.total_out,
        today_in_toman: todayTotals.today_in,
        today_out_toman: todayTotals.today_out,
        entries: totals.entries,
        low_balance_toman: num(getSetting('treasury_low_balance_toman', 5000000)),
        pending_payments: pendingPayments,
        refunds: refundsTotal
      },
      by_type: byType,
      last_30_days: last30Days,
      ledger,
      page, limit, total,
      lth: lthTreasury
    });
  } catch (err) { next(err); }
});

router.post('/treasury/adjust', (req, res, next) => {
  try {
    const data = validate(req.body || {})
      .string('direction', { enum: ['in', 'out'] })
      .int('amount_toman', { min: 1, max: 1000000000000 })
      .string('reason', { min: 3, max: 300 })
      .string('note', { required: false, default: '', max: 300 })
      .string('reauth_proof', { required: false, max: 64 })
      .done();
    // Money movements above one million tomans require a fresh step-up proof.
    if (data.amount_toman >= 1000000 && !authService.hasValidProof(req.user.id, data.reauth_proof, 'sensitive')) {
      throw ApiError.unauthorized('برای جابه‌جایی مبالغ بالای یک میلیون تومان، تأیید مجدد هویت لازم است.');
    }

    const id = uuid();
    const entryType = data.direction === 'in' ? 'adjustment' : 'payout';
    tx(() => {
      run(
        `INSERT INTO treasury_cash_ledger (id, direction, entry_type, amount_toman, ref_type, ref_id, note, actor_id, created_at)
         VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
        [id, data.direction, entryType, data.amount_toman, id, data.note || data.reason, req.user.id, nowIso()]
      );
      audit(req.user.id, req.user.role, 'treasury.manual_adjust', 'treasury_cash_ledger', id, {
        direction: data.direction,
        amount_toman: data.amount_toman,
        reason: data.reason
      });
    });

    const balance = get(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_toman ELSE -amount_toman END), 0) AS net
         FROM treasury_cash_ledger`
    ).net;
    res.status(201).json({
      entry: get('SELECT * FROM treasury_cash_ledger WHERE id = ?', [id]),
      balance_toman: num(getSetting('treasury_opening_balance_toman', 0)) + num(balance)
    });
  } catch (err) { next(err); }
});

router.patch('/treasury/settings', (req, res, next) => {
  try {
    const data = validate(req.body || {})
      .int('opening_balance_toman', { required: false, min: 0, max: 1000000000000 })
      .int('low_balance_toman', { required: false, min: 0, max: 1000000000000 })
      .string('reason', { min: 3, max: 300 })
      .done();
    tx(() => {
      if (data.opening_balance_toman !== undefined) setSetting('treasury_opening_balance_toman', data.opening_balance_toman);
      if (data.low_balance_toman !== undefined) setSetting('treasury_low_balance_toman', data.low_balance_toman);
      audit(req.user.id, req.user.role, 'treasury.update_settings', 'settings', 'treasury', data);
    });
    res.json({
      opening_balance_toman: num(getSetting('treasury_opening_balance_toman', 0)),
      low_balance_toman: num(getSetting('treasury_low_balance_toman', 5000000))
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Audit integrity
// ---------------------------------------------------------------------------

router.get('/audit-verify', (req, res, next) => {
  try {
    const result = verifyAuditChain();
    audit(req.user.id, req.user.role, 'admin.verify_audit_chain', 'audit_log', null, result);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
