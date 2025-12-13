-- Migration: Add currency column to groups table
-- Add currency column with default 'NGN' (Nigerian Naira)
ALTER TABLE groups ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'NGN';

-- Update existing groups to NGN (if they don't have a currency set)
UPDATE groups SET currency = 'NGN' WHERE currency IS NULL;

-- Add comment
COMMENT ON COLUMN groups.currency IS 'Currency code (ISO 4217): NGN, USD, GBP, EUR, etc.';
