import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyMeta, productJsonLd, breadcrumbJsonLd, resolveMeta, seoOverrideClaimed, releaseSeoOverride } from '../lib/seo';

/**
 * Per-route SEO. Mount it once inside the router (App.jsx) and every navigation
 * updates <title>, meta description, canonical, Open Graph/Twitter cards and
 * JSON-LD. Pages that know more than the static table (product detail) can pass
 * `override` props straight through.
 */
export function Seo({ title, description, jsonLd, noindex, image }) {
  const location = useLocation();

  useEffect(() => {
    // A page already produced richer metadata for this route — leave it alone.
    if (seoOverrideClaimed(location.pathname)) {
      releaseSeoOverride();
      return;
    }
    const meta = resolveMeta(location.pathname);
    const merged = {
      ...meta,
      ...(title ? { title } : null),
      ...(description ? { description } : null),
      ...(noindex !== undefined ? { noindex } : null),
      ...(image ? { image } : null)
    };
    applyMeta(merged, { jsonLd: jsonLd !== undefined ? jsonLd : merged.jsonLd });
  }, [location.pathname, title, description, noindex, image, jsonLd]);

  return null;
}

/** Convenience wrapper that also emits a breadcrumb trail. */
export function SeoWithBreadcrumb({ trail, title, description, jsonLd }) {
  const location = useLocation();
  useEffect(() => {
    // A page already produced richer metadata for this route — leave it alone.
    if (seoOverrideClaimed(location.pathname)) {
      releaseSeoOverride();
      return;
    }
    const meta = resolveMeta(location.pathname);
    const merged = { ...meta, ...(title ? { title } : null), ...(description ? { description } : null) };
    const blocks = [];
    if (meta.jsonLd) blocks.push(...(Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd]));
    blocks.push(breadcrumbJsonLd(trail));
    if (jsonLd) blocks.push(jsonLd);
    applyMeta(merged, { jsonLd: blocks });
  }, [location.pathname, trail, title, description, jsonLd]);
  return null;
}

export { productJsonLd, breadcrumbJsonLd };
