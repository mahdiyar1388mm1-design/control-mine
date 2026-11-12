import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatDateTime, ROLE_LABELS } from '../../lib/format';
import { ConfirmDialog, ErrorState, FieldErrorsList, LoadingState, StatusBadge } from '../../components/StateViews';
import { AdminLthPanel } from './AdminLthPanel';
import { AdminCatalogPanel } from './AdminCatalogPanel';
import { BrandsPanel } from './admin/BrandsPanel';

export function AdminManagementPanel() {
  const [tab, setTab] = useState('lth'); // lth | catalog | brands | users | settings | audit
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');
  const [opErr, setOpErr] = useState(null);
  const [busy, setBusy] = useState(false);

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
    if (tab === 'lth' || tab === 'catalog' || tab === 'brands') {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (tab === 'users') {
        const res = await apiFetch('/admin/users?limit=50');
        setUsers(res.items || []);
      } else if (tab === 'settings') {
        const res = await apiFetch('/admin/settings');
        setSettings({
          store_name: res.settings.store_name,
          shipping_flat_toman: res.settings.shipping_flat_toman ?? res.settings.flatToman,
          shipping_free_over_toman: res.settings.shipping_free_over_toman ?? res.settings.freeOverToman,
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
        <button type="button" className={`tab-btn ${tab === 'brands' ? 'active' : ''}`} onClick={() => setTab('brands')}>🏷️ برندها و لوگو</button>
        <button type="button" className={`tab-btn ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>👥 کاربران و نقش‌ها</button>
        <button type="button" className={`tab-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>⚙️ تنظیمات ارسال</button>
        <button type="button" className={`tab-btn ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>🛡️ سابقهٔ ممیزی (Audit Log)</button>
      </div>

      {tab === 'lth' && <AdminLthPanel />}
      {tab === 'catalog' && <AdminCatalogPanel />}
      {tab === 'brands' && <BrandsPanel />}

      {tab !== 'lth' && tab !== 'catalog' && tab !== 'brands' && (
        <>
          {msg && <div className="alert-inline ok">✓ {msg}</div>}
          {opErr && (
            <>
              <div className="alert-inline error">⚠️ {opErr.message}</div>
              <FieldErrorsList details={opErr.details} />
            </>
          )}

          {loading && <LoadingState />}
          {!loading && error && <ErrorState error={error} onRetry={loadTab} />}

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
                <label className="form-label">علت تغییر (ثبت در ممیزی) <span className="req-star">*</span></label>
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
        </>
      )}

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
