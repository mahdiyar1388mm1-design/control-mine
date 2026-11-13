import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

export function LoadingState({ label = 'در حال دریافت اطلاعات از سرور...' }) {
  return (
    <div className="state-box" role="status" aria-live="polite">
      <strong><Icon name="clock" /> {label}</strong>
      <div className="muted" style={{ fontSize: '0.86rem', marginTop: 4 }}>
        لطفاً چند لحظه شکیبا باشید.
      </div>
    </div>
  );
}

export function EmptyState({ title = 'موردی برای نمایش وجود ندارد', description, actionLabel, actionTo, onAction }) {
  return (
    <div className="state-box">
      <div style={{ fontWeight: 800, fontSize: '1.02rem' }}><Icon name="inbox" /> {title}</div>
      {description && <p className="muted" style={{ margin: '6px 0 12px' }}>{description}</p>}
      {actionLabel && actionTo && (
        <Link to={actionTo} className="btn btn-primary btn-sm">{actionLabel}</Link>
      )}
      {actionLabel && onAction && (
        <button type="button" className="btn btn-primary btn-sm" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry, title }) {
  if (!error) return null;
  const isNetwork = error.code === 'NETWORK_ERROR' || error.status === 0;
  const isUnauth = error.status === 401 || error.code === 'UNAUTHORIZED';
  const isForbidden = error.status === 403 || error.code === 'FORBIDDEN';
  const isServer = error.status >= 500 || error.code === 'INTERNAL' || error.code === 'SERVER_ERROR';

  let heading = title || 'خطا در انجام عملیات';
  let icon = 'alert';
  if (isNetwork) {
    heading = 'خطای اتصال شبکه';
    icon = 'wifiOff';
  } else if (isUnauth) {
    heading = 'نیاز به ورود به حساب کاربری';
    icon = 'lock';
  } else if (isForbidden) {
    heading = 'دسترسی غیرمجاز';
    icon = 'ban';
  } else if (isServer) {
    heading = 'خطای داخلی سرور';
    icon = 'tools';
  }

  return (
    <div className="state-box error" role="alert">
      <div style={{ fontWeight: 800, fontSize: '1.02rem', color: 'var(--danger)' }}>
        <Icon name={icon} /> {heading}
      </div>
      <p style={{ margin: '8px 0' }}>{error.message || 'پاسخ معتبری از سرور دریافت نشد.'}</p>
      {error.requestId && (
        <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 10 }}>
          شناسهٔ پیگیری خطا: <span className="mono">{error.requestId}</span>
        </div>
      )}
      <div className="flex-gap">
        {onRetry && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            <Icon name="refresh" size={16} /> تلاش مجدد
          </button>
        )}
        {isUnauth && (
          <Link to="/auth" className="btn btn-primary btn-sm">ورود به حساب</Link>
        )}
      </div>
    </div>
  );
}

export function FieldErrorsList({ details }) {
  if (!Array.isArray(details) || !details.length) return null;
  return (
    <ul className="alert-inline error" style={{ paddingRight: 26, margin: '0 0 14px' }}>
      {details.map((d, idx) => (
        <li key={`${d.field || idx}-${idx}`}>
          {d.field ? `${d.field}: ` : ''}{d.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Non-color-only badge: always pairs an explicit icon + Persian label + border.
 */
const STATUS_STYLE_MAP = {
  // Orders
  pending_payment: { tone: 'warn', icon: 'clock', label: 'در انتظار پرداخت' },
  paid: { tone: 'ok', icon: 'check', label: 'پرداخت‌شده' },
  preparing: { tone: 'info', icon: 'package', label: 'در حال آماده‌سازی' },
  shipped: { tone: 'info', icon: 'truck', label: 'ارسال‌شده' },
  completed: { tone: 'ok', icon: 'check', label: 'تکمیل‌شده' },
  canceled: { tone: 'danger', icon: 'x', label: 'لغوشده' },
  return_in_progress: { tone: 'warn', icon: 'undo', label: 'مرجوعی در جریان' },
  returned: { tone: 'neutral', icon: 'undo', label: 'مستردشده' },
  // Service requests
  draft: { tone: 'neutral', icon: 'edit', label: 'پیش‌نویس' },
  submitted: { tone: 'warn', icon: 'send', label: 'ثبت‌شده (منتظر پرداخت)' },
  queued: { tone: 'info', icon: 'folder', label: 'در صف بررسی' },
  assigned: { tone: 'info', icon: 'user', label: 'تخصیص‌یافته' },
  in_progress: { tone: 'info', icon: 'settings', label: 'در حال انجام' },
  waiting_customer: { tone: 'warn', icon: 'message', label: 'منتظر پاسخ مشتری' },
  rejected: { tone: 'danger', icon: 'ban', label: 'ردشده' },
  failed: { tone: 'danger', icon: 'alert', label: 'ناموفق' },
  refunded: { tone: 'neutral', icon: 'undo', label: 'مبلغ مستردشده' },
  // Payments
  pending: { tone: 'warn', icon: 'clock', label: 'در انتظار پرداخت' },
  expired: { tone: 'warn', icon: 'help', label: 'منقضی / نتیجهٔ نامعلوم' },
  // Tickets
  new: { tone: 'warn', icon: 'plus', label: 'جدید' },
  open: { tone: 'info', icon: 'folder', label: 'باز' },
  waiting_team: { tone: 'warn', icon: 'refresh', label: 'ارجاع‌شده به تیم' },
  resolved: { tone: 'ok', icon: 'check', label: 'حل‌شده' },
  closed: { tone: 'neutral', icon: 'lock', label: 'بسته' },
  // Users / Products
  active: { tone: 'ok', icon: 'check', label: 'فعال' },
  suspended: { tone: 'danger', icon: 'ban', label: 'تعلیق‌شده' },
  archived: { tone: 'neutral', icon: 'archive', label: 'بایگانی‌شده' }
};

export function StatusBadge({ status, labelOverride }) {
  const entry = STATUS_STYLE_MAP[status] || { tone: 'neutral', icon: 'dot', label: status || 'نامشخص' };
  return (
    <span className={`badge badge-${entry.tone}`}>
      <Icon name={entry.icon} color="currentColor" size={14} />
      <span>{labelOverride || entry.label}</span>
    </span>
  );
}

export function ProductImage({ src, alt, className = 'product-thumb' }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="product-thumb-fallback" role="img" aria-label={alt || 'تصویر کالا در دسترس نیست'}>
        <span><Icon name="image" /> {alt || 'تصویر کالا'}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt || 'تصویر کالا'}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'تأیید و ادامه',
  cancelLabel = 'انصراف',
  danger = false,
  busy = false,
  children,
  onConfirm,
  onCancel
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <div className="modal-card">
        <h3 id="confirm-modal-title" style={{ marginTop: 0, marginBottom: 8 }}>{title}</h3>
        {description && <p className="muted" style={{ marginTop: 0 }}>{description}</p>}
        {children}
        <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? (<><Icon name="clock" color="currentColor" size={16} /> در حال انجام...</>) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="offline-banner" role="alert">
      <Icon name="wifiOff" color="currentColor" /> اتصال اینترنت شما قطع است. اطلاعات مالی و ثبت سفارش در حالت آفلاین ذخیره یا در صف پنهان قرار نمی‌گیرند؛ پس از اتصال مجدد، عملیات را آگاهانه تأیید و ارسال کنید.
    </div>
  );
}
