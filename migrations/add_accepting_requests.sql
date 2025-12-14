-- Migration: Add accepting_requests column to groups table
-- This field controls whether the group accepts new join requests
ALTER TABLE groups ADD COLUMN IF NOT EXISTS accepting_requests BOOLEAN DEFAULT TRUE;

-- Update existing groups to accepting_requests = true (if they don't have it set)
UPDATE groups SET accepting_requests = TRUE WHERE accepting_requests IS NULL;

-- Add comment to document the field
COMMENT ON COLUMN groups.accepting_requests IS 'Whether the group is currently accepting new join requests. If false, users cannot send join requests.';

