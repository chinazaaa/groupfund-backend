# Notification Preferences - Default Values

This document lists all notification preferences and their default values (ON/OFF).

---

## 📧 Email Preferences

**Default: ON** = Users receive these emails by default (can be turned off)  
**Default: OFF** = Users do NOT receive these emails by default (can be turned on)  
**Always ON** = Cannot be disabled (security-related)

### Payment & Transaction Emails (Default: ON ✅)

| Preference | Default | Description |
|------------|---------|-------------|
| `payment_success` | ✅ ON | Email when receiving payments |
| `autopay_success` | ✅ ON | Email when autopay succeeds |
| `autopay_disabled` | ✅ ON | Email when autopay is disabled |
| `payment_failure` | ✅ ON | Email when payment fails |
| `withdrawal_request` | ✅ ON | Email when withdrawal is requested |
| `withdrawal_completed` | ✅ ON | Email when withdrawal is completed |
| `withdrawal_failed` | ✅ ON | Email when withdrawal fails |

### Group Updates - Important (Default: ON ✅)

| Preference | Default | Description |
|------------|---------|-------------|
| `deadline_update` | ✅ ON | Email when group deadline is updated |
| `contribution_amount_update` | ✅ ON | Email when contribution amount is updated |

### Birthday Reminders (Default: OFF ❌)

| Preference | Default | Description |
|------------|---------|-------------|
| `birthday_reminder` | ❌ OFF | Birthday reminder emails |
| `comprehensive_birthday_reminder` | ❌ OFF | Comprehensive birthday reminder emails (all groups) |

### General Reminders (Default: OFF ❌)

| Preference | Default | Description |
|------------|---------|-------------|
| `comprehensive_reminder` | ❌ OFF | Comprehensive reminder emails (all group types) |
| `overdue_contribution` | ❌ OFF | Overdue contribution reminder emails |
| `admin_overdue_notification` | ❌ OFF | Admin overdue notification emails |
| `admin_upcoming_deadline` | ❌ OFF | Admin upcoming deadline emails |

### Group Updates - Less Critical (Default: OFF ❌)

| Preference | Default | Description |
|------------|---------|-------------|
| `max_members_update` | ❌ OFF | Email when max members is updated |
| `member_left_subscription` | ❌ OFF | Email when member leaves subscription group |

### Newsletter (Default: OFF ❌)

| Preference | Default | Description |
|------------|---------|-------------|
| `monthly_newsletter` | ❌ OFF | Monthly newsletter emails |

### Always Sent (No Preference)

These emails are always sent and cannot be disabled:
- ✅ OTP emails (security)
- ✅ Welcome email (sent once at signup)
- ✅ Birthday wish email (to celebrant)
- ✅ Holiday emails (Christmas, New Year)
- ✅ Security alerts (auto-pay changes, bank account changes, wallet updates)
- ✅ Contact confirmation
- ✅ Waitlist confirmation
- ✅ Beta invitations (admin)

---

## 📱 In-App Notification Preferences

**All default to: ON ✅** (Users can turn them off)

| Notification Type | Default | Description |
|-------------------|---------|-------------|
| `group_invite` | ✅ ON | New join request / group invite |
| `group_approved` | ✅ ON | Join request approved |
| `group_rejected` | ✅ ON | Join request rejected |
| `group_removed` | ✅ ON | Removed from group |
| `contribution_paid` | ✅ ON | Contribution marked as paid |
| `contribution_confirmed` | ✅ ON | Contribution confirmed by admin |
| `contribution_not_received` | ✅ ON | Contribution rejected by admin |
| `subscription_contribution_paid` | ✅ ON | Subscription contribution paid |
| `general_contribution_paid` | ✅ ON | General contribution paid |
| `contribution_amount_updated` | ✅ ON | Contribution amount updated |
| `deadline_updated` | ✅ ON | Deadline updated |
| `max_members_updated` | ✅ ON | Max members updated |
| `birthday_reminder` | ✅ ON | Birthday reminder |
| `birthday_wish` | ✅ ON | Birthday wish |
| `autopay_success` | ✅ ON | Auto-pay successful |
| `payment_skipped` | ✅ ON | Payment skipped notification |
| `admin_overdue_notification` | ✅ ON | Admin overdue notification |
| `overdue_contribution` | ✅ ON | Overdue contribution reminder |
| `wishlist_claim` | ✅ ON | Wishlist item claimed |
| `wishlist_unclaim` | ✅ ON | Wishlist item unclaimed |
| `wishlist_fulfilled` | ✅ ON | Wishlist item fulfilled |
| `chat_mention` | ✅ ON | Mentioned in chat |
| `chat_message` | ✅ ON | New chat message |
| `withdrawal_requested` | ✅ ON | Withdrawal requested |
| `withdrawal_completed` | ✅ ON | Withdrawal completed |
| `withdrawal_failed` | ✅ ON | Withdrawal failed |
| `member_left_subscription` | ✅ ON | Member left subscription group |
| `member_removed_subscription` | ✅ ON | Member removed from subscription group |
| `role_changed` | ✅ ON | Role changed (promoted/demoted) |

**Security Notifications**: Currently none, but if added in the future, they will always be sent (cannot be disabled).

---

## 🔔 Push Notification Preferences

**All default to: ON ✅** (Users can turn them off)

| Notification Type | Default | Description |
|-------------------|---------|-------------|
| `group_invite` | ✅ ON | New join request / group invite |
| `group_approved` | ✅ ON | Join request approved |
| `group_rejected` | ✅ ON | Join request rejected |
| `group_removed` | ✅ ON | Removed from group |
| `contribution_paid` | ✅ ON | Contribution marked as paid |
| `contribution_confirmed` | ✅ ON | Contribution confirmed by admin |
| `contribution_not_received` | ✅ ON | Contribution rejected by admin |
| `subscription_contribution_paid` | ✅ ON | Subscription contribution paid |
| `general_contribution_paid` | ✅ ON | General contribution paid |
| `contribution_amount_updated` | ✅ ON | Contribution amount updated |
| `deadline_updated` | ✅ ON | Deadline updated |
| `max_members_updated` | ✅ ON | Max members updated |
| `birthday_reminder` | ✅ ON | Birthday reminder |
| `birthday_wish` | ✅ ON | Birthday wish |
| `autopay_success` | ✅ ON | Auto-pay successful |
| `payment_skipped` | ✅ ON | Payment skipped notification |
| `admin_overdue_notification` | ✅ ON | Admin overdue notification |
| `overdue_contribution` | ✅ ON | Overdue contribution reminder |
| `wishlist_claim` | ✅ ON | Wishlist item claimed |
| `wishlist_unclaim` | ✅ ON | Wishlist item unclaimed |
| `wishlist_fulfilled` | ✅ ON | Wishlist item fulfilled |
| `chat_mention` | ✅ ON | Mentioned in chat |
| `chat_message` | ✅ ON | New chat message |
| `withdrawal_requested` | ✅ ON | Withdrawal requested |
| `withdrawal_completed` | ✅ ON | Withdrawal completed |
| `withdrawal_failed` | ✅ ON | Withdrawal failed |
| `member_left_subscription` | ✅ ON | Member left subscription group |
| `member_removed_subscription` | ✅ ON | Member removed from subscription group |
| `role_changed` | ✅ ON | Role changed (promoted/demoted) |

**Security Notifications**: Currently none, but if added in the future, they will always be sent (cannot be disabled).

---

## Summary

### Email Preferences
- **10 preferences default to ON** (Important: payments, transactions, critical group updates)
- **9 preferences default to OFF** (Reminders, newsletters, less critical updates)
- **Security alerts are always sent** (cannot be disabled)

### In-App Notifications
- **27 preferences, all default to ON**
- Security notifications (if any) always sent

### Push Notifications
- **27 preferences, all default to ON**
- Security notifications (if any) always sent
