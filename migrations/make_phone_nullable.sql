-- Make phone column nullable in users table (phone is no longer required)
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- Make phone column nullable in otps table (OTP can be sent via email only)
ALTER TABLE otps ALTER COLUMN phone DROP NOT NULL;

