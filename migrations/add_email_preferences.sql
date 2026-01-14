-- Migration: Add email preferences to users table
-- Allows users to control which emails they receive
-- Important emails default to TRUE, optional emails default to FALSE

-- Payment & Transaction Emails (IMPORTANT - ON by default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_payment_success BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_autopay_success BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_autopay_disabled BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_payment_failure BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_withdrawal_request BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_withdrawal_completed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_withdrawal_failed BOOLEAN DEFAULT TRUE;

-- Group Updates (IMPORTANT - ON by default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_deadline_update BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_contribution_amount_update BOOLEAN DEFAULT TRUE;

-- Birthday Emails (OPTIONAL - OFF by default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_birthday_reminder BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_comprehensive_birthday_reminder BOOLEAN DEFAULT FALSE;

-- Reminder Emails (OPTIONAL - OFF by default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_comprehensive_reminder BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_overdue_contribution BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_admin_overdue_notification BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_admin_upcoming_deadline BOOLEAN DEFAULT FALSE;

-- Group Updates (Less Critical - OFF by default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_max_members_update BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_member_left_subscription BOOLEAN DEFAULT FALSE;

-- Newsletter (OPTIONAL - OFF by default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_pref_monthly_newsletter BOOLEAN DEFAULT FALSE;

-- Add comments for documentation
COMMENT ON COLUMN users.email_pref_payment_success IS 'Email when receiving payments (default: true)';
COMMENT ON COLUMN users.email_pref_autopay_success IS 'Email when autopay succeeds (default: true)';
COMMENT ON COLUMN users.email_pref_autopay_disabled IS 'Email when autopay is disabled (default: true)';
COMMENT ON COLUMN users.email_pref_payment_failure IS 'Email when payment fails (default: true)';
COMMENT ON COLUMN users.email_pref_withdrawal_request IS 'Email when withdrawal is requested (default: true)';
COMMENT ON COLUMN users.email_pref_withdrawal_completed IS 'Email when withdrawal is completed (default: true)';
COMMENT ON COLUMN users.email_pref_withdrawal_failed IS 'Email when withdrawal fails (default: true)';
COMMENT ON COLUMN users.email_pref_deadline_update IS 'Email when group deadline is updated (default: true)';
COMMENT ON COLUMN users.email_pref_contribution_amount_update IS 'Email when contribution amount is updated (default: true)';
COMMENT ON COLUMN users.email_pref_birthday_reminder IS 'Birthday reminder emails (default: false)';
COMMENT ON COLUMN users.email_pref_comprehensive_birthday_reminder IS 'Comprehensive birthday reminder emails (default: false)';
COMMENT ON COLUMN users.email_pref_comprehensive_reminder IS 'Comprehensive reminder emails (default: false)';
COMMENT ON COLUMN users.email_pref_overdue_contribution IS 'Overdue contribution reminder emails (default: false)';
COMMENT ON COLUMN users.email_pref_admin_overdue_notification IS 'Admin overdue notification emails (default: false)';
COMMENT ON COLUMN users.email_pref_admin_upcoming_deadline IS 'Admin upcoming deadline emails (default: false)';
COMMENT ON COLUMN users.email_pref_max_members_update IS 'Email when max members is updated (default: false)';
COMMENT ON COLUMN users.email_pref_member_left_subscription IS 'Email when member leaves subscription group (default: false)';
COMMENT ON COLUMN users.email_pref_monthly_newsletter IS 'Monthly newsletter emails (default: false)';

-- Update existing users to have default values
UPDATE users SET 
  email_pref_payment_success = COALESCE(email_pref_payment_success, TRUE),
  email_pref_autopay_success = COALESCE(email_pref_autopay_success, TRUE),
  email_pref_autopay_disabled = COALESCE(email_pref_autopay_disabled, TRUE),
  email_pref_payment_failure = COALESCE(email_pref_payment_failure, TRUE),
  email_pref_withdrawal_request = COALESCE(email_pref_withdrawal_request, TRUE),
  email_pref_withdrawal_completed = COALESCE(email_pref_withdrawal_completed, TRUE),
  email_pref_withdrawal_failed = COALESCE(email_pref_withdrawal_failed, TRUE),
  email_pref_deadline_update = COALESCE(email_pref_deadline_update, TRUE),
  email_pref_contribution_amount_update = COALESCE(email_pref_contribution_amount_update, TRUE),
  email_pref_birthday_reminder = COALESCE(email_pref_birthday_reminder, FALSE),
  email_pref_comprehensive_birthday_reminder = COALESCE(email_pref_comprehensive_birthday_reminder, FALSE),
  email_pref_comprehensive_reminder = COALESCE(email_pref_comprehensive_reminder, FALSE),
  email_pref_overdue_contribution = COALESCE(email_pref_overdue_contribution, FALSE),
  email_pref_admin_overdue_notification = COALESCE(email_pref_admin_overdue_notification, FALSE),
  email_pref_admin_upcoming_deadline = COALESCE(email_pref_admin_upcoming_deadline, FALSE),
  email_pref_max_members_update = COALESCE(email_pref_max_members_update, FALSE),
  email_pref_member_left_subscription = COALESCE(email_pref_member_left_subscription, FALSE),
  email_pref_monthly_newsletter = COALESCE(email_pref_monthly_newsletter, FALSE)
WHERE 
  email_pref_payment_success IS NULL OR
  email_pref_autopay_success IS NULL OR
  email_pref_autopay_disabled IS NULL OR
  email_pref_payment_failure IS NULL OR
  email_pref_withdrawal_request IS NULL OR
  email_pref_withdrawal_completed IS NULL OR
  email_pref_withdrawal_failed IS NULL OR
  email_pref_deadline_update IS NULL OR
  email_pref_contribution_amount_update IS NULL OR
  email_pref_birthday_reminder IS NULL OR
  email_pref_comprehensive_birthday_reminder IS NULL OR
  email_pref_comprehensive_reminder IS NULL OR
  email_pref_overdue_contribution IS NULL OR
  email_pref_admin_overdue_notification IS NULL OR
  email_pref_admin_upcoming_deadline IS NULL OR
  email_pref_max_members_update IS NULL OR
  email_pref_member_left_subscription IS NULL OR
  email_pref_monthly_newsletter IS NULL;
