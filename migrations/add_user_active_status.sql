-- Add is_active field to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Create index for active status queries
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- Set all existing users as active
UPDATE users SET is_active = TRUE WHERE is_active IS NULL;

