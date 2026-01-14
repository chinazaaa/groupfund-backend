const pool = require('../config/database');

/**
 * Notification type to preference key mapping (in-app)
 */
const INAPP_PREFERENCE_MAP = {
  'group_invite': 'inapp_pref_group_invite',
  'group_approved': 'inapp_pref_group_approved',
  'group_rejected': 'inapp_pref_group_rejected',
  'group_removed': 'inapp_pref_group_removed',
  'contribution_paid': 'inapp_pref_contribution_paid',
  'contribution_confirmed': 'inapp_pref_contribution_confirmed',
  'contribution_not_received': 'inapp_pref_contribution_not_received',
  'subscription_contribution_paid': 'inapp_pref_subscription_contribution_paid',
  'general_contribution_paid': 'inapp_pref_general_contribution_paid',
  'contribution_amount_updated': 'inapp_pref_contribution_amount_updated',
  'deadline_updated': 'inapp_pref_deadline_updated',
  'max_members_updated': 'inapp_pref_max_members_updated',
  'birthday_reminder': 'inapp_pref_birthday_reminder',
  'birthday_wish': 'inapp_pref_birthday_wish',
  'autopay_success': 'inapp_pref_autopay_success',
  'payment_skipped': 'inapp_pref_payment_skipped',
  'admin_overdue_notification': 'inapp_pref_admin_overdue_notification',
  'overdue_contribution': 'inapp_pref_overdue_contribution',
  'wishlist_claim': 'inapp_pref_wishlist_claim',
  'wishlist_unclaim': 'inapp_pref_wishlist_unclaim',
  'wishlist_fulfilled': 'inapp_pref_wishlist_fulfilled',
  'chat_mention': 'inapp_pref_chat_mention',
  'chat_message': 'inapp_pref_chat_message',
  'withdrawal_requested': 'inapp_pref_withdrawal_requested',
  'withdrawal_completed': 'inapp_pref_withdrawal_completed',
  'withdrawal_failed': 'inapp_pref_withdrawal_failed',
  'member_left_subscription': 'inapp_pref_member_left_subscription',
  'member_removed_subscription': 'inapp_pref_member_removed_subscription',
  'role_changed': 'inapp_pref_role_changed',
};

/**
 * Notification type to preference key mapping (push)
 */
const PUSH_PREFERENCE_MAP = {
  'group_invite': 'push_pref_group_invite',
  'group_approved': 'push_pref_group_approved',
  'group_rejected': 'push_pref_group_rejected',
  'group_removed': 'push_pref_group_removed',
  'contribution_paid': 'push_pref_contribution_paid',
  'contribution_confirmed': 'push_pref_contribution_confirmed',
  'contribution_not_received': 'push_pref_contribution_not_received',
  'subscription_contribution_paid': 'push_pref_subscription_contribution_paid',
  'general_contribution_paid': 'push_pref_general_contribution_paid',
  'contribution_amount_updated': 'push_pref_contribution_amount_updated',
  'deadline_updated': 'push_pref_deadline_updated',
  'max_members_updated': 'push_pref_max_members_updated',
  'birthday_reminder': 'push_pref_birthday_reminder',
  'birthday_wish': 'push_pref_birthday_wish',
  'autopay_success': 'push_pref_autopay_success',
  'payment_skipped': 'push_pref_payment_skipped',
  'admin_overdue_notification': 'push_pref_admin_overdue_notification',
  'overdue_contribution': 'push_pref_overdue_contribution',
  'wishlist_claim': 'push_pref_wishlist_claim',
  'wishlist_unclaim': 'push_pref_wishlist_unclaim',
  'wishlist_fulfilled': 'push_pref_wishlist_fulfilled',
  'chat_mention': 'push_pref_chat_mention',
  'chat_message': 'push_pref_chat_message',
  'withdrawal_requested': 'push_pref_withdrawal_requested',
  'withdrawal_completed': 'push_pref_withdrawal_completed',
  'withdrawal_failed': 'push_pref_withdrawal_failed',
  'member_left_subscription': 'push_pref_member_left_subscription',
  'member_removed_subscription': 'push_pref_member_removed_subscription',
  'role_changed': 'push_pref_role_changed',
};

/**
 * Security-related notification types (always sent - cannot be disabled)
 * Note: Currently no security notification types exist, but this is reserved for future use
 */
const SECURITY_NOTIFICATION_TYPES = [
  // Add security notification types here if needed in the future
  // e.g., 'security_alert', 'account_compromised', etc.
];

/**
 * Check if an in-app notification should be sent based on user preferences
 * @param {string} userId - User ID
 * @param {string} notificationType - Notification type (e.g., 'group_invite')
 * @returns {Promise<boolean>} - true if notification should be sent
 */
async function shouldSendInAppNotification(userId, notificationType) {
  try {
    // Security notifications always sent
    if (SECURITY_NOTIFICATION_TYPES.includes(notificationType)) {
      return true;
    }

    const preferenceKey = INAPP_PREFERENCE_MAP[notificationType];
    if (!preferenceKey) {
      return true; // Unknown type, default to true (fail open)
    }

    const result = await pool.query(
      `SELECT ${preferenceKey} FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return true; // User not found, default to true
    }

    const preference = result.rows[0][preferenceKey];
    return preference !== null && preference !== undefined ? preference : true;
  } catch (error) {
    console.error('Error checking in-app notification preference:', error);
    return true; // Default to true on error (fail open)
  }
}

/**
 * Check if a push notification should be sent based on user preferences
 * @param {string} userId - User ID
 * @param {string} notificationType - Notification type (e.g., 'group_invite')
 * @returns {Promise<boolean>} - true if notification should be sent
 */
async function shouldSendPushNotificationBasedOnPreference(userId, notificationType) {
  try {
    // Security notifications always sent
    if (SECURITY_NOTIFICATION_TYPES.includes(notificationType)) {
      return true;
    }

    const preferenceKey = PUSH_PREFERENCE_MAP[notificationType];
    if (!preferenceKey) {
      return true; // Unknown type, default to true (fail open)
    }

    const result = await pool.query(
      `SELECT ${preferenceKey} FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return true; // User not found, default to true
    }

    const preference = result.rows[0][preferenceKey];
    return preference !== null && preference !== undefined ? preference : true;
  } catch (error) {
    console.error('Error checking push notification preference:', error);
    return true; // Default to true on error (fail open)
  }
}

module.exports = {
  shouldSendInAppNotification,
  shouldSendPushNotificationBasedOnPreference,
  INAPP_PREFERENCE_MAP,
  PUSH_PREFERENCE_MAP,
  SECURITY_NOTIFICATION_TYPES,
};
