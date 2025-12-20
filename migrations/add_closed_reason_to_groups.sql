-- Migration: Add closed_reason to groups table
-- This field tracks why a group was closed to prevent reopening in certain cases

ALTER TABLE groups ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(50);
COMMENT ON COLUMN groups.closed_reason IS 'Reason for group closure: NULL (user closed), "reports" (closed due to 3+ pending reports), "admin" (closed by system admin)';

CREATE INDEX IF NOT EXISTS idx_groups_closed_reason ON groups(closed_reason);

