-- Migration: Add is_public column to groups table
-- This field controls whether subscription groups are discoverable via search
-- Only applies to subscription groups, all groups default to private (false)

ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;

-- Update existing groups to is_public = false (private by default)
UPDATE groups SET is_public = FALSE WHERE is_public IS NULL;

-- Add comment to document the field
COMMENT ON COLUMN groups.is_public IS 'Whether the group is discoverable via search. Only subscription groups can be public. Default is false (private).';

-- Create index for efficient search queries
CREATE INDEX IF NOT EXISTS idx_groups_is_public ON groups(is_public) WHERE is_public = TRUE AND group_type = 'subscription';

