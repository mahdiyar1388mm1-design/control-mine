import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, downloadPrivateFile } from '../lib/api';
import { formatBytes, formatDateTime, PRIORITY_LABELS, ROLE_LABELS, TICKET_CATEGORY_LABELS } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { EmptyState, ErrorState, FieldErrorsList, LoadingState, StatusBadge } from '../components/StateViews';

export function TicketsListPage() {
  const { user, authLoading } = useAuth();
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'general', priority: 'normal', body: '' });
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  const loadTickets = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/tickets');
      setData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) loadTickets();
  }, [authLoading, loadTickets]);

  if (authLoading || loading) return <LoadingState label="در حال بارگذاری تیکت‌های پشتیبانی..." />;
  if (!user) return <EmptyState title="برای ثبت و مشاهدهٔ تیکت پشتیبانی وارد شوید" actionLabel="ورود به حساب" actionTo="/auth?next=/tickets" />;
  if (error) return <ErrorState error={error} onRetry={loadTickets} />;

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const fd = new FormData();
      fd.append('subject', form.subject);
      fd.append('category', form.category);
      fd.append('priority', form.priority);
      fd.append('body', form.body);
      files.forEach((f) => fd.append('files', f));
      await apiFetch('/tickets', { method: 'POST', body: fd });
      setForm({ subject: '', category: 'general', priority: 'normal', body: '' });
      setFiles([]);
      setShowNew(false);
      await loadTickets();
    } catch (err) {
      setSubmitErr(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">پشتیبانی و پیگیری سؤالات</h1>
          <p className="page-subtitle">برای پیگیری سفارش‌ها، پرداخت و پرسش‌های حساب کاربری تیکت ثبت کنید.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'بستن فرم تیکت' : '+ ثبت تیکت جدید'}
        </button>
      </div>

      {showNew && (
        <form onSubmit={handleCreate} className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>ثبت تیکت پشتیبانی جدید</h2>
          {submitErr && (
            <>
              <div className="alert-inline error">⚠️ {submitErr.message}</div>
              <FieldErrorsList details={submitErr.details} />
            </>
          )}
          <div className="grid grid-3">
            <div className="form-row">
              <label className="form-label">موضوع تیکت <span className="req-star">*</span></label>
              <input className="input" required minLength={3} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="مثلاً هماهنگی زمان تحویل بسته" />
            </div>
            <div className="form-row">
              <label className="form-label">دسته‌بندی</label>
              <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(TICKET_CATEGORY_LABELS).filter(([key]) => key !== 'services').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">اولویت</label>
              <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">متن پیام <span className="req-star">*</span></label>
            <textarea className="textarea" required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="شرح سؤال یا مشکل را همراه کد سفارش/پرونده بنویسید..." />
          </div>
          <div className="form-row">
            <label className="form-label">پیوست (حداکثر ۳ فایل مجاز)</label>
            <input type="file" multiple className="input" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 3))} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '⏳ در حال ارسال به پشتیبانی...' : 'ثبت تیکت'}
          </button>
        </form>
      )}

      {data.items.length === 0 ? (
        <EmptyState title="تیکتی ثبت نکرده‌اید" description="برای طرح سؤال یا پیگیری مشکل، دکمهٔ «ثبت تیکت جدید» را بزنید." />
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>شماره پیگیری</th>
                <th>موضوع</th>
                <th>دسته</th>
                <th>اولویت</th>
                <th>وضعیت</th>
                <th>آخرین بروزرسانی</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.code}>
                  <td><strong className="mono">{t.code}</strong></td>
                  <td>{t.subject}</td>
                  <td>{TICKET_CATEGORY_LABELS[t.category] || t.category}</td>
                  <td>{PRIORITY_LABELS[t.priority] || t.priority}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{formatDateTime(t.created_at)}</td>
                  <td>
                    <Link to={`/tickets/${t.code}`} className="btn btn-secondary btn-sm">مشاهده و پاسخ</Link>
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

export function TicketDetailPage() {
  const { code } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState(null);

  const loadTicket = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/tickets/${encodeURIComponent(code)}`);
      setTicket(res.ticket);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  const handleReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setSendErr(null);
    try {
      const res = await apiFetch(`/tickets/${encodeURIComponent(code)}/messages`, {
        method: 'POST',
        body: { body: reply.trim() }
      });
      setTicket(res.ticket);
      setReply('');
    } catch (err) {
      // Never mark failed message as sent (§9)
      setSendErr(err);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <LoadingState label="در حال بارگذاری تیکت..." />;
  if (error) return <ErrorState error={error} onRetry={loadTicket} />;
  if (!ticket) return null;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/tickets" className="muted">← بازگشت به فهرست تیکت‌ها</Link>
      </div>

      <div className="card">
        <div className="flex-between">
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem' }}>
              <span className="mono">{ticket.code}</span> — {ticket.subject}
            </h1>
            <div className="muted" style={{ fontSize: '0.84rem', marginTop: 4 }}>
              دسته: {TICKET_CATEGORY_LABELS[ticket.category] || ticket.category} • اولویت: {PRIORITY_LABELS[ticket.priority] || ticket.priority}
            </div>
          </div>
          <StatusBadge status={ticket.status} />
        </div>
      </div>

      {(ticket.files || []).length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>پیوست‌های خصوصی تیکت</h2>
          {ticket.files.map((f) => (
            <div key={f.id} className="flex-between" style={{ padding: '6px 0' }}>
              <span>📎 {f.original_name} ({formatBytes(f.size_bytes)})</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadPrivateFile(f.id, f.original_name)}>
                ⬇ دانلود امن
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>گفتگوها</h2>
        {(ticket.messages || []).map((m) => (
          <div key={m.id} className={`msg-item ${m.author_role !== 'customer' ? 'operator' : ''}`}>
            <div className="msg-header">
              <strong>{m.author_name || ROLE_LABELS[m.author_role]} ({ROLE_LABELS[m.author_role] || m.author_role})</strong>
              <span>{formatDateTime(m.created_at)}</span>
            </div>
            <div style={{ whiteSpace: 'pre-line' }}>{m.body}</div>
          </div>
        ))}

        {ticket.status === 'closed' ? (
          <div className="alert-inline warn">🔒 این تیکت بسته شده است و امکان ارسال پیام جدید وجود ندارد.</div>
        ) : (
          <form onSubmit={handleReply} style={{ marginTop: 14 }}>
            {sendErr && <div className="alert-inline error" role="alert">⚠️ ارسال ناموفق بود: {sendErr.message}</div>}
            <label className="form-label" htmlFor="tk-reply">پاسخ جدید</label>
            <textarea
              id="tk-reply"
              className="textarea"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="پاسخ خود را بنویسید..."
            />
            <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={sending || !reply.trim()}>
              {sending ? '⏳ در حال ارسال...' : 'ارسال پاسخ'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
