import React, { useState } from 'react';
import { addCommas } from '../lib/lthMath';

function EyeIcon({ hidden }) {
  if (hidden) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * Reusable Pink LTH Wallet Card (7 exact approved titles + Eye visibility toggle + 12-decimal smart formatting).
 * When `wallet` is null (logged out on Home), renders honest `—` placeholders instead of fake zeros.
 */
export function LthWalletCard({
  wallet,
  config,
  onSelectSheba,
  showExactToggle = true
}) {
  const [hideBalances, setHideBalances] = useState(() => {
    try {
      return localStorage.getItem('cm_hide_balances') === '1';
    } catch {
      return false;
    }
  });
  const [showFullSerial, setShowFullSerial] = useState(false);
  const [showExactDigits, setShowExactDigits] = useState(false);

  const toggleMask = () => {
    setHideBalances((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cm_hide_balances', next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const stakePct = config?.stake_percent ?? 70;
  const withdrawPct = config?.withdrawable_percent ?? 30;
  const lockupDays = config?.lockup_days ?? 3285;

  const renderLthVal = (disp12, exact) => {
    if (!wallet) return 'LTH —';
    if (hideBalances) return 'LTH ••••••••';
    return `LTH ${showExactDigits ? exact : disp12}`;
  };

  const renderIrrVal = (formattedFloor, exact) => {
    if (!wallet) return <span className="mono">—</span>;
    if (hideBalances) return <span className="mono">••••••••</span>;
    return <span className="mono">{showExactDigits ? addCommas(exact) : formattedFloor}</span>;
  };

  return (
    <section className="lth-wallet-card" aria-label="کیف پول LTH و ۷ عنوان موجودی">
      <div className="lth-wallet-watermark" aria-hidden="true">LTH</div>

      <div className="lth-wallet-dots-row">
        <div className="flex-gap" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className="lth-eye-btn"
            onClick={toggleMask}
            aria-label={hideBalances ? 'نمایش موجودی‌ها' : 'مخفی‌کردن موجودی‌ها'}
            title={hideBalances ? 'نمایش موجودی‌ها' : 'مخفی‌کردن موجودی‌ها'}
          >
            <EyeIcon hidden={hideBalances} />
          </button>
          <div className="lth-wallet-dots">
            {wallet && showFullSerial && !hideBalances ? wallet.wallet_serial : '••••  ••••  ••••  ••••'}
          </div>
        </div>

        <div className="flex-gap">
          {wallet && (
            <button
              type="button"
              className="lth-serial-btn"
              onClick={() => setShowFullSerial((v) => !v)}
            >
              {showFullSerial ? 'مخفی‌کردن شناسه' : 'شناسه کیف پول'}
            </button>
          )}
          {wallet && showExactToggle && (
            <button
              type="button"
              className="lth-serial-btn"
              onClick={() => setShowExactDigits((v) => !v)}
            >
              {showExactDigits ? 'نمایش استاندارد (۱۲ رقم)' : 'ریز ۱۶ رقمی'}
            </button>
          )}
        </div>
      </div>

      <div className="lth-wallet-rows">
        {/* 1. حجم پایه */}
        <div className="lth-wallet-row">
          <div>
            <div className="lth-row-title">حجم پایه</div>
            <div className="lth-row-sub">فقط خریدهای اولیه</div>
          </div>
          <div className="lth-row-val">
            {renderLthVal(wallet?.base_lth_display_12 || wallet?.base_lth_display_8, wallet?.base_lth_exact)}
          </div>
        </div>

        {/* 2. استیک */}
        <div className="lth-wallet-row">
          <div>
            <div className="lth-row-title">استیک</div>
            <div className="lth-row-sub">{stakePct}٪ پاداش (قابل برداشت {lockupDays.toLocaleString('fa-IR')} روز پس از خرید)</div>
          </div>
          <div className="lth-row-val">
            {renderLthVal(wallet?.staked_lth_display_12 || wallet?.staked_lth_display_8, wallet?.staked_lth_exact)}
          </div>
        </div>

        {/* 3. حجم پاداش قابل برداشت LTH */}
        <div className="lth-wallet-row">
          <div>
            <div className="lth-row-title">حجم پاداش قابل برداشت LTH</div>
            <div className="lth-row-sub">{withdrawPct}٪ از حجم پاداش دریافتی</div>
          </div>
          <div className="lth-row-val">
            {renderLthVal(wallet?.withdrawable_reward_lth_display_12 || wallet?.withdrawable_reward_lth_display_8, wallet?.withdrawable_reward_lth_exact)}
          </div>
        </div>

        {/* 4. جمع ال تی اچ قابل برداشت */}
        <div className="lth-wallet-row">
          <div>
            <div className="lth-row-title">جمع ال تی اچ قابل برداشت</div>
            <div className="lth-row-sub">حجم پایه + {withdrawPct}٪ پاداش دریافتی</div>
          </div>
          <div className="lth-row-val">
            {renderLthVal(wallet?.total_withdrawable_lth_display_12 || wallet?.total_withdrawable_lth_display_8, wallet?.total_withdrawable_lth_exact)}
          </div>
        </div>

        {/* 5. قابل برداشت (به ریال) + دکمه برداشت شبا */}
        <div className="lth-wallet-row">
          <div className="lth-row-title-group">
            <div>
              <div className="lth-row-title">قابل برداشت</div>
              <div className="lth-row-sub">پایه به ریال + {withdrawPct}٪ پاداش به ریال</div>
            </div>
            {onSelectSheba && (
              <button
                type="button"
                className="lth-sheba-pill"
                onClick={onSelectSheba}
              >
                برداشت شبا
              </button>
            )}
          </div>
          <div className="lth-row-val" dir="rtl">
            {renderIrrVal(wallet?.withdrawable_irr_formatted, wallet?.withdrawable_irr_exact)} ریال
          </div>
        </div>

        {/* 6. جمع ریال */}
        <div className="lth-wallet-row">
          <div>
            <div className="lth-row-title">جمع ریال</div>
            <div className="lth-row-sub">جمع پایه و کل پاداش</div>
          </div>
          <div className="lth-row-val" dir="rtl">
            {renderIrrVal(wallet?.total_irr_formatted, wallet?.total_irr_exact)} ریال
          </div>
        </div>

        {/* 7. جمع ال تی اچ */}
        <div className="lth-wallet-row">
          <div>
            <div className="lth-row-title">جمع ال تی اچ</div>
            <div className="lth-row-sub">جمع کل LTH در کیف پول</div>
          </div>
          <div className="lth-row-val">
            {renderLthVal(wallet?.total_lth_display_12 || wallet?.total_lth_display_8, wallet?.total_lth_exact)}
          </div>
        </div>

        {wallet && wallet.reserved_atoms !== '0' && (
          <div className="lth-wallet-row" style={{ background: 'rgba(0,0,0,0.14)', borderRadius: 10, padding: '8px 10px', marginTop: 6 }}>
            <div>
              <div className="lth-row-title">در انتظار تسویهٔ شبا</div>
              <div className="lth-row-sub">رزروشده جهت بررسی واحد مالی</div>
            </div>
            <div className="lth-row-val" dir="rtl">
              {hideBalances ? <span className="mono">••••••••</span> : <span className="mono">{wallet.reserved_irr_formatted}</span>} ریال
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
