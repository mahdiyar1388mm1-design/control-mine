import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatDateTime, ROLE_LABELS } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { EmptyState, ErrorState, FieldErrorsList, LoadingState } from '../components/StateViews';

export function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextUrl = searchParams.get('next') || '/';
  const { user, login, register, requestOtp, verifyOtp } = useAuth();

  const [mode, setMode] = useState('login'); // login | otp | register
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [sandboxHint, setSandboxHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user) {
      navigate(nextUrl, { replace: true });
    }
  }, [user, navigate, nextUrl]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone.trim(), password);
      navigate(nextUrl, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ phone: phone.trim(), full_name: fullName.trim(), password, email: email.trim() });
      navigate(nextUrl, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSandboxHint('');
    try {
      const res = await requestOtp(phone.trim());
      setOtpSent(true);
      if (res.dev_code) {
        setSandboxHint(`کانال پیامک واقعی متصل نیست؛ کد یک‌بارمصرف آزمایشی (Sandbox): ${res.dev_code}`);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(phone.trim(), otpCode.trim());
      navigate(nextUrl, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const setAuthMode = (nextMode) => {
    setMode(nextMode);
    setError(null);
    setSandboxHint('');
    if (nextMode !== 'otp') {
      setOtpSent(false);
      setOtpCode('');
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-card" aria-label="ورود به حساب کاربری">
        <div className="auth-form-panel">
          <div className="auth-form-heading">
            <h1>{mode === 'register' ? 'ایجاد حساب کاربری' : mode === 'otp' ? 'ورود با کد یک‌بارمصرف' : 'ورود به حساب کاربری'}</h1>
          </div>

          <div className="auth-mode-tabs" aria-label="انتخاب ورود یا ثبت‌نام">
            <button type="button" className={mode !== 'register' ? 'active' : ''} aria-pressed={mode !== 'register'} onClick={() => setAuthMode('login')}>ورود</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} aria-pressed={mode === 'register'} onClick={() => setAuthMode('register')}>ثبت‌نام</button>
          </div>
          <p className="auth-form-intro">{mode === 'register' ? 'برای ساخت حساب، اطلاعات زیر را وارد کنید.' : mode === 'otp' ? 'شمارهٔ همراه خود را وارد کنید تا کد ورود برایتان صادر شود.' : 'برای ادامه، شمارهٔ همراه و رمز عبورتان را وارد کنید.'}</p>

          {error && (
            <>
              <div className="alert-inline error" role="alert">⚠️ {error.message}</div>
              <FieldErrorsList details={error.details} />
            </>
          )}

          {mode === 'login' && (
            <form className="auth-form" onSubmit={handleLogin}>
              <div className="auth-field">
                <label htmlFor="login-phone">شماره موبایل</label>
                <div className="auth-input-wrap">
                  <input id="login-phone" className="mono" type="tel" inputMode="numeric" dir="ltr" autoComplete="tel" aria-describedby="login-phone-help" required placeholder="0912 345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <span id="login-phone-help" className="auth-field-help">شماره‌ای را وارد کنید که هنگام ثبت‌نام استفاده کرده‌اید.</span>
              </div>
              <div className="auth-field">
                <label htmlFor="login-pass">رمز عبور</label>
                <div className="auth-input-wrap auth-password-wrap">
                  <input id="login-pass" type={showPassword ? 'text' : 'password'} autoComplete="current-password" aria-describedby="login-pass-help" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="auth-reveal" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}>{showPassword ? 'پنهان' : 'نمایش'}</button>
                </div>
                <span id="login-pass-help" className="auth-field-help">رمز عبور حساب کاربری‌تان را وارد کنید.</span>
                <button type="button" className="auth-text-link auth-forgot" onClick={() => setAuthMode('otp')}>رمز را ندارید؟ ورود با کد یک‌بارمصرف</button>
              </div>
              <button type="submit" className="auth-submit" disabled={busy}>
                <span>{busy ? 'در حال بررسی...' : 'ورود به حساب'}</span><span aria-hidden="true">←</span>
              </button>
            </form>
          )}

          {mode === 'otp' && (
            !otpSent ? (
              <form className="auth-form" onSubmit={handleRequestOtp}>
                <div className="alert-inline warn auth-sandbox-note">پیامک در حالت آزمایشی است؛ کد ورود ممکن است در همین صفحه نمایش داده شود.</div>
                <div className="auth-field">
                  <label htmlFor="otp-phone">شماره موبایل</label>
                  <div className="auth-input-wrap">
                    <input id="otp-phone" className="mono" type="tel" inputMode="numeric" dir="ltr" autoComplete="tel" required placeholder="0912 345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                </div>
                <button type="submit" className="auth-submit" disabled={busy}>{busy ? 'در حال ارسال کد...' : 'دریافت کد ورود'}<span aria-hidden="true">←</span></button>
                <button type="button" className="auth-text-link auth-back-to-login" onClick={() => setAuthMode('login')}>بازگشت به ورود با رمز عبور</button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleVerifyOtp}>
                {sandboxHint && <div className="alert-inline info">{sandboxHint}</div>}
                <div className="auth-field">
                  <label htmlFor="otp-code">کد تأیید</label>
                  <div className="auth-input-wrap"><input id="otp-code" className="mono auth-otp-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" aria-describedby="otp-code-help" required maxLength={6} placeholder="— — — — — —" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} /></div>
                  <span id="otp-code-help" className="auth-field-help">کد ۶ رقمی ارسال‌شده را وارد کنید.</span>
                </div>
                <div className="auth-otp-actions">
                  <button type="button" className="auth-text-link" onClick={() => { setOtpSent(false); setOtpCode(''); setSandboxHint(''); }}>تغییر شماره</button>
                  <button type="submit" className="auth-submit" disabled={busy}>{busy ? 'در حال بررسی...' : 'تأیید کد و ورود'}</button>
                </div>
              </form>
            )
          )}

          {mode === 'register' && (
            <form className="auth-form auth-register-form" onSubmit={handleRegister}>
              <div className="auth-field"><label htmlFor="reg-name">نام و نام خانوادگی</label><div className="auth-input-wrap"><input id="reg-name" autoComplete="name" required minLength={3} value={fullName} onChange={(e) => setFullName(e.target.value)} /></div></div>
              <div className="auth-field"><label htmlFor="reg-phone">شماره موبایل</label><div className="auth-input-wrap"><input id="reg-phone" className="mono" type="tel" inputMode="numeric" dir="ltr" autoComplete="tel" aria-describedby="reg-phone-help" required placeholder="0912 345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} /></div><span id="reg-phone-help" className="auth-field-help">از شمارهٔ همراه فعال خود استفاده کنید.</span></div>
              <div className="auth-field"><label htmlFor="reg-email">رایانامه (اختیاری)</label><div className="auth-input-wrap"><input id="reg-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div></div>
              <div className="auth-field"><label htmlFor="reg-pass">رمز عبور</label><div className="auth-input-wrap"><input id="reg-pass" type={showPassword ? 'text' : 'password'} autoComplete="new-password" aria-describedby="reg-pass-help" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="auth-reveal" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}>{showPassword ? 'پنهان' : 'نمایش'}</button></div><span id="reg-pass-help" className="auth-field-help">حداقل ۸ نویسه انتخاب کنید؛ رمز قوی‌تر امنیت حساب را بیشتر می‌کند.</span></div>
              <button type="submit" className="auth-submit" disabled={busy}>{busy ? 'در حال ایجاد حساب...' : 'ایجاد حساب کاربری'}<span aria-hidden="true">←</span></button>
            </form>
          )}

          {mode === 'otp' && !otpSent && (
            <div className="auth-signup-prompt auth-otp-prompt">
              <button type="button" className="auth-text-link" onClick={() => setAuthMode('register')}>حساب ندارید؟ ثبت‌نام کنید</button>
            </div>
          )}
          <p className="auth-security-note"><span aria-hidden="true">♢</span> امنیت اطلاعات شما برای ما اهمیت دارد</p>
        </div>

      </section>
    </div>
  );
}

export function ProfileAddressesPage() {
  const { user, authLoading, refreshMe } = useAuth();
  const [profile, setProfile] = useState({ full_name: '', email: '', phone: '', current_password: '' });
  const [pwdForm, setPwdForm] = useState({ old_password: '', new_password: '' });
  const [addresses, setAddresses] = useState([]);
  const [addrForm, setAddrForm] = useState({
    title: '', province: '', city: '', address_line: '', postal_code: '', recipient_name: '', recipient_phone: ''
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadAccount = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [pRes, aRes] = await Promise.all([
        apiFetch('/me/profile'),
        apiFetch('/me/addresses')
      ]);
      setProfile({
        full_name: pRes.user.full_name || '',
        email: pRes.user.email || '',
        phone: pRes.user.phone || '',
        current_password: ''
      });
      setAddresses(aRes.items || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) loadAccount();
  }, [authLoading, loadAccount]);

  if (authLoading || loading) return <LoadingState label="در حال بارگذاری حساب کاربری..." />;
  if (!user) return <EmptyState title="وارد حساب کاربری نشده‌اید" actionLabel="ورود" actionTo="/auth?next=/account" />;
  if (error) return <ErrorState error={error} onRetry={loadAccount} />;

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setOpErr(null);
    try {
      await apiFetch('/me/profile', { method: 'PATCH', body: profile });
      setProfile((p) => ({ ...p, current_password: '' }));
      await refreshMe();
      setMsg('اطلاعات پروفایل در سرور ذخیره شد.');
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setOpErr(null);
    try {
      const res = await apiFetch('/auth/change-password', { method: 'POST', body: pwdForm });
      setPwdForm({ old_password: '', new_password: '' });
      setMsg(res.message || 'رمز عبور تغییر کرد.');
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleAddAddress = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setOpErr(null);
    try {
      await apiFetch('/me/addresses', { method: 'POST', body: addrForm });
      setAddrForm({ title: '', province: '', city: '', address_line: '', postal_code: '', recipient_name: '', recipient_phone: '' });
      await loadAccount();
      setMsg('نشانی جدید ثبت شد.');
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAddress = async (id) => {
    setBusy(true);
    setMsg('');
    setOpErr(null);
    try {
      await apiFetch(`/me/addresses/${id}`, { method: 'DELETE' });
      await loadAccount();
      setMsg('نشانی حذف شد.');
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">حساب کاربری من</h1>
          <p className="page-subtitle">نقش فعلی: <strong>{ROLE_LABELS[user.role] || user.role}</strong></p>
        </div>
      </div>

      {msg && <div className="alert-inline ok" role="status">✓ {msg}</div>}
      {opErr && (
        <>
          <div className="alert-inline error" role="alert">⚠️ {opErr.message}</div>
          <FieldErrorsList details={opErr.details} />
        </>
      )}

      <div className="grid grid-2">
        <form onSubmit={handleSaveProfile} className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>اطلاعات تماس و هویتی</h2>
          <div className="form-row">
            <label className="form-label">نام و نام خانوادگی</label>
            <input className="input" required value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
          </div>
          <div className="form-row">
            <label className="form-label">رایانامه</label>
            <input className="input mono" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
          <div className="form-row">
            <label className="form-label">شماره موبایل (تغییر آن نیازمند رمز فعلی است)</label>
            <input className="input mono" required value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </div>
          {profile.phone !== user.phone && (
            <div className="form-row">
              <label className="form-label">رمز عبور فعلی جهت تأیید مالکیت <span className="req-star">*</span></label>
              <input type="password" className="input" required value={profile.current_password} onChange={(e) => setProfile({ ...profile, current_password: e.target.value })} />
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>ذخیرهٔ تغییرات پروفایل</button>
        </form>

        <form onSubmit={handleChangePassword} className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>تغییر رمز عبور و بستن نشست‌های دیگر</h2>
          <div className="form-row">
            <label className="form-label">رمز عبور فعلی <span className="req-star">*</span></label>
            <input type="password" className="input" required value={pwdForm.old_password} onChange={(e) => setPwdForm({ ...pwdForm, old_password: e.target.value })} />
          </div>
          <div className="form-row">
            <label className="form-label">رمز عبور جدید (حداقل ۸ حرف شامل حرف و عدد) <span className="req-star">*</span></label>
            <input type="password" className="input" required minLength={8} value={pwdForm.new_password} onChange={(e) => setPwdForm({ ...pwdForm, new_password: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-secondary" disabled={busy}>تغییر رمز عبور</button>
        </form>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>دفترچهٔ نشانی‌های من</h2>
        {addresses.length === 0 ? (
          <p className="muted">هنوز نشانی‌ای ثبت نشده است.</p>
        ) : (
          <div className="grid grid-2" style={{ marginBottom: 18 }}>
            {addresses.map((a) => (
              <div key={a.id} className="card" style={{ marginBottom: 0, background: 'var(--surface-alt)' }}>
                <div className="flex-between">
                  <strong>{a.title} {a.is_default ? '(پیش‌فرض)' : ''}</strong>
                  <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => handleDeleteAddress(a.id)}>
                    حذف
                  </button>
                </div>
                <p style={{ margin: '6px 0', fontSize: '0.88rem' }}>{a.province}، {a.city}، {a.address_line}</p>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  کدپستی: <span className="mono">{a.postal_code}</span> • گیرنده: {a.recipient_name} (<span className="mono">{a.recipient_phone}</span>)
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddAddress} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
          <h3 style={{ marginTop: 0, fontSize: '0.98rem' }}>افزودن نشانی جدید</h3>
          <div className="grid grid-3">
            <div className="form-row">
              <label className="form-label">عنوان نشانی <span className="req-star">*</span></label>
              <input className="input" required value={addrForm.title} onChange={(e) => setAddrForm({ ...addrForm, title: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">استان <span className="req-star">*</span></label>
              <input className="input" required value={addrForm.province} onChange={(e) => setAddrForm({ ...addrForm, province: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">شهر <span className="req-star">*</span></label>
              <input className="input" required value={addrForm.city} onChange={(e) => setAddrForm({ ...addrForm, city: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">نشانی دقیق پستی <span className="req-star">*</span></label>
            <input className="input" required minLength={10} value={addrForm.address_line} onChange={(e) => setAddrForm({ ...addrForm, address_line: e.target.value })} />
          </div>
          <div className="grid grid-3">
            <div className="form-row">
              <label className="form-label">کدپستی ۱۰ رقمی <span className="req-star">*</span></label>
              <input className="input mono" required minLength={10} maxLength={10} value={addrForm.postal_code} onChange={(e) => setAddrForm({ ...addrForm, postal_code: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">نام گیرنده <span className="req-star">*</span></label>
              <input className="input" required value={addrForm.recipient_name} onChange={(e) => setAddrForm({ ...addrForm, recipient_name: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">شماره موبایل گیرنده <span className="req-star">*</span></label>
              <input className="input mono" required placeholder="09121234567" value={addrForm.recipient_phone} onChange={(e) => setAddrForm({ ...addrForm, recipient_phone: e.target.value })} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>ثبت نشانی</button>
        </form>
      </section>
    </div>
  );
}

export function NotificationsPage() {
  const { user, authLoading, refreshCounts } = useAuth();
  const [data, setData] = useState({ items: [], unread_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadNotifs = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/notifications?limit=50');
      setData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) loadNotifs();
  }, [authLoading, loadNotifs]);

  const markAllRead = async () => {
    await apiFetch('/notifications/read-all', { method: 'POST' });
    await loadNotifs();
    await refreshCounts();
  };

  const markRead = async (id) => {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST' });
    await loadNotifs();
    await refreshCounts();
  };

  if (authLoading || loading) return <LoadingState label="در حال بارگذاری اعلان‌های درون‌سامانه‌ای..." />;
  if (!user) return <EmptyState title="ابتدا وارد حساب شوید" actionLabel="ورود" actionTo="/auth?next=/notifications" />;
  if (error) return <ErrorState error={error} onRetry={loadNotifs} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">اعلان‌های درون‌سامانه‌ای</h1>
          <p className="page-subtitle">اطلاع‌رسانی تغییرات سفارش، پروندهٔ خدمت و پاسخ‌های پشتیبانی</p>
        </div>
        {data.unread_count > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={markAllRead}>
            ✓ خوانده‌شدن همه ({data.unread_count.toLocaleString('fa-IR')})
          </button>
        )}
      </div>

      {data.items.length === 0 ? (
        <EmptyState title="اعلانی وجود ندارد" />
      ) : (
        <div className="card">
          {data.items.map((n) => (
            <div
              key={n.id}
              style={{
                padding: '12px',
                borderRadius: 8,
                marginBottom: 8,
                background: n.is_read ? 'var(--surface-alt)' : 'var(--primary-soft)',
                border: n.is_read ? '1px solid var(--border-subtle)' : '1px solid #7dd3fc'
              }}
            >
              <div className="flex-between">
                <strong>{n.is_read ? '' : '🔵 '}{n.title}</strong>
                <span className="muted" style={{ fontSize: '0.8rem' }}>{formatDateTime(n.created_at)}</span>
              </div>
              {n.body && <div style={{ fontSize: '0.9rem', marginTop: 4 }}>{n.body}</div>}
              <div className="flex-gap" style={{ marginTop: 8 }}>
                {n.link && <Link to={n.link} className="btn btn-primary btn-sm">مشاهده</Link>}
                {!n.is_read && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => markRead(n.id)}>
                    علامت خوانده‌شده
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
