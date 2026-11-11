import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatMoney, formatNumber } from '../../lib/format';
import { ConfirmDialog, ErrorState, FieldErrorsList, LoadingState, StatusBadge } from '../../components/StateViews';

const EMPTY_SKU = { code: '', price_toman: '', cost_price_toman: '0', stock: '0', attrKey: 'مدل', attrVal: 'استاندارد' };

export function AdminCatalogPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [opErr, setOpErr] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);

  const [selectedSlug, setSelectedSlug] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [newSku, setNewSku] = useState(EMPTY_SKU);
  const [stockTarget, setStockTarget] = useState(null);
  const [stockForm, setStockForm] = useState({ delta: '', reason: '' });
  const [movements, setMovements] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c, b] = await Promise.all([
        apiFetch('/admin/products?limit=100'),
        apiFetch('/categories'),
        apiFetch('/brands')
      ]);
      setProducts(p.items || []);
      setCategories(c.items || []);
      setBrands(b.items || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const openProduct = async (slug) => {
    setOpErr(null);
    setMsg('');
    setMovements(null);
    try {
      const res = await apiFetch(`/admin/products/${encodeURIComponent(slug)}`);
      setSelectedSlug(slug);
      setDetail(res.product);
      setEditForm({
        name: res.product.name,
        description: res.product.description || '',
        status: res.product.status,
        category_id: res.product.category ? res.product.category.id || '' : '',
        brand_id: res.product.brand ? res.product.brand.id || '' : ''
      });
    } catch (err) {
      setOpErr(err);
    }
  };

  const reloadDetail = async () => {
    if (selectedSlug) await openProduct(selectedSlug);
  };

  const run = async (fn, okMsg) => {
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
      await loadList();
      await reloadDetail();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const saveProduct = (e) => {
    e.preventDefault();
    run(() => apiFetch(`/admin/products/${detail.id}`, {
      method: 'PATCH',
      body: {
        name: editForm.name,
        description: editForm.description,
        status: editForm.status,
        category_id: editForm.category_id || null,
        brand_id: editForm.brand_id || null
      }
    }), 'کالا روی سرور ذخیره شد.');
  };

  const addSku = (e) => {
    e.preventDefault();
    run(() => apiFetch(`/admin/products/${detail.id}/skus`, {
      method: 'POST',
      body: {
        code: newSku.code || undefined,
        price_toman: Number(newSku.price_toman),
        cost_price_toman: Number(newSku.cost_price_toman || 0),
        stock: Number(newSku.stock || 0),
        variant_attrs: { [newSku.attrKey || 'نوع']: newSku.attrVal || 'استاندارد' }
      }
    }), 'تنوع جدید ثبت شد.').then(() => setNewSku(EMPTY_SKU));
  };

  const updateSku = (sku, patch) => {
    run(() => apiFetch(`/admin/skus/${sku.id}`, { method: 'PATCH', body: patch }), 'تنوع به‌روزرسانی شد.');
  };

  const submitStock = (e) => {
    e.preventDefault();
    run(() => apiFetch(`/admin/skus/${stockTarget.id}/stock`, {
      method: 'POST',
      body: { delta: Number(stockForm.delta), reason: stockForm.reason.trim() }
    }), 'موجودی با دلیل ثبت‌شده تغییر کرد.').then(() => {
      setStockTarget(null);
      setStockForm({ delta: '', reason: '' });
    });
  };

  const showMovements = async (sku) => {
    setOpErr(null);
    try {
      const res = await apiFetch(`/admin/skus/${sku.id}/movements`);
      setMovements({ sku, items: res.items || [] });
    } catch (err) {
      setOpErr(err);
    }
  };

  const uploadImages = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !detail) return;
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    fd.append('alt_text', detail.name);
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const res = await fetch(`/api/v1/admin/products/${detail.id}/images`, {
        method: 'POST',
        body: fd,
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data?.error?.message || 'آپلود تصویر ناموفق بود.'), { details: data?.error?.details });
      setMsg('تصاویر روی سرور آپلود شدند.');
      await reloadDetail();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const confirmDelete = () => {
    const target = deleteTarget;
    run(async () => {
      const res = await apiFetch(`/admin/products/${target.id}`, { method: 'DELETE' });
      setMsg(res.archived ? res.message : 'کالا حذف شد.');
      setDeleteTarget(null);
      if (selectedSlug === target.slug) {
        setSelectedSlug(null);
        setDetail(null);
      }
    });
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={loadList} />;

  return (
    <div>
      {msg && <div className="alert-inline ok">✓ {msg}</div>}
      {opErr && (
        <>
          <div className="alert-inline error">⚠️ {opErr.message}</div>
          <FieldErrorsList details={opErr.details} />
        </>
      )}

      <div className="two-col-layout">
        <div className="card table-wrap">
          <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>کالاهای ثبت‌شده</h3>
          <table className="table">
            <thead>
              <tr><th>نام کالا</th><th>دسته / برند</th><th>وضعیت</th><th>تنوع</th><th>عملیات</th></tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.category_name || '—'} / {p.brand_name || '—'}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>{formatNumber(p.sku_count)}</td>
                  <td className="flex-gap">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openProduct(p.slug)}>مدیریت</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(p)}>حذف / بایگانی</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {detail && editForm && (
          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>ویرایش: {detail.name}</h3>

            <form onSubmit={saveProduct}>
              <div className="form-row">
                <label className="form-label">نام کالا</label>
                <input className="input" required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="grid grid-2">
                <div className="form-row">
                  <label className="form-label">دسته‌بندی</label>
                  <select className="select" value={editForm.category_id} onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })}>
                    <option value="">بدون دسته</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-row">
                  <label className="form-label">برند</label>
                  <select className="select" value={editForm.brand_id} onChange={(e) => setEditForm({ ...editForm, brand_id: e.target.value })}>
                    <option value="">بدون برند</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">توضیحات</label>
                <textarea className="textarea" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              </div>
              <div className="form-row">
                <label className="form-label">وضعیت نمایش</label>
                <select className="select" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  <option value="active">فعال (قابل خرید)</option>
                  <option value="draft">پیش‌نویس (غیرقابل خرید)</option>
                  <option value="archived">بایگانی‌شده</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy}>ذخیره کالا</button>
            </form>

            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />

            <h4 style={{ marginTop: 0 }}>تنوع‌ها (SKU)</h4>
            <table className="table">
              <thead>
                <tr><th>کد</th><th>فروش</th><th>خرید (محرمانه)</th><th>موجودی</th><th>فعال</th><th>عملیات</th></tr>
              </thead>
              <tbody>
                {(detail.skus || []).map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.code}</td>
                    <td>
                      <input type="number" min="0" className="input mono" style={{ width: 110 }} defaultValue={s.price_toman}
                        onBlur={(e) => { if (Number(e.target.value) !== s.price_toman) updateSku(s, { price_toman: Number(e.target.value) }); }} />
                    </td>
                    <td>
                      <input type="number" min="0" className="input mono" style={{ width: 110 }} defaultValue={s.cost_price_toman}
                        onBlur={(e) => { if (Number(e.target.value) !== s.cost_price_toman) updateSku(s, { cost_price_toman: Number(e.target.value) }); }} />
                    </td>
                    <td>{formatNumber(s.stock)}</td>
                    <td>
                      <input type="checkbox" checked={s.is_active} disabled={busy} onChange={(e) => updateSku(s, { is_active: e.target.checked })} />
                    </td>
                    <td className="flex-gap">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStockTarget(s)}>تنظیم موجودی</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => showMovements(s)}>تاریخچه</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {stockTarget && (
              <form onSubmit={submitStock} className="card" style={{ marginTop: 12 }}>
                <strong>تغییر موجودی {stockTarget.code} (فعلی: {formatNumber(stockTarget.stock)})</strong>
                <div className="grid grid-2">
                  <div className="form-row">
                    <label className="form-label">تغییر (مثبت یا منفی)</label>
                    <input type="number" required className="input mono" value={stockForm.delta} onChange={(e) => setStockForm({ ...stockForm, delta: e.target.value })} />
                  </div>
                  <div className="form-row">
                    <label className="form-label">دلیل</label>
                    <input required minLength={3} className="input" value={stockForm.reason} onChange={(e) => setStockForm({ ...stockForm, reason: e.target.value })} />
                  </div>
                </div>
                <div className="flex-gap">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>ثبت تغییر</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStockTarget(null)}>انصراف</button>
                </div>
              </form>
            )}

            {movements && (
              <div className="card" style={{ marginTop: 12 }}>
                <strong>تاریخچهٔ موجودی {movements.sku.code}</strong>
                <table className="table">
                  <thead><tr><th>زمان</th><th>تغییر</th><th>دلیل</th><th>انجام‌دهنده</th></tr></thead>
                  <tbody>
                    {movements.items.map((m) => (
                      <tr key={m.id}>
                        <td>{m.created_at}</td>
                        <td className="mono">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                        <td>{m.reason}</td>
                        <td>{m.actor_name || 'سامانه'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form onSubmit={addSku} style={{ marginTop: 16 }}>
              <strong>افزودن تنوع جدید</strong>
              <div className="grid grid-3">
                <div className="form-row">
                  <label className="form-label">کد (اختیاری)</label>
                  <input className="input mono" value={newSku.code} onChange={(e) => setNewSku({ ...newSku, code: e.target.value })} />
                </div>
                <div className="form-row">
                  <label className="form-label">فروش (تومان) *</label>
                  <input type="number" min="0" required className="input mono" value={newSku.price_toman} onChange={(e) => setNewSku({ ...newSku, price_toman: e.target.value })} />
                </div>
                <div className="form-row">
                  <label className="form-label">خرید (تومان)</label>
                  <input type="number" min="0" className="input mono" value={newSku.cost_price_toman} onChange={(e) => setNewSku({ ...newSku, cost_price_toman: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-3">
                <div className="form-row">
                  <label className="form-label">موجودی اولیه</label>
                  <input type="number" min="0" className="input mono" value={newSku.stock} onChange={(e) => setNewSku({ ...newSku, stock: e.target.value })} />
                </div>
                <div className="form-row">
                  <label className="form-label">نام ویژگی</label>
                  <input className="input" value={newSku.attrKey} onChange={(e) => setNewSku({ ...newSku, attrKey: e.target.value })} />
                </div>
                <div className="form-row">
                  <label className="form-label">مقدار ویژگی</label>
                  <input className="input" value={newSku.attrVal} onChange={(e) => setNewSku({ ...newSku, attrVal: e.target.value })} />
                </div>
              </div>
              <button type="submit" className="btn btn-secondary btn-block" disabled={busy}>افزودن تنوع</button>
            </form>

            <div className="form-row" style={{ marginTop: 16 }}>
              <label className="form-label">تصاویر کالا (JPEG/PNG/WebP)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={uploadImages} />
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`حذف یا بایگانی کالای «${deleteTarget?.name}»`}
        description="اگر این کالا سفارش قبلی دارد، حذف نمی‌شود و بایگانی می‌شود."
        confirmLabel="تأیید ادامه"
        danger
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
