-- Migration: Add general contributions table
-- This table tracks contributions for general groups (weddings, baby showers, etc.)

CREATE TABLE IF NOT EXISTS general_contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  contributor_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  contribution_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'not_paid', -- 'not_paid', 'paid', 'confirmed', 'not_received'
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, contributor_id) -- One contribution per member per general group
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_general_contributions_group_id ON general_contributions(group_id);
CREATE INDEX IF NOT EXISTS idx_general_contributions_contributor_id ON general_contributions(contributor_id);
CREATE INDEX IF NOT EXISTS idx_general_contributions_status ON general_contributions(status);

