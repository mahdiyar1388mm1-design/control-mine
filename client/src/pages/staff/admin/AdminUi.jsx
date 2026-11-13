import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, authFetch } from '../../../lib/api';
import { formatMoney, formatNumber } from '../../../lib/format';
import { Icon } from '../../../components/Icon';
import { ErrorState, LoadingState } from '../../../components/StateViews';

/** Fetch admin console data with optional silent auto-refresh. */
export function useAdminData(path, { autoRefreshMs = 0, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!enabled || !path) return;
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(path);
      if (mounted.current) setData(res);
    } catch (err) {
      if (mounted.current) setError(err);
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [path, enabled]);

  useEffect(() => {
    reload({ silent: Boolean(data) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, tick]);

  useEffect(() => {
    if (!autoRefreshMs || !enabled) return undefined;
    const id = setInterval(() => reload({ silent: true }), autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, enabled, reload]);

  return {
    data,
    loading,
    refreshing,
    error,
    reload: () => reload({ silent: Boolean(data) }),
    refreshKey: () => setTick((t) => t + 1)
  };
}

export function AdminLoading({ label = 'در حال آماده‌سازی داده‌های مدیریتی...' }) {
  return (
    <div className="ac-loading">
      <LoadingState label={label} />
      <div className="ac-skeleton-grid">
        <div className="ac-skeleton" /><div className="ac-skeleton" /><div className="ac-skeleton" />
      </div>
    </div>
  );
}

export function AdminError({ error, onRetry }) {
  return (
    <div className="ac-error-wrap">
      <ErrorState error={error} onRetry={onRetry} />
    </div>
  );
}

export function StatCard({ icon = 'dot', label, value, sub, tone = 'pink', suffix, onClick }) {
  return (
    <div
      className={`ac-stat ac-stat-${tone}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="ac-stat-top">
        <span className="ac-stat-ico"><Icon name={icon} size={20} color="currentColor" /></span>
        <span className="ac-stat-label">{label}</span>
      </div>
      <div className="ac-stat-value">
        {value}
        {suffix && <span className="ac-stat-suffix">{suffix}</span>}
      </div>
      {sub && <div className="ac-stat-sub">{sub}</div>}
    </div>
  );
}

export function SectionCard({ title, subtitle, icon, action, children, className = '' }) {
  return (
    <section className={`ac-card ${className}`}>
      {(title || action) && (
        <header className="ac-card-head">
          <div className="ac-card-title">
            {icon && <span className="ac-card-ico"><Icon name={icon} size={18} /></span>}
            <div>
              <h3>{title}</h3>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          {action && <div className="ac-card-action">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Modal({ open, title, subtitle, icon, onClose, children, footer, wide = false, extraClass = '' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ac-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`ac-modal ${wide ? 'ac-modal-wide' : ''} ${extraClass}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="ac-modal-head">
          <div className="ac-modal-title">
            {icon && <span className="ac-modal-ico"><Icon name={icon} size={20} /></span>}
            <div>
              <h3>{title}</h3>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button type="button" className="ac-icon-btn" onClick={onClose} aria-label="بستن">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="ac-modal-body">{children}</div>
        {footer && <footer className="ac-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Toast({ kind = 'ok', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`ac-toast ac-toast-${kind}`} role="status">
      <Icon name={kind === 'ok' ? 'check' : 'alert'} size={16} color="currentColor" />
      <span>{children}</span>
      {onClose && (
        <button type="button" className="ac-toast-x" onClick={onClose} aria-label="بستن پیام">
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}

export function Avatar({ name, size = 42, tone = 0 }) {
  const initials = String(name || '؟')
    .replace(/[()]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('');
  const tones = ['ac-avatar-1', 'ac-avatar-2', 'ac-avatar-3', 'ac-avatar-4', 'ac-avatar-5'];
  return (
    <span className={`ac-avatar ${tones[tone % tones.length]}`} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {initials || '؟'}
    </span>
  );
}

export function CopyChip({ value, label }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button type="button" className={`ac-copy ${copied ? 'is-copied' : ''}`} onClick={copy} title="کپی در حافظه">
      <span className="ac-copy-value" dir="ltr">{value}</span>
      <Icon name={copied ? 'check' : 'hash'} size={13} color="currentColor" />
      {label && <span className="ac-copy-label">{copied ? 'کپی شد' : label}</span>}
    </button>
  );
}

export function Badge({ tone = 'pink', children }) {
  return <span className={`ac-badge ac-badge-${tone}`}>{children}</span>;
}

export function SourceChips({ person }) {
  const chips = [];
  if (person.has_shipping) chips.push({ key: 'shipping', label: 'فرم ارسال', count: person.address_count });
  if (person.has_orders) chips.push({ key: 'orders', label: 'سفارش', count: person.order_count });
  if (person.has_services) chips.push({ key: 'services', label: 'خدمات', count: person.service_count });
  if (person.has_tickets) chips.push({ key: 'tickets', label: 'تیکت', count: person.ticket_count });
  if (!chips.length) chips.push({ key: 'signup', label: 'ثبت‌نام', count: 0 });
  return (
    <div className="ac-source-chips">
      {chips.map((c) => (
        <span key={c.key} className={`ac-src ac-src-${c.key}`}>
          {c.label}
          {c.count > 0 && <b>{formatNumber(c.count)}</b>}
        </span>
      ))}
    </div>
  );
}

/** Small, dependency-free bar chart. */
export function Bars({ items, maxValue, height = 110, formatValue }) {
  const max = maxValue || Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return (
    <div className="ac-bars" style={{ height }}>
      {items.map((item) => {
        const ratio = max > 0 ? Math.max(2, Math.round((Number(item.value) / max) * 100)) : 0;
        return (
          <div className="ac-bar-col" key={item.key} title={`${item.label}: ${formatValue ? formatValue(item.value) : formatNumber(item.value)}`}>
            <div className="ac-bar-track">
              <div className={`ac-bar-fill ${item.tone || ''}`} style={{ height: `${ratio}%` }} />
            </div>
            <span className="ac-bar-label">{item.short}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Money({ value, className = '' }) {
  return <span className={`ac-money ${className}`}>{formatMoney(value)}</span>;
}

export function EmptyHint({ icon = 'inbox', title, description }) {
  return (
    <div className="ac-empty">
      <span className="ac-empty-ico"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function Pagination({ page, limit, total, onChange }) {
  const pages = Math.max(1, Math.ceil((total || 0) / limit));
  if (pages <= 1) return null;
  return (
    <div className="ac-pagination">
      <button type="button" className="ac-btn ac-btn-ghost ac-btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        قبلی
      </button>
      <span>صفحهٔ {formatNumber(page)} از {formatNumber(pages)}</span>
      <button type="button" className="ac-btn ac-btn-ghost ac-btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        بعدی
      </button>
    </div>
  );
}

export function downloadCsv(path, filename) {
  return authFetch(`/api/v1${path}`)
    .then((res) => {
      if (!res.ok) throw new Error('دانلود فایل ناموفق بود.');
      return res.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
}

export const STATUS_LABELS = {
  active: 'فعال',
  draft: 'پیش‌نویس',
  archived: 'بایگانی',
  suspended: 'تعلیق‌شده',
  pending_payment: 'در انتظار پرداخت',
  paid: 'پرداخت‌شده',
  preparing: 'در حال آماده‌سازی',
  shipped: 'ارسال‌شده',
  completed: 'تکمیل‌شده',
  canceled: 'لغو‌شده',
  return_in_progress: 'مرجوعی در جریان',
  returned: 'مرجوع‌شده',
  new: 'جدید',
  open: 'باز',
  waiting_customer: 'در انتظار مشتری',
  waiting_team: 'در انتظار تیم',
  resolved: 'حل‌شده',
  closed: 'بسته',
  submitted: 'ثبت‌شده',
  queued: 'در صف',
  assigned: 'تخصیص‌یافته',
  in_progress: 'در حال انجام',
  rejected: 'رد‌شده',
  failed: 'ناموفق',
  refunded: 'مسترد',
  expired: 'منقضی',
  pending: 'در انتظار'
};

export function statusTone(status) {
  if (['active', 'completed', 'paid', 'resolved', 'ok'].includes(status)) return 'ok';
  if (['draft', 'pending_payment', 'pending', 'queued', 'waiting_customer', 'waiting_team', 'in_progress', 'preparing', 'assigned', 'submitted', 'return_in_progress'].includes(status)) return 'warn';
  if (['canceled', 'failed', 'expired', 'suspended', 'rejected', 'returned'].includes(status)) return 'danger';
  if (['archived', 'closed', 'refunded'].includes(status)) return 'neutral';
  return 'pink';
}

export function StatusPill({ status }) {
  return <span className={`ac-status ac-status-${statusTone(status)}`}>{STATUS_LABELS[status] || status}</span>;
}

export function RowMeta({ label, value }) {
  return (
    <div className="ac-row-meta">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
