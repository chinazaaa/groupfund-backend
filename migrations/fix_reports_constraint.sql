-- Migration: Fix reports table constraint to allow both group_id and user_id
-- When reporting a member, we need both group_id (context) and user_id (member being reported)

-- Drop the old constraint
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_check;

-- Add new constraint that allows both group_id and user_id to be set
-- (for member reports, both are needed - group provides context)
-- But at least one must be set
ALTER TABLE reports ADD CONSTRAINT reports_check 
  CHECK (
    (reported_group_id IS NOT NULL) OR (reported_user_id IS NOT NULL)
  );

