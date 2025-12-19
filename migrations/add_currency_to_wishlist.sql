-- Migration: Add currency column to wishlist_items table
-- This allows users to specify the currency for wishlist item prices

-- Add currency column to wishlist_items table
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'NGN';

-- Update existing items to have NGN as default if they don't have currency set
UPDATE wishlist_items SET currency = 'NGN' WHERE currency IS NULL;

-- Add comment to document the field
COMMENT ON COLUMN wishlist_items.currency IS '3-letter currency code for the item price (e.g., NGN, USD, GBP). Defaults to NGN.';

