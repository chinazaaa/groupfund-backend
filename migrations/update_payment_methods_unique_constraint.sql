-- Migration: Update unique constraint on user_payment_methods to include currency
-- This allows the same payment method ID to exist multiple times with different currencies
-- Old constraint: (user_id, payment_method_id)
-- New constraint: (user_id, payment_method_id, currency)

-- Drop the old unique constraint if it exists
ALTER TABLE user_payment_methods 
DROP CONSTRAINT IF EXISTS user_payment_methods_user_id_payment_method_id_key;

-- Add new unique constraint that includes currency
-- This allows same payment method ID for different currencies
ALTER TABLE user_payment_methods 
ADD CONSTRAINT user_payment_methods_user_id_payment_method_id_currency_key 
UNIQUE (user_id, payment_method_id, currency);

-- Add comment
COMMENT ON CONSTRAINT user_payment_methods_user_id_payment_method_id_currency_key ON user_payment_methods IS 
'Ensures one payment method entry per user per payment_method_id per currency. Allows the same payment method (card) to be stored multiple times with different currencies.';
