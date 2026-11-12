import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { FieldErrorsList } from '../../components/StateViews';

/** Short, human-readable device label from a user-agent string. */
function deviceLabel(ua) {
  if (!ua) return 'دستگاه نامشخص';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari' : 'مرورگر';
  const os = /Android/.test(ua) ? 'اندروید'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Windows/.test(ua) ? 'ویندوز'
        : /Mac OS/.test(ua) ? 'مک'
          : /Linux/.test(ua) ? 'لینوکس' : 'سیستم';
  return `${browser} روی ${os}`;
}

export function SessionsCard() {
  const { logoutEverywhere } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await apiFetch('/auth/sessions');
      setState({ loading: false, error: null, items: res.items || [] });
    } catch (error) {
      setState({ loading: false, error, items: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    setBusy(true);
    setErr(null);
    setMsg('');
    try {
      await apiFetch(`/auth/sessions/${id}`, { method: 'DELETE' });
      setMsg('آن نشست بسته شد.');
      await load();
    } catch (error) {
      setErr(error);
    } finally {
      setBusy(false);
    }
  };

  const closeAll = async () => {
    setBusy(true);
    setErr(null);
    setMsg('');
    try {
      const res = await logoutEverywhere();
      setMsg(`همهٔ نشست‌های دیگر بسته شدند (${(res?.revoked_sessions ?? 0).toLocaleString('fa-IR')} نشست).`);
      await load();
    } catch (error) {
      setErr(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="sessions-title">
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 id="sessions-title" style={{ margin: 0, fontSize: '1.08rem' }}>دستگاه‌های واردشده به حساب</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
            اگر دستگاهی را نمی‌شناسید، همان‌جا ببندید و رمز عبور را تغییر دهید.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={closeAll} disabled={busy}>
          بستن همهٔ نشست‌های دیگر
        </button>
      </div>

      {msg && <div className="alert-inline ok" role="status" style={{ marginTop: 10 }}>✓ {msg}</div>}
      {err && (
        <>
          <div className="alert-inline error" role="alert" style={{ marginTop: 10 }}>⚠️ {err.message}</div>
          <FieldErrorsList details={err.details} />
        </>
      )}

      {state.loading && <p className="muted" style={{ marginTop: 12 }}>در حال دریافت فهرست نشست‌ها...</p>}
      {state.error && (
        <div className="alert-inline error" role="alert" style={{ marginTop: 12 }}>
          دریافت فهرست نشست‌ها ناموفق بود: {state.error.message}
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginInlineStart: 8 }} onClick={load}>تلاش دوباره</button>
        </div>
      )}

      {!state.loading && !state.error && (
        <div className="session-list">
          {state.items.filter((s) => !s.revoked).map((s) => (
            <div key={s.id} className={`session-row${s.current ? ' is-current' : ''}`}>
              <div className="session-main">
                <strong>{deviceLabel(s.user_agent)}</strong>
                {s.current && <span className="session-badge">همین دستگاه</span>}
                <div className="muted session-meta">
                  آخرین فعالیت: {formatDateTime(s.last_used_at || s.created_at)}
                  {s.ip ? ` — ${s.ip}` : ''}
                </div>
              </div>
              {!s.current && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => revoke(s.id)}>
                  بستن
                </button>
              )}
            </div>
          ))}
          {state.items.filter((s) => !s.revoked).length === 0 && (
            <p className="muted">نشست فعالی یافت نشد.</p>
          )}
        </div>
      )}
    </section>
  );
}
