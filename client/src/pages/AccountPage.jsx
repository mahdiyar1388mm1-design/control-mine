import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatDateTime, ROLE_LABELS } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorState, FieldErrorsList, LoadingState } from '../components/StateViews';
import '../styles/shipping-profile.css';

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
  const [installAvailable, setInstallAvailable] = useState(Boolean(window.__cmInstallPrompt));
  const [installHelp, setInstallHelp] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [isInstalled, setIsInstalled] = useState(
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  );

  useEffect(() => {
    if (user) {
      navigate(nextUrl, { replace: true });
    }
  }, [user, navigate, nextUrl]);

  useEffect(() => {
    const updateInstallAvailability = () => setInstallAvailable(Boolean(window.__cmInstallPrompt));
    const markInstalled = () => {
      setIsInstalled(true);
      setInstallAvailable(false);
      setInstallHelp(false);
    };
    window.addEventListener('cm-install-available', updateInstallAvailability);
    window.addEventListener('appinstalled', markInstalled);
    return () => {
      window.removeEventListener('cm-install-available', updateInstallAvailability);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    const prompt = window.__cmInstallPrompt;
    if (!prompt) {
      setInstallHelp((shown) => !shown);
      return;
    }
    setInstalling(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setInstallHelp(true);
    } finally {
      window.__cmInstallPrompt = null;
      setInstallAvailable(false);
      setInstalling(false);
    }
  };

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
          <div className="auth-install-area">
            <button type="button" className="auth-install-button" onClick={handleInstallApp} disabled={installing || isInstalled}>
              <span className="auth-install-icon" aria-hidden="true">↓</span>
              <span>{isInstalled ? 'اپلیکیشن نصب شده است' : installing ? 'در حال باز کردن نصب...' : 'نصب اپلیکیشن'}</span>
            </button>
            {installHelp && !isInstalled && (
              <p className="auth-install-help" role="status">
                برای نصب، در منوی مرورگر گزینهٔ «افزودن به صفحهٔ اصلی» را انتخاب کنید. در iPhone از دکمهٔ Share و سپس «Add to Home Screen» استفاده کنید.
              </p>
            )}
          </div>
          <p className="auth-security-note"><span aria-hidden="true">♢</span> امنیت اطلاعات شما برای ما اهمیت دارد</p>
        </div>

      </section>
    </div>
  );
}

const ACCOUNT_MENU_ITEMS = [
  { key: 'dashboard', to: '/account', label: 'پیشخوان حساب', icon: '🏠' },
  { key: 'shipping', to: '/account/shipping', label: 'اطلاعات ارسال', icon: '📍' },
  { key: 'orders', to: '/orders', label: 'سفارش‌ها', icon: '📦' },
  { key: 'tickets', to: '/tickets', label: 'پشتیبانی', icon: '🎧' },
  { key: 'notifications', to: '/account/notifications', label: 'اعلان‌ها', icon: '🔔' }
];

function AccountLayout({ active, title, subtitle, children }) {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="account-shell">
      <aside className="account-sidebar card" aria-label="منوی پنل کاربری">
        <div className="account-identity">
          <span className="account-avatar" aria-hidden="true">👤</span>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: 'block' }}>{user.full_name}</strong>
            <span className="muted mono" style={{ fontSize: '0.82rem' }}>{user.phone}</span>
          </div>
        </div>
        <nav className="account-menu">
          {ACCOUNT_MENU_ITEMS.map((it) => (
            <NavLink
              key={it.key}
              to={it.to}
              end={it.key === 'dashboard'}
              className={`account-menu-item ${active === it.key ? 'active' : ''}`}
            >
              <span aria-hidden="true">{it.icon}</span>
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="account-menu-footer">
          <Link to="/shop" className="account-menu-item">
            <span aria-hidden="true">🏬</span>
            <span>بازگشت به فروشگاه</span>
          </Link>
          <button type="button" className="account-menu-item danger" onClick={logout}>
            <span aria-hidden="true">⎋</span>
            <span>خروج از حساب</span>
          </button>
        </div>
      </aside>
      <section className="account-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">{title}</h1>
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}

export function AccountDashboardPage() {
  const { user, authLoading, refreshMe } = useAuth();
  const [profile, setProfile] = useState({ full_name: '', email: '', phone: '', current_password: '' });
  const [pwdForm, setPwdForm] = useState({ old_password: '', new_password: '' });
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
      const pRes = await apiFetch('/me/profile');
      setProfile({
        full_name: pRes.user.full_name || '',
        email: pRes.user.email || '',
        phone: pRes.user.phone || '',
        current_password: ''
      });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) loadAccount();
  }, [authLoading, loadAccount]);

  if (authLoading || loading) return <LoadingState label="در حال بارگذاری پنل کاربری..." />;
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

  return (
    <AccountLayout
      active="dashboard"
      title="حساب کاربری من"
      subtitle={`به پنل کاربری ماین خوش آمدید — نقش فعلی: ${ROLE_LABELS[user.role] || user.role}`}
    >
      {msg && <div className="alert-inline ok" role="status">✓ {msg}</div>}
      {opErr && (
        <>
          <div className="alert-inline error" role="alert">⚠️ {opErr.message}</div>
          <FieldErrorsList details={opErr.details} />
        </>
      )}

      <div className="card account-contact-card">
        <div className="account-contact-label">
          <span aria-hidden="true">📞</span>
          <span>شماره موبایل حساب</span>
        </div>
        <div className="account-contact-value mono" dir="ltr">{user.phone}</div>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>مدیریت حساب</h2>
        <div className="account-manage-list">
          <Link to="/account/shipping" className="account-manage-item">
            <span className="account-manage-icon" aria-hidden="true">📍</span>
            <span className="account-manage-text">
              <strong>اطلاعات ارسال و آدرس‌ها</strong>
              <span className="muted">مدیریت اطلاعات ارسال سفارش‌ها</span>
            </span>
            <span className="account-manage-arrow" aria-hidden="true">←</span>
          </Link>
          <Link to="/orders" className="account-manage-item">
            <span className="account-manage-icon" aria-hidden="true">📦</span>
            <span className="account-manage-text">
              <strong>سفارش‌های من</strong>
              <span className="muted">پیگیری و جزئیات سفارش‌ها</span>
            </span>
            <span className="account-manage-arrow" aria-hidden="true">←</span>
          </Link>
          <Link to="/tickets" className="account-manage-item">
            <span className="account-manage-icon" aria-hidden="true">🎧</span>
            <span className="account-manage-text">
              <strong>پشتیبانی</strong>
              <span className="muted">پرونده‌ها و گفتگوهای پشتیبانی</span>
            </span>
            <span className="account-manage-arrow" aria-hidden="true">←</span>
          </Link>
          <Link to="/account/notifications" className="account-manage-item">
            <span className="account-manage-icon" aria-hidden="true">🔔</span>
            <span className="account-manage-text">
              <strong>اعلان‌ها</strong>
              <span className="muted">اطلاع‌رسانی‌های درون‌سامانه‌ای</span>
            </span>
            <span className="account-manage-arrow" aria-hidden="true">←</span>
          </Link>
        </div>
      </section>

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
    </AccountLayout>
  );
}

const SHIPPING_TITLE = 'اطلاعات ارسال خودکار';
const SHIP_PHONE_RE = /^09\d{9}$/;
const SHIP_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHIPPING_TIPS = [
  'پس از ثبت اطلاعات، در سفارش‌های بعدی نیازی به وارد کردن مجدد اطلاعات نیست.',
  'در صورت تغییر آدرس یا شماره تماس، لطفاً اطلاعات را در همین بخش به‌روزرسانی فرمایید.',
  'درج کد پستی دقیق ۱۰ رقمی منطبق با نشانی جهت صدور بارنامه رسمی پست و تیپاکس الزامی است.',
  'شماره شبا و کارت صرفاً جهت عودت وجه در صورت اعمال حق انصراف ۷ روزه (ماده ۳۷ قانون تجارت الکترونیک) استفاده می‌شود.'
];

function toLatinDigits(value) {
  return String(value || '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function onlyDigits(value, maxLength) {
  return toLatinDigits(value).replace(/\D/g, '').slice(0, maxLength);
}

// The design uses one full-address box («استان، شهر، خیابان، پلاک، واحد»); split it into the stored province / city / address_line.
function splitFullAddress(text) {
  const parts = String(text || '').split(/[،,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  return { province: parts[0], city: parts[1], address_line: parts.slice(2).join('، ') };
}

function addressToShippingForm(address, user) {
  if (!address) {
    return {
      full_name: user?.full_name || '',
      phone: user?.phone || '',
      email: user?.email || '',
      card_number: '',
      sheba: '',
      postal_code: '',
      full_address: '',
      auto_fill: true
    };
  }
  return {
    full_name: address.recipient_name || '',
    phone: address.recipient_phone || '',
    email: address.recipient_email || '',
    card_number: address.refund_card_number || '',
    sheba: String(address.refund_sheba || '').replace(/^IR/i, ''),
    postal_code: address.postal_code || '',
    full_address: [address.province, address.city, address.address_line].filter(Boolean).join('، '),
    auto_fill: address.auto_fill === undefined || address.auto_fill === null ? true : Boolean(address.auto_fill)
  };
}

function validateShippingForm(form) {
  const errors = {};
  if (form.full_name.trim().length < 3) errors.full_name = 'نام و نام خانوادگی را کامل وارد کنید.';
  if (!SHIP_PHONE_RE.test(form.phone)) errors.phone = 'شماره همراه باید ۱۱ رقم و با ۰۹ شروع شود.';
  if (form.email.trim() && !SHIP_EMAIL_RE.test(form.email.trim())) errors.email = 'آدرس ایمیل معتبر نیست.';
  if (form.card_number && form.card_number.length !== 16) errors.card_number = 'شماره کارت باید ۱۶ رقم باشد.';
  if (form.sheba && form.sheba.length !== 24) errors.sheba = 'شماره شبا باید ۲۴ رقم (بدون IR) باشد.';
  if (form.postal_code.length !== 10) errors.postal_code = 'کد پستی باید دقیقاً ۱۰ رقم باشد.';
  const parts = splitFullAddress(form.full_address);
  if (!parts) {
    errors.full_address = 'نشانی را به شکل «استان، شهر، خیابان، پلاک، واحد» و با ویرگول جدا کنید.';
  } else if (parts.province.length < 2 || parts.city.length < 2) {
    errors.full_address = 'نام استان و شهر را در ابتدای نشانی بنویسید.';
  } else if (parts.address_line.length < 10) {
    errors.full_address = 'جزئیات نشانی (خیابان، پلاک، واحد) را کامل‌تر بنویسید.';
  }
  return { errors, parts };
}

function ShipField({ id, label, icon, required, error, full, children }) {
  return (
    <div className={`ship-field${full ? ' ship-field-full' : ''}${error ? ' has-error' : ''}`}>
      <label htmlFor={id} className="ship-label">
        <Icon name={icon} size={16} />
        <span>{label}</span>
        {required && <span className="ship-req" aria-hidden="true">*</span>}
      </label>
      {children}
      {error && <span className="ship-error" id={`${id}-error`}>{error}</span>}
    </div>
  );
}

export function ProfileAddressesPage() {
  const { user, authLoading } = useAuth();
  const [savedAddress, setSavedAddress] = useState(null);
  const [form, setForm] = useState(() => addressToShippingForm(null, null));
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadShipping = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/me/addresses');
      const items = res.items || [];
      const current = items.find((a) => a.is_default) || items[0] || null;
      setSavedAddress(current);
      setForm(addressToShippingForm(current, user));
      setFieldErrors({});
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) loadShipping();
  }, [authLoading, loadShipping]);

  if (authLoading || loading) return <LoadingState label="در حال بارگذاری اطلاعات ارسال..." />;
  if (!user) return <EmptyState title="وارد حساب کاربری نشده‌اید" actionLabel="ورود" actionTo="/auth?next=/account/shipping" />;
  if (error) return <ErrorState error={error} onRetry={loadShipping} />;

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setMsg('');
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const fieldProps = (field) => ({
    id: `ship-${field}`,
    'aria-invalid': fieldErrors[field] ? 'true' : undefined,
    'aria-describedby': fieldErrors[field] ? `ship-${field}-error` : undefined
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    setOpErr(null);
    const { errors, parts } = validateShippingForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const firstField = Object.keys(errors)[0];
      document.getElementById(`ship-${firstField}`)?.focus();
      return;
    }
    const body = {
      title: savedAddress?.title || SHIPPING_TITLE,
      province: parts.province,
      city: parts.city,
      address_line: parts.address_line,
      postal_code: form.postal_code,
      recipient_name: form.full_name.trim(),
      recipient_phone: form.phone,
      recipient_email: form.email.trim() || null,
      refund_card_number: form.card_number || null,
      refund_sheba: form.sheba ? `IR${form.sheba}` : null,
      auto_fill: form.auto_fill,
      is_default: form.auto_fill ? true : undefined
    };
    setBusy(true);
    try {
      const res = savedAddress
        ? await apiFetch(`/me/addresses/${savedAddress.id}`, { method: 'PATCH', body })
        : await apiFetch('/me/addresses', { method: 'POST', body });
      setSavedAddress(res.address);
      setForm(addressToShippingForm(res.address, user));
      setMsg(form.auto_fill
        ? 'اطلاعات ارسال ذخیره شد و در سفارش‌های بعدی به‌صورت خودکار تکمیل می‌شود.'
        : 'اطلاعات ارسال ذخیره شد.');
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountLayout active="shipping" title="اطلاعات ارسال" subtitle="اطلاعات گیرنده و نشانی تحویل سفارش‌های شما">
      <div className="ship-layout">
        <form className="ship-card ship-form" onSubmit={handleSubmit} noValidate>
          <header className="ship-form-head">
            <div>
              <h2>اطلاعات ارسال خودکار</h2>
              <p>با فعال‌سازی این بخش، اطلاعات ارسال شما ذخیره می‌شود و پس از ثبت سفارش، مشخصات مورد نیاز به صورت خودکار در سفارش‌های بعدی تکمیل خواهد شد. در صورت تغییر آدرس یا اطلاعات تماس، لطفاً اطلاعات خود را به‌روزرسانی نمایید.</p>
            </div>
            <span className="ship-head-icon" aria-hidden="true"><Icon name="shieldCheck" size={24} /></span>
          </header>

          {msg && <div className="alert-inline ok ship-alert" role="status">✓ {msg}</div>}
          {opErr && (
            <div className="ship-alert">
              <div className="alert-inline error" role="alert">⚠️ {opErr.message}</div>
              <FieldErrorsList details={opErr.details} />
            </div>
          )}

          <div className="ship-grid">
            <ShipField id="ship-full_name" label="نام و نام خانوادگی" icon="user" required error={fieldErrors.full_name}>
              <input
                {...fieldProps('full_name')}
                className="ship-input"
                autoComplete="name"
                placeholder="نام و نام خانوادگی خود را وارد کنید"
                value={form.full_name}
                onChange={(e) => updateField('full_name', e.target.value)}
              />
            </ShipField>

            <ShipField id="ship-phone" label="شماره تماس همراه" icon="phone" required error={fieldErrors.phone}>
              <input
                {...fieldProps('phone')}
                className="ship-input ship-input-num"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                dir={form.phone ? 'ltr' : 'rtl'}
                placeholder="مثال: 09121234567"
                value={form.phone}
                onChange={(e) => updateField('phone', onlyDigits(e.target.value, 11))}
              />
            </ShipField>

            <ShipField id="ship-email" label="آدرس ایمیل" icon="mail" error={fieldErrors.email}>
              <input
                {...fieldProps('email')}
                className="ship-input"
                type="email"
                autoComplete="email"
                dir="ltr"
                placeholder="example@domain.com"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
              />
            </ShipField>

            <ShipField id="ship-card_number" label="شماره کارت (جهت مرجوعی)" icon="creditCard" error={fieldErrors.card_number}>
              <input
                {...fieldProps('card_number')}
                className="ship-input ship-input-num"
                inputMode="numeric"
                autoComplete="off"
                dir={form.card_number ? 'ltr' : 'rtl'}
                placeholder="شماره ۱۶ رقم کارت"
                value={form.card_number}
                onChange={(e) => updateField('card_number', onlyDigits(e.target.value, 16))}
              />
            </ShipField>

            <ShipField id="ship-sheba" label="شماره شبا (اختیاری)" icon="creditCard" error={fieldErrors.sheba}>
              <div className="ship-input-wrap">
                <input
                  {...fieldProps('sheba')}
                  className="ship-input ship-input-num"
                  inputMode="numeric"
                  autoComplete="off"
                  dir={form.sheba ? 'ltr' : 'rtl'}
                  placeholder="۲۴ رقم بدون IR"
                  value={form.sheba}
                  onChange={(e) => updateField('sheba', onlyDigits(String(e.target.value).replace(/^\s*IR/i, ''), 24))}
                />
                <span className="ship-input-prefix" dir="ltr" aria-hidden="true">IR -</span>
              </div>
            </ShipField>

            <ShipField id="ship-postal_code" label="کد پستی ۱۰ رقمی" icon="hash" required error={fieldErrors.postal_code}>
              <input
                {...fieldProps('postal_code')}
                className="ship-input ship-input-num"
                inputMode="numeric"
                autoComplete="postal-code"
                dir={form.postal_code ? 'ltr' : 'rtl'}
                placeholder="کد پستی ۱۰ رقمی محل سکونت"
                value={form.postal_code}
                onChange={(e) => updateField('postal_code', onlyDigits(e.target.value, 10))}
              />
            </ShipField>

            <ShipField id="ship-full_address" label="نشانی کامل پستی تحویل‌گیرنده" icon="mapPin" required full error={fieldErrors.full_address}>
              <textarea
                {...fieldProps('full_address')}
                className="ship-input ship-textarea"
                autoComplete="street-address"
                rows={3}
                placeholder="استان، شهر، خیابان، پلاک، واحد..."
                value={form.full_address}
                onChange={(e) => updateField('full_address', e.target.value)}
              />
            </ShipField>
          </div>

          <label className="ship-check">
            <input
              type="checkbox"
              checked={form.auto_fill}
              onChange={(e) => updateField('auto_fill', e.target.checked)}
            />
            <span>ارسال خودکار سفارش‌ها با اطلاعات ذخیره‌شده در خریدهای بعدی</span>
          </label>

          <button type="submit" className="ship-submit" disabled={busy}>
            <Icon name="shieldCheck" size={18} color="#ffffff" />
            <span>{busy ? 'در حال ثبت اطلاعات...' : 'ثبت اطلاعات'}</span>
          </button>
        </form>

        <aside className="ship-aside" aria-label="راهنمای اطلاعات ارسال">
          <div className="ship-hero">
            <span className="ship-hero-icon" aria-hidden="true"><Icon name="shieldCheck" size={34} color="#ffffff" /></span>
            <h2>اطلاعات ارسال خودکار</h2>
            <p>تسهیل و تسریع در چرخه ارسال مرسولات</p>
          </div>

          <div className="ship-card ship-tips">
            <div className="ship-tips-head">
              <h3>نکات مهم</h3>
              <Icon name="bulb" size={20} />
            </div>
            <ul>
              {SHIPPING_TIPS.map((tip) => <li key={tip}>{tip}</li>)}
            </ul>
          </div>
        </aside>
      </div>
    </AccountLayout>
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
    <AccountLayout active="notifications" title="اعلان‌های درون‌سامانه‌ای" subtitle="اطلاع‌رسانی تغییرات سفارش، پروندهٔ خدمت و پاسخ‌های پشتیبانی">
      {data.unread_count > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={markAllRead}>
            ✓ خوانده‌شدن همه ({data.unread_count.toLocaleString('fa-IR')})
          </button>
        </div>
      )}

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
    </AccountLayout>
  );
}
