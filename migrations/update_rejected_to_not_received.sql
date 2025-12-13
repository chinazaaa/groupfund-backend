-- Migration: Update rejected status to not_received
-- This aligns with the workflow where "not_received" means payment was made but not received

-- Update existing 'rejected' status to 'not_received'
UPDATE birthday_contributions SET status = 'not_received' WHERE status = 'rejected';

-- Update comment to document the status values
COMMENT ON COLUMN birthday_contributions.status IS 'Payment status: not_paid (not paid yet), paid (awaiting confirmation), confirmed (payment confirmed), not_received (paid but not received)';
