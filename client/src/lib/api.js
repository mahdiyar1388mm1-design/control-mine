import { formatPersianDigits } from './format';

/**
 * Central API client (§1.3, §5, §14, §16):
 * - Always uses relative /api/v1 paths (never localhost).
 * - Preserves structured error codes (NETWORK_ERROR, UNAUTHORIZED, FORBIDDEN, VALIDATION_ERROR, etc.).
 * - Never masks server failures as empty or zero values.
 * - Sends the double-submit CSRF token on state-changing cookie-auth requests.
 * - Transparently refreshes the session once on 401 before surfacing the error.
 */

const TOKEN_KEY = 'cm_session_token';
const REFRESH_KEY = 'cm_refresh_token';
const CSRF_KEY = 'cm_csrf_token';
const FORMATTED_CURRENCY_KEY = /(?:irr|toman).*formatted|formatted.*(?:irr|toman)/i;

function localizeFormattedCurrency(value) {
  if (Array.isArray(value)) {
    return value.map((item) => localizeFormattedCurrency(item));
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    FORMATTED_CURRENCY_KEY.test(key) && typeof item === 'string'
      ? formatPersianDigits(item)
      : localizeFormattedCurrency(item)
  ]));
}

function readStore(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore storage quota errors */
  }
}

export function getStoredToken() {
  return readStore(TOKEN_KEY);
}

export function setStoredToken(token) {
  writeStore(TOKEN_KEY, token);
}

export function getRefreshToken() {
  return readStore(REFRESH_KEY);
}

function setRefreshToken(token) {
  writeStore(REFRESH_KEY, token);
}

function setCsrfToken(token) {
  writeStore(CSRF_KEY, token);
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function csrfHeaderValue() {
  return readCookie('cm_csrf') || readStore(CSRF_KEY) || '';
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

let refreshInFlight = null;

/** Rotates the refresh token once; concurrent 401s share the same call. */
async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = getRefreshToken();
  const body = refreshToken ? JSON.stringify({ refresh_token: refreshToken }) : undefined;
  refreshInFlight = (async () => {
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CM-Client': 'web' },
      body,
      credentials: 'include'
    });
    if (!res.ok) return null;
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!data) return null;
    if (data.token) setStoredToken(data.token);
    if (data.refreshToken) setRefreshToken(data.refreshToken);
    return data;
  })()
    .catch(() => null)
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function doFetch(path, { method, body, headers, idempotencyKey, signal }) {
  const reqHeaders = { 'X-CM-Client': 'web', ...headers };
  const token = getStoredToken();
  if (token && !reqHeaders.Authorization) reqHeaders.Authorization = `Bearer ${token}`;
  if (idempotencyKey) reqHeaders['Idempotency-Key'] = idempotencyKey;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = csrfHeaderValue();
    if (csrf) reqHeaders['X-CSRF-Token'] = csrf;
  }

  let fetchBody;
  if (body instanceof FormData) {
    fetchBody = body;
  } else if (body !== undefined) {
    reqHeaders['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  return fetch(`/api/v1${path}`, {
    method,
    headers: reqHeaders,
    body: fetchBody,
    credentials: 'include',
    signal
  });
}

export async function apiFetch(path, { method = 'GET', body, headers = {}, idempotencyKey, signal, retry = true } = {}) {
  let res;
  try {
    res = await doFetch(path, { method, body, headers, idempotencyKey, signal });
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

  // One transparent refresh attempt for expired short-lived access tokens.
  if (res.status === 401 && retry && !path.startsWith('/auth/refresh') && !path.startsWith('/auth/login')) {
    const refreshed = await refreshSession();
    if (refreshed) return apiFetch(path, { method, body, headers, idempotencyKey, signal, retry: false });
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

  return localizeFormattedCurrency(parsed);
}

/** Fetches (and caches) a double-submit CSRF token for cookie-based sessions. */
export async function ensureCsrfToken() {
  try {
    const res = await fetch('/api/v1/auth/csrf', { credentials: 'include', headers: { 'X-CM-Client': 'web' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.csrf_token) setCsrfToken(data.csrf_token);
    return data ? data.csrf_token : null;
  } catch {
    return null;
  }
}

/** Stores the token pair returned by login/register/otp/refresh. */
export function storeSessionTokens(res) {
  if (!res) return;
  if (res.token) setStoredToken(res.token);
  if (res.refreshToken) setRefreshToken(res.refreshToken);
}

export function clearSessionTokens() {
  setStoredToken(null);
  writeStore(REFRESH_KEY, null);
  writeStore(CSRF_KEY, null);
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

/**
 * Raw fetch for uploads/CSV downloads that must NOT go through apiFetch
 * (FormData bodies, binary responses). It still has to carry the session:
 * `credentials: 'include'` sends the httpOnly cookie, and any state-changing
 * call must also echo the double-submit CSRF token, otherwise the server
 * (correctly) answers 403 "توکن امنیتی درخواست نامعتبر است (CSRF)".
 */
export function authFetch(input, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };
  const token = getStoredToken();
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = csrfHeaderValue();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  return fetch(input, { ...init, headers, credentials: 'include' });
}
