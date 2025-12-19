-- Migration: Add is_fulfilled column to wishlist_claims table
-- This allows celebrants to mark individual claims as fulfilled (e.g., person A bought the book, person B hasn't yet)

-- Add is_fulfilled column to wishlist_claims table
ALTER TABLE wishlist_claims ADD COLUMN IF NOT EXISTS is_fulfilled BOOLEAN DEFAULT FALSE;

-- Update existing claims to have is_fulfilled = false (if they don't have it set)
UPDATE wishlist_claims SET is_fulfilled = FALSE WHERE is_fulfilled IS NULL;

-- Create index for better performance when querying fulfilled claims
CREATE INDEX IF NOT EXISTS idx_wishlist_claims_is_fulfilled ON wishlist_claims(is_fulfilled);

-- Add comment to document the field
COMMENT ON COLUMN wishlist_claims.is_fulfilled IS 'Whether this specific claim has been fulfilled by the celebrant. Individual claims can be marked as fulfilled independently.';

