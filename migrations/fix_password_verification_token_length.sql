-- Migration: Fix password_verification_tokens.token column length
-- JWT tokens can be longer than 255 characters, so we need to change from VARCHAR(255) to TEXT

-- Change token column from VARCHAR(255) to TEXT
ALTER TABLE password_verification_tokens 
  ALTER COLUMN token TYPE TEXT;

-- Note: The UNIQUE constraint will still work with TEXT type
-- The index on token will also still work

COMMENT ON COLUMN password_verification_tokens.token IS 'JWT token for password verification (can be longer than 255 characters)';
