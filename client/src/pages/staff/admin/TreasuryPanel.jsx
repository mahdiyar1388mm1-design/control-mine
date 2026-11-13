import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDateTime, formatMoney, formatNumber } from '../../../lib/format';
import { Icon } from '../../../components/Icon';
import {
  AdminError, AdminLoading, Badge, EmptyHint, Modal, Pagination, SectionCard,
  StatCard, Toast, useAdminData
} from './AdminUi';

const ENTRY_TYPES = [
  { id: '', label: 'همهٔ تراکنش‌ها' },
  { id: 'product_sale', label: 'فروش کالا' },
  { id: 'service_sale', label: 'فروش خدمت' },
  { id: 'lth_sale', label: 'فروش LTH' },
  { id: 'refund', label: 'استرداد' },
  { id: 'payout', label: 'تسویه' },
  { id: 'adjustment', label: 'اصلاح دستی' }
];

function FlowChart({ days }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.in_toman, d.out_toman)));
  const shown = days.filter((_, i) => i % 3 === 0 || i === days.length - 1);
  return (
    <div className="ac-flow-chart">
      <div className="ac-flow-legend">
        <span><i className="in" /> ورود</span>
        <span><i className="out" /> خروج</span>
      </div>
      <div className="ac-flow-bars">
        {shown.map((d) => (
          <div className="ac-flow-col" key={d.day} title={`${d.day} — ورود ${formatMoney(d.in_toman)} / خروج ${formatMoney(d.out_toman)}`}>
            <div className="ac-flow-pair">
              <span className="ac-flow-bar in" style={{ height: `${Math.max(2, (d.in_toman / max) * 100)}%` }} />
              <span className="ac-flow-bar out" style={{ height: `${Math.max(2, (d.out_toman / max) * 100)}%` }} />
            </div>
            <small>{formatNumber(Number(d.day.slice(8, 10)))}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdjustModal({ open, onClose, onDone, defaultDirection }) {
  const [form, setForm] = useState({ direction: defaultDirection || 'in', amount: '', reason: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ direction: defaultDirection || 'in', amount: '', reason: '', note: '' });
      setError(null);
      setBusy(false);
    }
  }, [open, defaultDirection]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/admin/console/treasury/adjust', {
        method: 'POST',
        body: {
          direction: form.direction,
          amount_toman: Number(form.amount),
          reason: form.reason.trim(),
          note: form.note.trim()
        }
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="coin"
      title="ثبت دستی تراکنش خزانه"
      subtitle="ورود وجه به خزانه یا تسویه/برداشت از آن — با ثبت علت در سابقهٔ ممیزی."
      footer={(
        <>
          <button type="button" className="ac-btn ac-btn-ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button type="submit" form="ac-adjust-form" className="ac-btn ac-btn-primary" disabled={busy}>{busy ? 'در حال ثبت...' : 'ثبت تراکنش'}</button>
        </>
      )}
    >
      <form id="ac-adjust-form" className="ac-form" onSubmit={submit}>
        {error && <div className="ac-alert ac-alert-error">{error.message}</div>}
        <div className="ac-form-grid">
          <label className="ac-field"><span>نوع تراکنش</span>
            <select className="ac-select" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="in">ورود وجه به خزانه</option>
              <option value="out">تسویه / خروج وجه</option>
            </select>
          </label>
          <label className="ac-field"><span>مبلغ (تومان) <b className="ac-req">*</b></span>
            <input type="number" min="1" required className="ac-input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="مثلاً 5000000" />
          </label>
          <label className="ac-field ac-span-2"><span>علت <b className="ac-req">*</b></span>
            <input required minLength={3} className="ac-input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="مثلاً واریز نقدی فروشگاه" />
          </label>
          <label className="ac-field ac-span-2"><span>توضیح تکمیلی</span>
            <textarea className="ac-textarea" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
        </div>
      </form>
    </Modal>
  );
}

function TreasurySettingsModal({ open, onClose, summary, onDone }) {
  const [form, setForm] = useState({ opening: '', low: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && summary) {
      setForm({
        opening: String(summary.opening_toman ?? 0),
        low: String(summary.low_balance_toman ?? 0),
        reason: ''
      });
      setError(null);
    }
  }, [open, summary]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/admin/console/treasury/settings', {
        method: 'PATCH',
        body: {
          opening_balance_toman: Number(form.opening),
          low_balance_toman: Number(form.low),
          reason: form.reason.trim()
        }
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="settings"
      title="تنظیمات خزانه"
      subtitle="موجودی افتتاحیه و حد هشدار کمبود موجودی"
      footer={(
        <>
          <button type="button" className="ac-btn ac-btn-ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button type="submit" form="ac-treasury-settings" className="ac-btn ac-btn-primary" disabled={busy}>{busy ? 'در حال ذخیره...' : 'ذخیره'}</button>
        </>
      )}
    >
      <form id="ac-treasury-settings" className="ac-form" onSubmit={submit}>
        {error && <div className="ac-alert ac-alert-error">{error.message}</div>}
        <div className="ac-form-grid">
          <label className="ac-field"><span>موجودی افتتاحیه (تومان)</span>
            <input type="number" min="0" className="ac-input" value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} />
          </label>
          <label className="ac-field"><span>حد هشدار کمبود (تومان)</span>
            <input type="number" min="0" className="ac-input" value={form.low} onChange={(e) => setForm({ ...form, low: e.target.value })} />
          </label>
          <label className="ac-field ac-span-2"><span>علت تغییر <b className="ac-req">*</b></span>
            <input required minLength={3} className="ac-input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="مثلاً تنظیم اولیهٔ خزانه" />
          </label>
        </div>
      </form>
    </Modal>
  );
}

export function TreasuryPanel({ onOpenLth }) {
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState('');
  const [entryType, setEntryType] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '15');
    p.set('page', String(page));
    if (direction) p.set('direction', direction);
    if (entryType) p.set('entry_type', entryType);
    return `/admin/console/treasury?${p.toString()}`;
  }, [page, direction, entryType]);

  const { data, loading, error, reload, refreshing } = useAdminData(path, { autoRefreshMs: 60000 });

  if (loading && !data) return <AdminLoading label="در حال محاسبهٔ خزانه..." />;
  if (error && !data) return <AdminError error={error} onRetry={reload} />;

  const s = data.summary;
  const low = s.balance_toman <= s.low_balance_toman;
  const lthData = data.lth;

  return (
    <div className="ac-panel">
      <Toast onClose={() => setToast('')}>{toast}</Toast>

      <div className="ac-panel-head">
        <div>
          <h2>خزانه</h2>
          <p>کل جریان نقدی سامانه به‌صورت خودکار از پرداخت‌ها، استردادها و فروش LTH ثبت می‌شود.</p>
        </div>
        <div className="ac-head-actions">
          <button type="button" className="ac-icon-btn" title="بروزرسانی" onClick={reload}>
            <Icon name="refresh" size={16} className={refreshing ? 'ac-spin' : ''} />
          </button>
          <button type="button" className="ac-btn ac-btn-ghost" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={15} /> تنظیمات
          </button>
          <button type="button" className="ac-btn ac-btn-primary" onClick={() => setAdjustOpen(true)}>
            <Icon name="plus" size={16} color="#fff" /> تراکنش دستی
          </button>
        </div>
      </div>

      <div className="ac-treasury-hero">
        <div className="ac-treasury-balance">
          <span className="ac-treasury-label"><Icon name="landmark" size={18} color="#fff" /> موجودی فعلی خزانه</span>
          <strong>{Number(s.balance_toman).toLocaleString('fa-IR')} <small>تومان</small></strong>
          <span className="ac-treasury-sub">افتتاحیه {formatMoney(s.opening_toman)} + ورود {formatMoney(s.total_in_toman)} − خروج {formatMoney(s.total_out_toman)}</span>
          {low && <span className="ac-treasury-warn"><Icon name="alert" size={14} color="#fff" /> موجودی زیر حد هشدار است</span>}
        </div>
        <div className="ac-treasury-side">
          <div><span>ورود امروز</span><strong>{Number(s.today_in_toman).toLocaleString('fa-IR')}</strong></div>
          <div><span>خروج امروز</span><strong>{Number(s.today_out_toman).toLocaleString('fa-IR')}</strong></div>
          <div><span>تعداد تراکنش</span><strong>{formatNumber(s.entries)}</strong></div>
        </div>
      </div>

      <div className="ac-stats ac-stats-4">
        <StatCard icon="wallet" label="کل ورود وجه" value={formatMoney(s.total_in_toman)} sub="پرداخت‌های موفق و فروش LTH" tone="ok" />
        <StatCard icon="undo" label="کل خروج وجه" value={formatMoney(s.total_out_toman)} sub="استرداد و تسویه" tone="rose" />
        <StatCard icon="clock" label="پرداخت‌های در انتظار" value={formatNumber(s.pending_payments?.count ?? 0)} sub={formatMoney(s.pending_payments?.total_toman ?? 0)} tone="amber" />
        <StatCard icon="creditCard" label="استردادها" value={formatNumber(s.refunds?.count ?? 0)} sub={formatMoney(s.refunds?.total_toman ?? 0)} tone="plum" />
      </div>

      <div className="ac-detail-grid">
        <SectionCard title="جریان ۳۰ روز اخیر" subtitle="ورود و خروج روزانهٔ وجه" icon="refresh">
          <FlowChart days={data.last_30_days} />
        </SectionCard>
        <SectionCard title="ترکیب درآمد" subtitle="بر اساس منبع تراکنش" icon="coin">
          <div className="ac-type-list">
            {(data.by_type || []).map((t) => (
              <div className="ac-type-row" key={`${t.entry_type}-${t.direction}`}>
                <span className={`ac-type-dot ${t.direction}`} />
                <div><strong>{t.label}</strong><small>{formatNumber(t.count)} تراکنش</small></div>
                <b>{Number(t.total_toman).toLocaleString('fa-IR')}</b>
              </div>
            ))}
            {(!data.by_type || data.by_type.length === 0) && <EmptyHint icon="coin" title="هنوز تراکنشی ثبت نشده" />}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="دفتر خزانه"
        subtitle="همهٔ تراکنش‌ها با منبع، مرجع و زمان دقیق"
        icon="landmark"
        action={(
          <div className="ac-toolbar">
            <select className="ac-select ac-select-sm" value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1); }}>
              <option value="">ورود و خروج</option>
              <option value="in">فقط ورود</option>
              <option value="out">فقط خروج</option>
            </select>
            <select className="ac-select ac-select-sm" value={entryType} onChange={(e) => { setEntryType(e.target.value); setPage(1); }}>
              {ENTRY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
        )}
      >
        {(data.ledger || []).length === 0 ? (
          <EmptyHint icon="landmark" title="تراکنشی با این فیلتر نیست" />
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table ac-table-treasury">
              <thead><tr><th>زمان</th><th>نوع</th><th>جهت</th><th>مبلغ</th><th>منبع</th><th>توضیح</th><th>ثبت‌کننده</th></tr></thead>
              <tbody>
                {data.ledger.map((row) => (
                  <tr key={row.id}>
                    <td className="ac-cell-date">{formatDateTime(row.created_at)}</td>
                    <td><span className="ac-entry-label">{row.entry_label}</span></td>
                    <td>{row.direction === 'in' ? <Badge tone="ok">ورود</Badge> : <Badge tone="danger">خروج</Badge>}</td>
                    <td className={`ac-amount ${row.direction}`}>{row.direction === 'in' ? '+' : '−'} {Number(row.amount_toman).toLocaleString('fa-IR')}</td>
                    <td><span className="mono ac-cell-sub" dir="ltr">{row.ref_type || '—'}</span></td>
                    <td className="ac-cell-note">{row.note || '—'}</td>
                    <td>{row.actor_name || 'سامانه'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={data.page} limit={data.limit} total={data.total} onChange={setPage} />
      </SectionCard>

      {lthData && (
        <section className="ac-lth-banner">
          <div className="ac-lth-banner-main">
            <span className="ac-lth-badge">LTH</span>
            <div>
              <h3>خزانهٔ پروتکل LTH</h3>
              <p>{lthData.conservation_label}</p>
            </div>
            <button type="button" className="ac-btn ac-btn-primary" onClick={onOpenLth}>
              مدیریت کامل LTH <Icon name="wallet" size={15} color="#fff" />
            </button>
          </div>
          <div className="ac-lth-metrics">
            <div><span>کل عرضه</span><strong dir="ltr">{lthData.total_supply_lth_headline}</strong></div>
            <div><span>دارایی خزانه</span><strong dir="ltr">{lthData.asset_lth_headline}</strong></div>
            <div><span>مقدار بازار</span><strong dir="ltr">{lthData.market_lth_display_8}</strong></div>
            <div><span>بازگشت استیک</span><strong dir="ltr">{lthData.returned_stake_lth_display_8}</strong></div>
            <div><span>بازگشت پایه</span><strong dir="ltr">{lthData.returned_base_lth_display_8}</strong></div>
            <div><span>کارمزد جمع‌شده</span><strong dir="ltr">{lthData.collected_fee_lth_display_8}</strong></div>
          </div>
        </section>
      )}

      <AdjustModal
        open={adjustOpen}
        defaultDirection="in"
        onClose={() => setAdjustOpen(false)}
        onDone={() => { setToast('تراکنش خزانه ثبت شد.'); reload(); }}
      />
      <TreasurySettingsModal
        open={settingsOpen}
        summary={s}
        onClose={() => setSettingsOpen(false)}
        onDone={() => { setToast('تنظیمات خزانه ذخیره شد.'); reload(); }}
      />
    </div>
  );
}
