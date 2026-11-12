import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDateTime, formatNumber } from '../../../lib/format';
import { Icon } from '../../../components/Icon';
import {
  AdminError, AdminLoading, Avatar, Badge, CopyChip, EmptyHint, Modal,
  Pagination, SectionCard, StatCard, StatusPill, Toast, useAdminData
} from './AdminUi';

const STATUS_FILTERS = [
  { id: '', label: 'همه' },
  { id: 'pending_payment', label: 'در انتظار پرداخت' },
  { id: 'paid', label: 'پرداخت‌شده' },
  { id: 'preparing', label: 'آماده‌سازی' },
  { id: 'shipped', label: 'ارسال‌شده' },
  { id: 'completed', label: 'تکمیل‌شده' },
  { id: 'canceled', label: 'لغو‌شده' },
  { id: 'return_in_progress', label: 'مرجوعی' },
  { id: 'returned', label: 'مرجوع‌شده' }
];

const TRANSITIONS = {
  pending_payment: ['canceled'],
  paid: ['preparing', 'canceled'],
  preparing: ['shipped', 'canceled'],
  shipped: ['completed', 'return_in_progress'],
  completed: ['return_in_progress'],
  return_in_progress: ['returned'],
  canceled: [],
  returned: []
};

function OrderDetailModal({ code, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ to_status: '', reason: '', tracking_code: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/admin/console/orders/${encodeURIComponent(code)}`);
      setDetail(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  const nextStatuses = detail ? (TRANSITIONS[detail.order.status] || []) : [];

  const advance = async (e) => {
    e.preventDefault();
    if (!form.to_status) return;
    setBusy(true);
    setError(null);
    setMsg('');
    try {
      await apiFetch(`/staff/orders/${encodeURIComponent(code)}/status`, {
        method: 'POST',
        body: {
          to_status: form.to_status,
          reason: form.reason || undefined,
          tracking_code: form.tracking_code || undefined
        }
      });
      setMsg('وضعیت سفارش به‌روزرسانی شد.');
      setForm({ to_status: '', reason: '', tracking_code: '' });
      await load();
      onChanged?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const order = detail?.order;

  return (
    <Modal
      open
      wide
      icon="bag"
      onClose={onClose}
      title={order ? `سفارش ${order.code}` : 'پروندهٔ سفارش'}
      subtitle={order ? `${order.customer.full_name} — @${order.customer.username || '—'}` : ''}
    >
      {loading && <AdminLoading label="در حال دریافت سفارش..." />}
      {!loading && !detail && <AdminError error={error} onRetry={load} />}
      {!loading && detail && (
        <div className="ac-order-detail">
          <Toast kind={error ? 'error' : 'ok'} onClose={() => { setError(null); setMsg(''); }}>{error ? error.message : msg}</Toast>

          <div className="ac-order-hero">
            <div>
              <span className="ac-order-hero-label">مبلغ نهایی</span>
              <strong>{Number(order.total_toman).toLocaleString('fa-IR')} <small>تومان</small></strong>
            </div>
            <div className="ac-order-hero-meta">
              <StatusPill status={order.status} />
              <span>{formatDateTime(order.created_at)}</span>
              <span>{formatNumber(detail.items.length)} قلم کالا</span>
            </div>
          </div>

          <div className="ac-detail-grid">
            <section className="ac-detail-card">
              <h4><Icon name="user" size={15} /> مشتری</h4>
              <div className="ac-info-list">
                <div className="ac-info-row"><Avatar name={order.customer.full_name} size={38} /><strong>{order.customer.full_name}</strong></div>
                <div className="ac-info-row"><span className="ac-info-label">نام کاربری</span><span className="ac-info-value mono" dir="ltr">@{order.customer.username || '—'}</span></div>
                <div className="ac-info-row"><span className="ac-info-label">موبایل</span><CopyChip value={order.customer.phone} /></div>
                <div className="ac-info-row"><span className="ac-info-label">ایمیل</span><span className="ac-info-value" dir="ltr">{order.customer.email || '—'}</span></div>
              </div>
            </section>

            <section className="ac-detail-card">
              <h4><Icon name="truck" size={15} /> نشانی ارسال</h4>
              <p>{order.address.province} — {order.address.city}</p>
              <p className="muted">{order.address.address_line}</p>
              <div className="ac-address-meta">
                <span>گیرنده: {order.address.recipient_name || '—'}</span>
                <span dir="ltr">{order.address.recipient_phone || ''}</span>
                <span>کد پستی: {order.address.postal_code || '—'}</span>
              </div>
              {order.tracking_code && <Badge tone="pink">رهگیری: <span className="mono">{order.tracking_code}</span></Badge>}
            </section>
          </div>

          <section className="ac-detail-card">
            <h4><Icon name="package" size={15} /> اقلام سفارش</h4>
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead><tr><th>کالا</th><th>کد</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.product_name}<small className="ac-cell-sub">{Object.entries(item.variant_attrs || {}).map(([k, v]) => `${k}: ${v}`).join(' • ') || '—'}</small></td>
                      <td className="mono">{item.sku_code}</td>
                      <td>{formatNumber(item.quantity)}</td>
                      <td>{Number(item.unit_price_toman).toLocaleString('fa-IR')}</td>
                      <td>{Number(item.line_total_toman).toLocaleString('fa-IR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ac-order-totals">
              <span>جمع کالا <b>{Number(order.subtotal_toman).toLocaleString('fa-IR')}</b></span>
              <span>ارسال <b>{Number(order.shipping_toman).toLocaleString('fa-IR')}</b></span>
              <span>تخفیف <b>{Number(order.discount_toman).toLocaleString('fa-IR')}</b></span>
              <span className="ac-order-grand">پرداخت‌شده <b>{Number(order.total_toman).toLocaleString('fa-IR')} تومان</b></span>
            </div>
          </section>

          <div className="ac-detail-grid">
            <section className="ac-detail-card">
              <h4><Icon name="refresh" size={15} /> تغییر وضعیت</h4>
              {nextStatuses.length === 0 ? (
                <EmptyHint icon="check" title="این سفارش در وضعیت نهایی است" />
              ) : (
                <form className="ac-form" onSubmit={advance}>
                  <label className="ac-field"><span>وضعیت جدید</span>
                    <select className="ac-select" required value={form.to_status} onChange={(e) => setForm({ ...form, to_status: e.target.value })}>
                      <option value="">انتخاب کنید</option>
                      {nextStatuses.map((s) => <option key={s} value={s}>{STATUS_FILTERS.find((f) => f.id === s)?.label || s}</option>)}
                    </select>
                  </label>
                  {form.to_status === 'shipped' && (
                    <label className="ac-field"><span>کد رهگیری پست</span>
                      <input className="ac-input" required value={form.tracking_code} onChange={(e) => setForm({ ...form, tracking_code: e.target.value })} />
                    </label>
                  )}
                  {(form.to_status === 'return_in_progress' || form.to_status === 'canceled') && (
                    <label className="ac-field"><span>علت</span>
                      <input className="ac-input" required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                    </label>
                  )}
                  <button type="submit" className="ac-btn ac-btn-primary" disabled={busy || !form.to_status}>ثبت تغییر وضعیت</button>
                </form>
              )}
            </section>

            <section className="ac-detail-card">
              <h4><Icon name="clock" size={15} /> تاریخچهٔ وضعیت</h4>
              <div className="ac-timeline">
                {detail.history.map((h) => (
                  <div className="ac-timeline-item ac-tl-order" key={h.id}>
                    <span className="ac-tl-dot"><Icon name="check" size={12} /></span>
                    <div className="ac-tl-body">
                      <strong>{STATUS_FILTERS.find((f) => f.id === h.to_status)?.label || h.to_status}</strong>
                      <span>{h.actor_name || 'سامانه'} {h.reason ? `— ${h.reason}` : ''}</span>
                    </div>
                    <time>{formatDateTime(h.created_at)}</time>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function OrdersPanel() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '20');
    p.set('page', String(page));
    if (query) p.set('q', query);
    if (status) p.set('status', status);
    return `/admin/console/orders?${p.toString()}`;
  }, [query, status, page]);

  const { data, loading, error, reload, refreshing } = useAdminData(path);

  if (loading && !data) return <AdminLoading label="در حال دریافت سفارش‌ها..." />;
  if (error && !data) return <AdminError error={error} onRetry={reload} />;

  const items = data?.items || [];
  const counts = data?.counts || {};

  return (
    <div className="ac-panel">
      <Toast onClose={() => setToast('')}>{toast}</Toast>

      <div className="ac-panel-head">
        <div>
          <h2>سفارش‌های کالا</h2>
          <p>پیگیری، تغییر وضعیت و مشاهدهٔ اطلاعات کامل مشتری و اقلام هر سفارش.</p>
        </div>
        <button type="button" className="ac-btn ac-btn-soft" onClick={reload}>
          <Icon name="refresh" size={16} className={refreshing ? 'ac-spin' : ''} /> بروزرسانی
        </button>
      </div>

      <div className="ac-stats ac-stats-4">
        <StatCard icon="bag" label="کل سفارش‌ها" value={formatNumber(data?.total ?? 0)} sub="در همهٔ وضعیت‌ها" />
        <StatCard icon="creditCard" label="در انتظار پرداخت" value={formatNumber(counts.pending_payment ?? 0)} tone="amber" />
        <StatCard icon="truck" label="ارسال‌شده" value={formatNumber(counts.shipped ?? 0)} sub="در مسیر مشتری" tone="plum" />
        <StatCard icon="check" label="تکمیل‌شده" value={formatNumber(counts.completed ?? 0)} sub="تحویل موفق" tone="ok" />
      </div>

      <SectionCard
        title="فهرست سفارش‌ها"
        subtitle="جست‌وجو بر اساس کد سفارش، نام یا شمارهٔ مشتری"
        icon="bag"
        action={(
          <div className="ac-toolbar">
            <div className="ac-search">
              <Icon name="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="کد سفارش، نام یا موبایل..." />
              {q && <button type="button" className="ac-search-clear" onClick={() => setQ('')} aria-label="پاک کردن"><Icon name="x" size={13} /></button>}
            </div>
          </div>
        )}
      >
        <div className="ac-filter-chips">
          {STATUS_FILTERS.map((f) => (
            <button key={f.id} type="button" className={`ac-filter-chip ${status === f.id ? 'active' : ''}`} onClick={() => { setStatus(f.id); setPage(1); }}>
              {f.label}{f.id && counts[f.id] ? <b>{formatNumber(counts[f.id])}</b> : null}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <EmptyHint icon="bag" title="سفارشی یافت نشد" description="فیلتر یا عبارت جست‌وجو را تغییر دهید." />
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table ac-table-orders">
              <thead>
                <tr><th>کد سفارش</th><th>مشتری</th><th>موبایل</th><th>وضعیت</th><th>اقلام</th><th>مبلغ</th><th>تاریخ</th><th /></tr>
              </thead>
              <tbody>
                {items.map((order) => (
                  <tr key={order.id}>
                    <td><span className="mono ac-order-code">{order.code}</span></td>
                    <td>
                      <div className="ac-cell-person">
                        <Avatar name={order.full_name} size={32} />
                        <div><strong>{order.full_name}</strong><small dir="ltr">@{order.username || '—'}</small></div>
                      </div>
                    </td>
                    <td><span dir="ltr" className="mono">{order.phone}</span></td>
                    <td><StatusPill status={order.status} /></td>
                    <td>{formatNumber(order.item_count)}</td>
                    <td><b>{Number(order.total_toman).toLocaleString('fa-IR')}</b> <small>تومان</small></td>
                    <td className="ac-cell-date">{formatDateTime(order.created_at)}</td>
                    <td>
                      <button type="button" className="ac-btn ac-btn-soft ac-btn-sm" onClick={() => setSelected(order.code)}>جزئیات</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={data?.page || 1} limit={data?.limit || 20} total={data?.total || 0} onChange={setPage} />
      </SectionCard>

      {selected && (
        <OrderDetailModal
          code={selected}
          onClose={() => setSelected(null)}
          onChanged={() => { setToast('وضعیت سفارش ثبت شد.'); reload(); }}
        />
      )}
    </div>
  );
}
