import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDateTime, ROLE_LABELS } from '../../../lib/format';
import { Icon } from '../../../components/Icon';
import {
  AdminError, AdminLoading, Badge, EmptyHint, Pagination, SectionCard,
  Toast, useAdminData
} from './AdminUi';

export function SettingsPanel() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const load = async () => {
    try {
      const res = await apiFetch('/admin/settings');
      setForm({
        store_name: res.settings.store_name,
        shipping_flat_toman: res.settings.shipping_flat_toman ?? res.settings.flatToman ?? 0,
        shipping_free_over_toman: res.settings.shipping_free_over_toman ?? res.settings.freeOverToman ?? 0,
        reason: ''
      });
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/admin/settings', {
        method: 'PATCH',
        body: {
          store_name: form.store_name,
          shipping_flat_toman: Number(form.shipping_flat_toman),
          shipping_free_over_toman: Number(form.shipping_free_over_toman),
          reason: form.reason.trim()
        }
      });
      setForm((f) => ({ ...f, reason: '' }));
      setToast('تنظیمات فروشگاه و ارسال ذخیره شد.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!form && !error) return <AdminLoading label="در حال دریافت تنظیمات..." />;
  if (!form && error) return <AdminError error={error} onRetry={load} />;

  return (
    <div className="ac-panel">
      <Toast kind={error ? 'error' : 'ok'} onClose={() => { setError(null); setToast(''); }}>{error ? error.message : toast}</Toast>
      <div className="ac-panel-head">
        <div>
          <h2>تنظیمات فروشگاه</h2>
          <p>نام نمایشی، هزینهٔ ارسال و قواعد ارسال رایگان. هر تغییر در سابقهٔ ممیزی ثبت می‌شود.</p>
        </div>
      </div>

      <div className="ac-detail-grid">
        <SectionCard title="هویت فروشگاه" subtitle="این نام در سربرگ و صفحهٔ اصلی نمایش داده می‌شود" icon="settings">
          <form className="ac-form" onSubmit={save}>
            <label className="ac-field"><span>نام نمایشی پلتفرم</span>
              <input className="ac-input" required minLength={2} value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} />
            </label>
            <label className="ac-field"><span>هزینهٔ ثابت ارسال (تومان)</span>
              <input type="number" min="0" className="ac-input" required value={form.shipping_flat_toman} onChange={(e) => setForm({ ...form, shipping_flat_toman: e.target.value })} />
            </label>
            <label className="ac-field"><span>سقف خرید ارسال رایگان (تومان)</span>
              <input type="number" min="0" className="ac-input" required value={form.shipping_free_over_toman} onChange={(e) => setForm({ ...form, shipping_free_over_toman: e.target.value })} />
            </label>
            <label className="ac-field"><span>علت تغییر <b className="ac-req">*</b></span>
              <input className="input ac-input" required minLength={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="مثلاً بازنگری تعرفهٔ ارسال" />
            </label>
            <button type="submit" className="ac-btn ac-btn-primary" disabled={busy}>{busy ? 'در حال ذخیره...' : 'ذخیرهٔ تنظیمات'}</button>
          </form>
        </SectionCard>

        <SectionCard title="یادآوری‌های عملیاتی" subtitle="قواعد فعال روی این سامانه" icon="bulb">
          <div className="ac-info-list">
            <div className="ac-info-row"><span className="ac-info-label">ثبت خودکار کاربران در دفتر</span><Badge tone="ok">فعال</Badge></div>
            <div className="ac-info-row"><span className="ac-info-label">ثبت خودکار درآمد در خزانه</span><Badge tone="ok">فعال</Badge></div>
            <div className="ac-info-row"><span className="ac-info-label">ثبت خودکار استرداد در خزانه</span><Badge tone="ok">فعال</Badge></div>
            <div className="ac-info-row"><span className="ac-info-label">وضعیت نمایش شماره‌ها</span><span>کامل — فقط برای مدیر</span></div>
            <div className="ac-info-row"><span className="ac-info-label">درگاه پرداخت</span><Badge tone="warn">آزمایشی</Badge></div>
            <div className="ac-info-row"><span className="ac-info-label">پیامک OTP</span><Badge tone="warn">آزمایشی</Badge></div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

const ACTION_TONE = (action) => {
  if (String(action).includes('delete') || String(action).includes('suspend')) return 'danger';
  if (String(action).includes('create') || String(action).includes('paid')) return 'ok';
  if (String(action).includes('treasury') || String(action).includes('update')) return 'warn';
  return 'pink';
};

export function AuditPanel() {
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setAction(actionInput.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [actionInput]);

  const path = React.useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '30');
    p.set('page', String(page));
    if (action) p.set('action', action);
    return `/admin/audit?${p.toString()}`;
  }, [action, page]);

  const { data, loading, error, reload, refreshing } = useAdminData(path);

  if (loading && !data) return <AdminLoading label="در حال خواندن سابقهٔ ممیزی..." />;
  if (error && !data) return <AdminError error={error} onRetry={reload} />;

  const items = data?.items || [];

  return (
    <div className="ac-panel">
      <div className="ac-panel-head">
        <div>
          <h2>سابقهٔ ممیزی</h2>
          <p>دفتر فقط‌افزودنی همهٔ عملیات حساس سامانه — تغییرناپذیر و قابل پیگیری.</p>
        </div>
        <button type="button" className="ac-btn ac-btn-soft" onClick={reload}>
          <Icon name="refresh" size={16} className={refreshing ? 'ac-spin' : ''} /> بروزرسانی
        </button>
      </div>

      <SectionCard
        title="رویدادهای اخیر"
        subtitle="جدیدترین عملیات مدیران و کارکنان"
        icon="shield"
        action={(
          <div className="ac-toolbar">
            <div className="ac-search">
              <Icon name="search" size={16} />
              <input value={actionInput} onChange={(e) => setActionInput(e.target.value)} placeholder="فیلتر عملیات مانند admin.update_person" />
            </div>
          </div>
        )}
      >
        {items.length === 0 ? (
          <EmptyHint icon="shield" title="رویدادی یافت نشد" />
        ) : (
          <div className="ac-audit-list">
            {items.map((row) => (
              <div className="ac-audit-row" key={row.id}>
                <span className={`ac-audit-icon ac-tone-${ACTION_TONE(row.action)}`}><Icon name="shield" size={15} /></span>
                <div className="ac-audit-main">
                  <div className="ac-audit-title">
                    <strong>{row.actor_name || 'سامانه'}</strong>
                    <Badge tone="neutral">{ROLE_LABELS[row.actor_role] || row.actor_role || 'سامانه'}</Badge>
                    <span className="mono ac-audit-action">{row.action}</span>
                  </div>
                  <div className="ac-audit-detail">
                    <span>موجودیت: {row.entity_type}{row.entity_id ? ` (${String(row.entity_id).slice(0, 8)}…)` : ''}</span>
                    {row.detail && Object.keys(row.detail).length > 0 && (
                      <code dir="ltr">{JSON.stringify(row.detail)}</code>
                    )}
                  </div>
                </div>
                <time>{formatDateTime(row.created_at)}</time>
              </div>
            ))}
          </div>
        )}
        <Pagination page={data?.page || 1} limit={data?.limit || 30} total={data?.total || 0} onChange={setPage} />
      </SectionCard>
    </div>
  );
}
