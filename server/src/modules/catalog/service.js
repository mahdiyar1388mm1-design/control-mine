'use strict';

const { likeContains } = require('../../utils/dbGuards');

const { all, get, run, tx } = require('../../db');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, validate, parsePagination, parseJsonObject, humanCode } = require('../../utils/validate');
const { audit } = require('../platform/service');

const PRODUCT_STATUS = ['active', 'draft', 'archived'];

function skuToJson(row, { includeCost = false } = {}) {
  return {
    id: row.id,
    product_id: row.product_id,
    code: row.code,
    variant_attrs: parseJsonObject(row.variant_attrs),
    price_toman: row.price_toman,
    ...(includeCost ? { cost_price_toman: row.cost_price_toman } : {}),
    stock: row.stock,
    weight_grams: row.weight_grams,
    dims: row.dims ? parseJsonObject(row.dims) : null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function listCategories() {
  return all('SELECT * FROM categories ORDER BY sort_order, name');
}

function listBrands() {
  return all('SELECT * FROM brands ORDER BY name');
}

function listProducts(query) {
  const { page, limit, offset } = parsePagination(query);
  const where = ['p.deleted_at IS NULL', "p.status = 'active'"];
  const params = [];
  if (query.q) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\')");
    const like = likeContains(query.q);
    params.push(like, like, like);
  }
  if (query.category) {
    where.push('c.slug = ?');
    params.push(query.category);
  }
  if (query.brand) {
    where.push('b.slug = ?');
    params.push(query.brand);
  }
  if (query.min_price !== undefined && query.min_price !== '') {
    where.push('(SELECT MIN(s.price_toman) FROM skus s WHERE s.product_id = p.id AND s.is_active = 1) >= ?');
    params.push(Number(query.min_price));
  }
  if (query.max_price !== undefined && query.max_price !== '') {
    where.push('(SELECT MIN(s.price_toman) FROM skus s WHERE s.product_id = p.id AND s.is_active = 1) <= ?');
    params.push(Number(query.max_price));
  }
  const whereSql = where.join(' AND ');
  const sortMap = {
    newest: 'p.created_at DESC',
    price_asc: 'min_price ASC',
    price_desc: 'min_price DESC',
    name: 'p.name ASC'
  };
  const sortSql = sortMap[query.sort] || sortMap.newest;
  const items = all(
    `SELECT p.*, c.name AS category_name, b.name AS brand_name,
            (SELECT MIN(s.price_toman) FROM skus s WHERE s.product_id = p.id AND s.is_active = 1) AS min_price,
            (SELECT MAX(s.price_toman) FROM skus s WHERE s.product_id = p.id AND s.is_active = 1) AS max_price,
            (SELECT SUM(s.stock) FROM skus s WHERE s.product_id = p.id AND s.is_active = 1) AS total_stock
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE ${whereSql}
      ORDER BY ${sortSql}
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = get(
    `SELECT COUNT(*) AS c FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE ${whereSql}`,
    params
  ).c;
  return {
    items: items.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      image_path: p.image_path,
      category: p.category_name,
      brand: p.brand_name,
      min_price_toman: p.min_price,
      max_price_toman: p.max_price,
      total_stock: p.total_stock,
      created_at: p.created_at
    })),
    page, limit, total
  };
}

function productBySlug(slug, { includeCost = false, includeInactive = false } = {}) {
  const statusFilter = includeInactive ? '' : " AND p.status = 'active'";
  const p = get(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, b.slug AS brand_slug
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.slug = ? AND p.deleted_at IS NULL${statusFilter}`,
    [slug]
  );
  if (!p) throw ApiError.notFound('کالا یافت نشد.');
  const skus = all('SELECT * FROM skus WHERE product_id = ? ORDER BY price_toman', [p.id]);
  const images = all('SELECT id, path, alt_text, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order', [p.id]);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    status: p.status,
    image_path: p.image_path,
    category: p.category_name ? { name: p.category_name, slug: p.category_slug } : null,
    brand: p.brand_name ? { name: p.brand_name, slug: p.brand_slug } : null,
    images,
    skus: skus.map((s) => skuToJson(s, { includeCost })),
    created_at: p.created_at,
    updated_at: p.updated_at
  };
}

function slugify(name) {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  let slug = base || `item-${Date.now()}`;
  let i = 1;
  while (get('SELECT 1 AS x FROM products WHERE slug = ?', [slug]) || get('SELECT 1 AS x FROM services WHERE slug = ?', [slug])) {
    slug = `${base}-${i}`;
    i += 1;
  }
  return slug;
}

function createProduct(actor, input) {
  const data = validate(input)
    .string('name', { min: 2, max: 120 })
    .string('description', { default: '' })
    .string('brand_id', { required: false, default: null })
    .string('category_id', { required: false, default: null })
    .string('status', { enum: PRODUCT_STATUS, default: 'active' })
    .string('image_path', { required: false, default: null, max: 300 })
    .done();
  const id = uuid();
  const now = nowIso();
  const slug = slugify(data.name);
  run(
    `INSERT INTO products (id, name, slug, description, brand_id, category_id, status, image_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.name, slug, data.description, data.brand_id, data.category_id, data.status, data.image_path, now, now]
  );
  audit(actor.id, actor.role, 'catalog.create_product', 'product', id, { name: data.name });
  return productBySlug(slug, { includeCost: true, includeInactive: true });
}

function updateProduct(actor, id, input) {
  const p = get('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!p) throw ApiError.notFound('کالا یافت نشد.');
  const data = validate(input)
    .string('name', { required: false, min: 2, max: 120 })
    .string('description', { required: false })
    .string('brand_id', { required: false, default: undefined })
    .string('category_id', { required: false, default: undefined })
    .string('status', { required: false, enum: PRODUCT_STATUS })
    .string('image_path', { required: false, default: undefined, max: 300 })
    .done();
  const merged = { ...p, ...data };
  run(
    `UPDATE products SET name = ?, description = ?, brand_id = ?, category_id = ?, status = ?, image_path = ?, updated_at = ?
      WHERE id = ?`,
    [merged.name, merged.description, merged.brand_id || null, merged.category_id || null, merged.status,
      merged.image_path || null, nowIso(), id]
  );
  audit(actor.id, actor.role, 'catalog.update_product', 'product', id, { fields: Object.keys(data) });
  return productBySlug(merged.slug, { includeCost: true, includeInactive: true });
}

function deleteProduct(actor, id) {
  const p = get('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!p) throw ApiError.notFound('کالا یافت نشد.');
  const orderCount = get(
    `SELECT COUNT(*) AS c FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.sku_id IN (SELECT id FROM skus WHERE product_id = ?)`,
    [id]
  ).c;
  if (orderCount > 0) {
    // Record-retention policy: products with order history are archived, not physically deleted.
    run("UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?", [nowIso(), id]);
    audit(actor.id, actor.role, 'catalog.archive_product', 'product', id, { reason: 'has_orders', orderCount });
    return { ok: true, archived: true, message: 'کالا دارای سابقهٔ سفارش است؛ به‌جای حذف، بایگانی شد.' };
  }
  run('UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), id]);
  audit(actor.id, actor.role, 'catalog.delete_product', 'product', id, {});
  return { ok: true, archived: false };
}

function normalizeVariantAttrs(raw) {
  if (raw === undefined || raw === null || raw === '') return '{}';
  if (typeof raw === 'object' && !Array.isArray(raw)) return JSON.stringify(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) {
      throw ApiError.validation('ویژگی‌های تنوع باید JSON معتبر باشد.', [{ field: 'variant_attrs', message: 'قالب JSON نادرست است.' }]);
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not obj');
      return JSON.stringify(parsed);
    } catch {
      throw ApiError.validation('ویژگی‌های تنوع باید JSON معتبر باشد.', [{ field: 'variant_attrs', message: 'قالب JSON نادرست است.' }]);
    }
  }
  throw ApiError.validation('ویژگی‌های تنوع نامعتبر است.', [{ field: 'variant_attrs', message: 'قالب نادرست است.' }]);
}

function createCategory(actor, input) {
  const data = validate(input)
    .string('name', { min: 2, max: 80 })
    .int('sort_order', { required: false, min: 0, max: 10000, default: 0 })
    .done();
  const id = uuid();
  const slug = slugify(data.name);
  run('INSERT INTO categories (id, name, slug, parent_id, sort_order) VALUES (?, ?, ?, NULL, ?)',
    [id, data.name, slug, data.sort_order]);
  audit(actor.id, actor.role, 'catalog.create_category', 'category', id, { name: data.name });
  return get('SELECT * FROM categories WHERE id = ?', [id]);
}

function createBrand(actor, input) {
  const data = validate(input).string('name', { min: 2, max: 80 }).done();
  const id = uuid();
  const slug = slugify(data.name);
  run('INSERT INTO brands (id, name, slug) VALUES (?, ?, ?)', [id, data.name, slug]);
  audit(actor.id, actor.role, 'catalog.create_brand', 'brand', id, { name: data.name });
  return get('SELECT * FROM brands WHERE id = ?', [id]);
}

function createSku(actor, productId, input) {
  const p = get('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', [productId]);
  if (!p) throw ApiError.notFound('کالا یافت نشد.');
  const data = validate(input)
    .string('code', { required: false, max: 40 })
    .int('price_toman', { min: 0 })
    .int('cost_price_toman', { min: 0, default: 0 })
    .int('stock', { min: 0, default: 0 })
    .int('weight_grams', { required: false, min: 0, default: null })
    .bool('is_active', { default: true })
    .done();
  const variantJson = normalizeVariantAttrs(input && input.variant_attrs);
  const id = uuid();
  const now = nowIso();
  const code = data.code || humanCode('SKU');
  if (get('SELECT 1 AS x FROM skus WHERE code = ?', [code])) {
    throw ApiError.conflict('این کد کالا قبلاً ثبت شده است.');
  }
  run(
    `INSERT INTO skus (id, product_id, code, variant_attrs, price_toman, cost_price_toman, stock, weight_grams, dims, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [id, productId, code, variantJson, data.price_toman, data.cost_price_toman,
      data.stock, data.weight_grams, data.is_active ? 1 : 0, now, now]
  );
  if (data.stock > 0) {
    run('INSERT INTO stock_movements (id, sku_id, delta, reason, ref_type, ref_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), id, data.stock, 'initial_stock', 'sku', id, actor.id, now]);
  }
  audit(actor.id, actor.role, 'catalog.create_sku', 'sku', id, { productId, code });
  return skuToJson(get('SELECT * FROM skus WHERE id = ?', [id]), { includeCost: true });
}

function updateSku(actor, id, input) {
  const sku = get('SELECT * FROM skus WHERE id = ?', [id]);
  if (!sku) throw ApiError.notFound('تنوع کالا یافت نشد.');
  const data = validate(input)
    .int('price_toman', { required: false, min: 0 })
    .int('cost_price_toman', { required: false, min: 0 })
    .int('stock', { required: false, min: 0 })
    .int('weight_grams', { required: false, min: 0, default: undefined })
    .bool('is_active', {})
    .done();
  const variantJson = input && input.variant_attrs !== undefined
    ? normalizeVariantAttrs(input.variant_attrs)
    : sku.variant_attrs;
  const merged = { ...sku, ...data, variant_attrs: variantJson };
  const stockChanged = data.stock !== undefined && data.stock !== sku.stock;
  tx(() => {
    run(
      `UPDATE skus SET variant_attrs = ?, price_toman = ?, cost_price_toman = ?, stock = ?, weight_grams = ?, is_active = ?, updated_at = ?
        WHERE id = ?`,
      [merged.variant_attrs, merged.price_toman, merged.cost_price_toman, merged.stock,
        merged.weight_grams === undefined ? sku.weight_grams : merged.weight_grams,
        merged.is_active === undefined ? sku.is_active : (merged.is_active ? 1 : 0), nowIso(), id]
    );
    if (stockChanged) {
      run('INSERT INTO stock_movements (id, sku_id, delta, reason, ref_type, ref_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), id, merged.stock - sku.stock, 'admin_set_stock', 'sku', id, actor.id, nowIso()]);
    }
    audit(actor.id, actor.role, 'catalog.update_sku', 'sku', id, { fields: Object.keys(data) });
  });
  return skuToJson(get('SELECT * FROM skus WHERE id = ?', [id]), { includeCost: true });
}

function adjustStock(actor, id, input) {
  const sku = get('SELECT * FROM skus WHERE id = ?', [id]);
  if (!sku) throw ApiError.notFound('تنوع کالا یافت نشد.');
  const data = validate(input)
    .int('delta', { min: -100000, max: 100000 })
    .string('reason', { min: 3, max: 200 })
    .done();
  if (data.delta === 0) throw ApiError.validation('تغییر موجودی نمی‌تواند صفر باشد.');
  const nextStock = sku.stock + data.delta;
  if (nextStock < 0) throw ApiError.conflict('موجودی نمی‌تواند منفی شود.');
  tx(() => {
    const res = run('UPDATE skus SET stock = ?, updated_at = ? WHERE id = ?', [nextStock, nowIso(), id]);
    if (res.changes !== 1) throw ApiError.internal('به‌روزرسانی موجودی انجام نشد.');
    run('INSERT INTO stock_movements (id, sku_id, delta, reason, ref_type, ref_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid(), id, data.delta, data.reason, 'manual_adjust', id, actor.id, nowIso()]);
    audit(actor.id, actor.role, 'catalog.adjust_stock', 'sku', id, { delta: data.delta, reason: data.reason });
  });
  return skuToJson(get('SELECT * FROM skus WHERE id = ?', [id]), { includeCost: true });
}

function listProductsAdmin(query) {
  const { page, limit, offset } = parsePagination(query);
  const items = all(
    `SELECT p.*, c.name AS category_name, b.name AS brand_name,
            (SELECT COUNT(*) FROM skus s WHERE s.product_id = p.id) AS sku_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.deleted_at IS NULL
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const total = get('SELECT COUNT(*) AS c FROM products WHERE deleted_at IS NULL').c;
  return { items, page, limit, total };
}

function listSkusAdmin(query) {
  const { page, limit, offset } = parsePagination(query);
  const where = ['p.deleted_at IS NULL'];
  const params = [];
  if (query.q) {
    where.push("(s.code LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')");
    params.push(likeContains(query.q), likeContains(query.q));
  }
  if (query.low_stock === '1') {
    where.push('s.stock <= 5');
  }
  const whereSql = where.join(' AND ');
  const items = all(
    `SELECT s.*, p.name AS product_name, p.slug AS product_slug
       FROM skus s JOIN products p ON p.id = s.product_id
      WHERE ${whereSql}
      ORDER BY s.stock ASC, p.name ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map((row) => ({
    ...skuToJson(row, { includeCost: false }),
    product_name: row.product_name,
    product_slug: row.product_slug
  }));
  const total = get(`SELECT COUNT(*) AS c FROM skus s JOIN products p ON p.id = s.product_id WHERE ${whereSql}`, params).c;
  return { items, page, limit, total };
}

function listStockMovements(skuId) {
  return all(
    `SELECT m.*, u.full_name AS actor_name FROM stock_movements m
       LEFT JOIN users u ON u.id = m.actor_id
      WHERE m.sku_id = ? ORDER BY m.created_at DESC LIMIT 50`,
    [skuId]
  );
}

module.exports = {
  skuToJson, listCategories, listBrands, listProducts, productBySlug,
  createCategory, createBrand,
  createProduct, updateProduct, deleteProduct, createSku, updateSku, adjustStock,
  listProductsAdmin, listSkusAdmin, listStockMovements
};
