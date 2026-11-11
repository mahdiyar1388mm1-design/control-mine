import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatNumber, isStaffRole, ROLE_LABELS } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';
import { FinanceReportsPanel, SupportTicketsPanel, WarehousePanel } from './SupportWarehouseFinancePanels';
import { AdminManagementPanel } from './AdminManagementPanel';
import { AdminLthPanel } from './AdminLthPanel';

export function StaffWorkspacePage() {
  const { user, authLoading } = useAuth();
  const [overview, setOverview] = useState(null);
  const [ovError, setOvError] = useState(null);

  const allowedSections = [];
  if (user) {
    if (['support', 'admin'].includes(user.role)) {
      allowedSections.push({ id: 'support', label: '💬 میزکار پشتیبانی' });
    }
    if (['warehouse', 'admin'].includes(user.role)) {
      allowedSections.push({ id: 'warehouse', label: '📦 انبار، موجودی و ارسال' });
    }
    if (['finance', 'support', 'admin'].includes(user.role)) {
      allowedSections.push({ id: 'finance-reports', label: user.role === 'finance' ? '💳 امور مالی و گزارش‌ها' : '📊 گزارش‌های مجاز' });
    }
    if (['admin', 'finance'].includes(user.role)) {
      allowedSections.push({ id: 'lth-protocol', label: '🔍 سرچ پروتکل و موازین LTH' });
    }
    if (user.role === 'admin') {
      allowedSections.push({ id: 'admin', label: '🛡️ مدیریت سامانه و ممیزی' });
    }
  }

  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    if (!allowedSections.length) return;
    const activeSectionIsAllowed = allowedSections.some((section) => section.id === activeSection);
    if (!activeSectionIsAllowed || (!activeSection && user?.role === 'admin')) {
      setActiveSection(user?.role === 'admin' ? 'admin' : allowedSections[0].id);
    }
  }, [user, activeSection]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOverview = useCallback(async () => {
    if (!user || !isStaffRole(user.role)) return;
    setOvError(null);
    try {
      const res = await apiFetch('/staff/overview');
      setOverview(res);
    } catch (err) {
      setOvError(err);
    }
  }, [user]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  if (authLoading) return <LoadingState label="در حال بررسی مجوز دسترسی کارکنان..." />;
  if (!user) {
    return (
      <EmptyState
        title="ورود به پنل عملیاتی کارکنان"
        description="برای دسترسی به صف‌های عملیاتی با حساب سازمانی خود وارد شوید."
        actionLabel="ورود به سامانه"
        actionTo="/auth?next=/staff"
      />
    );
  }
  if (!isStaffRole(user.role)) {
    return (
      <ErrorState
        error={{ status: 403, code: 'FORBIDDEN', message: 'حساب شما دارای نقش «مشتری» است و مجوز ورود به پنل‌های عملیاتی کارکنان را ندارد.' }}
      />
    );
  }

  const q = overview?.queues || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">پنل عملیاتی کارکنان — {ROLE_LABELS[user.role]}</h1>
          <p className="page-subtitle">کارهای نیازمند اقدام فوری بر اساس سطح مجوز سرور در صدر صفحه برجسته شده‌اند.</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={loadOverview}>🔄 بروزرسانی شاخص‌های صف</button>
      </div>

      {ovError && <ErrorState error={ovError} onRetry={loadOverview} />}

      {/* Action-First Operational Queue Counters (§17) */}
      {overview && (
        <div className="grid grid-4" style={{ marginBottom: 20 }}>
          {q.warehouse && (
            <>
              <div className="kpi-card">
                <div className="kpi-label">سفارش‌های پرداخت‌شده آمادهٔ انبار</div>
                <div className="kpi-value">{formatNumber(q.warehouse.paid_ready_to_prepare)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">SKUهای کم‌موجودی (≤ ۵ عدد)</div>
                <div className="kpi-value" style={{ color: q.warehouse.low_stock_skus > 0 ? 'var(--accent)' : 'var(--ok)' }}>
                  {formatNumber(q.warehouse.low_stock_skus)}
                </div>
              </div>
            </>
          )}
          {q.tickets && (
            <div className="kpi-card">
              <div className="kpi-label">تیکت‌های جدید / باز پشتیبانی</div>
              <div className="kpi-value">{formatNumber(q.tickets.new_tickets)} جدید | {formatNumber(q.tickets.open_tickets)} باز</div>
            </div>
          )}
          {q.finance && (
            <>
              <div className="kpi-card">
                <div className="kpi-label">پرداخت‌های ناموفق / منقضی</div>
                <div className="kpi-value">{formatNumber(q.finance.failed_or_expired_payments)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">برداشت‌های شبا LTH در انتظار تسویه</div>
                <div className="kpi-value" style={{ color: q.finance.pending_lth_withdrawals > 0 ? '#db2777' : 'var(--ok)' }}>
                  {formatNumber(q.finance.pending_lth_withdrawals || 0)}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="tabs">
        {allowedSections.map((sec) => (
          <button
            key={sec.id}
            type="button"
            className={`tab-btn ${activeSection === sec.id ? 'active' : ''}`}
            onClick={() => setActiveSection(sec.id)}
          >
            {sec.label}
          </button>
        ))}
      </div>

      {activeSection === 'support' && <SupportTicketsPanel />}
      {activeSection === 'warehouse' && <WarehousePanel />}
      {activeSection === 'finance-reports' && <FinanceReportsPanel userRole={user.role} />}
      {activeSection === 'lth-protocol' && <AdminLthPanel userRole={user.role} />}
      {activeSection === 'admin' && <AdminManagementPanel />}
    </div>
  );
}
