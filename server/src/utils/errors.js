'use strict';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }

  static validation(message, details) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'برای ادامه وارد حساب کاربری شوید.') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'شما مجوز انجام این عملیات را ندارید.') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'موردی یافت نشد.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message, details) {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static invalidState(message, details) {
    return new ApiError(409, 'INVALID_STATE', message, details);
  }

  static outOfStock(message, details) {
    return new ApiError(409, 'OUT_OF_STOCK', message, details);
  }

  static rateLimited(message = 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static paymentRequired(message = 'برای ادامه، پرداخت انجام نشده است.') {
    return new ApiError(402, 'PAYMENT_REQUIRED', message);
  }

  static internal(message = 'خطای داخلی رخ داد.') {
    return new ApiError(500, 'INTERNAL', message);
  }
}

module.exports = { ApiError };
