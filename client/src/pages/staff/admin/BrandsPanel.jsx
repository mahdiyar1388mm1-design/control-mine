import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, authFetch } from '../../../lib/api';
import { formatNumber } from '../../../lib/format';
import { Icon } from '../../../components/Icon';
import {
  AdminError, AdminLoading, Badge, EmptyHint, Modal, SectionCard, StatCard, Toast
} from './AdminUi';

const EMPTY_FORM = {
  name: '',
  description: '',
  website_url: '',
  sort_order: '0',
  is_active: true
};

function Field({ label, hint, required, children, span }) {
  return (
    <div className={`ac-field ${span ? `ac-span-${span}` : ''}`}>
      <span>{label}{required && <span className="ac-req">*</span>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function BrandLogo({ brand, size = 56 }) {
  if (!brand?.logo_path) {
    return (
      <span className="ac-brand-logo ac-brand-logo-empty" style={{ width: size, height: size }}>
        <Icon name="image" size={size * 0.4} />
      </span>
    );
  }
  return (
    <span className="ac-brand-logo" style={{ width: size, height: size }}>
      <img src={brand.logo_path} alt={brand.name} loading="lazy" />
    </span>
  );
}

/** Sends the file with the cookie session + CSRF header the API expects. */
async function uploadBrandLogo(brandId, file) {
  const fd = new FormData();
  fd.append('logo', file);
  const res = await authFetch(`/api/v1/admin/brands/${brandId}/logo`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'آپلود لوگوی برند ناموفق بود.');
    err.details = data?.error?.details;
    throw err;
  }
  return data.brand;
}

function BrandFormModal({ open, onClose, brand, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const isEdit = Boolean(brand);

  useEffect(() => {
    if (!open) return;
    setForm(brand ? {
      name: brand.name,
      description: brand.description || '',
      website_url: brand.website_url || '',
      sort_order: String(brand.sort_order ?? 0),
      is_active: brand.is_active !== false
    } : EMPTY_FORM);
    setFile(null);
    setErr(null);
    setBusy(false);
    setPreview(brand?.logo_path || null);
  }, [open, brand]);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        website_url: form.website_url.trim() || null,
        sort_order: Number(form.sort_order || 0),
        is_active: form.is_active
      };
      const saved = isEdit
        ? (await apiFetch(`/admin/brands/${brand.id}`, { method: 'PATCH', body: payload })).brand
        : (await apiFetch('/admin/brands', { method: 'POST', body: payload })).brand;
      // The logo is a second, multipart step: a brand can exist without one.
      const final = file ? await uploadBrandLogo(saved.id, file) : saved;
      onSaved(final, isEdit);
      onClose();
    } catch (error) {
      setErr(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="folder"
      title={isEdit ? `ویرایش برند «${brand.name}»` : 'افزودن برند جدید'}
      subtitle="نام، لوگو و توضیح کوتاه برند؛ کالاها می‌توانند همین برند را انتخاب کنند."
      footer={(
        <>
          <button type="button" className="ac-btn ac-btn-ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button type="submit" form="ac-brand-form" className="ac-btn ac-btn-primary" disabled={busy}>
            <Icon name={isEdit ? 'check' : 'plus'} size={16} color="#fff" />
            {busy ? 'در حال ذخیره...' : (isEdit ? 'ذخیرهٔ تغییرات' : 'ثبت برند')}
          </button>
        </>
      )}
    >
      <form id="ac-brand-form" onSubmit={submit} className="ac-form">
        {err && (
          <div className="ac-alert ac-alert-error">
            <Icon name="alert" size={15} color="currentColor" /> {err.message}
          </div>
        )}
        <div className="ac-form-grid">
          <Field label="نام برند" required span={2}>
            <input
              className="ac-input"
              required
              minLength={2}
              maxLength={80}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="مثلاً کاوش‌سنج"
            />
          </Field>
          <Field label="ترتیب نمایش" hint="عدد کمتر، جای بالاتر">
            <input
              type="number"
              min="0"
              max="10000"
              className="ac-input"
              value={form.sort_order}
              onChange={(e) => set('sort_order', e.target.value)}
            />
          </Field>
          <Field label="لوگوی برند" hint="PNG، JPEG یا WebP — تا ۲ مگابایت؛ بهتر است زمینه شفاف باشد" span={2}>
            <div className="ac-brand-logo-picker">
              <span className="ac-brand-logo-preview">
                {preview
                  ? <img src={preview} alt="پیش‌نمایش لوگو" />
                  : <Icon name="image" size={26} />}
              </span>
              <div className="ac-brand-logo-actions">
                <label className="ac-btn ac-btn-soft ac-btn-sm">
                  <Icon name="image" size={14} /> انتخاب فایل
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="ac-file-hidden"
                    onChange={(e) => setFile((e.target.files || [])[0] || null)}
                  />
                </label>
                {file && <span className="ac-file-name">{file.name}</span>}
                {!file && isEdit && brand?.logo_path && (
                  <span className="ac-file-name">لوگوی فعلی حفظ می‌شود</span>
                )}
              </div>
            </div>
          </Field>
          <Field label="وضعیت">
            <button
              type="button"
              className={`ac-toggle ${form.is_active ? 'is-on' : ''}`}
              onClick={() => set('is_active', !form.is_active)}
            >
              {form.is_active ? 'فعال — در فروشگاه دیده می‌شود' : 'غیرفعال — پنهان از فروشگاه'}
            </button>
          </Field>
          <Field label="وب‌سایت" hint="اختیاری">
            <input
              className="ac-input"
              dir="ltr"
              value={form.website_url}
              onChange={(e) => set('website_url', e.target.value)}
              placeholder="https://example.com"
            />
          </Field>
          <Field label="توضیح کوتاه" span={2}>
            <textarea
              className="ac-textarea"
              rows={3}
              maxLength={400}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="یک یا دو خط دربارهٔ برند و حوزهٔ تخصص آن..."
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export function BrandsPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [formState, setFormState] = useState({ open: false, brand: null });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const replaceInput = useRef(null);
  const replaceTarget = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/admin/brands');
      setItems(res.items || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const patch = async (brand, body, message) => {
    setBusyId(brand.id);
    try {
      const res = await apiFetch(`/admin/brands/${brand.id}`, { method: 'PATCH', body });
      setItems((list) => list.map((b) => (b.id === res.brand.id ? res.brand : b)));
      if (message) setToast(message);
    } catch (err) {
      setToast(err.message || 'ذخیره نشد.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (brand) => {
    setBusyId(brand.id);
    try {
      const res = await apiFetch(`/admin/brands/${brand.id}`, { method: 'DELETE' });
      setToast(res.deactivated ? res.message : `برند «${brand.name}» حذف شد.`);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setToast(err.message || 'حذف برند انجام نشد.');
    } finally {
      setBusyId(null);
    }
  };

  const removeLogo = async (brand) => {
    setBusyId(brand.id);
    try {
      const res = await apiFetch(`/admin/brands/${brand.id}/logo`, { method: 'DELETE' });
      setItems((list) => list.map((b) => (b.id === res.brand.id ? res.brand : b)));
      setToast(`لوگوی «${brand.name}» حذف شد.`);
    } catch (err) {
      setToast(err.message || 'حذف لوگو انجام نشد.');
    } finally {
      setBusyId(null);
    }
  };

  /** Replacing a logo without opening the modal: pick a file and upload it. */
  const pickReplacement = (brand) => {
    replaceTarget.current = brand;
    replaceInput.current?.click();
  };

  const onReplacement = async (e) => {
    const file = (e.target.files || [])[0];
    const brand = replaceTarget.current;
    e.target.value = '';
    if (!file || !brand) return;
    setBusyId(brand.id);
    try {
      const updated = await uploadBrandLogo(brand.id, file);
      setItems((list) => list.map((b) => (b.id === updated.id ? updated : b)));
      setToast(`لوگوی «${updated.name}» به‌روزرسانی شد.`);
    } catch (err) {
      setToast(err.message || 'آپلود لوگو انجام نشد.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && items.length === 0) return <AdminLoading label="در حال دریافت برندها..." />;
  if (error && items.length === 0) return <AdminError error={error} onRetry={load} />;

  const withLogo = items.filter((b) => b.logo_path).length;
  const activeCount = items.filter((b) => b.is_active).length;
  const linked = items.reduce((sum, b) => sum + (b.product_count || 0), 0);

  return (
    <div className="ac-panel">
      <Toast onClose={() => setToast('')}>{toast}</Toast>
      <input
        ref={replaceInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="ac-file-hidden"
        onChange={onReplacement}
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="ac-panel-head">
        <div>
          <h2>برندها و لوگو</h2>
          <p>هر برند یک لوگو، توضیح و ترتیب نمایش دارد؛ کالاها در فرم محصول از همین فهرست انتخاب می‌شوند.</p>
        </div>
        <button type="button" className="ac-btn ac-btn-primary" onClick={() => setFormState({ open: true, brand: null })}>
          <Icon name="plus" size={17} color="#fff" /> افزودن برند
        </button>
      </div>

      <div className="ac-stats ac-stats-4">
        <StatCard icon="folder" label="برندهای ثبت‌شده" value={formatNumber(items.length)} sub={`${formatNumber(activeCount)} برند فعال`} />
        <StatCard icon="image" label="دارای لوگو" value={formatNumber(withLogo)} sub={`${formatNumber(items.length - withLogo)} بدون لوگو`} tone="rose" />
        <StatCard icon="package" label="کالاهای برنددار" value={formatNumber(linked)} sub="مجموع اتصال‌ها" tone="plum" />
        <StatCard icon="check" label="پنهان از فروشگاه" value={formatNumber(items.length - activeCount)} sub="غیرفعال‌شده" tone="amber" />
      </div>

      <SectionCard
        title="فهرست برندها"
        subtitle="لوگو را می‌توانید مستقیم از همین جدول عوض کنید"
        icon="folder"
        action={(
          <button type="button" className="ac-icon-btn" title="بروزرسانی" onClick={load}>
            <Icon name="refresh" size={16} />
          </button>
        )}
      >
        {items.length === 0 ? (
          <EmptyHint
            icon="folder"
            title="هنوز برندی ثبت نشده"
            description="با دکمهٔ «افزودن برند» اولین برند و لوگویش را ثبت کنید."
          />
        ) : (
          <div className="brand-grid">
            {items.map((brand) => (
              <article className={`ac-brand-card ${brand.is_active ? '' : 'is-inactive'}`} key={brand.id}>
                <div className="ac-brand-head">
                  <BrandLogo brand={brand} size={60} />
                  <div className="ac-brand-titles">
                    <strong title={brand.name}>{brand.name}</strong>
                    <small dir="ltr">/{brand.slug}</small>
                  </div>
                  <Badge tone={brand.is_active ? 'ok' : 'neutral'}>
                    {brand.is_active ? 'فعال' : 'غیرفعال'}
                  </Badge>
                </div>

                {brand.description
                  ? <p className="ac-brand-desc">{brand.description}</p>
                  : <p className="ac-brand-desc muted">توضیحی ثبت نشده است.</p>}

                <div className="ac-brand-meta">
                  <span><Icon name="package" size={12} /> {formatNumber(brand.product_count || 0)} کالا</span>
                  <span><Icon name="hash" size={12} /> ترتیب {formatNumber(brand.sort_order || 0)}</span>
                  {brand.website_url && (
                    <a href={brand.website_url} target="_blank" rel="noreferrer noopener">
                      <Icon name="send" size={12} /> وب‌سایت
                    </a>
                  )}
                </div>

                <div className="ac-brand-actions">
                  <button
                    type="button"
                    className="ac-btn ac-btn-soft ac-btn-sm"
                    disabled={busyId === brand.id}
                    onClick={() => pickReplacement(brand)}
                  >
                    <Icon name="image" size={14} /> {brand.logo_path ? 'تعویض لوگو' : 'آپلود لوگو'}
                  </button>
                  <button
                    type="button"
                    className="ac-btn ac-btn-ghost ac-btn-sm"
                    onClick={() => setFormState({ open: true, brand })}
                  >
                    <Icon name="edit" size={14} /> ویرایش
                  </button>
                  <button
                    type="button"
                    className="ac-btn ac-btn-ghost ac-btn-sm"
                    disabled={busyId === brand.id}
                    onClick={() => patch(brand, { is_active: !brand.is_active }, brand.is_active ? 'برند از فروشگاه پنهان شد.' : 'برند فعال شد.')}
                  >
                    <Icon name={brand.is_active ? 'ban' : 'check'} size={14} />
                    {brand.is_active ? 'غیرفعال' : 'فعال‌سازی'}
                  </button>
                  {brand.logo_path && (
                    <button
                      type="button"
                      className="ac-btn ac-btn-ghost ac-btn-sm"
                      disabled={busyId === brand.id}
                      onClick={() => removeLogo(brand)}
                    >
                      <Icon name="x" size={14} /> حذف لوگو
                    </button>
                  )}
                  <button
                    type="button"
                    className="ac-btn ac-btn-danger-ghost ac-btn-sm"
                    disabled={busyId === brand.id}
                    onClick={() => setConfirmDelete(brand)}
                  >
                    <Icon name="archive" size={14} /> حذف
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <BrandFormModal
        open={formState.open}
        brand={formState.brand}
        onClose={() => setFormState({ open: false, brand: null })}
        onSaved={(brand, wasEdit) => {
          setToast(wasEdit ? `برند «${brand.name}» ذخیره شد.` : `برند «${brand.name}» ثبت شد.`);
          load();
        }}
      />

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        icon="archive"
        title={`حذف برند «${confirmDelete?.name || ''}»`}
        footer={(
          <>
            <button type="button" className="ac-btn ac-btn-ghost" onClick={() => setConfirmDelete(null)}>انصراف</button>
            <button
              type="button"
              className="ac-btn ac-btn-danger"
              disabled={busyId === confirmDelete?.id}
              onClick={() => confirmDelete && remove(confirmDelete)}
            >
              تأیید حذف
            </button>
          </>
        )}
      >
        {confirmDelete?.product_count > 0 ? (
          <p className="ac-confirm-text">
            این برند روی <b>{formatNumber(confirmDelete.product_count)}</b> کالا استفاده می‌شود.
            برای حفظ سابقهٔ کالاها، برند حذف نمی‌شود و فقط از فروشگاه <b>غیرفعال</b> خواهد شد.
          </p>
        ) : (
          <p className="ac-confirm-text">
            این برند به هیچ کالایی متصل نیست و برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.
          </p>
        )}
      </Modal>
    </div>
  );
}
