'use strict';

const express = require('express');
const { all, get, run, tx } = require('../../db');
const { requireAuth } = require('../../middleware/auth');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, validate, PHONE_RE } = require('../../utils/validate');
const { verifyPassword } = require('../../utils/password');
const { audit } = require('../platform/service');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CARD_RE = /^\d{16}$/;
const SHEBA_RE = /^IR\d{24}$/;
const POSTAL_RE = /^\d{10}$/;
// Optional address fields that the customer may clear by sending null or an empty string.
const CLEARABLE_ADDRESS_FIELDS = ['recipient_email', 'refund_card_number', 'refund_sheba'];

router.use(requireAuth);

function ownedAddress(userId, addressId) {
  const row = get('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
  if (!row) throw ApiError.notFound('نشانی یافت نشد.');
  return row;
}

function toLatinDigits(value) {
  return value
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** Accept Persian/Arabic digits and spaced/dashed card or IBAN numbers from the shipping form. */
function normalizeAddressInput(body) {
  const input = body && typeof body === 'object' ? { ...body } : {};
  for (const field of ['postal_code', 'recipient_phone', 'refund_card_number', 'refund_sheba']) {
    if (typeof input[field] === 'string') {
      input[field] = toLatinDigits(input[field]).replace(/[\s-]/g, '');
    }
  }
  if (typeof input.refund_sheba === 'string' && input.refund_sheba) {
    input.refund_sheba = input.refund_sheba.toUpperCase();
    if (/^\d{24}$/.test(input.refund_sheba)) input.refund_sheba = `IR${input.refund_sheba}`;
  }
  return input;
}

function maskTail(value) {
  return value ? `****${String(value).slice(-4)}` : null;
}

function auditRefundAccountChange(req, addressId, before, after) {
  const cardChanged = (before.refund_card_number || null) !== (after.refund_card_number || null);
  const shebaChanged = (before.refund_sheba || null) !== (after.refund_sheba || null);
  if (!cardChanged && !shebaChanged) return;
  audit(req.user.id, req.user.role, 'user.update_refund_account', 'user_address', addressId, {
    card: cardChanged ? maskTail(after.refund_card_number) : undefined,
    sheba: shebaChanged ? maskTail(after.refund_sheba) : undefined
  });
}

router.get('/profile', (req, res) => {
  const user = get('SELECT id, phone, email, full_name, role, status, created_at FROM users WHERE id = ?', [req.user.id]);
  res.json({ user });
});

router.patch('/profile', (req, res, next) => {
  try {
    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const data = validate(req.body)
      .string('full_name', { required: false, min: 3, max: 80 })
      .string('email', { required: false, max: 120, default: undefined })
      .string('phone', { required: false, min: 11, max: 11, pattern: PHONE_RE, patternMessage: 'شماره موبایل معتبر نیست.' })
      .string('current_password', { required: false, max: 128 })
      .done();

    if (data.phone && data.phone !== user.phone) {
      // Sensitive change: confirm ownership with password.
      if (!data.current_password || !verifyPassword(data.current_password, user.password_hash, user.password_salt)) {
        throw ApiError.unauthorized('برای تغییر شمارهٔ موبایل، رمز عبور فعلی را وارد کنید.');
      }
      const taken = get('SELECT id FROM users WHERE phone = ? AND id != ?', [data.phone, req.user.id]);
      if (taken) throw ApiError.conflict('این شماره موبایل قبلاً استفاده شده است.');
    }

    const nextPhone = data.phone || user.phone;
    const nextName = data.full_name !== undefined ? data.full_name : user.full_name;
    const nextEmail = data.email !== undefined ? data.email : user.email;
    run('UPDATE users SET phone = ?, full_name = ?, email = ?, updated_at = ? WHERE id = ?',
      [nextPhone, nextName, nextEmail, nowIso(), req.user.id]);
    if (data.phone && data.phone !== user.phone) {
      audit(req.user.id, req.user.role, 'user.change_phone', 'user', req.user.id, { from: user.phone, to: data.phone });
    }
    res.json({ user: get('SELECT id, phone, email, full_name, role, status, created_at FROM users WHERE id = ?', [req.user.id]) });
  } catch (err) { next(err); }
});

router.get('/addresses', (req, res) => {
  const items = all('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC', [req.user.id]);
  res.json({ items });
});

router.post('/addresses', (req, res, next) => {
  try {
    const data = validate(normalizeAddressInput(req.body))
      .string('title', { min: 2, max: 60 })
      .string('province', { min: 2, max: 60 })
      .string('city', { min: 2, max: 60 })
      .string('address_line', { min: 10, max: 300 })
      .string('postal_code', { min: 10, max: 10, pattern: POSTAL_RE, patternMessage: 'کد پستی باید ۱۰ رقم باشد.' })
      .string('recipient_name', { min: 3, max: 80 })
      .string('recipient_phone', { min: 11, max: 11, pattern: PHONE_RE, patternMessage: 'شمارهٔ گیرنده معتبر نیست.' })
      .string('recipient_email', { required: false, max: 120, pattern: EMAIL_RE, patternMessage: 'ایمیل گیرنده معتبر نیست.', default: null })
      .string('refund_card_number', { required: false, pattern: CARD_RE, patternMessage: 'شماره کارت باید ۱۶ رقم باشد.', default: null })
      .string('refund_sheba', { required: false, pattern: SHEBA_RE, patternMessage: 'شماره شبا باید با IR و ۲۴ رقم باشد.', default: null })
      .bool('auto_fill', { default: false })
      .bool('is_default', { default: false })
      .done();
    const id = uuid();
    tx(() => {
      if (data.is_default) {
        run('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [req.user.id]);
      }
      const count = get('SELECT COUNT(*) AS c FROM user_addresses WHERE user_id = ?', [req.user.id]).c;
      run(
        `INSERT INTO user_addresses (id, user_id, title, province, city, address_line, postal_code, recipient_name, recipient_phone, recipient_email,
           refund_card_number, refund_sheba, auto_fill, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, req.user.id, data.title, data.province, data.city, data.address_line, data.postal_code,
          data.recipient_name, data.recipient_phone, data.recipient_email,
          data.refund_card_number, data.refund_sheba, data.auto_fill ? 1 : 0,
          data.is_default || count === 0 ? 1 : 0, nowIso()]
      );
      auditRefundAccountChange(req, id, {}, data);
    });
    res.status(201).json({ address: get('SELECT * FROM user_addresses WHERE id = ?', [id]) });
  } catch (err) { next(err); }
});

router.patch('/addresses/:id', (req, res, next) => {
  try {
    const existing = ownedAddress(req.user.id, req.params.id);
    const input = normalizeAddressInput(req.body);
    const data = validate(input)
      .string('title', { required: false, min: 2, max: 60 })
      .string('province', { required: false, min: 2, max: 60 })
      .string('city', { required: false, min: 2, max: 60 })
      .string('address_line', { required: false, min: 10, max: 300 })
      .string('postal_code', { required: false, min: 10, max: 10, pattern: POSTAL_RE, patternMessage: 'کد پستی باید ۱۰ رقم باشد.' })
      .string('recipient_name', { required: false, min: 3, max: 80 })
      .string('recipient_phone', { required: false, min: 11, max: 11, pattern: PHONE_RE, patternMessage: 'شمارهٔ گیرنده معتبر نیست.' })
      .string('recipient_email', { required: false, max: 120, pattern: EMAIL_RE, patternMessage: 'ایمیل گیرنده معتبر نیست.', default: undefined })
      .string('refund_card_number', { required: false, pattern: CARD_RE, patternMessage: 'شماره کارت باید ۱۶ رقم باشد.', default: undefined })
      .string('refund_sheba', { required: false, pattern: SHEBA_RE, patternMessage: 'شماره شبا باید با IR و ۲۴ رقم باشد.', default: undefined })
      .bool('auto_fill', {})
      .bool('is_default', {})
      .done();
    for (const field of CLEARABLE_ADDRESS_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, field) && (input[field] === null || input[field] === '')) {
        data[field] = null;
      }
    }
    tx(() => {
      if (data.is_default === true) {
        run('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [req.user.id]);
      }
      const merged = { ...existing, ...data };
      run(
        `UPDATE user_addresses SET title = ?, province = ?, city = ?, address_line = ?, postal_code = ?,
           recipient_name = ?, recipient_phone = ?, recipient_email = ?, refund_card_number = ?, refund_sheba = ?,
           auto_fill = ?, is_default = ? WHERE id = ?`,
        [merged.title, merged.province, merged.city, merged.address_line, merged.postal_code,
          merged.recipient_name, merged.recipient_phone, merged.recipient_email || null,
          merged.refund_card_number || null, merged.refund_sheba || null,
          merged.auto_fill ? 1 : 0, merged.is_default ? 1 : 0, existing.id]
      );
      auditRefundAccountChange(req, existing.id, existing, merged);
    });
    res.json({ address: get('SELECT * FROM user_addresses WHERE id = ?', [existing.id]) });
  } catch (err) { next(err); }
});

router.delete('/addresses/:id', (req, res, next) => {
  try {
    const existing = ownedAddress(req.user.id, req.params.id);
    const used = get('SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND address_snapshot LIKE ?', [req.user.id, `%${existing.id}%`]).c;
    if (used > 0) {
      throw ApiError.conflict('این نشانی در سفارش‌های قبلی استفاده شده و قابل حذف نیست؛ می‌توانید آن را ویرایش کنید.');
    }
    run('DELETE FROM user_addresses WHERE id = ?', [existing.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
