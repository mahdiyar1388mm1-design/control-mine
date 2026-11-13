import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
import { ErrorState, FieldErrorsList, LoadingState } from '../../components/StateViews';
import { Icon } from '../../components/Icon';

const TREASURY_ROW_META = {
  asset: { icon: 'wallet', hint: 'مانده دارایی پروتکل' },
  market: { icon: 'chart', hint: 'کل LTH در گردش بازار' },
  base_flow: { icon: 'scale', hint: 'پایهٔ صادرشده منهای پایهٔ بازگشتی' },
  returned_stake: { icon: 'lock', hint: 'استیک بازگشته به خزانه' },
  returned_base: { icon: 'arrowRight', hint: 'پایهٔ بازگشته به خزانه' },
  returned_reward: { icon: 'spark', hint: 'پاداش بازگشته به خزانه' },
  collected_fee: { icon: 'receipt', hint: 'کارمزدهای وصول‌شده' },
  tax_accrued: { icon: 'tax', hint: 'مالیات تعلق‌گرفته روی کارمزد' },
  tax_settled: { icon: 'checkCircle', hint: 'مالیات تسویه‌شده با خزانه' },
  tax_outstanding: { icon: 'alert', hint: 'مالیات پرداخت‌نشده' },
  net_fee: { icon: 'coins', hint: 'کارمزد خالص پس از کسر مالیات' }
};

const LEDGER_TYPE_LABELS = {
  purchase_base: 'خرید اولیه حجم پایه',
  reward_credit: 'واریز پاداش ۲۴ساعته',
  stake_unlock: 'آزادسازی استیک ۳۲۸۵روزه',
  sheba_withdraw_request: 'درخواست برداشت شبا',
  sell_lth_request: 'درخواست فروش LTH',
  sheba_withdraw_paid: 'تسویه نهایی شبا',
  sheba_withdraw_refund: 'برگشت/رد درخواست شبا',
  p2p_transfer_out: 'انتقال حساب به حساب (خروجی)',
  p2p_transfer_in: 'انتقال حساب به حساب (ورودی)',
  admin_adjustment: 'اصلاح مدیریتی'
};

export function AdminLthPanel({ userRole = 'admin' }) {
  const isAdmin = userRole === 'admin';
  const [subTab, setSubTab] = useState('protocol-search'); // protocol-search | treasury | settings

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);

  const [cfg, setCfg] = useState(null);
  const [recData, setRecData] = useState(null);

  // Protocol Search & Metrics Control state
  const [filters, setFilters] = useState({
    q: '',
    scope: 'all',
    min_lth: '',
    max_lth: '',
    only_with_balance: false,
    only_mismatch: false,
    contract_status: '',
    withdrawal_status: '',
    ledger_type: '',
    projection_days: 30
  });
  const [searchRes, setSearchRes] = useState(null);
  const [searching, setSearching] = useState(false);

  // 360° User Protocol Inspector state
  const [inspectedUser, setInspectedUser] = useState(null);
  const [inspectLoading, setInspectLoading] = useState(false);

  // Admin Settings & Treasury Forms
  const [form, setForm] = useState({
    price_irr: '4840000000',
    reward_per_min_unit_lth: '0.000000000034',
    stake_percent: 70,
    withdrawable_percent: 30,
    lockup_days: 3285,
    packages_csv: '22000000, 11000000, 8000000, 1000000, 220000',
    reason: ''
  });
  const [treasuryForm, setTreasuryForm] = useState({
    total_supply_lth: '15000000',
    transfer_fee_percent: 0,
    sell_fee_percent: 0,
    reason: ''
  });
  const [logoFile, setLogoFile] = useState(null);
  const [taxForm, setTaxForm] = useState({ tax_percent: '10', reason: '' });
  const [settleForm, setSettleForm] = useState({ lth_amount: '', reference: '', reason: '' });
  const [projection, setProjection] = useState(null);
  const [projectionBusy, setProjectionBusy] = useState(false);
  const [projectionForm, setProjectionForm] = useState({ stake_percent: '', target_reward_lth: '' });

  const runSearch = useCallback(async (overrideFilters) => {
    const f = overrideFilters || filters;
    setSearching(true);
    setOpErr(null);
    try {
      const qs = new URLSearchParams();
      if (f.q.trim()) qs.set('q', f.q.trim());
      if (f.scope) qs.set('scope', f.scope);
      if (f.min_lth.trim()) qs.set('min_lth', f.min_lth.trim());
      if (f.max_lth.trim()) qs.set('max_lth', f.max_lth.trim());
      if (f.only_with_balance) qs.set('only_with_balance', 'true');
      if (f.only_mismatch) qs.set('only_mismatch', 'true');
      if (f.contract_status) qs.set('contract_status', f.contract_status);
      if (f.withdrawal_status) qs.set('withdrawal_status', f.withdrawal_status);
      if (f.ledger_type) qs.set('ledger_type', f.ledger_type);
      qs.set('projection_days', String(f.projection_days || 30));

      const res = await apiFetch(`/admin/lth/protocol-search?${qs.toString()}`);
      setSearchRes(res);
    } catch (err) {
      setOpErr(err);
    } finally {
      setSearching(false);
    }
  }, [filters]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, rRes, sRes] = await Promise.all([
        apiFetch('/lth/config'),
        apiFetch('/admin/lth/reconciliation'),
        apiFetch('/admin/lth/protocol-search?projection_days=30')
      ]);
      apiFetch('/admin/lth/projection')
        .then((p) => setProjection(p))
        .catch(() => setProjection(null));
      const c = cRes.config;
      const t = rRes.treasury;
      setCfg(c);
      setRecData(rRes);
      setSearchRes(sRes);
      setForm({
        price_irr: c.price_irr,
        reward_per_min_unit_lth: c.reward_per_min_unit_lth,
        stake_percent: c.stake_percent,
        withdrawable_percent: c.withdrawable_percent,
        lockup_days: c.lockup_days,
        packages_csv: (c.packages_toman || []).join(', '),
        reason: ''
      });
      if (t) {
        setTreasuryForm({
          total_supply_lth: t.total_supply_lth_exact,
          transfer_fee_percent: t.transfer_fee_percent,
          sell_fee_percent: t.sell_fee_percent,
          reason: ''
        });
        if (t.protocol_tax_percent !== undefined) {
          setTaxForm((f) => ({ ...f, tax_percent: String(t.protocol_tax_percent) }));
        }
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openUserInspector = async (userId) => {
    if (!userId) return;
    setInspectLoading(true);
    setOpErr(null);
    try {
      const res = await apiFetch(`/admin/lth/users/${userId}/inspect`);
      setInspectedUser(res);
    } catch (err) {
      setOpErr(err);
    } finally {
      setInspectLoading(false);
    }
  };

  // Coupled 100% Regulator
  const handleStakeChange = (raw) => {
    const num = Math.max(0, Math.min(100, Math.round(Number(raw || 0) * 100) / 100));
    const comp = Math.round((100 - num) * 100) / 100;
    setForm((f) => ({ ...f, stake_percent: num, withdrawable_percent: comp }));
  };

  const handleWithdrawableChange = (raw) => {
    const num = Math.max(0, Math.min(100, Math.round(Number(raw || 0) * 100) / 100));
    const comp = Math.round((100 - num) * 100) / 100;
    setForm((f) => ({ ...f, withdrawable_percent: num, stake_percent: comp }));
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const packagesArr = form.packages_csv
        .split(/[,،\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s));

      await apiFetch('/admin/lth/settings', {
        method: 'PATCH',
        body: {
          price_irr: form.price_irr,
          reward_per_min_unit_lth: form.reward_per_min_unit_lth,
          stake_percent: Number(form.stake_percent),
          withdrawable_percent: Number(form.withdrawable_percent),
          lockup_days: Number(form.lockup_days),
          packages_toman: packagesArr,
          reason: form.reason.trim()
        }
      });
      setMsg(`تنظیمات موتور LTH و ریگلاژ (${form.stake_percent}٪ استیک / ${form.withdrawable_percent}٪ قابل برداشت) در سرور ذخیره و در ممیزی ثبت شد.`);
      await loadAll();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTreasury = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch('/admin/lth/treasury', {
        method: 'PATCH',
        body: {
          total_supply_lth: treasuryForm.total_supply_lth,
          transfer_fee_percent: Number(treasuryForm.transfer_fee_percent),
          sell_fee_percent: Number(treasuryForm.sell_fee_percent),
          reason: treasuryForm.reason.trim()
        }
      });
      setMsg('سقف عرضهٔ خزانه و ضرایب کارمزد پروتکل در سرور بروزرسانی و در سابقهٔ ممیزی ثبت شد.');
      await loadAll();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const runProjection = async (e) => {
    if (e) e.preventDefault();
    setProjectionBusy(true);
    setOpErr(null);
    try {
      const qs = new URLSearchParams();
      if (projectionForm.stake_percent !== '') qs.set('stake_percent', projectionForm.stake_percent);
      if (projectionForm.target_reward_lth.trim()) qs.set('target_reward_lth', projectionForm.target_reward_lth.trim());
      const res = await apiFetch(`/admin/lth/projection${qs.toString() ? `?${qs}` : ''}`);
      setProjection(res);
    } catch (err) {
      setOpErr(err);
    } finally {
      setProjectionBusy(false);
    }
  };

  const handleSaveTaxRate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch('/admin/lth/tax', {
        method: 'PATCH',
        body: { tax_percent: Number(taxForm.tax_percent), reason: taxForm.reason.trim() }
      });
      setMsg(`نرخ مالیات روی کارمزدها به ${taxForm.tax_percent}٪ تغییر کرد و در ممیزی ثبت شد.`);
      await loadAll();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSettleTax = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch('/admin/lth/tax/settle', {
        method: 'POST',
        body: {
          lth_amount: settleForm.lth_amount.trim(),
          reference: settleForm.reference.trim(),
          reason: settleForm.reason.trim()
        }
      });
      setMsg('تسویهٔ مالیات پروتکل ثبت شد و در سوابق ممیزی و ردیف‌های خزانه بازتاب یافت.');
      setSettleForm({ lth_amount: '', reference: '', reason: '' });
      await loadAll();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleLogoUpload = async (e) => {
    e.preventDefault();
    if (!logoFile) return;
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('logo', logoFile);
      await apiFetch('/admin/lth/logo', {
        method: 'POST',
        body: fd
      });
      setLogoFile(null);
      setMsg('تصویر لوگوی LTH در سرور بارگذاری شد و هم‌اکنون در نوار بالا، خزانه و ماشین‌حساب نمایش داده می‌شود.');
      await loadAll();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleManualSettle = async () => {
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch('/admin/lth/settle-due', { method: 'POST', body: {} });
      setMsg(`پایش سرور اجرا شد — چرخه‌های ۲۴ ساعتهٔ واریزشده در این نوبت: ${formatNumber(res.cycles_settled)} | استیک آزادشده: ${formatNumber(res.stakes_unlocked)}`);
      await loadAll();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="در حال بارگذاری خزانه، موازین پروتکل و دفتر حسابداری LTH..." />;
  if (error) return <ErrorState error={error} onRetry={loadAll} />;

  const rec = searchRes?.reconciliation || recData?.reconciliation;
  const treasury = searchRes?.treasury || recData?.treasury;
  const mc = searchRes?.metrics_control;
  const sched = recData?.scheduler;
  const r = searchRes?.results || {};

  return (
    <div>
      {msg && <div className="alert-inline ok"><Icon name="check" size={14} /> {msg}</div>}
      {opErr && (
        <>
          <div className="alert-inline error"><Icon name="alert" size={14} /> {opErr.message}</div>
          <FieldErrorsList details={opErr.details} />
        </>
      )}

      {/* Sub-navigation inside LTH Protocol Workspace */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`tab-btn ${subTab === 'protocol-search' ? 'active' : ''}`}
          onClick={() => setSubTab('protocol-search')}
        >
          <Icon name="search" size={15} /> سرچ پروتکل، بررسی موازین و کنترل مقادیر
        </button>
        <button
          type="button"
          className={`tab-btn ${subTab === 'treasury' ? 'active' : ''}`}
          onClick={() => setSubTab('treasury')}
        >
          <Icon name="landmark" size={15} /> خزانه پروتکل (۱۵٬۰۰۰٬۰۰۰ LTH)
        </button>
        {isAdmin && (
          <button
            type="button"
            className={`tab-btn ${subTab === 'settings' ? 'active' : ''}`}
            onClick={() => setSubTab('settings')}
          >
            <Icon name="scale" size={15} /> ریگلاژ ۷۰/۳۰، نرخ‌ها و لوگوی LTH
          </button>
        )}
      </div>

      {/* Global Reconciliation & Multi-Server Cluster Health Strip */}
      {rec && (
        <div className="card" style={{ background: rec.healthy && treasury?.conservation_ok ? '#f0fdf4' : '#fef2f2', borderColor: rec.healthy && treasury?.conservation_ok ? '#86efac' : '#fca5a5' }}>
          <div className="flex-between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: '1.03rem', color: rec.healthy ? '#166534' : '#991b1b' }}>
              <Icon name={rec.healthy ? 'check' : 'alert'} size={14} /> {rec.healthy ? 'همخوانی کامل دفتر حسابداری و تراز خزانهٔ پروتکل' : 'هشدار عدم تطابق دفتر حسابداری'}
            </h3>
            <div className="flex-gap">
              {isAdmin && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={handleManualSettle}>
                  <Icon name="clock" size={15} /> اجرای دستی پایش ۲۴ ساعتهٔ سرور
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={loadAll}><Icon name="refresh" size={16} /> بروزرسانی کل موازین</button>
            </div>
          </div>
          <div className="grid grid-4" style={{ fontSize: '0.84rem' }}>
            <div>وضعیت دفتر کل: <strong>{rec.status_label}</strong></div>
            <div>دارایی خزانه: <strong className="mono" dir="ltr">LTH {treasury?.asset_lth_headline}</strong></div>
            <div>مقدار در گردش بازار: <strong className="mono" dir="ltr">LTH {treasury?.market_lth_display_12}</strong></div>
            <div>سرور دارندهٔ قفل توزیع‌شده: <span className="mono">{sched?.lease?.holder_instance_id || sched?.current_server_instance_id}</span></div>
          </div>
        </div>
      )}

      {/* ==================== TAB 1: BACKEND PROTOCOL SEARCH & METRICS CONTROL ==================== */}
      {subTab === 'protocol-search' && (
        <div>
          {/* Metrics & Quantity Control Projection Strip ("کنترل مقادیر و موازین") */}
          {mc && (
            <div className="grid grid-4" style={{ marginBottom: 16 }}>
              <div className="kpi-card">
                <div className="kpi-label">قراردادهای فعال PoS / حجم پایهٔ مولد</div>
                <div className="kpi-value" style={{ fontSize: '1rem' }}>
                  {formatNumber(mc.active_contracts_count)} قرارداد | <span className="mono" dir="ltr">{mc.active_earning_base_lth_display_12} LTH</span>
                </div>
                <div className="muted" style={{ fontSize: '0.76rem' }}>معادل {mc.active_earning_base_irr_formatted} ریال</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">تعهد پاداش ۲۴ ساعتهٔ کل پروتکل</div>
                <div className="kpi-value mono" dir="ltr" style={{ fontSize: '1rem', color: '#db2777' }}>
                  LTH {mc.daily_24h_obligation.total_reward_lth_display_12}
                </div>
                <div className="muted" style={{ fontSize: '0.76rem' }}>
                  معادل {mc.daily_24h_obligation.total_reward_irr_formatted} ریال ({mc.daily_24h_obligation.withdrawable_reward_irr_formatted} ریال آزاد)
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">پیش‌بینی تعهد {formatNumber(mc.projection.days)} روز آینده</div>
                <div className="kpi-value mono" dir="ltr" style={{ fontSize: '1rem' }}>
                  LTH {mc.projection.projected_total_reward_lth_display_12}
                </div>
                <div className="muted" style={{ fontSize: '0.76rem' }}>
                  معادل {mc.projection.projected_total_reward_irr_formatted} ریال
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">پوشش خزانه و استیک در شرف آزادسازی</div>
                <div className="kpi-value" style={{ fontSize: '0.96rem', color: mc.projection.treasury_covers_projection ? '#15803d' : '#b91c1c' }}>
                  <Icon name={mc.projection.treasury_covers_projection ? 'check' : 'alert'} size={14} /> {mc.projection.treasury_covers_projection ? 'پوشش کامل از خزانه' : 'نیازمند بررسی سقف خزانه'}
                </div>
                <div className="muted" style={{ fontSize: '0.76rem' }}>
                  آزادسازی در این افق: <span className="mono" dir="ltr">{mc.projection.stakes_unlocking_in_window_lth_display_12} LTH</span>
                </div>
              </div>
            </div>
          )}

          {/* Unified Protocol Search Filter Card */}
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(filters);
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>
              <Icon name="search" size={16} /> جست‌وجوی یکپارچهٔ پروتکل در بک‌اند (بررسی موازین ۷گانه، قراردادها، شبا و دفتر کل)
            </h3>
            <div className="grid grid-4" style={{ marginBottom: 12 }}>
              <div className="form-row" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
                <label className="form-label">عبارت جست‌وجو</label>
                <input
                  type="search"
                  className="input"
                  placeholder="نام، موبایل، سریال ۱۶ رقمی کیف پول، POS-...، LP-...، SW-...، شبا IR...، TR-..."
                  value={filters.q}
                  onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="form-label">دامنهٔ سرچ پروتکل</label>
                <select
                  className="select"
                  value={filters.scope}
                  onChange={(e) => setFilters({ ...filters, scope: e.target.value })}
                >
                  <option value="all">همهٔ بخش‌های پروتکل</option>
                  <option value="wallets">کیف پول کاربران (۷ میزان)</option>
                  <option value="contracts">قراردادهای هوشمند (POS / LP)</option>
                  <option value="withdrawals">برداشت شبا و فروش (SW)</option>
                  <option value="transfers">انتقال حساب به حساب (TR)</option>
                  <option value="ledger">دفتر کل دوبل (Ledger)</option>
                  <option value="treasury">رویدادهای خزانه (بازگشت و کارمزد)</option>
                </select>
              </div>

              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="form-label">افق پیش‌بینی تعهدات (روز)</label>
                <select
                  className="select"
                  value={filters.projection_days}
                  onChange={(e) => setFilters({ ...filters, projection_days: Number(e.target.value) })}
                >
                  <option value={1}>۱ روز (۲۴ ساعت آینده)</option>
                  <option value={7}>۷ روز آینده</option>
                  <option value={30}>۳۰ روز آینده</option>
                  <option value={90}>۹۰ روز آینده</option>
                  <option value={365}>۳۶۵ روز (یک‌ساله)</option>
                  <option value={3285}>۳٬۲۸۵ روز (کل دوره قفل استیک)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-4" style={{ marginBottom: 12 }}>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="form-label">حداقل مقدار (LTH)</label>
                <input
                  className="input mono"
                  placeholder="مثلاً 0.001"
                  value={filters.min_lth}
                  onChange={(e) => setFilters({ ...filters, min_lth: e.target.value })}
                />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="form-label">حداکثر مقدار (LTH)</label>
                <input
                  className="input mono"
                  placeholder="مثلاً 10"
                  value={filters.max_lth}
                  onChange={(e) => setFilters({ ...filters, max_lth: e.target.value })}
                />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="form-label">فیلتر وضعیت قرارداد / شبا</label>
                <select
                  className="select"
                  value={filters.withdrawal_status}
                  onChange={(e) => setFilters({ ...filters, withdrawal_status: e.target.value })}
                >
                  <option value="">همهٔ وضعیت‌های شبا</option>
                  <option value="pending">شبا در انتظار تسویه</option>
                  <option value="paid">شبا تسویه‌شده</option>
                  <option value="rejected">شبا ردشده</option>
                  <option value="canceled">لغوشده توسط کاربر</option>
                </select>
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="form-label">فیلتر نوع سند دفتر کل</label>
                <select
                  className="select"
                  value={filters.ledger_type}
                  onChange={(e) => setFilters({ ...filters, ledger_type: e.target.value })}
                >
                  <option value="">همهٔ اسناد دفتر کل</option>
                  {Object.entries(LEDGER_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex-between" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div className="flex-gap">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={filters.only_with_balance}
                    onChange={(e) => setFilters({ ...filters, only_with_balance: e.target.checked })}
                  />
                  فقط کیف‌پول‌های دارای موجودی
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={filters.only_mismatch}
                    onChange={(e) => setFilters({ ...filters, only_mismatch: e.target.checked })}
                  />
                  فقط کیف‌پول‌های دارای مغایرت حسابداری
                </label>
              </div>

              <div className="flex-gap">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const reset = {
                      q: '',
                      scope: 'all',
                      min_lth: '',
                      max_lth: '',
                      only_with_balance: false,
                      only_mismatch: false,
                      contract_status: '',
                      withdrawal_status: '',
                      ledger_type: '',
                      projection_days: 30
                    };
                    setFilters(reset);
                    runSearch(reset);
                  }}
                >
                  پاک‌سازی فیلترها
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={searching} style={{ background: '#ec1e79' }}>
                  {searching ? 'در حال جست‌وجو در سرور...' : <><Icon name="search" size={15} /> اجرای سرچ پروتکل</>}
                </button>
              </div>
            </div>
          </form>

          {/* 360° User Protocol Inspector Drawer / Card */}
          {inspectLoading && <LoadingState label="در حال بارگذاری بازرسی ۳۶۰ درجهٔ موازین کاربر..." />}
          {inspectedUser && !inspectLoading && (
            <div className="card" style={{ border: '2px solid #ec1e79', background: '#fffbfd' }}>
              <div className="flex-between" style={{ marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.08rem', color: '#be185d' }}>
                    <Icon name="search" size={16} /> بازرسی ۳۶۰ درجهٔ موازین کاربر: {inspectedUser.user.full_name} ({inspectedUser.user.phone_masked})
                  </h3>
                  <div className="muted" style={{ fontSize: '0.82rem' }}>
                    سریال کیف پول: <span className="mono">{inspectedUser.wallet.wallet_serial}</span> | تطبیق دفتر کل:{' '}
                    <strong style={{ color: inspectedUser.reconciliation.healthy ? '#15803d' : '#b91c1c' }}>
                      {inspectedUser.reconciliation.status_label}
                    </strong>{' '}
                    | استیک آزادشده در کیف پول: <span className="mono" dir="ltr">LTH {inspectedUser.unlocked_stake_pool_lth_display_12}</span>
                  </div>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setInspectedUser(null)}><Icon name="close" size={14} /> بستن بازرسی</button>
              </div>

              <div className="grid grid-4" style={{ marginBottom: 12, fontSize: '0.85rem' }}>
                <div className="kpi-card">
                  <div className="kpi-label">۱. حجم پایه</div>
                  <div className="kpi-value mono" dir="ltr" style={{ fontSize: '0.95rem' }}>LTH {inspectedUser.wallet.base_lth_display_12}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">۲. استیک قفل‌شده</div>
                  <div className="kpi-value mono" dir="ltr" style={{ fontSize: '0.95rem' }}>LTH {inspectedUser.wallet.staked_lth_display_12}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">۳. پاداش قابل برداشت</div>
                  <div className="kpi-value mono" dir="ltr" style={{ fontSize: '0.95rem' }}>LTH {inspectedUser.wallet.withdrawable_reward_lth_display_12}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">۴. جمع LTH قابل برداشت</div>
                  <div className="kpi-value mono" dir="ltr" style={{ fontSize: '0.95rem' }}>LTH {inspectedUser.wallet.total_withdrawable_lth_display_12}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">۵. قابل برداشت (ریال)</div>
                  <div className="kpi-value mono" style={{ fontSize: '0.95rem' }}>{inspectedUser.wallet.withdrawable_irr_formatted} ریال</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">۶. جمع ریال کل</div>
                  <div className="kpi-value mono" style={{ fontSize: '0.95rem' }}>{inspectedUser.wallet.total_irr_formatted} ریال</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">۷. جمع ال تی اچ کل</div>
                  <div className="kpi-value mono" dir="ltr" style={{ fontSize: '0.95rem', color: '#db2777' }}>LTH {inspectedUser.wallet.total_lth_display_12}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">در رزرو شبا / تعداد قرارداد</div>
                  <div className="kpi-value mono" style={{ fontSize: '0.92rem' }}>
                    {inspectedUser.wallet.reserved_lth_display_12} LTH | {formatNumber(inspectedUser.holdings.length)} قرارداد
                  </div>
                </div>
              </div>

              {inspectedUser.holdings.length > 0 && (
                <div className="table-wrap" style={{ marginBottom: 10 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>کد قرارداد PoS</th>
                        <th>حجم پایه فعال</th>
                        <th>استیک انباشته</th>
                        <th>پاداش روزانه</th>
                        <th>روزهای باقی‌مانده قفل</th>
                        <th>وضعیت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inspectedUser.holdings.map((h) => (
                        <tr key={h.id}>
                          <td className="mono">{h.contract_code}</td>
                          <td className="mono" dir="ltr">LTH {h.active_base_lth_exact}</td>
                          <td className="mono" dir="ltr">LTH {h.accrued_staked_lth_exact}</td>
                          <td className="mono" dir="ltr">LTH {h.daily_reward_lth_exact}</td>
                          <td>{h.stake_unlocked ? 'آزادشده' : `${formatNumber(h.days_remaining)} روز`}</td>
                          <td>{h.status === 'active' ? 'فعال' : 'تسویه‌شده'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Result 1: Wallets Table (7 Metrics Overview) */}
          {(filters.scope === 'all' || filters.scope === 'wallets') && (
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1.02rem' }}>
                <Icon name="wallet" size={16} /> کیف پول‌های منطبق ({formatNumber((r.wallets || []).length)} مورد)
              </h3>
              {(r.wallets || []).length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>کیف پولی با فیلترهای انتخابی یافت نشد.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>کاربر / سریال کیف پول</th>
                        <th>حجم پایه (LTH)</th>
                        <th>استیک قفل (LTH)</th>
                        <th>پاداش آزاد (LTH)</th>
                        <th>جمع کل LTH</th>
                        <th>قابل برداشت (ریال)</th>
                        <th>تطبیق دفتر</th>
                        <th>بازرسی</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.wallets.map((w) => (
                        <tr key={w.user_id}>
                          <td>
                            <strong>{w.full_name}</strong>
                            <div className="muted mono" style={{ fontSize: '0.76rem' }}>{w.phone_masked} | {w.metrics.wallet_serial}</div>
                          </td>
                          <td className="mono" dir="ltr">{w.metrics.base_lth_display_12}</td>
                          <td className="mono" dir="ltr">{w.metrics.staked_lth_display_12}</td>
                          <td className="mono" dir="ltr">{w.metrics.withdrawable_reward_lth_display_12}</td>
                          <td className="mono" dir="ltr" style={{ fontWeight: 700, color: '#be185d' }}>{w.metrics.total_lth_display_12}</td>
                          <td className="mono">{w.metrics.withdrawable_irr_formatted} ریال</td>
                          <td>
                            <span className={`badge ${w.ledger_healthy ? 'badge-ok' : 'badge-danger'}`}>
                              <Icon name={w.ledger_healthy ? 'check' : 'alert'} size={14} /> {w.ledger_healthy ? 'منطبق' : 'مغایرت'}
                            </span>
                          </td>
                          <td>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openUserInspector(w.user_id)}>
                              <Icon name="search" size={14} /> بازرسی ۷ میزان
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Result 2: Smart Contracts (POS-...) */}
          {(filters.scope === 'all' || filters.scope === 'contracts') && (
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1.02rem' }}>
                <Icon name="book" size={16} /> قراردادهای هوشمند PoS ({formatNumber((r.contracts || []).length)} مورد)
              </h3>
              {(r.contracts || []).length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>قرارداد هوشمندی یافت نشد.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>کد قرارداد / خرید</th>
                        <th>کاربر</th>
                        <th>حجم پایه فعال</th>
                        <th>استیک انباشته</th>
                        <th>پاداش ۲۴ساعته</th>
                        <th>چرخه‌ها / قفل</th>
                        <th>بازرسی</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.contracts.map((c) => (
                        <tr key={c.id}>
                          <td className="mono">
                            <strong>{c.contract_code}</strong>
                            <div className="muted" style={{ fontSize: '0.75rem' }}>{c.purchase_code} ({formatNumber(c.purchase_toman)} تومان)</div>
                          </td>
                          <td>{c.user_name} <span className="muted mono" style={{ fontSize: '0.75rem' }}>({c.user_phone_masked})</span></td>
                          <td className="mono" dir="ltr">{c.active_base_lth_display_12}</td>
                          <td className="mono" dir="ltr">{c.accrued_staked_lth_display_12}</td>
                          <td className="mono" dir="ltr">{c.daily_reward_lth_display_12}</td>
                          <td>
                            چرخه #{formatNumber(c.last_reward_cycle)} |{' '}
                            {c.stake_unlocked ? 'استیک آزادشده' : `${formatNumber(c.days_remaining)} روز تا آزادسازی`}
                          </td>
                          <td>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openUserInspector(c.user_id)}>
                              <Icon name="user" size={14} /> کاربر
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Result 3: Sheba Withdrawals & Sales */}
          {(filters.scope === 'all' || filters.scope === 'withdrawals') && (r.withdrawals || []).length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1.02rem' }}>
                <Icon name="bank" size={16} /> درخواست‌های برداشت شبا و فروش ({formatNumber(r.withdrawals.length)} مورد)
              </h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>کد درخواست</th>
                      <th>کاربر / شبا</th>
                      <th>نوع</th>
                      <th>مقدار LTH</th>
                      <th>مبلغ تسویه (ریال)</th>
                      <th>وضعیت / مرجع بانکی</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.withdrawals.map((sw) => (
                      <tr key={sw.id}>
                        <td className="mono">{sw.code}</td>
                        <td>
                          {sw.user_name}
                          <div className="muted mono" style={{ fontSize: '0.75rem' }}>{sw.sheba_iban}</div>
                        </td>
                        <td>{sw.kind_label}</td>
                        <td className="mono" dir="ltr">{sw.lth_display_12}</td>
                        <td className="mono">{sw.amount_irr_formatted} ریال</td>
                        <td>
                          <strong>{sw.status_label}</strong>
                          {sw.bank_ref && <div className="muted mono" style={{ fontSize: '0.75rem' }}>مرجع: {sw.bank_ref}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result 4: P2P Transfers */}
          {(filters.scope === 'all' || filters.scope === 'transfers') && (r.transfers || []).length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1.02rem' }}>
                <Icon name="swap" size={16} /> انتقال‌های حساب به حساب ({formatNumber(r.transfers.length)} مورد)
              </h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>کد انتقال</th>
                      <th>فرستنده</th>
                      <th>گیرنده</th>
                      <th>مقدار LTH</th>
                      <th>معادل ریالی</th>
                      <th>زمان</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.transfers.map((tr) => (
                      <tr key={tr.id}>
                        <td className="mono">{tr.code}</td>
                        <td>{tr.sender_name} ({tr.sender_phone_masked})</td>
                        <td>{tr.recipient_name} ({tr.recipient_phone_masked})</td>
                        <td className="mono" dir="ltr">{tr.lth_display_12}</td>
                        <td className="mono">{tr.irr_formatted} ریال</td>
                        <td>{formatDateTime(tr.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result 5: Ledger Entries */}
          {(filters.scope === 'all' || filters.scope === 'ledger') && (
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1.02rem' }}>
                <Icon name="book" size={16} /> اسناد دفتر کل حسابداری ({formatNumber((r.ledger_entries || []).length)} ردیف اخیر)
              </h3>
              {(r.ledger_entries || []).length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>سندی در دفتر کل یافت نشد.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>زمان ثبت</th>
                        <th>کاربر</th>
                        <th>نوع سند</th>
                        <th>Δ پایه</th>
                        <th>Δ استیک</th>
                        <th>Δ آزاد</th>
                        <th>شرح سند</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.ledger_entries.map((le) => (
                        <tr key={le.id}>
                          <td style={{ fontSize: '0.78rem' }}>{formatDateTime(le.created_at)}</td>
                          <td>{le.user_name}</td>
                          <td><span className="badge badge-info">{LEDGER_TYPE_LABELS[le.entry_type] || le.entry_type}</span></td>
                          <td className="mono" dir="ltr">{le.delta_base_lth}</td>
                          <td className="mono" dir="ltr">{le.delta_staked_lth}</td>
                          <td className="mono" dir="ltr">{le.delta_withdrawable_lth}</td>
                          <td style={{ fontSize: '0.82rem' }}>{le.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Result 6: Treasury Return & Fee Events */}
          {(filters.scope === 'all' || filters.scope === 'treasury') && (r.treasury_events || []).length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1.02rem' }}>
                <Icon name="landmark" size={16} /> رویدادهای بازگشت به خزانه و وصول کارمزد ({formatNumber(r.treasury_events.length)} مورد)
              </h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>زمان</th>
                      <th>نوع رویداد خزانه</th>
                      <th>مقدار LTH</th>
                      <th>کاربر مرتبط</th>
                      <th>شرح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.treasury_events.map((te) => (
                      <tr key={te.id}>
                        <td>{formatDateTime(te.created_at)}</td>
                        <td><strong>{te.event_label}</strong></td>
                        <td className="mono" dir="ltr">LTH {te.lth_display_12}</td>
                        <td>{te.user_name}</td>
                        <td>{te.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 2: PROTOCOL TREASURY ("خزانه") ==================== */}
      {subTab === 'treasury' && treasury && (
        <div className="two-col-layout">
          <div className="lth-treasury-card" style={{ marginBottom: 0 }}>
            <div className="lth-wallet-watermark" aria-hidden="true">LTH</div>
            <div className="lth-treasury-header">
              <span className="lth-treasury-title">خزانه</span>
              <div className="lth-treasury-coin-badge" dir="ltr">
                <img
                  src={treasury.logo_path || '/uploads/lth-logo-default.svg'}
                  alt="LTH"
                  style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff' }}
                />
                <span>LTH</span>
              </div>
            </div>
            <div className="lth-treasury-hero-row">
              <div className="lth-treasury-hero-label">دارایی</div>
              <div className="lth-treasury-hero-value" dir="ltr">LTH {treasury.asset_lth_headline}</div>
            </div>
            <div className="lth-treasury-divider" />
            <div className="lth-wallet-rows">
              {(treasury.rows || []).filter((row) => row.key !== 'asset' && row.key !== 'market').map((row) => {
                const meta = TREASURY_ROW_META[row.key] || { icon: 'dot', hint: '' };
                const negative = row.key === 'tax_outstanding' && BigInt(row.atoms || '0') > 0n;
                return (
                  <div className="lth-wallet-row" key={row.key}>
                    <div className="lth-row-title">
                      <span className="lth-row-ico" aria-hidden="true"><Icon name={meta.icon} size={16} /></span>
                      <span>
                        {row.label}
                        {meta.hint && <span className="lth-row-hint">{meta.hint}</span>}
                      </span>
                    </div>
                    <div className="lth-row-val" dir="ltr" style={negative ? { color: '#b91c1c' } : undefined}>
                      LTH {row.net_display_12 || row.display_12 || row.lth_display_12}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {isAdmin ? (
            <form onSubmit={handleSaveTreasury} className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}><Icon name="landmark" size={17} /> کنترل سقف عرضهٔ خزانه و نرخ کارمزد (ویژه مدیر کل)</h3>
              <div className="form-row">
                <label className="form-label">سقف کل عرضهٔ پروتکل (LTH) <span className="req-star">*</span></label>
                <input
                  className="input mono"
                  required
                  value={treasuryForm.total_supply_lth}
                  onChange={(e) => setTreasuryForm({ ...treasuryForm, total_supply_lth: e.target.value })}
                />
              </div>
              <div className="grid grid-2">
                <div className="form-row">
                  <label className="form-label">کارمزد انتقال حساب به حساب (٪)</label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    step="0.01"
                    className="input mono"
                    value={treasuryForm.transfer_fee_percent}
                    onChange={(e) => setTreasuryForm({ ...treasuryForm, transfer_fee_percent: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <label className="form-label">کارمزد تسویه فروش LTH (٪)</label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    step="0.01"
                    className="input mono"
                    value={treasuryForm.sell_fee_percent}
                    onChange={(e) => setTreasuryForm({ ...treasuryForm, sell_fee_percent: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">علت تغییر جهت ثبت در ممیزی <span className="req-star">*</span></label>
                <input
                  className="input"
                  required
                  minLength={3}
                  placeholder="مثلاً تنظیم سقف عرضه خزانه یا ضریب کارمزد"
                  value={treasuryForm.reason}
                  onChange={(e) => setTreasuryForm({ ...treasuryForm, reason: e.target.value })}
                />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={busy} style={{ background: '#ec1e79' }}>
                ذخیرهٔ تنظیمات خزانه در سرور
              </button>
            </form>
          ) : (
            <div className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}><Icon name="info2" size={17} /> سطح دسترسی واحد مالی</h3>
              <p className="muted">
                شما به عنوان <strong>کارشناس مالی</strong> دسترسی کامل به استعلام خزانه، تراز عرضه، سرچ پروتکل و بازرسی ۷ میزان کیف پول کاربران دارید. تغییر سقف عرضهٔ ۱۵٬۰۰۰٬۰۰۰ LTH یا ضریب کارمزد مختص مدیر کل است.
              </p>
            </div>
          )}
        </div>
      )}

      {subTab === 'treasury' && treasury && (
        <div className="two-col-layout" style={{ marginTop: 16 }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <h3 style={{ marginTop: 0, fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="tax" size={18} /> مالیات روی کارمزدهای دریافتی
            </h3>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.86rem' }}>
              روی هر کارمزد وصول‌شده ({treasury.collected_fee_lth_display_12} LTH) مالیات محاسبه و به‌صورت ردیف مستقل در خزانه ثبت می‌شود.
            </p>
            <div className="lth-kpi-grid" style={{ marginBottom: 12 }}>
              <div className="lth-kpi-box">
                <div className="kpi-label">مالیات تعلق‌گرفته</div>
                <div className="kpi-value mono" dir="ltr">{treasury.tax_accrued_lth_display_12}</div>
              </div>
              <div className="lth-kpi-box">
                <div className="kpi-label">تسویه‌شده</div>
                <div className="kpi-value mono" dir="ltr">{treasury.tax_settled_lth_display_12}</div>
              </div>
              <div className="lth-kpi-box">
                <div className="kpi-label">مانده مالیات</div>
                <div className="kpi-value mono" dir="ltr" style={{ color: BigInt(treasury.tax_outstanding_atoms || '0') > 0n ? '#b91c1c' : '#15803d' }}>
                  {treasury.tax_outstanding_lth_display_12}
                </div>
              </div>
            </div>
            {isAdmin ? (
              <div className="grid grid-2">
                <form onSubmit={handleSaveTaxRate}>
                  <div className="form-row">
                    <label className="form-label">نرخ مالیات (٪ از کارمزد)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      className="input mono"
                      required
                      value={taxForm.tax_percent}
                      onChange={(e) => setTaxForm({ ...taxForm, tax_percent: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">علت تغییر <span className="req-star">*</span></label>
                    <input
                      className="input"
                      required
                      minLength={3}
                      value={taxForm.reason}
                      onChange={(e) => setTaxForm({ ...taxForm, reason: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn btn-secondary btn-block" disabled={busy}>ثبت نرخ مالیات</button>
                </form>
                <form onSubmit={handleSettleTax}>
                  <div className="form-row">
                    <label className="form-label">مبلغ تسویه (LTH)</label>
                    <input
                      className="input mono"
                      required
                      dir="ltr"
                      placeholder={treasury.tax_outstanding_lth_display_12}
                      value={settleForm.lth_amount}
                      onChange={(e) => setSettleForm({ ...settleForm, lth_amount: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">مرجع پرداخت به خزانه</label>
                    <input
                      className="input"
                      required
                      minLength={3}
                      value={settleForm.reference}
                      onChange={(e) => setSettleForm({ ...settleForm, reference: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-block" disabled={busy} style={{ background: '#ec1e79' }}>
                    ثبت تسویهٔ مالیات
                  </button>
                </form>
              </div>
            ) : (
              <p className="muted" style={{ marginBottom: 0 }}>تغییر نرخ و ثبت تسویهٔ مالیات در اختیار مدیر کل است؛ کارشناس مالی فقط گزارش را می‌بیند.</p>
            )}
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <h3 style={{ marginTop: 0, fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="chart" size={18} /> پاداش کل بازار و ستون مهندسی معکوس
            </h3>
            {projection ? (
              <>
                <div className="lth-kpi-grid" style={{ marginBottom: 12 }}>
                  <div className="lth-kpi-box">
                    <div className="kpi-label">پاداش بازار (۲۴ساعته)</div>
                    <div className="kpi-value mono" dir="ltr">{projection.live_market_reward?.total_reward_lth_display_12}</div>
                  </div>
                  <div className="lth-kpi-box">
                    <div className="kpi-label">از این پاداش: استیک</div>
                    <div className="kpi-value mono" dir="ltr">{projection.live_market_reward?.staked_reward_lth_display_12}</div>
                  </div>
                  <div className="lth-kpi-box">
                    <div className="kpi-label">از این پاداش: قابل برداشت</div>
                    <div className="kpi-value mono" dir="ltr">{projection.live_market_reward?.withdrawable_reward_lth_display_12}</div>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>سناریو</th>
                        <th>میزان بازار</th>
                        <th>پاداش ۲۴ساعته</th>
                        <th>ارزش پاداش (ریال)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(projection.scenarios?.live_market || []).map((row) => (
                        <tr key={`lm-${row.stake_percent}`}>
                          <td>{row.stake_percent}٪ استیک / {row.withdrawable_percent}٪ آزاد</td>
                          <td className="mono" dir="ltr">{row.base_lth_display_12}</td>
                          <td className="mono" dir="ltr">{row.total_reward_lth_display_12}</td>
                          <td className="mono" dir="ltr">{formatNumber(row.total_reward_irr_exact)}</td>
                        </tr>
                      ))}
                      {(projection.scenarios?.full_supply || []).map((row) => (
                        <tr key={`fs-${row.stake_percent}`}>
                          <td>کل عرضه — {row.stake_percent}٪ استیک / {row.withdrawable_percent}٪ آزاد</td>
                          <td className="mono" dir="ltr">{row.base_lth_display_12}</td>
                          <td className="mono" dir="ltr">{row.total_reward_lth_display_12}</td>
                          <td className="mono" dir="ltr">{formatNumber(row.total_reward_irr_exact)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {projection.target_engineering && (
                  <p className="muted" style={{ fontSize: '0.84rem', marginBottom: 0 }}>
                    برای رسیدن به پاداش هدف {projection.target_engineering.requested_reward_lth_exact} LTH، میزان بازار لازم{' '}
                    <strong className="mono" dir="ltr">{projection.target_engineering.required_market_lth_display_12} LTH</strong>{' '}
                    ({projection.target_engineering.market_share_of_supply_percent}٪ از عرضه) —{' '}
                    {projection.target_engineering.achievable_within_supply ? 'در سقف عرضه ممکن است' : 'فراتر از سقف عرضه است'}.
                  </p>
                )}
                <form onSubmit={runProjection} className="grid grid-2" style={{ marginTop: 12 }}>
                  <div className="form-row" style={{ marginBottom: 0 }}>
                    <label className="form-label">سهم استیک (٪) — پیش‌فرض ۷۰</label>
                    <input
                      className="input mono"
                      type="number"
                      min="0"
                      max="100"
                      value={projectionForm.stake_percent}
                      onChange={(e) => setProjectionForm({ ...projectionForm, stake_percent: e.target.value })}
                    />
                  </div>
                  <div className="form-row" style={{ marginBottom: 0 }}>
                    <label className="form-label">پاداش هدف (LTH)</label>
                    <input
                      className="input mono"
                      dir="ltr"
                      value={projectionForm.target_reward_lth}
                      onChange={(e) => setProjectionForm({ ...projectionForm, target_reward_lth: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn btn-secondary" style={{ gridColumn: '1 / -1' }} disabled={projectionBusy}>
                    محاسبهٔ سناریو
                  </button>
                </form>
              </>
            ) : (
              <p className="muted">داده‌ای برای پیش‌بینی موجود نیست.</p>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 3: ADMIN REGULATOR & LOGO ==================== */}
      {subTab === 'settings' && isAdmin && (
        <div className="two-col-layout">
          <form onSubmit={handleSaveSettings} className="card">
            <h3 style={{ marginTop: 0, fontSize: '1.06rem' }}><Icon name="settings" size={17} /> ریگلاژ تناسب استیک / قابل برداشت و نرخ‌های موتور LTH</h3>

            <div style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div className="flex-between" style={{ marginBottom: 6 }}>
                <strong>ریگلاژ حد تناسب از ۱۰۰٪ پاداش روزانه</strong>
                <span className="badge badge-info">{form.stake_percent}٪ استیک + {form.withdrawable_percent}٪ آزاد = ۱۰۰٪</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                style={{ width: '100%', accentColor: '#ec1e79', marginBottom: 10 }}
                value={form.stake_percent}
                onChange={(e) => handleStakeChange(e.target.value)}
              />
              <div className="grid grid-2">
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label className="form-label">سهم استیک قفل‌شده (٪)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    className="input mono"
                    value={form.stake_percent}
                    onChange={(e) => handleStakeChange(e.target.value)}
                  />
                </div>
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label className="form-label">سهم پاداش قابل برداشت (٪)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    className="input mono"
                    value={form.withdrawable_percent}
                    onChange={(e) => handleWithdrawableChange(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-2">
              <div className="form-row">
                <label className="form-label">قیمت هر ۱.۰۰ LTH به ریال <span className="req-star">*</span></label>
                <input
                  className="input mono"
                  required
                  value={form.price_irr}
                  onChange={(e) => setForm({ ...form, price_irr: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label className="form-label">قفل استیک پس از خرید (روز) <span className="req-star">*</span></label>
                <input
                  type="number"
                  min="1"
                  max="36500"
                  className="input mono"
                  required
                  value={form.lockup_days}
                  onChange={(e) => setForm({ ...form, lockup_days: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row">
              <label className="form-label">پاداش ۲۴ ساعته به ازای کوچک‌ترین واحد (۰.۰۰۰۰۰۰۰۱ LTH)</label>
              <input
                className="input mono"
                required
                value={form.reward_per_min_unit_lth}
                onChange={(e) => setForm({ ...form, reward_per_min_unit_lth: e.target.value })}
              />
            </div>

            <div className="form-row">
              <label className="form-label">پکیج‌های خرید به تومان (جداشده با کاما)</label>
              <input
                className="input mono"
                required
                value={form.packages_csv}
                onChange={(e) => setForm({ ...form, packages_csv: e.target.value })}
              />
            </div>

            <div className="form-row">
              <label className="form-label">علت تغییر جهت ثبت در سابقهٔ ممیزی <span className="req-star">*</span></label>
              <input
                className="input"
                required
                minLength={3}
                placeholder="مثلاً تنظیم ریگلاژ استیک طبق مصوبه مدیریت"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              ذخیرهٔ تنظیمات و ریگلاژ در سرور
            </button>
          </form>

          <form onSubmit={handleLogoUpload} className="card">
            <h3 style={{ marginTop: 0, fontSize: '1.06rem' }}><Icon name="image2" size={17} /> بارگذاری تصویر لوگوی ال تی اچ (LTH Logo)</h3>
            <p className="muted" style={{ fontSize: '0.86rem' }}>
              تصویر انتخاب‌شده بلافاصله در «نوار بالای کیف پول»، «خزانه» و «صفحهٔ محاسبه‌گر ماین» جایگزین می‌شود.
            </p>

            {cfg && (
              <div className="flex-gap" style={{ padding: 14, background: 'var(--surface-alt)', borderRadius: 12, marginBottom: 14 }}>
                <img
                  src={cfg.logo_path}
                  alt="پیش‌نمایش لوگوی فعلی LTH"
                  style={{ width: 68, height: 68, borderRadius: 16, border: '2px solid #ec1e79', objectFit: 'cover', background: '#fff' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>لوگوی فعال فعلی کوین LTH</div>
                  <div className="mono muted" style={{ fontSize: '0.78rem' }}>{cfg.logo_path}</div>
                  <div className="muted" style={{ fontSize: '0.78rem' }}>آخرین بروزرسانی: {formatDateTime(cfg.updated_at)}</div>
                </div>
              </div>
            )}

            <div className="form-row">
              <label className="form-label">انتخاب فایل تصویر جدید لوگو <span className="req-star">*</span></label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="input"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={busy || !logoFile}>
              آپلود و اعمال تصویر لوگوی LTH
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
