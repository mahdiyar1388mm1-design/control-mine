-- ---------------------------------------------------------------------------
-- 011_brand_logos
-- Brands become first-class catalog records: their own logo, description,
-- website, ordering and an activation flag. Products already reference brands
-- through products.brand_id, so nothing about the product schema changes.
-- Fully additive: no column from 001..010 is modified or removed.
-- ---------------------------------------------------------------------------

ALTER TABLE brands ADD COLUMN logo_path   TEXT;                                   -- /uploads/brand-logo-*.png
ALTER TABLE brands ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE brands ADD COLUMN website_url TEXT;
ALTER TABLE brands ADD COLUMN is_active   INTEGER NOT NULL DEFAULT 1;              -- 0 = hidden from the storefront
ALTER TABLE brands ADD COLUMN sort_order  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE brands ADD COLUMN created_at  TEXT;
ALTER TABLE brands ADD COLUMN updated_at  TEXT;

-- Existing rows get a real timestamp instead of NULL.
UPDATE brands SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE created_at IS NULL;
UPDATE brands SET updated_at = created_at WHERE updated_at IS NULL;

-- Ordered listing of the storefront brand filter.
CREATE INDEX IF NOT EXISTS idx_brands_active_sort ON brands(is_active, sort_order, name);

-- Brand logos are public product media, never private documents.
INSERT OR IGNORE INTO settings (key, value) VALUES ('brand_logo_max_bytes', '2097152');
