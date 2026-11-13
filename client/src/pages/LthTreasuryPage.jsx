import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { LthTopBar } from '../components/LthTopBar';
import { ErrorState, LoadingState } from '../components/StateViews';
import { Icon } from '../components/Icon';

/**
 * Protocol Treasury Page ("خزانه" — 15,000,000 LTH)
 * Renders the 5 approved Treasury rows:
 *   1. دارایی
 *   2. مقدار بازار
 *   3. جمع بازگشت استیک
 *   4. جمع بازگشت پایه
 *   5. جمع کارمزد
 * Note: "جمع پرداخت" and "پاداش ماین" are intentionally omitted per approved design.
 */
export function LthTreasuryPage() {
  const [treasury, setTreasury] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hideValues, setHideValues] = useState(false);

  const loadTreasury = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/lth/treasury');
      setTreasury(res.treasury);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTreasury();
  }, [loadTreasury]);

  const maskOr = (val) => (hideValues ? 'LTH ••••••••' : `LTH ${val}`);

  return (
    <div className="lth-shell">
      <LthTopBar />

      {loading && <LoadingState label="در حال استعلام مستقیم وضعیت خزانهٔ پروتکل از سرور..." />}
      {!loading && error && <ErrorState error={error} onRetry={loadTreasury} />}

      {!loading && !error && treasury && (
        <>
          <section className="lth-treasury-card" aria-label="خزانه پروتکل LTH">
            <div className="lth-wallet-watermark" aria-hidden="true">LTH</div>

            {/* Header: خزانه | LTH + Coin | Eye Toggle */}
            <div className="lth-treasury-header">
              <div className="flex-gap" style={{ alignItems: 'center' }}>
                <button
                  type="button"
                  className="lth-eye-btn"
                  onClick={() => setHideValues((v) => !v)}
                  aria-label={hideValues ? 'نمایش مقادیر خزانه' : 'مخفی‌سازی مقادیر خزانه'}
                  title={hideValues ? 'نمایش مقادیر خزانه' : 'مخفی‌سازی مقادیر خزانه'}
                >
                  <Icon name={hideValues ? 'eyeOff' : 'eye'} size={16} />
                </button>
                <span className="lth-treasury-title">خزانه</span>
              </div>

              <div className="lth-treasury-coin-badge" dir="ltr">
                <img
                  src={treasury.logo_path || '/uploads/lth-logo-default.svg'}
                  alt="لوگوی LTH"
                  style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', background: '#fff' }}
                />
                <span>LTH</span>
              </div>
            </div>

            {/* Row 1 (Hero): دارایی */}
            <div className="lth-treasury-hero-row">
              <div className="lth-treasury-hero-label">دارایی</div>
              <div className="lth-treasury-hero-value" dir="ltr">
                {hideValues ? 'LTH ••••••••••' : `LTH ${treasury.asset_lth_headline}`}
              </div>
            </div>

            <div className="lth-treasury-divider" />

            {/* Rows 2-5: مقدار بازار / جمع بازگشت استیک / جمع بازگشت پایه / جمع کارمزد */}
            <div className="lth-wallet-rows">
              <div className="lth-wallet-row">
                <div>
                  <div className="lth-row-title">مقدار بازار</div>
                  <div className="lth-row-sub">کل LTH در گردش کیف پول کاربران ({treasury.market_breakdown.wallet_count.toLocaleString('fa-IR')} کیف پول)</div>
                </div>
                <div className="lth-row-val">{maskOr(treasury.market_lth_display_12)}</div>
              </div>

              <div className="lth-wallet-row">
                <div>
                  <div className="lth-row-title">جمع بازگشت استیک</div>
                  <div className="lth-row-sub">استیک‌های آزادشده که تسویه و به خزانه بازگشته‌اند</div>
                </div>
                <div className="lth-row-val">{maskOr(treasury.returned_stake_lth_display_12)}</div>
              </div>

              <div className="lth-wallet-row">
                <div>
                  <div className="lth-row-title">جمع بازگشت پایه</div>
                  <div className="lth-row-sub">حجم پایهٔ فروش‌رفته و بازگشتی به خزانه</div>
                </div>
                <div className="lth-row-val">{maskOr(treasury.returned_base_lth_display_12)}</div>
              </div>

              <div className="lth-wallet-row">
                <div>
                  <div className="lth-row-title">جمع کارمزد</div>
                  <div className="lth-row-sub">
                    نرخ فعلی انتقال: {treasury.transfer_fee_percent}٪ | فروش: {treasury.sell_fee_percent}٪
                  </div>
                </div>
                <div className="lth-row-val">{maskOr(treasury.collected_fee_lth_display_12)}</div>
              </div>
            </div>
          </section>

          {/* Supply Conservation Verification Card */}
          <div className="card" style={{ borderRight: `4px solid ${treasury.conservation_ok ? '#15803d' : '#b91c1c'}` }}>
            <div className="flex-between" style={{ marginBottom: 8 }}>
              <strong style={{ color: treasury.conservation_ok ? '#15803d' : '#b91c1c' }}>
                <Icon name={treasury.conservation_ok ? 'check' : 'alert'} size={14} />
                {treasury.conservation_label}
              </strong>
              <button type="button" className="btn btn-secondary btn-sm" onClick={loadTreasury}><Icon name="refresh" size={16} /> استعلام مجدد</button>
            </div>
            <div className="grid grid-2" style={{ fontSize: '0.86rem' }}>
              <div>سقف کل عرضهٔ پروتکل: <strong className="mono" dir="ltr">LTH {treasury.total_supply_lth_headline}</strong></div>
              <div>معادل ریالی بازار در گردش: <strong className="mono">{treasury.market_irr_formatted}</strong> ریال</div>
              <div>حجم پایه در کیف پول‌ها: <strong className="mono" dir="ltr">LTH {treasury.market_breakdown.base_lth_display_12}</strong></div>
              <div>استیک قفل‌شده در کیف پول‌ها: <strong className="mono" dir="ltr">LTH {treasury.market_breakdown.staked_lth_display_12}</strong></div>
              <div>پاداش قابل برداشت کاربران: <strong className="mono" dir="ltr">LTH {treasury.market_breakdown.withdrawable_lth_display_12}</strong></div>
              <div>در رزرو تسویه شبا: <strong className="mono" dir="ltr">LTH {treasury.market_breakdown.reserved_lth_display_12}</strong></div>
            </div>
          </div>

          <div className="flex-gap" style={{ justifyContent: 'center', marginTop: 8 }}>
            <Link to="/wallet" className="lth-filled-btn" style={{ maxWidth: 260 }}><Icon name="coin" size={16} /> ورود به کیف پول من</Link>
            <Link to="/lth-calculator" className="lth-outline-btn pink-text" style={{ maxWidth: 260 }}><Icon name="calculator" size={16} /> ماشین‌حساب و خرید پکیج</Link>
          </div>
        </>
      )}
    </div>
  );
}
