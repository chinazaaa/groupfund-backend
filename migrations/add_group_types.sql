-- Migration: Add group types and related fields
-- Group types: 'birthday', 'subscription', 'general'

-- Add group_type column
ALTER TABLE groups ADD COLUMN IF NOT EXISTS group_type VARCHAR(20) DEFAULT 'birthday';

-- Update existing groups to birthday type (if they don't have a type set)
UPDATE groups SET group_type = 'birthday' WHERE group_type IS NULL;

-- Add subscription-specific fields
ALTER TABLE groups ADD COLUMN IF NOT EXISTS subscription_frequency VARCHAR(20); -- 'monthly' or 'annual'
ALTER TABLE groups ADD COLUMN IF NOT EXISTS subscription_platform VARCHAR(255); -- e.g., 'Netflix'
ALTER TABLE groups ADD COLUMN IF NOT EXISTS subscription_deadline_day INTEGER; -- Day of month (1-31)
ALTER TABLE groups ADD COLUMN IF NOT EXISTS subscription_deadline_month INTEGER; -- Month (1-12) for annual subscriptions

-- Add general group deadline field
ALTER TABLE groups ADD COLUMN IF NOT EXISTS deadline DATE; -- For general groups

-- Add comments
COMMENT ON COLUMN groups.group_type IS 'Group type: birthday (birthday groups), subscription (subscription groups), general (general purpose groups)';
COMMENT ON COLUMN groups.subscription_frequency IS 'Subscription frequency: monthly or annual (only for subscription groups)';
COMMENT ON COLUMN groups.subscription_platform IS 'Subscription platform name (e.g., Netflix, Spotify) - only for subscription groups';
COMMENT ON COLUMN groups.subscription_deadline_day IS 'Day of month for subscription deadline (1-31) - only for subscription groups';
COMMENT ON COLUMN groups.subscription_deadline_month IS 'Month for annual subscription deadline (1-12) - only for annual subscription groups';
COMMENT ON COLUMN groups.deadline IS 'Deadline date for general groups';

-- Create index for group_type queries
CREATE INDEX IF NOT EXISTS idx_groups_group_type ON groups(group_type);

