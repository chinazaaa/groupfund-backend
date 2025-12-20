-- Migration: Add notes column to groups table
-- This field allows admins to add additional information, contact details, instructions, etc.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add comment to document the field
COMMENT ON COLUMN groups.notes IS 'Optional notes/description for the group. Can include contact information, instructions, or any additional details the admin wants to share.';

