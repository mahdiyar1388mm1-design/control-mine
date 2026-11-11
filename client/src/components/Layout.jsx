import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isStaffRole, ROLE_LABELS } from '../lib/format';
import { OfflineBanner } from './StateViews';

export function Layout({ children }) {
  const { user, cartCount, unreadCount, logout } = useAuth();
  const staff = user && isStaffRole(user.role);

  return (
    <div>
      <OfflineBanner />
      <div className="env-notice">
        محیط عملیاتی نسخهٔ اول — پرداخت و پیامک روی آداپتور آزمایشی (Sandbox) فعال هستند و تراکنش بانکی واقعی انجام نمی‌شود.
      </div>

      <header className="top-header">
        <div className="container top-header-inner">
          <Link to="/" className="brand-logo">
            <span>CENTRAL MINE</span>
            <span className="brand-tag">فروشگاه و خدمات فنی</span>
          </Link>

          <nav className="desktop-nav" aria-label="ناوبری اصلی">
            <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>صفحهٔ اصلی</NavLink>
            <NavLink to="/shop" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>فروشگاه کالا</NavLink>
            <NavLink to="/services" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>خدمات عملیاتی</NavLink>
            {user && (
              <>
                <NavLink to="/orders" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>سفارش‌ها</NavLink>
                <NavLink to="/service-requests" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>پرونده‌های خدمات</NavLink>
                <NavLink to="/tickets" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>پشتیبانی</NavLink>
              </>
            )}
            {staff && (
              <NavLink to="/staff" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                🛠️ پنل عملیات ({ROLE_LABELS[user.role]})
              </NavLink>
            )}
          </nav>

          <div className="header-actions">
            {user ? (
              <>
                <Link to="/cart" className="nav-link" aria-label="سبد خرید">
                  🛒 سبد
                  {cartCount > 0 && <span className="pill-count">{cartCount.toLocaleString('fa-IR')}</span>}
                </Link>
                <Link to="/notifications" className="nav-link" aria-label="اعلان‌ها">
                  🔔 اعلان
                  {unreadCount > 0 && <span className="pill-count">{unreadCount.toLocaleString('fa-IR')}</span>}
                </Link>
                <Link to="/account" className="nav-link">
                  👤 {user.full_name.split(' ')[0]}
                </Link>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={logout}
                  style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'transparent' }}
                >
                  خروج
                </button>
              </>
            ) : (
              <Link to="/auth" className="btn btn-primary btn-sm">
                ورود / ثبت‌نام
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="container page">
        {children}
      </main>

      <footer className="container muted no-print" style={{ padding: '20px 16px 36px', fontSize: '0.83rem', borderTop: '1px solid var(--border)' }}>
        <div className="flex-between">
          <div>
            <strong>CENTRAL MINE</strong> — سامانهٔ فارسی فروش تجهیزات و پیگیری خدمات آنلاین (تمام مبالغ به <strong>تومان</strong> است)
          </div>
          <div className="flex-gap">
            <Link to="/shop">فروشگاه</Link>
            <span>•</span>
            <Link to="/services">خدمات</Link>
            <span>•</span>
            <Link to="/tickets">پشتیبانی</Link>
          </div>
        </div>
      </footer>

      <nav className="mobile-bottom-nav" aria-label="ناوبری موبایل">
        <NavLink to="/" end className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
          <span>🏠</span>
          <span>خانه</span>
        </NavLink>
        <NavLink to="/shop" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
          <span>🛍️</span>
          <span>فروشگاه</span>
        </NavLink>
        <NavLink to="/services" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
          <span>⚙️</span>
          <span>خدمات</span>
        </NavLink>
        <NavLink to="/cart" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
          <span>🛒</span>
          <span>سبد {cartCount > 0 ? `(${cartCount.toLocaleString('fa-IR')})` : ''}</span>
        </NavLink>
        <NavLink to={staff ? '/staff' : (user ? '/account' : '/auth')} className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
          <span>{staff ? '🛠️' : '👤'}</span>
          <span>{staff ? 'عملیات' : (user ? 'حساب' : 'ورود')}</span>
        </NavLink>
      </nav>
    </div>
  );
}
