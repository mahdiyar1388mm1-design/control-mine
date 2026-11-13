import { useEffect } from 'react';
import { applyMeta, claimSeoOverride, productJsonLd, breadcrumbJsonLd, resolveMeta } from './seo';

/**
 * Applies page-specific SEO when a page knows more than the static route table
 * (product names, live prices, brand logos). Passing `null` keeps the current
 * route metadata untouched, which makes it safe to call before data arrives.
 *
 *   useSeo(product ? { title, description, jsonLd } : null, [product]);
 */
export function useSeo(meta, deps = []) {
  useEffect(() => {
    if (!meta) return;
    const pathname = window.location.pathname;
    // Claim this route so the global <Seo /> does not overwrite the richer
    // page metadata (parent effects run after child effects).
    claimSeoOverride(pathname);
    const base = resolveMeta(pathname);
    applyMeta({ ...base, ...meta }, { jsonLd: meta.jsonLd !== undefined ? meta.jsonLd : base.jsonLd });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** JSON-LD for a product returned by `GET /api/v1/products/:slug`. */
export function productJsonLdFor(product, origin = window.location.origin) {
  const skus = (product.skus || []).filter((s) => s.is_active !== false);
  // The catalogue stores Toman; structured data needs Rial (1 Toman = 10 Rial).
  const tomanOf = (sku) => Number(sku.price_toman ?? (sku.price_irr ? Number(sku.price_irr) / 10 : 0));
  const cheapest = skus.slice().sort((a, b) => tomanOf(a) - tomanOf(b))[0];
  const stock = skus.reduce((sum, s) => sum + Number(s.stock || 0), 0);
  return productJsonLd(
    {
      id: product.id,
      slug: product.slug,
      title: product.name,
      description: product.description,
      sku: cheapest?.code || product.sku,
      category_name: product.category?.name,
      brand_name: product.brand?.name,
      image_url: product.image_path ? `${origin}${product.image_path}` : undefined,
      price_irr: cheapest ? String(Math.round(tomanOf(cheapest) * 10)) : undefined,
      stock
    },
    origin
  );
}

export function breadcrumbJsonLdFor(trail, origin = window.location.origin) {
  return breadcrumbJsonLd(trail, origin);
}

export { resolveMeta, applyMeta, claimSeoOverride };
