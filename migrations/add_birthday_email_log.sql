-- Create birthday_email_log table to track birthday emails sent
CREATE TABLE IF NOT EXISTS birthday_email_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  sent_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, sent_at)
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_birthday_email_log_user_id ON birthday_email_log(user_id);
CREATE INDEX IF NOT EXISTS idx_birthday_email_log_sent_at ON birthday_email_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_birthday_email_log_user_sent ON birthday_email_log(user_id, sent_at);
