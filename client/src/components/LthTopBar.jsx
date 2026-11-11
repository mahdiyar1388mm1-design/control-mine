import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatDotGrouped } from '../lib/lthMath';

/**
 * Separate LTH / IRR Top Ticker Bar ("نوار بالا باید جدا از کیف پول است و بعد از لمس آن به صفحه زیر منتقل میشویم").
 * - Visually separated from the pink wallet card.
 * - Displays live server LTH price in IRR + POS indicator on the left,
 *   and LTH / IRR + LOTH COIN + Admin-uploadable LTH logo on the right.
 * - Clicking/tapping anywhere on the bar navigates to /lth-calculator.
 */
export function LthTopBar({ config: propConfig }) {
  const [fetchedConfig, setFetchedConfig] = useState(null);

  useEffect(() => {
    if (propConfig) return;
    let alive = true;
    apiFetch('/lth/config')
      .then((res) => {
        if (alive) setFetchedConfig(res.config);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [propConfig]);

  const cfg = propConfig || fetchedConfig;
  const priceDisplay = cfg ? formatDotGrouped(cfg.price_irr) : '...';
  const logoSrc = cfg?.logo_path || '/uploads/lth-logo-default.svg';

  return (
    <Link
      to="/lth-calculator"
      className="lth-top-ticker-bar"
      aria-label="نوار نرخ لحظه‌ای LTH به ریال — لمس جهت ورود به موتور محاسبه‌گر و خرید پکیج LTH"
      title="لمس کنید تا وارد موتور محاسبه‌گر ریال و پکیج‌های LOTH COIN شوید"
    >
      <div className="lth-ticker-right">
        <img
          src={logoSrc}
          alt="لوگوی LTH"
          className="lth-ticker-logo"
        />
        <div className="lth-ticker-brand">
          <span className="lth-ticker-pair">LTH / IRR</span>
          <span className="lth-ticker-coin">LOTH COIN</span>
        </div>
      </div>

      <div className="lth-ticker-left" dir="ltr">
        <div className="lth-ticker-price">IRR {priceDisplay}</div>
        <div className="lth-ticker-pos">
          <span>POS</span>
          <span className="lth-ticker-cta">محاسبه‌گر و پکیج ←</span>
        </div>
      </div>
    </Link>
  );
}
