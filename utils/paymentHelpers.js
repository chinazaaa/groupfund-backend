const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { generateOTP } = require('./helpers');
const { sendOTPEmail } = require('./email');

/**
 * Verify user password for 2FA flow
 * @param {string} userId - User ID
 * @param {string} password - Plain text password
 * @returns {Promise<boolean>} - True if password is valid
 */
async function verifyPassword(userId, password) {
  try {
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const hashedPassword = result.rows[0].password_hash;
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    console.error('Error verifying password:', error);
    return false;
  }
}

/**
 * Generate password verification token for 2FA flow
 * @param {string} userId - User ID
 * @param {string} action - Action being performed (e.g., 'add_payment_method')
 * @returns {string} - JWT token (expires in 5 minutes)
 */
function generatePasswordVerificationToken(userId, action) {
  const expiresIn = 5 * 60; // 5 minutes
  return jwt.sign(
    { userId, action, type: 'password_verification' },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Verify password verification token
 * @param {string} token - Password verification token
 * @returns {Promise<Object|null>} - Decoded token or null if invalid
 */
function verifyPasswordVerificationToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type === 'password_verification') {
      return decoded;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Store password verification token in database (for audit and validation)
 * @param {string} userId - User ID
 * @param {string} token - Password verification token
 * @param {string} action - Action being performed
 * @returns {Promise<void>}
 */
async function storePasswordVerificationToken(userId, token, action) {
  try {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

    await pool.query(
      `INSERT INTO password_verification_tokens (user_id, token, action, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET expires_at = $4`,
      [userId, token, action, expiresAt]
    );
  } catch (error) {
    console.error('Error storing password verification token:', error);
    // Don't throw - this is for audit, not critical
  }
}

/**
 * Request OTP for payment action (Step 2 of 2FA)
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @param {string} action - Action being performed
 * @param {string} passwordToken - Password verification token
 * @returns {Promise<boolean>} - True if OTP sent successfully
 */
async function requestPaymentOTP(userId, email, action, passwordToken) {
  try {
    // Verify password token first
    const decoded = verifyPasswordVerificationToken(passwordToken);
    if (!decoded || decoded.userId !== userId || decoded.action !== action) {
      throw new Error('Invalid or expired password verification token');
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    await pool.query(
      `INSERT INTO otps (user_id, email, code, type, expires_at, is_used)
       VALUES ($1, $2, $3, $4, $5, FALSE)`,
      [userId, email, otp, 'payment-action', expiresAt]
    );

    // Send OTP via email
    const emailSent = await sendOTPEmail(email, otp, 'payment-action');
    
    if (!emailSent) {
      throw new Error('Failed to send OTP email');
    }

    return true;
  } catch (error) {
    console.error('Error requesting payment OTP:', error);
    throw error;
  }
}

/**
 * Verify OTP for payment action (Step 3 of 2FA)
 * @param {string} userId - User ID
 * @param {string} otp - OTP code
 * @param {string} passwordToken - Password verification token
 * @param {string} action - Action being performed
 * @returns {Promise<boolean>} - True if OTP is valid
 */
async function verifyPaymentOTP(userId, otp, passwordToken, action) {
  try {
    // Verify password token first
    const decoded = verifyPasswordVerificationToken(passwordToken);
    if (!decoded) {
      console.error(`OTP verification failed: Invalid password verification token for user ${userId}, action ${action}`);
      return false;
    }
    
    if (decoded.userId !== userId) {
      console.error(`OTP verification failed: User ID mismatch. Token userId: ${decoded.userId}, provided userId: ${userId}, action: ${action}`);
      return false;
    }
    
    if (decoded.action !== action) {
      console.error(`OTP verification failed: Action mismatch. Token action: ${decoded.action}, provided action: ${action}, userId: ${userId}`);
      return false;
    }

    // Find valid OTP
    const otpResult = await pool.query(
      `SELECT * FROM otps
       WHERE user_id = $1 AND code = $2 AND type = $3 AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [userId, otp, 'payment-action']
    );

    if (otpResult.rows.length === 0) {
      // Check if OTP exists but is used or expired
      const otpCheck = await pool.query(
        `SELECT is_used, expires_at FROM otps
         WHERE user_id = $1 AND code = $2 AND type = $3
         ORDER BY created_at DESC LIMIT 1`,
        [userId, otp, 'payment-action']
      );
      
      if (otpCheck.rows.length > 0) {
        const otpRecord = otpCheck.rows[0];
        if (otpRecord.is_used) {
          console.error(`OTP verification failed: OTP already used. userId: ${userId}, action: ${action}`);
        } else if (new Date(otpRecord.expires_at) < new Date()) {
          console.error(`OTP verification failed: OTP expired. userId: ${userId}, action: ${action}, expiredAt: ${otpRecord.expires_at}`);
        }
      } else {
        console.error(`OTP verification failed: OTP not found. userId: ${userId}, action: ${action}`);
      }
      return false;
    }

    // Mark OTP as used
    await pool.query(
      'UPDATE otps SET is_used = TRUE WHERE id = $1',
      [otpResult.rows[0].id]
    );

    return true;
  } catch (error) {
    console.error('Error verifying payment OTP:', error);
    return false;
  }
}

/**
 * Log payment action to audit log
 * @param {Object} logData - Log data
 * @param {string} logData.userId - User ID
 * @param {string} logData.action - Action performed
 * @param {number} logData.amount - Amount (optional)
 * @param {string} logData.currency - Currency (optional)
 * @param {string} logData.status - Status ('success', 'failed', 'pending')
 * @param {string} logData.paymentProvider - Payment provider (optional)
 * @param {string} logData.providerTransactionId - Provider transaction ID (optional)
 * @param {string} logData.errorMessage - Error message (optional)
 * @param {Object} logData.metadata - Additional metadata (optional)
 * @param {string} logData.ipAddress - IP address (optional)
 * @param {string} logData.userAgent - User agent (optional)
 * @returns {Promise<void>}
 */
async function logPaymentAction({
  userId,
  action,
  amount,
  currency,
  status,
  paymentProvider,
  providerTransactionId,
  errorMessage,
  metadata,
  ipAddress,
  userAgent,
}) {
  try {
    await pool.query(
      `INSERT INTO payment_audit_log
       (user_id, action, amount, currency, status, payment_provider, provider_transaction_id, error_message, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        userId,
        action,
        amount || null,
        currency || null,
        status,
        paymentProvider || null,
        providerTransactionId || null,
        errorMessage || null,
        metadata ? JSON.stringify(metadata) : null,
        ipAddress || null,
        userAgent || null,
      ]
    );
  } catch (error) {
    console.error('Error logging payment action:', error);
    // Don't throw - audit logging should not break the main flow
  }
}

/**
 * Check if user has overdue payments (defaulter check)
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID (optional, for group-specific check)
 * @returns {Promise<Object>} - Defaulter status and overdue details
 */
async function checkDefaulterStatus(userId, groupId = null) {
  try {
    let query;
    let params;

    if (groupId) {
      // Check for overdue in specific group
      query = `
        SELECT 
          COUNT(*) as overdue_count,
          COALESCE(SUM(amount), 0) as total_overdue
        FROM (
          SELECT amount FROM birthday_contributions
          WHERE contributor_id = $1 AND group_id = $2 
            AND status IN ('not_paid', 'not_received')
            AND contribution_date < CURRENT_DATE
          UNION ALL
          SELECT amount FROM subscription_contributions
          WHERE contributor_id = $1 AND group_id = $2
            AND status IN ('not_paid', 'not_received')
            AND subscription_period_end < CURRENT_DATE
          UNION ALL
          SELECT amount FROM general_contributions
          WHERE contributor_id = $1 AND group_id = $2
            AND status IN ('not_paid', 'not_received')
            AND EXISTS (
              SELECT 1 FROM groups g
              WHERE g.id = $2 AND g.deadline < CURRENT_DATE
            )
        ) overdue
      `;
      params = [userId, groupId];
    } else {
      // Check for overdue in any group
      query = `
        SELECT 
          COUNT(*) as overdue_count,
          COALESCE(SUM(amount), 0) as total_overdue
        FROM (
          SELECT amount FROM birthday_contributions
          WHERE contributor_id = $1
            AND status IN ('not_paid', 'not_received')
            AND contribution_date < CURRENT_DATE
          UNION ALL
          SELECT amount FROM subscription_contributions
          WHERE contributor_id = $1
            AND status IN ('not_paid', 'not_received')
            AND subscription_period_end < CURRENT_DATE
          UNION ALL
          SELECT amount FROM general_contributions
          WHERE contributor_id = $1
            AND status IN ('not_paid', 'not_received')
            AND EXISTS (
              SELECT 1 FROM groups g
              WHERE g.id = general_contributions.group_id AND g.deadline < CURRENT_DATE
            )
        ) overdue
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);
    const overdueCount = parseInt(result.rows[0].overdue_count) || 0;
    const totalOverdue = parseFloat(result.rows[0].total_overdue) || 0;

    return {
      hasOverdue: overdueCount > 0,
      overdueCount,
      totalOverdue,
    };
  } catch (error) {
    console.error('Error checking defaulter status:', error);
    return {
      hasOverdue: false,
      overdueCount: 0,
      totalOverdue: 0,
    };
  }
}

/**
 * Verify 2FA code or OTP for payment action
 * Uses 2FA code if user has 2FA enabled with authenticator, otherwise uses OTP
 * @param {string} userId - User ID
 * @param {string} code - 2FA code or OTP code
 * @param {string} passwordToken - Password verification token
 * @param {string} action - Action being performed
 * @returns {Promise<boolean>} - True if code is valid
 */
async function verifyPaymentCode(userId, code, passwordToken, action) {
  try {
    // Verify password token first
    const decoded = verifyPasswordVerificationToken(passwordToken);
    if (!decoded || decoded.userId !== userId || decoded.action !== action) {
      return false;
    }

    // Check if user has 2FA enabled
    const userResult = await pool.query(
      'SELECT two_factor_enabled, two_factor_method, two_factor_secret FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return false;
    }

    const user = userResult.rows[0];

    // 2FA must be enabled (require2FA middleware should have already checked this)
    if (!user.two_factor_enabled) {
      return false; // Should never reach here if require2FA middleware is working
    }

    // If 2FA is enabled with authenticator, verify 2FA code
    if (user.two_factor_method === 'authenticator' && user.two_factor_secret) {
      const { verifyTOTPToken } = require('./twoFactor');
      // Convert code to string and ensure it's exactly 6 digits
      let codeString = String(code).trim();
      
      // Handle numeric input that may have lost leading zeros (e.g., 77341 -> 077341)
      if (codeString.length < 6 && /^\d+$/.test(codeString)) {
        codeString = codeString.padStart(6, '0');
      }
      
      // Ensure code is exactly 6 digits for TOTP
      if (codeString.length !== 6 || !/^\d{6}$/.test(codeString)) {
        console.error('Invalid TOTP code format:', { code, codeString, length: codeString.length });
        return false;
      }
      
      // Trim the secret in case there's whitespace
      const secret = user.two_factor_secret ? user.two_factor_secret.trim() : null;
      if (!secret) {
        console.error('TOTP verification failed: No secret found', { userId });
        return false;
      }
      
      const isValid = verifyTOTPToken(codeString, secret);
      if (!isValid) {
        console.error('TOTP verification failed:', { 
          userId, 
          codeString, 
          secretLength: secret.length,
          secretPreview: secret.substring(0, 10) + '...',
          hasSecret: !!user.two_factor_secret 
        });
      }
      return isValid;
    }

    // If 2FA is enabled with email, verify email OTP
    if (user.two_factor_method === 'email') {
      return await verifyPaymentOTP(userId, code, passwordToken, action);
    }

    // Unknown 2FA method or invalid state
    return false;
  } catch (error) {
    console.error('Error verifying payment code:', error);
    return false;
  }
}

module.exports = {
  verifyPassword,
  generatePasswordVerificationToken,
  verifyPasswordVerificationToken,
  storePasswordVerificationToken,
  requestPaymentOTP,
  verifyPaymentOTP,
  verifyPaymentCode, // New unified verification function
  logPaymentAction,
  checkDefaulterStatus,
};
