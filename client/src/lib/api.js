/**
 * Central API client (§1.3, §5, §14, §16):
 * - Always uses relative /api/v1 paths (never localhost).
 * - Preserves structured error codes (NETWORK_ERROR, UNAUTHORIZED, FORBIDDEN, VALIDATION_ERROR, etc.).
 * - Never masks server failures as empty or zero values.
 */

const TOKEN_KEY = 'cm_session_token';

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore storage quota errors */
  }
}

export class ClientApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message || 'خطا در ارتباط با سرور');
    this.name = 'ClientApiError';
    this.status = status || 0;
    this.code = code || 'UNKNOWN_ERROR';
    this.details = Array.isArray(details) ? details : [];
    this.requestId = requestId || null;
  }
}

export function newIdempotencyKey(prefix = 'cm') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function apiFetch(path, { method = 'GET', body, headers = {}, idempotencyKey, signal } = {}) {
  const reqHeaders = {
    'X-CM-Client': 'web',
    ...headers
  };
  const token = getStoredToken();
  if (token && !reqHeaders.Authorization) {
    reqHeaders.Authorization = `Bearer ${token}`;
  }
  if (idempotencyKey) {
    reqHeaders['Idempotency-Key'] = idempotencyKey;
  }

  let fetchBody;
  if (body instanceof FormData) {
    fetchBody = body;
  } else if (body !== undefined) {
    reqHeaders['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: reqHeaders,
      body: fetchBody,
      credentials: 'include',
      signal
    });
  } catch (networkErr) {
    if (networkErr && networkErr.name === 'AbortError') {
      throw new ClientApiError({ status: 0, code: 'CANCELED', message: 'درخواست لغو شد.' });
    }
    throw new ClientApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: navigator.onLine === false
        ? 'اتصال اینترنت قطع است. لطفاً پس از برقراری اتصال دوباره تلاش کنید.'
        : 'برقراری ارتباط با سرور ممکن نشد. اتصال شبکه را بررسی و دوباره تلاش کنید.'
    });
  }

  const ct = res.headers.get('content-type') || '';
  let parsed = null;
  if (ct.includes('application/json')) {
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const errObj = (parsed && parsed.error) || {};
    throw new ClientApiError({
      status: res.status,
      code: errObj.code || (res.status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR'),
      message: errObj.message || (res.status >= 500 ? 'خطای داخلی سرور رخ داد.' : 'درخواست انجام نشد.'),
      details: errObj.details,
      requestId: errObj.requestId
    });
  }

  return parsed;
}

export async function downloadPrivateFile(fileId, fallbackName = 'document') {
  const headers = { 'X-CM-Client': 'web' };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'GET',
      headers,
      credentials: 'include'
    });
  } catch {
    throw new ClientApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'دانلود فایل به دلیل خطای شبکه انجام نشد.'
    });
  }

  if (!res.ok) {
    let errMsg = 'دسترسی به این فایل مجاز نیست یا فایل یافت نشد.';
    try {
      const data = await res.json();
      if (data && data.error && data.error.message) errMsg = data.error.message;
    } catch { /* ignore */ }
    throw new ClientApiError({ status: res.status, code: 'FILE_ERROR', message: errMsg });
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
