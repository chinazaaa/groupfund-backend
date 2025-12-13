-- Add expo_push_token field to users table for push notifications
ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_expo_push_token ON users(expo_push_token) WHERE expo_push_token IS NOT NULL;

