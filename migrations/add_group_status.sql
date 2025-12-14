-- Migration: Add status column to groups table
-- Status values: 'active' (default), 'closed'
ALTER TABLE groups ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Update existing groups to active status (if they don't have a status set)
UPDATE groups SET status = 'active' WHERE status IS NULL;

-- Add comment to document the status values
COMMENT ON COLUMN groups.status IS 'Group status: active (open for members), closed (no longer accepting members)';

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_groups_status ON groups(status);

