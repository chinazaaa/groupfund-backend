-- Migration: Add wishlist tables for birthday wishlists
-- Users can add items to their wishlist, and group members can see and claim items

-- Wishlist items table (profile-level, visible to all group members)
CREATE TABLE IF NOT EXISTS wishlist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  picture TEXT, -- URL or path to image (optional)
  price DECIMAL(10, 2), -- Optional price
  currency VARCHAR(3) DEFAULT 'NGN', -- Currency code for the price
  is_done BOOLEAN DEFAULT FALSE, -- Celebrant can mark items as done
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Wishlist claims table (tracks who claimed what items)
CREATE TABLE IF NOT EXISTS wishlist_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wishlist_item_id UUID REFERENCES wishlist_items(id) ON DELETE CASCADE NOT NULL,
  claimed_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  quantity_claimed INTEGER NOT NULL DEFAULT 1 CHECK (quantity_claimed > 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wishlist_item_id, claimed_by_user_id) -- One claim per user per item
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_wishlist_items_user_id ON wishlist_items(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_is_done ON wishlist_items(is_done);
CREATE INDEX IF NOT EXISTS idx_wishlist_claims_item_id ON wishlist_claims(wishlist_item_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_claims_user_id ON wishlist_claims(claimed_by_user_id);

-- Trigger to auto-update updated_at timestamp
CREATE TRIGGER update_wishlist_items_updated_at BEFORE UPDATE ON wishlist_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments to document the tables
COMMENT ON TABLE wishlist_items IS 'Birthday wishlist items at profile level. Visible to all group members.';
COMMENT ON TABLE wishlist_claims IS 'Tracks which users have claimed which wishlist items.';

