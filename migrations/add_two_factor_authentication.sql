-- Migration: Add two-factor authentication (2FA) to users table
-- Supports both authenticator apps (TOTP) and email-based 2FA
-- Authenticator is the default method

-- Add 2FA columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_method VARCHAR(20) DEFAULT 'authenticator'; -- 'authenticator' or 'email'
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT; -- Encrypted TOTP secret (for authenticator method)
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_backup_codes JSONB; -- Array of backup codes for recovery

-- Add comments
COMMENT ON COLUMN users.two_factor_enabled IS 'Whether 2FA is enabled for this user (default: false)';
COMMENT ON COLUMN users.two_factor_method IS '2FA method: authenticator (TOTP) or email (default: authenticator)';
COMMENT ON COLUMN users.two_factor_secret IS 'Encrypted TOTP secret for authenticator app (null if using email method)';
COMMENT ON COLUMN users.two_factor_backup_codes IS 'JSON array of backup codes for account recovery';

-- Create index for 2FA queries (optional but useful)
CREATE INDEX IF NOT EXISTS idx_users_two_factor_enabled ON users(two_factor_enabled) WHERE two_factor_enabled = TRUE;
