'use strict';

const crypto = require('crypto');
const { ApiError } = require('./errors');

const PHONE_RE = /^09\d{9}$/;

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

/** Human-friendly tracking code, e.g. CM-7F3K9Q2X */
function humanCode(prefix) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `${prefix}-${out}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hashBody(value) {
  return sha256(typeof value === 'string' ? value : JSON.stringify(value));
}

class Validator {
  constructor(input) {
    this.input = input && typeof input === 'object' ? input : {};
    this.errors = [];
    this.out = {};
  }

  string(field, { min = 0, max = 10000, required, trim = true, pattern, patternMessage, enum: enumValues, default: defaultValue } = {}) {
    const isRequired = required !== undefined ? required : defaultValue === undefined;
    let value = this.input[field];
    if (value === undefined || value === null || value === '') {
      if (isRequired) this.errors.push({ field, message: 'این فیلد الزامی است.' });
      else if (defaultValue !== undefined) this.out[field] = defaultValue;
      return this;
    }
    if (typeof value !== 'string') {
      this.errors.push({ field, message: 'نوع مقدار نادرست است.' });
      return this;
    }
    if (trim) value = value.trim();
    if (value.length < min) this.errors.push({ field, message: `حداقل ${min} حرف لازم است.` });
    else if (value.length > max) this.errors.push({ field, message: `حداکثر ${max} حرف مجاز است.` });
    else if (pattern && !pattern.test(value)) this.errors.push({ field, message: patternMessage || 'قالب مقدار نادرست است.' });
    else if (enumValues && !enumValues.includes(value)) this.errors.push({ field, message: 'مقدار خارج از فهرست مجاز است.' });
    else this.out[field] = value;
    return this;
  }

  phone(field = 'phone') {
    return this.string(field, { min: 11, max: 11, pattern: PHONE_RE, patternMessage: 'شماره موبایل معتبر نیست (مثال: 09121234567).' });
  }

  int(field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, required, default: defaultValue } = {}) {
    const isRequired = required !== undefined ? required : defaultValue === undefined;
    let value = this.input[field];
    if (value === undefined || value === null || value === '') {
      if (isRequired) this.errors.push({ field, message: 'این فیلد الزامی است.' });
      else if (defaultValue !== undefined) this.out[field] = defaultValue;
      return this;
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(num)) this.errors.push({ field, message: 'مقدار باید عدد صحیح باشد.' });
    else if (num < min) this.errors.push({ field, message: `حداقل مقدار ${min} است.` });
    else if (num > max) this.errors.push({ field, message: `حداکثر مقدار ${max} است.` });
    else this.out[field] = num;
    return this;
  }

  bool(field, { required = false, default: defaultValue } = {}) {
    let value = this.input[field];
    if (value === undefined || value === null) {
      if (required) this.errors.push({ field, message: 'این فیلد الزامی است.' });
      else if (defaultValue !== undefined) this.out[field] = defaultValue;
      return this;
    }
    if (typeof value === 'boolean') this.out[field] = value;
    else if (value === 0 || value === 1 || value === '0' || value === '1') this.out[field] = Boolean(Number(value));
    else this.errors.push({ field, message: 'مقدار باید درست/نادرست باشد.' });
    return this;
  }

  custom(field, check, message) {
    const value = this.input[field];
    if (value !== undefined && value !== null && !check(value)) {
      this.errors.push({ field, message });
    }
    return this;
  }

  done() {
    if (this.errors.length) {
      throw ApiError.validation('اطلاعات فرم نامعتبر است.', this.errors);
    }
    return this.out;
  }
}

function validate(input) {
  return new Validator(input);
}

function parseIntParam(value, { min = 1, max = 100, fallback } = {}) {
  const num = Number(value);
  if (!Number.isInteger(num)) {
    if (fallback !== undefined) return fallback;
    throw ApiError.validation('پارامتر نامعتبر است.');
  }
  return Math.min(max, Math.max(min, num));
}

function parsePagination(query) {
  const page = parseIntParam(query.page, { min: 1, max: 100000, fallback: 1 });
  const limit = parseIntParam(query.limit, { min: 1, max: 100, fallback: 20 });
  return { page, limit, offset: (page - 1) * limit };
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function parseJsonObject(text, fallback = {}) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonArray(text, fallback = []) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  PHONE_RE, nowIso, uuid, humanCode, sha256, hashBody,
  validate, parseIntParam, parsePagination, isPositiveInt,
  parseJsonObject, parseJsonArray
};
