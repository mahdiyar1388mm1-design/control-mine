import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, newIdempotencyKey } from '../lib/api';
import { formatDateTime, formatMoney, formatNumber, ROLE_LABELS } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/StateViews';
import { Icon } from '../components/Icon';

export function OrdersListPage() {
  const { user, authLoading } = useAuth();
  const [data, setData] = useState({ items: [], total: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadOrders = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const res = await apiFetch(`/orders${qs}`);
      setData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user, statusFilter]);

  useEffect(() => {
    if (!authLoading) loadOrders();
  }, [authLoading, loadOrders]);

  if (authLoading || loading) return <LoadingState label="در حال بارگذاری سفارش‌های شما..." />;
  if (!user) return <EmptyState title="ابتدا وارد حساب کاربری شوید" actionLabel="ورود" actionTo="/auth?next=/orders" />;
  if (error) return <ErrorState error={error} onRetry={loadOrders} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">سفارش‌های کالای من</h1>
          <p className="page-subtitle">پیگیری وضعیت آماده‌سازی، ارسال، کد رهگیری پستی و رسید رسمی سرور</p>
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 200 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">همهٔ وضعیت‌ها</option>
          <option value="pending_payment">در انتظار پرداخت</option>
          <option value="paid">پرداخت‌شده</option>
          <option value="preparing">در حال آماده‌سازی</option>
          <option value="shipped">ارسال‌شده</option>
          <option value="completed">تکمیل‌شده</option>
          <option value="canceled">لغوشده</option>
        </select>
      </div>

      {data.items.length === 0 ? (
        <EmptyState title="سفارشی یافت نشد" description="هنوز سفارشی ثبت نکرده‌اید." actionLabel="مشاهدهٔ فروشگاه" actionTo="/shop" />
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>کد سفارش</th>
                <th>وضعیت</th>
                <th>تعداد قلم</th>
                <th>مبلغ کل</th>
                <th>رهگیری مرسوله</th>
                <th>تاریخ ثبت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.code}>
                  <td><strong className="mono">{o.code}</strong></td>
                  <td><StatusBadge status={o.status} /></td>
                  <td>{formatNumber(o.item_count)} قلم</td>
                  <td><strong>{formatMoney(o.total_toman)}</strong></td>
                  <td>{o.tracking_code ? <span className="mono">{o.tracking_code}</span> : <span className="muted">پس از ارسال</span>}</td>
                  <td>{formatDateTime(o.created_at)}</td>
                  <td>
                    <Link to={`/orders/${o.code}`} className="btn btn-secondary btn-sm">جزئیات و پیگیری</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function OrderDetailPage() {
  const { code } = useParams();
  const [order, setOrder] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Cancel confirmation state
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/orders/${encodeURIComponent(code)}`);
      setOrder(res.order);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const handlePayNow = async () => {
    setBusy(true);
    setActionErr(null);
    try {
      const res = await apiFetch('/payments', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(`pay-${code}`),
        body: { order_code: code }
      });
      if (res.payment?.pay_url) {
        window.location.assign(res.payment.pay_url);
      }
    } catch (err) {
      setActionErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelivery = async () => {
    setBusy(true);
    setActionErr(null);
    try {
      const res = await apiFetch(`/orders/${encodeURIComponent(code)}/confirm-delivery`, { method: 'POST' });
      setOrder(res.order);
      setActionMsg('تحویل مرسوله پس از تأیید سرور ثبت شد.');
    } catch (err) {
      setActionErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelOrder = async () => {
    if (cancelReason.trim().length < 3) {
      setActionErr({ message: 'لطفاً علت لغو سفارش را حداقل در ۳ حرف بنویسید.' });
      return;
    }
    setBusy(true);
    setActionErr(null);
    try {
      const res = await apiFetch(`/orders/${encodeURIComponent(code)}/cancel`, {
        method: 'POST',
        body: { reason: cancelReason.trim() }
      });
      setOrder(res.order);
      setCancelOpen(false);
      setActionMsg('سفارش لغو شد و موجودی انبار طبق سیاست سامانه بازگردانده شد.');
    } catch (err) {
      setActionErr(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleServerReceipt = async () => {
    if (showReceipt) {
      setShowReceipt(false);
      return;
    }
    setBusy(true);
    setActionErr(null);
    try {
      const res = await apiFetch(`/orders/${encodeURIComponent(code)}/receipt`);
      setReceipt(res.receipt);
      setShowReceipt(true);
    } catch (err) {
      setActionErr(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="در حال دریافت اطلاعات سفارش از سرور..." />;
  if (error) return <ErrorState error={error} onRetry={loadOrder} />;
  if (!order) return null;

  const canCancel = ['pending_payment', 'paid'].includes(order.status);

  return (
    <div>
      <div className="no-print" style={{ marginBottom: 12 }}>
        <Link to="/orders" className="muted"><Icon name="arrowLeft" size={14} /> بازگشت به فهرست سفارش‌ها</Link>
      </div>

      {actionMsg && <div className="alert-inline ok" role="status"><Icon name="check" size={14} /> {actionMsg}</div>}
      {actionErr && <div className="alert-inline error" role="alert"><Icon name="alert" size={14} /> {actionErr.message}</div>}

      <div className="card">
        <div className="flex-between">
          <div>
            <h1 style={{ margin: 0, fontSize: '1.3rem' }}>
              سفارش <span className="mono">{order.code}</span>
            </h1>
            <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
              ثبت‌شده در: {formatDateTime(order.created_at)}
            </div>
          </div>
          <StatusBadge status={order.status} />
        </div>

        {order.tracking_code && (
          <div className="alert-inline info" style={{ marginTop: 14, marginBottom: 0 }}>
            <Icon name="truck2" size={15} /> کد رهگیری مرسوله: <strong className="mono">{order.tracking_code}</strong>
          </div>
        )}
        {order.cancel_reason && (
          <div className="alert-inline warn" style={{ marginTop: 14, marginBottom: 0 }}>
            علت لغو ثبت‌شده: {order.cancel_reason}
          </div>
        )}

        <div className="flex-gap no-print" style={{ marginTop: 16 }}>
          {order.status === 'pending_payment' && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handlePayNow}>
              {busy ? '⏳ در حال انتقال...' : 'پرداخت سفارش (درگاه آزمایشی)'}
            </button>
          )}
          {order.status === 'shipped' && (
            <button type="button" className="btn btn-ok" disabled={busy} onClick={handleConfirmDelivery}>
              <Icon name="check" size={14} /> تأیید تحویل گرفتن مرسوله
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={toggleServerReceipt}>
            {showReceipt ? 'بستن رسید رسمی سرور' : <><Icon name="receipt2" size={14} /> مشاهده / چاپ رسید رسمی سرور</>}
          </button>
          {canCancel && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setCancelOpen(true)}>
              لغو سفارش
            </button>
          )}
        </div>
      </div>

      {showReceipt && receipt && (
        <section className="card" style={{ border: '2px solid var(--primary)' }}>
          <div className="flex-between" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: '1.12rem' }}>رسید رسمی سفارش (تولیدشده از دادهٔ سرور)</h2>
            <button type="button" className="btn btn-secondary btn-sm no-print" onClick={() => window.print()}>
              <Icon name="printer" size={14} /> چاپ رسید
            </button>
          </div>
          <div className="grid grid-2" style={{ fontSize: '0.9rem', marginBottom: 10 }}>
            <div>کد سفارش: <strong className="mono">{receipt.order_code}</strong></div>
            <div>وضعیت پرداخت: <strong>{receipt.payment_status === 'paid' ? 'پرداخت‌شده' : receipt.payment_status}</strong></div>
            <div>زمان پرداخت: <strong>{formatDateTime(receipt.paid_at)}</strong></div>
            <div>زمان صدور رسید: <strong>{formatDateTime(receipt.generated_at)}</strong></div>
          </div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            گیرنده: {receipt.address?.recipient_name} — {receipt.address?.province}، {receipt.address?.city}، {receipt.address?.address_line}
          </div>
        </section>
      )}

      <div className="two-col-layout">
        <section className="card table-wrap">
          <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>اقلام سفارش</h2>
          <table className="table">
            <thead>
              <tr>
                <th>نام کالا</th>
                <th>کد SKU</th>
                <th>تعداد</th>
                <th>فی واحد</th>
                <th>جمع ردیف</th>
              </tr>
            </thead>
            <tbody>
              {(order.items || []).map((it) => (
                <tr key={it.id}>
                  <td>
                    <strong>{it.product_name}</strong>
                    <div className="muted" style={{ fontSize: '0.78rem' }}>
                      {Object.entries(it.variant_attrs || {}).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                    </div>
                  </td>
                  <td className="mono">{it.sku_code}</td>
                  <td>{formatNumber(it.quantity)}</td>
                  <td>{formatMoney(it.unit_price_toman)}</td>
                  <td><strong>{formatMoney(it.line_total_toman)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 14, background: 'var(--surface-alt)', padding: 12, borderRadius: 8 }}>
            <div className="flex-between"><span>جمع کالاها:</span><span>{formatMoney(order.subtotal_toman)}</span></div>
            <div className="flex-between"><span>هزینهٔ ارسال:</span><span>{formatMoney(order.shipping_toman, { freeLabel: true })}</span></div>
            <div className="flex-between" style={{ marginTop: 6, fontWeight: 800, fontSize: '1.04rem' }}>
              <span>مبلغ کل سفارش:</span>
              <span>{formatMoney(order.total_toman)}</span>
            </div>
          </div>
        </section>

        <div>
          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>نشانی ثبت‌شده در لحظهٔ سفارش</h2>
            <p style={{ margin: 0, fontSize: '0.92rem' }}>
              <strong>{order.address?.title}</strong> — {order.address?.province}، {order.address?.city}، {order.address?.address_line}
            </p>
            <div className="muted" style={{ fontSize: '0.82rem', marginTop: 6 }}>
              کدپستی: <span className="mono">{order.address?.postal_code}</span> • گیرنده: {order.address?.recipient_name}
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>تاریخچهٔ تغییر وضعیت</h2>
            {(order.history || []).map((h, idx) => (
              <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}>
                <div className="flex-between">
                  <StatusBadge status={h.to_status} />
                  <span className="muted">{formatDateTime(h.created_at)}</span>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  توسط: {h.actor_name || ROLE_LABELS[h.actor_role] || 'سامانه'}
                  {h.reason ? ` — علت: ${h.reason}` : ''}
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title={`لغو سفارش ${order.code}`}
        description={order.status === 'paid'
          ? 'این سفارش پرداخت شده است. با تأیید لغو، موجودی کالا به انبار برمی‌گردد و رکورد استرداد وجه آزمایشی ثبت خواهد شد.'
          : 'با تأیید لغو، سفارش بسته شده و موجودی رزروشده به انبار بازگردانده می‌شود.'}
        confirmLabel="تأیید قطعی لغو سفارش"
        danger
        busy={busy}
        onCancel={() => setCancelOpen(false)}
        onConfirm={handleCancelOrder}
      >
        <div className="form-row">
          <label className="form-label" htmlFor="cancel-ord-reason">علت لغو سفارش <span className="req-star">*</span></label>
          <input
            id="cancel-ord-reason"
            className="input"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="مثلاً تغییر مدل مورد نیاز یا ثبت اشتباه نشانی"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
