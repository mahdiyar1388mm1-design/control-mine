'use strict';

/**
 * Upload validation that does not trust the client-supplied MIME type.
 *
 * - extension and MIME type must both be allow-listed,
 * - the file signature (magic bytes) must match the declared type,
 * - filenames are always regenerated (never derived from user input),
 * - SVG and HTML are rejected outright to prevent stored XSS via uploads.
 */
const crypto = require('crypto');
const path = require('path');
const config = require('../config');
const { ApiError } = require('../utils/errors');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const DOC_EXT = new Set([
  '.pdf', '.zip', '.txt', '.csv', '.docx', '.xlsx', '.pptx'
]);

const SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'image/gif', test: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'application/zip', test: (b) => b[0] === 0x50 && b[1] === 0x4b },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', test: (b) => b[0] === 0x50 && b[1] === 0x4b },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', test: (b) => b[0] === 0x50 && b[1] === 0x4b },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', test: (b) => b[0] === 0x50 && b[1] === 0x4b }
];

function safeExtension(originalName, fallback = '') {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) return fallback;
  return ext;
}

function randomFileName(originalName, fallbackExt = '') {
  return `${crypto.randomUUID()}${safeExtension(originalName, fallbackExt)}`;
}

/** Guards multer's fileFilter for public product images. */
function imageFileFilter(req, file, cb) {
  const ext = safeExtension(file.originalname);
  const okMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
  if (!okMime || !IMAGE_EXT.has(ext) || ext === '.gif') {
    return cb(ApiError.validation('فقط تصویر JPEG/PNG/WebP با پسوند مجاز پذیرفته می‌شود.', [
      { field: 'image', message: `نوع یا پسوند فایل مجاز نیست (${file.mimetype || 'unknown'}).` }
    ]));
  }
  return cb(null, true);
}

/** Guards multer's fileFilter for private documents (service/ticket attachments). */
function documentFileFilter(req, file, cb) {
  const ext = safeExtension(file.originalname);
  const okExt = DOC_EXT.has(ext) || IMAGE_EXT.has(ext);
  const okMime = config.allowedUploadMimes.includes(file.mimetype);
  if (!okExt || !okMime) {
    return cb(ApiError.validation('نوع فایل مجاز نیست.', [
      { field: 'files', message: `نوع ${file.mimetype || 'نامشخص'} یا پسوند ${ext || 'نامشخص'} مجاز نیست.` }
    ]));
  }
  return cb(null, true);
}

/**
 * Verifies the real file type from magic bytes once the file is on disk.
 * `file.path` is provided by multer diskStorage; the declared MIME must be among
 * the signatures actually found, otherwise the file is deleted and an error thrown.
 */
function assertFileSignature(file) {
  const fs = require('fs');
  const fd = fs.openSync(file.path, 'r');
  const head = Buffer.alloc(32);
  try {
    fs.readSync(fd, head, 0, 32, 0);
  } finally {
    fs.closeSync(fd);
  }
  const declared = String(file.mimetype || '').toLowerCase();
  // Plain-text formats have no magic bytes; they are checked by MIME + extension only.
  if (declared === 'text/plain' || declared === 'text/csv') return true;
  const match = SIGNATURES.find((sig) => sig.mime === declared && sig.test(head));
  if (!match) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    throw ApiError.validation('محتوای فایل با نوع اعلام‌شده هم‌خوانی ندارد.', [
      { field: 'files', message: 'فایل ممکن است جعلی یا آسیب‌زا باشد؛ بارگذاری رد شد.' }
    ]);
  }
  return true;
}

module.exports = {
  IMAGE_EXT, DOC_EXT, SIGNATURES,
  safeExtension, randomFileName, imageFileFilter, documentFileFilter, assertFileSignature
};
