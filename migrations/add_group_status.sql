-- Migration: Add status column to groups table
-- Status values: 'active' (default), 'closed'
ALTER TABLE groups ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Update existing groups to active status (if they don't have a status set)
UPDATE groups SET status = 'active' WHERE status IS NULL;

-- Add comment to document the status values
-- Note: 'closed' status freezes ALL group activity (no new members, no contributions, no confirmations)
-- This is different from accepting_requests=false which only pauses new member requests
COMMENT ON COLUMN groups.status IS 'Group status: active (fully operational), closed (frozen - no new members, contributions, or confirmations allowed)';

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_groups_status ON groups(status);

