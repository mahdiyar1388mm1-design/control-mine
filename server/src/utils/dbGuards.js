'use strict';

/**
 * Runtime guards that turn application-level assumptions into loud failures.
 * Used by the money/stock paths so a logic bug can never silently corrupt data.
 */
const { ApiError } = require('./errors');

function assertNonNegativeInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw ApiError.internal(`مقدار نامعتبر برای ${label}`);
  }
}

function assertPositiveInt(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw ApiError.internal(`مقدار نامعتبر برای ${label}`);
  }
}

function assertBigIntString(value, label) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw ApiError.internal(`مقدار عددی نامعتبر برای ${label}`);
  }
}

/**
 * Escapes LIKE wildcards so user search text is always treated as a literal.
 * SQLite treats `\\` as the default escape character when ESCAPE is not given,
 * so the same pattern works with or without an explicit ESCAPE clause.
 */
function likeTerm(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/** Builds a bounded `%term%` pattern for `col LIKE ?` (literal match). */
function likeContains(value, maxLength = 120) {
  return `%${likeTerm(String(value == null ? '' : value).slice(0, maxLength))}%`;
}

module.exports = { assertNonNegativeInt, assertPositiveInt, assertBigIntString, likeTerm, likeContains };
