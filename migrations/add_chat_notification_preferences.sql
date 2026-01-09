-- Migration: Add chat notification preferences to users table
-- Allows users to control when they receive chat notifications

-- Add chat notification preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_chat_mentions BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_chat_all_messages BOOLEAN DEFAULT false;

-- Add comments
COMMENT ON COLUMN users.notify_chat_mentions IS 'Receive notifications when mentioned in chat (default: true)';
COMMENT ON COLUMN users.notify_chat_all_messages IS 'Receive notifications for all chat messages, not just mentions (default: false)';

-- Update existing users to have default values
UPDATE users SET 
  notify_chat_mentions = COALESCE(notify_chat_mentions, true),
  notify_chat_all_messages = COALESCE(notify_chat_all_messages, false)
WHERE notify_chat_mentions IS NULL OR notify_chat_all_messages IS NULL;

