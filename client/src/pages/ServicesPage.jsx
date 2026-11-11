import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch, downloadPrivateFile, newIdempotencyKey } from '../lib/api';
import { formatBytes, formatDateTime, formatMoney, formatNumber, PRIORITY_LABELS, ROLE_LABELS } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { ConfirmDialog, EmptyState, ErrorState, FieldErrorsList, LoadingState, StatusBadge } from '../components/StateViews';

export function ServicesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const [formQ, setFormQ] = useState(q);

  useEffect(() => {
    apiFetch('/service-categories')
      .then((res) => setCategories(res.items || []))
      .catch(() => {});
  }, []);

  const loadServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (category) qs.set('category', category);
      const res = await apiFetch(`/services?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [q, category]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">خدمات فنی و عملیاتی آنلاین</h1>
          <p className="page-subtitle">هر خدمت دارای فرم اختصاصی نسخه‌دار، تعهد زمانی (SLA)، کد رهگیری مستقل و تحویل مستند نتیجه است.</p>
        </div>
        <Link to="/service-requests" className="btn btn-secondary">مشاهدهٔ پرونده‌های ثبت‌شدهٔ من</Link>
      </div>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(searchParams);
          if (formQ.trim()) next.set('q', formQ.trim());
          else next.delete('q');
          setSearchParams(next);
        }}
      >
        <div className="grid grid-3" style={{ alignItems: 'end' }}>
          <div>
            <label className="form-label" htmlFor="svc-q">جست‌وجوی خدمت</label>
            <input id="svc-q" className="input" value={formQ} onChange={(e) => setFormQ(e.target.value)} placeholder="مثلاً کالیبراسیون یا تعمیر..." />
          </div>
          <div>
            <label className="form-label" htmlFor="svc-cat">دستهٔ خدمات</label>
            <select
              id="svc-cat"
              className="select"
              value={category}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                if (e.target.value) next.set('category', e.target.value);
                else next.delete('category');
                setSearchParams(next);
              }}
            >
              <option value="">همهٔ دسته‌های خدماتی</option>
              {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex-gap">
            <button type="submit" className="btn btn-primary">جست‌وجو</button>
            <button type="button" className="btn btn-secondary" onClick={() => { setFormQ(''); setSearchParams({}); }}>همه</button>
          </div>
        </div>
      </form>

      {loading && <LoadingState label="در حال بارگذاری فهرست خدمات فعال..." />}
      {!loading && error && <ErrorState error={error} onRetry={loadServices} />}
      {!loading && !error && data.items.length === 0 && (
        <EmptyState title="خدمتی یافت نشد" actionLabel="نمایش همهٔ خدمات" onAction={() => setSearchParams({})} />
      )}

      {!loading && !error && data.items.length > 0 && (
        <div className="grid grid-2">
          {data.items.map((s) => (
            <article key={s.id} className="card" style={{ marginBottom: 0 }}>
              <div className="flex-between" style={{ marginBottom: 8 }}>
                <span className="badge badge-info">⚙️ {s.category?.name || 'خدمات تخصصی'}</span>
                <span className="badge badge-neutral">⏱️ SLA: حداکثر {formatNumber(s.sla_hours)} ساعت</span>
              </div>
              <h2 style={{ margin: '6px 0 8px', fontSize: '1.12rem' }}>{s.name}</h2>
              <p className="muted" style={{ fontSize: '0.9rem', margin: '0 0 12px' }}>{s.description}</p>
              <div className="muted" style={{ fontSize: '0.84rem', marginBottom: 12 }}>
                مدت تقریبی انجام: <strong>{s.est_duration_text || 'بر اساس صف'}</strong>
              </div>
              <div className="flex-between">
                <strong style={{ fontSize: '1.02rem', color: 'var(--primary)' }}>
                  تعرفه: {formatMoney(s.price_toman, { freeLabel: true })}
                </strong>
                <Link to={`/services/${s.slug}`} className="btn btn-primary btn-sm">
                  مطالعهٔ شرایط و ثبت درخواست
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function ServiceDetailApplyPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, refreshCounts } = useAuth();
  const [service, setService] = useState(null);
  const [formData, setFormData] = useState({});
  const [priority, setPriority] = useState('normal');
  const [files, setFiles] = useState([]);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [reviewStep, setReviewStep] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [localFieldErrors, setLocalFieldErrors] = useState({});

  const loadService = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/services/${encodeURIComponent(slug)}`);
      const svc = res.service;
      setService(svc);
      setPriority(svc.priority_default || 'normal');
      const defaults = {};
      (svc.form_schema || []).forEach((f) => {
        if (f.type === 'select' && f.options?.length) defaults[f.name] = '';
        else if (f.type === 'checkbox') defaults[f.name] = false;
        else defaults[f.name] = '';
      });
      setFormData((prev) => ({ ...defaults, ...prev }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadService();
  }, [loadService]);

  if (loading) return <LoadingState label="در حال دریافت مشخصات و فرم خدمت..." />;
  if (error) return <ErrorState error={error} onRetry={loadService} />;
  if (!service) return null;

  const validateClientSide = () => {
    const errs = {};
    for (const f of service.form_schema || []) {
      const val = formData[f.name];
      const empty = val === undefined || val === null || val === '';
      if (f.required && empty) {
        errs[f.name] = `${f.label} الزامی است.`;
      } else if (!empty && f.type === 'phone' && !/^09\d{9}$/.test(String(val))) {
        errs[f.name] = 'شماره موبایل معتبر نیست (مثال: 09121234567).';
      } else if (!empty && f.type === 'number' && !Number.isFinite(Number(val))) {
        errs[f.name] = 'مقدار باید عدد معتبر باشد.';
      }
    }
    setLocalFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleProceedReview = (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (!user) {
      navigate(`/auth?next=${encodeURIComponent(`/services/${service.slug}`)}`);
      return;
    }
    if (!validateClientSide()) return;
    if (!acceptedTerms) {
      setSubmitError({ message: 'پیش از ادامه، مطالعه و پذیرش شرایط و موارد خارج از شمول الزامی است.' });
      return;
    }
    setReviewStep(true);
  };

  const handleFinalSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const fd = new FormData();
      fd.append('service_slug', service.slug);
      fd.append('priority', priority);
      fd.append('form_data', JSON.stringify(formData));
      for (const file of files) {
        fd.append('files', file);
      }
      const res = await apiFetch('/service-requests', {
        method: 'POST',
        body: fd
      });
      await refreshCounts();
      navigate(`/service-requests/${res.request.code}`);
    } catch (err) {
      // Preserve form values on failure (§8.2) so user never loses typed input!
      setSubmitError(err);
      setReviewStep(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/services" className="muted">← بازگشت به فهرست خدمات</Link>
      </div>

      <div className="two-col-layout">
        <div>
          <section className="card">
            <div className="flex-between">
              <span className="badge badge-info">⚙️ نسخهٔ فرم: {formatNumber(service.form_version)}</span>
              <span className="badge badge-neutral">⏱️ SLA: {formatNumber(service.sla_hours)} ساعت</span>
            </div>
            <h1 style={{ margin: '10px 0 8px', fontSize: '1.35rem' }}>{service.name}</h1>
            <p style={{ marginTop: 0 }}>{service.description}</p>

            <div className="grid grid-2" style={{ background: 'var(--surface-alt)', padding: 14, borderRadius: 8, fontSize: '0.9rem' }}>
              <div>هزینهٔ خدمت: <strong>{formatMoney(service.price_toman, { freeLabel: true })}</strong></div>
              <div>مدت تقریبی انجام: <strong>{service.est_duration_text || '—'}</strong></div>
              <div>روش تحویل نتیجه: <strong>{service.delivery_method}</strong></div>
              <div>صف تخصصی مسئول: <strong>{service.team_queue}</strong></div>
            </div>

            <div style={{ marginTop: 14 }}>
              <h3 style={{ fontSize: '0.98rem', marginBottom: 4 }}>شرایط انجام خدمت:</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>{service.terms || 'شرایط عمومی سامانه برقرار است.'}</p>

              <h3 style={{ fontSize: '0.98rem', marginBottom: 4 }}>موارد خارج از شمول:</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>{service.exclusions || 'مورد خاصی ذکر نشده است.'}</p>

              <h3 style={{ fontSize: '0.98rem', marginBottom: 4 }}>سیاست لغو و بازپرداخت:</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>{service.cancel_policy || 'پیش از شروع کار قابل لغو است.'}</p>

              {(service.required_documents || []).length > 0 && (
                <>
                  <h3 style={{ fontSize: '0.98rem', marginBottom: 4 }}>مدارک و مستندات مورد نیاز:</h3>
                  <ul className="muted" style={{ margin: 0, paddingRight: 20, fontSize: '0.9rem' }}>
                    {service.required_documents.map((doc, idx) => <li key={idx}>{doc}</li>)}
                  </ul>
                </>
              )}
            </div>
          </section>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.12rem' }}>
            {reviewStep ? 'پیش‌نمایش نهایی و تأیید ارسال درخواست' : 'تکمیل فرم درخواست خدمت'}
          </h2>

          {submitError && (
            <>
              <div className="alert-inline error" role="alert">⚠️ {submitError.message}</div>
              <FieldErrorsList details={submitError.details} />
            </>
          )}

          {!reviewStep ? (
            <form onSubmit={handleProceedReview} noValidate>
              {(service.form_schema || []).map((field) => (
                <div className="form-row" key={field.name}>
                  <label className="form-label" htmlFor={`sf-${field.name}`}>
                    {field.label}
                    {field.required && <span className="req-star">*</span>}
                  </label>

                  {field.type === 'select' ? (
                    <select
                      id={`sf-${field.name}`}
                      className={`select ${localFieldErrors[field.name] ? 'invalid' : ''}`}
                      value={formData[field.name] ?? ''}
                      onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                    >
                      <option value="">انتخاب کنید...</option>
                      {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      id={`sf-${field.name}`}
                      className={`textarea ${localFieldErrors[field.name] ? 'invalid' : ''}`}
                      value={formData[field.name] ?? ''}
                      onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                    />
                  ) : field.type === 'checkbox' ? (
                    <label className="flex-gap">
                      <input
                        id={`sf-${field.name}`}
                        type="checkbox"
                        checked={Boolean(formData[field.name])}
                        onChange={(e) => setFormData({ ...formData, [field.name]: e.target.checked })}
                      />
                      <span>تأیید می‌کنم</span>
                    </label>
                  ) : (
                    <input
                      id={`sf-${field.name}`}
                      type={field.type === 'number' ? 'number' : 'text'}
                      className={`input ${localFieldErrors[field.name] ? 'invalid' : ''}`}
                      value={formData[field.name] ?? ''}
                      onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                    />
                  )}

                  {localFieldErrors[field.name] && (
                    <div className="field-error">{localFieldErrors[field.name]}</div>
                  )}
                </div>
              ))}

              <div className="form-row">
                <label className="form-label" htmlFor="svc-prio">فوریت مورد نظر مشتری</label>
                <select id="svc-prio" className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">کم</option>
                  <option value="normal">عادی</option>
                  <option value="high">بالا</option>
                  <option value="urgent">فوری</option>
                </select>
              </div>

              <div className="form-row">
                <label className="form-label" htmlFor="svc-files">بارگذاری مدارک / تصاویر مجاز (حداکثر ۵ فایل تا ۱۰ مگابایت)</label>
                <input
                  id="svc-files"
                  type="file"
                  multiple
                  className="input"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.zip,.txt,.docx,.xlsx"
                  onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 5))}
                />
                {files.length > 0 && (
                  <div className="field-hint">
                    {files.length.toLocaleString('fa-IR')} فایل انتخاب شد: {files.map((f) => f.name).join('، ')}
                  </div>
                )}
              </div>

              <div className="form-row">
                <label className="flex-gap" style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                  />
                  <span>شرایط انجام خدمت، موارد خارج از شمول و تعرفهٔ اعلام‌شده را مطالعه کرده‌ام و می‌پذیرم.</span>
                </label>
              </div>

              <button type="submit" className="btn btn-primary btn-block">
                بررسی خلاصهٔ درخواست پیش از ثبت نهایی
              </button>
            </form>
          ) : (
            <div>
              <div style={{ background: 'var(--surface-alt)', padding: 14, borderRadius: 8, marginBottom: 14, fontSize: '0.9rem' }}>
                <div style={{ marginBottom: 8 }}>
                  <strong>خدمت انتخابی:</strong> {service.name} (نسخهٔ فرم {formatNumber(service.form_version)})
                </div>
                {(service.form_schema || []).map((f) => (
                  <div key={f.name} className="flex-between" style={{ padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
                    <span className="muted">{f.label}:</span>
                    <strong>{String(formData[f.name] ?? '—')}</strong>
                  </div>
                ))}
                <div className="flex-between" style={{ marginTop: 8 }}>
                  <span>تعداد فایل پیوست:</span>
                  <strong>{formatNumber(files.length)} فایل</strong>
                </div>
                <div className="flex-between" style={{ marginTop: 6, fontSize: '1.03rem' }}>
                  <strong>هزینهٔ خدمت:</strong>
                  <strong style={{ color: 'var(--primary)' }}>{formatMoney(service.price_toman, { freeLabel: true })}</strong>
                </div>
              </div>

              <div className="alert-inline info" style={{ fontSize: '0.83rem', fontWeight: 500 }}>
                {service.price_toman > 0
                  ? 'این خدمت پولی است. پس از ثبت درخواست و دریافت کد پیگیری، برای ورود پرونده به صف کارشناسی باید پرداخت (درگاه آزمایشی) انجام شود.'
                  : 'این خدمت رایگان است و بلافاصله پس از ثبت وارد صف بررسی کارشناسان می‌شود.'}
              </div>

              <div className="flex-gap">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={submitting}
                  onClick={() => setReviewStep(false)}
                >
                  ویرایش اطلاعات فرم
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={submitting}
                  onClick={handleFinalSubmit}
                >
                  {submitting ? '⏳ در حال ثبت پایدار در سرور...' : 'تأیید و ثبت نهایی درخواست خدمت'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MyServiceRequestsPage() {
  const { user, authLoading } = useAuth();
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadMine = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/service-requests');
      setData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) loadMine();
  }, [authLoading, loadMine]);

  if (authLoading || loading) return <LoadingState label="در حال بارگذاری پرونده‌های خدمات شما..." />;
  if (!user) return <EmptyState title="ابتدا وارد حساب کاربری شوید" actionLabel="ورود" actionTo="/auth?next=/service-requests" />;
  if (error) return <ErrorState error={error} onRetry={loadMine} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">پرونده‌های درخواست خدمت من</h1>
          <p className="page-subtitle">پیگیری وضعیت کارشناسی، گفتگو با اپراتور، ارسال مدرک تکمیلی و دریافت فایل نتیجه</p>
        </div>
        <Link to="/services" className="btn btn-primary">+ ثبت درخواست خدمت جدید</Link>
      </div>

      {data.items.length === 0 ? (
        <EmptyState title="پروندهٔ خدمتی ثبت نکرده‌اید" actionLabel="مشاهدهٔ خدمات" actionTo="/services" />
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>کد پیگیری</th>
                <th>نام خدمت</th>
                <th>وضعیت</th>
                <th>اولویت</th>
                <th>هزینه</th>
                <th>سررسید SLA</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.code}>
                  <td><strong className="mono">{r.code}</strong></td>
                  <td>{r.service_name}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{PRIORITY_LABELS[r.priority] || r.priority}</td>
                  <td>{formatMoney(r.price_toman, { freeLabel: true })}</td>
                  <td>
                    {formatDateTime(r.due_at)}
                    {r.sla_breached && <span className="badge badge-danger" style={{ marginRight: 6 }}>⚠️ تأخیر SLA</span>}
                  </td>
                  <td>
                    <Link to={`/service-requests/${r.code}`} className="btn btn-secondary btn-sm">مشاهدهٔ پرونده</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CustomerServiceRequestDetailPage() {
  const { code } = useParams();
  const [reqData, setReqData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msgBody, setMsgBody] = useState('');
  const [extraFiles, setExtraFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [actionErr, setActionErr] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/service-requests/${encodeURIComponent(code)}`);
      setReqData(res.request);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handlePayService = async () => {
    setBusy(true);
    setActionErr(null);
    try {
      const res = await apiFetch('/payments', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(`srpay-${code}`),
        body: { service_request_code: code }
      });
      if (res.payment?.pay_url) {
        window.location.assign(res.payment.pay_url);
      }
    } catch (err) {
      setActionErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!msgBody.trim()) return;
    setBusy(true);
    setActionErr(null);
    setFeedback('');
    try {
      const res = await apiFetch(`/service-requests/${encodeURIComponent(code)}/messages`, {
        method: 'POST',
        body: { body: msgBody.trim() }
      });
      setReqData(res.request);
      setMsgBody('');
      setFeedback('پیام شما ثبت شد.');
    } catch (err) {
      setActionErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleUploadSupplemental = async (e) => {
    e.preventDefault();
    if (!extraFiles.length) return;
    setBusy(true);
    setActionErr(null);
    setFeedback('');
    try {
      const fd = new FormData();
      extraFiles.forEach((f) => fd.append('files', f));
      const res = await apiFetch(`/service-requests/${encodeURIComponent(code)}/files`, {
        method: 'POST',
        body: fd
      });
      setReqData(res.request);
      setExtraFiles([]);
      setFeedback('مدارک تکمیلی با موفقیت در پرونده بارگذاری شد.');
    } catch (err) {
      setActionErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelRequest = async () => {
    if (cancelReason.trim().length < 3) {
      setActionErr({ message: 'لطفاً علت لغو را حداقل در ۳ حرف وارد کنید.' });
      return;
    }
    setBusy(true);
    setActionErr(null);
    try {
      const res = await apiFetch(`/service-requests/${encodeURIComponent(code)}/cancel`, {
        method: 'POST',
        body: { reason: cancelReason.trim() }
      });
      setReqData(res.request);
      setCancelOpen(false);
      setFeedback('درخواست خدمت لغو شد.');
    } catch (err) {
      setActionErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (file) => {
    setActionErr(null);
    try {
      await downloadPrivateFile(file.id, file.original_name);
    } catch (err) {
      setActionErr(err);
    }
  };

  if (loading) return <LoadingState label="در حال بارگذاری پروندهٔ خدمت..." />;
  if (error) return <ErrorState error={error} onRetry={loadDetail} />;
  if (!reqData) return null;

  const isClosed = ['completed', 'canceled', 'rejected', 'failed', 'refunded'].includes(reqData.status);
  const canCancel = ['submitted', 'queued', 'waiting_customer'].includes(reqData.status);
  const needsPayment = reqData.price_toman > 0 && reqData.status === 'submitted';

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/service-requests" className="muted">← بازگشت به فهرست پرونده‌ها</Link>
      </div>

      {feedback && <div className="alert-inline ok" role="status">✓ {feedback}</div>}
      {actionErr && <div className="alert-inline error" role="alert">⚠️ {actionErr.message}</div>}

      {reqData.status === 'waiting_customer' && (
        <div className="alert-inline warn" role="alert">
          💬 کارشناس پرونده منتظر پاسخ یا مدرک تکمیلی شماست. با ارسال پاسخ یا بارگذاری مدرک در پایین صفحه، پرونده خودکار به وضعیت «در حال انجام» بازمی‌گردد.
        </div>
      )}

      {needsPayment && (
        <div className="state-box warn">
          <div className="flex-between">
            <div>
              <strong>💳 این پرونده برای ورود به صف انجام نیازمند پرداخت هزینهٔ خدمت است.</strong>
              <div className="muted" style={{ fontSize: '0.86rem' }}>
                مبلغ قابل پرداخت: {formatMoney(reqData.price_toman)}
              </div>
            </div>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handlePayService}>
              {busy ? '⏳ در حال انتقال...' : 'پرداخت هزینهٔ خدمت (Sandbox)'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex-between">
          <div>
            <h1 style={{ margin: 0, fontSize: '1.28rem' }}>
              پروندهٔ <span className="mono">{reqData.code}</span> — {reqData.service?.name}
            </h1>
            <div className="muted" style={{ fontSize: '0.84rem', marginTop: 4 }}>
              ثبت‌شده در: {formatDateTime(reqData.created_at)} • سررسید SLA: {formatDateTime(reqData.due_at)} • نسخهٔ فرم ثبت‌شده: {formatNumber(reqData.form_version)}
            </div>
          </div>
          <div className="flex-gap">
            <StatusBadge status={reqData.status} />
            {canCancel && (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setCancelOpen(true)}>
                لغو درخواست
              </button>
            )}
          </div>
        </div>

        {reqData.result_summary && (
          <div className="state-box ok" style={{ marginBottom: 0 }}>
            <strong>📋 نتیجهٔ نهایی کارشناسی:</strong>
            <p style={{ margin: '6px 0 0', whiteSpace: 'pre-line' }}>{reqData.result_summary}</p>
          </div>
        )}
      </div>

      <div className="two-col-layout">
        <div>
          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>گفتگوی پرونده با کارشناس</h2>
            {(reqData.messages || []).length === 0 ? (
              <p className="muted">هنوز پیامی در این پرونده ثبت نشده است.</p>
            ) : (
              reqData.messages.map((m) => (
                <div key={m.id} className={`msg-item ${m.kind === 'operator' ? 'operator' : ''}`}>
                  <div className="msg-header">
                    <strong>
                      {m.kind === 'operator' ? '🛠️ کارشناس خدمات' : '👤 شما'} ({m.author_name || ROLE_LABELS[m.author_role]})
                    </strong>
                    <span>{formatDateTime(m.created_at)}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-line' }}>{m.body}</div>
                </div>
              ))
            )}

            {!isClosed && (
              <form onSubmit={handleSendMessage} style={{ marginTop: 12 }}>
                <label className="form-label" htmlFor="cust-sr-msg">ارسال پیام یا توضیحات تکمیلی در پرونده</label>
                <textarea
                  id="cust-sr-msg"
                  className="textarea"
                  value={msgBody}
                  onChange={(e) => setMsgBody(e.target.value)}
                  placeholder="پاسخ یا سؤال خود را بنویسید..."
                />
                <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy || !msgBody.trim()}>
                  {busy ? '⏳ در حال ارسال...' : 'ارسال پیام'}
                </button>
              </form>
            )}
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.08rem' }}>فایل‌های پرونده و خروجی نتیجه (دانلود خصوصی با کنترل مجوز)</h2>
            {(reqData.files || []).length === 0 ? (
              <p className="muted">فایلی ثبت نشده است.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {reqData.files.map((f) => (
                  <li key={f.id} className="flex-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div>
                      <span className={`badge ${f.kind === 'result_file' ? 'badge-ok' : 'badge-neutral'}`} style={{ marginLeft: 8 }}>
                        {f.kind === 'result_file' ? '✓ فایل نتیجهٔ نهایی' : '📎 مدرک ارسالی مشتری'}
                      </span>
                      <strong>{f.original_name}</strong>
                      <span className="muted" style={{ fontSize: '0.8rem', marginRight: 8 }}>({formatBytes(f.size_bytes)})</span>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleDownload(f)}>
                      ⬇ دانلود امن
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!isClosed && (
              <form onSubmit={handleUploadSupplemental} style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                <label className="form-label" htmlFor="cust-extra-files">ارسال مدرک تکمیلی جدید</label>
                <div className="flex-gap">
                  <input
                    id="cust-extra-files"
                    type="file"
                    multiple
                    className="input"
                    style={{ flex: 1 }}
                    onChange={(e) => setExtraFiles(Array.from(e.target.files || []))}
                  />
                  <button type="submit" className="btn btn-secondary" disabled={busy || !extraFiles.length}>
                    بارگذاری مدرک
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        <div>
          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>اطلاعات فرم ثبت‌شده (اسنپ‌شات نسخهٔ {formatNumber(reqData.form_version)})</h2>
            {Object.entries(reqData.form_data || {}).map(([k, v]) => (
              <div key={k} className="flex-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.88rem' }}>
                <span className="muted">{k}:</span>
                <strong>{String(v)}</strong>
              </div>
            ))}
            <div style={{ marginTop: 10, fontSize: '0.84rem' }} className="muted">
              <strong>شرایط ثبت‌شده در زمان درخواست:</strong> {reqData.terms_snapshot || '—'}
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>تاریخچهٔ گردش‌کار پرونده</h2>
            {(reqData.history || []).map((h, idx) => (
              <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.85rem' }}>
                <div className="flex-between">
                  <StatusBadge status={h.to_status} />
                  <span className="muted">{formatDateTime(h.created_at)}</span>
                </div>
                {h.reason && <div className="muted" style={{ marginTop: 4 }}>توضیح: {h.reason}</div>}
              </div>
            ))}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title={`لغو پروندهٔ ${reqData.code}`}
        description="در صورت لغو، پرونده بسته می‌شود و اگر پرداخت انجام شده باشد، رکورد استرداد وجه ثبت خواهد شد."
        confirmLabel="تأیید لغو درخواست"
        danger
        busy={busy}
        onCancel={() => setCancelOpen(false)}
        onConfirm={handleCancelRequest}
      >
        <div className="form-row">
          <label className="form-label" htmlFor="sr-cancel-reason">علت لغو <span className="req-star">*</span></label>
          <input
            id="sr-cancel-reason"
            className="input"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="علت لغو درخواست را بنویسید..."
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
