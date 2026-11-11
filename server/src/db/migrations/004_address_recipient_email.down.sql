-- Remove optional recipient email from saved shipping addresses.
ALTER TABLE user_addresses DROP COLUMN recipient_email;
