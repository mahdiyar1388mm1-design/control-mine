import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDateTime, formatNumber, ROLE_LABELS } from '../../../lib/format';
import { formatDotGrouped, formatScaledBigInt } from '../../../lib/lthMath';
import { Icon } from '../../../components/Icon';
import {
  AdminError, AdminLoading, Avatar, Badge, CopyChip, downloadCsv, EmptyHint,
  Modal, Pagination, SectionCard, SourceChips, StatCard, StatusPill, Toast, useAdminData
} from './AdminUi';

const SOURCE_FILTERS = [
  { id: '', label: 'همه' },
  { id: 'shipping', label: 'فرم ارسال' },
  { id: 'orders', label: 'سفارش' },
  { id: 'services', label: 'خدمات' },
  { id: 'tickets', label: 'تیکت' }
];

const ROLES = ['customer', 'operator', 'support', 'warehouse', 'finance', 'admin'];

function lth(atoms) {
  if (atoms === null || atoms === undefined) return '۰';
  try {
    return formatDotGrouped(formatScaledBigInt(BigInt(atoms), 16, { maxDecimals: 2 }));
  } catch {
    return '۰';
  }
}

function maskTail(value) {
  if (!value) return '—';
  return `•••• ${String(value).slice(-4)}`;
}

function InfoRow({ icon, label, children }) {
  return (
    <div className="ac-info-row">
      <span className="ac-info-ico"><Icon name={icon} size={15} /></span>
      <span className="ac-info-label">{label}</span>
      <span className="ac-info-value">{children}</span>
    </div>
  );
}

function PersonDetailModal({ userId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('summary');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/admin/console/people/${userId}`);
      setDetail(res);
      setForm({
        full_name: res.user.full_name,
        username: res.user.username || '',
        email: res.user.email || '',
        role: res.user.role,
        status: res.user.status,
        reason: '',
        current_password: ''
      });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const needsPassword = form && detail && (form.role !== detail.user.role || form.status !== detail.user.status);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg('');
    try {
      const body = {
        full_name: form.full_name,
        username: form.username,
        email: form.email || null
      };
      if (needsPassword) {
        body.role = form.role;
        body.status = form.status;
        body.reason = form.reason;
        body.current_password = form.current_password;
      }
      const res = await apiFetch(`/admin/console/people/${userId}`, { method: 'PATCH', body });
      setDetail((d) => ({ ...d, user: { ...d.user, ...res.user } }));
      setForm((f) => ({ ...f, ...res.user, reason: '', current_password: '' }));
      setMsg('پروفایل کاربر با ثبت سابقهٔ ممیزی به‌روزرسانی شد.');
      onChanged?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const person = detail?.user;
  const dir = detail?.directory;

  return (
    <Modal
      open
      wide
      icon="user"
      onClose={onClose}
      title={loading ? 'پروندهٔ کاربر' : `${person?.full_name}`}
      subtitle={loading ? '' : `@${person?.username || 'بدون نام کاربری'} — همهٔ اطلاعات و فرم‌های تکمیل‌شده`}
    >
      {loading && <AdminLoading label="در حال بازخوانی پروندهٔ کامل کاربر..." />}
      {!loading && !detail && <AdminError error={error} onRetry={load} />}
      {!loading && detail && (
        <div className="ac-person-detail">
          <Toast kind={error ? 'error' : 'ok'} onClose={() => { setError(null); setMsg(''); }}>{error ? error.message : msg}</Toast>

          <div className="ac-person-hero">
            <Avatar name={person.full_name} size={64} />
            <div className="ac-person-hero-main">
              <div className="ac-person-name">
                <h3>{person.full_name}</h3>
                <Badge tone="pink">@{person.username || '—'}</Badge>
                <StatusPill status={person.status} />
                <Badge tone="neutral">{ROLE_LABELS[person.role] || person.role}</Badge>
              </div>
              <div className="ac-person-contacts">
                <CopyChip value={person.phone} label="موبایل" />
                {person.email && <span className="ac-contact-pill"><Icon name="mail" size={13} /> {person.email}</span>}
                <span className="ac-contact-pill"><Icon name="clock" size={13} /> عضویت {formatDateTime(person.created_at)}</span>
              </div>
            </div>
            <div className="ac-person-spend">
              <span>مجموع خرید موفق</span>
              <strong>{Number(detail.summary.spent_toman || 0).toLocaleString('fa-IR')} <small>تومان</small></strong>
            </div>
          </div>

          <div className="ac-source-strip">
            <div className={`ac-source-tile ${dir?.has_shipping ? 'is-on' : ''}`}><Icon name="truck" size={18} /><span>فرم ارسال</span><b>{formatNumber(detail.addresses.length)}</b></div>
            <div className={`ac-source-tile ${dir?.has_orders ? 'is-on' : ''}`}><Icon name="bag" size={18} /><span>سفارش کالا</span><b>{formatNumber(detail.orders.length)}</b></div>
            <div className={`ac-source-tile ${dir?.has_services ? 'is-on' : ''}`}><Icon name="tools" size={18} /><span>درخواست خدمت</span><b>{formatNumber(detail.services.length)}</b></div>
            <div className={`ac-source-tile ${dir?.has_tickets ? 'is-on' : ''}`}><Icon name="headset" size={18} /><span>تیکت پشتیبانی</span><b>{formatNumber(detail.tickets.length)}</b></div>
          </div>

          <div className="ac-subtabs">
            {[
              { id: 'summary', label: 'خلاصه و ویرایش', icon: 'edit' },
              { id: 'forms', label: 'فرم‌های تکمیل‌شده', icon: 'folder', count: detail.addresses.length + detail.services.length },
              { id: 'finance', label: 'مالی و LTH', icon: 'creditCard' },
              { id: 'timeline', label: 'تایم‌لاین فعالیت', icon: 'clock' }
            ].map((t) => (
              <button key={t.id} type="button" className={`ac-subtab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={14} color="currentColor" /> {t.label}{t.count ? <b>{formatNumber(t.count)}</b> : null}
              </button>
            ))}
          </div>

          {tab === 'summary' && (
            <div className="ac-detail-grid">
              <form className="ac-form ac-detail-card" onSubmit={save}>
                <h4><Icon name="edit" size={15} /> ویرایش پروفایل</h4>
                <div className="ac-form-grid">
                  <label className="ac-field"><span>نام و نام خانوادگی</span>
                    <input className="ac-input" required minLength={3} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                  </label>
                  <label className="ac-field"><span>نام کاربری</span>
                    <input className="ac-input" dir="ltr" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                  </label>
                  <label className="ac-field ac-span-2"><span>ایمیل</span>
                    <input className="ac-input" dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </label>
                  <label className="ac-field"><span>نقش سازمانی</span>
                    <select className="ac-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                    </select>
                  </label>
                  <label className="ac-field"><span>وضعیت حساب</span>
                    <select className="ac-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      <option value="active">فعال</option>
                      <option value="suspended">تعلیق‌شده</option>
                    </select>
                  </label>
                  {needsPassword && (
                    <>
                      <label className="ac-field ac-span-2"><span>علت تغییر نقش/وضعیت <b className="ac-req">*</b></span>
                        <input className="ac-input" required minLength={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="مثلاً ارتقا به کارشناس پشتیبانی" />
                      </label>
                      <label className="ac-field ac-span-2"><span>رمز عبور مدیر برای تأیید <b className="ac-req">*</b></span>
                        <input className="ac-input" required type="password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} placeholder="تأیید هویت مدیر" />
                      </label>
                    </>
                  )}
                </div>
                <button type="submit" className="ac-btn ac-btn-primary" disabled={busy}>{busy ? 'در حال ذخیره...' : 'ذخیرهٔ تغییرات'}</button>
              </form>

              <div className="ac-detail-card">
                <h4><Icon name="bulb" size={15} /> شناسنامه و خلاصهٔ فعالیت</h4>
                <div className="ac-info-list">
                  <InfoRow icon="phone" label="شماره موبایل"><CopyChip value={person.phone} /></InfoRow>
                  <InfoRow icon="hash" label="نام کاربری"><span className="mono" dir="ltr">@{person.username || '—'}</span></InfoRow>
                  <InfoRow icon="mail" label="ایمیل">{person.email || 'ثبت نشده'}</InfoRow>
                  <InfoRow icon="shield" label="نقش">{ROLE_LABELS[person.role] || person.role}</InfoRow>
                  <InfoRow icon="clock" label="عضویت">{formatDateTime(person.created_at)}</InfoRow>
                  <InfoRow icon="folder" label="آخرین فرم">{dir?.last_source_label || '—'}</InfoRow>
                  <InfoRow icon="refresh" label="آخرین فعالیت">{formatDateTime(dir?.last_seen_at)}</InfoRow>
                </div>
                <div className="ac-note">
                  <Icon name="bulb" size={14} />
                  <span>هر بار این کاربر در هر بخش سایت فرمی تکمیل کند (نشانی، سفارش، خدمت یا تیکت)، به‌صورت خودکار در همین پرونده ثبت می‌شود.</span>
                </div>
              </div>
            </div>
          )}

          {tab === 'forms' && (
            <div className="ac-detail-sections">
              <section className="ac-detail-card">
                <h4><Icon name="truck" size={15} /> فرم‌های نشانی و ارسال <Badge tone="pink">{formatNumber(detail.addresses.length)}</Badge></h4>
                {detail.addresses.length === 0 ? <EmptyHint icon="mapPin" title="نشانی ثبت نشده" /> : (
                  <div className="ac-address-grid">
                    {detail.addresses.map((a) => (
                      <div className="ac-address-card" key={a.id}>
                        <div className="ac-address-head">
                          <strong>{a.title}</strong>
                          {a.is_default ? <Badge tone="pink">پیش‌فرض</Badge> : null}
                          {a.auto_fill ? <Badge tone="ok">تکمیل خودکار</Badge> : null}
                        </div>
                        <p>{a.province} — {a.city}</p>
                        <p className="ac-address-line">{a.address_line}</p>
                        <div className="ac-address-meta">
                          <span><Icon name="hash" size={12} /> کد پستی {a.postal_code}</span>
                          <span><Icon name="user" size={12} /> {a.recipient_name}</span>
                          <span dir="ltr">{a.recipient_phone}</span>
                          {a.recipient_email && <span><Icon name="mail" size={12} /> {a.recipient_email}</span>}
                        </div>
                        {(a.refund_card_number || a.refund_sheba) && (
                          <div className="ac-address-fin">
                            {a.refund_card_number && <span>کارت: <b dir="ltr">{maskTail(a.refund_card_number)}</b></span>}
                            {a.refund_sheba && <span>شبا: <b dir="ltr">{maskTail(a.refund_sheba)}</b></span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="ac-detail-card">
                <h4><Icon name="tools" size={15} /> درخواست‌های خدمت <Badge tone="pink">{formatNumber(detail.services.length)}</Badge></h4>
                {detail.services.length === 0 ? <EmptyHint icon="tools" title="درخواست خدمتی ثبت نشده" /> : (
                  <div className="ac-mini-list">
                    {detail.services.map((s) => (
                      <div className="ac-mini-row" key={s.id}>
                        <div><strong>{s.service_name || 'خدمت'}</strong><small className="mono">{s.code}</small></div>
                        <StatusPill status={s.status} />
                        <span>{formatDateTime(s.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="ac-detail-card">
                <h4><Icon name="headset" size={15} /> تیکت‌های پشتیبانی <Badge tone="pink">{formatNumber(detail.tickets.length)}</Badge></h4>
                {detail.tickets.length === 0 ? <EmptyHint icon="headset" title="تیکتی ثبت نشده" /> : (
                  <div className="ac-mini-list">
                    {detail.tickets.map((t) => (
                      <div className="ac-mini-row" key={t.id}>
                        <div><strong>{t.subject}</strong><small className="mono">{t.code}</small></div>
                        <StatusPill status={t.status} />
                        <span>{formatDateTime(t.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'finance' && (
            <div className="ac-detail-sections">
              <section className="ac-detail-card">
                <h4><Icon name="bag" size={15} /> سفارش‌های کالا <Badge tone="pink">{formatNumber(detail.orders.length)}</Badge></h4>
                {detail.orders.length === 0 ? <EmptyHint icon="bag" title="سفارشی ثبت نشده" /> : (
                  <div className="ac-mini-list">
                    {detail.orders.map((o) => (
                      <div className="ac-mini-row" key={o.id}>
                        <div><strong className="mono">{o.code}</strong><small>{formatNumber(o.item_count)} قلم • {formatDateTime(o.created_at)}</small></div>
                        <StatusPill status={o.status} />
                        <span>{Number(o.total_toman).toLocaleString('fa-IR')} تومان</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="ac-detail-card">
                <h4><Icon name="wallet" size={15} /> دارایی LTH</h4>
                {!detail.lth.wallet && detail.lth.holdings.length === 0 ? <EmptyHint icon="wallet" title="کیف پولی فعال نیست" /> : (
                  <>
                    {detail.lth.wallet && (
                      <div className="ac-lth-mini">
                        <div><span>پایه</span><strong dir="ltr">{lth(detail.lth.wallet.base_lth)}</strong></div>
                        <div><span>استیک‌شده</span><strong dir="ltr">{lth(detail.lth.wallet.staked_lth)}</strong></div>
                        <div><span>قابل برداشت</span><strong dir="ltr">{lth(detail.lth.wallet.withdrawable_lth)}</strong></div>
                        <div><span>کل خرید</span><strong dir="ltr">{lth(detail.lth.wallet.total_purchased_lth)}</strong></div>
                      </div>
                    )}
                    {detail.lth.holdings.map((h) => (
                      <div className="ac-mini-row" key={h.id}>
                        <div><strong className="mono">{h.contract_code}</strong><small>خرید {formatDateTime(h.purchased_at)}</small></div>
                        <StatusPill status={h.status} />
                        <span>پایه {lth(h.active_base_atoms)} LTH</span>
                      </div>
                    ))}
                  </>
                )}
              </section>

              <section className="ac-detail-card">
                <h4><Icon name="creditCard" size={15} /> پرداخت‌ها <Badge tone="pink">{formatNumber(detail.payments.length)}</Badge></h4>
                {detail.payments.length === 0 ? <EmptyHint icon="creditCard" title="پرداختی ثبت نشده" /> : (
                  <div className="ac-mini-list">
                    {detail.payments.map((p) => (
                      <div className="ac-mini-row" key={p.id}>
                        <div><strong>{Number(p.amount_toman).toLocaleString('fa-IR')} تومان</strong><small>{p.order_code ? `سفارش ${p.order_code}` : p.gateway}</small></div>
                        <StatusPill status={p.status} />
                        <span>{formatDateTime(p.paid_at || p.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'timeline' && (
            <section className="ac-detail-card">
              <h4><Icon name="clock" size={15} /> همهٔ رویدادهای این کاربر</h4>
              <div className="ac-timeline">
                {detail.timeline.map((item, index) => (
                  <div className={`ac-timeline-item ac-tl-${item.kind}`} key={`${item.kind}-${index}`}>
                    <span className="ac-tl-dot"><Icon name={item.kind === 'order' ? 'bag' : item.kind === 'shipping_form' ? 'truck' : item.kind === 'service_form' ? 'tools' : item.kind === 'support_ticket' ? 'headset' : 'user'} size={13} /></span>
                    <div className="ac-tl-body">
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </div>
                    <time>{formatDateTime(item.at)}</time>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

export function PeoplePanel() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '20');
    p.set('page', String(page));
    if (query) p.set('q', query);
    if (role) p.set('role', role);
    if (source) p.set('source', source);
    return `/admin/console/people?${p.toString()}`;
  }, [query, role, source, page]);

  const { data, loading, error, reload, refreshing } = useAdminData(path);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  const exportCsv = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (role) params.set('role', role);
      if (source) params.set('source', source);
      await downloadCsv(`/admin/console/people.csv?${params.toString()}`, 'central-mine-people.csv');
      setToast('فایل CSV کاربران دانلود شد.');
    } catch (err) {
      setToast(err.message || 'دانلود ناموفق بود.');
    } finally {
      setDownloading(false);
    }
  };

  if (loading && !data) return <AdminLoading label="در حال ساخت دفتر کاربران..." />;
  if (error && !data) return <AdminError error={error} onRetry={reload} />;

  const items = data?.items || [];
  const summary = data?.summary || {};

  return (
    <div className="ac-panel">
      <Toast onClose={() => setToast('')}>{toast}</Toast>

      <div className="ac-panel-head">
        <div>
          <h2>کاربران و دفتر ارتباطات</h2>
          <p>هر شخصی که در هر بخش سایت فرمی پر کرده باشد، با شماره موبایل، نام کاربری و سابقهٔ کامل اینجاست.</p>
        </div>
        <button type="button" className="ac-btn ac-btn-soft" onClick={exportCsv} disabled={downloading}>
          <Icon name="folder" size={16} /> {downloading ? 'در حال آماده‌سازی...' : 'خروجی CSV'}
        </button>
      </div>

      <div className="ac-stats ac-stats-4">
        <StatCard icon="users" label="کل افراد ثبت‌شده" value={formatNumber(summary.total ?? data?.total ?? 0)} sub="شامل کارکنان و مشتریان" />
        <StatCard icon="folder" label="فرم‌های تکمیل‌شده" value={formatNumber(summary.filled_forms ?? 0)} sub="حداقل یک فرم در سایت" tone="rose" />
        <StatCard icon="truck" label="فرم ارسال و نشانی" value={formatNumber(summary.with_shipping ?? 0)} sub="آدرس ثبت‌شده" tone="plum" />
        <StatCard icon="bag" label="دارای سفارش" value={formatNumber(summary.with_orders ?? 0)} sub={`${formatNumber(summary.with_services ?? 0)} نفر خدمات، ${formatNumber(summary.with_tickets ?? 0)} نفر تیکت`} tone="amber" />
      </div>

      <SectionCard
        title="دفتر کاربران"
        subtitle="شماره‌ها کامل نمایش داده می‌شوند؛ برای کپی روی شماره بزنید."
        icon="users"
        action={(
          <div className="ac-toolbar">
            <div className="ac-search">
              <Icon name="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، نام کاربری یا شماره موبایل..." />
              {q && <button type="button" className="ac-search-clear" onClick={() => setQ('')} aria-label="پاک کردن"><Icon name="x" size={13} /></button>}
            </div>
            <select className="ac-select ac-select-sm" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
              <option value="">همهٔ نقش‌ها</option>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
            </select>
            <button type="button" className="ac-icon-btn" title="بروزرسانی" onClick={reload}>
              <Icon name="refresh" size={16} className={refreshing ? 'ac-spin' : ''} />
            </button>
          </div>
        )}
      >
        <div className="ac-filter-chips">
          {SOURCE_FILTERS.map((f) => (
            <button key={f.id} type="button" className={`ac-filter-chip ${source === f.id ? 'active' : ''}`} onClick={() => { setSource(f.id); setPage(1); }}>
              {f.label}
              {f.id === 'shipping' && <b>{formatNumber(summary.with_shipping ?? 0)}</b>}
              {f.id === 'orders' && <b>{formatNumber(summary.with_orders ?? 0)}</b>}
              {f.id === 'services' && <b>{formatNumber(summary.with_services ?? 0)}</b>}
              {f.id === 'tickets' && <b>{formatNumber(summary.with_tickets ?? 0)}</b>}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <EmptyHint icon="users" title="کاربری با این مشخصات پیدا نشد" description="عبارت جست‌وجو یا فیلترها را تغییر دهید." />
        ) : (
          <div className="ac-people-list">
            {items.map((person, index) => (
              <article className="ac-person-card" key={person.id}>
                <div className="ac-person-id">
                  <Avatar name={person.full_name} size={46} tone={index} />
                  <div className="ac-person-idtext">
                    <div className="ac-person-line">
                      <strong>{person.full_name}</strong>
                      {person.status === 'suspended' && <Badge tone="danger">تعلیق</Badge>}
                      {person.role !== 'customer' && <Badge tone="plum">{ROLE_LABELS[person.role] || person.role}</Badge>}
                    </div>
                  </div>
                </div>

                <div className="ac-person-contact">
                  <CopyChip value={person.phone} label="موبایل" />
                  <span className="ac-username" dir="ltr">@{person.username || '—'}</span>
                  {person.email && <span className="ac-person-email" dir="ltr">{person.email}</span>}
                </div>

                <SourceChips person={person} />

                <div className="ac-person-stats">
                  <span><b>{formatNumber(person.order_count)}</b> سفارش</span>
                  <span><b>{Number(person.spent_toman || 0).toLocaleString('fa-IR')}</b> تومان خرید</span>
                  <span><b>{formatNumber(person.service_count)}</b> خدمت</span>
                </div>

                <div className="ac-person-action">
                  <span className="ac-last-seen">آخرین فعالیت<br /><b>{formatDateTime(person.last_seen_at)}</b></span>
                  <button type="button" className="ac-btn ac-btn-soft ac-btn-sm" onClick={() => setSelected(person.id)}>
                    پروندهٔ کامل <Icon name="user" size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        <Pagination page={data?.page || 1} limit={data?.limit || 20} total={data?.total || 0} onChange={setPage} />
      </SectionCard>

      {selected && (
        <PersonDetailModal
          userId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setToast('پروندهٔ کاربر به‌روزرسانی شد.');
            reload();
          }}
        />
      )}
    </div>
  );
}
