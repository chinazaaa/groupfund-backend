-- Migration: Add currency column to user_payment_methods table if it doesn't exist
-- This handles cases where the table was created before the currency column was added

-- Add currency column if it doesn't exist
ALTER TABLE user_payment_methods ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

-- Add index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_user_payment_methods_currency ON user_payment_methods(currency);
CREATE INDEX IF NOT EXISTS idx_user_payment_methods_user_currency ON user_payment_methods(user_id, currency);

-- Add comment
COMMENT ON COLUMN user_payment_methods.currency IS 'Primary currency this payment method supports (e.g., USD, NGN, GBP). Used to match payment methods to groups with specific currencies. Cards can typically charge in multiple currencies, but this indicates the primary/preferred currency for matching purposes.';
