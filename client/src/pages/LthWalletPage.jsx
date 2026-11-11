import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { addCommas } from '../lib/lthMath';
import { formatDateTime, formatMoney } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { LthTopBar } from '../components/LthTopBar';
import { EmptyState, ErrorState, FieldErrorsList, LoadingState, StatusBadge } from '../components/StateViews';

export function LthWalletPage() {
  const { user, authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPanel = searchParams.get('panel') || 'contracts'; // sheba | sell | contracts | p2p

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showExactDigits, setShowExactDigits] = useState(false);
  const [showFullSerial, setShowFullSerial] = useState(false);
  const [activePanel, setActivePanel] = useState(initialPanel);

  // Forms state
  const [shebaForm, setShebaForm] = useState({
    sheba_iban: '',
    account_holder_name: '',
    amount_irr: '',
    withdraw_all: false
  });
  const [sellForm, setSellForm] = useState({
    sheba_iban: '',
    account_holder_name: '',
    lth_amount: '',
    withdraw_all: false
  });
  const [p2pForm, setP2pForm] = useState({
    recipient: '',
    lth_amount: '',
    note: ''
  });

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);

  useEffect(() => {
    const p = searchParams.get('panel');
    if (p && ['sheba', 'sell', 'contracts', 'p2p'].includes(p)) {
      setActivePanel(p);
    }
  }, [searchParams]);

  const selectPanel = (p) => {
    setOpErr(null);
    setMsg('');
    setActivePanel(p);
    setSearchParams(p === 'contracts' ? {} : { panel: p }, { replace: true });
  };

  const loadWallet = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/lth/wallet');
      setData(res);
      setShebaForm((f) => ({ ...f, account_holder_name: f.account_holder_name || user.full_name || '' }));
      setSellForm((f) => ({ ...f, account_holder_name: f.account_holder_name || user.full_name || '' }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && user) {
      loadWallet();
    }
  }, [authLoading, user, loadWallet]);

  if (authLoading) return <LoadingState label="در حال بررسی نشست کاربری..." />;

  if (!user) {
    return (
      <div className="lth-shell">
        <LthTopBar />
        <EmptyState
          title="ورود به کیف پول ماین (LOTH COIN)"
          description="برای مشاهدهٔ موجودی LTH، قراردادهای هوشمند استیک (PoS)، برداشت شبا و انتقال حساب به حساب وارد حساب خود شوید. همچنین با لمس نوار بالای صفحه می‌توانید وارد موتور محاسبه‌گر ریال و پکیج‌ها شوید."
          actionLabel="ورود / ثبت‌نام در سامانه"
          actionTo="/auth?next=/wallet"
        />
      </div>
    );
  }

  if (loading) return <LoadingState label="در حال استعلام کیف پول LTH و تطبیق با دفتر حسابداری سرور..." />;
  if (error) return <ErrorState error={error} onRetry={loadWallet} />;
  if (!data) return null;

  const { config: cfg, wallet: w, reconciliation: rec, holdings, withdrawals, transfers, recent_ledger: ledger } = data;
  const fmtLth = (disp8, exact) => (showExactDigits ? exact : disp8);

  const submitShebaWithdrawal = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch('/lth/withdrawals', {
        method: 'POST',
        body: {
          kind: 'sheba_withdrawal',
          sheba_iban: shebaForm.sheba_iban,
          account_holder_name: shebaForm.account_holder_name,
          amount_irr: shebaForm.withdraw_all ? undefined : shebaForm.amount_irr,
          withdraw_all: shebaForm.withdraw_all
        }
      });
      setShebaForm((s) => ({ ...s, amount_irr: '', withdraw_all: false }));
      setMsg(`درخواست برداشت شبا با کد رهگیری ${res.withdrawal.code} ثبت شد و در صف بررسی واحد مالی قرار گرفت.`);
      await loadWallet();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const submitSellLth = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch('/lth/withdrawals', {
        method: 'POST',
        body: {
          kind: 'sell_lth',
          sheba_iban: sellForm.sheba_iban,
          account_holder_name: sellForm.account_holder_name,
          lth_amount: sellForm.withdraw_all ? undefined : sellForm.lth_amount,
          withdraw_all: sellForm.withdraw_all
        }
      });
      setSellForm((s) => ({ ...s, lth_amount: '', withdraw_all: false }));
      setMsg(`درخواست فروش LTH با کد ${res.withdrawal.code} به مبلغ ${res.withdrawal.amount_irr_formatted} ریال ثبت شد.`);
      await loadWallet();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelWithdrawal = async (code) => {
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch(`/lth/withdrawals/${encodeURIComponent(code)}/cancel`, { method: 'POST', body: {} });
      setMsg(`درخواست ${code} لغو شد و موجودی بلافاصله به کیف پول شما بازگردانده شد.`);
      await loadWallet();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const submitP2pTransfer = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch('/lth/transfers', {
        method: 'POST',
        body: p2pForm
      });
      setP2pForm({ recipient: '', lth_amount: '', note: '' });
      setMsg(`انتقال حساب به حساب (${res.transfer.code}) به نام «${res.transfer.recipient_name}» در سرور ثبت و اعمال شد.`);
      await loadWallet();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lth-shell">
      {/* 1. Separate Top LTH / IRR Ticker Bar ("نوار بالا باید جدا از کیف پول است و بعد از لمس آن به صفحه زیر منتقل میشویم") */}
      <LthTopBar config={cfg} />

      {/* 2. Pink LTH Wallet Card with all 7 Titles */}
      <section className="lth-wallet-card" aria-label="کیف پول LTH و ۷ عنوان موجودی">
        <div className="lth-wallet-watermark" aria-hidden="true">LTH</div>

        <div className="lth-wallet-dots-row">
          <div className="lth-wallet-dots">
            {showFullSerial ? w.wallet_serial : '••••  ••••  ••••  ••••'}
          </div>
          <div className="flex-gap">
            <button
              type="button"
              className="lth-serial-btn"
              onClick={() => setShowFullSerial((v) => !v)}
            >
              {showFullSerial ? 'مخفی‌کردن شناسه' : 'شناسه کیف پول'}
            </button>
            <button
              type="button"
              className="lth-serial-btn"
              onClick={() => setShowExactDigits((v) => !v)}
            >
              {showExactDigits ? 'نمایش ۸ رقم استاندارد' : 'نمایش ریز محاسباتی'}
            </button>
          </div>
        </div>

        <div className="lth-wallet-rows">
          {/* Row 1: حجم پایه */}
          <div className="lth-wallet-row">
            <div>
              <div className="lth-row-title">حجم پایه</div>
              <div className="lth-row-sub">فقط خریدهای اولیه</div>
            </div>
            <div className="lth-row-val">LTH {fmtLth(w.base_lth_display_8, w.base_lth_exact)}</div>
          </div>

          {/* Row 2: استیک */}
          <div className="lth-wallet-row">
            <div>
              <div className="lth-row-title">استیک</div>
              <div className="lth-row-sub">{cfg.stake_percent}٪ پاداش (قابل برداشت {cfg.lockup_days.toLocaleString('fa-IR')} روز پس از خرید)</div>
            </div>
            <div className="lth-row-val">LTH {fmtLth(w.staked_lth_display_8, w.staked_lth_exact)}</div>
          </div>

          {/* Row 3: حجم پاداش قابل برداشت LTH */}
          <div className="lth-wallet-row">
            <div>
              <div className="lth-row-title">حجم پاداش قابل برداشت LTH</div>
              <div className="lth-row-sub">{cfg.withdrawable_percent}٪ از حجم پاداش دریافتی</div>
            </div>
            <div className="lth-row-val">LTH {fmtLth(w.withdrawable_reward_lth_display_8, w.withdrawable_reward_lth_exact)}</div>
          </div>

          {/* Row 4: جمع ال تی اچ قابل برداشت */}
          <div className="lth-wallet-row">
            <div>
              <div className="lth-row-title">جمع ال تی اچ قابل برداشت</div>
              <div className="lth-row-sub">حجم پایه + {cfg.withdrawable_percent}٪ پاداش دریافتی</div>
            </div>
            <div className="lth-row-val">LTH {fmtLth(w.total_withdrawable_lth_display_8, w.total_withdrawable_lth_exact)}</div>
          </div>

          {/* Row 5: قابل برداشت (به ریال) + دکمه برداشت شبا */}
          <div className="lth-wallet-row">
            <div className="lth-row-title-group">
              <div>
                <div className="lth-row-title">قابل برداشت</div>
                <div className="lth-row-sub">پایه به ریال + {cfg.withdrawable_percent}٪ پاداش به ریال</div>
              </div>
              <button
                type="button"
                className="lth-sheba-pill"
                onClick={() => selectPanel('sheba')}
              >
                برداشت شبا
              </button>
            </div>
            <div className="lth-row-val" dir="rtl">
              <span className="mono">{showExactDigits ? addCommas(w.withdrawable_irr_exact) : w.withdrawable_irr_formatted}</span> ریال
            </div>
          </div>

          {/* Row 6: جمع ریال */}
          <div className="lth-wallet-row">
            <div>
              <div className="lth-row-title">جمع ریال</div>
              <div className="lth-row-sub">جمع پایه و کل پاداش</div>
            </div>
            <div className="lth-row-val" dir="rtl">
              <span className="mono">{showExactDigits ? addCommas(w.total_irr_exact) : w.total_irr_formatted}</span> ریال
            </div>
          </div>

          {/* Row 7: جمع ال تی اچ */}
          <div className="lth-wallet-row">
            <div>
              <div className="lth-row-title">جمع ال تی اچ</div>
              <div className="lth-row-sub">جمع کل LTH در کیف پول</div>
            </div>
            <div className="lth-row-val">LTH {fmtLth(w.total_lth_display_8, w.total_lth_exact)}</div>
          </div>

          {/* Optional transparency row when user has pending Sheba settlement */}
          {w.reserved_atoms !== '0' && (
            <div className="lth-wallet-row" style={{ background: 'rgba(0,0,0,0.14)', borderRadius: 10, padding: '8px 10px', marginTop: 6 }}>
              <div>
                <div className="lth-row-title">در انتظار تسویهٔ شبا</div>
                <div className="lth-row-sub">رزروشده جهت بررسی واحد مالی</div>
              </div>
              <div className="lth-row-val" dir="rtl">
                <span className="mono">{w.reserved_irr_formatted}</span> ریال
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="muted" style={{ fontSize: '0.8rem', textAlign: 'center', marginBottom: 12 }}>
        ℹ️ {cfg.phase_notes?.tmn_and_toman_wallet_rows}
      </div>

      {/* 3. Action Buttons below Wallet (فروش / قرارداد هوشمند / حساب به حساب / خرید پکیج) */}
      <button
        type="button"
        className="lth-outline-btn pink-text"
        onClick={() => selectPanel('sell')}
      >
        فروش
      </button>

      <button
        type="button"
        className="lth-outline-btn"
        onClick={() => selectPanel('contracts')}
      >
        قرارداد هوشمند
      </button>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`btn ${activePanel === 'p2p' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => selectPanel('p2p')}
        >
          💳 حساب به حساب (PAY)
        </button>
        <Link to="/lth-calculator" className="btn btn-primary" style={{ background: '#ec1e79' }}>
          ➕ خرید پکیج / محاسبه‌گر LTH
        </Link>
      </div>

      {/* 4. Accounting Health & 24h Benchmark Banner ("نشان سلامت و همخوانی با حسابداری ما") */}
      <section className="card" style={{ background: rec.healthy ? '#f0fdf4' : '#fef2f2', borderColor: rec.healthy ? '#86efac' : '#fca5a5' }}>
        <div className="flex-between" style={{ marginBottom: 6 }}>
          <strong style={{ color: rec.healthy ? '#166534' : '#991b1b' }}>
            {rec.healthy ? '✓ نشان سلامت و همخوانی با دفتر حسابداری' : '⚠️ هشدار تطبیق دفتر حسابداری'}
          </strong>
          <span className={`badge ${rec.healthy ? 'badge-ok' : 'badge-danger'}`}>
            {rec.status_label}
          </span>
        </div>
        <div style={{ fontSize: '0.84rem', color: '#1e293b' }}>
          پاداش هر <strong>1.00 LTH</strong> در ۲۴ ساعت (واریز خودکار از سمت سرور):{' '}
          <strong className="mono">{rec.benchmark_1_lth_24h.reward_24h_lth} LTH</strong> معادل{' '}
          <strong className="mono">{rec.benchmark_1_lth_24h.reward_24h_irr_formatted} ریال</strong>{' '}
          (<span className="mono">{rec.benchmark_1_lth_24h.reward_24h_toman_formatted} تومان</span>) •{' '}
          تراکنش‌های تطبیق‌شدهٔ دفتر شما: <strong>{rec.checked_ledger_entries.toLocaleString('fa-IR')} ردیف</strong>
        </div>
      </section>

      {msg && <div className="alert-inline ok">✓ {msg}</div>}
      {opErr && (
        <>
          <div className="alert-inline error">⚠️ {opErr.message}</div>
          <FieldErrorsList details={opErr.details} />
        </>
      )}

      {/* ==================== ACTIVE WORKSPACE PANEL ==================== */}

      {/* PANEL A: برداشت شبا */}
      {activePanel === 'sheba' && (
        <section className="card">
          <div className="flex-between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.08rem' }}>🏦 ثبت درخواست برداشت شبا (به ریال)</h2>
            <span className="badge badge-info">سقف قابل برداشت: {w.withdrawable_irr_formatted} ریال</span>
          </div>
          <p className="muted" style={{ fontSize: '0.86rem', marginTop: 0 }}>
            موجودی قابل برداشت شامل «حجم پایه به ریال + {cfg.withdrawable_percent}٪ پاداش دریافتی به ریال» است. بخش استیک ({cfg.stake_percent}٪ پاداش) تا پایان {cfg.lockup_days.toLocaleString('fa-IR')} روز پس از خرید قفل است.
          </p>
          <form onSubmit={submitShebaWithdrawal}>
            <div className="form-row">
              <label className="form-label">شماره شبای ۲۶ کاراکتری مقصد (شروع با IR) <span className="req-star">*</span></label>
              <input
                className="input mono"
                required
                placeholder="IR062960000000100324200001"
                value={shebaForm.sheba_iban}
                onChange={(e) => setShebaForm({ ...shebaForm, sheba_iban: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label className="form-label">نام و نام خانوادگی صاحب حساب شبا <span className="req-star">*</span></label>
              <input
                className="input"
                required
                value={shebaForm.account_holder_name}
                onChange={(e) => setShebaForm({ ...shebaForm, account_holder_name: e.target.value })}
              />
            </div>
            <label className="flex-gap" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={shebaForm.withdraw_all}
                onChange={(e) => setShebaForm({ ...shebaForm, withdraw_all: e.target.checked })}
              />
              <span>برداشت کل موجودی قابل برداشت ({w.withdrawable_irr_formatted} ریال)</span>
            </label>
            {!shebaForm.withdraw_all && (
              <div className="form-row">
                <label className="form-label">مبلغ برداشت به ریال (حداقل ۱۰٬۰۰۰ ریال) <span className="req-star">*</span></label>
                <input
                  className="input mono"
                  required
                  placeholder="مثلاً 2200000"
                  value={shebaForm.amount_irr}
                  onChange={(e) => setShebaForm({ ...shebaForm, amount_irr: e.target.value })}
                />
              </div>
            )}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'در حال ثبت درخواست در سرور...' : 'ثبت درخواست برداشت شبا'}
            </button>
          </form>
        </section>
      )}

      {/* PANEL B: فروش LTH */}
      {activePanel === 'sell' && (
        <section className="card">
          <div className="flex-between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.08rem', color: '#be185d' }}>💱 فروش موجودی قابل برداشت LTH به نرخ سرور</h2>
            <span className="badge badge-info">قابل فروش: LTH {w.total_withdrawable_lth_display_8}</span>
          </div>
          <p className="muted" style={{ fontSize: '0.86rem', marginTop: 0 }}>
            فروش فقط از محل «جمع ال تی اچ قابل برداشت» با نرخ لحظه‌ای سرور (<span className="mono">{cfg.price_irr_formatted} IRR</span>) انجام و معادل ریالی آن برای واریز شبا ثبت می‌گردد.
          </p>
          <form onSubmit={submitSellLth}>
            <div className="form-row">
              <label className="form-label">شماره شبای مقصد جهت واریز معادل ریالی <span className="req-star">*</span></label>
              <input
                className="input mono"
                required
                placeholder="IR062960000000100324200001"
                value={sellForm.sheba_iban}
                onChange={(e) => setSellForm({ ...sellForm, sheba_iban: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label className="form-label">نام صاحب حساب <span className="req-star">*</span></label>
              <input
                className="input"
                required
                value={sellForm.account_holder_name}
                onChange={(e) => setSellForm({ ...sellForm, account_holder_name: e.target.value })}
              />
            </div>
            <label className="flex-gap" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={sellForm.withdraw_all}
                onChange={(e) => setSellForm({ ...sellForm, withdraw_all: e.target.checked })}
              />
              <span>فروش کل LTH قابل برداشت ({w.total_withdrawable_lth_exact} LTH)</span>
            </label>
            {!sellForm.withdraw_all && (
              <div className="form-row">
                <label className="form-label">مقدار LTH جهت فروش <span className="req-star">*</span></label>
                <input
                  className="input mono"
                  required
                  placeholder="مثلاً 0.001"
                  value={sellForm.lth_amount}
                  onChange={(e) => setSellForm({ ...sellForm, lth_amount: e.target.value })}
                />
              </div>
            )}
            <button type="submit" className="lth-filled-btn" disabled={busy} style={{ marginBottom: 0 }}>
              {busy ? 'در حال ثبت فروش...' : 'تأیید فروش و ثبت تسویهٔ شبا'}
            </button>
          </form>
        </section>
      )}

      {/* PANEL C: حساب به حساب (PAY) */}
      {activePanel === 'p2p' && (
        <section className="card">
          <div className="flex-between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.08rem' }}>💳 انتقال حساب به حساب (PAY)</h2>
            <span className="badge badge-info">قابل انتقال: LTH {w.total_withdrawable_lth_display_8}</span>
          </div>
          <p className="muted" style={{ fontSize: '0.86rem', marginTop: 0 }}>
            انتقال آنی موجودی قابل برداشت LTH به سایر کاربران سامانه با وارد کردن شماره موبایل یا شناسهٔ ۱۶ رقمی کیف پول مقصد (موجودی استیک قفل‌شده قابل انتقال نیست).
          </p>
          <form onSubmit={submitP2pTransfer}>
            <div className="grid grid-2">
              <div className="form-row">
                <label className="form-label">موبایل یا شناسهٔ ۱۶ رقمی کیف پول مقصد <span className="req-star">*</span></label>
                <input
                  className="input mono"
                  required
                  placeholder="09120000011"
                  value={p2pForm.recipient}
                  onChange={(e) => setP2pForm({ ...p2pForm, recipient: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label className="form-label">مقدار LTH انتقالی <span className="req-star">*</span></label>
                <input
                  className="input mono"
                  required
                  placeholder="0.00010000"
                  value={p2pForm.lth_amount}
                  onChange={(e) => setP2pForm({ ...p2pForm, lth_amount: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <label className="form-label">توضیحات انتقال (اختیاری)</label>
              <input
                className="input"
                placeholder="بابت تسویه..."
                value={p2pForm.note}
                onChange={(e) => setP2pForm({ ...p2pForm, note: e.target.value })}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'در حال انتقال...' : 'انجام انتقال حساب به حساب'}
            </button>
          </form>

          {transfers.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: '0.96rem', marginBottom: 8 }}>آخرین تراکنش‌های حساب به حساب شما</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>کد</th>
                      <th>نوع</th>
                      <th>طرف مقابل</th>
                      <th>مقدار LTH</th>
                      <th>زمان</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map((t) => (
                      <tr key={t.id}>
                        <td className="mono">{t.code}</td>
                        <td>
                          <span className={`badge ${t.direction === 'in' ? 'badge-ok' : 'badge-neutral'}`}>
                            {t.direction === 'in' ? 'دریافتی (+)' : 'ارسالی (-)'}
                          </span>
                        </td>
                        <td>{t.counterparty_name}</td>
                        <td className="mono">{t.lth_exact}</td>
                        <td>{formatDateTime(t.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* PANEL D: قرارداد هوشمند PoS و دفتر تراکنش‌ها */}
      {activePanel === 'contracts' && (
        <section className="card">
          <div className="flex-between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.08rem' }}>📜 قراردادهای هوشمند استیک (Proof of Stake) و واریز ۲۴ ساعته</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={loadWallet}>🔄 بروزرسانی از سرور</button>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            هر خرید یک قرارداد مستقل Proof of Stake ایجاد می‌کند. سرور هر ۲۴ ساعت پاداش متناظر را محاسبه و واریز می‌نماید ({cfg.stake_percent}٪ استیک قفل‌شده به مدت {cfg.lockup_days.toLocaleString('fa-IR')} روز از زمان خرید + {cfg.withdrawable_percent}٪ قابل برداشت آنی).
          </p>

          {holdings.length === 0 ? (
            <EmptyState
              title="هنوز قرارداد خرید فعالی ثبت نشده است"
              description="با انتخاب یکی از پکیج‌های LTH در صفحهٔ محاسبه‌گر، اولین حجم پایه و قرارداد هوشمند خود را فعال نمایید."
              actionLabel="مشاهدهٔ پکیج‌های LTH"
              actionTo="/lth-calculator"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {holdings.map((h) => (
                <div key={h.id} style={{ border: '1px solid #fbcfe8', background: '#fffbfd', borderRadius: 14, padding: 14 }}>
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <strong className="mono" style={{ color: '#be185d' }}>{h.contract_code}</strong>
                    <span className={`badge ${h.stake_unlocked ? 'badge-ok' : 'badge-info'}`}>
                      {h.stake_unlocked
                        ? 'آزادشده (پایان دوره استیک)'
                        : `قفل استیک: ${h.days_remaining.toLocaleString('fa-IR')} روز باقی‌مانده از ${h.lockup_days.toLocaleString('fa-IR')} روز`}
                    </span>
                  </div>
                  <div className="grid grid-2" style={{ fontSize: '0.85rem', gap: 8 }}>
                    <div>خرید اولیه (حجم پایه): <strong className="mono">{h.initial_base_lth_display_8} LTH</strong></div>
                    <div>حجم پایهٔ فعال فعلی: <strong className="mono">{h.active_base_lth_display_8} LTH</strong></div>
                    <div>استیک انباشتهٔ این قرارداد: <strong className="mono">{h.accrued_staked_lth_exact} LTH</strong></div>
                    <div>پاداش ۲۴ ساعتهٔ بعدی: <strong className="mono">{h.daily_reward_lth_exact} LTH</strong></div>
                    <div>زمان خرید: <span>{formatDateTime(h.purchased_at)}</span></div>
                    <div>سررسید آزادسازی استیک: <span>{formatDateTime(h.stake_unlock_at)}</span></div>
                    <div>دوره‌های ۲۴ساعتهٔ واریزشده: <strong>{h.last_reward_cycle.toLocaleString('fa-IR')} دوره</strong></div>
                    <div>نوبت واریز سرور بعدی: <span>{formatDateTime(h.next_reward_at)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {ledger.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: '0.96rem', marginBottom: 8 }}>📒 آخرین ثبت‌های دفتر حسابداری کیف پول شما</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>زمان</th>
                      <th>شرح عملیات</th>
                      <th>تغییر پایه</th>
                      <th>تغییر استیک</th>
                      <th>تغییر قابل برداشت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((l) => (
                      <tr key={l.id}>
                        <td>{formatDateTime(l.created_at)}</td>
                        <td>{l.note || l.entry_type}</td>
                        <td className="mono">{l.delta_base_lth}</td>
                        <td className="mono">{l.delta_staked_lth}</td>
                        <td className="mono">{l.delta_withdrawable_lth}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Withdrawals & Sales History */}
      {withdrawals.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>سابقهٔ درخواست‌های برداشت شبا و فروش LTH</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>نوع</th>
                  <th>مبلغ ریالی</th>
                  <th>معادل تومان</th>
                  <th>شبا</th>
                  <th>وضعیت</th>
                  <th>مرجع / عملیات</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((wd) => (
                  <tr key={wd.id}>
                    <td className="mono">{wd.code}</td>
                    <td>{wd.kind_label}</td>
                    <td className="mono">{wd.amount_irr_formatted} ریال</td>
                    <td>{formatMoney(wd.amount_toman)}</td>
                    <td className="mono">{wd.sheba_masked}</td>
                    <td><StatusBadge status={wd.status === 'paid' ? 'paid' : (wd.status === 'pending' ? 'pending' : 'canceled')} label={wd.status_label} /></td>
                    <td>
                      {wd.status === 'pending' ? (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={busy}
                          onClick={() => handleCancelWithdrawal(wd.code)}
                        >
                          لغو و برگشت به کیف پول
                        </button>
                      ) : (
                        <span className="mono" style={{ fontSize: '0.8rem' }}>{wd.bank_ref || wd.review_note || '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
