import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatMoney } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { EmptyState, ErrorState, LoadingState, ProductImage } from '../components/StateViews';
import { LthTopBar } from '../components/LthTopBar';
import { LthWalletCard } from '../components/LthWalletCard';
import { Icon } from '../components/Icon';

function getBrandInitials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toLocaleUpperCase('fa-IR') || 'BR';
}

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState(null);
  const brandRequestIdRef = useRef(0);
  const [lthConfig, setLthConfig] = useState(null);
  const [walletData, setWalletData] = useState(null);
  const [treasury, setTreasury] = useState(null);

  const loadHome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const requests = [
        apiFetch('/products?limit=100&sort=newest'),
        apiFetch('/brands'),
        apiFetch('/lth/config'),
        apiFetch('/lth/treasury')
      ];
      if (user) {
        requests.push(apiFetch('/lth/wallet').catch(() => null));
      }
      const [pRes, bRes, cRes, tRes, wRes] = await Promise.all(requests);
      setProducts(pRes.items || []);
      setBrands(bRes.items || []);
      setLthConfig(cRes.config || null);
      setTreasury(tRes.treasury || null);
      setWalletData(wRes?.wallet || null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadHome();
  }, [loadHome]);

  useEffect(() => {
    if (!loading && window.location.hash === '#products') {
      document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [loading]);

  const loadProductsForBrand = useCallback(async (brandSlug = selectedBrand) => {
    const requestId = ++brandRequestIdRef.current;
    setProductsLoading(true);
    setProductsError(null);
    try {
      const query = new URLSearchParams({ limit: '100', sort: 'newest' });
      if (brandSlug) query.set('brand', brandSlug);
      const response = await apiFetch(`/products?${query.toString()}`);
      if (requestId === brandRequestIdRef.current) setProducts(response.items || []);
    } catch (err) {
      if (requestId === brandRequestIdRef.current) setProductsError(err);
    } finally {
      if (requestId === brandRequestIdRef.current) setProductsLoading(false);
    }
  }, [selectedBrand]);

  const handleBrandSelect = (brandSlug) => {
    setSelectedBrand(brandSlug);
    loadProductsForBrand(brandSlug);
  };

  const goWalletAction = (panel) => {
    if (!user) {
      navigate(`/auth?next=${encodeURIComponent(panel ? `/wallet?panel=${panel}` : '/wallet')}`);
      return;
    }
    navigate(panel ? `/wallet?panel=${panel}` : '/wallet');
  };

  return (
    <div>
      {/* Top Hero Zone: Separate LTH / IRR Ticker + Pink Wallet Card + Quick Protocol Actions */}
      <div className="lth-shell" style={{ marginBottom: 26 }}>
        <LthTopBar config={lthConfig} />

        <LthWalletCard
          wallet={user ? walletData : null}
          config={lthConfig}
          onSelectSheba={() => goWalletAction('sheba')}
        />

        {!user && (
          <div className="muted" style={{ textAlign: 'center', fontSize: '0.82rem', marginBottom: 10 }}>
            برای مشاهدهٔ موجودی واقعی کیف پول و قراردادهای هوشمند خود <Link to="/auth?next=/wallet"><strong>وارد حساب شوید</strong></Link>.
          </div>
        )}

        <button
          type="button"
          className="lth-outline-btn pink-text"
          onClick={() => goWalletAction('sell')}
        >
          فروش
        </button>

        <button
          type="button"
          className="lth-outline-btn"
          onClick={() => goWalletAction('contracts')}
        >
          قرارداد هوشمند (PoS)
        </button>

        <div className="grid grid-2" style={{ gap: 10 }}>
          <Link to="/treasury" className="lth-filled-btn" style={{ marginBottom: 0 }}>
            <Icon name="landmark" color="currentColor" /> خزانه پروتکل ({treasury ? `LTH ${treasury.asset_lth_headline}` : '15.000.000 LTH'})
          </Link>
          <Link to="/lth-calculator" className="lth-outline-btn pink-text" style={{ marginBottom: 0 }}>
            <Icon name="calculator" /> خرید پکیج و محاسبه‌گر
          </Link>
        </div>
      </div>

      {loading && <LoadingState label="در حال بارگذاری محصولات..." />}
      {!loading && error && <ErrorState error={error} onRetry={loadHome} />}

      {!loading && !error && (
        <>
          <section id="products" style={{ marginBottom: 28, scrollMarginTop: 88 }}>
            <div className="flex-between" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>محصولات فروشگاه</h2>
            </div>

            {brands.length > 0 && (
              <div className="home-brand-filter" role="group" aria-label="فیلتر محصولات بر اساس برند">
                <button
                  type="button"
                  className={`home-brand-chip${selectedBrand === '' ? ' active' : ''}`}
                  aria-pressed={selectedBrand === ''}
                  onClick={() => handleBrandSelect('')}
                >
                  <span className="home-brand-mark" aria-hidden="true">
                    <Icon name="bag" size={22} color="currentColor" />
                  </span>
                  <span className="home-brand-name">همهٔ برندها</span>
                </button>
                {brands.map((brand) => (
                  <button
                    key={brand.id}
                    type="button"
                    className={`home-brand-chip${selectedBrand === brand.slug ? ' active' : ''}`}
                    aria-pressed={selectedBrand === brand.slug}
                    onClick={() => handleBrandSelect(brand.slug)}
                    title={`نمایش محصولات ${brand.name}`}
                  >
                    <span className="home-brand-mark" aria-hidden="true">{getBrandInitials(brand.name)}</span>
                    <span className="home-brand-name">{brand.name}</span>
                  </button>
                ))}
              </div>
            )}

            {productsLoading && <LoadingState label="در حال بارگذاری محصولات برند..." />}
            {!productsLoading && productsError && (
              <ErrorState error={productsError} onRetry={() => loadProductsForBrand(selectedBrand)} />
            )}
            {!productsLoading && !productsError && products.length === 0 && (
              selectedBrand ? (
                <EmptyState
                  title="برای این برند محصولی پیدا نشد"
                  description="برند دیگری را انتخاب کنید یا همهٔ محصولات را ببینید."
                  actionLabel="نمایش همهٔ محصولات"
                  onAction={() => handleBrandSelect('')}
                />
              ) : <EmptyState title="هنوز کالایی ثبت نشده است" />
            )}
            {!productsLoading && !productsError && products.length > 0 && (
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
                          <Icon name={p.total_stock > 0 ? 'check' : 'x'} color="currentColor" size={14} />
                          {p.total_stock > 0 ? `موجود (${p.total_stock.toLocaleString('fa-IR')})` : 'ناموجود'}
                        </span>
                      </div>
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
