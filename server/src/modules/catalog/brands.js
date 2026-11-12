'use strict';

/**
 * Brand management (catalog).
 *
 * A brand used to be nothing but a name. It now owns a logo, a short
 * description, an optional website, an ordering weight and an activation flag,
 * so the admin console can manage brands as real records and every product can
 * carry its brand's logo into the storefront.
 *
 * Uploaded logos are written to the public uploads directory with a
 * server-generated filename; the client-provided name is never trusted.
 */

const fs = require('fs');
const path = require('path');
const { all, get, run, tx } = require('../../db');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, validate } = require('../../utils/validate');
const { audit } = require('../platform/service');
const config = require('../../config');

const publicUploadsDir = path.join(config.storageDir, '..', 'public');

/** Slug that is unique across brands (Arabic/Persian letters are preserved). */
function brandSlug(name, ignoreId = null) {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `brand-${Date.now()}`;
  let slug = base;
  let i = 1;
  // The unique index is global, so a renamed brand must not collide with itself.
  while (get('SELECT 1 AS x FROM brands WHERE slug = ? AND id IS NOT ?', [slug, ignoreId])) {
    slug = `${base}-${i}`;
    i += 1;
  }
  return slug;
}

function brandToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo_path: row.logo_path || null,
    description: row.description || '',
    website_url: row.website_url || null,
    is_active: row.is_active === undefined || row.is_active === null ? true : Boolean(row.is_active),
    sort_order: Number(row.sort_order || 0),
    product_count: row.product_count === undefined ? undefined : Number(row.product_count),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

const SELECT_BRAND = `
  SELECT b.*,
         (SELECT COUNT(*) FROM products p
           WHERE p.brand_id = b.id AND p.deleted_at IS NULL) AS product_count
    FROM brands b`;

/** Storefront: only active brands, ordered by weight then name. */
function listPublicBrands() {
  return all(`${SELECT_BRAND} WHERE b.is_active = 1 ORDER BY b.sort_order, b.name`)
    .map(brandToJson);
}

/** Admin: everything, including deactivated brands, with product counts. */
function listAdminBrands() {
  return all(`${SELECT_BRAND} ORDER BY b.sort_order, b.name`).map(brandToJson);
}

function getBrandRow(id) {
  const row = get(`${SELECT_BRAND} WHERE b.id = ?`, [id]);
  if (!row) throw ApiError.notFound('برند یافت نشد.');
  return row;
}

function brandById(id) {
  return brandToJson(getBrandRow(id));
}

/** Accepts only a path we generated inside the public uploads folder. */
function normalizeLogoPath(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const text = String(value);
  if (!/^\/uploads\/[A-Za-z0-9._-]{1,180}$/.test(text)) {
    throw ApiError.validation('مسیر تصویر برند معتبر نیست.', [
      { field: 'logo_path', message: 'فقط مسیرهای /uploads/... پذیرفته می‌شوند.' }
    ]);
  }
  return text;
}

/** Deletes a logo file we generated, ignoring anything outside the uploads folder. */
function removeLogoFile(logoPath) {
  if (!logoPath) return;
  if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(String(logoPath))) return;
  try { fs.unlinkSync(path.join(publicUploadsDir, path.basename(logoPath))); } catch { /* already gone */ }
}

function assertNameFree(name, ignoreId = null) {
  const existing = get('SELECT id, name FROM brands WHERE name = ? AND id IS NOT ?', [name.trim(), ignoreId]);
  if (existing) {
    throw ApiError.conflict(`برندی با نام «${existing.name}» از قبل وجود دارد.`, [
      { field: 'name', message: 'نام برند باید یکتا باشد.' }
    ]);
  }
}

function createBrand(actor, input) {
  const data = validate(input)
    .string('name', { min: 2, max: 80 })
    .string('description', { required: false, default: '', max: 400 })
    .string('website_url', { required: false, default: null, max: 200 })
    .int('sort_order', { required: false, min: 0, max: 10000, default: 0 })
    .bool('is_active', { default: true })
    .done();
  assertNameFree(data.name);

  const id = uuid();
  const now = nowIso();
  const slug = brandSlug(data.name);
  const logoPath = normalizeLogoPath(input && input.logo_path);
  run(
    `INSERT INTO brands (id, name, slug, logo_path, description, website_url, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.name, slug, logoPath || null, data.description, data.website_url,
      data.is_active ? 1 : 0, data.sort_order, now, now]
  );
  audit(actor.id, actor.role, 'catalog.create_brand', 'brand', id, {
    name: data.name,
    logo: Boolean(logoPath)
  });
  return brandById(id);
}

function updateBrand(actor, id, input) {
  const current = getBrandRow(id);
  const data = validate(input)
    .string('name', { required: false, min: 2, max: 80 })
    .string('description', { required: false, max: 400 })
    .string('website_url', { required: false, max: 200, default: undefined })
    .int('sort_order', { required: false, min: 0, max: 10000 })
    .bool('is_active', {})
    .done();
  if (data.name !== undefined && data.name !== current.name) assertNameFree(data.name, id);

  const logoPath = normalizeLogoPath(input && input.logo_path);
  const next = {
    name: data.name === undefined ? current.name : data.name,
    description: data.description === undefined ? (current.description || '') : data.description,
    website_url: data.website_url === undefined ? (current.website_url || null) : data.website_url,
    sort_order: data.sort_order === undefined ? Number(current.sort_order || 0) : data.sort_order,
    is_active: data.is_active === undefined ? current.is_active : (data.is_active ? 1 : 0),
    logo_path: logoPath === undefined ? (current.logo_path || null) : logoPath
  };
  const slug = next.name === current.name ? current.slug : brandSlug(next.name, id);

  run(
    `UPDATE brands SET name = ?, slug = ?, logo_path = ?, description = ?, website_url = ?,
            is_active = ?, sort_order = ?, updated_at = ?
      WHERE id = ?`,
    [next.name, slug, next.logo_path, next.description, next.website_url,
      next.is_active, next.sort_order, nowIso(), id]
  );
  audit(actor.id, actor.role, 'catalog.update_brand', 'brand', id, {
    fields: Object.keys(data).concat(logoPath === undefined ? [] : ['logo_path'])
  });
  return brandById(id);
}

/**
 * Deleting is permanent only when no product references the brand.
 * A brand that is still in use is deactivated instead (record retention).
 */
function deleteBrand(actor, id) {
  const brand = getBrandRow(id);
  if (brand.product_count > 0) {
    run('UPDATE brands SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), id]);
    audit(actor.id, actor.role, 'catalog.deactivate_brand', 'brand', id, {
      reason: 'has_products',
      product_count: brand.product_count
    });
    return {
      ok: true,
      deactivated: true,
      message: `این برند روی ${brand.product_count} کالا استفاده می‌شود؛ به‌جای حذف، غیرفعال شد.`
    };
  }
  // The row is referenced by nothing, so a raw delete is safe here. Its logo file
  // would otherwise stay on disk forever with no row pointing at it.
  run('DELETE FROM brands WHERE id = ?', [id]);
  removeLogoFile(brand.logo_path);
  audit(actor.id, actor.role, 'catalog.delete_brand', 'brand', id, { name: brand.name });
  return { ok: true, deleted: true };
}

/** Writes an already-validated uploaded logo and points the brand at it. */
function saveLogo(actor, id, file) {
  if (!file) {
    throw ApiError.validation('فایل تصویر لوگو انتخاب نشده است.', [
      { field: 'logo', message: 'فایل تصویر الزامی است.' }
    ]);
  }
  // multer stored the file under a UUID name inside the public folder.
  const filename = path.basename(file.filename);
  const logoPath = `/uploads/${filename}`;
  const previous = get('SELECT logo_path FROM brands WHERE id = ?', [id]);
  if (!previous) throw ApiError.notFound('برند یافت نشد.');

  run('UPDATE brands SET logo_path = ?, updated_at = ? WHERE id = ?', [logoPath, nowIso(), id]);
  audit(actor.id, actor.role, 'catalog.brand_logo_upload', 'brand', id, { logo_path: logoPath });

  // Old logo files are dropped so the disk does not grow with every re-upload.
  if (previous.logo_path && previous.logo_path !== logoPath) removeLogoFile(previous.logo_path);
  return brandById(id);
}

function removeLogo(actor, id) {
  const brand = getBrandRow(id);
  if (!brand.logo_path) return brandToJson(brand);
  run('UPDATE brands SET logo_path = NULL, updated_at = ? WHERE id = ?', [nowIso(), id]);
  audit(actor.id, actor.role, 'catalog.brand_logo_remove', 'brand', id, { previous: brand.logo_path });
  removeLogoFile(brand.logo_path);
  return brandById(id);
}

/** Bulk ordering from the admin UI (drag-free: explicit numeric weights). */
function reorderBrands(actor, items) {
  if (!Array.isArray(items)) {
    throw ApiError.validation('ترتیب برندها نامعتبر است.', [{ field: 'items', message: 'آرایه لازم است.' }]);
  }
  tx(() => {
    items.forEach((item, index) => {
      if (!item || typeof item.id !== 'string') return;
      const position = Number.isInteger(item.sort_order) ? item.sort_order : index;
      run('UPDATE brands SET sort_order = ?, updated_at = ? WHERE id = ?',
        [position, nowIso(), item.id]);
    });
    audit(actor.id, actor.role, 'catalog.reorder_brands', 'brand', null, { count: items.length });
  });
  return listAdminBrands();
}

module.exports = {
  brandToJson, brandSlug,
  listPublicBrands, listAdminBrands, brandById,
  createBrand, updateBrand, deleteBrand, saveLogo, removeLogo, reorderBrands
};
