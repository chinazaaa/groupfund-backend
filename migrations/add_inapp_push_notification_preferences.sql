-- Migration: Add in-app and push notification preferences to users table
-- Allows users to control which notifications they receive
-- All notifications default to TRUE (ON), users can toggle them off
-- Note: Security notifications (if any) should always be sent

-- In-App Notification Preferences (default: TRUE)
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_group_invite BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_group_approved BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_group_rejected BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_group_removed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_contribution_paid BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_contribution_confirmed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_contribution_not_received BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_subscription_contribution_paid BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_general_contribution_paid BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_contribution_amount_updated BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_deadline_updated BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_max_members_updated BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_birthday_reminder BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_birthday_wish BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_autopay_success BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_payment_skipped BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_admin_overdue_notification BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_overdue_contribution BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_wishlist_claim BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_wishlist_unclaim BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_wishlist_fulfilled BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_chat_mention BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_chat_message BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_withdrawal_requested BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_withdrawal_completed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_withdrawal_failed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_member_left_subscription BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_member_removed_subscription BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inapp_pref_role_changed BOOLEAN DEFAULT TRUE;

-- Push Notification Preferences (default: TRUE)
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_group_invite BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_group_approved BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_group_rejected BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_group_removed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_contribution_paid BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_contribution_confirmed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_contribution_not_received BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_subscription_contribution_paid BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_general_contribution_paid BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_contribution_amount_updated BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_deadline_updated BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_max_members_updated BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_birthday_reminder BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_birthday_wish BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_autopay_success BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_payment_skipped BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_admin_overdue_notification BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_overdue_contribution BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_wishlist_claim BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_wishlist_unclaim BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_wishlist_fulfilled BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_chat_mention BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_chat_message BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_withdrawal_requested BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_withdrawal_completed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_withdrawal_failed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_member_left_subscription BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_member_removed_subscription BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_pref_role_changed BOOLEAN DEFAULT TRUE;

-- Update existing users to have default values (all TRUE)
UPDATE users SET 
  inapp_pref_group_invite = COALESCE(inapp_pref_group_invite, TRUE),
  inapp_pref_group_approved = COALESCE(inapp_pref_group_approved, TRUE),
  inapp_pref_group_rejected = COALESCE(inapp_pref_group_rejected, TRUE),
  inapp_pref_group_removed = COALESCE(inapp_pref_group_removed, TRUE),
  inapp_pref_contribution_paid = COALESCE(inapp_pref_contribution_paid, TRUE),
  inapp_pref_contribution_confirmed = COALESCE(inapp_pref_contribution_confirmed, TRUE),
  inapp_pref_contribution_not_received = COALESCE(inapp_pref_contribution_not_received, TRUE),
  inapp_pref_subscription_contribution_paid = COALESCE(inapp_pref_subscription_contribution_paid, TRUE),
  inapp_pref_general_contribution_paid = COALESCE(inapp_pref_general_contribution_paid, TRUE),
  inapp_pref_contribution_amount_updated = COALESCE(inapp_pref_contribution_amount_updated, TRUE),
  inapp_pref_deadline_updated = COALESCE(inapp_pref_deadline_updated, TRUE),
  inapp_pref_max_members_updated = COALESCE(inapp_pref_max_members_updated, TRUE),
  inapp_pref_birthday_reminder = COALESCE(inapp_pref_birthday_reminder, TRUE),
  inapp_pref_birthday_wish = COALESCE(inapp_pref_birthday_wish, TRUE),
  inapp_pref_autopay_success = COALESCE(inapp_pref_autopay_success, TRUE),
  inapp_pref_payment_skipped = COALESCE(inapp_pref_payment_skipped, TRUE),
  inapp_pref_admin_overdue_notification = COALESCE(inapp_pref_admin_overdue_notification, TRUE),
  inapp_pref_overdue_contribution = COALESCE(inapp_pref_overdue_contribution, TRUE),
  inapp_pref_wishlist_claim = COALESCE(inapp_pref_wishlist_claim, TRUE),
  inapp_pref_wishlist_unclaim = COALESCE(inapp_pref_wishlist_unclaim, TRUE),
  inapp_pref_wishlist_fulfilled = COALESCE(inapp_pref_wishlist_fulfilled, TRUE),
  inapp_pref_chat_mention = COALESCE(inapp_pref_chat_mention, TRUE),
  inapp_pref_chat_message = COALESCE(inapp_pref_chat_message, FALSE),
  inapp_pref_withdrawal_requested = COALESCE(inapp_pref_withdrawal_requested, TRUE),
  inapp_pref_withdrawal_completed = COALESCE(inapp_pref_withdrawal_completed, TRUE),
  inapp_pref_withdrawal_failed = COALESCE(inapp_pref_withdrawal_failed, TRUE),
  inapp_pref_member_left_subscription = COALESCE(inapp_pref_member_left_subscription, TRUE),
  inapp_pref_member_removed_subscription = COALESCE(inapp_pref_member_removed_subscription, TRUE),
  inapp_pref_role_changed = COALESCE(inapp_pref_role_changed, TRUE),
  push_pref_group_invite = COALESCE(push_pref_group_invite, TRUE),
  push_pref_group_approved = COALESCE(push_pref_group_approved, TRUE),
  push_pref_group_rejected = COALESCE(push_pref_group_rejected, TRUE),
  push_pref_group_removed = COALESCE(push_pref_group_removed, TRUE),
  push_pref_contribution_paid = COALESCE(push_pref_contribution_paid, TRUE),
  push_pref_contribution_confirmed = COALESCE(push_pref_contribution_confirmed, TRUE),
  push_pref_contribution_not_received = COALESCE(push_pref_contribution_not_received, TRUE),
  push_pref_subscription_contribution_paid = COALESCE(push_pref_subscription_contribution_paid, TRUE),
  push_pref_general_contribution_paid = COALESCE(push_pref_general_contribution_paid, TRUE),
  push_pref_contribution_amount_updated = COALESCE(push_pref_contribution_amount_updated, TRUE),
  push_pref_deadline_updated = COALESCE(push_pref_deadline_updated, TRUE),
  push_pref_max_members_updated = COALESCE(push_pref_max_members_updated, TRUE),
  push_pref_birthday_reminder = COALESCE(push_pref_birthday_reminder, TRUE),
  push_pref_birthday_wish = COALESCE(push_pref_birthday_wish, TRUE),
  push_pref_autopay_success = COALESCE(push_pref_autopay_success, TRUE),
  push_pref_payment_skipped = COALESCE(push_pref_payment_skipped, TRUE),
  push_pref_admin_overdue_notification = COALESCE(push_pref_admin_overdue_notification, TRUE),
  push_pref_overdue_contribution = COALESCE(push_pref_overdue_contribution, TRUE),
  push_pref_wishlist_claim = COALESCE(push_pref_wishlist_claim, TRUE),
  push_pref_wishlist_unclaim = COALESCE(push_pref_wishlist_unclaim, TRUE),
  push_pref_wishlist_fulfilled = COALESCE(push_pref_wishlist_fulfilled, TRUE),
  push_pref_chat_mention = COALESCE(push_pref_chat_mention, TRUE),
  push_pref_chat_message = COALESCE(push_pref_chat_message, FALSE),
  push_pref_withdrawal_requested = COALESCE(push_pref_withdrawal_requested, TRUE),
  push_pref_withdrawal_completed = COALESCE(push_pref_withdrawal_completed, TRUE),
  push_pref_withdrawal_failed = COALESCE(push_pref_withdrawal_failed, TRUE),
  push_pref_member_left_subscription = COALESCE(push_pref_member_left_subscription, TRUE),
  push_pref_member_removed_subscription = COALESCE(push_pref_member_removed_subscription, TRUE),
  push_pref_role_changed = COALESCE(push_pref_role_changed, TRUE)
WHERE 
  inapp_pref_group_invite IS NULL OR
  push_pref_group_invite IS NULL OR
  inapp_pref_group_approved IS NULL OR
  push_pref_group_approved IS NULL;

-- Force chat_message preferences to FALSE for all existing users (changed default behavior)
-- This is intentionally separate from the COALESCE update above to ensure all users get the new default
UPDATE users SET
  inapp_pref_chat_message = FALSE,
  push_pref_chat_message = FALSE;
