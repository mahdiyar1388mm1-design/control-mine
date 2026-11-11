import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, downloadPrivateFile } from '../../lib/api';
import { formatBytes, formatDateTime, formatMoney, formatNumber, PRIORITY_LABELS, ROLE_LABELS } from '../../lib/format';
import { EmptyState, ErrorState, FieldErrorsList, LoadingState, StatusBadge } from '../../components/StateViews';

export function OperatorServicesPanel() {
  const [queue, setQueue] = useState({ items: [], total: 0 });
  const [operators, setOperators] = useState([]);
  const [filters, setFilters] = useState({ status: '', priority: '', sla: '', mine: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opMsg, setOpMsg] = useState('');
  const [opErr, setOpErr] = useState(null);

  // Workbench forms
  const [assigneeId, setAssigneeId] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [resultSummary, setResultSummary] = useState('');
  const [teamQueue, setTeamQueue] = useState('');
  const [teamReason, setTeamReason] = useState('');
  const [msgText, setMsgText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [uploadKind, setUploadKind] = useState('result_file');
  const [uploadFiles, setUploadFiles] = useState([]);

  useEffect(() => {
    apiFetch('/staff/directory?role=operator')
      .then((res) => setOperators(res.items || []))
      .catch(() => {});
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
      const res = await apiFetch(`/staff/service-requests?${qs.toString()}`);
      setQueue(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const loadDetail = useCallback(async (id) => {
    if (!id) return;
    setSelectedId(id);
    setDetailLoading(true);
    setOpErr(null);
    setOpMsg('');
    try {
      const res = await apiFetch(`/staff/service-requests/${encodeURIComponent(id)}`);
      setDetail(res.request);
      setResultSummary(res.request.result_summary || '');
      setTeamQueue(res.request.assigned_team || '');
    } catch (err) {
      setOpErr(err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleAssign = async (e) => {
    e.preventDefault();
    if (!detail) return;
    setBusy(true);
    setOpErr(null);
    setOpMsg('');
    try {
      const res = await apiFetch(`/staff/service-requests/${detail.id}/assign`, {
        method: 'POST',
        body: { assignee_id: assigneeId || undefined, reason: 'تخصیص از پنل اپراتور' }
      });
      setDetail(res.request);
      setOpMsg('تخصیص پرونده در سرور ثبت شد.');
      await loadQueue();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (e) => {
    e.preventDefault();
    if (!detail || !nextStatus) return;
    setBusy(true);
    setOpErr(null);
    setOpMsg('');
    try {
      const res = await apiFetch(`/staff/service-requests/${detail.id}/status`, {
        method: 'POST',
        body: {
          to_status: nextStatus,
          reason: statusReason.trim(),
          result_summary: resultSummary.trim()
        }
      });
      setDetail(res.request);
      setStatusReason('');
      setNextStatus('');
      setOpMsg('وضعیت پرونده با موفقیت تغییر کرد.');
      await loadQueue();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleTransferTeam = async (e) => {
    e.preventDefault();
    if (!detail) return;
    setBusy(true);
    setOpErr(null);
    setOpMsg('');
    try {
      const res = await apiFetch(`/staff/service-requests/${detail.id}/team`, {
        method: 'POST',
        body: { team_queue: teamQueue.trim(), reason: teamReason.trim() }
      });
      setDetail(res.request);
      setTeamReason('');
      setOpMsg('پرونده به صف جدید ارجاع داده شد.');
      await loadQueue();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSendMsg = async (e) => {
    e.preventDefault();
    if (!detail || !msgText.trim()) return;
    setBusy(true);
    setOpErr(null);
    setOpMsg('');
    try {
      const res = await apiFetch(`/staff/service-requests/${detail.id}/messages`, {
        method: 'POST',
        body: { body: msgText.trim(), internal: isInternalNote }
      });
      setDetail(res.request);
      setMsgText('');
      setOpMsg(isInternalNote ? 'یادداشت داخلی محرمانه ثبت شد (برای مشتری ارسال نمی‌شود).' : 'پیام عمومی برای مشتری ثبت شد.');
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!detail || !uploadFiles.length) return;
    setBusy(true);
    setOpErr(null);
    setOpMsg('');
    try {
      const fd = new FormData();
      fd.append('kind', uploadKind);
      uploadFiles.forEach((f) => fd.append('files', f));
      const res = await apiFetch(`/staff/service-requests/${detail.id}/files`, {
        method: 'POST',
        body: fd
      });
      setDetail(res.request);
      setUploadFiles([]);
      setOpMsg('فایل در پرونده ثبت شد.');
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="grid grid-4" style={{ alignItems: 'end' }}>
          <div>
            <label className="form-label">وضعیت پرونده</label>
            <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">همهٔ پرونده‌های باز (فعال)</option>
              <option value="submitted">ثبت‌شده (منتظر پرداخت)</option>
              <option value="queued">در صف بررسی</option>
              <option value="assigned">تخصیص‌یافته</option>
              <option value="in_progress">در حال انجام</option>
              <option value="waiting_customer">منتظر مشتری</option>
              <option value="completed">تکمیل‌شده</option>
              <option value="failed">ناموفق</option>
              <option value="rejected">ردشده</option>
            </select>
          </div>
          <div>
            <label className="form-label">وضعیت SLA</label>
            <select className="select" value={filters.sla} onChange={(e) => setFilters({ ...filters, sla: e.target.value })}>
              <option value="">همه</option>
              <option value="breached">⚠️ نقض‌شده (گذشته از سررسید)</option>
              <option value="at_risk">⏳ در معرض خطر (کمتر از ۲۴ ساعت)</option>
            </select>
          </div>
          <div>
            <label className="form-label">اولویت / تخصیص</label>
            <div className="flex-gap">
              <select className="select" style={{ flex: 1 }} value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
                <option value="">همهٔ اولویت‌ها</option>
                <option value="urgent">فوری</option>
                <option value="high">بالا</option>
                <option value="normal">عادی</option>
                <option value="low">کم</option>
              </select>
              <label className="flex-gap" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={filters.mine === '1'}
                  onChange={(e) => setFilters({ ...filters, mine: e.target.checked ? '1' : '' })}
                />
                فقط پرونده‌های من
              </label>
            </div>
          </div>
          <div>
            <label className="form-label">جست‌وجوی کد یا نام مشتری</label>
            <input className="input" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="مثلاً SR-..." />
          </div>
        </div>
      </div>

      {loading && <LoadingState label="در حال بارگذاری صف درخواست‌های خدمات..." />}
      {!loading && error && <ErrorState error={error} onRetry={loadQueue} />}

      {!loading && !error && (
        <div className="two-col-layout">
          <div className="card table-wrap">
            <h3 style={{ marginTop: 0, fontSize: '1.04rem' }}>صف پرونده‌ها ({formatNumber(queue.total)} مورد)</h3>
            {queue.items.length === 0 ? (
              <EmptyState title="پرونده‌ای با این فیلتر در صف وجود ندارد" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>کد</th>
                    <th>خدمت / مشتری</th>
                    <th>وضعیت</th>
                    <th>SLA</th>
                    <th>مسئول</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((r) => (
                    <tr key={r.id} style={{ background: selectedId === r.id ? 'var(--primary-soft)' : undefined }}>
                      <td>
                        <strong className="mono">{r.code}</strong>
                        <div className="muted" style={{ fontSize: '0.75rem' }}>اولویت: {PRIORITY_LABELS[r.priority]}</div>
                      </td>
                      <td>
                        <strong>{r.service_name}</strong>
                        <div className="muted" style={{ fontSize: '0.8rem' }}>{r.customer_name}</div>
                      </td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>
                        <div style={{ fontSize: '0.8rem' }}>{formatDateTime(r.due_at)}</div>
                        {r.sla_breached && <span className="badge badge-danger">⚠️ نقض SLA</span>}
                        {!r.sla_breached && r.sla_at_risk && <span className="badge badge-warn">⏳ نزدیک سررسید</span>}
                      </td>
                      <td>{r.assignee_name || <span className="muted">بدون مسئول</span>}</td>
                      <td>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => loadDetail(r.id)}>
                          مدیریت پرونده
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            {detailLoading && <LoadingState label="در حال بارگذاری جزئیات پرونده..." />}
            {!detailLoading && !detail && (
              <div className="card muted">یک پرونده را از جدول سمت راست انتخاب کنید تا ابزارهای عملیاتی باز شوند.</div>
            )}
            {!detailLoading && detail && (
              <div className="card">
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: '1.08rem' }}>
                    میزکار پرونده <span className="mono">{detail.code}</span>
                  </h3>
                  <StatusBadge status={detail.status} />
                </div>

                {opMsg && <div className="alert-inline ok">✓ {opMsg}</div>}
                {opErr && (
                  <>
                    <div className="alert-inline error">⚠️ {opErr.message}</div>
                    <FieldErrorsList details={opErr.details} />
                  </>
                )}

                <div style={{ background: 'var(--surface-alt)', padding: 12, borderRadius: 8, fontSize: '0.86rem', marginBottom: 14 }}>
                  <div><strong>خدمت:</strong> {detail.service?.name} (نسخهٔ فرم {formatNumber(detail.form_version)})</div>
                  <div><strong>هزینه:</strong> {formatMoney(detail.price_toman, { freeLabel: true })} — پرداخت: {detail.payment?.status || 'ندارد'}</div>
                  <div><strong>صف فعلی:</strong> {detail.assigned_team} — مسئول: {detail.assigned_to?.full_name || 'تخصیص‌نیافته'}</div>
                  <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                  <strong>داده‌های فرم مشتری:</strong>
                  {Object.entries(detail.form_data || {}).map(([k, v]) => (
                    <div key={k}>{k}: <strong>{String(v)}</strong></div>
                  ))}
                </div>

                {/* 1. Assignment */}
                {['queued', 'assigned'].includes(detail.status) && (
                  <form onSubmit={handleAssign} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                    <label className="form-label">۱. تخصیص کارشناس مسئول</label>
                    <div className="flex-gap">
                      <select className="select" style={{ flex: 1 }} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                        <option value="">تخصیص به خودم</option>
                        {operators.map((op) => (
                          <option key={op.id} value={op.id}>{op.full_name} ({ROLE_LABELS[op.role]})</option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>ثبت تخصیص</button>
                    </div>
                  </form>
                )}

                {/* 2. Workflow Status Transition */}
                <form onSubmit={handleStatusChange} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                  <label className="form-label">۲. تغییر وضعیت طبق گردش‌کار مجاز سرور</label>
                  <select className="select" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} style={{ marginBottom: 8 }}>
                    <option value="">انتخاب مرحلهٔ بعد...</option>
                    <option value="queued">ورود به صف (queued)</option>
                    <option value="in_progress">شروع انجام کارشناسی (in_progress)</option>
                    <option value="waiting_customer">نیاز به اطلاعات تکمیلی از مشتری (waiting_customer)</option>
                    <option value="completed">تکمیل پرونده و ثبت نتیجه (completed)</option>
                    <option value="failed">ثبت عدم موفقیت فنی (failed)</option>
                    <option value="rejected">رد پذیرش اولیه (rejected)</option>
                  </select>
                  {nextStatus === 'completed' && (
                    <textarea
                      className="textarea"
                      style={{ marginBottom: 8 }}
                      placeholder="خلاصهٔ نتیجهٔ نهایی کارشناسی (الزامی برای تکمیل، قابل مشاهده توسط مشتری)..."
                      value={resultSummary}
                      onChange={(e) => setResultSummary(e.target.value)}
                    />
                  )}
                  <input
                    className="input"
                    style={{ marginBottom: 8 }}
                    placeholder="علت تغییر وضعیت / توضیح درخواست اطلاعات تکمیلی یا علت تأخیر..."
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !nextStatus}>
                    اعمال تغییر وضعیت
                  </button>
                </form>

                {/* 3. Upload Result or Internal File */}
                <form onSubmit={handleUpload} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                  <label className="form-label">۳. بارگذاری فایل خروجی نتیجه یا مستند داخلی</label>
                  <div className="flex-gap" style={{ marginBottom: 8 }}>
                    <select className="select" style={{ width: 'auto' }} value={uploadKind} onChange={(e) => setUploadKind(e.target.value)}>
                      <option value="result_file">فایل خروجی نتیجه (قابل دانلود برای مشتری)</option>
                      <option value="internal">🔒 مستند داخلی کارشناسی (مخفی از مشتری)</option>
                    </select>
                    <input type="file" multiple className="input" style={{ flex: 1 }} onChange={(e) => setUploadFiles(Array.from(e.target.files || []))} />
                  </div>
                  <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !uploadFiles.length}>
                    ثبت فایل در پرونده
                  </button>
                </form>

                {/* 4. Messages & Internal Notes */}
                <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>۴. پیام‌های پرونده و یادداشت‌های داخلی</h4>
                  {(detail.messages || []).map((m) => (
                    <div key={m.id} className={`msg-item ${m.kind === 'internal_note' ? 'internal' : (m.kind === 'operator' ? 'operator' : '')}`}>
                      <div className="msg-header">
                        <strong>
                          {m.kind === 'internal_note' ? '🔒 یادداشت داخلی محرمانه (عدم نمایش به مشتری)' : `💬 ${m.author_name || m.author_role}`}
                        </strong>
                        <span>{formatDateTime(m.created_at)}</span>
                      </div>
                      <div style={{ fontSize: '0.88rem', whiteSpace: 'pre-line' }}>{m.body}</div>
                    </div>
                  ))}

                  <form onSubmit={handleSendMsg}>
                    <label className="flex-gap" style={{ fontSize: '0.86rem', marginBottom: 6, fontWeight: 700, color: isInternalNote ? 'var(--accent)' : 'var(--primary)' }}>
                      <input type="checkbox" checked={isInternalNote} onChange={(e) => setIsInternalNote(e.target.checked)} />
                      <span>ثبت به‌عنوان «یادداشت داخلی محرمانه» (در API مشتری بازگردانده نمی‌شود)</span>
                    </label>
                    <textarea
                      className="textarea"
                      style={{ minHeight: 70 }}
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      placeholder={isInternalNote ? 'یادداشت فنی مخصوص همکاران...' : 'پیام رسمی به مشتری...'}
                    />
                    <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 6 }} disabled={busy || !msgText.trim()}>
                      {isInternalNote ? '🔒 ثبت یادداشت داخلی' : 'ارسال پیام به مشتری'}
                    </button>
                  </form>
                </div>

                {/* 5. Files list + Team transfer */}
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: '0.9rem' }}>فایل‌های پیوست پرونده:</strong>
                  {(detail.files || []).length === 0 ? (
                    <div className="muted" style={{ fontSize: '0.84rem' }}>فایلی ثبت نشده است.</div>
                  ) : (
                    detail.files.map((f) => (
                      <div key={f.id} className="flex-between" style={{ padding: '4px 0', fontSize: '0.84rem' }}>
                        <span>
                          [{f.kind === 'internal' ? '🔒 داخلی' : (f.kind === 'result_file' ? '✓ خروجی' : 'مشتری')}] {f.original_name} ({formatBytes(f.size_bytes)})
                        </span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadPrivateFile(f.id, f.original_name)}>
                          دانلود
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleTransferTeam}>
                  <label className="form-label">۵. ارجاع پرونده به صف تخصصی دیگر</label>
                  <div className="flex-gap">
                    <input className="input" style={{ width: 130 }} value={teamQueue} onChange={(e) => setTeamQueue(e.target.value)} placeholder="نام صف" />
                    <input className="input" style={{ flex: 1 }} value={teamReason} onChange={(e) => setTeamReason(e.target.value)} placeholder="علت ارجاع..." />
                    <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !teamReason.trim()}>ارجاع</button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
