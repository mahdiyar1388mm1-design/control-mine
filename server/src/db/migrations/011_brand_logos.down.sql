-- Rollback for 011_brand_logos
-- The index has to go first: SQLite refuses to drop a column an index depends on.
DROP INDEX IF EXISTS idx_brands_active_sort;

ALTER TABLE brands DROP COLUMN updated_at;
ALTER TABLE brands DROP COLUMN created_at;
ALTER TABLE brands DROP COLUMN sort_order;
ALTER TABLE brands DROP COLUMN is_active;
ALTER TABLE brands DROP COLUMN website_url;
ALTER TABLE brands DROP COLUMN description;
ALTER TABLE brands DROP COLUMN logo_path;

DELETE FROM settings WHERE key = 'brand_logo_max_bytes';
