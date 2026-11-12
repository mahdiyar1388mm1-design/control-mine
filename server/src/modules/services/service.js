'use strict';

const { likeContains } = require('../../utils/dbGuards');

const { all, get, run, tx } = require('../../db');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, humanCode, validate, parsePagination, parseJsonObject, parseJsonArray } = require('../../utils/validate');
const { notify, audit } = require('../platform/service');

const REQUEST_STATUS = [
  'draft', 'submitted', 'queued', 'assigned', 'in_progress', 'waiting_customer',
  'completed', 'canceled', 'rejected', 'failed', 'refunded'
];

const STATUS_LABEL = {
  draft: 'پیش‌نویس',
  submitted: 'ثبت‌شده',
  queued: 'در صف',
  assigned: 'تخصیص‌یافته',
  in_progress: 'در حال انجام',
  waiting_customer: 'منتظر مشتری',
  completed: 'تکمیل‌شده',
  canceled: 'لغوشده',
  rejected: 'ردشده',
  failed: 'ناموفق',
  refunded: 'مستردشده'
};

const TERMINAL = ['completed', 'canceled', 'rejected', 'failed', 'refunded'];

// Server-side workflow: from_status -> to_status -> roles allowed
const TRANSITIONS = {
  draft: { submitted: ['customer'] },
  submitted: {
    queued: ['operator', 'admin', 'system'],
    canceled: ['customer', 'operator', 'admin'],
    rejected: ['operator', 'admin']
  },
  queued: {
    assigned: ['operator', 'admin'],
    canceled: ['customer', 'operator', 'admin'],
    rejected: ['operator', 'admin']
  },
  assigned: {
    in_progress: ['operator', 'admin'],
    queued: ['operator', 'admin'],
    rejected: ['operator', 'admin']
  },
  in_progress: {
    waiting_customer: ['operator', 'admin'],
    completed: ['operator', 'admin'],
    failed: ['operator', 'admin'],
    canceled: ['admin']
  },
  waiting_customer: {
    in_progress: ['operator', 'admin', 'system', 'customer'],
    failed: ['operator', 'admin'],
    canceled: ['customer', 'operator', 'admin']
  },
  completed: { refunded: ['finance', 'admin'] },
  failed: { refunded: ['finance', 'admin'] },
  canceled: {},
  rejected: {},
  refunded: {}
};

function validateFormData(formSchema, formData) {
  const errors = [];
  const clean = {};
  for (const field of formSchema) {
    const raw = formData[field.name];
    const isEmpty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length);
    if (field.required && isEmpty) {
      errors.push({ field: field.name, message: `${field.label} الزامی است.` });
      continue;
    }
    if (isEmpty) continue;
    switch (field.type) {
      case 'number': {
        const num = Number(raw);
        if (!Number.isFinite(num)) errors.push({ field: field.name, message: `${field.label} باید عدد باشد.` });
        else clean[field.name] = num;
        break;
      }
      case 'select':
        if (field.options && !field.options.includes(String(raw))) {
          errors.push({ field: field.name, message: `${field.label} خارج از گزینه‌های مجاز است.` });
        } else clean[field.name] = String(raw);
        break;
      case 'checkbox':
        clean[field.name] = Boolean(raw);
        break;
      case 'phone':
        if (!/^09\d{9}$/.test(String(raw))) errors.push({ field: field.name, message: `${field.label} معتبر نیست.` });
        else clean[field.name] = String(raw);
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw))) errors.push({ field: field.name, message: `${field.label} معتبر نیست.` });
        else clean[field.name] = String(raw);
        break;
      default: {
        const str = String(raw);
        const max = field.max || 2000;
        if (str.length > max) errors.push({ field: field.name, message: `${field.label} حداکثر ${max} حرف است.` });
        else clean[field.name] = str;
      }
    }
  }
  if (errors.length) throw ApiError.validation('فرم درخواست ناقص یا نامعتبر است.', errors);
  return clean;
}

function listServices(query) {
  const { page, limit, offset } = parsePagination(query);
  const where = ['s.is_active = 1'];
  const params = [];
  if (query.category) { where.push('c.slug = ?'); params.push(query.category); }
  if (query.q) { where.push("(s.name LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')"); params.push(likeContains(query.q), likeContains(query.q)); }
  const whereSql = where.join(' AND ');
  const items = all(
    `SELECT s.*, c.name AS category_name, c.slug AS category_slug FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
      WHERE ${whereSql} ORDER BY s.name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = get(`SELECT COUNT(*) AS c FROM services s LEFT JOIN service_categories c ON c.id = s.category_id WHERE ${whereSql}`, params).c;
  return {
    items: items.map((s) => ({
      id: s.id, name: s.name, slug: s.slug,
      category: s.category_name ? { name: s.category_name, slug: s.category_slug } : null,
      description: s.description, price_toman: s.price_toman,
      est_duration_text: s.est_duration_text, sla_hours: s.sla_hours
    })),
    page, limit, total
  };
}

function serviceBySlug(slug, { includeInactive = false } = {}) {
  const s = get(
    `SELECT s.*, c.name AS category_name, c.slug AS category_slug FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
      WHERE s.slug = ?`,
    [slug]
  );
  if (!s || (!s.is_active && !includeInactive)) throw ApiError.notFound('خدمت یافت نشد.');
  return {
    id: s.id, name: s.name, slug: s.slug,
    category: s.category_name ? { name: s.category_name, slug: s.category_slug } : null,
    description: s.description,
    terms: s.terms,
    exclusions: s.exclusions,
    price_toman: s.price_toman,
    est_duration_text: s.est_duration_text,
    sla_hours: s.sla_hours,
    priority_default: s.priority_default,
    form_schema: parseJsonArray(s.form_schema),
    form_version: s.form_version,
    required_documents: parseJsonArray(s.required_documents),
    team_queue: s.team_queue,
    capacity_per_day: s.capacity_per_day,
    delivery_method: s.delivery_method,
    cancel_policy: s.cancel_policy,
    is_active: Boolean(s.is_active)
  };
}

function createRequest(user, input, files = []) {
  const data = validate(input)
    .string('service_slug', { min: 1, max: 120 })
    .string('priority', { required: false, enum: ['low', 'normal', 'high', 'urgent'], default: null })
    .done();
  const service = get('SELECT * FROM services WHERE slug = ?', [data.service_slug]);
  if (!service || !service.is_active) throw ApiError.notFound('خدمت فعالی با این شناسه نیست.');

  let formData;
  try {
    formData = typeof input.form_data === 'string' ? JSON.parse(input.form_data) : (input.form_data || {});
  } catch {
    throw ApiError.validation('دادهٔ فرم JSON معتبر نیست.', [{ field: 'form_data', message: 'قالب JSON نادرست است.' }]);
  }
  const cleanForm = validateFormData(parseJsonArray(service.form_schema), formData);
  const priority = data.priority || service.priority_default;

  if (service.capacity_per_day) {
    const todayCount = get(
      "SELECT COUNT(*) AS c FROM service_requests WHERE service_id = ? AND date(created_at) = date('now')",
      [service.id]
    ).c;
    if (todayCount >= service.capacity_per_day) {
      throw ApiError.conflict('ظرفیت پذیرش این خدمت برای امروز تکمیل است؛ فردا دوباره تلاش کنید.');
    }
  }

  const id = uuid();
  const code = humanCode('SR');
  const now = nowIso();
  const dueAt = new Date(Date.now() + service.sla_hours * 3600 * 1000).toISOString();

  return tx(() => {
    run(
      `INSERT INTO service_requests (id, code, service_id, user_id, status, priority, form_data, form_version, terms_snapshot,
         price_toman, assigned_to, assigned_team, due_at, waiting_since, result_summary, payment_id, cancel_reason, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
      [id, code, service.id, user.id, priority, JSON.stringify(cleanForm), service.form_version,
        service.terms, service.price_toman, service.team_queue, dueAt, now, now]
    );
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
      [uuid(), id, 'submitted', user.id, user.role, 'ثبت درخواست توسط مشتری', now]);

    for (const file of files) {
      run(
        'INSERT INTO request_files (id, request_id, uploader_id, kind, original_name, stored_name, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), id, user.id, 'customer_document', file.originalname, file.filename, file.mimetype, file.size, now]
      );
    }

    if (service.price_toman === 0) {
      // Free service: enter the operator queue immediately.
      run("UPDATE service_requests SET status = 'queued', updated_at = ? WHERE id = ?", [now, id]);
      run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
        [uuid(), id, 'submitted', 'queued', 'system', 'خدمت رایگان — ورود به صف', now]);
    }

    notify(user.id, 'service_submitted', 'درخواست شما ثبت شد', `کد پیگیری: ${code}`, `/service-requests/${code}`);
    audit(user.id, user.role, 'service_request.create', 'service_request', id, { code, service: service.slug });

    return {
      request: requestView(get('SELECT * FROM service_requests WHERE id = ?', [id]), user, { files })
    };
  });
}

function requestRowByCodeFor(code, user) {
  const row = get('SELECT * FROM service_requests WHERE code = ? OR id = ?', [code, code]);
  if (!row) throw ApiError.notFound('درخواست یافت نشد.');
  const isOwner = row.user_id === user.id;
  const isStaff = ['operator', 'admin', 'support', 'finance'].includes(user.role);
  if (!isOwner && !isStaff) throw ApiError.forbidden('شما به این درخواست دسترسی ندارید.');
  return { row, isOwner };
}

function requestView(row, user, { files: passedFiles } = {}) {
  const isOwner = row.user_id === user.id;
  const isStaff = ['operator', 'admin', 'support', 'finance'].includes(user.role);
  const service = get('SELECT * FROM services WHERE id = ?', [row.service_id]);
  const assigned = row.assigned_to ? get('SELECT id, full_name FROM users WHERE id = ?', [row.assigned_to]) : null;

  let messages = all(
    `SELECT m.*, u.full_name AS author_name FROM request_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.request_id = ? ORDER BY m.created_at`,
    [row.id]
  );
  if (isOwner && !isStaff) {
    // Internal notes are never exposed through the customer API.
    messages = messages.filter((m) => m.kind !== 'internal_note');
  }
  let files;
  if (passedFiles) {
    files = passedFiles;
  } else {
    files = all('SELECT * FROM request_files WHERE request_id = ? ORDER BY created_at', [row.id]);
    if (isOwner && !isStaff) {
      files = files.filter((f) => f.kind !== 'internal');
    }
  }
  const history = all(
    `SELECT h.*, u.full_name AS actor_name FROM request_status_history h
       LEFT JOIN users u ON u.id = h.actor_id
      WHERE h.request_id = ? ORDER BY h.created_at`,
    [row.id]
  );
  const payment = row.payment_id ? get('SELECT * FROM payments WHERE id = ?', [row.payment_id]) : null;

  return {
    id: row.id,
    code: row.code,
    status: row.status,
    status_label: STATUS_LABEL[row.status],
    priority: row.priority,
    service: service ? { name: service.name, slug: service.slug, delivery_method: service.delivery_method } : null,
    form_data: parseJsonObject(row.form_data),
    form_version: row.form_version,
    terms_snapshot: row.terms_snapshot,
    price_toman: row.price_toman,
    assigned_to: isStaff || isOwner ? (assigned ? { id: assigned.id, full_name: assigned.full_name } : null) : null,
    assigned_team: row.assigned_team,
    due_at: row.due_at,
    sla_breached: !TERMINAL.includes(row.status) && row.due_at ? row.due_at < nowIso() : false,
    waiting_since: row.waiting_since,
    result_summary: row.result_summary,
    payment: payment ? {
      id: payment.id, status: payment.status, amount_toman: payment.amount_toman,
      pay_url: payment.status === 'pending' ? `/api/v1/payments/${payment.id}/gateway` : null
    } : (row.price_toman > 0 ? { status: 'none', amount_toman: row.price_toman } : null),
    cancel_reason: row.cancel_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
    messages: messages.map((m) => ({
      id: m.id, kind: m.kind, author_name: m.author_name, author_role: m.author_role,
      body: m.body, created_at: m.created_at
    })),
    files: files.map((f) => ({
      id: f.id, kind: f.kind, original_name: f.original_name,
      mime: f.mime, size_bytes: f.size_bytes, created_at: f.created_at
    })),
    history: history.map((h) => ({
      from_status: h.from_status, to_status: h.to_status,
      actor_role: h.actor_role, actor_name: h.actor_name, reason: h.reason, created_at: h.created_at
    }))
  };
}

function listMine(user, query) {
  const { page, limit, offset } = parsePagination(query);
  const items = all(
    `SELECT r.*, s.name AS service_name FROM service_requests r JOIN services s ON s.id = r.service_id
      WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [user.id, limit, offset]
  );
  const total = get('SELECT COUNT(*) AS c FROM service_requests WHERE user_id = ?', [user.id]).c;
  return {
    items: items.map((r) => ({
      code: r.code, status: r.status, status_label: STATUS_LABEL[r.status],
      service_name: r.service_name, priority: r.priority,
      price_toman: r.price_toman, due_at: r.due_at,
      sla_breached: !TERMINAL.includes(r.status) && r.due_at ? r.due_at < nowIso() : false,
      created_at: r.created_at
    })),
    page, limit, total
  };
}

function getRequest(user, code) {
  const { row } = requestRowByCodeFor(code, user);
  return requestView(row, user);
}

function postMessage(user, code, input, { internal = false } = {}) {
  const data = validate(input).string('body', { min: 1, max: 4000 }).done();
  return tx(() => {
    const { row, isOwner } = requestRowByCodeFor(code, user);
    if (TERMINAL.includes(row.status)) {
      throw ApiError.invalidState('این درخواست بسته شده و امکان پیام جدید نیست.');
    }
    let kind;
    if (isOwner && !['operator', 'admin'].includes(user.role)) kind = 'customer';
    else if (internal) kind = 'internal_note';
    else kind = 'operator';

    const now = nowIso();
    run('INSERT INTO request_messages (id, request_id, author_id, author_role, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid(), row.id, user.id, user.role, kind, data.body, now]);

    if (kind === 'customer') {
      if (row.status === 'waiting_customer') {
        // Customer replied — case moves back into progress automatically.
        run("UPDATE service_requests SET status = 'in_progress', waiting_since = NULL, updated_at = ? WHERE id = ?", [now, row.id]);
        run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid(), row.id, 'waiting_customer', 'in_progress', user.id, user.role, 'پاسخ مشتری', now]);
      }
      if (row.assigned_to) {
        notify(row.assigned_to, 'service_message', `پیام جدید در ${row.code}`, data.body.slice(0, 120), `/staff/service-requests/${row.id}`);
      }
    } else if (kind === 'operator') {
      notify(row.user_id, 'service_message', `پیام جدید در درخواست ${row.code}`, data.body.slice(0, 120), `/service-requests/${row.code}`);
    }
    return requestView(get('SELECT * FROM service_requests WHERE id = ?', [row.id]), user);
  });
}

function cancelByCustomer(user, code, input) {
  const data = validate(input)
    .string('reason', { min: 3, max: 300 })
    .done();
  return tx(() => {
    const { row, isOwner } = requestRowByCodeFor(code, user);
    if (!isOwner) throw ApiError.forbidden('فقط صاحب درخواست می‌تواند لغو کند.');
    const cancellable = ['submitted', 'queued', 'waiting_customer'];
    if (!cancellable.includes(row.status)) {
      throw ApiError.invalidState(`درخواست در وضعیت «${STATUS_LABEL[row.status]}» قابل لغو نیست؛ با پشتیبانی تماس بگیرید.`);
    }
    const now = nowIso();
    run("UPDATE service_requests SET status = 'canceled', cancel_reason = ?, updated_at = ?, closed_at = ? WHERE id = ?",
      [data.reason, now, now, row.id]);
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), row.id, row.status, 'canceled', user.id, user.role, data.reason, now]);

    const payment = row.payment_id ? get('SELECT * FROM payments WHERE id = ?', [row.payment_id]) : null;
    if (payment && payment.status === 'paid') {
      run("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?", [now, payment.id]);
      run('INSERT INTO refunds (id, payment_id, amount_toman, reason, reference, status, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), payment.id, payment.amount_toman, `لغو درخواست ${row.code}`, `SR-CANCEL-${row.code}`, 'done', user.id, now]);
      run("UPDATE service_requests SET status = 'refunded' WHERE id = ?", [row.id]);
      run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), row.id, 'canceled', 'refunded', user.id, user.role, 'استرداد مبلغ پرداختی', now]);
    }
    audit(user.id, user.role, 'service_request.cancel', 'service_request', row.id, { reason: data.reason });
    return requestView(get('SELECT * FROM service_requests WHERE id = ?', [row.id]), user);
  });
}

// ---------- staff ----------

function staffQueue(user, query) {
  const { page, limit, offset } = parsePagination(query);
  const where = ['1 = 1'];
  const params = [];
  if (query.status) {
    if (!REQUEST_STATUS.includes(query.status)) throw ApiError.validation('وضعیت نامعتبر است.');
    where.push('r.status = ?');
    params.push(query.status);
  } else {
    where.push(`r.status NOT IN (${TERMINAL.map(() => '?').join(',')})`);
    params.push(...TERMINAL);
  }
  if (query.service) { where.push('s.slug = ?'); params.push(query.service); }
  if (query.priority) { where.push('r.priority = ?'); params.push(query.priority); }
  if (query.q) { where.push("(r.code LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\')"); params.push(likeContains(query.q), likeContains(query.q)); }
  if (query.mine === '1') { where.push('r.assigned_to = ?'); params.push(user.id); }
  if (query.sla === 'breached') { where.push('r.due_at < ?'); params.push(nowIso()); }
  if (query.sla === 'at_risk') {
    const soon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    where.push('r.due_at >= ? AND r.due_at < ?');
    params.push(nowIso(), soon);
  }
  const whereSql = where.join(' AND ');
  const items = all(
    `SELECT r.*, s.name AS service_name, u.full_name AS customer_name, a.full_name AS assignee_name
       FROM service_requests r
       JOIN services s ON s.id = r.service_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN users a ON a.id = r.assigned_to
      WHERE ${whereSql}
      ORDER BY CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, r.due_at ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = get(
    `SELECT COUNT(*) AS c FROM service_requests r JOIN services s ON s.id = r.service_id JOIN users u ON u.id = r.user_id WHERE ${whereSql}`,
    params
  ).c;
  return {
    items: items.map((r) => ({
      id: r.id, code: r.code, status: r.status, status_label: STATUS_LABEL[r.status],
      priority: r.priority, service_name: r.service_name,
      customer_name: r.customer_name, assignee_name: r.assignee_name,
      due_at: r.due_at,
      sla_breached: !TERMINAL.includes(r.status) && r.due_at < nowIso(),
      sla_at_risk: !TERMINAL.includes(r.status) && r.due_at >= nowIso() && r.due_at < new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      created_at: r.created_at
    })),
    page, limit, total
  };
}

function staffGetRequest(user, id) {
  const row = get('SELECT * FROM service_requests WHERE id = ? OR code = ?', [id, id]);
  if (!row) throw ApiError.notFound('درخواست یافت نشد.');
  return requestView(row, user);
}

function assignRequest(user, id, input) {
  const data = validate(input)
    .string('assignee_id', { required: false, max: 64, default: null })
    .string('reason', { required: false, max: 300, default: '' })
    .done();
  return tx(() => {
    const row = get('SELECT * FROM service_requests WHERE id = ? OR code = ?', [id, id]);
    if (!row) throw ApiError.notFound('درخواست یافت نشد.');
    if (!['queued', 'assigned'].includes(row.status)) {
      throw ApiError.invalidState(`تخصیص فقط از وضعیت «در صف» یا «تخصیص‌یافته» ممکن است (وضعیت فعلی: ${STATUS_LABEL[row.status]}).`);
    }
    const assigneeId = data.assignee_id || user.id;
    const assignee = get("SELECT * FROM users WHERE id = ? AND status = 'active'", [assigneeId]);
    if (!assignee || !['operator', 'admin'].includes(assignee.role)) {
      throw ApiError.validation('کاربر انتخابی اپراتور مجاز نیست.', [{ field: 'assignee_id', message: 'اپراتور معتبر نیست.' }]);
    }
    const now = nowIso();
    const fromStatus = row.status;
    run('UPDATE service_requests SET assigned_to = ?, status = ?, updated_at = ? WHERE id = ?',
      [assigneeId, 'assigned', now, row.id]);
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), row.id, fromStatus, 'assigned', user.id, user.role, data.reason || `تخصیص به ${assignee.full_name}`, now]);
    notify(assigneeId, 'service_assigned', `درخواست ${row.code} به شما تخصیص یافت`, '', `/staff/service-requests/${row.id}`);
    notify(row.user_id, 'service_status', `درخواست ${row.code} تخصیص یافت`, 'کارشناس مشخص شد.', `/service-requests/${row.code}`);
    audit(user.id, user.role, 'service_request.assign', 'service_request', row.id, { assigneeId });
    return requestView(get('SELECT * FROM service_requests WHERE id = ?', [row.id]), user);
  });
}

function changeStatus(user, id, input) {
  const data = validate(input)
    .string('to_status', { enum: REQUEST_STATUS })
    .string('reason', { required: false, max: 500, default: '' })
    .string('result_summary', { required: false, max: 4000, default: '' })
    .done();
  return tx(() => {
    const row = get('SELECT * FROM service_requests WHERE id = ? OR code = ?', [id, id]);
    if (!row) throw ApiError.notFound('درخواست یافت نشد.');
    const allowed = (TRANSITIONS[row.status] || {})[data.to_status];
    if (!allowed) {
      throw ApiError.invalidState(`تغییر وضعیت از «${STATUS_LABEL[row.status]}» به «${STATUS_LABEL[data.to_status]}» مجاز نیست.`);
    }
    const actorRole = user.role === 'system' ? 'system' : user.role;
    if (!allowed.includes(actorRole)) {
      throw ApiError.forbidden('شما مجوز این تغییر وضعیت را ندارید.');
    }
    // Prerequisites — operators cannot skip workflow steps.
    if (data.to_status === 'in_progress' && !row.assigned_to && row.status !== 'waiting_customer') {
      throw ApiError.invalidState('پیش از شروع انجام، درخواست باید به اپراتور تخصیص یافته باشد.');
    }
    if (data.to_status === 'completed' && !data.result_summary && !row.result_summary) {
      throw ApiError.validation('برای تکمیل، ثبت نتیجه الزامی است.', [{ field: 'result_summary', message: 'الزامی است.' }]);
    }
    if (['waiting_customer', 'failed', 'rejected'].includes(data.to_status) && !data.reason) {
      throw ApiError.validation('ثبت علت برای این تغییر وضعیت الزامی است.', [{ field: 'reason', message: 'الزامی است.' }]);
    }
    if (data.to_status === 'queued' && row.price_toman > 0) {
      const payment = row.payment_id ? get('SELECT * FROM payments WHERE id = ?', [row.payment_id]) : null;
      if (!payment || payment.status !== 'paid') {
        throw ApiError.paymentRequired('این خدمت پولی است و پیش از ورود به صف باید پرداخت انجام شود.');
      }
    }
    const now = nowIso();
    run(
      `UPDATE service_requests SET status = ?, result_summary = COALESCE(?, result_summary),
         waiting_since = CASE WHEN ? = 'waiting_customer' THEN ? ELSE NULL END,
         updated_at = ?, closed_at = CASE WHEN ? IN ('completed','canceled','rejected','failed','refunded') THEN ? ELSE closed_at END
       WHERE id = ?`,
      [data.to_status, data.result_summary || null, data.to_status, now, now, data.to_status, now, row.id]
    );
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), row.id, row.status, data.to_status, user.id, actorRole, data.reason || data.result_summary || null, now]);

    const notifyMap = {
      queued: ['درخواست شما در صف انجام قرار گرفت', ''],
      in_progress: ['انجام درخواست شما آغاز شد', ''],
      waiting_customer: ['اطلاعات تکمیلی لازم است', data.reason],
      completed: ['درخواست شما تکمیل شد', data.result_summary || row.result_summary || ''],
      failed: ['انجام درخواست ناموفق بود', data.reason],
      rejected: ['درخواست پذیرفته نشد', data.reason],
      canceled: ['درخواست لغو شد', data.reason],
      refunded: ['مبلغ درخواست مسترد شد', '']
    };
    if (notifyMap[data.to_status]) {
      notify(row.user_id, 'service_status', `درخواست ${row.code}: ${notifyMap[data.to_status][0]}`, notifyMap[data.to_status][1], `/service-requests/${row.code}`);
    }
    audit(user.id, actorRole, 'service_request.status_change', 'service_request', row.id,
      { from: row.status, to: data.to_status, reason: data.reason });
    return requestView(get('SELECT * FROM service_requests WHERE id = ?', [row.id]), user);
  });
}

function uploadFiles(user, id, files, input = {}) {
  const kind = ['customer_document', 'result_file', 'internal'].includes(input.kind) ? input.kind : 'result_file';
  return tx(() => {
    const row = get('SELECT * FROM service_requests WHERE id = ? OR code = ?', [id, id]);
    if (!row) throw ApiError.notFound('درخواست یافت نشد.');
    if (TERMINAL.includes(row.status) && kind !== 'internal') {
      throw ApiError.invalidState('این درخواست بسته شده است.');
    }
    const now = nowIso();
    for (const file of files) {
      run(
        'INSERT INTO request_files (id, request_id, uploader_id, kind, original_name, stored_name, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), row.id, user.id, kind, file.originalname, file.filename, file.mimetype, file.size, now]
      );
    }
    if (kind === 'result_file') {
      notify(row.user_id, 'service_file', `فایل نتیجه برای ${row.code} ثبت شد`, '', `/service-requests/${row.code}`);
    }
    audit(user.id, user.role, 'service_request.upload', 'service_request', row.id, { count: files.length, kind });
    return requestView(get('SELECT * FROM service_requests WHERE id = ?', [row.id]), user);
  });
}

function listServiceCategories() {
  return all('SELECT * FROM service_categories ORDER BY name');
}

function slugifyService(name) {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  let slug = base || `srv-${Date.now()}`;
  let i = 1;
  while (get('SELECT 1 AS x FROM services WHERE slug = ?', [slug])) {
    slug = `${base}-${i}`;
    i += 1;
  }
  return slug;
}

function normalizeJsonArrayField(raw, fieldName) {
  if (raw === undefined || raw === null || raw === '') return '[]';
  if (Array.isArray(raw)) return JSON.stringify(raw);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return JSON.stringify(parsed);
    } catch { /* fall through */ }
  }
  throw ApiError.validation('فیلد باید آرایهٔ JSON معتبر باشد.', [{ field: fieldName, message: 'قالب JSON نادرست است.' }]);
}

function listServicesAdmin(query) {
  const { page, limit, offset } = parsePagination(query);
  const items = all(
    `SELECT s.*, c.name AS category_name FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
      ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  ).map((s) => ({
    ...s,
    is_active: Boolean(s.is_active),
    form_schema: parseJsonArray(s.form_schema),
    required_documents: parseJsonArray(s.required_documents)
  }));
  const total = get('SELECT COUNT(*) AS c FROM services').c;
  return { items, page, limit, total };
}

function createService(actor, input) {
  const data = validate(input)
    .string('name', { min: 2, max: 120 })
    .string('category_id', { required: false, default: null })
    .string('description', { default: '' })
    .string('terms', { default: '' })
    .string('exclusions', { default: '' })
    .int('price_toman', { min: 0, default: 0 })
    .string('est_duration_text', { default: '' })
    .int('sla_hours', { min: 1, max: 8760, default: 72 })
    .string('priority_default', { enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' })
    .string('team_queue', { default: 'services', max: 60 })
    .int('capacity_per_day', { required: false, min: 1, max: 100000, default: null })
    .string('delivery_method', { default: 'download', max: 60 })
    .string('cancel_policy', { default: '' })
    .bool('is_active', { default: true })
    .done();
  const formSchema = normalizeJsonArrayField(input && input.form_schema, 'form_schema');
  const reqDocs = normalizeJsonArrayField(input && input.required_documents, 'required_documents');
  const id = uuid();
  const slug = slugifyService(data.name);
  const now = nowIso();
  tx(() => {
    run(
      `INSERT INTO services (id, name, slug, category_id, description, terms, exclusions, price_toman,
         est_duration_text, sla_hours, priority_default, form_schema, form_version, required_documents,
         team_queue, capacity_per_day, delivery_method, cancel_policy, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, slug, data.category_id, data.description, data.terms, data.exclusions, data.price_toman,
        data.est_duration_text, data.sla_hours, data.priority_default, formSchema, reqDocs,
        data.team_queue, data.capacity_per_day, data.delivery_method, data.cancel_policy, data.is_active ? 1 : 0, now, now]
    );
    run(
      `INSERT INTO service_form_versions (id, service_id, version, form_schema, terms_snapshot, price_toman, sla_hours, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
      [uuid(), id, formSchema, data.terms, data.price_toman, data.sla_hours, now]
    );
    audit(actor.id, actor.role, 'service.create', 'service', id, { name: data.name, slug });
  });
  return serviceBySlug(slug, { includeInactive: true });
}

function updateService(actor, id, input) {
  const s = get('SELECT * FROM services WHERE id = ?', [id]);
  if (!s) throw ApiError.notFound('خدمت یافت نشد.');
  const data = validate(input)
    .string('name', { required: false, min: 2, max: 120 })
    .string('category_id', { required: false, default: undefined })
    .string('description', { required: false })
    .string('terms', { required: false })
    .string('exclusions', { required: false })
    .int('price_toman', { required: false, min: 0 })
    .string('est_duration_text', { required: false })
    .int('sla_hours', { required: false, min: 1, max: 8760 })
    .string('priority_default', { required: false, enum: ['low', 'normal', 'high', 'urgent'] })
    .string('team_queue', { required: false, max: 60 })
    .int('capacity_per_day', { required: false, min: 1, max: 100000, default: undefined })
    .string('delivery_method', { required: false, max: 60 })
    .string('cancel_policy', { required: false })
    .bool('is_active', {})
    .done();
  const nextFormSchema = input && input.form_schema !== undefined
    ? normalizeJsonArrayField(input.form_schema, 'form_schema')
    : s.form_schema;
  const nextReqDocs = input && input.required_documents !== undefined
    ? normalizeJsonArrayField(input.required_documents, 'required_documents')
    : s.required_documents;
  const merged = { ...s, ...data, form_schema: nextFormSchema, required_documents: nextReqDocs };
  const versionAffectingChanged =
    merged.form_schema !== s.form_schema ||
    merged.terms !== s.terms ||
    merged.price_toman !== s.price_toman ||
    merged.sla_hours !== s.sla_hours;
  const nextVersion = versionAffectingChanged ? s.form_version + 1 : s.form_version;
  const now = nowIso();
  tx(() => {
    run(
      `UPDATE services SET name = ?, category_id = ?, description = ?, terms = ?, exclusions = ?,
         price_toman = ?, est_duration_text = ?, sla_hours = ?, priority_default = ?,
         form_schema = ?, form_version = ?, required_documents = ?, team_queue = ?,
         capacity_per_day = ?, delivery_method = ?, cancel_policy = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
      [merged.name, merged.category_id === undefined ? s.category_id : (merged.category_id || null),
        merged.description, merged.terms, merged.exclusions, merged.price_toman,
        merged.est_duration_text, merged.sla_hours, merged.priority_default,
        merged.form_schema, nextVersion, merged.required_documents, merged.team_queue,
        merged.capacity_per_day === undefined ? s.capacity_per_day : merged.capacity_per_day,
        merged.delivery_method, merged.cancel_policy,
        merged.is_active === undefined ? s.is_active : (merged.is_active ? 1 : 0),
        now, id]
    );
    if (versionAffectingChanged) {
      run(
        `INSERT INTO service_form_versions (id, service_id, version, form_schema, terms_snapshot, price_toman, sla_hours, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), id, nextVersion, merged.form_schema, merged.terms, merged.price_toman, merged.sla_hours, now]
      );
    }
    audit(actor.id, actor.role, 'service.update', 'service', id, { fields: Object.keys(data), version: nextVersion });
  });
  return serviceBySlug(s.slug, { includeInactive: true });
}

function transferTeam(user, id, input) {
  const data = validate(input)
    .string('team_queue', { min: 2, max: 60 })
    .string('reason', { min: 3, max: 300 })
    .done();
  return tx(() => {
    const row = get('SELECT * FROM service_requests WHERE id = ? OR code = ?', [id, id]);
    if (!row) throw ApiError.notFound('درخواست یافت نشد.');
    if (TERMINAL.includes(row.status)) throw ApiError.invalidState('این درخواست بسته شده است.');
    const now = nowIso();
    run('UPDATE service_requests SET assigned_team = ?, assigned_to = NULL, status = ?, updated_at = ? WHERE id = ?',
      [data.team_queue, row.status === 'submitted' ? 'submitted' : 'queued', now, row.id]);
    run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), row.id, row.status, row.status === 'submitted' ? 'submitted' : 'queued', user.id, user.role,
        `ارجاع به صف ${data.team_queue}: ${data.reason}`, now]);
    audit(user.id, user.role, 'service_request.transfer_team', 'service_request', row.id, data);
    return requestView(get('SELECT * FROM service_requests WHERE id = ?', [row.id]), user);
  });
}

function customerUploadFiles(user, code, files) {
  if (!files || !files.length) throw ApiError.validation('فایلی ارسال نشده است.');
  return tx(() => {
    const { row, isOwner } = requestRowByCodeFor(code, user);
    if (!isOwner) throw ApiError.forbidden('فقط صاحب درخواست می‌تواند مدرک بارگذاری کند.');
    if (TERMINAL.includes(row.status)) throw ApiError.invalidState('این درخواست بسته شده است.');
    const now = nowIso();
    for (const file of files) {
      run(
        'INSERT INTO request_files (id, request_id, uploader_id, kind, original_name, stored_name, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), row.id, user.id, 'customer_document', file.originalname, file.filename, file.mimetype, file.size, now]
      );
    }
    if (row.status === 'waiting_customer') {
      run("UPDATE service_requests SET status = 'in_progress', waiting_since = NULL, updated_at = ? WHERE id = ?", [now, row.id]);
      run('INSERT INTO request_status_history (id, request_id, from_status, to_status, actor_id, actor_role, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), row.id, 'waiting_customer', 'in_progress', user.id, user.role, 'ارسال مدرک تکمیلی توسط مشتری', now]);
    }
    if (row.assigned_to) {
      notify(row.assigned_to, 'service_file', `مدرک تکمیلی در ${row.code}`, '', `/staff/service-requests/${row.id}`);
    }
    return requestView(get('SELECT * FROM service_requests WHERE id = ?', [row.id]), user);
  });
}

module.exports = {
  REQUEST_STATUS, STATUS_LABEL, TRANSITIONS, TERMINAL,
  listServiceCategories, listServices, serviceBySlug,
  listServicesAdmin, createService, updateService,
  createRequest, listMine, getRequest,
  postMessage, cancelByCustomer, customerUploadFiles,
  staffQueue, staffGetRequest, assignRequest, transferTeam, changeStatus, uploadFiles,
  requestRowByCodeFor
};
