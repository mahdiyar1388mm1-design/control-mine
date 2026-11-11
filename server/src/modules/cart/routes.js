'use strict';

const express = require('express');
const { all, get, run, tx } = require('../../db');
const { requireAuth } = require('../../middleware/auth');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, validate } = require('../../utils/validate');
const { shippingConfig } = require('../platform/service');

const router = express.Router();
router.use(requireAuth);

function getOrCreateCart(userId) {
  let cart = get('SELECT * FROM carts WHERE user_id = ?', [userId]);
  if (!cart) {
    const id = uuid();
    const now = nowIso();
    run('INSERT INTO carts (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)', [id, userId, now, now]);
    cart = get('SELECT * FROM carts WHERE id = ?', [id]);
  }
  return cart;
}

function cartView(userId) {
  const cart = getOrCreateCart(userId);
  const items = all(
    `SELECT ci.id AS item_id, ci.quantity, s.id AS sku_id, s.code, s.variant_attrs, s.price_toman, s.stock, s.is_active,
            p.id AS product_id, p.name AS product_name, p.slug AS product_slug, p.image_path, p.status AS product_status,
            p.deleted_at
       FROM cart_items ci
       JOIN skus s ON s.id = ci.sku_id
       JOIN products p ON p.id = s.product_id
      WHERE ci.cart_id = ?
      ORDER BY ci.rowid`,
    [cart.id]
  );
  let subtotal = 0;
  const mapped = items.map((row) => {
    const available = Boolean(row.is_active) && row.product_status === 'active' && !row.deleted_at;
    const lineTotal = available ? row.price_toman * row.quantity : 0;
    subtotal += lineTotal;
    return {
      item_id: row.item_id,
      sku_id: row.sku_id,
      sku_code: row.code,
      variant_attrs: JSON.parse(row.variant_attrs || '{}'),
      quantity: row.quantity,
      unit_price_toman: row.price_toman,
      line_total_toman: lineTotal,
      stock: row.stock,
      purchasable: available && row.stock > 0,
      product: {
        id: row.product_id,
        name: row.product_name,
        slug: row.product_slug,
        image_path: row.image_path
      }
    };
  });
  const shipCfg = shippingConfig();
  const estimatedShipping = subtotal === 0 ? 0 : (subtotal >= shipCfg.freeOverToman ? 0 : shipCfg.flatToman);
  return {
    cart_id: cart.id,
    items: mapped,
    subtotal_toman: subtotal,
    shipping_estimate_toman: estimatedShipping,
    estimated_total_toman: subtotal + estimatedShipping,
    shipping_rule: {
      flat_toman: shipCfg.flatToman,
      free_over_toman: shipCfg.freeOverToman
    },
    currency: 'تومان',
    updated_at: cart.updated_at
  };
}

router.get('/', (req, res) => {
  res.json(cartView(req.user.id));
});

router.post('/items', (req, res, next) => {
  try {
    const data = validate(req.body)
      .string('sku_id', { min: 1, max: 64 })
      .int('quantity', { min: 1, max: 100 })
      .done();
    const sku = get(
      `SELECT s.*, p.status AS product_status, p.deleted_at FROM skus s
         JOIN products p ON p.id = s.product_id
        WHERE s.id = ?`,
      [data.sku_id]
    );
    if (!sku || sku.deleted_at || sku.product_status !== 'active' || !sku.is_active) {
      throw ApiError.notFound('این کالا در حال حاضر قابل خرید نیست.');
    }
    tx(() => {
      const cart = getOrCreateCart(req.user.id);
      const existing = get('SELECT * FROM cart_items WHERE cart_id = ? AND sku_id = ?', [cart.id, data.sku_id]);
      const nextQty = (existing ? existing.quantity : 0) + data.quantity;
      if (nextQty > sku.stock) {
        throw ApiError.outOfStock('موجودی این کالا کافی نیست.', [{ field: 'quantity', message: `حداکثر موجودی: ${sku.stock}` }]);
      }
      if (existing) {
        run('UPDATE cart_items SET quantity = ? WHERE id = ?', [nextQty, existing.id]);
      } else {
        run('INSERT INTO cart_items (id, cart_id, sku_id, quantity) VALUES (?, ?, ?, ?)',
          [uuid(), cart.id, data.sku_id, data.quantity]);
      }
      run('UPDATE carts SET updated_at = ? WHERE id = ?', [nowIso(), cart.id]);
    });
    res.status(201).json(cartView(req.user.id));
  } catch (err) { next(err); }
});

router.patch('/items/:id', (req, res, next) => {
  try {
    const data = validate(req.body).int('quantity', { min: 1, max: 100 }).done();
    const item = get(
      `SELECT ci.*, s.stock FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
        WHERE ci.id = ? AND c.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!item) throw ApiError.notFound('اقلام سبد یافت نشد.');
    if (data.quantity > item.stock) {
      throw ApiError.outOfStock('موجودی این کالا کافی نیست.', [{ field: 'quantity', message: `حداکثر موجودی: ${item.stock}` }]);
    }
    run('UPDATE cart_items SET quantity = ? WHERE id = ?', [data.quantity, item.id]);
    run('UPDATE carts SET updated_at = ? WHERE id = ?', [nowIso(), item.cart_id]);
    res.json(cartView(req.user.id));
  } catch (err) { next(err); }
});

router.delete('/items/:id', (req, res, next) => {
  try {
    const item = get(
      `SELECT ci.* FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
        WHERE ci.id = ? AND c.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!item) throw ApiError.notFound('اقلام سبد یافت نشد.');
    run('DELETE FROM cart_items WHERE id = ?', [item.id]);
    res.json(cartView(req.user.id));
  } catch (err) { next(err); }
});

router.delete('/', (req, res) => {
  const cart = getOrCreateCart(req.user.id);
  run('DELETE FROM cart_items WHERE cart_id = ?', [cart.id]);
  res.json(cartView(req.user.id));
});

module.exports = router;
module.exports.cartView = cartView;
module.exports.getOrCreateCart = getOrCreateCart;
