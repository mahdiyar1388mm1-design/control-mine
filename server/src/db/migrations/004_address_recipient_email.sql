-- Add optional recipient email to saved shipping addresses.
ALTER TABLE user_addresses ADD COLUMN recipient_email TEXT;
