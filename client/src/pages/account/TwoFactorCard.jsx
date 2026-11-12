import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { Icon } from '../../components/Icon';

/**
 * Two-factor authentication card for the account area.
 * Enrollment shows the secret + otpauth URI once, then the recovery codes exactly
 * once — they are stored server-side only as hashes, so they can never be re-shown.
 */
export function TwoFactorCard() {
  const [state, setState] = useState(null); // server status
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [setup, setSetup] = useState(null); // { secret, otpauth_uri }
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);

  // disable / regenerate forms
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [openDisable, setOpenDisable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/auth/mfa/status');
      setState(res);
    } catch (err) {
      setError(err.message || 'دریافت وضعیت ورود دومرحله‌ای ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startSetup = async () => {
    setBusy('setup');
    setError('');
    setNotice('');
    try {
      const res = await apiFetch('/auth/mfa/setup', { method: 'POST' });
      setSetup(res);
      setCode('');
      setRecoveryCodes(null);
    } catch (err) {
      setError(err.message || 'شروع فعال‌سازی ناموفق بود.');
    } finally {
      setBusy('');
    }
  };

  const confirmEnable = async (e) => {
    e.preventDefault();
    setBusy('enable');
    setError('');
    try {
      const res = await apiFetch('/auth/mfa/enable', { method: 'POST', body: { code } });
      setRecoveryCodes(res.recovery_codes || []);
      setSetup(null);
      setCode('');
      await load();
      setNotice('ورود دومرحله‌ای فعال شد.');
    } catch (err) {
      setError(err.message || 'تأیید کد ناموفق بود.');
    } finally {
      setBusy('');
    }
  };

  const submitDisable = async (e) => {
    e.preventDefault();
    setBusy('disable');
    setError('');
    try {
      await apiFetch('/auth/mfa/disable', { method: 'POST', body: { password, code: disableCode } });
      setPassword('');
      setDisableCode('');
      setOpenDisable(false);
      await load();
      setNotice('ورود دومرحله‌ای غیرفعال شد.');
    } catch (err) {
      setError(err.message || 'غیرفعال‌سازی ناموفق بود.');
    } finally {
      setBusy('');
    }
  };

  const regenerate = async (e) => {
    e.preventDefault();
    setBusy('regen');
    setError('');
    try {
      const res = await apiFetch('/auth/mfa/recovery-codes', { method: 'POST', body: { password, code: disableCode } });
      setRecoveryCodes(res.recovery_codes || []);
      setPassword('');
      setDisableCode('');
      await load();
      setNotice('کدهای بازیابی تازه صادر شد؛ کدهای قبلی باطل شدند.');
    } catch (err) {
      setError(err.message || 'صدور کدهای جدید ناموفق بود.');
    } finally {
      setBusy('');
    }
  };

  if (loading) return null;

  return (
    <section className="account-card pw-security-card" aria-label="ورود دومرحله‌ای">
      <header className="account-card-head">
        <h2><Icon name="lock" size={18} /> ورود دومرحله‌ای (2FA)</h2>
        {state && (
          <span className={`badge ${state.enabled ? 'badge-ok' : 'badge-warn'}`}>
            {state.enabled ? 'فعال' : 'غیرفعال'}
          </span>
        )}
      </header>

      {error && <div className="alert-inline error" role="alert">⚠️ {error}</div>}
      {notice && <div className="alert-inline success" role="status">✅ {notice}</div>}

      {state && !state.enabled && !setup && (
        <>
          <p className="account-hint">
            با فعال‌سازی، علاوه بر رمز عبور یک کد ۶ رقمی از برنامهٔ احراز هویت خواسته می‌شود.
            این کار جلوی سوءاستفاده از رمز لو رفته را می‌گیرد.
          </p>
          {state.enforced_for_role && (
            <div className="alert-inline warn">
              برای این نقش حساس، فعال‌سازی ورود دومرحله‌ای به‌شدت توصیه و در مرکز امنیت پایش می‌شود.
            </div>
          )}
          <button type="button" className="btn btn-primary" onClick={startSetup} disabled={busy === 'setup'}>
            {busy === 'setup' ? 'در حال آماده‌سازی...' : 'فعال‌سازی ورود دومرحله‌ای'}
          </button>
        </>
      )}

      {setup && (
        <form className="pw-security-form" onSubmit={confirmEnable}>
          <p className="account-hint">
            این کلید را در برنامهٔ احراز هویت (Google Authenticator، Authy، Microsoft Authenticator یا
            اپ‌های مشابه) ثبت کنید؛ سپس کد نمایش‌داده‌شده را وارد کنید.
          </p>
          <div className="mfa-secret-box">
            <span className="mfa-secret-label">کلید دستی</span>
            <code className="mono" dir="ltr">{setup.secret}</code>
          </div>
          <div className="mfa-secret-box">
            <span className="mfa-secret-label">اتصال مستقیم</span>
            <code className="mono mfa-uri" dir="ltr">{setup.otpauth_uri}</code>
          </div>
          <label htmlFor="mfa-confirm-code">کد ۶ رقمی برنامه</label>
          <input
            id="mfa-confirm-code" className="mono" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)}
          />
          <div className="pw-security-actions">
            <button type="submit" className="btn btn-primary" disabled={busy === 'enable' || code.replace(/\D/g, '').length !== 6}>
              {busy === 'enable' ? 'در حال بررسی...' : 'تأیید و فعال‌سازی'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => { setSetup(null); setCode(''); }}>
              انصراف
            </button>
          </div>
        </form>
      )}

      {recoveryCodes && (
        <div className="mfa-recovery-box" role="alert">
          <h3>کدهای بازیابی — فقط همین یک‌بار نمایش داده می‌شوند</h3>
          <p>اگر دسترسی به برنامهٔ احراز هویت را از دست دادید، هر کد یک‌بار قابل استفاده است. آن‌ها را در جای امن نگه دارید.</p>
          <ul className="mfa-recovery-list" dir="ltr">
            {recoveryCodes.map((item) => <li key={item}><code className="mono">{item}</code></li>)}
          </ul>
          <button type="button" className="btn btn-secondary" onClick={() => setRecoveryCodes(null)}>
            کدها را ذخیره کردم
          </button>
        </div>
      )}

      {state && state.enabled && !openDisable && (
        <>
          <p className="account-hint">
            ورود دومرحله‌ای فعال است. کدهای بازیابی باقی‌مانده: <strong>{state.recovery_codes_left}</strong>
          </p>
          <div className="pw-security-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setOpenDisable(true)}>غیرفعال‌سازی</button>
          </div>
        </>
      )}

      {state && state.enabled && openDisable && (
        <div className="pw-security-form">
          <form onSubmit={submitDisable}>
            <p className="account-hint">برای غیرفعال‌سازی، رمز عبور و یک کد فعلی برنامه را وارد کنید.</p>
            <label htmlFor="mfa-disable-pass">رمز عبور</label>
            <input id="mfa-disable-pass" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <label htmlFor="mfa-disable-code">کد برنامه</label>
            <input id="mfa-disable-code" className="mono" dir="ltr" inputMode="numeric" maxLength={6} required value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
            <div className="pw-security-actions">
              <button type="submit" className="btn btn-secondary ac-btn-danger" disabled={busy === 'disable'}>
                {busy === 'disable' ? 'در حال بررسی...' : 'غیرفعال کردن'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setOpenDisable(false)}>بازگشت</button>
            </div>
          </form>
          <form onSubmit={regenerate} className="mfa-regen">
            <p className="account-hint">صدور کدهای بازیابی جدید (کدهای قبلی باطل می‌شوند):</p>
            <button type="submit" className="btn btn-secondary" disabled={busy === 'regen' || !password || !disableCode}>
              {busy === 'regen' ? 'در حال صدور...' : 'صدور کدهای بازیابی جدید'}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
