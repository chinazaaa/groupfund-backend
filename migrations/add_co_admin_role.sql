-- Migration: Add co-admin role support to group_members
-- Co-admins have most admin permissions but with some restrictions

-- Update role column to support 'co-admin' (if it's a CHECK constraint, we may need to drop and recreate)
-- First, check if we need to alter the column type
DO $$
BEGIN
  -- Check if role column exists and update constraint if needed
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'group_members' AND column_name = 'role'
  ) THEN
    -- Remove any existing check constraint on role
    ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_role_check;
    
    -- Add new check constraint allowing 'admin', 'co-admin', and 'member'
    ALTER TABLE group_members ADD CONSTRAINT group_members_role_check 
      CHECK (role IN ('admin', 'co-admin', 'member'));
  END IF;
END $$;

-- Update comment
COMMENT ON COLUMN group_members.role IS 'Member role: admin (group creator, full permissions), co-admin (limited admin permissions), or member (regular member)';

