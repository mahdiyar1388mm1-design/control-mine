import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatMoney, formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { EmptyState, ErrorState, FieldErrorsList, LoadingState, ProductImage } from '../components/StateViews';
import { Icon } from '../components/Icon';
import { useSeo, productJsonLdFor, breadcrumbJsonLdFor } from '../lib/useSeo';

export function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [data, setData] = useState({ items: [], page: 1, limit: 12, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const brand = searchParams.get('brand') || '';
  const minPrice = searchParams.get('min_price') || '';
  const maxPrice = searchParams.get('max_price') || '';
  const sort = searchParams.get('sort') || 'newest';
  const page = Number(searchParams.get('page') || 1);

  const [formQ, setFormQ] = useState(q);
  const [formMin, setFormMin] = useState(minPrice);
  const [formMax, setFormMax] = useState(maxPrice);

  useEffect(() => {
    Promise.all([apiFetch('/categories'), apiFetch('/brands')])
      .then(([c, b]) => {
        setCategories(c.items || []);
        setBrands(b.items || []);
      })
      .catch(() => {});
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (category) qs.set('category', category);
      if (brand) qs.set('brand', brand);
      if (minPrice) qs.set('min_price', minPrice);
      if (maxPrice) qs.set('max_price', maxPrice);
      if (sort) qs.set('sort', sort);
      qs.set('page', String(page));
      qs.set('limit', '12');
      const res = await apiFetch(`/products?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [q, category, brand, minPrice, maxPrice, sort, page]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const updateFilter = (patch) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === '' || v === null || v === undefined) next.delete(k);
      else next.set(k, String(v));
    });
    if (!patch.page) next.set('page', '1');
    setSearchParams(next);
  };

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    updateFilter({ q: formQ.trim(), min_price: formMin.trim(), max_price: formMax.trim(), page: '' });
  };

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.limit || 12)));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">فروشگاه تجهیزات و ابزار</h1>
          <p className="page-subtitle">جست‌وجو و فیلتر بر پایهٔ موجودی و قیمت لحظه‌ای سرور (واحد پول: تومان)</p>
        </div>
      </div>

      <form onSubmit={handleFilterSubmit} className="card">
        <div className="grid grid-4">
          <div>
            <label className="form-label" htmlFor="shop-q">جست‌وجوی نام یا برند</label>
            <input id="shop-q" className="input" value={formQ} onChange={(e) => setFormQ(e.target.value)} placeholder="مثلاً مولتی‌متر..." />
          </div>
          <div>
            <label className="form-label" htmlFor="shop-cat">دسته‌بندی</label>
            <select id="shop-cat" className="select" value={category} onChange={(e) => updateFilter({ category: e.target.value })}>
              <option value="">همهٔ دسته‌ها</option>
              {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="shop-brand">برند</label>
            <select id="shop-brand" className="select" value={brand} onChange={(e) => updateFilter({ brand: e.target.value })}>
              <option value="">همهٔ برندها</option>
              {brands.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="shop-sort">مرتب‌سازی</label>
            <select id="shop-sort" className="select" value={sort} onChange={(e) => updateFilter({ sort: e.target.value })}>
              <option value="newest">جدیدترین</option>
              <option value="price_asc">ارزان‌ترین</option>
              <option value="price_desc">گران‌ترین</option>
              <option value="name">حروف الفبا</option>
            </select>
          </div>
        </div>
        <div className="grid grid-3" style={{ marginTop: 12, alignItems: 'end' }}>
          <div>
            <label className="form-label" htmlFor="shop-min">حداقل قیمت (تومان)</label>
            <input id="shop-min" type="number" min="0" className="input" value={formMin} onChange={(e) => setFormMin(e.target.value)} placeholder="مثلاً 500000" />
          </div>
          <div>
            <label className="form-label" htmlFor="shop-max">حداکثر قیمت (تومان)</label>
            <input id="shop-max" type="number" min="0" className="input" value={formMax} onChange={(e) => setFormMax(e.target.value)} placeholder="مثلاً 5000000" />
          </div>
          <div className="flex-gap">
            <button type="submit" className="btn btn-primary">اعمال فیلتر</button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setFormQ('');
                setFormMin('');
                setFormMax('');
                setSearchParams({});
              }}
            >
              پاک‌سازی فیلترها
            </button>
          </div>
        </div>
      </form>

      {loading && <LoadingState label="در حال جست‌وجوی کالاها در سرور..." />}
      {!loading && error && <ErrorState error={error} onRetry={loadProducts} />}
      {!loading && !error && data.items.length === 0 && (
        <EmptyState
          title="کالایی مطابق فیلترهای انتخاب‌شده یافت نشد"
          description="عبارت جست‌وجو یا محدودهٔ قیمت را تغییر دهید."
          actionLabel="نمایش همهٔ کالاها"
          onAction={() => setSearchParams({})}
        />
      )}

      {brands.length > 0 && (
        <div className="shop-brand-strip" aria-label="برندها">
          <span className="shop-brand-strip-label">برندها:</span>
          {brands.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`shop-brand-pill ${brand === b.slug ? 'is-active' : ''}`}
              onClick={() => updateFilter({ brand: brand === b.slug ? '' : b.slug, page: 1 })}
              title={b.name}
            >
              {b.logo_path ? <img src={b.logo_path} alt="" loading="lazy" /> : null}
              <span>{b.name}</span>
            </button>
          ))}
        </div>
      )}

      {!loading && !error && data.items.length > 0 && (
        <>
          <div className="muted" style={{ marginBottom: 10, fontSize: '0.86rem' }}>
            تعداد کل نتایج: {formatNumber(data.total)} کالا
          </div>
          <div className="grid grid-3">
            {data.items.map((p) => (
              <article key={p.id} className="product-card">
                <Link to={`/products/${p.slug}`}>
                  <ProductImage src={p.image_path} alt={p.name} />
                </Link>
                <div className="product-body">
                  <div className="product-meta">
                    {p.category || 'عمومی'}
                    {p.brand && (
                      <span className="product-brand">
                        {p.brand_logo_path
                          ? <img src={p.brand_logo_path} alt={p.brand} loading="lazy" />
                          : null}
                        {p.brand}
                      </span>
                    )}
                  </div>
                  <Link to={`/products/${p.slug}`} className="product-title">{p.name}</Link>
                  <p className="muted" style={{ fontSize: '0.84rem', margin: '0 0 10px' }}>
                    {(p.description || '').slice(0, 95)}{p.description && p.description.length > 95 ? '…' : ''}
                  </p>
                  <div className="product-price">
                    <span>
                      {p.min_price_toman !== p.max_price_toman
                        ? `از ${formatMoney(p.min_price_toman)}`
                        : formatMoney(p.min_price_toman)}
                    </span>
                    <span className={`badge ${p.total_stock > 0 ? 'badge-ok' : 'badge-danger'}`}>
                      {p.total_stock > 0 ? <><Icon name="check" size={13} /> موجود ({formatNumber(p.total_stock)})</> : <><Icon name="close" size={13} /> ناموجود</>}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex-gap" style={{ justifyContent: 'center', marginTop: 22 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => updateFilter({ page: page - 1 })}
              >
                صفحهٔ قبل
              </button>
              <span className="muted">صفحهٔ {formatNumber(page)} از {formatNumber(totalPages)}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => updateFilter({ page: page + 1 })}
              >
                صفحهٔ بعد
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ProductDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, refreshCounts } = useAuth();
  const [product, setProduct] = useState(null);
  const [selectedSkuId, setSelectedSkuId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addFeedback, setAddFeedback] = useState(null);
  const [addError, setAddError] = useState(null);

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/products/${encodeURIComponent(slug)}`);
      setProduct(res.product);
      const firstAvail = (res.product.skus || []).find((s) => s.is_active && s.stock > 0) || res.product.skus?.[0];
      if (firstAvail) setSelectedSkuId(firstAvail.id);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  // Product pages carry their own title/description/structured data. This hook
  // must run before any early return so hook order stays stable.
  useSeo(
    product
      ? {
          title: `${product.name}${product.brand?.name ? ` | ${product.brand.name}` : ''} — سنترال ماین`,
          description: (product.description || '').replace(/\s+/g, ' ').trim().slice(0, 300)
            || `خرید ${product.name} با موجودی واقعی انبار و ضمانت اصالت از سنترال ماین.`,
          image: product.image_path ? `${window.location.origin}${product.image_path}` : undefined,
          jsonLd: [productJsonLdFor(product), breadcrumbJsonLdFor([
            { name: 'خانه', path: '/' },
            { name: 'فروشگاه', path: '/shop' },
            { name: product.name, path: `/products/${product.slug || product.id}` }
          ])]
        }
      : null,
    [product]
  );

  if (loading) return <LoadingState label="در حال بارگذاری مشخصات کالا..." />;
  if (error) return <ErrorState error={error} onRetry={loadProduct} />;
  if (!product) return <EmptyState title="کالا یافت نشد" actionLabel="بازگشت به فروشگاه" actionTo="/shop" />;

  const selectedSku = (product.skus || []).find((s) => s.id === selectedSkuId);

  const canPurchase = product.status === 'active' && selectedSku && selectedSku.is_active && selectedSku.stock > 0;

  const handleAddToCart = async (e) => {
    e.preventDefault();
    setAddFeedback(null);
    setAddError(null);
    if (!user) {
      navigate(`/auth?next=${encodeURIComponent(`/products/${product.slug}`)}`);
      return;
    }
    if (!selectedSku) return;
    setAdding(true);
    try {
      await apiFetch('/cart/items', {
        method: 'POST',
        body: { sku_id: selectedSku.id, quantity: Number(quantity) }
      });
      await refreshCounts();
      setAddFeedback('کالا پس از تأیید سرور به سبد خرید اضافه شد.');
    } catch (err) {
      setAddError(err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/shop" className="muted"><Icon name="arrowLeft" size={14} /> بازگشت به فهرست کالاها</Link>
      </div>

      {product.status !== 'active' && (
        <div className="alert-inline warn">
          <Icon name="alert" size={14} /> این کالا در وضعیت «{product.status}» قرار دارد و در حال حاضر قابل خرید نیست.
        </div>
      )}

      <div className="two-col-layout">
        <div className="card">
          <ProductImage src={product.image_path} alt={product.name} />
          <div style={{ marginTop: 16 }}>
            <div className="product-meta">
              {product.category?.name || 'عمومی'}
              {product.brand && (
                <span className="product-brand product-brand-lg">
                  {product.brand.logo_path
                    ? <img src={product.brand.logo_path} alt={product.brand.name} />
                    : null}
                  <Link to={`/shop?brand=${encodeURIComponent(product.brand.slug)}`}>
                    {product.brand.name}
                  </Link>
                </span>
              )}
            </div>
            <h1 style={{ margin: '6px 0 12px', fontSize: '1.35rem' }}>{product.name}</h1>
            <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{product.description || 'توضیحی ثبت نشده است.'}</p>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>انتخاب تنوع (SKU) و خرید</h2>

          {(product.skus || []).length === 0 ? (
            <EmptyState title="تنوعی برای این کالا تعریف نشده است" />
          ) : (
            <form onSubmit={handleAddToCart}>
              <div className="form-row">
                <label className="form-label">تنوع‌های موجود کالا:</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {product.skus.map((s) => {
                    const attrsText = Object.entries(s.variant_attrs || {})
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' | ') || s.code;
                    const disabledSku = !s.is_active;
                    return (
                      <label
                        key={s.id}
                        style={{
                          display: 'block',
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: selectedSkuId === s.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                          background: disabledSku ? '#f1f5f9' : (selectedSkuId === s.id ? 'var(--primary-soft)' : '#fff'),
                          cursor: disabledSku ? 'not-allowed' : 'pointer',
                          opacity: disabledSku ? 0.65 : 1
                        }}
                      >
                        <div className="flex-between">
                          <span>
                            <input
                              type="radio"
                              name="sku"
                              checked={selectedSkuId === s.id}
                              disabled={disabledSku}
                              onChange={() => {
                                setSelectedSkuId(s.id);
                                setQuantity(1);
                                setAddFeedback(null);
                                setAddError(null);
                              }}
                              style={{ marginLeft: 8 }}
                            />
                            <strong>{attrsText}</strong>
                          </span>
                          <strong>{formatMoney(s.price_toman)}</strong>
                        </div>
                        <div className="flex-between muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          <span>کد کالا: <span className="mono">{s.code}</span></span>
                          <span>
                            {!s.is_active
                              ? <><Icon name="forbidden" size={13} /> غیرفعال</>
                              : (s.stock > 0 ? <><Icon name="check" size={13} /> موجودی انبار: {formatNumber(s.stock)} عدد</> : <><Icon name="close" size={13} /> ناموجود</>)}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {selectedSku && (
                <div className="card" style={{ background: 'var(--surface-alt)', marginBottom: 14 }}>
                  <div className="flex-between">
                    <span>قیمت واحد:</span>
                    <strong>{formatMoney(selectedSku.price_toman)}</strong>
                  </div>
                  {selectedSku.weight_grams != null && (
                    <div className="flex-between muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                      <span>وزن تقریبی:</span>
                      <span>{formatNumber(selectedSku.weight_grams)} گرم</span>
                    </div>
                  )}
                </div>
              )}

              {canPurchase && (
                <div className="form-row">
                  <label className="form-label" htmlFor="buy-qty">تعداد (حداکثر موجودی: {formatNumber(selectedSku.stock)})</label>
                  <input
                    id="buy-qty"
                    type="number"
                    className="input"
                    min={1}
                    max={selectedSku.stock}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value || 1)))}
                  />
                </div>
              )}

              {addError && (
                <>
                  <div className="alert-inline error"><Icon name="alert" size={14} /> {addError.message}</div>
                  <FieldErrorsList details={addError.details} />
                </>
              )}
              {addFeedback && (
                <div className="alert-inline ok" role="status">
                  <Icon name="check" size={14} /> {addFeedback}{' '}
                  <Link to="/cart" style={{ fontWeight: 800, marginRight: 8 }}>مشاهدهٔ سبد خرید <Icon name="arrowLeft" size={14} /></Link>
                </div>
              )}

              <button type="submit" className="btn btn-primary btn-block" disabled={!canPurchase || adding}>
                {adding
                  ? '⏳ در حال ثبت در سبد خرید...'
                  : (!canPurchase ? 'غیرقابل خرید (ناموجود یا غیرفعال)' : 'افزودن به سبد خرید')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
