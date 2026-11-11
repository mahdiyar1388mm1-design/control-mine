-- Remove shipping profile refund details and auto-fill preference.
ALTER TABLE user_addresses DROP COLUMN auto_fill;
ALTER TABLE user_addresses DROP COLUMN refund_sheba;
ALTER TABLE user_addresses DROP COLUMN refund_card_number;
