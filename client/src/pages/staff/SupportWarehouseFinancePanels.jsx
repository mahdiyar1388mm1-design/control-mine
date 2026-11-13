import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatDateTime, formatMoney, formatNumber, PRIORITY_LABELS, ROLE_LABELS, TICKET_CATEGORY_LABELS } from '../../lib/format';
import { ConfirmDialog, EmptyState, ErrorState, FieldErrorsList, LoadingState, StatusBadge } from '../../components/StateViews';
import { Icon } from '../../components/Icon';

/* ===================== SUPPORT PANEL ===================== */

export function SupportTicketsPanel() {
  const [tickets, setTickets] = useState({ items: [], total: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [nextStatus, setNextStatus] = useState('open');
  const [statusReason, setStatusReason] = useState('');
  const [referTeam, setReferTeam] = useState('support');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (q.trim()) qs.set('q', q.trim());
      const res = await apiFetch(`/staff/tickets?${qs.toString()}`);
      setTickets(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, q]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const openTicket = async (code) => {
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch(`/tickets/${encodeURIComponent(code)}`);
      setSelected(res.ticket);
      setNextStatus(res.ticket.status);
    } catch (err) {
      setOpErr(err);
    }
  };

  const handleReply = async (e) => {
    e.preventDefault();
    if (!selected || !replyBody.trim()) return;
    setBusy(true);
    setOpErr(null);
    try {
      const res = await apiFetch(`/tickets/${encodeURIComponent(selected.code)}/messages`, {
        method: 'POST',
        body: { body: replyBody.trim() }
      });
      setSelected(res.ticket);
      setReplyBody('');
      setMsg('پاسخ پشتیبانی ارسال شد.');
      await loadTickets();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setOpErr(null);
    try {
      const res = await apiFetch(`/staff/tickets/${encodeURIComponent(selected.code)}/status`, {
        method: 'POST',
        body: { to_status: nextStatus, reason: statusReason.trim() }
      });
      setSelected(res.ticket);
      setStatusReason('');
      setMsg('وضعیت تیکت تغییر کرد.');
      await loadTickets();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleReferTeam = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setOpErr(null);
    try {
      const res = await apiFetch(`/staff/tickets/${encodeURIComponent(selected.code)}/assign`, {
        method: 'POST',
        body: { team: referTeam, reason: `ارجاع به تیم ${referTeam}` }
      });
      setSelected(res.ticket);
      setMsg('تیکت به واحد مورد نظر ارجاع شد.');
      await loadTickets();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="grid grid-3" style={{ alignItems: 'end' }}>
          <div>
            <label className="form-label">وضعیت تیکت</label>
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">همهٔ وضعیت‌ها</option>
              <option value="new">جدید</option>
              <option value="open">باز</option>
              <option value="waiting_customer">منتظر پاسخ مشتری</option>
              <option value="waiting_team">ارجاع‌شده به تیم</option>
              <option value="resolved">حل‌شده</option>
              <option value="closed">بسته</option>
            </select>
          </div>
          <div>
            <label className="form-label">جست‌وجو (کد، موضوع یا نام مشتری)</label>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثلاً TK-..." />
          </div>
          <button type="button" className="btn btn-secondary" onClick={loadTickets}>بروزرسانی فهرست</button>
        </div>
      </div>

      {loading && <LoadingState />}
      {!loading && error && <ErrorState error={error} onRetry={loadTickets} />}

      {!loading && !error && (
        <div className="two-col-layout">
          <div className="card table-wrap">
            <h3 style={{ marginTop: 0, fontSize: '1.04rem' }}>تیکت‌های پشتیبانی ({formatNumber(tickets.total)})</h3>
            {tickets.items.length === 0 ? (
              <EmptyState title="تیکتی یافت نشد" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>شماره</th>
                    <th>موضوع / مشتری</th>
                    <th>اولویت</th>
                    <th>وضعیت</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.items.map((t) => (
                    <tr key={t.id}>
                      <td className="mono"><strong>{t.code}</strong></td>
                      <td>
                        <strong>{t.subject}</strong>
                        <div className="muted" style={{ fontSize: '0.8rem' }}>{t.customer_name} • {TICKET_CATEGORY_LABELS[t.category]}</div>
                      </td>
                      <td>{PRIORITY_LABELS[t.priority]}</td>
                      <td><StatusBadge status={t.status} /></td>
                      <td>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => openTicket(t.code)}>بررسی</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            {!selected ? (
              <div className="muted">یک تیکت را برای پاسخ‌گویی یا ارجاع انتخاب کنید.</div>
            ) : (
              <>
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{selected.code} — {selected.subject}</h3>
                  <StatusBadge status={selected.status} />
                </div>
                {msg && <div className="alert-inline ok"><Icon name="check" size={14} /> {msg}</div>}
                {opErr && <div className="alert-inline error"><Icon name="alert" size={14} /> {opErr.message}</div>}

                {(selected.messages || []).map((m) => (
                  <div key={m.id} className={`msg-item ${m.author_role !== 'customer' ? 'operator' : ''}`}>
                    <div className="msg-header">
                      <strong>{m.author_name || ROLE_LABELS[m.author_role]}</strong>
                      <span>{formatDateTime(m.created_at)}</span>
                    </div>
                    <div style={{ fontSize: '0.88rem', whiteSpace: 'pre-line' }}>{m.body}</div>
                  </div>
                ))}

                <form onSubmit={handleReply} style={{ marginTop: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                  <label className="form-label">پاسخ به مشتری</label>
                  <textarea className="textarea" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} />
                  <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 6 }} disabled={busy || !replyBody.trim()}>
                    ارسال پاسخ
                  </button>
                </form>

                <form onSubmit={handleStatus} style={{ marginTop: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                  <label className="form-label">تغییر وضعیت تیکت</label>
                  <div className="flex-gap">
                    <select className="select" style={{ width: 'auto' }} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                      <option value="open">باز</option>
                      <option value="waiting_customer">منتظر پاسخ مشتری</option>
                      <option value="resolved">حل‌شده</option>
                      <option value="closed">بسته</option>
                    </select>
                    <input className="input" style={{ flex: 1 }} placeholder="توضیح تغییر وضعیت..." value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />
                    <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>ثبت</button>
                  </div>
                </form>

                <form onSubmit={handleReferTeam} style={{ marginTop: 12 }}>
                  <label className="form-label">ارجاع تیکت به واحد دیگر</label>
                  <div className="flex-gap">
                    <select className="select" style={{ flex: 1 }} value={referTeam} onChange={(e) => setReferTeam(e.target.value)}>
                      <option value="support">پشتیبانی عمومی</option>
                      <option value="warehouse">واحد انبار و ارسال</option>
                      <option value="finance">واحد مالی</option>
                    </select>
                    <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>ارجاع</button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== WAREHOUSE PANEL ===================== */

export function WarehousePanel() {
  const [subTab, setSubTab] = useState('orders'); // orders | stock
  const [orders, setOrders] = useState({ items: [], total: 0 });
  const [statusFilter, setStatusFilter] = useState('paid');
  const [skus, setSkus] = useState({ items: [], total: 0 });
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [trackingCode, setTrackingCode] = useState('');
  const [adjustSku, setAdjustSku] = useState(null);
  const [delta, setDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [movements, setMovements] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (subTab === 'orders') {
        const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
        const res = await apiFetch(`/staff/orders${qs}`);
        setOrders(res);
      } else {
        const res = await apiFetch(`/admin/skus?limit=50${lowOnly ? '&low_stock=1' : ''}`);
        setSkus(res);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [subTab, statusFilter, lowOnly]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openOrderDetail = async (code) => {
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch(`/orders/${encodeURIComponent(code)}`);
      setSelectedOrder(res.order);
      setTrackingCode(res.order.tracking_code || '');
    } catch (err) {
      setOpErr(err);
    }
  };

  const advanceOrder = async (toStatus) => {
    if (!selectedOrder) return;
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch(`/staff/orders/${encodeURIComponent(selectedOrder.code)}/status`, {
        method: 'POST',
        body: {
          to_status: toStatus,
          tracking_code: trackingCode.trim() || undefined,
          reason: toStatus === 'preparing' ? 'شروع آماده‌سازی و بسته‌بندی در انبار' : 'ثبت ارسال مرسوله'
        }
      });
      setSelectedOrder(res.order);
      setMsg('وضعیت سفارش در سرور ثبت شد.');
      await loadData();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const openStockModal = async (sku) => {
    setAdjustSku(sku);
    setDelta('');
    setAdjustReason('');
    setOpErr(null);
    try {
      const res = await apiFetch(`/admin/skus/${sku.id}/movements`);
      setMovements(res.items || []);
    } catch {
      setMovements([]);
    }
  };

  const submitStockAdjust = async (e) => {
    e.preventDefault();
    if (!adjustSku) return;
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch(`/admin/skus/${adjustSku.id}/stock`, {
        method: 'POST',
        body: { delta: Number(delta), reason: adjustReason.trim() }
      });
      setAdjustSku(null);
      setMsg('اصلاح موجودی با ثبت علت و سابقهٔ ممیزی انجام شد.');
      await loadData();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="tabs">
        <button type="button" className={`tab-btn ${subTab === 'orders' ? 'active' : ''}`} onClick={() => setSubTab('orders')}>
          <Icon name="package" size={16} /> صف آماده‌سازی و ارسال سفارش‌ها
        </button>
        <button type="button" className={`tab-btn ${subTab === 'stock' ? 'active' : ''}`} onClick={() => setSubTab('stock')}>
          <Icon name="tagIcon" size={16} /> موجودی انبار و اصلاح با دلیل
        </button>
      </div>

      {msg && <div className="alert-inline ok"><Icon name="check" size={14} /> {msg}</div>}
      {opErr && (
        <>
          <div className="alert-inline error"><Icon name="alert" size={14} /> {opErr.message}</div>
          <FieldErrorsList details={opErr.details} />
        </>
      )}

      {subTab === 'orders' && (
        <>
          <div className="card flex-between">
            <span style={{ fontWeight: 700 }}>فیلتر وضعیت سفارش‌های انبار:</span>
            <select className="select" style={{ width: 'auto', minWidth: 220 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="paid">پرداخت‌شده (آمادهٔ پردازش انبار)</option>
              <option value="preparing">در حال آماده‌سازی و بسته‌بندی</option>
              <option value="shipped">ارسال‌شده</option>
              <option value="return_in_progress">مرجوعی در جریان</option>
              <option value="">همهٔ سفارش‌ها</option>
            </select>
          </div>

          {loading && <LoadingState />}
          {!loading && error && <ErrorState error={error} onRetry={loadData} />}

          {!loading && !error && (
            <div className="two-col-layout">
              <div className="card table-wrap">
                {orders.items.length === 0 ? (
                  <EmptyState title="سفارشی در این وضعیت وجود ندارد" />
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>کد سفارش</th>
                        <th>وضعیت</th>
                        <th>اقلام</th>
                        <th>تاریخ</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.items.map((o) => (
                        <tr key={o.code}>
                          <td className="mono"><strong>{o.code}</strong></td>
                          <td><StatusBadge status={o.status} /></td>
                          <td>{formatNumber(o.item_count)} قلم</td>
                          <td>{formatDateTime(o.created_at)}</td>
                          <td>
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => openOrderDetail(o.code)}>
                              عملیات ارسال
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="card">
                {!selectedOrder ? (
                  <div className="muted">سفارشی را انتخاب کنید تا اقلام بسته‌بندی و ثبت کد رهگیری نمایش داده شود.</div>
                ) : (
                  <>
                    <div className="flex-between" style={{ marginBottom: 10 }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>سفارش <span className="mono">{selectedOrder.code}</span></h3>
                      <StatusBadge status={selectedOrder.status} />
                    </div>
                    <div style={{ background: 'var(--surface-alt)', padding: 12, borderRadius: 8, fontSize: '0.88rem', marginBottom: 12 }}>
                      <div><strong>گیرنده:</strong> {selectedOrder.address?.recipient_name} ({selectedOrder.address?.province}، {selectedOrder.address?.city})</div>
                      <div><strong>نشانی:</strong> {selectedOrder.address?.address_line}</div>
                      <div><strong>کدپستی:</strong> <span className="mono">{selectedOrder.address?.postal_code}</span> • روش: {selectedOrder.shipping_method}</div>
                    </div>

                    <h4 style={{ margin: '0 0 6px', fontSize: '0.94rem' }}>اقلام جهت جمع‌آوری از قفسه:</h4>
                    <ul style={{ paddingRight: 18, fontSize: '0.88rem' }}>
                      {(selectedOrder.items || []).map((it) => (
                        <li key={it.id}>
                          <strong>{it.product_name}</strong> — کد <span className="mono">{it.sku_code}</span> × <strong>{formatNumber(it.quantity)} عدد</strong>
                        </li>
                      ))}
                    </ul>

                    {selectedOrder.status === 'paid' && (
                      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => advanceOrder('preparing')}>
                        <Icon name="package" size={15} /> ثبت شروع آماده‌سازی و بسته‌بندی
                      </button>
                    )}

                    {selectedOrder.status === 'preparing' && (
                      <div style={{ marginTop: 12 }}>
                        <label className="form-label">شمارهٔ رهگیری پستی / بارنامه (الزامی) <span className="req-star">*</span></label>
                        <input
                          className="input mono"
                          style={{ marginBottom: 8 }}
                          value={trackingCode}
                          onChange={(e) => setTrackingCode(e.target.value)}
                          placeholder="POST-IR-..."
                        />
                        <button type="button" className="btn btn-ok btn-block" disabled={busy || !trackingCode.trim()} onClick={() => advanceOrder('shipped')}>
                          <Icon name="truck2" size={15} /> ثبت تحویل به پست و ارسال مرسوله
                        </button>
                      </div>
                    )}

                    {selectedOrder.status === 'return_in_progress' && (
                      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => advanceOrder('returned')}>
                        <Icon name="undo" size={15} /> تأیید دریافت فیزیکی کالای مرجوعی در انبار
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {subTab === 'stock' && (
        <div className="card">
          <div className="flex-between" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>فهرست SKUها و موجودی انبار (بدون اطلاعات قیمت خرید محرمانه)</h3>
            <label className="flex-gap" style={{ fontSize: '0.88rem' }}>
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
              <span>فقط کالاهای رو به اتمام (موجودی ۵ یا کمتر)</span>
            </label>
          </div>

          {loading ? <LoadingState /> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>کد SKU</th>
                    <th>نام کالا</th>
                    <th>ویژگی تنوع</th>
                    <th>موجودی فعلی</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {skus.items.map((s) => (
                    <tr key={s.id}>
                      <td className="mono"><strong>{s.code}</strong></td>
                      <td>{s.product_name}</td>
                      <td>{Object.entries(s.variant_attrs || {}).map(([k, v]) => `${k}: ${v}`).join(' | ')}</td>
                      <td>
                        <span className={`badge ${s.stock <= 5 ? 'badge-warn' : 'badge-ok'}`}>
                          {formatNumber(s.stock)} عدد
                        </span>
                      </td>
                      <td>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openStockModal(s)}>
                          اصلاح موجودی / سابقه
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {adjustSku && (
            <div className="modal-backdrop" role="dialog" aria-modal="true">
              <div className="modal-card" style={{ maxWidth: 580 }}>
                <h3 style={{ marginTop: 0 }}>اصلاح موجودی <span className="mono">{adjustSku.code}</span></h3>
                <p className="muted" style={{ fontSize: '0.88rem' }}>
                  موجودی فعلی: <strong>{formatNumber(adjustSku.stock)} عدد</strong> — هرگونه اصلاح فقط با ثبت دلیل و سابقهٔ ممیزی انجام می‌شود.
                </p>
                <form onSubmit={submitStockAdjust}>
                  <div className="grid grid-2">
                    <div className="form-row">
                      <label className="form-label">میزان تغییر (مثبت یا منفی) <span className="req-star">*</span></label>
                      <input type="number" className="input mono" required value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="مثلاً 5 یا -2" />
                    </div>
                    <div className="form-row">
                      <label className="form-label">علت انبارگردانی / اصلاح <span className="req-star">*</span></label>
                      <input className="input" required minLength={3} value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="ورود محموله جدید / کسری شمارش" />
                    </div>
                  </div>
                  <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => setAdjustSku(null)}>بستن</button>
                    <button type="submit" className="btn btn-primary" disabled={busy}>ثبت اصلاح موجودی</button>
                  </div>
                </form>

                {movements.length > 0 && (
                  <div style={{ marginTop: 16, maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                    <strong style={{ fontSize: '0.86rem' }}>آخرین گردش‌های ثبت‌شده:</strong>
                    {movements.map((m) => (
                      <div key={m.id} className="flex-between" style={{ fontSize: '0.8rem', padding: '4px 0', borderBottom: '1px dashed var(--border-subtle)' }}>
                        <span className="mono">{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                        <span>{m.reason}</span>
                        <span className="muted">{formatDateTime(m.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===================== FINANCE & REPORTS PANEL ===================== */

export function FinanceReportsPanel({ userRole }) {
  const canPayments = ['finance', 'admin'].includes(userRole);
  const canSalesReport = ['finance', 'admin'].includes(userRole);
  const canTicketsReport = ['support', 'admin'].includes(userRole);

  const defaultTab = canPayments ? 'payments' : 'rep-tickets';
  const [tab, setTab] = useState(defaultTab);
  const [statusFilter, setStatusFilter] = useState('');
  const [payments, setPayments] = useState({ items: [], total: 0 });
  const [lthWithdrawals, setLthWithdrawals] = useState({ items: [], total: 0 });
  const [lthReconciliation, setLthReconciliation] = useState(null);
  const [wdModal, setWdModal] = useState(null);
  const [wdAction, setWdAction] = useState('approve_paid');
  const [wdBankRef, setWdBankRef] = useState('');
  const [wdNote, setWdNote] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Refund confirmation dialog
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundRef, setRefundRef] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);

  const loadTab = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'payments') {
        const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
        const res = await apiFetch(`/payments${qs}`);
        setPayments(res);
      } else if (tab === 'lth-withdrawals') {
        const [wRes, rRes] = await Promise.all([
          apiFetch('/staff/lth/withdrawals?limit=50'),
          apiFetch('/admin/lth/reconciliation')
        ]);
        setLthWithdrawals(wRes);
        setLthReconciliation(rRes.reconciliation);
      } else if (tab === 'rep-sales') {
        setReport(await apiFetch('/admin/reports/sales'));
      } else if (tab === 'rep-payments') {
        setReport(await apiFetch('/admin/reports/payments'));
      } else if (tab === 'rep-tickets') {
        setReport(await apiFetch('/admin/reports/tickets'));
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [tab, statusFilter]);

  useEffect(() => {
    loadTab();
  }, [loadTab]);

  const handleRefundConfirm = async () => {
    if (!refundTarget) return;
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch(`/payments/${refundTarget.id}/refund`, {
        method: 'POST',
        body: {
          reason: refundReason.trim(),
          reference: refundRef.trim(),
          amount_toman: refundAmount ? Number(refundAmount) : undefined
        }
      });
      setRefundTarget(null);
      setRefundReason('');
      setRefundRef('');
      setRefundAmount('');
      setMsg('استرداد وجه با مرجع و ثبت ممیزی انجام شد.');
      await loadTab();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleReviewLthWithdrawal = async (e) => {
    e.preventDefault();
    if (!wdModal) return;
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch(`/staff/lth/withdrawals/${encodeURIComponent(wdModal.code)}/review`, {
        method: 'POST',
        body: {
          action: wdAction,
          bank_ref: wdBankRef.trim(),
          review_note: wdNote.trim()
        }
      });
      setWdModal(null);
      setWdBankRef('');
      setWdNote('');
      setMsg(wdAction === 'approve_paid'
        ? 'تسویهٔ شبا با ثبت مرجع بانکی تأیید شد.'
        : 'درخواست برداشت رد شد و موجودی به‌صورت اتمیک به کیف پول کاربر بازگشت.');
      await loadTab();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="tabs">
        {canPayments && (
          <button type="button" className={`tab-btn ${tab === 'payments' ? 'active' : ''}`} onClick={() => setTab('payments')}>
            <Icon name="money" size={15} /> تراکنش‌ها و استرداد وجه
          </button>
        )}
        {canPayments && (
          <button type="button" className={`tab-btn ${tab === 'lth-withdrawals' ? 'active' : ''}`} onClick={() => setTab('lth-withdrawals')}>
            <Icon name="bank" size={15} /> تسویهٔ شبا و دفتر کل LTH
          </button>
        )}
        {canSalesReport && (
          <button type="button" className={`tab-btn ${tab === 'rep-sales' ? 'active' : ''}`} onClick={() => setTab('rep-sales')}>
            <Icon name="chart" size={15} /> گزارش فروش کالا و سود تاریخی
          </button>
        )}
        {canPayments && (
          <button type="button" className={`tab-btn ${tab === 'rep-payments' ? 'active' : ''}`} onClick={() => setTab('rep-payments')}>
            <Icon name="chart" size={15} /> گزارش پرداخت‌ها و استردادها
          </button>
        )}
        {canTicketsReport && (
          <button type="button" className={`tab-btn ${tab === 'rep-tickets' ? 'active' : ''}`} onClick={() => setTab('rep-tickets')}>
            <Icon name="chart" size={15} /> گزارش تیکت‌های پشتیبانی
          </button>
        )}
      </div>

      {msg && <div className="alert-inline ok"><Icon name="check" size={14} /> {msg}</div>}
      {opErr && (
        <>
          <div className="alert-inline error"><Icon name="alert" size={14} /> {opErr.message}</div>
          <FieldErrorsList details={opErr.details} />
        </>
      )}

      {loading && <LoadingState />}
      {!loading && error && <ErrorState error={error} onRetry={loadTab} />}

      {!loading && !error && tab === 'payments' && (
        <div className="card">
          <div className="flex-between" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>تراکنش‌های پرداخت (آداپتور Sandbox)</h3>
            <select className="select" style={{ width: 'auto', minWidth: 200 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">همهٔ وضعیت‌ها</option>
              <option value="paid">پرداخت‌شده</option>
              <option value="pending">در انتظار پرداخت</option>
              <option value="failed">ناموفق</option>
              <option value="expired">منقضی / نامعلوم</option>
              <option value="refunded">مستردشده</option>
            </select>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>شناسه پرداخت</th>
                  <th>مبلغ</th>
                  <th>وضعیت</th>
                  <th>مرجع درگاه</th>
                  <th>زمان ثبت</th>
                  <th>عملیات مالی</th>
                </tr>
              </thead>
              <tbody>
                {payments.items.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id.slice(0, 12)}…</td>
                    <td><strong>{formatMoney(p.amount_toman)}</strong></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="mono">{p.gateway_ref || '—'}</td>
                    <td>{formatDateTime(p.created_at)}</td>
                    <td>
                      {p.status === 'paid' ? (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            setRefundTarget(p);
                            setRefundAmount(String(p.amount_toman));
                          }}
                        >
                          ثبت استرداد وجه
                        </button>
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && tab === 'lth-withdrawals' && (
        <div>
          {lthReconciliation && (
            <div className="card" style={{ background: lthReconciliation.healthy ? '#f0fdf4' : '#fef2f2', borderColor: lthReconciliation.healthy ? '#86efac' : '#fca5a5' }}>
              <div className="flex-between">
                <strong style={{ color: lthReconciliation.healthy ? '#166534' : '#991b1b' }}>
                  <Icon name={lthReconciliation.healthy ? 'check' : 'alert'} size={14} /> {lthReconciliation.healthy ? 'نشان سلامت و همخوانی دفتر کل حسابداری LTH' : 'هشدار تطبیق دفتر کل LTH'}
                </strong>
                <span className={`badge ${lthReconciliation.healthy ? 'badge-ok' : 'badge-danger'}`}>
                  {lthReconciliation.status_label}
                </span>
              </div>
              <div style={{ fontSize: '0.84rem', marginTop: 6 }}>
                کیف پول‌ها: <strong>{formatNumber(lthReconciliation.checked_wallets)}</strong> | ثبت‌های دفتر کل: <strong>{formatNumber(lthReconciliation.checked_ledger_entries)}</strong> | پاداش ۲۴ساعته ۱.۰۰ LTH: <strong className="mono">{lthReconciliation.benchmark_1_lth_24h.reward_24h_irr_formatted} ریال</strong>
              </div>
            </div>
          )}

          <div className="card table-wrap">
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>درخواست‌های برداشت شبا و فروش LTH</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>کاربر</th>
                  <th>نوع</th>
                  <th>مبلغ ریالی</th>
                  <th>شماره شبا</th>
                  <th>وضعیت</th>
                  <th>عملیات تسویه</th>
                </tr>
              </thead>
              <tbody>
                {(lthWithdrawals.items || []).map((wd) => (
                  <tr key={wd.id}>
                    <td className="mono">{wd.code}</td>
                    <td>{wd.user_name} <span className="muted mono">({wd.user_phone_masked})</span></td>
                    <td>{wd.kind_label}</td>
                    <td><strong>{wd.amount_irr_formatted} ریال</strong> <span className="muted">({formatMoney(wd.amount_toman)})</span></td>
                    <td className="mono">{wd.sheba_iban}</td>
                    <td><StatusBadge status={wd.status === 'paid' ? 'paid' : (wd.status === 'pending' ? 'pending' : 'canceled')} label={wd.status_label} /></td>
                    <td>
                      {wd.status === 'pending' ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            setWdModal(wd);
                            setWdAction('approve_paid');
                            setWdBankRef('');
                            setWdNote('');
                          }}
                        >
                          بررسی / ثبت پایا
                        </button>
                      ) : <span className="mono" style={{ fontSize: '0.8rem' }}>{wd.bank_ref || wd.review_note || '—'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {wdModal && (
            <div className="modal-backdrop" role="dialog" aria-modal="true">
              <form onSubmit={handleReviewLthWithdrawal} className="modal-card">
                <h3 style={{ marginTop: 0 }}>تعیین تکلیف تسویهٔ شبا <span className="mono">{wdModal.code}</span></h3>
                <p className="muted" style={{ fontSize: '0.86rem' }}>
                  صاحب حساب: <strong>{wdModal.account_holder_name}</strong> | شبا: <span className="mono">{wdModal.sheba_iban}</span> | مبلغ: <strong>{wdModal.amount_irr_formatted} ریال</strong>
                </p>
                <div className="form-row">
                  <label className="form-label">نتیجهٔ بررسی مالی</label>
                  <select className="select" value={wdAction} onChange={(e) => setWdAction(e.target.value)}>
                    <option value="approve_paid">تأیید واریز شبا (ثبت شماره مرجع پایا/ساتنا)</option>
                    <option value="reject">رد درخواست و برگشت آنی موجودی به کیف پول کاربر</option>
                  </select>
                </div>
                {wdAction === 'approve_paid' && (
                  <div className="form-row">
                    <label className="form-label">شماره مرجع بانکی (پایا/ساتنا) <span className="req-star">*</span></label>
                    <input className="input mono" required minLength={4} value={wdBankRef} onChange={(e) => setWdBankRef(e.target.value)} placeholder="PAYA-14050820991" />
                  </div>
                )}
                <div className="form-row">
                  <label className="form-label">{wdAction === 'reject' ? 'علت رد درخواست *' : 'توضیحات مالی (اختیاری)'}</label>
                  <input className="input" required={wdAction === 'reject'} value={wdNote} onChange={(e) => setWdNote(e.target.value)} placeholder="توضیح جهت اطلاع کاربر و ثبت در ممیزی..." />
                </div>
                <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setWdModal(null)}>انصراف</button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>ثبت قطعی</button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {!loading && !error && tab !== 'payments' && tab !== 'lth-withdrawals' && report && (
        <div>
          {/* §17: Mandatory Report Definition Header */}
          <div className="card" style={{ background: 'var(--surface-alt)' }}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>{report.meta?.title}</h3>
            <div className="grid grid-3" style={{ fontSize: '0.85rem' }}>
              <div><strong>منبع داده:</strong> {report.meta?.source}</div>
              <div><strong>واحد اندازه‌گیری:</strong> {report.meta?.unit}</div>
              <div><strong>مجوز مشاهده:</strong> {report.meta?.permission}</div>
              <div><strong>از تاریخ:</strong> {formatDateTime(report.meta?.from)}</div>
              <div><strong>تا تاریخ:</strong> {formatDateTime(report.meta?.to)}</div>
              <div><strong>زمان به‌روزرسانی:</strong> {formatDateTime(report.meta?.generated_at)}</div>
            </div>
            <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.84rem' }}>
              <strong>تفکیک مفهومی گزارش:</strong> {report.meta?.distinction_note}
            </p>
          </div>

          {tab === 'rep-sales' && report.kpis && (
            <>
              <div className="grid grid-4" style={{ marginBottom: 16 }}>
                <div className="kpi-card">
                  <div className="kpi-label">تعداد سفارش‌های قطعی کالا</div>
                  <div className="kpi-value">{formatNumber(report.kpis.fulfilled_order_count)} سفارش</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">فروش ناخالص کالا (بدون ارسال)</div>
                  <div className="kpi-value">{formatMoney(report.kpis.gross_goods_toman)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">بهای تمام‌شدهٔ تاریخی در زمان فروش</div>
                  <div className="kpi-value">{formatMoney(report.kpis.historical_cogs_toman)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">سود ناخالص فروش کالا</div>
                  <div className="kpi-value" style={{ color: 'var(--ok)' }}>{formatMoney(report.kpis.gross_profit_toman)}</div>
                </div>
              </div>

              <div className="card table-wrap">
                <h4 style={{ marginTop: 0 }}>سفارش‌های اخیر بازه (تلفن مشتریان ماسک‌شده است)</h4>
                <table className="table">
                  <thead>
                    <tr>
                      <th>کد سفارش</th>
                      <th>مشتری</th>
                      <th>تلفن (ماسک‌شده)</th>
                      <th>وضعیت</th>
                      <th>جمع کالا</th>
                      <th>ارسال</th>
                      <th>کل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.recent_orders || []).map((o) => (
                      <tr key={o.code}>
                        <td className="mono">{o.code}</td>
                        <td>{o.customer_name}</td>
                        <td className="mono">{o.customer_phone}</td>
                        <td><StatusBadge status={o.status} /></td>
                        <td>{formatMoney(o.subtotal_toman)}</td>
                        <td>{formatMoney(o.shipping_toman)}</td>
                        <td><strong>{formatMoney(o.total_toman)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'rep-payments' && (
            <div className="card table-wrap">
              <h4 style={{ marginTop: 0 }}>تفکیک تراکنش‌ها بر اساس وضعیت</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>وضعیت</th>
                    <th>تعداد</th>
                    <th>مربوط به سفارش کالا</th>
                    <th>مجموع مبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.by_status || []).map((row) => (
                    <tr key={row.status}>
                      <td><StatusBadge status={row.status} /></td>
                      <td>{formatNumber(row.count)}</td>
                      <td>{formatNumber(row.for_orders)}</td>
                      <td><strong>{formatMoney(row.total_toman)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'rep-tickets' && (
            <div className="card table-wrap">
              <h4 style={{ marginTop: 0 }}>وضعیت تیکت‌های پشتیبانی در بازه</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>وضعیت</th>
                    <th>تعداد تیکت</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.by_status || []).map((row) => (
                    <tr key={row.status}>
                      <td><StatusBadge status={row.status} /></td>
                      <td>{formatNumber(row.count)} تیکت</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(refundTarget)}
        title="تأیید عملیات حساس استرداد وجه"
        description={refundTarget ? `مبلغ پرداخت اصلی: ${formatMoney(refundTarget.amount_toman)} — این عملیات در دفتر استرداد و سابقهٔ ممیزی ثبت می‌شود.` : ''}
        confirmLabel="ثبت قطعی استرداد"
        danger
        busy={busy}
        onCancel={() => setRefundTarget(null)}
        onConfirm={handleRefundConfirm}
      >
        <div className="form-row">
          <label className="form-label">مبلغ استرداد (تومان) <span className="req-star">*</span></label>
          <input type="number" className="input mono" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">شماره مرجع / سند استرداد <span className="req-star">*</span></label>
          <input className="input mono" placeholder="REF-1405-..." value={refundRef} onChange={(e) => setRefundRef(e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">علت استرداد <span className="req-star">*</span></label>
          <input className="input" placeholder="توضیح علت استرداد..." value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
        </div>
      </ConfirmDialog>
    </div>
  );
}
