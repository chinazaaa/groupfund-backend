-- Payment Automation Migration
-- Adds tables and columns for automatic payment processing

-- 1. Add payment provider customer IDs to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS paystack_customer_code VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);

-- 2. Create user_payment_preferences table for auto-pay per group
CREATE TABLE IF NOT EXISTS user_payment_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  auto_pay_enabled BOOLEAN DEFAULT FALSE,
  payment_method_type VARCHAR(20), -- 'card', 'bank_account', etc.
  payment_method_id VARCHAR(255), -- Provider-specific ID (Stripe payment_method ID or Paystack authorization_code)
  provider VARCHAR(20), -- 'stripe', 'paystack'
  payment_timing VARCHAR(20) DEFAULT 'same_day', -- '1_day_before' or 'same_day'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_user_payment_preferences_user_id ON user_payment_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_payment_preferences_group_id ON user_payment_preferences(group_id);
CREATE INDEX IF NOT EXISTS idx_user_payment_preferences_payment_timing ON user_payment_preferences(payment_timing);
CREATE INDEX IF NOT EXISTS idx_user_payment_preferences_auto_pay_enabled ON user_payment_preferences(auto_pay_enabled);

-- 3. Add default payment timing preference to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_payment_timing VARCHAR(20) DEFAULT 'same_day'; 
-- '1_day_before' or 'same_day' - used when no group-specific preference

-- 4. Add fee tracking to transactions table
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS processor_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gross_amount DECIMAL(10, 2); -- Amount charged to user
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS net_amount DECIMAL(10, 2); -- Amount recipient receives
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20); -- 'stripe', 'paystack', 'manual'
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method_id VARCHAR(255); -- Provider transaction ID
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS withdrawal_fee DECIMAL(10, 2) DEFAULT 0; -- Fee for withdrawals (if any)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payout_fee DECIMAL(10, 2) DEFAULT 0; -- Payout provider fee (Stripe/Paystack charges)

-- 5. Add payment method and provider tracking to contribution tables
ALTER TABLE birthday_contributions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'manual'; -- 'auto-debit', 'manual'
ALTER TABLE birthday_contributions ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20); -- 'stripe', 'paystack', null for manual
ALTER TABLE birthday_contributions ADD COLUMN IF NOT EXISTS provider_transaction_id VARCHAR(255);

ALTER TABLE subscription_contributions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'manual'; -- 'auto-debit', 'manual'
ALTER TABLE subscription_contributions ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20); -- 'stripe', 'paystack', null for manual
ALTER TABLE subscription_contributions ADD COLUMN IF NOT EXISTS provider_transaction_id VARCHAR(255);

ALTER TABLE general_contributions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'manual'; -- 'auto-debit', 'manual'
ALTER TABLE general_contributions ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20); -- 'stripe', 'paystack', null for manual
ALTER TABLE general_contributions ADD COLUMN IF NOT EXISTS provider_transaction_id VARCHAR(255);

-- 6. Create automatic_payment_attempts table to track automatic payment attempts
CREATE TABLE IF NOT EXISTS automatic_payment_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  contribution_type VARCHAR(20) NOT NULL, -- 'birthday', 'subscription', 'general'
  contribution_id UUID, -- ID of the contribution record (birthday_contributions, subscription_contributions, or general_contributions)
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'success', 'failed', 'retry'
  payment_provider VARCHAR(20),
  provider_transaction_id VARCHAR(255),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_automatic_payment_attempts_user_id ON automatic_payment_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_automatic_payment_attempts_group_id ON automatic_payment_attempts(group_id);
CREATE INDEX IF NOT EXISTS idx_automatic_payment_attempts_status ON automatic_payment_attempts(status);
CREATE INDEX IF NOT EXISTS idx_automatic_payment_attempts_contribution_id ON automatic_payment_attempts(contribution_id);

-- 7. Create payment_audit_log table for security and compliance
CREATE TABLE IF NOT EXISTS payment_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL, -- 'add_payment_method', 'remove_payment_method', 'enable_auto_pay', 'disable_auto_pay', 'charge_card', 'withdraw', etc.
  amount DECIMAL(10, 2),
  currency VARCHAR(3),
  status VARCHAR(20), -- 'success', 'failed', 'pending'
  payment_provider VARCHAR(20),
  provider_transaction_id VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  error_message TEXT,
  metadata JSONB, -- Additional data (payment method ID, group ID, etc.)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_log_user_id ON payment_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_action ON payment_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_created_at ON payment_audit_log(created_at);

-- 8. Create password_verification_tokens table for 2FA flow
CREATE TABLE IF NOT EXISTS password_verification_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  action VARCHAR(50) NOT NULL, -- 'add_payment_method', 'enable_auto_pay', 'withdraw', etc.
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_verification_tokens_user_id ON password_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_verification_tokens_token ON password_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_verification_tokens_expires_at ON password_verification_tokens(expires_at);

-- 9. Update otps table to support 'payment-action' type
-- This is already handled by existing otps table structure, just ensuring it supports the new type
-- The 'type' column already exists and can accept 'payment-action' or 'critical-action'

-- 10. Add withdrawal tracking (if not exists)
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  bank_account_number VARCHAR(50),
  bank_name VARCHAR(100),
  account_name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  payment_provider VARCHAR(20), -- 'stripe', 'paystack'
  provider_transaction_id VARCHAR(255),
  fee DECIMAL(10, 2) DEFAULT 0,
  net_amount DECIMAL(10, 2), -- Amount after fees
  scheduled_at TIMESTAMP, -- When withdrawal should be processed (24-hour hold)
  processed_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_scheduled_at ON withdrawals(scheduled_at);
