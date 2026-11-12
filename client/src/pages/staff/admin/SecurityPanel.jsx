import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDateTime, formatNumber, ROLE_LABELS } from '../../../lib/format';
import { Icon } from '../../../components/Icon';
import { useAuth } from '../../../context/AuthContext';
import {
  AdminError, AdminLoading, Badge, EmptyHint, SectionCard, StatCard, Toast, useAdminData
} from './AdminUi';

const SEVERITY = {
  ok: { label: 'سالم', tone: 'ok' },
  critical: { label: 'بحرانی', tone: 'danger' },
  high: { label: 'مهم', tone: 'warn' },
  medium: { label: 'متوسط', tone: 'pink' },
  low: { label: 'کم', tone: 'pink' }
};

function ScoreRing({ score }) {
  const tone = score >= 90 ? '#15803d' : score >= 70 ? '#b45309' : '#dc2626';
  const deg = Math.round((score / 100) * 360);
  return (
    <div className="ac-score" style={{ '--score-deg': `${deg}deg`, '--score-tone': tone }}>
      <div className="ac-score-inner">
        <strong>{formatNumber(score)}٪</strong>
        <span>وضعیت امنیتی</span>
      </div>
    </div>
  );
}

function bytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '۰ بایت';
  if (n < 1024) return `${formatNumber(n)} بایت`;
  if (n < 1024 * 1024) return `${formatNumber(Math.round(n / 1024))} کیلوبایت`;
  return `${formatNumber(Math.round(n / (1024 * 1024)))} مگابایت`;
}

export function SecurityPanel() {
  const { user } = useAuth();
  const posture = useAdminData('/admin/console/security/posture', { autoRefreshMs: 60000 });
  const database = useAdminData('/admin/console/security/database');
  const [toast, setToast] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [chain, setChain] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [attempts, setAttempts] = useState(null);
  const [password, setPassword] = useState('');
  // step-up proof kept in memory only (never persisted), 15-minute validity
  const [proof, setProof] = useState(null);
  const [proofMinutes, setProofMinutes] = useState(0);
  const [mfaUsers, setMfaUsers] = useState(null);
  const [resetReason, setResetReason] = useState('');

  const reloadAll = () => {
    posture.reload();
    database.reload();
  };

  const loadSessions = async () => {
    try {
      const res = await apiFetch('/admin/console/security/sessions?limit=20');
      setSessions(res.items || []);
    } catch (error) { setErr(error); }
  };
  const loadAttempts = async () => {
    try {
      const res = await apiFetch('/admin/console/security/login-attempts?limit=20&only_failures=1');
      setAttempts(res.items || []);
    } catch (error) { setErr(error); }
  };
  const loadMfa = async () => {
    try {
      const res = await apiFetch('/admin/console/security/mfa');
      setMfaUsers(res.items || []);
    } catch (error) { setErr(error); }
  };

  useEffect(() => {
    loadSessions();
    loadAttempts();
    loadMfa();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  const verifyChain = async () => {
    setBusy('chain');
    setErr(null);
    try {
      const res = await apiFetch('/admin/console/security/audit-chain');
      setChain(res);
      setToast(res.ok ? 'زنجیرهٔ ممیزی سالم است؛ هیچ دستکاری‌ای یافت نشد.' : 'زنجیرهٔ ممیزی ناسازگار است!');
    } catch (error) { setErr(error); } finally { setBusy(''); }
  };

  const runHousekeeping = async () => {
    setBusy('hk');
    setErr(null);
    try {
      const res = await apiFetch('/admin/console/security/database/housekeeping', {
        method: 'POST', body: { reason: 'پاک‌سازی دوره‌ای از پنل امنیت' }
      });
      setToast(`پاک‌سازی انجام شد؛ ${Object.entries(res.removed || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(' — ') || 'موردی برای حذف نبود'}`);
      database.reload();
    } catch (error) { setErr(error); } finally { setBusy(''); }
  };

  const makeBackup = async () => {
    setBusy('backup');
    setErr(null);
    try {
      const res = await apiFetch('/admin/console/security/database/backup', {
        method: 'POST', body: { reason: 'پشتیبان‌گیری دستی مدیر' }
      });
      setToast(`پشتیبان ${res.backup.name} (${bytes(res.backup.size_bytes)}) ساخته شد.`);
      database.reload();
    } catch (error) { setErr(error); } finally { setBusy(''); }
  };

  const revokeSession = async (id) => {
    setBusy(id);
    setErr(null);
    try {
      await apiFetch(`/admin/console/security/sessions/${id}`, { method: 'DELETE' });
      setToast('نشست بسته شد.');
      await loadSessions();
    } catch (error) { setErr(error); } finally { setBusy(''); }
  };

  if (posture.loading && !posture.data) return <AdminLoading label="در حال ارزیابی وضعیت امنیتی سامانه..." />;
  if (posture.error && !posture.data) return <AdminError error={posture.error} onRetry={posture.reload} />;

  const p = posture.data;
  const failedChecks = (p.checks || []).filter((c) => !c.ok);
  const db = database.data;

  return (
    <div className="ac-panel">
      <Toast kind={err ? 'error' : 'ok'} onClose={() => { setErr(null); setToast(''); }}>
        {err ? err.message : toast}
      </Toast>

      <div className="ac-panel-head">
        <div>
          <h2>مرکز امنیت و سلامت داده‌ها</h2>
          <p>ارزیابی زندهٔ سیاست‌ها، سلامت زنجیرهٔ ممیزی، نشست‌ها و عمق پایگاه داده — با ثبت هر اقدام در ممیزی.</p>
        </div>
        <button type="button" className="ac-btn ac-btn-ghost" onClick={reloadAll} disabled={posture.refreshing}>
          <Icon name="refresh" size={16} color="currentColor" /> بازبینی
        </button>
      </div>

      <div className="ac-security-top">
        <div className="ac-card ac-security-score">
          <ScoreRing score={p.score || 0} />
          <div>
            <strong>امتیاز انطباق امنیتی</strong>
            <p className="muted">
              {failedChecks.length === 0
                ? 'همهٔ کنترل‌های پیکربندی فعال‌اند.'
                : `${formatNumber(failedChecks.length)} کنترل نیازمند اقدام است.`}
            </p>
            <div className="ac-chip-row">
              <Badge tone="pink">محیط: {p.environment.env}</Badge>
              <Badge tone="pink">Node {p.environment.node}</Badge>
              <Badge tone="info">{p.environment.version}</Badge>
            </div>
          </div>
        </div>

        <div className="ac-stat-grid ac-stat-grid-4">
          <StatCard icon="users" label="کاربران فعال" value={formatNumber(p.users.active)} sub={`${formatNumber(p.users.suspended)} حساب غیرفعال`} />
          <StatCard icon="shield" label="نشست‌های فعال" value={formatNumber(p.auth.sessions_active)} sub={`${formatNumber(p.auth.refresh_active)} توکن تازه‌سازی`} tone="pink" />
          <StatCard icon="alert" label="ورود ناموفق (۲۴ ساعت)" value={formatNumber(p.auth.failed_last_24h)} sub={`${formatNumber(p.auth.locked_phones)} شماره در آستانهٔ قفل`} tone={p.auth.failed_last_24h > 20 ? 'danger' : 'pink'} />
          <StatCard icon="inbox" label="رکورد ممیزی" value={formatNumber(p.audit.entries)} sub={p.audit.last_entry_at ? `آخرین: ${formatDateTime(p.audit.last_entry_at)}` : 'خالی'} />
          {p.mfa && (
            <StatCard
              icon="lock"
              label="ورود دومرحله‌ای مدیران"
              value={`${formatNumber(p.mfa.with_mfa)} / ${formatNumber(p.mfa.privileged_users)}`}
              sub={p.mfa.without_mfa > 0 ? `${formatNumber(p.mfa.without_mfa)} حساب مدیریتی بدون ۲FA` : 'همهٔ حساب‌های مدیریتی پوشش داده شده‌اند'}
              tone={p.mfa.without_mfa > 0 ? 'danger' : 'ok'}
            />
          )}
        </div>
      </div>

      <div className="ac-detail-grid">
        <SectionCard
          title="ورود دومرحله‌ای حساب‌های حساس"
          subtitle="پوشش TOTP و بازنشانی اضطراری برای مدیران، مالی، اپراتور و پشتیبانی"
          icon="lock"
        >
          {!mfaUsers && <p className="muted">در حال خواندن وضعیت ورود دومرحله‌ای...</p>}
          {mfaUsers && mfaUsers.filter((u) => u.enabled).length === 0 && (
            <p className="muted">
              هیچ حساب حساسی ورود دومرحله‌ای فعال ندارد. کاربران می‌توانند از صفحهٔ حساب خود
              («ورود دومرحله‌ای») آن را فعال کنند؛ پوشش در امتیاز امنیتی لحاظ می‌شود.
            </p>
          )}
          {mfaUsers && mfaUsers.filter((u) => u.enabled).length > 0 && (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr><th>کاربر</th><th>نقش</th><th>وضعیت ۲FA</th><th>کد بازیابی</th><th>اقدام</th></tr>
                </thead>
                <tbody>
                  {mfaUsers.filter((u) => u.enabled).map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.full_name}</strong>
                        <small className="mono" dir="ltr">{u.phone}</small>
                      </td>
                      <td>{ROLE_LABELS[u.role] || u.role}</td>
                      <td><Badge tone={u.enabled ? 'ok' : 'warn'}>{u.enabled ? 'فعال' : 'غیرفعال'}</Badge></td>
                      <td>{u.enabled ? formatNumber(u.recovery_left || 0) : '—'}</td>
                      <td>
                        {u.enabled ? (
                          <button
                            type="button"
                            className="ac-btn ac-btn-danger-ghost"
                            disabled={!proof || resetReason.trim().length < 10 || busy === `mfa-${u.id}`}
                            title={!proof ? 'ابتدا هویت خود را تأیید کنید' : (resetReason.trim().length < 10 ? 'دلیل بازنشانی را (حداقل ۱۰ نویسه) بنویسید' : '')}
                            onClick={async () => {
                              setBusy(`mfa-${u.id}`);
                              setErr(null);
                              try {
                                await apiFetch(`/admin/console/security/mfa/${u.id}/reset`, {
                                  method: 'POST',
                                  body: { reauth_proof: proof, reason: resetReason.trim() }
                                });
                                setToast(`ورود دومرحله‌ای ${u.full_name} بازنشانی شد؛ نشست‌های او بسته شد.`);
                                setResetReason('');
                                await loadMfa();
                                await loadSessions();
                                posture.reload();
                              } catch (error) { setErr(error); } finally { setBusy(''); }
                            }}
                          >
                            بازنشانی
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="ac-form-row">
            <input
              type="text"
              placeholder="دلیل بازنشانی (اجباری، حداقل ۱۰ نویسه)"
              value={resetReason}
              onChange={(e) => setResetReason(e.target.value)}
              maxLength={300}
            />
            <span className={`ac-chip ${proof ? 'ok' : 'warn'}`}>
              {proof ? `هویت تأییدشده (${formatNumber(proofMinutes)} دقیقه)` : 'بدون تأیید هویت'}
            </span>
          </div>
          <p className="muted ac-hint">
            بازنشانی فقط زمانی لازم است که کاربر دسترسی به اپلیکیشن احراز هویت خود را از دست بدهد؛
            همهٔ نشست‌ها و توکن‌های تازه‌سازی او بسته می‌شود و رویداد در زنجیرهٔ ممیزی ثبت می‌گردد.
            حساب خودتان از این مسیر قابل بازنشانی نیست.
          </p>
        </SectionCard>

        <SectionCard
          title="کنترل‌های پیکربندی"
          subtitle={p.score_scope === 'production'
            ? 'هر مورد مستقیماً از تنظیمات زندهٔ سرور خوانده می‌شود'
            : 'امتیاز بر پایهٔ کنترل‌های مؤثر در محیط توسعه محاسبه شده؛ موارد «محیط توسعه» از امتیاز کنار گذاشته شده‌اند.'}
          icon="shieldCheck"
        >
          <ul className="ac-check-list">
            {p.checks.map((c) => (
              <li key={c.id} className={`ac-check ${c.ok ? 'ok' : 'bad'}`}>
                <span className="ac-check-ico"><Icon name={c.ok ? 'check' : 'x'} size={15} color="currentColor" /></span>
                <div>
                  <strong>
                    {c.label}
                    {c.dev_only && !c.ok && <span className="ac-check-dev">محیط توسعه</span>}
                  </strong>
                  <small>{c.detail}</small>
                </div>
                <Badge tone={SEVERITY[c.severity] ? SEVERITY[c.severity].tone : 'pink'}>
                  {SEVERITY[c.severity] ? SEVERITY[c.severity].label : c.severity}
                </Badge>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="سیاست فعال احراز هویت" subtitle="اعمال‌شده سمت سرور؛ قابل مشاهده برای مدیر" icon="lock">
          <div className="ac-kv">
            <div><span>حداقل طول رمز</span><strong>{formatNumber(p.policy.password.min_length)} نویسه</strong></div>
            <div><span>الزام حرف بزرگ/کوچک/رقم/نشانه</span><strong>فعال</strong></div>
            <div><span>تاریخچهٔ رمز</span><strong>{formatNumber(p.policy.password.history_depth)} رمز اخیر</strong></div>
            <div><span>قفل پس از تلاش ناموفق</span><strong>{formatNumber(p.policy.login_max_failures)} تلاش / {formatNumber(p.policy.lock_minutes)} دقیقه</strong></div>
            <div><span>عمر توکن دسترسی</span><strong>{formatNumber(Math.round(p.policy.session_ttl_seconds / 60))} دقیقه</strong></div>
            <div><span>توکن تازه‌سازی</span><strong>{formatNumber(Math.round(p.policy.refresh_ttl_seconds / 86400))} روز (چرخشی)</strong></div>
            <div><span>مهلت بی‌فعالیتی نشست</span><strong>{formatNumber(Math.round(p.policy.idle_timeout_seconds / 86400))} روز</strong></div>
            <div><span>تأیید مجدد برای اقدام حساس</span><strong>{formatNumber(p.policy.sensitive_reauth_minutes)} دقیقه</strong></div>
            <div><span>سقف درخواست API هر دقیقه</span><strong>{formatNumber(p.policy.api_rate_limit_per_minute)}</strong></div>
            <div><span>کوکی Secure</span><strong>{p.policy.secure_cookies ? 'فعال' : 'غیرفعال'}</strong></div>
          </div>
          <div className="ac-panel-actions">
            <input
              className="ac-input"
              type="password"
              placeholder="رمز خود را برای تأیید مجدد وارد کنید"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="ac-btn"
              disabled={!password || busy === 'reauth'}
              onClick={async () => {
                setBusy('reauth');
                setErr(null);
                try {
                  const res = await apiFetch('/auth/verify-identity', { method: 'POST', body: { password, purpose: 'sensitive' } });
                  setPassword('');
                  setProof(res.proof);
                  setProofMinutes(res.valid_minutes);
                  setToast(`هویت تأیید شد؛ اعتبار ${formatNumber(res.valid_minutes)} دقیقه.`);
                } catch (error) { setErr(error); } finally { setBusy(''); }
              }}
            >
              تأیید هویت
            </button>
          </div>
          <p className="muted ac-hint">پس از تأیید، جابه‌جایی خزانه بالای یک میلیون تومان و تغییر نقش/وضعیت کاربران بدون پرسش دوبارهٔ رمز انجام می‌شود (تا انقضای اعتبار).</p>
        </SectionCard>

        <SectionCard title="پایگاه داده و یکپارچگی" subtitle="شناسنامهٔ زندهٔ اسکیما، حجم و پشتیبان‌ها" icon="folder">
          {!db && database.loading && <p className="muted">در حال خواندن شناسنامهٔ پایگاه داده...</p>}
          {db && (
            <>
              <div className="ac-kv">
                <div><span>نسخهٔ اسکیما</span><strong>{formatNumber(db.schema_version)}</strong></div>
                <div><span>حالت ژورنال</span><strong>{db.journal_mode}</strong></div>
                <div><span>یکپارچگی فایل</span><strong>{db.integrity.ok ? 'سالم' : 'نیازمند بررسی'}</strong></div>
                <div><span>نقض کلید خارجی</span><strong>{formatNumber(db.foreign_key_violations)}</strong></div>
                <div><span>جدول‌ها / ایندکس‌ها / تریگرها</span><strong>{formatNumber(db.counts.tables)} / {formatNumber(db.counts.indexes)} / {formatNumber(db.counts.triggers)}</strong></div>
                <div><span>حجم فایل اصلی</span><strong>{db.disk ? bytes(db.disk.size_bytes) : '—'}</strong></div>
                <div><span>حجم WAL</span><strong>{db.disk ? bytes(db.disk.wal_size_bytes) : '—'}</strong></div>
                <div><span>آخرین پاک‌سازی</span><strong>{db.retention.last_housekeeping_at ? formatDateTime(db.retention.last_housekeeping_at) : 'انجام‌نشده'}</strong></div>
              </div>
              <div className="ac-panel-actions">
                <button type="button" className="ac-btn ac-btn-ghost" onClick={runHousekeeping} disabled={busy === 'hk'}>
                  <Icon name="refresh" size={15} color="currentColor" /> پاک‌سازی داده‌های منقضی
                </button>
                <button type="button" className="ac-btn ac-btn-ghost" onClick={makeBackup} disabled={busy === 'backup'}>
                  <Icon name="archive" size={15} color="currentColor" /> پشتیبان رمزنگاری‌شده
                </button>
                <button type="button" className="ac-btn ac-btn-ghost" onClick={verifyChain} disabled={busy === 'chain'}>
                  <Icon name="shieldCheck" size={15} color="currentColor" /> بررسی زنجیرهٔ ممیزی
                </button>
              </div>
              {chain && (
                <div className={`alert-inline ${chain.ok ? 'ok' : 'error'}`}>
                  {chain.ok
                    ? `زنجیرهٔ ممیزی سالم است — ${formatNumber(chain.checked)} رکورد بازمحاسبه شد.`
                    : `زنجیرهٔ ممیزی در رکورد ${chain.broken_at} ناسازگار شد (${chain.reason}).`}
                </div>
              )}
              <div className="ac-table-wrap">
                <table className="ac-table">
                  <thead><tr><th>جدول</th><th>ردیف‌ها</th></tr></thead>
                  <tbody>
                    {db.tables.filter((t) => t.rows !== null).map((t) => (
                      <tr key={t.name}><td dir="ltr">{t.name}</td><td>{formatNumber(t.rows)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {db.backups && db.backups.length > 0 && (
                <div className="ac-backup-list">
                  <strong>آخرین پشتیبان‌ها</strong>
                  <ul>
                    {db.backups.map((b) => (
                      <li key={b.name} dir="ltr">
                        <span>{b.name}</span>
                        <span>{bytes(b.size_bytes)}</span>
                        <span>{b.encrypted ? 'رمزنگاری‌شده' : 'بدون رمز'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard title="نشست‌های باز سامانه" subtitle="آخرین دستگاه‌های واردشده؛ بستن نشست بلافاصله توکن‌ها را باطل می‌کند" icon="users">
          {!sessions && <p className="muted">در حال دریافت نشست‌ها...</p>}
          {sessions && sessions.length === 0 && <EmptyHint icon="users" title="نشست فعالی وجود ندارد" />}
          {sessions && sessions.length > 0 && (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead><tr><th>کاربر</th><th>آخرین فعالیت</th><th>وضعیت</th><th /></tr></thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.full_name}<small className="muted" dir="ltr"> {s.phone}</small></td>
                      <td>{formatDateTime(s.last_used_at || s.created_at)}</td>
                      <td>{s.active ? <Badge tone="ok">فعال</Badge> : <Badge tone="pink">بسته</Badge>}{s.current && <Badge tone="info">همین</Badge>}</td>
                      <td>
                        {s.active && s.id !== s.current && (
                          <button type="button" className="ac-btn ac-btn-ghost ac-btn-sm" onClick={() => revokeSession(s.id)} disabled={busy === s.id}>
                            بستن
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="تلاش‌های ورود ناموفق" subtitle="پایش حملات حدس رمز؛ قفل شماره با ثبت علت آزاد می‌شود" icon="alert">
          {!attempts && <p className="muted">در حال دریافت گزارش...</p>}
          {attempts && attempts.length === 0 && <EmptyHint icon="shieldCheck" title="هیچ تلاش ناموفقی ثبت نشده است" />}
          {attempts && attempts.length > 0 && (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead><tr><th>شماره</th><th>IP</th><th>علت</th><th>زمان</th><th /></tr></thead>
                <tbody>
                  {attempts.map((a, i) => (
                    <tr key={`${a.phone}-${a.created_at}-${i}`}>
                      <td dir="ltr">{a.phone || '—'}</td>
                      <td dir="ltr">{a.ip || '—'}</td>
                      <td>{a.reason || '—'}</td>
                      <td>{formatDateTime(a.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="ac-btn ac-btn-ghost ac-btn-sm"
                          disabled={busy === a.phone}
                          onClick={async () => {
                            setBusy(a.phone);
                            setErr(null);
                            try {
                              await apiFetch('/admin/console/security/unlock', {
                                method: 'POST', body: { phone: a.phone, reason: 'درخواست کاربر و تأیید پشتیبانی' }
                              });
                              setToast(`قفل ${a.phone} برداشته شد.`);
                              await loadAttempts();
                            } catch (error) { setErr(error); } finally { setBusy(''); }
                          }}
                        >
                          رفع قفل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <p className="muted ac-hint">
        عملیات حساس این صفحه با هویت مدیر {user?.full_name || ''} در زنجیرهٔ ممیزی (hash-chained) ثبت می‌شود.
      </p>
    </div>
  );
}
