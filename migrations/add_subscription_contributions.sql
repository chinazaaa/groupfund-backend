-- Migration: Add subscription contributions table
-- This table tracks contributions for subscription groups

CREATE TABLE IF NOT EXISTS subscription_contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  contributor_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  contribution_date DATE NOT NULL,
  subscription_period_start DATE NOT NULL, -- Start of the subscription period
  subscription_period_end DATE NOT NULL, -- End of the subscription period
  status VARCHAR(20) DEFAULT 'not_paid', -- 'not_paid', 'paid', 'confirmed', 'not_received'
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, contributor_id, subscription_period_start) -- One contribution per member per period
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_subscription_contributions_group_id ON subscription_contributions(group_id);
CREATE INDEX IF NOT EXISTS idx_subscription_contributions_contributor_id ON subscription_contributions(contributor_id);
CREATE INDEX IF NOT EXISTS idx_subscription_contributions_subscription_period_start ON subscription_contributions(subscription_period_start);
CREATE INDEX IF NOT EXISTS idx_subscription_contributions_status ON subscription_contributions(status);

