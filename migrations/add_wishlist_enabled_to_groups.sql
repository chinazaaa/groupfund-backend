-- Migration: Add wishlist_enabled column to groups table
-- Allows group creators to enable/disable wishlist for general groups
-- When enabled, group members can view the admin's wishlist

-- Add wishlist_enabled column (defaults to false for existing groups)
ALTER TABLE groups ADD COLUMN IF NOT EXISTS wishlist_enabled BOOLEAN DEFAULT false;

-- Update existing groups to have wishlist disabled by default
UPDATE groups SET wishlist_enabled = false WHERE wishlist_enabled IS NULL;

-- Add comment
COMMENT ON COLUMN groups.wishlist_enabled IS 'Whether wishlist is enabled for this group. When enabled, group members can view the admin''s wishlist. Only applicable to general groups.';

-- Create index for wishlist_enabled queries (optional, but useful if filtering by wishlist enabled)
CREATE INDEX IF NOT EXISTS idx_groups_wishlist_enabled ON groups(wishlist_enabled) WHERE wishlist_enabled = true;
