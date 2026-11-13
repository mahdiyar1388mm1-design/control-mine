'use strict';

const { ApiError } = require('../utils/errors');
const logger = require('../utils/logger');

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'مسیر درخواستی وجود ندارد.', requestId: req.id }
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error(err.message, { requestId: req.id, code: err.code });
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        requestId: req.id,
        ...(err.details ? { details: err.details } : {})
      }
    });
    return;
  }
  if (err && err.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'بدنهٔ درخواست JSON معتبر نیست.', requestId: req.id }
    });
    return;
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'حجم فایل بیش از حد مجاز است.', requestId: req.id }
    });
    return;
  }
  logger.error(`unhandled error: ${err && err.message}`, { requestId: req.id, stack: err && err.stack });
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'خطای داخلی سرور رخ داد.', requestId: req.id }
  });
}

module.exports = { notFoundHandler, errorHandler };
