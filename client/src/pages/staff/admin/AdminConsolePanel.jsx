import React, { useEffect, useMemo, useState } from 'react';
import { formatDateTime, formatMoney, formatNumber } from '../../../lib/format';
import { Icon } from '../../../components/Icon';
import { useAuth } from '../../../context/AuthContext';
import { AdminError, AdminLoading, Bars, EmptyHint, SectionCard, StatCard, StatusPill, useAdminData } from './AdminUi';
import { ProductsPanel } from './ProductsPanel';
import { PeoplePanel } from './PeoplePanel';
import { OrdersPanel } from './OrdersPanel';
import { TreasuryPanel } from './TreasuryPanel';
import { AuditPanel, SettingsPanel } from './SettingsAuditPanel';
import { AdminLthPanel } from '../AdminLthPanel';

const TABS = [
  { id: 'dashboard', label: 'داشبورد', icon: 'landmark', hint: 'نمای کلی سامانه' },
  { id: 'products', label: 'محصولات', icon: 'package', hint: 'کالا، قیمت و موجودی' },
  { id: 'people', label: 'کاربران', icon: 'users', hint: 'شماره و نام کاربری' },
  { id: 'orders', label: 'سفارش‌ها', icon: 'bag', hint: 'پیگیری فروش' },
  { id: 'treasury', label: 'خزانه', icon: 'coin', hint: 'جریان نقدی خودکار' },
  { id: 'lth', label: 'LTH', icon: 'wallet', hint: 'پروتکل و ریگلاژ' },
  { id: 'settings', label: 'تنظیمات', icon: 'settings', hint: 'فروشگاه و ارسال' },
  { id: 'audit', label: 'ممیزی', icon: 'shield', hint: 'سابقهٔ عملیات' }
];

function validTab(id) {
  return TABS.some((t) => t.id === id) ? id : 'dashboard';
}

function ShortDay(day) {
  const d = new Date(`${day}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'short' }).format(d);
}

function Dashboard({ onNavigate, onCreateProduct }) {
  const { data, loading, error, reload, refreshing } = useAdminData('/admin/console/overview', { autoRefreshMs: 45000 });
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const chartItems = useMemo(() => (data?.sales_last_14_days || []).map((d) => ({
    key: d.day,
    value: d.total_toman,
    label: `${ShortDay(d.day)} — ${d.count} پرداخت`,
    short: ShortDay(d.day).replace(' ', ' ')
  })), [data]);

  if (loading && !data) return <AdminLoading label="در حال آماده‌سازی داشبورد مدیریت..." />;
  if (error && !data) return <AdminError error={error} onRetry={reload} />;

  const k = data.kpis;
  const treasuryLow = k.treasury.balance_toman <= k.treasury.low_balance_toman;
  const maxSale = Math.max(1, ...(data.sales_last_14_days || []).map((d) => d.total_toman));

  return (
    <div className="ac-panel">
      <div className="ac-dash-head">
        <div>
          <span className="ac-eyebrow"><span className="ac-live-dot" /> نمای زندهٔ سامانه</span>
          <h2>همه‌چیز در یک نگاه</h2>
          <p>شاخص‌ها هر ۴۵ ثانیه به‌صورت خودکار بروزرسانی می‌شوند — {formatDateTime(now.toISOString())}</p>
        </div>
        <div className="ac-head-actions">
          <button type="button" className="ac-icon-btn" title="بروزرسانی" onClick={reload}>
            <Icon name="refresh" size={17} className={refreshing ? 'ac-spin' : ''} />
          </button>
          <button type="button" className="ac-btn ac-btn-primary" onClick={onCreateProduct}>
            <Icon name="plus" size={16} color="#fff" /> افزودن محصول
          </button>
        </div>
      </div>

      <div className="ac-stats ac-stats-4">
        <StatCard
          icon="users"
          label="کاربران سامانه"
          value={formatNumber(k.users_total)}
          sub={`${formatNumber(k.customers)} مشتری • ${formatNumber(k.new_users_7d)} عضو جدید در ۷ روز`}
          onClick={() => onNavigate('people')}
        />
        <StatCard
          icon="folder"
          label="فرم‌های تکمیل‌شده"
          value={formatNumber(k.directory.filled_forms)}
          sub={`${formatNumber(k.directory.with_shipping)} نشانی • ${formatNumber(k.directory.with_orders)} سفارش • ${formatNumber(k.directory.with_services)} خدمت`}
          tone="rose"
          onClick={() => onNavigate('people')}
        />
        <StatCard
          icon="creditCard"
          label="درآمد ۳۰ روز"
          value={formatMoney(k.revenue.last30_toman)}
          sub={`امروز ${formatMoney(k.revenue.today_toman)}`}
          tone="plum"
          onClick={() => onNavigate('treasury')}
        />
        <StatCard
          icon="landmark"
          label="موجودی خزانه"
          value={formatMoney(k.treasury.balance_toman)}
          sub={treasuryLow ? 'زیر حد هشدار — بررسی کنید' : `حد هشدار ${formatMoney(k.treasury.low_balance_toman)}`}
          tone={treasuryLow ? 'amber' : 'ok'}
          onClick={() => onNavigate('treasury')}
        />
      </div>

      <div className="ac-stats ac-stats-4 ac-stats-compact">
        <StatCard icon="bag" label="سفارش‌های امروز" value={formatNumber(k.orders.today)} sub={`${formatNumber(k.orders.in_progress)} در جریان`} tone="rose" onClick={() => onNavigate('orders')} />
        <StatCard icon="package" label="کالاهای فعال" value={formatNumber(k.products.active)} sub={`${formatNumber(k.products.skus)} تنوع • ${formatNumber(k.products.low_stock)} کم‌موجود`} tone="plum" onClick={() => onNavigate('products')} />
        <StatCard icon="headset" label="تیکت‌های باز" value={formatNumber(k.operations.open_tickets)} sub="نیازمند پاسخ تیم" tone="amber" />
        <StatCard icon="tools" label="درخواست‌های خدمت" value={formatNumber(k.operations.pending_services)} sub="در صف یا جریان" tone="ok" />
      </div>

      <div className="ac-dash-grid">
        <SectionCard
          title="روند فروش ۱۴ روز اخیر"
          subtitle="مجموع پرداخت‌های تسویه‌شده به تفکیک روز"
          icon="creditCard"
          action={<span className="ac-card-total">{formatMoney(k.revenue.last7_toman)} <small>در ۷ روز</small></span>}
          className="ac-card-chart"
        >
          <Bars
            items={chartItems}
            maxValue={maxSale}
            height={150}
            formatValue={(v) => formatMoney(v)}
          />
        </SectionCard>

        <SectionCard title="اقدام‌های سریع" subtitle="میان‌برهای مدیریتی" icon="tools">
          <div className="ac-quick-grid">
            <button type="button" className="ac-quick" onClick={onCreateProduct}>
              <span className="ac-quick-ico"><Icon name="plus" size={19} color="#fff" /></span>
              <strong>محصول جدید</strong>
              <small>ثبت کالا با قیمت و موجودی</small>
            </button>
            <button type="button" className="ac-quick" onClick={() => onNavigate('people')}>
              <span className="ac-quick-ico tone-rose"><Icon name="phone" size={19} color="#fff" /></span>
              <strong>دفتر کاربران</strong>
              <small>شماره‌ها و نام کاربری‌ها</small>
            </button>
            <button type="button" className="ac-quick" onClick={() => onNavigate('treasury')}>
              <span className="ac-quick-ico tone-plum"><Icon name="coin" size={19} color="#fff" /></span>
              <strong>خزانه</strong>
              <small>جریان نقدی و تراکنش‌ها</small>
            </button>
            <button type="button" className="ac-quick" onClick={() => onNavigate('lth')}>
              <span className="ac-quick-ico tone-amber"><Icon name="wallet" size={19} color="#fff" /></span>
              <strong>مدیریت LTH</strong>
              <small>پروتکل، استیک و ریگلاژ</small>
            </button>
          </div>
        </SectionCard>
      </div>

      <div className="ac-dash-grid ac-dash-grid-2">
        <SectionCard
          title="آخرین افراد"
          subtitle="جدیدترین فعالیت ثبت‌شده در دفتر کاربران"
          icon="users"
          action={<button type="button" className="ac-link-btn" onClick={() => onNavigate('people')}>مشاهدهٔ همه <Icon name="refresh" size={12} /></button>}
        >
          <div className="ac-activity-list">
            {(data.recent_people || []).map((p) => (
              <button type="button" className="ac-activity-row" key={p.user_id} onClick={() => onNavigate('people')}>
                <span className="ac-activity-ico"><Icon name="user" size={15} /></span>
                <div>
                  <strong>{p.full_name}</strong>
                  <small dir="ltr">@{p.username || '—'} • {p.phone}</small>
                </div>
                <span className="ac-activity-tag">{p.last_source === 'shipping_form' ? 'فرم ارسال' : p.last_source === 'order' ? 'سفارش' : p.last_source === 'service_form' ? 'خدمات' : p.last_source === 'support_ticket' ? 'تیکت' : 'ثبت‌نام'}</span>
                <time>{formatDateTime(p.last_seen_at)}</time>
              </button>
            ))}
            {(!data.recent_people || data.recent_people.length === 0) && <EmptyHint icon="users" title="فعالیتی ثبت نشده" />}
          </div>
        </SectionCard>

        <SectionCard
          title="آخرین سفارش‌ها"
          subtitle="وضعیت لحظه‌ای فروش کالا"
          icon="bag"
          action={<button type="button" className="ac-link-btn" onClick={() => onNavigate('orders')}>همهٔ سفارش‌ها <Icon name="refresh" size={12} /></button>}
        >
          <div className="ac-activity-list">
            {(data.recent_orders || []).map((o) => (
              <button type="button" className="ac-activity-row" key={o.code} onClick={() => onNavigate('orders')}>
                <span className="ac-activity-ico"><Icon name="bag" size={15} /></span>
                <div>
                  <strong className="mono">{o.code}</strong>
                  <small>{o.full_name} • {formatNumber(o.item_count)} قلم</small>
                </div>
                <StatusPill status={o.status} />
                <b className="ac-activity-amount">{Number(o.total_toman).toLocaleString('fa-IR')}</b>
              </button>
            ))}
            {(!data.recent_orders || data.recent_orders.length === 0) && <EmptyHint icon="bag" title="سفارشی ثبت نشده" />}
          </div>
        </SectionCard>
      </div>

      <div className="ac-dash-grid ac-dash-grid-2">
        <SectionCard title="کم‌موجودها" subtitle="تنوع‌هایی که نیاز به تأمین دارند" icon="alert" action={<button type="button" className="ac-link-btn" onClick={() => onNavigate('products')}>مدیریت موجودی</button>}>
          <div className="ac-activity-list">
            {(data.low_stock_skus || []).map((s) => (
              <div className="ac-activity-row static" key={s.id}>
                <span className={`ac-activity-ico ${s.stock === 0 ? 'danger' : ''}`}><Icon name="package" size={15} /></span>
                <div>
                  <strong>{s.product_name}</strong>
                  <small className="mono" dir="ltr">{s.code}</small>
                </div>
                <span className={`ac-stock-pill ${s.stock === 0 ? 'empty' : ''}`}>{formatNumber(s.stock)} عدد</span>
                <b className="ac-activity-amount">{formatNumber(s.price_toman)}</b>
              </div>
            ))}
            {(!data.low_stock_skus || data.low_stock_skus.length === 0) && <EmptyHint icon="check" title="همهٔ موجودی‌ها مناسب است" />}
          </div>
        </SectionCard>

        <SectionCard title="پرفروش‌ترین کالاها" subtitle="بر اساس درآمد ثبت‌شده" icon="coin">
          <div className="ac-activity-list">
            {(data.top_products || []).map((p, i) => (
              <div className="ac-activity-row static" key={p.product_name}>
                <span className="ac-rank">{formatNumber(i + 1)}</span>
                <div>
                  <strong>{p.product_name}</strong>
                  <small>{formatNumber(p.units)} واحد فروش</small>
                </div>
                <b className="ac-activity-amount">{formatNumber(p.revenue_toman)}</b>
              </div>
            ))}
            {(!data.top_products || data.top_products.length === 0) && <EmptyHint icon="coin" title="هنوز فروشی ثبت نشده" />}
          </div>
        </SectionCard>
      </div>

      {k.lth && (
        <section className="ac-lth-banner">
          <div className="ac-lth-banner-main">
            <span className="ac-lth-badge">LTH</span>
            <div>
              <h3>خزانهٔ پروتکل — {k.lth.symbol}</h3>
              <p>{k.lth.conservation_ok ? 'تراز کامل پروتکل برقرار است' : 'هشدار ناترازی در عرضهٔ پروتکل'} • عرضهٔ کل {k.lth.total_supply_lth_headline}</p>
            </div>
            <button type="button" className="ac-btn ac-btn-primary" onClick={() => onNavigate('lth')}>
              مدیریت LTH <Icon name="wallet" size={15} color="#fff" />
            </button>
          </div>
          <div className="ac-lth-metrics">
            <div><span>دارایی خزانه</span><strong dir="ltr">{k.lth.asset_lth_headline}</strong></div>
            <div><span>بازار</span><strong dir="ltr">{k.lth.market_lth_headline}</strong></div>
            <div><span>کارمزد</span><strong dir="ltr">{k.lth.collected_fee_lth_display_8}</strong></div>
            <div><span>بازگشت استیک</span><strong dir="ltr">{k.lth.returned_stake_lth_display_8}</strong></div>
          </div>
        </section>
      )}
    </div>
  );
}

export function AdminConsolePanel() {
  const { user } = useAuth();
  const [tab, setTab] = useState(() => validTab(window.location.hash.replace('#', '')));
  const [createSignal, setCreateSignal] = useState(0);

  useEffect(() => {
    const onHash = () => setTab(validTab(window.location.hash.replace('#', '')));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (id) => {
    setTab(id);
    if (window.location.hash !== `#${id}`) {
      window.history.replaceState(null, '', `#${id}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const createProduct = () => {
    go('products');
    setCreateSignal((n) => n + 1);
  };

  return (
    <div className="ac-shell">
      <aside className="ac-side">
        <div className="ac-side-card">
          <div className="ac-side-brand">
            <img src="/central-mine-logo.svg" alt="CENTRAL MINE" className="ac-side-logo" />
            <div>
              <span className="ac-side-brand-fa">مرکز کنترل</span>
              <span className="ac-side-brand-en">ADMIN CONSOLE</span>
            </div>
          </div>
          <nav className="ac-nav" aria-label="بخش‌های مدیریت">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ac-nav-item ${tab === item.id ? 'active' : ''}`}
                onClick={() => go(item.id)}
              >
                <span className="ac-nav-ico"><Icon name={item.icon} size={18} color="currentColor" /></span>
                <span className="ac-nav-text"><strong>{item.label}</strong><small>{item.hint}</small></span>
              </button>
            ))}
          </nav>
          <div className="ac-side-foot">
            <div className="ac-side-user">
              <span className="ac-side-avatar">{String(user?.full_name || 'م').charAt(0)}</span>
              <div>
                <strong>{user?.full_name || 'مدیر سامانه'}</strong>
                <small dir="ltr">{user?.phone || ''}</small>
              </div>
            </div>
            <span className="ac-side-chip"><span className="ac-live-dot" /> دسترسی کامل مدیر</span>
          </div>
        </div>
      </aside>

      <main className="ac-main">
        <header className="ac-hero">
          <div className="ac-hero-text">
            <span className="ac-hero-kicker">
              <Icon name="shieldCheck" size={15} color="currentColor" /> پنل مدیریت CENTRAL MINE
            </span>
            <h1>مرکز کنترل ماین</h1>
            <p>محصول اضافه کنید، کاربران را با شماره و نام کاربری ببینید، خزانه را پیگیری کنید — همه‌چیز خودکار و زنده.</p>
          </div>
          <div className="ac-hero-badge">
            <span>وضعیت</span>
            <strong><span className="ac-live-dot" /> آنلاین</strong>
            <small>همگام با سرور</small>
          </div>
        </header>

        <div className="ac-mobile-tabs" role="tablist" aria-label="بخش‌های مدیریت">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`ac-mobile-tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => go(item.id)}
            >
              <Icon name={item.icon} size={16} color="currentColor" /> {item.label}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && <Dashboard onNavigate={go} onCreateProduct={createProduct} />}
        {tab === 'products' && <ProductsPanel autoCreate={createSignal} />}
        {tab === 'people' && <PeoplePanel />}
        {tab === 'orders' && <OrdersPanel />}
        {tab === 'treasury' && <TreasuryPanel onOpenLth={() => go('lth')} />}
        {tab === 'lth' && (
          <div className="ac-panel ac-lth-panel">
            <div className="ac-panel-head">
              <div>
                <h2>پروتکل LTH، خزانه و ریگلاژ</h2>
                <p>مدیریت کامل عرضه، کارمزد، استیک و بازرسی ۳۶۰ درجهٔ موازین.</p>
              </div>
            </div>
            <AdminLthPanel />
          </div>
        )}
        {tab === 'settings' && <SettingsPanel />}
        {tab === 'audit' && <AuditPanel />}
      </main>

      {tab !== 'products' && (
        <button type="button" className="ac-fab" onClick={createProduct} title="افزودن محصول جدید">
          <Icon name="plus" size={20} color="#fff" />
          <span>محصول جدید</span>
        </button>
      )}
    </div>
  );
}
