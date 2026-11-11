-- Shipping profile: refund bank details and auto-fill preference on saved shipping addresses.
ALTER TABLE user_addresses ADD COLUMN refund_card_number TEXT;
ALTER TABLE user_addresses ADD COLUMN refund_sheba TEXT;
ALTER TABLE user_addresses ADD COLUMN auto_fill INTEGER NOT NULL DEFAULT 0;
