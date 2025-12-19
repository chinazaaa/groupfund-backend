-- Migration: Add link and notes columns to wishlist_items table
-- Links allow users to specify where to buy items (e.g., Amazon URL)
-- Notes allow users to add additional information about the item

-- Add link column to wishlist_items table
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS link TEXT;

-- Add notes column to wishlist_items table
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add comments to document the fields
COMMENT ON COLUMN wishlist_items.link IS 'URL or link where the item can be purchased (optional)';
COMMENT ON COLUMN wishlist_items.notes IS 'Additional notes about the wishlist item (optional)';

