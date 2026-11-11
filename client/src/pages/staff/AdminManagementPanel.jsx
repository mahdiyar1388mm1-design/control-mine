import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatDateTime, formatMoney, formatNumber, ROLE_LABELS } from '../../lib/format';
import { ConfirmDialog, ErrorState, FieldErrorsList, LoadingState, StatusBadge } from '../../components/StateViews';
import { AdminLthPanel } from './AdminLthPanel';

export function AdminManagementPanel() {
  const [tab, setTab] = useState('lth'); // lth | catalog | services | users | settings | audit
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Catalog state
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [prodForm, setProdForm] = useState({ name: '', description: '', category_id: '', brand_id: '', status: 'active' });
  const [editingProd, setEditingProd] = useState(null);
  const [skuForm, setSkuForm] = useState({ code: '', price_toman: '', cost_price_toman: '', stock: '10', attrKey: 'مدل', attrVal: 'استاندارد' });
  const [deleteTargetProd, setDeleteTargetProd] = useState(null);

  // Services state
  const [services, setServices] = useState([]);
  const [svcForm, setSvcForm] = useState({
    name: '', description: '', terms: '', exclusions: '', price_toman: '0',
    est_duration_text: '۲ روز کاری', sla_hours: '48', team_queue: 'services',
    delivery_method: 'فایل گزارش در پنل', cancel_policy: 'قابل لغو پیش از شروع بررسی',
    fieldLabel: 'شماره سریال یا مشخصه', fieldName: 'item_identifier'
  });
  const [editingSvc, setEditingSvc] = useState(null);

  // Users state
  const [users, setUsers] = useState([]);
  const [userModal, setUserModal] = useState(null);
  const [userNextRole, setUserNextRole] = useState('customer');
  const [userNextStatus, setUserNextStatus] = useState('active');
  const [userReason, setUserReason] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // Settings & Audit
  const [settings, setSettings] = useState({ store_name: '', shipping_flat_toman: 39000, shipping_free_over_toman: 1500000, reason: '' });
  const [audits, setAudits] = useState([]);

  const loadTab = useCallback(async () => {
    if (tab === 'lth') {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (tab === 'catalog') {
        const [p, c, b] = await Promise.all([
          apiFetch('/admin/products?limit=50'),
          apiFetch('/categories'),
          apiFetch('/brands')
        ]);
        setProducts(p.items || []);
        setCategories(c.items || []);
        setBrands(b.items || []);
      } else if (tab === 'services') {
        const res = await apiFetch('/admin/services?limit=50');
        setServices(res.items || []);
      } else if (tab === 'users') {
        const res = await apiFetch('/admin/users?limit=50');
        setUsers(res.items || []);
      } else if (tab === 'settings') {
        const res = await apiFetch('/admin/settings');
        setSettings({
          store_name: res.settings.store_name,
          shipping_flat_toman: res.settings.flatToman,
          shipping_free_over_toman: res.settings.freeOverToman,
          reason: ''
        });
      } else if (tab === 'audit') {
        const res = await apiFetch('/admin/audit?limit=50');
        setAudits(res.items || []);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    loadTab();
  }, [loadTab]);

  /* ---- Catalog Actions ---- */
  const handleCreateProduct = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const created = await apiFetch('/admin/products', {
        method: 'POST',
        body: {
          name: prodForm.name,
          description: prodForm.description,
          category_id: prodForm.category_id || null,
          brand_id: prodForm.brand_id || null,
          status: prodForm.status
        }
      });
      if (skuForm.price_toman !== '') {
        await apiFetch(`/admin/products/${created.product.id}/skus`, {
          method: 'POST',
          body: {
            code: skuForm.code || undefined,
            price_toman: Number(skuForm.price_toman),
            cost_price_toman: Number(skuForm.cost_price_toman || 0),
            stock: Number(skuForm.stock || 0),
            variant_attrs: { [skuForm.attrKey || 'نوع']: skuForm.attrVal || 'استاندارد' }
          }
        });
      }
      setProdForm({ name: '', description: '', category_id: '', brand_id: '', status: 'active' });
      setSkuForm({ code: '', price_toman: '', cost_price_toman: '', stock: '10', attrKey: 'مدل', attrVal: 'استاندارد' });
      setMsg('کالا و SKU اولیه پس از تأیید سرور ایجاد شدند.');
      await loadTab();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const openEditProduct = async (slug) => {
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch(`/admin/products/${encodeURIComponent(slug)}`);
      setEditingProd(res.product);
    } catch (err) {
      setOpErr(err);
    }
  };

  const handleSaveEditProduct = async (e) => {
    e.preventDefault();
    if (!editingProd) return;
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch(`/admin/products/${editingProd.id}`, {
        method: 'PATCH',
        body: {
          name: editingProd.name,
          description: editingProd.description,
          status: editingProd.status
        }
      });
      setEditingProd(res.product);
      setMsg('تغییرات کالا در پایگاه داده ذخیره شد و پس از refresh ماندگار است.');
      await loadTab();
    } catch (err) {
      // §6: Never show "saved" if server request failed
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteProduct = async () => {
    if (!deleteTargetProd) return;
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch(`/admin/products/${deleteTargetProd.id}`, { method: 'DELETE' });
      setDeleteTargetProd(null);
      setMsg(res.archived ? res.message : 'کالا حذف شد.');
      await loadTab();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  /* ---- Services Actions ---- */
  const handleCreateService = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch('/admin/services', {
        method: 'POST',
        body: {
          name: svcForm.name,
          description: svcForm.description,
          terms: svcForm.terms,
          exclusions: svcForm.exclusions,
          price_toman: Number(svcForm.price_toman || 0),
          est_duration_text: svcForm.est_duration_text,
          sla_hours: Number(svcForm.sla_hours || 48),
          team_queue: svcForm.team_queue,
          delivery_method: svcForm.delivery_method,
          cancel_policy: svcForm.cancel_policy,
          form_schema: [
            { name: svcForm.fieldName || 'item_identifier', label: svcForm.fieldLabel || 'مشخصهٔ دستگاه', type: 'text', required: true },
            { name: 'customer_note', label: 'شرح درخواست', type: 'textarea', required: true }
          ]
        }
      });
      setSvcForm({ ...svcForm, name: '', description: '' });
      setMsg('خدمت عملیاتی جدید به همراه نسخهٔ ۱ فرم ایجاد شد.');
      await loadTab();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateService = async (e) => {
    e.preventDefault();
    if (!editingSvc) return;
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      const res = await apiFetch(`/admin/services/${editingSvc.id}`, {
        method: 'PATCH',
        body: {
          name: editingSvc.name,
          price_toman: Number(editingSvc.price_toman),
          sla_hours: Number(editingSvc.sla_hours),
          terms: editingSvc.terms,
          is_active: editingSvc.is_active
        }
      });
      setEditingSvc(null);
      setMsg(`خدمت به‌روزرسانی شد (نسخهٔ فرم جاری: ${res.service.form_version} — پرونده‌های قبلی روی نسخهٔ ثبت‌شدهٔ خود دست‌نخورده باقی ماندند).`);
      await loadTab();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  /* ---- User Sensitive Update ---- */
  const handleConfirmUserUpdate = async () => {
    if (!userModal) return;
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch(`/admin/users/${userModal.id}`, {
        method: 'PATCH',
        body: {
          role: userNextRole,
          status: userNextStatus,
          reason: userReason.trim(),
          current_password: adminPassword
        }
      });
      setUserModal(null);
      setUserReason('');
      setAdminPassword('');
      setMsg('نقش / وضعیت کاربر با تأیید مجدد رمز مدیر و ثبت سابقهٔ ممیزی اعمال شد.');
      await loadTab();
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  /* ---- Settings Save ---- */
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setBusy(true);
    setOpErr(null);
    setMsg('');
    try {
      await apiFetch('/admin/settings', {
        method: 'PATCH',
        body: {
          store_name: settings.store_name,
          shipping_flat_toman: Number(settings.shipping_flat_toman),
          shipping_free_over_toman: Number(settings.shipping_free_over_toman),
          reason: settings.reason.trim()
        }
      });
      setSettings((s) => ({ ...s, reason: '' }));
      setMsg('تنظیمات ارسال و فروشگاه پس از تأیید سرور ذخیره شد.');
    } catch (err) {
      setOpErr(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="tabs">
        <button type="button" className={`tab-btn ${tab === 'lth' ? 'active' : ''}`} onClick={() => setTab('lth')}>🪙 موتور LTH، ریگلاژ استیک و لوگو</button>
        <button type="button" className={`tab-btn ${tab === 'catalog' ? 'active' : ''}`} onClick={() => setTab('catalog')}>🛍️ مدیریت کالاها و SKU</button>
        <button type="button" className={`tab-btn ${tab === 'services' ? 'active' : ''}`} onClick={() => setTab('services')}>⚙️ تعریف خدمات و فرم نسخه‌دار</button>
        <button type="button" className={`tab-btn ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>👥 کاربران و نقش‌ها</button>
        <button type="button" className={`tab-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>⚙️ تنظیمات ارسال</button>
        <button type="button" className={`tab-btn ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>🛡️ سابقهٔ ممیزی (Audit Log)</button>
      </div>

      {tab === 'lth' && <AdminLthPanel />}

      {msg && <div className="alert-inline ok">✓ {msg}</div>}
      {opErr && (
        <>
          <div className="alert-inline error">⚠️ {opErr.message}</div>
          <FieldErrorsList details={opErr.details} />
        </>
      )}

      {loading && <LoadingState />}
      {!loading && error && <ErrorState error={error} onRetry={loadTab} />}

      {/* CATALOG TAB */}
      {!loading && !error && tab === 'catalog' && (
        <div className="two-col-layout">
          <div className="card table-wrap">
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>کالاهای ثبت‌شده</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>نام کالا</th>
                  <th>دسته / برند</th>
                  <th>وضعیت</th>
                  <th>تنوع</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.category_name || '—'} / {p.brand_name || '—'}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>{formatNumber(p.sku_count)}</td>
                    <td className="flex-gap">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditProduct(p.slug)}>ویرایش</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteTargetProd(p)}>حذف / بایگانی</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {editingProd && (
              <form onSubmit={handleSaveEditProduct} style={{ marginTop: 16, padding: 14, background: 'var(--surface-alt)', borderRadius: 8 }}>
                <h4 style={{ marginTop: 0 }}>ویرایش کالا: {editingProd.name}</h4>
                <div className="form-row">
                  <label className="form-label">نام کالا</label>
                  <input className="input" required value={editingProd.name} onChange={(e) => setEditingProd({ ...editingProd, name: e.target.value })} />
                </div>
                <div className="form-row">
                  <label className="form-label">توضیحات</label>
                  <textarea className="textarea" value={editingProd.description} onChange={(e) => setEditingProd({ ...editingProd, description: e.target.value })} />
                </div>
                <div className="form-row">
                  <label className="form-label">وضعیت نمایش</label>
                  <select className="select" value={editingProd.status} onChange={(e) => setEditingProd({ ...editingProd, status: e.target.value })}>
                    <option value="active">فعال (قابل خرید)</option>
                    <option value="draft">پیش‌نویس (غیرقابل خرید)</option>
                    <option value="archived">بایگانی‌شده</option>
                  </select>
                </div>
                <div style={{ fontSize: '0.84rem', marginBottom: 10 }}>
                  <strong>SKUهای این کالا (شامل قیمت خرید محرمانه):</strong>
                  {(editingProd.skus || []).map((s) => (
                    <div key={s.id} className="muted">
                      <span className="mono">{s.code}</span> — فروش: {formatMoney(s.price_toman)} | خرید: {formatMoney(s.cost_price_toman)} | موجودی: {formatNumber(s.stock)}
                    </div>
                  ))}
                </div>
                <div className="flex-gap">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>ذخیره در سرور</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingProd(null)}>بستن</button>
                </div>
              </form>
            )}
          </div>

          <form onSubmit={handleCreateProduct} className="card">
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>افزودن کالای جدید + SKU اولیه</h3>
            <div className="form-row">
              <label className="form-label">نام کالا <span className="req-star">*</span></label>
              <input className="input" required value={prodForm.name} onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })} />
            </div>
            <div className="grid grid-2">
              <div className="form-row">
                <label className="form-label">دسته‌بندی</label>
                <select className="select" value={prodForm.category_id} onChange={(e) => setProdForm({ ...prodForm, category_id: e.target.value })}>
                  <option value="">انتخاب دسته...</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label className="form-label">برند</label>
                <select className="select" value={prodForm.brand_id} onChange={(e) => setProdForm({ ...prodForm, brand_id: e.target.value })}>
                  <option value="">انتخاب برند...</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <label className="form-label">توضیح فنی</label>
              <textarea className="textarea" value={prodForm.description} onChange={(e) => setProdForm({ ...prodForm, description: e.target.value })} />
            </div>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '12px 0' }} />
            <div className="grid grid-2">
              <div className="form-row">
                <label className="form-label">قیمت فروش (تومان) <span className="req-star">*</span></label>
                <input type="number" min="0" required className="input mono" value={skuForm.price_toman} onChange={(e) => setSkuForm({ ...skuForm, price_toman: e.target.value })} />
              </div>
              <div className="form-row">
                <label className="form-label">قیمت خرید محرمانه (تومان)</label>
                <input type="number" min="0" className="input mono" value={skuForm.cost_price_toman} onChange={(e) => setSkuForm({ ...skuForm, cost_price_toman: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-3">
              <div className="form-row">
                <label className="form-label">موجودی اولیه</label>
                <input type="number" min="0" className="input mono" value={skuForm.stock} onChange={(e) => setSkuForm({ ...skuForm, stock: e.target.value })} />
              </div>
              <div className="form-row">
                <label className="form-label">نام ویژگی</label>
                <input className="input" value={skuForm.attrKey} onChange={(e) => setSkuForm({ ...skuForm, attrKey: e.target.value })} />
              </div>
              <div className="form-row">
                <label className="form-label">مقدار ویژگی</label>
                <input className="input" value={skuForm.attrVal} onChange={(e) => setSkuForm({ ...skuForm, attrVal: e.target.value })} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>ایجاد کالا</button>
          </form>
        </div>
      )}

      {/* SERVICES TAB */}
      {!loading && !error && tab === 'services' && (
        <div className="two-col-layout">
          <div className="card table-wrap">
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>خدمات تعریف‌شده و نسخهٔ فرم‌ها</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>نام خدمت</th>
                  <th>تعرفه</th>
                  <th>SLA</th>
                  <th>نسخه فرم</th>
                  <th>وضعیت</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td>{formatMoney(s.price_toman, { freeLabel: true })}</td>
                    <td>{formatNumber(s.sla_hours)} ساعت</td>
                    <td>نسخه {formatNumber(s.form_version)}</td>
                    <td><StatusBadge status={s.is_active ? 'active' : 'archived'} /></td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingSvc({ ...s })}>ویرایش</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {editingSvc && (
              <form onSubmit={handleUpdateService} style={{ marginTop: 14, padding: 14, background: 'var(--surface-alt)', borderRadius: 8 }}>
                <h4 style={{ marginTop: 0 }}>ویرایش خدمت (نسخهٔ فعلی: {formatNumber(editingSvc.form_version)})</h4>
                <div className="form-row">
                  <label className="form-label">نام خدمت</label>
                  <input className="input" required value={editingSvc.name} onChange={(e) => setEditingSvc({ ...editingSvc, name: e.target.value })} />
                </div>
                <div className="grid grid-2">
                  <div className="form-row">
                    <label className="form-label">تعرفه (تومان — ۰ برای رایگان)</label>
                    <input type="number" min="0" className="input mono" value={editingSvc.price_toman} onChange={(e) => setEditingSvc({ ...editingSvc, price_toman: e.target.value })} />
                  </div>
                  <div className="form-row">
                    <label className="form-label">تعهد SLA (ساعت)</label>
                    <input type="number" min="1" className="input mono" value={editingSvc.sla_hours} onChange={(e) => setEditingSvc({ ...editingSvc, sla_hours: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <label className="form-label">شرایط انجام (تغییر آن نسخهٔ جدید می‌سازد)</label>
                  <textarea className="textarea" value={editingSvc.terms} onChange={(e) => setEditingSvc({ ...editingSvc, terms: e.target.value })} />
                </div>
                <label className="flex-gap" style={{ marginBottom: 10 }}>
                  <input type="checkbox" checked={Boolean(editingSvc.is_active)} onChange={(e) => setEditingSvc({ ...editingSvc, is_active: e.target.checked })} />
                  <span>خدمت فعال و قابل ثبت توسط مشتریان باشد</span>
                </label>
                <div className="flex-gap">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>ذخیره و نسخه‌گذاری</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingSvc(null)}>انصراف</button>
                </div>
              </form>
            )}
          </div>

          <form onSubmit={handleCreateService} className="card">
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>تعریف خدمت عملیاتی جدید</h3>
            <div className="form-row">
              <label className="form-label">عنوان خدمت <span className="req-star">*</span></label>
              <input className="input" required value={svcForm.name} onChange={(e) => setSvcForm({ ...svcForm, name: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">توضیح خدمت</label>
              <textarea className="textarea" value={svcForm.description} onChange={(e) => setSvcForm({ ...svcForm, description: e.target.value })} />
            </div>
            <div className="grid grid-2">
              <div className="form-row">
                <label className="form-label">هزینه (تومان — ۰ رایگان)</label>
                <input type="number" min="0" className="input mono" value={svcForm.price_toman} onChange={(e) => setSvcForm({ ...svcForm, price_toman: e.target.value })} />
              </div>
              <div className="form-row">
                <label className="form-label">مهلت SLA (ساعت)</label>
                <input type="number" min="1" className="input mono" value={svcForm.sla_hours} onChange={(e) => setSvcForm({ ...svcForm, sla_hours: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <label className="form-label">شرایط انجام</label>
              <input className="input" value={svcForm.terms} onChange={(e) => setSvcForm({ ...svcForm, terms: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">برچسب فیلد اصلی فرم مشتری</label>
              <input className="input" value={svcForm.fieldLabel} onChange={(e) => setSvcForm({ ...svcForm, fieldLabel: e.target.value })} />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>ثبت خدمت جدید</button>
          </form>
        </div>
      )}

      {/* USERS TAB */}
      {!loading && !error && tab === 'users' && (
        <div className="card table-wrap">
          <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>مدیریت کاربران، نقش‌ها و وضعیت حساب (شماره‌ها به‌صورت پیش‌فرض ماسک شده‌اند)</h3>
          <table className="table">
            <thead>
              <tr>
                <th>نام</th>
                <th>موبایل (ماسک‌شده)</th>
                <th>نقش سازمانی</th>
                <th>وضعیت</th>
                <th>تاریخ عضویت</th>
                <th>عملیات حساس</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.full_name}</strong></td>
                  <td className="mono">{u.phone}</td>
                  <td><span className="badge badge-info">{ROLE_LABELS[u.role] || u.role}</span></td>
                  <td><StatusBadge status={u.status} /></td>
                  <td>{formatDateTime(u.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setUserModal(u);
                        setUserNextRole(u.role);
                        setUserNextStatus(u.status);
                      }}
                    >
                      تغییر نقش / تعلیق
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SETTINGS TAB */}
      {!loading && !error && tab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="card" style={{ maxWidth: 580 }}>
          <h3 style={{ marginTop: 0, fontSize: '1.08rem' }}>تنظیمات پایهٔ فروشگاه و قواعد هزینهٔ ارسال</h3>
          <div className="form-row">
            <label className="form-label">نام نمایشی پلتفرم</label>
            <input className="input" required value={settings.store_name} onChange={(e) => setSettings({ ...settings, store_name: e.target.value })} />
          </div>
          <div className="form-row">
            <label className="form-label">هزینهٔ ثابت ارسال (تومان)</label>
            <input type="number" min="0" className="input mono" required value={settings.shipping_flat_toman} onChange={(e) => setSettings({ ...settings, shipping_flat_toman: e.target.value })} />
          </div>
          <div className="form-row">
            <label className="form-label">سقف خرید جهت ارسال رایگان (تومان)</label>
            <input type="number" min="0" className="input mono" required value={settings.shipping_free_over_toman} onChange={(e) => setSettings({ ...settings, shipping_free_over_toman: e.target.value })} />
          </div>
          <div className="form-row">
            <label className="form-label">علت تغییر جهت ثبت در ممیزی <span className="req-star">*</span></label>
            <input className="input" required minLength={3} placeholder="مثلاً مصوبهٔ تعرفهٔ ارسال پاییز" value={settings.reason} onChange={(e) => setSettings({ ...settings, reason: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>ذخیرهٔ تنظیمات</button>
        </form>
      )}

      {/* AUDIT TAB */}
      {!loading && !error && tab === 'audit' && (
        <div className="card table-wrap">
          <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>سابقهٔ ممیزی عملیات حساس (Audit Log)</h3>
          <table className="table">
            <thead>
              <tr>
                <th>زمان</th>
                <th>انجام‌دهنده</th>
                <th>نقش</th>
                <th>عملیات</th>
                <th>موجودیت</th>
                <th>جزئیات</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td>{formatDateTime(a.created_at)}</td>
                  <td>{a.actor_name || 'سامانه'}</td>
                  <td>{ROLE_LABELS[a.actor_role] || a.actor_role || '—'}</td>
                  <td className="mono">{a.action}</td>
                  <td>{a.entity_type}</td>
                  <td className="mono" style={{ fontSize: '0.78rem' }}>{JSON.stringify(a.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm Delete / Archive Product */}
      <ConfirmDialog
        open={Boolean(deleteTargetProd)}
        title={`حذف یا بایگانی کالای «${deleteTargetProd?.name}»`}
        description="طبق سیاست نگه‌داری سوابق، اگر این کالا در سفارش‌های قبلی ثبت شده باشد حذف فیزیکی نمی‌شود بلکه به وضعیت «بایگانی‌شده» منتقل خواهد شد."
        confirmLabel="تأیید ادامه"
        danger
        busy={busy}
        onCancel={() => setDeleteTargetProd(null)}
        onConfirm={handleConfirmDeleteProduct}
      />

      {/* Confirm Sensitive User Role / Status Change with Re-Auth */}
      <ConfirmDialog
        open={Boolean(userModal)}
        title={`تغییر حساس حساب «${userModal?.full_name}»`}
        description="تغییر نقش یا تعلیق حساب، نشست‌های فعال کاربر را فوراً باطل می‌کند و نیازمند ثبت علت و تأیید مجدد رمز عبور مدیر است."
        confirmLabel="تأیید مجدد و ثبت در ممیزی"
        danger
        busy={busy}
        onCancel={() => setUserModal(null)}
        onConfirm={handleConfirmUserUpdate}
      >
        <div className="grid grid-2">
          <div className="form-row">
            <label className="form-label">نقش سازمانی جدید</label>
            <select className="select" value={userNextRole} onChange={(e) => setUserNextRole(e.target.value)}>
              {Object.entries(ROLE_LABELS).filter(([k]) => k !== 'system').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">وضعیت حساب</label>
            <select className="select" value={userNextStatus} onChange={(e) => setUserNextStatus(e.target.value)}>
              <option value="active">فعال</option>
              <option value="suspended">تعلیق‌شده</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <label className="form-label">علت تغییر (ثبت در ممیزی) <span className="req-star">*</span></label>
          <input className="input" required value={userReason} onChange={(e) => setUserReason(e.target.value)} placeholder="علت تخصیص نقش یا تعلیق..." />
        </div>
        <div className="form-row">
          <label className="form-label">رمز عبور فعلی شما (مدیر) برای تأیید مجدد <span className="req-star">*</span></label>
          <input type="password" className="input" required value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
        </div>
      </ConfirmDialog>
    </div>
  );
}
