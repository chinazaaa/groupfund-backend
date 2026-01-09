-- Migration: Create group_messages table for group chat functionality
-- Stores messages sent within groups

CREATE TABLE IF NOT EXISTS group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE NULL, -- Soft delete support
  
  -- Ensure message is not empty
  CONSTRAINT message_not_empty CHECK (LENGTH(TRIM(message)) > 0)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_user_id ON group_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_created_at ON group_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_group_created ON group_messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_not_deleted ON group_messages(group_id, created_at DESC) WHERE deleted_at IS NULL;

-- Add comments
COMMENT ON TABLE group_messages IS 'Messages sent within groups. Only visible if group has chat_enabled = true.';
COMMENT ON COLUMN group_messages.group_id IS 'The group this message belongs to';
COMMENT ON COLUMN group_messages.user_id IS 'The user who sent this message';
COMMENT ON COLUMN group_messages.message IS 'The message content';
COMMENT ON COLUMN group_messages.deleted_at IS 'Soft delete timestamp. NULL means message is active.';

