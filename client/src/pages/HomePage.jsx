import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatMoney } from '../lib/format';
import { EmptyState, ErrorState, LoadingState, ProductImage } from '../components/StateViews';

export function HomePage() {
  const navigate = useNavigate();
  const [searchQ, setSearchQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [services, setServices] = useState([]);

  const loadHome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, sRes] = await Promise.all([
        apiFetch('/products?limit=4&sort=newest'),
        apiFetch('/services?limit=4')
      ]);
      setProducts(pRes.items || []);
      setServices(sRes.items || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHome();
  }, [loadHome]);

  const onSearchSubmit = (e) => {
    e.preventDefault();
    const q = searchQ.trim();
    navigate(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
  };

  return (
    <div>
      <section className="card" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: '#f8fafc', padding: '28px 24px', marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.65rem', fontWeight: 800 }}>
          فروشگاه تخصصی تجهیزات صنعتی و خدمات فنی آنلاین
        </h1>
        <p style={{ margin: '0 0 18px', color: '#cbd5e1', maxWidth: 680 }}>
          خرید مستقیم ابزار اندازه‌گیری، ایمنی و تغذیهٔ صنعتی همراه با ثبت و پیگیری برخط خدمات کالیبراسیون، عیب‌یابی و تعمیرات تخصصی با کد رهگیری و SLA مشخص.
        </p>

        <form onSubmit={onSearchSubmit} className="flex-gap" style={{ maxWidth: 560, marginBottom: 16 }}>
          <input
            type="search"
            className="input"
            style={{ flex: 1 }}
            placeholder="جست‌وجوی نام کالا، مدل یا برند (مثلاً مولتی‌متر یا کلاه ایمنی)..."
            aria-label="جست‌وجوی کالا"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          <button type="submit" className="btn btn-primary">جست‌وجو</button>
        </form>

        <div className="flex-gap">
          <Link to="/shop" className="btn btn-primary">مشاهدهٔ همهٔ کالاها</Link>
          <Link to="/services" className="btn btn-secondary">ثبت درخواست خدمت فنی</Link>
        </div>
      </section>

      {loading && <LoadingState label="در حال بارگذاری کاتالوگ و خدمات فعال..." />}
      {!loading && error && <ErrorState error={error} onRetry={loadHome} />}

      {!loading && !error && (
        <>
          <section style={{ marginBottom: 28 }}>
            <div className="flex-between" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>جدیدترین کالاهای فروشگاه</h2>
              <Link to="/shop" className="btn btn-secondary btn-sm">همهٔ کالاها ←</Link>
            </div>
            {products.length === 0 ? (
              <EmptyState title="هنوز کالایی ثبت نشده است" />
            ) : (
              <div className="grid grid-4">
                {products.map((p) => (
                  <article key={p.id} className="product-card">
                    <Link to={`/products/${p.slug}`}>
                      <ProductImage src={p.image_path} alt={p.name} />
                    </Link>
                    <div className="product-body">
                      <div className="product-meta">{p.category || 'عمومی'} {p.brand ? `• ${p.brand}` : ''}</div>
                      <Link to={`/products/${p.slug}`} className="product-title">{p.name}</Link>
                      <div className="product-price">
                        <span>{formatMoney(p.min_price_toman)}</span>
                        <span className={`badge ${p.total_stock > 0 ? 'badge-ok' : 'badge-danger'}`}>
                          {p.total_stock > 0 ? `✓ موجود (${p.total_stock.toLocaleString('fa-IR')})` : '✕ ناموجود'}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex-between" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>خدمات فنی و عملیاتی قابل ثبت آنلاین</h2>
              <Link to="/services" className="btn btn-secondary btn-sm">فهرست کامل خدمات ←</Link>
            </div>
            {services.length === 0 ? (
              <EmptyState title="خدمت فعالی ثبت نشده است" />
            ) : (
              <div className="grid grid-2">
                {services.map((s) => (
                  <article key={s.id} className="card" style={{ marginBottom: 0 }}>
                    <div className="flex-between" style={{ marginBottom: 6 }}>
                      <span className="badge badge-info">⚙️ {s.category?.name || 'خدمت تخصصی'}</span>
                      <span className="badge badge-neutral">⏱️ تعهد SLA: {s.sla_hours.toLocaleString('fa-IR')} ساعت</span>
                    </div>
                    <h3 style={{ margin: '8px 0 6px', fontSize: '1.06rem' }}>{s.name}</h3>
                    <p className="muted" style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>{s.description}</p>
                    <div className="flex-between">
                      <strong>تعرفه: {formatMoney(s.price_toman, { freeLabel: true })}</strong>
                      <Link to={`/services/${s.slug}`} className="btn btn-primary btn-sm">
                        مشاهدهٔ شرایط و ثبت درخواست
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
