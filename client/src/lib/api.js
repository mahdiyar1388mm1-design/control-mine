/**
 * Central API client.
 *
 * Design rules (security-relevant, do not "simplify" these away):
 *  - Only relative `/api/v1` URLs. The SPA is always served by the same origin,
 *    so a preview/proxy host works without any allowlist.
 *  - Cookie sessions are protected by the double-submit CSRF scheme: the server
 *    sets `cm_csrf` (readable by JS) and every state-changing request must echo
 *    it in `x-csrf-token`. Bearer-token requests are exempt server-side.
 *  - The refresh endpoint is special: it is a state-changing POST that can only
 *    be authorised by the httpOnly refresh cookie, so the browser cannot send a
 *    Bearer token for it. It must therefore always carry the CSRF header, and it
 *    must never block the retry loop when the token is missing — instead the
 *    token is fetched on demand and the call is repeated exactly once.
 */
import { formatPersianDigits } from './format';

const API_BASE = '/api/v1';
const TOKEN_KEY = 'cm_session_token';
const REFRESH_KEY = 'cm_refresh_token';
const CSRF_KEY = 'cm_csrf_token';

function readStore(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota: the cookie session still works */
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

  /** True for the server's "توکن امنیتی درخواست نامعتبر است (CSRF)" answer. */
  get isCsrfError() {
    return this.status === 403 && /CSRF/i.test(this.message || '');
  }
}

export function newIdempotencyKey(prefix = 'cm') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// CSRF token lifecycle
// ---------------------------------------------------------------------------

let csrfInFlight = null;

/**
 * Fetches the double-submit token. The server also sets the `cm_csrf` cookie, so
 * afterwards both the cookie and the stored copy agree. `force` bypasses the
 * cache and is used after a rejected request (stale cookie after switching tabs).
 */
export async function ensureCsrfToken({ force = false } = {}) {
  if (!force) {
    const existing = csrfHeaderValue();
    if (existing) return existing;
  }
  if (csrfInFlight) return csrfInFlight;
  csrfInFlight = (async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(`${API_BASE}/auth/csrf`, {
          credentials: 'include',
          headers: { 'X-CM-Client': 'web' }
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.csrf_token) {
            setCsrfToken(data.csrf_token);
            return data.csrf_token;
          }
        }
      } catch {
        /* network hiccup: retry once, then give up */
      }
    }
    return null;
  })().finally(() => { csrfInFlight = null; });
  return csrfInFlight;
}

// ---------------------------------------------------------------------------
// Refresh (rotating, single-flight)
// ---------------------------------------------------------------------------

let refreshInFlight = null;

/** Rotates the refresh token once; concurrent 401s share the same call. */
async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    const body = refreshToken ? JSON.stringify({ refresh_token: refreshToken }) : undefined;
    // The CSRF header is mandatory here (cookie-only authentication path).
    let csrf = await ensureCsrfToken();
    const attempt = () => fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CM-Client': 'web',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {})
      },
      body,
      credentials: 'include'
    });

    let res = await attempt();
    if (res.status === 403 && /CSRF/i.test(await res.clone().text().catch(() => ''))) {
      // Stale cookie (e.g. logged in from another tab): refetch and retry once.
      csrf = await ensureCsrfToken({ force: true });
      if (csrf) res = await attempt();
    }
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

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

function buildHeaders({ method, headers, idempotencyKey, csrf }) {
  const reqHeaders = { 'X-CM-Client': 'web', ...headers };
  const token = getStoredToken();
  if (token && !reqHeaders.Authorization) reqHeaders.Authorization = `Bearer ${token}`;
  if (idempotencyKey) reqHeaders['Idempotency-Key'] = idempotencyKey;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrf) {
    reqHeaders['X-CSRF-Token'] = csrf;
  }
  return reqHeaders;
}

async function doFetch(path, { method, body, headers, idempotencyKey, signal }) {
  const isForm = body instanceof FormData;
  const sameOriginOnly = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  let csrf = sameOriginOnly ? csrfHeaderValue() : '';
  if (sameOriginOnly && !csrf) csrf = await ensureCsrfToken();

  const send = () => {
    const reqHeaders = buildHeaders({ method, headers, idempotencyKey, csrf });
    let fetchBody;
    if (isForm) {
      fetchBody = body;
    } else if (body !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(body);
    }
    return fetch(`${API_BASE}${path}`, {
      method,
      headers: reqHeaders,
      body: fetchBody,
      credentials: 'include',
      signal
    });
  };

  const res = await send();
  // A rejected double-submit usually means our copy is stale (other tab, cookie
  // cleared, session rotated). Refresh it once and repeat instead of showing the
  // user a confusing 403.
  if (res.status === 403 && sameOriginOnly) {
    const text = await res.clone().text().catch(() => '');
    if (/CSRF/i.test(text)) {
      csrf = await ensureCsrfToken({ force: true });
      if (csrf) return send();
    }
  }
  return res;
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
    const isCsrf = res.status === 403 && /CSRF/i.test(errObj.message || '');
    if (isCsrf && retry) {
      // Last resort after the automatic token refetch failed: drop the stale
      // cookies/tokens once and repeat. The user should never have to know that
      // a half-deleted cookie pair was the problem.
      await recoverSession();
      return apiFetch(path, { method, body, headers, idempotencyKey, signal, retry: false });
    }
    throw new ClientApiError({
      status: res.status,
      code: errObj.code || (res.status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR'),
      message: isCsrf
        ? CSRF_HELP_TEXT
        : (errObj.message || (res.status >= 500 ? 'خطای داخلی سرور رخ داد.' : 'درخواست انجام نشد.')),
      details: errObj.details,
      requestId: errObj.requestId
    });
  }

  return localizeFormattedCurrency(parsed);
}

/**
 * Raw fetch for uploads/CSV downloads that must NOT go through apiFetch
 * (FormData bodies, binary responses). It still has to carry the session:
 * `credentials: 'include'` sends the httpOnly cookie, and any state-changing
 * call must also echo the double-submit CSRF token.
 */
export function authFetch(input, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };
  const token = getStoredToken();
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const csrf = needsCsrf ? csrfHeaderValue() : '';
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return fetch(input, { ...init, headers, credentials: 'include' });
}

/** Stores the token pair returned by login/register/otp/refresh. */
export function storeSessionTokens(data) {
  if (!data) return;
  if (data.token) setStoredToken(data.token);
  if (data.refreshToken) setRefreshToken(data.refreshToken);
}

/** Clears every local trace of the session (call on logout/401 everywhere). */
export function clearSessionTokens() {
  writeStore(TOKEN_KEY, null);
  writeStore(REFRESH_KEY, null);
  writeStore(CSRF_KEY, null);
}

/** Downloads a private file with the current session (Bearer or cookie). */
export async function downloadPrivateFile(path, filename) {
  const res = await authFetch(`${API_BASE}${path}`);
  if (!res.ok) throw new ClientApiError({ status: res.status, message: 'دانلود فایل ناموفق بود.' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Persian-digit localisation of pre-formatted money strings coming from the API.
 * Kept here because every response passes through apiFetch.
 */
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

// ---------------------------------------------------------------------------
// Stale-cookie recovery
// ---------------------------------------------------------------------------

/** Drops every auth cookie the browser holds for this origin (best effort). */
function clearAuthCookies() {
  const cookies = String(document.cookie || '').split(';').map((c) => c.split('=')[0].trim());
  for (const name of ['cm_token', 'cm_refresh', 'cm_csrf', ...cookies]) {
    if (!name) continue;
    document.cookie = `${name}=; Max-Age=0; path=/`;
    document.cookie = `${name}=; Max-Age=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

/**
 * Repairs the classic "stuck" state: the browser still sends a `cm_token` cookie
 * (so the server applies CSRF protection) but the matching `cm_csrf` cookie is
 * gone or does not match, and the stored access token cannot be refreshed.
 *
 * Manual recovery is not acceptable UX — especially on the login page, where a
 * stale cookie used to make even signing in answer 403. This clears the local
 * session material so the next request is a clean, cookie-free one.
 */
export async function recoverSession() {
  clearSessionTokens();
  clearAuthCookies();
  await ensureCsrfToken({ force: true }).catch(() => null);
  return true;
}

/** Persian, actionable message for CSRF rejections that could not self-heal. */
export const CSRF_HELP_TEXT =
  'نشست مرورگر شما با سرور هم‌خوان نیست. صفحه یک‌بار تازه شد؛ اگر باز هم تکرار شد، '
  + 'خروج و ورود دوباره یا بارگذاری سخت (Ctrl+Shift+R) را انجام دهید.';
