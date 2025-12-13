-- Migration: Update birthday_contributions status to support new payment flow
-- Status values: 'not_paid', 'paid' (awaiting confirmation), 'confirmed', 'not_received'

-- Update existing 'pending' status to 'not_paid'
UPDATE birthday_contributions SET status = 'not_paid' WHERE status = 'pending';

-- Update existing 'paid' status to 'paid' (it's already correct, but we'll keep it)
-- No change needed for 'paid' status

-- Update existing 'failed' status to 'not_paid' (treat failed as not paid)
UPDATE birthday_contributions SET status = 'not_paid' WHERE status = 'failed';

-- Add comment to document the new status values
COMMENT ON COLUMN birthday_contributions.status IS 'Payment status: not_paid (not paid yet), paid (awaiting confirmation), confirmed (payment confirmed), not_received (paid but not received)';
