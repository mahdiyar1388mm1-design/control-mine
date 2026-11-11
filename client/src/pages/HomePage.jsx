import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatMoney } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { EmptyState, ErrorState, LoadingState, ProductImage } from '../components/StateViews';
import { LthTopBar } from '../components/LthTopBar';
import { LthWalletCard } from '../components/LthWalletCard';
import { Icon } from '../components/Icon';

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [lthConfig, setLthConfig] = useState(null);
  const [walletData, setWalletData] = useState(null);
  const [treasury, setTreasury] = useState(null);

  const loadHome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const requests = [
        apiFetch('/products?limit=100&sort=newest'),
        apiFetch('/lth/config'),
        apiFetch('/lth/treasury')
      ];
      if (user) {
        requests.push(apiFetch('/lth/wallet').catch(() => null));
      }
      const [pRes, cRes, tRes, wRes] = await Promise.all(requests);
      setProducts(pRes.items || []);
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
