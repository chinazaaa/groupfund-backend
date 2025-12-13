-- Migration: Add international payment fields to wallets table
-- Add optional fields for international payments (IBAN, SWIFT/BIC, routing number, etc.)

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS iban VARCHAR(34);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS swift_bic VARCHAR(11);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS routing_number VARCHAR(20);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS sort_code VARCHAR(10);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS branch_code VARCHAR(20);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS branch_address TEXT;

-- Add comments
COMMENT ON COLUMN wallets.iban IS 'International Bank Account Number (IBAN) - for international transfers';
COMMENT ON COLUMN wallets.swift_bic IS 'SWIFT/BIC code - for international transfers';
COMMENT ON COLUMN wallets.routing_number IS 'Routing number (US) or transit number (Canada)';
COMMENT ON COLUMN wallets.sort_code IS 'Sort code (UK)';
COMMENT ON COLUMN wallets.branch_code IS 'Branch code - for some countries';
COMMENT ON COLUMN wallets.branch_address IS 'Branch address - optional additional information';
