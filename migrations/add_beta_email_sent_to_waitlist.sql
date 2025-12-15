-- Add beta_email_sent field to waitlist table
ALTER TABLE waitlist 
ADD COLUMN IF NOT EXISTS beta_email_sent BOOLEAN DEFAULT FALSE;

-- Create index for better performance when querying unsent emails
CREATE INDEX IF NOT EXISTS idx_waitlist_beta_email_sent ON waitlist(beta_email_sent) WHERE beta_email_sent = FALSE;

