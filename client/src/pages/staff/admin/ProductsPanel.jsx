import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, authFetch } from '../../../lib/api';
import { formatMoney, formatNumber } from '../../../lib/format';
import { Icon } from '../../../components/Icon';
import {
  AdminError, AdminLoading, Badge, EmptyHint, Modal, Pagination, SectionCard,
  StatCard, StatusPill, Toast, useAdminData
} from './AdminUi';

const EMPTY_FORM = {
  name: '',
  description: '',
  status: 'active',
  category_id: '',
  category_name: '',
  brand_id: '',
  brand_name: '',
  sku_code: '',
  price_toman: '',
  cost_price_toman: '',
  stock: '',
  weight_grams: '',
  variant_key: 'رنگ',
  variant_value: 'استاندارد'
};

function productImage(product) {
  const path = product?.cover_image || product?.image_path;
  return path ? path : null;
}

function ProductThumb({ product, size = 56 }) {
  const src = productImage(product);
  if (!src) {
    return (
      <span className="ac-thumb ac-thumb-empty" style={{ width: size, height: size }}>
        <Icon name="package" size={size * 0.42} />
      </span>
    );
  }
  return (
    <span className="ac-thumb" style={{ width: size, height: size }}>
      <img src={src} alt={product.name} loading="lazy" />
    </span>
  );
}

async function uploadImages(productId, files, altText) {
  if (!files.length) return null;
  const fd = new FormData();
  files.forEach((file) => fd.append('images', file));
  fd.append('alt_text', altText || '');
  // authFetch adds both the bearer token and the CSRF header required for cookie sessions.
  const res = await authFetch(`/api/v1/admin/products/${productId}/images`, {
    method: 'POST',
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || 'آپلود تصویر ناموفق بود.');
  const first = (data.paths || [])[0];
  if (first) {
    await apiFetch(`/admin/products/${productId}`, { method: 'PATCH', body: { image_path: first } });
  }
  return first;
}

function Field({ label, hint, required, children, span }) {
  return (
    <div className={`ac-field ${span ? `ac-span-${span}` : ''}`}>
      <span>{label}{required && <span className="ac-req">*</span>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function CreateProductModal({ open, onClose, categories, brands, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [files, setFiles] = useState([]);
  const [newCategory, setNewCategory] = useState(false);
  const [newBrand, setNewBrand] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setFiles([]);
      setNewCategory(false);
      setNewBrand(false);
      setErr(null);
      setBusy(false);
    }
  }, [open]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        status: form.status,
        category_id: newCategory ? null : (form.category_id || null),
        category_name: newCategory ? form.category_name.trim() : null,
        brand_id: newBrand ? null : (form.brand_id || null),
        brand_name: newBrand ? form.brand_name.trim() : null,
        sku: form.price_toman !== '' ? {
          code: form.sku_code.trim() || undefined,
          price_toman: Number(form.price_toman),
          cost_price_toman: Number(form.cost_price_toman || 0),
          stock: Number(form.stock || 0),
          weight_grams: form.weight_grams ? Number(form.weight_grams) : undefined,
          variant_attrs: { [form.variant_key.trim() || 'نوع']: form.variant_value.trim() || 'استاندارد' }
        } : null
      };
      const res = await apiFetch('/admin/console/products', { method: 'POST', body: payload });
      if (files.length) {
        await uploadImages(res.product.id, files, res.product.name);
      }
      onCreated(res.product);
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
      icon="package"
      wide
      title="افزودن محصول جدید"
      subtitle="نام، دسته‌بندی، قیمت و موجودی را وارد کنید؛ محصول بلافاصله در فروشگاه منتشر می‌شود."
      footer={(
        <>
          <button type="button" className="ac-btn ac-btn-ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button type="submit" form="ac-create-product" className="ac-btn ac-btn-primary" disabled={busy}>
            <Icon name="plus" size={16} color="#fff" />
            {busy ? 'در حال ثبت...' : 'ثبت محصول'}
          </button>
        </>
      )}
    >
      <form id="ac-create-product" onSubmit={submit} className="ac-form">
        {err && <div className="ac-alert ac-alert-error"><Icon name="alert" size={15} color="currentColor" /> {err.message}</div>}
        <div className="ac-form-grid">
          <Field label="نام محصول" required span={2}>
            <input className="ac-input" required minLength={2} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مثلاً مولتی‌متر دیجیتال صنعتی" />
          </Field>
          <Field label="دسته‌بندی">
            {!newCategory ? (
              <div className="ac-inline-field">
                <select className="ac-select" value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                  <option value="">بدون دسته</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" className="ac-mini-btn" onClick={() => setNewCategory(true)}>دستهٔ جدید</button>
              </div>
            ) : (
              <div className="ac-inline-field">
                <input className="ac-input" value={form.category_name} onChange={(e) => set('category_name', e.target.value)} placeholder="نام دستهٔ جدید" />
                <button type="button" className="ac-mini-btn" onClick={() => setNewCategory(false)}>انتخاب موجود</button>
              </div>
            )}
          </Field>
          <Field label="برند">
            {!newBrand ? (
              <div className="ac-inline-field">
                <select className="ac-select" value={form.brand_id} onChange={(e) => set('brand_id', e.target.value)}>
                  <option value="">بدون برند</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button type="button" className="ac-mini-btn" onClick={() => setNewBrand(true)}>برند جدید</button>
              </div>
            ) : (
              <div className="ac-inline-field">
                <input className="ac-input" value={form.brand_name} onChange={(e) => set('brand_name', e.target.value)} placeholder="نام برند جدید" />
                <button type="button" className="ac-mini-btn" onClick={() => setNewBrand(false)}>انتخاب موجود</button>
              </div>
            )}
          </Field>
          <Field label="وضعیت نمایش">
            <select className="ac-select" value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="active">فعال — قابل خرید</option>
              <option value="draft">پیش‌نویس — غیرقابل خرید</option>
              <option value="archived">بایگانی</option>
            </select>
          </Field>
          <Field label="توضیحات" span={3}>
            <textarea className="ac-textarea" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="مشخصات، کاربرد و نکات مهم محصول..." />
          </Field>
          <div className="ac-divider ac-span-3"><span>قیمت و موجودی (SKU اول)</span></div>
          <Field label="قیمت فروش (تومان)" required>
            <input type="number" min="0" required className="ac-input" value={form.price_toman} onChange={(e) => set('price_toman', e.target.value)} placeholder="0" />
          </Field>
          <Field label="قیمت خرید (محرمانه)">
            <input type="number" min="0" className="ac-input" value={form.cost_price_toman} onChange={(e) => set('cost_price_toman', e.target.value)} placeholder="0" />
          </Field>
          <Field label="موجودی اولیه">
            <input type="number" min="0" className="ac-input" value={form.stock} onChange={(e) => set('stock', e.target.value)} placeholder="0" />
          </Field>
          <Field label="کد SKU (اختیاری)">
            <input className="ac-input" dir="ltr" value={form.sku_code} onChange={(e) => set('sku_code', e.target.value)} placeholder="خودکار" />
          </Field>
          <Field label="نام ویژگی">
            <input className="ac-input" value={form.variant_key} onChange={(e) => set('variant_key', e.target.value)} />
          </Field>
          <Field label="مقدار ویژگی">
            <input className="ac-input" value={form.variant_value} onChange={(e) => set('variant_value', e.target.value)} />
          </Field>
          <Field label="تصاویر محصول" hint="JPEG، PNG یا WebP — حداکثر ۵ تصویر" span={3}>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="ac-file" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            {files.length > 0 && <div className="ac-file-list">{files.map((f) => <span key={f.name}>{f.name}</span>)}</div>}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function SkuEditRow({ sku, busy, onSave }) {
  const [price, setPrice] = useState(sku.price_toman);
  const [cost, setCost] = useState(sku.cost_price_toman ?? 0);
  const [stock, setStock] = useState(sku.stock);
  const dirty = Number(price) !== sku.price_toman || Number(cost) !== (sku.cost_price_toman ?? 0) || Number(stock) !== sku.stock;
  return (
    <div className="ac-sku-row">
      <div className="ac-sku-code"><span className="mono">{sku.code}</span><small>{Object.entries(sku.variant_attrs || {}).map(([k, v]) => `${k}: ${v}`).join(' • ') || 'بدون ویژگی'}</small></div>
      <label className="ac-mini-field"><span>فروش</span><input type="number" min="0" className="ac-input ac-input-sm" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="ac-mini-field"><span>خرید</span><input type="number" min="0" className="ac-input ac-input-sm" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      <label className="ac-mini-field"><span>موجودی</span><input type="number" min="0" className="ac-input ac-input-sm" value={stock} onChange={(e) => setStock(e.target.value)} /></label>
      <button
        type="button"
        className={`ac-btn ac-btn-sm ${dirty ? 'ac-btn-primary' : 'ac-btn-ghost'}`}
        disabled={!dirty || busy}
        onClick={() => onSave(sku, { price_toman: Number(price), cost_price_toman: Number(cost), stock: Number(stock) })}
      >
        {dirty ? 'ذخیره' : 'ذخیره‌شده'}
      </button>
    </div>
  );
}

function EditProductModal({ slug, onClose, onSaved, categories, brands }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [newSku, setNewSku] = useState({ code: '', price_toman: '', cost_price_toman: '0', stock: '0', variant_key: 'نوع', variant_value: 'استاندارد' });
  const [confirmArchive, setConfirmArchive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch(`/admin/products/${encodeURIComponent(slug)}`);
      setDetail(res.product);
      setForm({
        name: res.product.name,
        description: res.product.description || '',
        status: res.product.status,
        category_id: res.product.category ? (categories.find((c) => c.name === res.product.category.name)?.id || '') : '',
        brand_id: res.product.brand ? (brands.find((b) => b.name === res.product.brand.name)?.id || '') : ''
      });
    } catch (error) {
      setErr(error);
    } finally {
      setLoading(false);
    }
  }, [slug, categories, brands]);

  useEffect(() => { load(); }, [load]);

  const saveProduct = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg('');
    try {
      await apiFetch(`/admin/products/${detail.id}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          description: form.description,
          status: form.status,
          category_id: form.category_id || null,
          brand_id: form.brand_id || null
        }
      });
      setMsg('اطلاعات محصول ذخیره شد.');
      await load();
      onSaved?.();
    } catch (error) {
      setErr(error);
    } finally {
      setBusy(false);
    }
  };

  const updateSku = async (sku, patch) => {
    setBusy(true);
    setErr(null);
    setMsg('');
    try {
      await apiFetch(`/admin/skus/${sku.id}`, { method: 'PATCH', body: patch });
      setMsg('تنوع کالا به‌روزرسانی شد.');
      await load();
      onSaved?.();
    } catch (error) {
      setErr(error);
    } finally {
      setBusy(false);
    }
  };

  const addSku = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg('');
    try {
      await apiFetch(`/admin/products/${detail.id}/skus`, {
        method: 'POST',
        body: {
          code: newSku.code || undefined,
          price_toman: Number(newSku.price_toman),
          cost_price_toman: Number(newSku.cost_price_toman || 0),
          stock: Number(newSku.stock || 0),
          variant_attrs: { [newSku.variant_key || 'نوع']: newSku.variant_value || 'استاندارد' }
        }
      });
      setNewSku({ code: '', price_toman: '', cost_price_toman: '0', stock: '0', variant_key: 'نوع', variant_value: 'استاندارد' });
      setMsg('تنوع جدید اضافه شد.');
      await load();
      onSaved?.();
    } catch (error) {
      setErr(error);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    setMsg('');
    try {
      await uploadImages(detail.id, files, detail.name);
      setMsg('تصویر محصول آپلود شد.');
      await load();
      onSaved?.();
    } catch (error) {
      setErr(error);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const archive = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/admin/console/products/${detail.id}/archive`, { method: 'POST' });
      setMsg(res.archived ? res.message : 'محصول حذف شد.');
      onSaved?.();
      onClose();
    } catch (error) {
      setErr(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon="edit"
      wide
      title={detail ? `مدیریت «${detail.name}»` : 'مدیریت محصول'}
      subtitle="ویرایش مشخصات، قیمت‌ها، موجودی و تصاویر محصول"
    >
      {loading && <AdminLoading label="در حال دریافت محصول..." />}
      {!loading && err && !detail && <AdminError error={err} onRetry={load} />}
      {!loading && detail && form && (
        <div className="ac-form">
          <Toast kind={err ? 'error' : 'ok'} onClose={() => { setErr(null); setMsg(''); }}>{err ? err.message : msg}</Toast>
          <form onSubmit={saveProduct} className="ac-form-grid">
            <Field label="نام محصول" required span={2}>
              <input className="ac-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="وضعیت">
              <select className="ac-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">فعال</option>
                <option value="draft">پیش‌نویس</option>
                <option value="archived">بایگانی</option>
              </select>
            </Field>
            <Field label="دسته‌بندی">
              <select className="ac-select" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">بدون دسته</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="برند">
              <select className="ac-select" value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
                <option value="">بدون برند</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="توضیحات" span={3}>
              <textarea className="ac-textarea" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div className="ac-span-3 ac-form-actions">
              <button type="submit" className="ac-btn ac-btn-primary" disabled={busy}>ذخیرهٔ اطلاعات</button>
              {!confirmArchive ? (
                <button type="button" className="ac-btn ac-btn-danger-ghost" onClick={() => setConfirmArchive(true)} disabled={busy}>
                  <Icon name="archive" size={15} color="currentColor" /> حذف / بایگانی
                </button>
              ) : (
                <span className="ac-inline-confirm">
                  مطمئن هستید؟
                  <button type="button" className="ac-btn ac-btn-danger ac-btn-sm" onClick={archive} disabled={busy}>بله، حذف کن</button>
                  <button type="button" className="ac-btn ac-btn-ghost ac-btn-sm" onClick={() => setConfirmArchive(false)}>انصراف</button>
                </span>
              )}
            </div>
          </form>

          <div className="ac-divider"><span>تنوع‌ها و قیمت‌گذاری</span></div>
          <div className="ac-sku-list">
            {(detail.skus || []).map((sku) => (
              <SkuEditRow key={sku.id} sku={sku} busy={busy} onSave={updateSku} />
            ))}
            {(!detail.skus || detail.skus.length === 0) && <EmptyHint icon="package" title="هنوز تنوعی ثبت نشده" description="برای فروش محصول حداقل یک تنوع با قیمت اضافه کنید." />}
          </div>

          <form onSubmit={addSku} className="ac-add-sku">
            <strong>افزودن تنوع جدید</strong>
            <div className="ac-form-grid ac-form-grid-5">
              <Field label="کد"><input className="ac-input ac-input-sm" dir="ltr" value={newSku.code} onChange={(e) => setNewSku({ ...newSku, code: e.target.value })} placeholder="خودکار" /></Field>
              <Field label="قیمت فروش *"><input type="number" min="0" required className="ac-input ac-input-sm" value={newSku.price_toman} onChange={(e) => setNewSku({ ...newSku, price_toman: e.target.value })} /></Field>
              <Field label="خرید"><input type="number" min="0" className="ac-input ac-input-sm" value={newSku.cost_price_toman} onChange={(e) => setNewSku({ ...newSku, cost_price_toman: e.target.value })} /></Field>
              <Field label="موجودی"><input type="number" min="0" className="ac-input ac-input-sm" value={newSku.stock} onChange={(e) => setNewSku({ ...newSku, stock: e.target.value })} /></Field>
              <Field label="ویژگی">
                <div className="ac-inline-field">
                  <input className="ac-input ac-input-sm" value={newSku.variant_key} onChange={(e) => setNewSku({ ...newSku, variant_key: e.target.value })} />
                  <input className="ac-input ac-input-sm" value={newSku.variant_value} onChange={(e) => setNewSku({ ...newSku, variant_value: e.target.value })} />
                </div>
              </Field>
            </div>
            <button type="submit" className="ac-btn ac-btn-soft" disabled={busy}><Icon name="plus" size={15} /> افزودن تنوع</button>
          </form>

          <div className="ac-divider"><span>تصاویر محصول</span></div>
          <div className="ac-image-row">
            {(detail.images || []).map((img) => (
              <span className="ac-image-tile" key={img.id}><img src={img.path} alt={img.alt_text || detail.name} /></span>
            ))}
            <label className="ac-upload-tile">
              <Icon name="image" size={22} />
              <span>افزودن تصویر</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={upload} />
            </label>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ProductsPanel({ autoCreate = 0 }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editSlug, setEditSlug] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (autoCreate > 0) setCreateOpen(true);
  }, [autoCreate]);

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '24');
    p.set('page', String(page));
    if (query) p.set('q', query);
    if (status) p.set('status', status);
    if (lowStock) p.set('low_stock', '1');
    return `/admin/console/products?${p.toString()}`;
  }, [query, status, lowStock, page]);

  const { data, loading, error, reload, refreshing } = useAdminData(path);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  if (loading && !data) return <AdminLoading />;
  if (error && !data) return <AdminError error={error} onRetry={reload} />;

  const products = data?.items || [];
  const categories = data?.categories || [];
  const brands = data?.brands || [];
  const activeCount = products.filter((p) => p.status === 'active').length;

  return (
    <div className="ac-panel">
      <Toast onClose={() => setToast('')}>{toast}</Toast>

      <div className="ac-panel-head">
        <div>
          <h2>محصولات و موجودی</h2>
          <p>افزودن کالا، دسته‌بندی، برند و کنترل کامل قیمت و موجودی — همه در یک‌جا.</p>
        </div>
        <button type="button" className="ac-btn ac-btn-primary" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={17} color="#fff" /> افزودن محصول
        </button>
      </div>

      <div className="ac-stats ac-stats-4">
        <StatCard icon="package" label="کل کالاها" value={formatNumber(data?.total ?? 0)} sub={`${formatNumber(activeCount)} کالای فعال در این صفحه`} />
        <StatCard icon="hash" label="تنوع‌های ثبت‌شده" value={formatNumber(products.reduce((sum, p) => sum + (p.sku_count || 0), 0))} sub="در نتایج فعلی" tone="rose" />
        <StatCard icon="archive" label="موجودی کل" value={formatNumber(products.reduce((sum, p) => sum + (p.total_stock || 0), 0))} sub="مجموع واحدهای انبار" tone="plum" />
        <StatCard icon="alert" label="کالاهای کم‌موجودی" value={formatNumber(products.filter((p) => p.total_stock <= 5).length)} sub="۵ عدد یا کمتر" tone="amber" />
      </div>

      <SectionCard
        title="کاتالوگ محصولات"
        subtitle="جست‌وجو، فیلتر و ویرایش سریع"
        icon="bag"
        action={(
          <div className="ac-toolbar">
            <div className="ac-search">
              <Icon name="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، برند یا کد SKU..." />
              {q && <button type="button" className="ac-search-clear" onClick={() => setQ('')} aria-label="پاک کردن"><Icon name="x" size={13} /></button>}
            </div>
            <select className="ac-select ac-select-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">همهٔ وضعیت‌ها</option>
              <option value="active">فعال</option>
              <option value="draft">پیش‌نویس</option>
              <option value="archived">بایگانی</option>
            </select>
            <button type="button" className={`ac-toggle ${lowStock ? 'is-on' : ''}`} onClick={() => { setLowStock((v) => !v); setPage(1); }}>
              کم‌موجود
            </button>
            <button type="button" className="ac-icon-btn" title="بروزرسانی" onClick={reload}>
              <Icon name="refresh" size={16} className={refreshing ? 'ac-spin' : ''} />
            </button>
          </div>
        )}
      >
        {products.length === 0 ? (
          <EmptyHint icon="package" title="محصولی یافت نشد" description="با دکمهٔ «افزودن محصول» اولین کالای خود را ثبت کنید." />
        ) : (
          <div className="ac-product-grid">
            {products.map((product) => (
              <article className="ac-product-card" key={product.id}>
                <div className="ac-product-media">
                  <ProductThumb product={product} size={72} />
                  <span className="ac-product-status"><StatusPill status={product.status} /></span>
                </div>
                <h4 title={product.name}>{product.name}</h4>
                <div className="ac-product-meta">
                  <span><Icon name="folder" size={12} /> {product.category_name || 'بدون دسته'}</span>
                  <span><Icon name="hash" size={12} /> {formatNumber(product.sku_count)} تنوع</span>
                </div>
                <div className="ac-product-foot">
                  <div>
                    <span className="ac-price">
                      {product.min_price_toman === null ? 'بدون قیمت' : formatMoney(product.min_price_toman)}
                    </span>
                    <span className="ac-stock">
                      موجودی {formatNumber(product.total_stock)}
                      {product.total_stock <= 5 && <Badge tone="warn">کم‌موجود</Badge>}
                    </span>
                  </div>
                  <button type="button" className="ac-btn ac-btn-soft ac-btn-sm" onClick={() => setEditSlug(product.slug)}>
                    <Icon name="edit" size={14} /> مدیریت
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        <Pagination page={data?.page || 1} limit={data?.limit || 24} total={data?.total || 0} onChange={setPage} />
      </SectionCard>

      <CreateProductModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        categories={categories}
        brands={brands}
        onCreated={(product) => {
          setToast(`محصول «${product.name}» با موفقیت اضافه شد.`);
          reload();
        }}
      />

      {editSlug && (
        <EditProductModal
          slug={editSlug}
          categories={categories}
          brands={brands}
          onClose={() => setEditSlug(null)}
          onSaved={() => { setToast('تغییرات محصول ذخیره شد.'); reload(); }}
        />
      )}
    </div>
  );
}
