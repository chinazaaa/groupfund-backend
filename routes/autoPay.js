const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { otpLimiter, contributionLimiter } = require('../middleware/rateLimiter');
const paymentService = require('../services/paymentService');
const {
  verifyPassword,
  generatePasswordVerificationToken,
  verifyPasswordVerificationToken,
  storePasswordVerificationToken,
  requestPaymentOTP,
  verifyPaymentOTP,
  logPaymentAction,
  checkDefaulterStatus,
} = require('../utils/paymentHelpers');
const {
  sendAutoPayDisabledEmail,
  sendPaymentSuccessEmail,
  sendSecurityEmail,
} = require('../utils/email');

const router = express.Router();

/**
 * AUTO-PAY ENABLE
 */

// Step 1: Verify password before enabling auto-pay
router.post('/:groupId/auto-pay/enable/verify-password', authenticate, contributionLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { groupId } = req.params;
    const { password } = req.body;

    // Verify user is member of group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, userId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group' });
    }

    // Verify password
    const isValid = await verifyPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Generate password verification token
    const token = generatePasswordVerificationToken(userId, 'enable_auto_pay');

    // Store token in database
    await storePasswordVerificationToken(userId, token, 'enable_auto_pay');

    res.json({
      verified: true,
      token,
      expiresIn: 300, // 5 minutes
    });
  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).json({ error: 'Server error during password verification' });
  }
});

// Step 2: Request OTP after password verification
router.post('/:groupId/auto-pay/enable/request-otp', authenticate, otpLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { groupId } = req.params;
    const { password_verification_token } = req.body;

    // Verify user is member of group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, userId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group' });
    }

    // Get user email
    const userResult = await pool.query(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const email = userResult.rows[0].email;

    // Request OTP
    await requestPaymentOTP(userId, email, 'enable_auto_pay', password_verification_token);

    res.json({
      message: 'OTP sent to your email',
    });
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: error.message || 'Server error during OTP request' });
  }
});

// Step 3: Enable auto-pay for user in group (requires password + OTP verification)
router.post('/:groupId/auto-pay/enable', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('payment_method_id').notEmpty().withMessage('Payment method ID is required'),
  body('payment_timing').isIn(['1_day_before', 'same_day']).withMessage('Payment timing must be 1_day_before or same_day'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { groupId } = req.params;
    const { password_verification_token, otp, payment_method_id, payment_timing } = req.body;

    // Verify OTP
    const isOTPValid = await verifyPaymentOTP(userId, otp, password_verification_token, 'enable_auto_pay');
    if (!isOTPValid) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Verify user is member of group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, userId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group' });
    }

    // Get group details
    const groupResult = await pool.query(
      'SELECT id, name, group_type, deadline, currency FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];

    // Check for overdue payments - user must pay overdue first
    const defaulterStatus = await checkDefaulterStatus(userId, groupId);
    if (defaulterStatus.hasOverdue) {
      return res.status(400).json({
        error: 'Please pay all overdue contributions before enabling auto-pay',
        overdueAmount: defaulterStatus.totalOverdue,
      });
    }

    // For general groups: Check if deadline has passed
    if (group.group_type === 'general' && group.deadline) {
      const deadlineDate = new Date(group.deadline);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (deadlineDate < today) {
        return res.status(400).json({
          error: 'Cannot enable auto-pay: Group deadline has passed',
        });
      }
    }

    // Determine payment provider based on currency
    const provider = paymentService.selectProvider(group.currency, null);

    // Get user's customer ID for provider
    let customerId;
    if (provider === 'stripe') {
      const userResult = await pool.query(
        'SELECT stripe_customer_id FROM users WHERE id = $1',
        [userId]
      );
      customerId = userResult.rows[0]?.stripe_customer_id;
    } else {
      const userResult = await pool.query(
        'SELECT paystack_customer_code FROM users WHERE id = $1',
        [userId]
      );
      customerId = userResult.rows[0]?.paystack_customer_code;
    }

    if (!customerId) {
      return res.status(400).json({
        error: 'Payment method not found. Please add a payment method first.',
      });
    }

    // Create or update payment preference
    const preferenceCheck = await pool.query(
      'SELECT id FROM user_payment_preferences WHERE user_id = $1 AND group_id = $2',
      [userId, groupId]
    );

    if (preferenceCheck.rows.length > 0) {
      // Update existing preference
      await pool.query(
        `UPDATE user_payment_preferences
         SET auto_pay_enabled = TRUE, payment_method_id = $1, payment_timing = $2, provider = $3, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $4 AND group_id = $5`,
        [payment_method_id, payment_timing, provider, userId, groupId]
      );
    } else {
      // Create new preference
      await pool.query(
        `INSERT INTO user_payment_preferences
         (user_id, group_id, auto_pay_enabled, payment_method_id, payment_timing, provider)
         VALUES ($1, $2, TRUE, $3, $4, $5)`,
        [userId, groupId, payment_method_id, payment_timing, provider]
      );
    }

    // Log action
    await logPaymentAction({
      userId,
      action: 'enable_auto_pay',
      status: 'success',
      paymentProvider: provider,
      metadata: { groupId, groupName: group.name, paymentTiming: payment_timing },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Send security email notification
    try {
      const userResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length > 0) {
        const userEmail = userResult.rows[0].email;
        const userName = userResult.rows[0].name;

        await sendSecurityEmail(
          userEmail,
          userName,
          'enable_auto_pay',
          `auto-pay was enabled for the group "${group.name}"`,
          {
            groupName: group.name,
            paymentTiming: payment_timing,
          }
        );
      }
    } catch (emailError) {
      console.error('Error sending security email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({
      message: 'Auto-pay enabled successfully',
      auto_pay_enabled: true,
      payment_timing,
      group_id: groupId,
    });
  } catch (error) {
    console.error('Enable auto-pay error:', error);

    // Log error
    await logPaymentAction({
      userId: req.user.id,
      action: 'enable_auto_pay',
      status: 'failed',
      errorMessage: error.message,
      metadata: { groupId },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.status(500).json({ error: error.message || 'Server error enabling auto-pay' });
  }
});

/**
 * AUTO-PAY DISABLE
 */

// Step 1: Verify password before disabling auto-pay
router.post('/:groupId/auto-pay/disable/verify-password', authenticate, contributionLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password } = req.body;

    // Verify password
    const isValid = await verifyPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Generate password verification token
    const token = generatePasswordVerificationToken(userId, 'disable_auto_pay');

    // Store token in database
    await storePasswordVerificationToken(userId, token, 'disable_auto_pay');

    res.json({
      verified: true,
      token,
      expiresIn: 300,
    });
  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).json({ error: 'Server error during password verification' });
  }
});

// Step 3: Disable auto-pay for user in group (requires password + OTP verification)
router.post('/:groupId/auto-pay/disable', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { groupId } = req.params;
    const { password_verification_token, otp } = req.body;

    // Verify OTP
    const isOTPValid = await verifyPaymentOTP(userId, otp, password_verification_token, 'disable_auto_pay');
    if (!isOTPValid) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Verify user is member of group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, userId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group' });
    }

    // Get group name for logging
    const groupResult = await pool.query(
      'SELECT name FROM groups WHERE id = $1',
      [groupId]
    );
    const groupName = groupResult.rows[0]?.name || 'Group';

    // Disable auto-pay
    await pool.query(
      `UPDATE user_payment_preferences
       SET auto_pay_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND group_id = $2`,
      [userId, groupId]
    );

    // Log action
    await logPaymentAction({
      userId,
      action: 'disable_auto_pay',
      status: 'success',
      metadata: { groupId, groupName },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Send security email notification
    try {
      const userResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length > 0) {
        const userEmail = userResult.rows[0].email;
        const userName = userResult.rows[0].name;

        await sendSecurityEmail(
          userEmail,
          userName,
          'disable_auto_pay',
          `auto-pay was disabled for the group "${groupName}"`,
          {
            groupName,
          }
        );
      }
    } catch (emailError) {
      console.error('Error sending security email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({
      message: 'Auto-pay disabled successfully',
      auto_pay_enabled: false,
      group_id: groupId,
    });
  } catch (error) {
    console.error('Disable auto-pay error:', error);

    // Log error
    await logPaymentAction({
      userId: req.user.id,
      action: 'disable_auto_pay',
      status: 'failed',
      errorMessage: error.message,
      metadata: { groupId },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.status(500).json({ error: error.message || 'Server error disabling auto-pay' });
  }
});

/**
 * AUTO-PAY STATUS
 */

// Get auto-pay status for user in group
router.get('/:groupId/auto-pay/status', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId } = req.params;

    // Verify user is member of group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, userId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group' });
    }

    // Get payment preference
    const preferenceResult = await pool.query(
      `SELECT auto_pay_enabled, payment_timing, payment_method_id, provider
       FROM user_payment_preferences
       WHERE user_id = $1 AND group_id = $2`,
      [userId, groupId]
    );

    if (preferenceResult.rows.length === 0) {
      return res.json({
        auto_pay_enabled: false,
        payment_timing: null,
        payment_method_id: null,
        provider: null,
      });
    }

    const preference = preferenceResult.rows[0];

    res.json({
      auto_pay_enabled: preference.auto_pay_enabled,
      payment_timing: preference.payment_timing,
      payment_method_id: preference.payment_method_id,
      provider: preference.provider,
    });
  } catch (error) {
    console.error('Get auto-pay status error:', error);
    res.status(500).json({ error: 'Server error getting auto-pay status' });
  }
});

/**
 * AUTO-PAY PREFERENCES UPDATE
 */

// Step 1: Verify password before updating preferences
router.put('/:groupId/auto-pay/preferences/verify-password', authenticate, contributionLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password } = req.body;

    // Verify password
    const isValid = await verifyPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Generate password verification token
    const token = generatePasswordVerificationToken(userId, 'update_auto_pay_preferences');

    // Store token in database
    await storePasswordVerificationToken(userId, token, 'update_auto_pay_preferences');

    res.json({
      verified: true,
      token,
      expiresIn: 300,
    });
  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).json({ error: 'Server error during password verification' });
  }
});

// Step 3: Update payment timing preference for group (requires password + OTP verification)
router.put('/:groupId/auto-pay/preferences', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('payment_timing').isIn(['1_day_before', 'same_day']).withMessage('Payment timing must be 1_day_before or same_day'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { groupId } = req.params;
    const { password_verification_token, otp, payment_timing } = req.body;

    // Verify OTP
    const isOTPValid = await verifyPaymentOTP(userId, otp, password_verification_token, 'update_auto_pay_preferences');
    if (!isOTPValid) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Verify user is member of group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, userId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group' });
    }

    // Check for overdue payments
    const defaulterStatus = await checkDefaulterStatus(userId, groupId);
    if (defaulterStatus.hasOverdue) {
      return res.status(400).json({
        error: 'Please pay all overdue contributions before updating auto-pay preferences',
        overdueAmount: defaulterStatus.totalOverdue,
      });
    }

    // Update preference
    await pool.query(
      `UPDATE user_payment_preferences
       SET payment_timing = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND group_id = $3`,
      [payment_timing, userId, groupId]
    );

    // Get group name for email
    const groupResult = await pool.query(
      'SELECT name FROM groups WHERE id = $1',
      [groupId]
    );
    const groupName = groupResult.rows[0]?.name || 'Group';

    // Log action
    await logPaymentAction({
      userId,
      action: 'update_auto_pay_preferences',
      status: 'success',
      metadata: { groupId, paymentTiming: payment_timing, groupName },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Send security email notification
    try {
      const userResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length > 0) {
        const userEmail = userResult.rows[0].email;
        const userName = userResult.rows[0].name;

        await sendSecurityEmail(
          userEmail,
          userName,
          'update_auto_pay_preferences',
          `auto-pay preferences were updated for the group "${groupName}"`,
          {
            groupName,
            paymentTiming: payment_timing,
          }
        );
      }
    } catch (emailError) {
      console.error('Error sending security email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({
      message: 'Payment timing preference updated successfully',
      payment_timing,
      group_id: groupId,
    });
  } catch (error) {
    console.error('Update auto-pay preferences error:', error);
    res.status(500).json({ error: error.message || 'Server error updating preferences' });
  }
});

module.exports = router;
