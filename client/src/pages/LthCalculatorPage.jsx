import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch, newIdempotencyKey } from '../lib/api';
import { addCommas, computeLocalMetrics, normalizeNumericInput } from '../lib/lthMath';
import { useAuth } from '../context/AuthContext';
import { ErrorState, FieldErrorsList, LoadingState } from '../components/StateViews';
import { Icon } from '../components/Icon';

export function LthCalculatorPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activeMode, setActiveMode] = useState('lth'); // 'lth' | 'irr'
  const [irrInput, setIrrInput] = useState('4,840,000,000');
  const [lthInput, setLthInput] = useState('1');
  const [selectedPkgToman, setSelectedPkgToman] = useState(null);

  const [buyBusy, setBuyBusy] = useState(false);
  const [buyErr, setBuyErr] = useState(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/lth/config');
      setConfig(res.config);
      setIrrInput(addCommas(res.config.price_irr));
      setLthInput('1');
      setActiveMode('lth');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const metrics = useMemo(() => {
    if (!config) return null;
    const rawValue = activeMode === 'irr' ? irrInput : lthInput;
    return computeLocalMetrics({ mode: activeMode, rawValue, config });
  }, [config, activeMode, irrInput, lthInput]);

  const handleIrrChange = (val) => {
    setSelectedPkgToman(null);
    setActiveMode('irr');
    setIrrInput(val);
    if (config) {
      const m = computeLocalMetrics({ mode: 'irr', rawValue: val, config });
      if (m && m.valid) {
        setLthInput(m.lthExact);
      }
    }
  };

  const handleLthChange = (val) => {
    setSelectedPkgToman(null);
    setActiveMode('lth');
    setLthInput(val);
    if (config) {
      const m = computeLocalMetrics({ mode: 'lth', rawValue: val, config });
      if (m && m.valid) {
        setIrrInput(m.irrCommas);
      }
    }
  };

  // Tapping a Toman package immediately populates its exact IRR price in the IRR bar ("با لمس پکیج در نوار به ریال قابل رویت است")
  const handleSelectPackage = (pkg) => {
    setBuyErr(null);
    setSelectedPkgToman(pkg.amount_toman);
    setActiveMode('irr');
    setIrrInput(pkg.amount_irr_formatted);
    setLthInput(pkg.lth_exact);
  };

  const applyPresetLth = (presetLth) => {
    setBuyErr(null);
    handleLthChange(presetLth);
  };

  const handleBuySelectedOrCustom = async () => {
    if (!user) {
      navigate('/auth?next=/lth-calculator');
      return;
    }
    if (!metrics || !metrics.valid) return;

    let amountToman = selectedPkgToman;
    if (!amountToman) {
      const rawIrr = normalizeNumericInput(metrics.irrExact);
      if (!/^\d+$/.test(rawIrr)) {
        setBuyErr({ message: 'برای خرید مستقیم از درگاه، مبلغ باید مضرب صحیح تومان (حداقل ۱۰٬۰۰۰ تومان معادل ۱۰۰٬۰۰۰ ریال) باشد.' });
        return;
      }
      amountToman = Math.floor(Number(BigInt(rawIrr) / 10n));
    }

    if (amountToman < 10000) {
      setBuyErr({ message: 'حداقل مبلغ خرید پکیج یا سفارش LTH برابر ۱۰٬۰۰۰ تومان (۱۰۰٬۰۰۰ ریال) است.' });
      return;
    }

    setBuyBusy(true);
    setBuyErr(null);
    try {
      const res = await apiFetch('/lth/purchases', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey('lth'),
        body: {
          amount_toman: amountToman,
          package_toman: selectedPkgToman || null
        }
      });
      window.location.href = res.payment.pay_url;
    } catch (err) {
      setBuyErr(err);
      setBuyBusy(false);
    }
  };

  if (loading) return <LoadingState label="در حال بارگذاری موتور محاسبهٔ دقیق LTH / IRR..." />;
  if (error) return <ErrorState error={error} onRetry={loadConfig} />;
  if (!config) return null;

  const b = config.benchmarks;

  return (
    <div className="lth-shell">
      <div className="lth-calc-card">
        {/* Top Pink "ماین" Banner */}
        <div className="lth-calc-banner">
          <Link
            to="/wallet"
            style={{ color: '#fff', fontWeight: 800, fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <span><Icon name="grid" size={18} /></span>
            <span>کیف پول LTH</span>
          </Link>
          <div className="lth-calc-brand">ماین</div>
          <img
            src={config.logo_path}
            alt="لوگوی LTH"
            style={{ width: 38, height: 38, borderRadius: 10, background: '#fff', objectFit: 'cover' }}
          />
        </div>

        <div className="lth-calc-body">
          {/* Input 1: قیمت IRR */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="calc-irr-input" className="lth-calc-label">
              قیمت IRR <span className="muted" style={{ fontWeight: 600, fontSize: '0.8rem' }}>(به ریال — با لمس هر پکیج، معادل ریالی آن در این نوار نمایش داده می‌شود)</span>
            </label>
            <input
              id="calc-irr-input"
              type="text"
              inputMode="decimal"
              className="lth-calc-input"
              value={irrInput}
              onChange={(e) => handleIrrChange(e.target.value)}
              placeholder="4,840,000,000"
            />
          </div>

          {/* Input 2: مقدار LOTHCOIN */}
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="calc-lth-input" className="lth-calc-label">
              مقدار LOTHCOIN <span className="muted" style={{ fontWeight: 600, fontSize: '0.8rem' }}>(پشتیبانی از ۱.۰۰ تا ۰.۰۰۰۰۰۰۰۰۰۰۰۱ LTH بدون خطای اعشار)</span>
            </label>
            <input
              id="calc-lth-input"
              type="text"
              inputMode="decimal"
              className="lth-calc-input"
              value={lthInput}
              onChange={(e) => handleLthChange(e.target.value)}
              placeholder="1.00000000"
            />

            {/* One-tap verification presets for exact formulas */}
            <div className="flex-gap" style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: '0.78rem' }}>آزمون سریع مقادیر مرجع:</span>
              <button type="button" className="btn btn-secondary btn-sm mono" onClick={() => applyPresetLth('1')}>
                1.00 LTH
              </button>
              <button type="button" className="btn btn-secondary btn-sm mono" onClick={() => applyPresetLth('0.00000001')}>
                0.00000001 LTH
              </button>
              <button type="button" className="btn btn-secondary btn-sm mono" onClick={() => applyPresetLth('0.000000000001')}>
                0.000000000001 LTH (= 0.00484 IRR)
              </button>
            </div>
          </div>

          {/* Packages Section: پکیج LTH به تومان */}
          <div style={{ marginBottom: 18 }}>
            <div className="flex-between">
              <span className="lth-calc-label" style={{ marginBottom: 0 }}>پکیج LTH به تومان</span>
              <span className="muted" style={{ fontSize: '0.78rem' }}>لمس هر پکیج = نمایش به ریال در نوار بالا + محاسبهٔ موازین</span>
            </div>

            <div className="lth-pkg-grid">
              {(config.packages || []).map((pkg, idx) => (
                <button
                  key={pkg.amount_toman}
                  type="button"
                  className={`lth-pkg-btn lth-pkg-shade-${Math.min(idx, 4)} ${selectedPkgToman === pkg.amount_toman ? 'selected' : ''}`}
                  onClick={() => handleSelectPackage(pkg)}
                >
                  {addCommas(String(pkg.amount_toman))}
                </button>
              ))}
            </div>
          </div>

          {buyErr && (
            <>
              <div className="alert-inline error"><Icon name="alert" size={14} /> {buyErr.message}</div>
              <FieldErrorsList details={buyErr.details} />
            </>
          )}

          {/* Purchase CTA */}
          <button
            type="button"
            className="lth-filled-btn"
            disabled={buyBusy || !metrics || !metrics.valid}
            onClick={handleBuySelectedOrCustom}
          >
            {buyBusy
              ? 'در حال ثبت سفارش و انتقال به درگاه آزمایشی...'
              : selectedPkgToman
                ? `خرید پکیج ${addCommas(String(selectedPkgToman))} تومان (${addCommas(String(selectedPkgToman * 10))} ریال) و افزودن به حجم پایه`
                : 'خرید مقدار محاسبه‌شده و افزودن به حجم پایه (درگاه آزمایشی)'}
          </button>
        </div>
      </div>

      {/* Live Calculation Breakdown ("محاسبه تمام موازین نسبت به عدد وارده") */}
      <section className="card" style={{ borderColor: '#fbcfe8' }}>
        <div className="flex-between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: '1.08rem', color: '#9d174d' }}>
            محاسبهٔ دقیق تمام موازین نسبت به عدد وارده
          </h2>
          <span className="badge badge-info">ریگلاژ فعال: {config.stake_percent}٪ استیک / {config.withdrawable_percent}٪ قابل برداشت</span>
        </div>

        {!metrics || !metrics.valid ? (
          <div className="alert-inline error">لطفاً یک مقدار عددی معتبر در کادر ریال یا LOTHCOIN وارد نمایید.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                <tr>
                  <td><strong>قیمت دقیق به ریال (IRR)</strong></td>
                  <td className="mono">{metrics.irrCommas} IRR</td>
                </tr>
                <tr>
                  <td><strong>معادل به تومان</strong></td>
                  <td className="mono">{metrics.tomanCommas} تومان</td>
                </tr>
                <tr>
                  <td><strong>مقدار توکن (نمایش استاندارد ۸ رقم اعشار)</strong></td>
                  <td className="mono">LTH {metrics.lthDisplay8}</td>
                </tr>
                <tr>
                  <td><strong>مقدار دقیق محاسباتی داخلی (حداکثر ۱۶ رقم اعشار)</strong></td>
                  <td className="mono">{metrics.lthExact} LTH</td>
                </tr>
                <tr>
                  <td><strong>کل پاداش روزانه (هر ۲۴ ساعت واریز از سمت سرور)</strong></td>
                  <td className="mono">
                    {metrics.reward24h.totalLthExact} LTH = {metrics.reward24h.totalIrrCommas} IRR ({metrics.reward24h.totalTomanCommas} تومان)
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>سهم استیک روزانه ({config.stake_percent}٪ — Proof of Stake)</strong>
                    <div className="muted" style={{ fontSize: '0.77rem' }}>قابل برداشت {config.lockup_days.toLocaleString('fa-IR')} روز بعد از زمان خرید</div>
                  </td>
                  <td className="mono">
                    {metrics.reward24h.stakedLthExact} LTH ({metrics.reward24h.stakedIrrCommas} IRR)
                  </td>
                </tr>
                <tr>
                  <td><strong>حجم پاداش قابل برداشت روزانه ({config.withdrawable_percent}٪)</strong></td>
                  <td className="mono">
                    {metrics.reward24h.withdrawableLthExact} LTH ({metrics.reward24h.withdrawableIrrCommas} IRR)
                  </td>
                </tr>
                <tr>
                  <td><strong>جمع کل پس از ۲۴ ساعت (حجم پایه + کل پاداش)</strong></td>
                  <td className="mono">
                    {metrics.reward24h.after24hTotalLthExact} LTH ({metrics.reward24h.after24hTotalIrrCommas} IRR)
                  </td>
                </tr>
                <tr>
                  <td><strong>جمع قابل برداشت پس از ۲۴ ساعت (حجم پایه + {config.withdrawable_percent}٪ پاداش)</strong></td>
                  <td className="mono">
                    {metrics.reward24h.after24hWithdrawableLthExact} LTH ({metrics.reward24h.after24hWithdrawableIrrCommas} IRR)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Reference Benchmark & Accounting Health Card ("نشان سلامت و همخوانی با حسابداری ما") */}
      <section className="card" style={{ background: '#f0fdf4', borderColor: '#86efac' }}>
        <div className="flex-between" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: '#166534' }}>
            <Icon name="check" size={14} /> نشان سلامت محاسباتی و همخوانی با دفتر حسابداری (مرجع ۱.۰۰ LTH در ۲۴ ساعت)
          </h3>
          <span className="badge badge-ok">دقت عدد صحیح BigInt</span>
        </div>
        <div style={{ fontSize: '0.88rem', color: '#14532d' }}>
          <div>• ارزش پایهٔ هر <strong>1.00 LTH</strong> (صد میلیون واحد <span className="mono">0.00000001</span>): <strong className="mono">{config.price_irr_formatted} ریال</strong></div>
          <div>• پاداش ۲۴ ساعتهٔ کوچک‌ترین واحد توکن (<span className="mono">{b.min_token_unit_lth} LTH</span>): <strong className="mono">{b.min_token_unit_24h_reward_lth} LTH</strong></div>
          <div>• پاداش ۲۴ ساعتهٔ <strong>1.00 LTH</strong>: <strong className="mono">{b.one_lth_24h_reward_lth} LTH</strong> معادل <strong className="mono">{addCommas(b.one_lth_24h_reward_irr)} ریال</strong> (<span className="mono">{addCommas(b.one_lth_24h_reward_toman)} تومان</span> در روز)</div>
          <div>• ریزترین واحد آزمایشی ماشین‌حساب (<span className="mono">{b.pico_unit_lth} LTH</span>): دقیقاً برابر با <strong className="mono">{b.pico_unit_irr} IRR</strong></div>
        </div>
      </section>
    </div>
  );
}
