-- Migration: Add Multi-Currency Wallet Balances Support
-- Allows users to have separate balances for each currency

-- 1. Create wallet_balances table (one balance per currency per user)
CREATE TABLE IF NOT EXISTS wallet_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  currency VARCHAR(3) NOT NULL, -- ISO 4217 currency code (NGN, USD, GBP, etc.)
  balance DECIMAL(10, 2) DEFAULT 0.00 NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, currency) -- One balance per currency per user
);

CREATE INDEX IF NOT EXISTS idx_wallet_balances_user_id ON wallet_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_balances_currency ON wallet_balances(currency);
CREATE INDEX IF NOT EXISTS idx_wallet_balances_user_currency ON wallet_balances(user_id, currency);

-- 2. Add currency column to transactions table (if not exists)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

-- 3. Add currency column to wallets table (for backward compatibility, but we'll use wallet_balances going forward)
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

-- 4. Migrate existing wallet balances to wallet_balances table
-- Only migrate balances based on actual contributions received (transactions with currency)
-- This ensures we only create balances for currencies users actually received contributions in
-- If a user has old balance in wallets table but no transactions with currency, 
-- we can't determine the currency - it will remain unmigrated until they receive a new contribution

-- Migrate from transactions table (if currency exists)
INSERT INTO wallet_balances (user_id, currency, balance, created_at, updated_at)
SELECT 
  t.user_id,
  t.currency,
  COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0) as balance,
  MIN(t.created_at) as created_at,
  MAX(t.created_at) as updated_at
FROM transactions t
WHERE t.currency IS NOT NULL
  AND t.status = 'completed'
GROUP BY t.user_id, t.currency
HAVING COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0) > 0
ON CONFLICT (user_id, currency) DO UPDATE SET
  balance = EXCLUDED.balance,
  updated_at = EXCLUDED.updated_at;
  
-- Note: Old balances in wallets table without currency info cannot be migrated
-- They'll be handled when users receive their next contribution (which will have currency from the group)

-- Add comment
COMMENT ON TABLE wallet_balances IS 'Tracks user wallet balances per currency. Each user can have balances in multiple currencies.';
COMMENT ON COLUMN wallet_balances.currency IS 'ISO 4217 currency code (e.g., NGN, USD, GBP, EUR, KES, GHS, ZAR, CAD, AUD, JPY)';
