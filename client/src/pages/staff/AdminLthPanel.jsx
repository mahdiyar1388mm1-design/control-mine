import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
import { ErrorState, FieldErrorsList, LoadingState } from '../../components/StateViews';

export function AdminLthPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);

  const [cfg, setCfg] = useState(null);
  const [recData, setRecData] = useState(null);

  const [form, setForm] = useState({
    price_irr: '4840000000',
    reward_per_min_unit_lth: '0.000000000034',
    stake_percent: 70,
    withdrawable_percent: 30,
    lockup_days: 3285,
    packages_csv: '22000000, 11000000, 8000000, 1000000, 220000',
    reason: ''
  });

  const [logoFile, setLogoFile] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, rRes] = await Promise.all([
        apiFetch('/lth/config'),
        apiFetch('/admin/lth/reconciliation')
      ]);
      const c = cRes.config;
      setCfg(c);
      setRecData(rRes);
      setForm({
        price_irr: c.price_irr,
        reward_per_min_unit_lth: c.reward_per_min_unit_lth,
        stake_percent: c.stake_percent,
        withdrawable_percent: c.withdrawable_percent,
        lockup_days: c.lockup_days,
        packages_csv: (c.packages_toman || []).join(', '),
        reason: ''
      });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Coupled 100% Regulator ("ریگلاژ حد تناسب از ۱۰۰ درصد مثلا ۷۱ به ۲۹")
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
      setMsg('تصویر لوگوی LTH در سرور بارگذاری شد و هم‌اکنون در نوار بالا و ماشین‌حساب نمایش داده می‌شود.');
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

  if (loading) return <LoadingState label="در حال بارگذاری تنظیمات موتور LTH و تطبیق کل دفتر حسابداری..." />;
  if (error) return <ErrorState error={error} onRetry={loadAll} />;

  const rec = recData?.reconciliation;
  const sched = recData?.scheduler;

  return (
    <div>
      {msg && <div className="alert-inline ok">✓ {msg}</div>}
      {opErr && (
        <>
          <div className="alert-inline error">⚠️ {opErr.message}</div>
          <FieldErrorsList details={opErr.details} />
        </>
      )}

      {/* Global Reconciliation & Multi-Server Cluster Health */}
      {rec && (
        <div className="card" style={{ background: rec.healthy ? '#f0fdf4' : '#fef2f2', borderColor: rec.healthy ? '#86efac' : '#fca5a5' }}>
          <div className="flex-between" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: rec.healthy ? '#166534' : '#991b1b' }}>
              {rec.healthy ? '✓ نشان سلامت و همخوانی کل دفتر حسابداری LTH' : '⚠️ هشدار عدم تطابق دفتر حسابداری'}
            </h3>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={handleManualSettle}>
              ⏱️ اجرای دستی پایش ۲۴ ساعتهٔ سرور
            </button>
          </div>
          <div className="grid grid-3" style={{ fontSize: '0.85rem' }}>
            <div>وضعیت تطبیق: <strong>{rec.status_label}</strong></div>
            <div>کیف پول‌های بررسی‌شده: <strong>{formatNumber(rec.checked_wallets)}</strong></div>
            <div>ردیف‌های دفتر کل: <strong>{formatNumber(rec.checked_ledger_entries)}</strong></div>
            <div>چرخه‌های ۲۴ساعته ثبت‌شده: <strong>{formatNumber(rec.checked_reward_cycles)}</strong></div>
            <div>کل LTH در گردش: <strong className="mono">{rec.totals.circulating_total_lth_exact} LTH</strong></div>
            <div>سرور دارندهٔ قفل توزیع‌شده: <span className="mono">{sched?.lease?.holder_instance_id || sched?.current_server_instance_id}</span></div>
          </div>
          <div style={{ marginTop: 8, fontSize: '0.84rem', color: '#14532d' }}>
            شاخص مرجع ۱.۰۰ LTH در ۲۴ ساعت: <strong className="mono">{rec.benchmark_1_lth_24h.reward_24h_lth} LTH</strong> ={' '}
            <strong className="mono">{rec.benchmark_1_lth_24h.reward_24h_irr_formatted} ریال</strong> ({rec.benchmark_1_lth_24h.reward_24h_toman_formatted} تومان)
          </div>
        </div>
      )}

      <div className="two-col-layout">
        {/* Regulator & Engine Parameters Form */}
        <form onSubmit={handleSaveSettings} className="card">
          <h3 style={{ marginTop: 0, fontSize: '1.06rem' }}>⚙️ ریگلاژ تناسب استیک / قابل برداشت و نرخ‌های موتور LTH</h3>

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

        {/* Uploadable LTH Logo Card ("تصویر لوگوی ال تی اچ آپلودی است") */}
        <form onSubmit={handleLogoUpload} className="card">
          <h3 style={{ marginTop: 0, fontSize: '1.06rem' }}>🖼️ بارگذاری تصویر لوگوی ال تی اچ (LTH Logo)</h3>
          <p className="muted" style={{ fontSize: '0.86rem' }}>
            تصویر انتخاب‌شده بلافاصله در «نوار بالای کیف پول» و «صفحهٔ محاسبه‌گر ماین» جایگزین می‌شود (فرمت‌های مجاز: PNG، JPG، WEBP، GIF یا SVG ایمن).
          </p>

          {cfg && (
            <div className="flex-gap" style={{ padding: 14, background: 'var(--surface-alt)', borderRadius: 12, marginBottom: 14 }}>
              <img
                src={cfg.logo_path}
                alt="پیش‌نمایش لوگوی فعلی LTH"
                style={{ width: 68, height: 68, borderRadius: 16, border: '2px solid #ec1e79', objectFit: 'cover', background: '#fff' }}
              />
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>لوگوی فعال فعلی در نوار بالا</div>
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
    </div>
  );
}
