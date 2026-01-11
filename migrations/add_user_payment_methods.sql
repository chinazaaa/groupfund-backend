-- Migration: Create user_payment_methods table
-- Stores payment methods independently of groups, allowing users to save cards for reuse

CREATE TABLE IF NOT EXISTS user_payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  payment_method_id VARCHAR(255) NOT NULL, -- Provider-specific ID (Stripe payment_method ID or Paystack authorization_code)
  provider VARCHAR(20) NOT NULL, -- 'stripe', 'paystack'
  payment_method_type VARCHAR(20) DEFAULT 'card', -- 'card', 'bank_account', etc.
  last4 VARCHAR(4), -- Last 4 digits of card/account for display
  brand VARCHAR(20), -- Card brand (Visa, Mastercard, etc.) - for cards only
  expiry_month INTEGER, -- Card expiry month (1-12) - for cards only
  expiry_year INTEGER, -- Card expiry year (YYYY) - for cards only
  is_default BOOLEAN DEFAULT FALSE, -- Mark one payment method as default per user
  is_active BOOLEAN DEFAULT TRUE, -- Soft delete flag
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, payment_method_id) -- One record per payment method per user
);

CREATE INDEX IF NOT EXISTS idx_user_payment_methods_user_id ON user_payment_methods(user_id);
CREATE INDEX IF NOT EXISTS idx_user_payment_methods_provider ON user_payment_methods(provider);
CREATE INDEX IF NOT EXISTS idx_user_payment_methods_is_default ON user_payment_methods(user_id, is_default);
CREATE INDEX IF NOT EXISTS idx_user_payment_methods_is_active ON user_payment_methods(user_id, is_active);

-- Add comment
COMMENT ON TABLE user_payment_methods IS 'Stores user payment methods (cards, bank accounts) independently of groups. Users can save payment methods and reuse them across multiple groups.';
COMMENT ON COLUMN user_payment_methods.payment_method_id IS 'Provider-specific payment method ID (Stripe payment_method ID or Paystack authorization_code)';
COMMENT ON COLUMN user_payment_methods.is_default IS 'Marks the default payment method for a user. Used when no specific method is selected for a group.';
COMMENT ON COLUMN user_payment_methods.is_active IS 'Soft delete flag. When false, payment method is deleted but record is kept for audit purposes.';
