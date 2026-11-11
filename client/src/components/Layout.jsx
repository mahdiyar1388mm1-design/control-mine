import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isStaffRole, ROLE_LABELS } from '../lib/format';
import { OfflineBanner } from './StateViews';

export function Layout({ children }) {
  const { user, cartCount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [headerSearch, setHeaderSearch] = useState('');
  const staff = user && isStaffRole(user.role);
  if (location.pathname === '/auth') {
    return <div className="auth-shell">{children}</div>;
  }

  const handleHeaderSearch = (e) => {
    e.preventDefault();
    const q = headerSearch.trim();
    navigate(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
  };

  return (
    <div>
      <OfflineBanner />
      <div className="env-notice">
        محیط عملیاتی نسخهٔ اول — پرداخت و پیامک روی آداپتور آزمایشی (Sandbox) فعال هستند و تراکنش بانکی واقعی انجام نمی‌شود.
      </div>

      <header className="top-header cm-pink-header">
        <div className="container top-header-inner">
          <Link to="/" className="brand-logo" aria-label="CENTRAL MINE — صفحهٔ اصلی">
            <img
              src="/central-mine-logo.jpg"
              alt="لوگوی رسمی CENTRAL MINE"
              className="cm-brand-mark"
            />
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
              <span className="cm-brand-fa">ماین</span>
              <span className="cm-brand-en">CENTRAL MINE</span>
            </div>
          </Link>

          <form onSubmit={handleHeaderSearch} className="cm-header-search" role="search">
            <input
              type="search"
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              placeholder="جست‌وجو در محصولات..."
              aria-label="جست‌وجو در ماین"
              className="cm-header-search-input"
            />
            <button type="submit" className="cm-header-search-btn" aria-label="جست‌وجو">🔍</button>
          </form>

          <nav className="desktop-nav" aria-label="ناوبری اصلی">
            <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>خانه</NavLink>
            <NavLink to="/wallet" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>🪙 کیف پول</NavLink>
            <NavLink to="/treasury" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>🏛️ خزانه</NavLink>
            <NavLink to="/lth-calculator" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>🧮 محاسبه‌گر</NavLink>
            <NavLink to="/shop" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>فروشگاه</NavLink>
            {staff && (
              <NavLink to="/staff" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                🛠️ پنل ({ROLE_LABELS[user.role]})
              </NavLink>
            )}
          </nav>

          <div className="header-actions">
            {user ? (
              <>
                <Link to="/cart" className="nav-link" aria-label="سبد خرید">
                  🛒
                  {cartCount > 0 && <span className="pill-count">{cartCount.toLocaleString('fa-IR')}</span>}
                </Link>
                <Link
                  to="/account"
                  className="btn btn-sm"
                  style={{ background: '#ffffff', color: '#d6186c', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <span aria-hidden="true">👤</span> حساب کاربری
                </Link>
              </>
            ) : (
              <Link
                to="/auth"
                className="btn btn-sm"
                style={{ background: '#ffffff', color: '#d6186c', fontWeight: 800 }}
              >
                ورود / ثبت‌نام
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="container page">
        {children}
      </main>

      <footer className="container muted no-print" style={{ padding: '20px 16px 40px', fontSize: '0.83rem', borderTop: '1px solid var(--border)' }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="flex-gap" style={{ alignItems: 'center' }}>
            <img
              src="/central-mine-logo.jpg"
              alt="CENTRAL MINE"
              style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }}
            />
            <span>
              <strong>CENTRAL MINE</strong> — فروشگاه تجهیزات و سامانهٔ کیف پول و خزانهٔ LTH
            </span>
          </div>
          <div className="flex-gap">
            <Link to="/treasury">خزانه پروتکل</Link>
            <span>•</span>
            <Link to="/wallet">کیف پول LTH</Link>
            <span>•</span>
            <Link to="/shop">فروشگاه</Link>
            <span>•</span>
            <Link to="/tickets">پشتیبانی</Link>
          </div>
        </div>
      </footer>

      <nav className="mobile-bottom-nav" aria-label="ناوبری موبایل" style={{ background: '#ec1e79', borderTop: 'none', gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <NavLink to="/treasury" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`} style={{ color: '#fff' }}>
          <span>🏛️</span>
          <span>خزانه</span>
        </NavLink>
        <NavLink to="/shop" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`} style={{ color: '#fff' }}>
          <span>🛍️</span>
          <span>فروشگاه</span>
        </NavLink>
        <NavLink to="/tickets" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`} style={{ color: '#fff' }}>
          <span>🎧</span>
          <span>پشتیبانی</span>
        </NavLink>
        <NavLink to={staff ? '/staff' : '/account'} className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`} style={{ color: '#fff' }}>
          <span>{staff ? '🛠️' : '👤'}</span>
          <span>{staff ? 'عملیات' : 'حساب'}</span>
        </NavLink>
      </nav>
    </div>
  );
}
