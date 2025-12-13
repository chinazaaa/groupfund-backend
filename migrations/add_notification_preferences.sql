-- Add notification preferences columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS notify_7_days_before BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS notify_1_day_before BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS notify_same_day BOOLEAN DEFAULT TRUE;
