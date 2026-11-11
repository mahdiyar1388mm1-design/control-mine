-- CENTRAL MINE — initial schema (v1)
-- All money values: INTEGER tomans. All timestamps: ISO-8601 UTC strings.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,
  email         TEXT UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer'
                CHECK (role IN ('customer','operator','support','warehouse','finance','admin')),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE user_addresses (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  province       TEXT NOT NULL,
  city           TEXT NOT NULL,
  address_line   TEXT NOT NULL,
  postal_code    TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  is_default     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_addresses_user ON user_addresses(user_id);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE otp_codes (
  id          TEXT PRIMARY KEY,
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_otp_phone ON otp_codes(phone);

-- ---------- catalog ----------

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  parent_id  TEXT REFERENCES categories(id),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE brands (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  brand_id    TEXT REFERENCES brands(id),
  category_id TEXT REFERENCES categories(id),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','draft','archived')),
  image_path  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_brand ON products(brand_id);
CREATE INDEX idx_products_status ON products(status);

CREATE TABLE product_images (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  alt_text   TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE skus (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  variant_attrs   TEXT NOT NULL DEFAULT '{}',
  price_toman     INTEGER NOT NULL CHECK (price_toman >= 0),
  cost_price_toman INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_toman >= 0),
  stock           INTEGER NOT NULL DEFAULT 0,
  weight_grams    INTEGER,
  dims            TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_skus_product ON skus(product_id);

CREATE TABLE stock_movements (
  id         TEXT PRIMARY KEY,
  sku_id     TEXT NOT NULL REFERENCES skus(id),
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  ref_type   TEXT,
  ref_id     TEXT,
  actor_id   TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_stock_movements_sku ON stock_movements(sku_id);

-- ---------- cart / orders ----------

CREATE TABLE carts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cart_items (
  id       TEXT PRIMARY KEY,
  cart_id  TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  sku_id   TEXT NOT NULL REFERENCES skus(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, sku_id)
);

CREATE TABLE orders (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  user_id          TEXT NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL
                   CHECK (status IN ('pending_payment','paid','preparing','shipped','completed','canceled','return_in_progress','returned')),
  subtotal_toman   INTEGER NOT NULL,
  shipping_toman   INTEGER NOT NULL DEFAULT 0,
  discount_toman   INTEGER NOT NULL DEFAULT 0,
  total_toman      INTEGER NOT NULL,
  address_snapshot TEXT NOT NULL,
  shipping_method  TEXT NOT NULL DEFAULT 'post',
  tracking_code    TEXT,
  idempotency_key  TEXT UNIQUE,
  cancel_reason    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku_id            TEXT NOT NULL REFERENCES skus(id),
  product_name      TEXT NOT NULL,
  sku_code          TEXT NOT NULL,
  variant_attrs     TEXT NOT NULL DEFAULT '{}',
  unit_price_toman  INTEGER NOT NULL,
  unit_cost_toman   INTEGER NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  line_total_toman  INTEGER NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_status_history (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status  TEXT NOT NULL,
  actor_id   TEXT REFERENCES users(id),
  actor_role TEXT,
  reason     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_order_history_order ON order_status_history(order_id);

-- ---------- payments ----------

CREATE TABLE payments (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT REFERENCES orders(id),
  service_request_id TEXT,
  amount_toman       INTEGER NOT NULL CHECK (amount_toman >= 0),
  status             TEXT NOT NULL
                     CHECK (status IN ('pending','paid','failed','canceled','expired','refunded')),
  gateway            TEXT NOT NULL DEFAULT 'sandbox',
  gateway_ref        TEXT,
  callback_token     TEXT NOT NULL UNIQUE,
  paid_at            TEXT,
  failure_reason     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (order_id IS NOT NULL OR service_request_id IS NOT NULL)
);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_request ON payments(service_request_id);

CREATE TABLE payment_events (
  id           TEXT PRIMARY KEY,
  payment_id   TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (payment_id, event, payload_hash)
);
CREATE INDEX idx_payment_events_payment ON payment_events(payment_id);

CREATE TABLE refunds (
  id           TEXT PRIMARY KEY,
  payment_id   TEXT NOT NULL REFERENCES payments(id),
  amount_toman INTEGER NOT NULL CHECK (amount_toman > 0),
  reason       TEXT NOT NULL,
  reference    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'done',
  actor_id     TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_refunds_payment ON refunds(payment_id);

-- ---------- services ----------

CREATE TABLE service_categories (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE services (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  category_id         TEXT REFERENCES service_categories(id),
  description         TEXT NOT NULL DEFAULT '',
  terms               TEXT NOT NULL DEFAULT '',
  exclusions          TEXT NOT NULL DEFAULT '',
  price_toman         INTEGER NOT NULL DEFAULT 0 CHECK (price_toman >= 0),
  est_duration_text   TEXT NOT NULL DEFAULT '',
  sla_hours           INTEGER NOT NULL DEFAULT 72,
  priority_default    TEXT NOT NULL DEFAULT 'normal'
                      CHECK (priority_default IN ('low','normal','high','urgent')),
  form_schema         TEXT NOT NULL DEFAULT '[]',
  form_version        INTEGER NOT NULL DEFAULT 1,
  required_documents  TEXT NOT NULL DEFAULT '[]',
  team_queue          TEXT NOT NULL DEFAULT 'services',
  capacity_per_day    INTEGER,
  delivery_method     TEXT NOT NULL DEFAULT 'download',
  cancel_policy       TEXT NOT NULL DEFAULT '',
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_services_category ON services(category_id);

CREATE TABLE service_form_versions (
  id             TEXT PRIMARY KEY,
  service_id     TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  form_schema    TEXT NOT NULL,
  terms_snapshot TEXT NOT NULL DEFAULT '',
  price_toman    INTEGER NOT NULL DEFAULT 0,
  sla_hours      INTEGER NOT NULL DEFAULT 72,
  created_at     TEXT NOT NULL,
  UNIQUE (service_id, version)
);

CREATE TABLE service_requests (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  service_id       TEXT NOT NULL REFERENCES services(id),
  user_id          TEXT NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL
                   CHECK (status IN ('draft','submitted','queued','assigned','in_progress','waiting_customer','completed','canceled','rejected','failed','refunded')),
  priority         TEXT NOT NULL DEFAULT 'normal'
                   CHECK (priority IN ('low','normal','high','urgent')),
  form_data        TEXT NOT NULL DEFAULT '{}',
  form_version     INTEGER NOT NULL,
  terms_snapshot   TEXT NOT NULL DEFAULT '',
  price_toman      INTEGER NOT NULL DEFAULT 0,
  assigned_to      TEXT REFERENCES users(id),
  assigned_team    TEXT NOT NULL DEFAULT 'services',
  due_at           TEXT,
  waiting_since    TEXT,
  result_summary   TEXT,
  payment_id       TEXT REFERENCES payments(id),
  cancel_reason    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  closed_at        TEXT
);
CREATE INDEX idx_sreq_user ON service_requests(user_id);
CREATE INDEX idx_sreq_status ON service_requests(status);
CREATE INDEX idx_sreq_assigned ON service_requests(assigned_to);

CREATE TABLE request_status_history (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    TEXT REFERENCES users(id),
  actor_role  TEXT,
  reason      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_sreq_history_request ON request_status_history(request_id);

CREATE TABLE request_messages (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id),
  author_role TEXT NOT NULL,
  kind        TEXT NOT NULL
              CHECK (kind IN ('customer','operator','internal_note','system')),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_sreq_messages_request ON request_messages(request_id);

CREATE TABLE request_files (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  uploader_id   TEXT REFERENCES users(id),
  kind          TEXT NOT NULL
                CHECK (kind IN ('customer_document','result_file','internal')),
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_sreq_files_request ON request_files(request_id);

-- ---------- support ----------

CREATE TABLE tickets (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  category    TEXT NOT NULL DEFAULT 'general',
  subject     TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'normal'
              CHECK (priority IN ('low','normal','high','urgent')),
  status      TEXT NOT NULL DEFAULT 'new'
              CHECK (status IN ('new','open','waiting_customer','waiting_team','resolved','closed')),
  assigned_to TEXT REFERENCES users(id),
  team        TEXT NOT NULL DEFAULT 'support',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  closed_at   TEXT
);
CREATE INDEX idx_tickets_user ON tickets(user_id);
CREATE INDEX idx_tickets_status ON tickets(status);

CREATE TABLE ticket_messages (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES users(id),
  author_role TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_messages_ticket ON ticket_messages(ticket_id);

CREATE TABLE ticket_files (
  id            TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  uploader_id   TEXT REFERENCES users(id),
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

-- ---------- platform ----------

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id),
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  detail      TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE TABLE idempotency_keys (
  key          TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code  INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (key, user_id, endpoint)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('store_name', '"CENTRAL MINE"'),
  ('currency_label', '"تومان"'),
  ('shipping_flat_toman', '39000'),
  ('shipping_free_over_toman', '1500000');
