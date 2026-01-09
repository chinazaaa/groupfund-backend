-- Migration: Add chat_enabled column to groups table
-- Allows group creators to enable/disable chat for their groups

-- Add chat_enabled column (defaults to false for existing groups, true for new groups)
ALTER TABLE groups ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN DEFAULT false;

-- Update existing groups to have chat disabled by default (optional - can be changed)
-- Uncomment if you want existing groups to have chat disabled:
-- UPDATE groups SET chat_enabled = false WHERE chat_enabled IS NULL;

-- Add comment
COMMENT ON COLUMN groups.chat_enabled IS 'Whether chat/messaging is enabled for this group. Can be toggled by group creator.';

-- Create index for chat_enabled queries (optional, but useful if filtering by chat enabled)
CREATE INDEX IF NOT EXISTS idx_groups_chat_enabled ON groups(chat_enabled) WHERE chat_enabled = true;

