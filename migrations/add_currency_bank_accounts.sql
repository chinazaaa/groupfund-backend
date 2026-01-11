-- Migration: Add Currency-Specific Bank Account Details
-- Allows users to have different bank accounts for different currencies
-- This is necessary because payment processors require specific account types per currency:
-- - Stripe: US bank accounts for USD, UK accounts for GBP, etc.
-- - Paystack: Nigerian bank accounts for NGN

-- Create wallet_bank_accounts table (one bank account per currency per user)
CREATE TABLE IF NOT EXISTS wallet_bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  currency VARCHAR(3) NOT NULL, -- ISO 4217 currency code (NGN, USD, GBP, etc.)
  account_name VARCHAR(255) NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(50) NOT NULL,
  iban VARCHAR(34), -- For international transfers (EU, UK, etc.)
  swift_bic VARCHAR(11), -- For international transfers
  routing_number VARCHAR(20), -- For US bank accounts
  sort_code VARCHAR(10), -- For UK bank accounts
  branch_code VARCHAR(20), -- For some countries
  branch_address TEXT, -- Optional additional information
  bank_code VARCHAR(20), -- For Paystack (Nigerian bank code)
  is_default BOOLEAN DEFAULT FALSE, -- Mark one account per currency as default
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, currency, account_number) -- One account per currency per account number (user can have multiple accounts per currency if needed)
);

CREATE INDEX IF NOT EXISTS idx_wallet_bank_accounts_user_id ON wallet_bank_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_bank_accounts_currency ON wallet_bank_accounts(currency);
CREATE INDEX IF NOT EXISTS idx_wallet_bank_accounts_user_currency ON wallet_bank_accounts(user_id, currency);
CREATE INDEX IF NOT EXISTS idx_wallet_bank_accounts_is_default ON wallet_bank_accounts(user_id, currency, is_default);

-- Migrate existing bank account details to currency-specific accounts
-- Create one account record per currency the user has received contributions in
-- If user has bank details but no currency balances yet, they'll need to add accounts when they receive first contribution
INSERT INTO wallet_bank_accounts (
  user_id, currency, account_name, bank_name, account_number,
  iban, swift_bic, routing_number, sort_code, branch_code, branch_address,
  is_default, created_at, updated_at
)
SELECT DISTINCT
  wb.user_id,
  wb.currency, -- Use currency from wallet_balances (balances that actually exist)
  w.account_name,
  w.bank_name,
  w.account_number,
  w.iban,
  w.swift_bic,
  w.routing_number,
  w.sort_code,
  w.branch_code,
  w.branch_address,
  TRUE as is_default, -- Mark as default for this currency
  w.created_at,
  w.updated_at
FROM wallet_balances wb
JOIN wallets w ON wb.user_id = w.user_id
WHERE w.account_name IS NOT NULL 
  AND w.bank_name IS NOT NULL 
  AND w.account_number IS NOT NULL
  AND wb.balance > 0 -- Only migrate for currencies user actually has balances in
ON CONFLICT (user_id, currency, account_number) DO NOTHING;

-- Note: Users with bank details in wallets table but no currency balances yet
-- will need to add their bank account details per currency when they:
-- 1. Receive their first contribution in a currency, OR
-- 2. Try to withdraw from that currency

-- Add bank_account_id to withdrawals table to link to currency-specific bank account
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES wallet_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawals_bank_account_id ON withdrawals(bank_account_id);

-- Add comment
COMMENT ON TABLE wallet_bank_accounts IS 'Stores bank account details per currency per user. Users can have different bank accounts for different currencies.';
COMMENT ON COLUMN wallet_bank_accounts.currency IS 'ISO 4217 currency code (e.g., NGN, USD, GBP, EUR). Bank account must match currency requirements (e.g., US bank for USD, Nigerian bank for NGN).';
COMMENT ON COLUMN wallet_bank_accounts.is_default IS 'Marks the default bank account for a currency. Used when user has multiple accounts for the same currency.';
COMMENT ON COLUMN wallet_bank_accounts.bank_code IS 'Bank code required by some payment processors (e.g., Paystack requires Nigerian bank codes for NGN transfers).';
COMMENT ON COLUMN withdrawals.bank_account_id IS 'References the currency-specific bank account used for this withdrawal.';
