import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, newIdempotencyKey } from '../lib/api';
import { formatMoney, formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { EmptyState, ErrorState, FieldErrorsList, LoadingState, ProductImage } from '../components/StateViews';

export function CartCheckoutPage() {
  const { user, authLoading, refreshCounts } = useAuth();
  const [cart, setCart] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [shippingMethod, setShippingMethod] = useState('post');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyItemId, setBusyItemId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // Stable idempotency key per checkout session; regenerated only when cart lines change
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey('order'));

  // Inline new address form
  const [showAddrForm, setShowAddrForm] = useState(false);
  const [addrForm, setAddrForm] = useState({
    title: 'محل کار / منزل',
    province: 'تهران',
    city: 'تهران',
    address_line: '',
    postal_code: '',
    recipient_name: '',
    recipient_phone: ''
  });
  const [addrSaving, setAddrSaving] = useState(false);
  const [addrError, setAddrError] = useState(null);

  const loadData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [cartRes, addrRes] = await Promise.all([
        apiFetch('/cart'),
        apiFetch('/me/addresses')
      ]);
      setCart(cartRes);
      const list = addrRes.items || [];
      setAddresses(list);
      if (list.length > 0 && !selectedAddressId) {
        const def = list.find((a) => a.is_default) || list[0];
        setSelectedAddressId(def.id);
      }
      if (list.length === 0) {
        setShowAddrForm(true);
        setAddrForm((prev) => ({
          ...prev,
          recipient_name: prev.recipient_name || user.full_name || '',
          recipient_phone: prev.recipient_phone || user.phone || ''
        }));
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user, selectedAddressId]);

  useEffect(() => {
    if (!authLoading) loadData();
  }, [authLoading, loadData]);

  if (authLoading || loading) return <LoadingState label="در حال بررسی سبد خرید و موجودی سرور..." />;
  if (!user) {
    return (
      <EmptyState
        title="برای مشاهدهٔ سبد خرید و ثبت سفارش وارد حساب کاربری شوید"
        description="سبد خرید و نشانی‌های شما به‌صورت امن به حساب کاربری متصل می‌شوند."
        actionLabel="ورود یا ثبت‌نام"
        actionTo="/auth?next=/cart"
      />
    );
  }
  if (error) return <ErrorState error={error} onRetry={loadData} />;

  const updateItemQty = async (itemId, nextQty) => {
    setBusyItemId(itemId);
    setSubmitError(null);
    try {
      const updated = nextQty <= 0
        ? await apiFetch(`/cart/items/${itemId}`, { method: 'DELETE' })
        : await apiFetch(`/cart/items/${itemId}`, { method: 'PATCH', body: { quantity: nextQty } });
      setCart(updated);
      setIdemKey(newIdempotencyKey('order'));
      await refreshCounts();
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusyItemId('');
    }
  };

  const handleSaveAddress = async (e) => {
    e.preventDefault();
    setAddrSaving(true);
    setAddrError(null);
    try {
      const res = await apiFetch('/me/addresses', {
        method: 'POST',
        body: { ...addrForm, is_default: true }
      });
      const nextList = [res.address, ...addresses];
      setAddresses(nextList);
      setSelectedAddressId(res.address.id);
      setShowAddrForm(false);
    } catch (err) {
      setAddrError(err);
    } finally {
      setAddrSaving(false);
    }
  };

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (!selectedAddressId) {
      setSubmitError({ message: 'لطفاً یک نشانی تحویل انتخاب یا ثبت کنید.', details: [] });
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiFetch('/orders', {
        method: 'POST',
        idempotencyKey: idemKey,
        body: {
          address_id: selectedAddressId,
          shipping_method: shippingMethod,
          note
        }
      });
      await refreshCounts();
      if (res.payment && res.payment.pay_url) {
        // Navigate to server-hosted sandbox payment gateway
        window.location.assign(res.payment.pay_url);
        return;
      }
      window.location.assign(`/orders/${res.order.code}`);
    } catch (err) {
      setSubmitError(err);
      // Refresh cart so customer immediately sees updated server stock if OUT_OF_STOCK occurred
      try {
        const freshCart = await apiFetch('/cart');
        setCart(freshCart);
      } catch { /* ignore */ }
    } finally {
      setSubmitting(false);
    }
  };

  const items = cart?.items || [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="سبد خرید شما خالی است"
        description="از فروشگاه کالاهای مورد نیاز را انتخاب کنید تا قیمت و موجودی در سرور بررسی شود."
        actionLabel="ورود به فروشگاه"
        actionTo="/shop"
      />
    );
  }

  const hasUnavailable = items.some((it) => !it.purchasable || it.quantity > it.stock);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">سبد خرید و ثبت نهایی سفارش</h1>
          <p className="page-subtitle">قیمت، تخفیف، هزینهٔ ارسال و موجودی قطعی هنگام ثبت سفارش در سرور محاسبه و کسر می‌شود.</p>
        </div>
      </div>

      {submitError && (
        <>
          <div className="alert-inline error" role="alert">⚠️ {submitError.message}</div>
          <FieldErrorsList details={submitError.details} />
        </>
      )}

      <div className="two-col-layout">
        <div>
          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>اقلام سبد خرید</h2>
            {items.map((it) => {
              const attrs = Object.entries(it.variant_attrs || {}).map(([k, v]) => `${k}: ${v}`).join(' | ');
              const stockIssue = !it.purchasable || it.quantity > it.stock;
              return (
                <div
                  key={it.item_id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '84px 1fr',
                    gap: 12,
                    padding: '12px 0',
                    borderBottom: '1px solid var(--border-subtle)'
                  }}
                >
                  <ProductImage src={it.product.image_path} alt={it.product.name} />
                  <div>
                    <Link to={`/products/${it.product.slug}`} style={{ fontWeight: 700 }}>
                      {it.product.name}
                    </Link>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>
                      {attrs || it.sku_code} • کد: <span className="mono">{it.sku_code}</span>
                    </div>
                    <div style={{ marginTop: 6, fontWeight: 700 }}>
                      فی: {formatMoney(it.unit_price_toman)} × {formatNumber(it.quantity)} = {formatMoney(it.line_total_toman)}
                    </div>
                    {stockIssue && (
                      <div className="field-error">
                        ⚠️ موجودی انبار تغییر کرده است (موجودی فعلی: {formatNumber(it.stock)}). لطفاً تعداد را اصلاح یا قلم را حذف کنید.
                      </div>
                    )}
                    <div className="flex-gap" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyItemId === it.item_id || it.quantity <= 1}
                        onClick={() => updateItemQty(it.item_id, it.quantity - 1)}
                      >
                        − کاهش
                      </button>
                      <span>{formatNumber(it.quantity)} عدد</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyItemId === it.item_id || it.quantity >= it.stock}
                        onClick={() => updateItemQty(it.item_id, it.quantity + 1)}
                      >
                        + افزایش
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busyItemId === it.item_id}
                        onClick={() => updateItemQty(it.item_id, 0)}
                      >
                        حذف از سبد
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="card">
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>نشانی تحویل گیرنده</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddrForm((v) => !v)}>
                {showAddrForm ? 'بستن فرم نشانی جدید' : '+ افزودن نشانی جدید'}
              </button>
            </div>

            {addresses.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: showAddrForm ? 16 : 0 }}>
                {addresses.map((a) => (
                  <label
                    key={a.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: selectedAddressId === a.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                      background: selectedAddressId === a.id ? 'var(--primary-soft)' : '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="address"
                      checked={selectedAddressId === a.id}
                      onChange={() => setSelectedAddressId(a.id)}
                      style={{ marginLeft: 8 }}
                    />
                    <strong>{a.title}</strong> — {a.province}، {a.city}، {a.address_line}
                    <div className="muted" style={{ fontSize: '0.8rem', marginTop: 3 }}>
                      کدپستی: <span className="mono">{a.postal_code}</span> • گیرنده: {a.recipient_name} (<span className="mono">{a.recipient_phone}</span>)
                    </div>
                  </label>
                ))}
              </div>
            )}

            {showAddrForm && (
              <form onSubmit={handleSaveAddress} style={{ background: 'var(--surface-alt)', padding: 14, borderRadius: 8 }}>
                <h3 style={{ marginTop: 0, fontSize: '0.98rem' }}>ثبت نشانی جدید</h3>
                {addrError && (
                  <>
                    <div className="alert-inline error">⚠️ {addrError.message}</div>
                    <FieldErrorsList details={addrError.details} />
                  </>
                )}
                <div className="grid grid-3">
                  <div className="form-row">
                    <label className="form-label">عنوان نشانی <span className="req-star">*</span></label>
                    <input className="input" required value={addrForm.title} onChange={(e) => setAddrForm({ ...addrForm, title: e.target.value })} />
                  </div>
                  <div className="form-row">
                    <label className="form-label">استان <span className="req-star">*</span></label>
                    <input className="input" required value={addrForm.province} onChange={(e) => setAddrForm({ ...addrForm, province: e.target.value })} />
                  </div>
                  <div className="form-row">
                    <label className="form-label">شهر <span className="req-star">*</span></label>
                    <input className="input" required value={addrForm.city} onChange={(e) => setAddrForm({ ...addrForm, city: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <label className="form-label">نشانی دقیق پستی (حداقل ۱۰ حرف) <span className="req-star">*</span></label>
                  <input className="input" required minLength={10} value={addrForm.address_line} onChange={(e) => setAddrForm({ ...addrForm, address_line: e.target.value })} />
                </div>
                <div className="grid grid-3">
                  <div className="form-row">
                    <label className="form-label">کد پستی ۱۰ رقمی <span className="req-star">*</span></label>
                    <input className="input mono" required minLength={10} maxLength={10} value={addrForm.postal_code} onChange={(e) => setAddrForm({ ...addrForm, postal_code: e.target.value })} />
                  </div>
                  <div className="form-row">
                    <label className="form-label">نام گیرنده <span className="req-star">*</span></label>
                    <input className="input" required minLength={3} value={addrForm.recipient_name} onChange={(e) => setAddrForm({ ...addrForm, recipient_name: e.target.value })} />
                  </div>
                  <div className="form-row">
                    <label className="form-label">موبایل گیرنده <span className="req-star">*</span></label>
                    <input className="input mono" required placeholder="09121234567" value={addrForm.recipient_phone} onChange={(e) => setAddrForm({ ...addrForm, recipient_phone: e.target.value })} />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={addrSaving}>
                  {addrSaving ? '⏳ در حال ذخیره...' : 'ذخیرهٔ نشانی'}
                </button>
              </form>
            )}
          </section>
        </div>

        <form onSubmit={handlePlaceOrder} className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>خلاصهٔ صورت‌حساب و شرایط</h2>

          <div className="form-row">
            <label className="form-label" htmlFor="ship-method">روش ارسال</label>
            <select id="ship-method" className="select" value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)}>
              <option value="post">پست پیشتاز سازمانی</option>
              <option value="courier">پیک ویژهٔ شهری / باربری</option>
            </select>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="order-note">توضیحات تحویل (اختیاری)</label>
            <textarea id="order-note" className="textarea" style={{ minHeight: 68 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً تحویل به انباردار شیفت صبح..." />
          </div>

          <div style={{ background: 'var(--surface-alt)', padding: 14, borderRadius: 8, marginBottom: 14 }}>
            <div className="flex-between" style={{ marginBottom: 6 }}>
              <span>جمع بهای کالاها:</span>
              <strong>{formatMoney(cart.subtotal_toman)}</strong>
            </div>
            <div className="flex-between" style={{ marginBottom: 6 }}>
              <span>هزینهٔ ارسال (طبق قاعدهٔ سرور):</span>
              <strong>{formatMoney(cart.shipping_estimate_toman, { freeLabel: true })}</strong>
            </div>
            {cart.shipping_rule && (
              <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
                ارسال برای سفارش‌های از {formatMoney(cart.shipping_rule.free_over_toman)} به بالا رایگان است (تعرفهٔ پایه: {formatMoney(cart.shipping_rule.flat_toman)}).
              </div>
            )}
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '8px 0' }} />
            <div className="flex-between" style={{ fontSize: '1.08rem' }}>
              <strong>مبلغ قابل پرداخت نهایی:</strong>
              <strong style={{ color: 'var(--primary)' }}>{formatMoney(cart.estimated_total_toman)}</strong>
            </div>
          </div>

          <div className="alert-inline info" style={{ fontSize: '0.82rem', fontWeight: 500 }}>
            با ثبت سفارش، موجودی کالا برای شما رزرو و کسر می‌شود و به درگاه پرداخت آزمایشی (Sandbox) هدایت می‌شوید. در صورت لغو سفارش، موجودی طبق سیاست سامانه دقیقاً یک‌بار بازگردانده می‌شود.
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={submitting || hasUnavailable || !selectedAddressId}
          >
            {submitting
              ? '⏳ در حال ثبت سفارش و بررسی موجودی سرور...'
              : 'تأیید شرایط، ثبت سفارش و انتقال به درگاه آزمایشی'}
          </button>
        </form>
      </div>
    </div>
  );
}
