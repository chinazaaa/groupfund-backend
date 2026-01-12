const pool = require('../config/database');

/**
 * Check if an email should be sent based on user preferences
 * @param {string} email - User email address
 * @param {string} preferenceKey - Preference column name (e.g., 'email_pref_payment_success')
 * @returns {Promise<boolean>} - true if email should be sent, false otherwise
 */
async function checkEmailPreference(email, preferenceKey) {
  try {
    if (!email || !preferenceKey) {
      return true; // Default to true if invalid params (fail open)
    }

    const result = await pool.query(
      `SELECT ${preferenceKey} FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return true; // User not found, default to true (fail open)
    }

    const preference = result.rows[0][preferenceKey];
    return preference !== null && preference !== undefined ? preference : true; // Default to true if null
  } catch (error) {
    console.error('Error checking email preference:', error);
    return true; // Default to true on error (fail open)
  }
}

/**
 * Email type to preference key mapping
 */
const EMAIL_PREFERENCE_MAP = {
  'welcome': 'email_pref_welcome',
  'birthday_wish': 'email_pref_birthday_wish',
  'birthday_reminder': 'email_pref_birthday_reminder',
  'comprehensive_birthday_reminder': 'email_pref_comprehensive_birthday_reminder',
  'comprehensive_reminder': 'email_pref_comprehensive_reminder',
  'overdue_contribution': 'email_pref_overdue_contribution',
  'admin_overdue_notification': 'email_pref_admin_overdue_notification',
  'admin_upcoming_deadline': 'email_pref_admin_upcoming_deadline',
  'contribution_amount_update': 'email_pref_contribution_amount_update',
  'deadline_update': 'email_pref_deadline_update',
  'max_members_update': 'email_pref_max_members_update',
  'member_left_subscription': 'email_pref_member_left_subscription',
  'monthly_newsletter': 'email_pref_monthly_newsletter',
  'holiday_emails': 'email_pref_holiday_emails',
  'payment_success': 'email_pref_payment_success',
  'autopay_success': 'email_pref_autopay_success',
  'autopay_disabled': 'email_pref_autopay_disabled',
  'payment_failure': 'email_pref_payment_failure',
  'withdrawal_request': 'email_pref_withdrawal_request',
  'withdrawal_completed': 'email_pref_withdrawal_completed',
  'withdrawal_failed': 'email_pref_withdrawal_failed',
  'security': 'email_pref_security',
};

/**
 * Check if email should be sent using the email type constant
 * @param {string} email - User email address
 * @param {string} emailType - Email type constant (e.g., 'payment_success')
 * @returns {Promise<boolean>} - true if email should be sent
 */
async function shouldSendEmail(email, emailType) {
  const preferenceKey = EMAIL_PREFERENCE_MAP[emailType];
  if (!preferenceKey) {
    return true; // Unknown email type, default to true
  }
  return await checkEmailPreference(email, preferenceKey);
}

module.exports = {
  checkEmailPreference,
  shouldSendEmail,
  EMAIL_PREFERENCE_MAP,
};
