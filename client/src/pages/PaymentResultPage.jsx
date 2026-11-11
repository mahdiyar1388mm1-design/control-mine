import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { ErrorState, LoadingState, StatusBadge } from '../components/StateViews';

/**
 * Payment Result Page (§5 & §11):
 * - Fetches authoritative payment state from /api/v1/payments/:id (never trusts URL query alone).
 * - Clearly separates: paid (success), failed/canceled, and expired/unknown outcome.
 */
export function PaymentResultPage() {
  const [searchParams] = useSearchParams();
  const paymentId = searchParams.get('ref') || '';
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPayment = useCallback(async () => {
    if (!paymentId) {
      setError({ message: 'شناسهٔ پرداخت در نشانی بازگشتی وجود ندارد.' });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/payments/${encodeURIComponent(paymentId)}`);
      setPayment(res.payment);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    loadPayment();
  }, [loadPayment]);

  if (loading) return <LoadingState label="در حال استعلام وضعیت قطعی پرداخت از سرور..." />;
  if (error) return <ErrorState error={error} onRetry={loadPayment} title="وضعیت پرداخت قابل استعلام نیست" />;
  if (!payment) return null;

  const isPaid = payment.status === 'paid';
  const isUnknownOrExpired = payment.status === 'expired' || payment.status === 'pending';

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className={`state-box ${isPaid ? 'ok' : (isUnknownOrExpired ? 'warn' : 'error')}`}>
        <div className="flex-between" style={{ marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>
            {isPaid && '✓ پرداخت آزمایشی با موفقیت تأیید شد'}
            {payment.status === 'failed' && '✕ پرداخت ناموفق بود'}
            {isUnknownOrExpired && '❓ نتیجهٔ پرداخت نامعلوم یا منقضی‌شده است'}
            {payment.status === 'refunded' && '↩ مبلغ این پرداخت مسترد شده است'}
          </h1>
          <StatusBadge status={payment.status} />
        </div>

        <div className="card" style={{ marginTop: 12, marginBottom: 14 }}>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span>مبلغ تراکنش:</span>
            <strong>{formatMoney(payment.amount_toman)}</strong>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span>درگاه:</span>
            <span>آداپتور آزمایشی ({payment.gateway})</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span>شناسهٔ مرجع درگاه:</span>
            <span className="mono">{payment.gateway_ref || 'ثبت‌نشده'}</span>
          </div>
          <div className="flex-between">
            <span>زمان تأیید پرداخت:</span>
            <span>{formatDateTime(payment.paid_at)}</span>
          </div>
        </div>

        {isUnknownOrExpired && (
          <p style={{ margin: '0 0 14px', fontWeight: 600 }}>
            توجه: نتیجهٔ نهایی تراکنش تأیید نشده و سفارش/درخواست شما به‌عنوان پرداخت‌شده ثبت نشده است. می‌توانید وضعیت را مجدداً استعلام کنید یا از صفحهٔ سفارش/پرونده، پرداخت جدید آغاز نمایید.
          </p>
        )}

        <div className="flex-gap">
          {payment.order_id && (
            <Link to="/orders" className="btn btn-primary">مشاهدهٔ سفارش‌ها و رسید سرور</Link>
          )}
          {payment.service_request_id && (
            <Link to="/service-requests" className="btn btn-primary">مشاهدهٔ پرونده‌های خدمات</Link>
          )}
          {payment.lth_purchase_code && (
            <Link to="/wallet" className="btn btn-primary" style={{ background: '#ec1e79' }}>
              مشاهدهٔ کیف پول و قرارداد هوشمند LTH
            </Link>
          )}
          <button type="button" className="btn btn-secondary" onClick={loadPayment}>
            🔄 استعلام مجدد وضعیت از سرور
          </button>
        </div>
      </div>
    </div>
  );
}
