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

const router = express.Router();

/**
 * PAYMENT METHOD MANAGEMENT
 */

// Step 1: Verify password before adding payment method
router.post('/methods/verify-password', authenticate, contributionLimiter, [
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
    const token = generatePasswordVerificationToken(userId, 'add_payment_method');

    // Store token in database for audit
    await storePasswordVerificationToken(userId, token, 'add_payment_method');

    res.json({
      verified: true,
      token,
      expiresIn: 300, // 5 minutes in seconds
    });
  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).json({ error: 'Server error during password verification' });
  }
});

// Step 2: Request OTP after password verification
router.post('/methods/request-otp', authenticate, otpLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('action').optional().isIn(['add-payment-method']).withMessage('Invalid action'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password_verification_token, action = 'add-payment-method' } = req.body;

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
    await requestPaymentOTP(userId, email, 'add_payment_method', password_verification_token);

    res.json({
      message: 'OTP sent to your email',
    });
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: error.message || 'Server error during OTP request' });
  }
});

// Step 3: Add payment method (requires password + OTP verification)
router.post('/methods', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('payment_method_data').notEmpty().withMessage('Payment method data is required'),
  body('provider').isIn(['stripe', 'paystack']).withMessage('Provider must be stripe or paystack'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password_verification_token, otp, payment_method_data, provider } = req.body;

    // Verify OTP
    const isOTPValid = await verifyPaymentOTP(userId, otp, password_verification_token, 'add_payment_method');
    if (!isOTPValid) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Get user details
    const userResult = await pool.query(
      'SELECT email, name FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { email, name } = userResult.rows[0];

    // Check if customer exists, create if not
    let customerId = provider === 'stripe' 
      ? await pool.query('SELECT stripe_customer_id FROM users WHERE id = $1', [userId]).then(r => r.rows[0]?.stripe_customer_id)
      : await pool.query('SELECT paystack_customer_code FROM users WHERE id = $1', [userId]).then(r => r.rows[0]?.paystack_customer_code);

    if (!customerId) {
      customerId = await paymentService.createCustomer({ email, name }, provider);
      
      // Store customer ID
      if (provider === 'stripe') {
        await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, userId]);
      } else {
        await pool.query('UPDATE users SET paystack_customer_code = $1 WHERE id = $2', [customerId, userId]);
      }
    }

    // Note: Actual payment method creation happens on frontend
    // Frontend handles card collection and returns payment method ID
    // For now, we'll just store the payment method ID provided by frontend
    const paymentMethodId = payment_method_data.payment_method_id || payment_method_data.authorization_code;

    // Log action
    await logPaymentAction({
      userId,
      action: 'add_payment_method',
      status: 'success',
      paymentProvider: provider,
      providerTransactionId: paymentMethodId,
      metadata: { provider, paymentMethodType: payment_method_data.type || 'card' },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      message: 'Payment method added successfully',
      paymentMethodId,
      customerId,
      provider,
    });
  } catch (error) {
    console.error('Add payment method error:', error);
    
    // Log error
    await logPaymentAction({
      userId: req.user.id,
      action: 'add_payment_method',
      status: 'failed',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.status(500).json({ error: error.message || 'Server error adding payment method' });
  }
});

// Get user's saved payment methods
router.get('/methods', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's payment preferences (which include payment method IDs)
    const result = await pool.query(
      `SELECT upp.id, upp.group_id, upp.auto_pay_enabled, upp.payment_method_id, upp.provider, upp.payment_timing,
              g.name as group_name, g.currency
       FROM user_payment_preferences upp
       LEFT JOIN groups g ON upp.group_id = g.id
       WHERE upp.user_id = $1 AND upp.payment_method_id IS NOT NULL
       ORDER BY upp.created_at DESC`,
      [userId]
    );

    // Group by payment method ID to avoid duplicates
    const paymentMethods = {};
    result.rows.forEach(row => {
      if (!paymentMethods[row.payment_method_id]) {
        paymentMethods[row.payment_method_id] = {
          paymentMethodId: row.payment_method_id,
          provider: row.provider,
          groups: [],
        };
      }
      paymentMethods[row.payment_method_id].groups.push({
        groupId: row.group_id,
        groupName: row.group_name,
        currency: row.currency,
        autoPayEnabled: row.auto_pay_enabled,
        paymentTiming: row.payment_timing,
      });
    });

    res.json({
      paymentMethods: Object.values(paymentMethods),
    });
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({ error: 'Server error getting payment methods' });
  }
});

// Verify password before editing payment method
router.put('/methods/:methodId/verify-password', authenticate, contributionLimiter, [
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
    const token = generatePasswordVerificationToken(userId, 'edit_payment_method');

    // Store token in database
    await storePasswordVerificationToken(userId, token, 'edit_payment_method');

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

// Update payment method (placeholder - actual implementation depends on provider)
router.put('/methods/:methodId', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('payment_method_data').notEmpty().withMessage('Payment method data is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { methodId } = req.params;
    const { password_verification_token, otp, payment_method_data } = req.body;

    // Verify OTP
    const isOTPValid = await verifyPaymentOTP(userId, otp, password_verification_token, 'edit_payment_method');
    if (!isOTPValid) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // TODO: Implement payment method update logic based on provider
    // This depends on Stripe/Paystack API capabilities

    // Log action
    await logPaymentAction({
      userId,
      action: 'edit_payment_method',
      status: 'success',
      metadata: { methodId },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      message: 'Payment method updated successfully',
    });
  } catch (error) {
    console.error('Update payment method error:', error);
    res.status(500).json({ error: error.message || 'Server error updating payment method' });
  }
});

// Verify password before deleting payment method
router.delete('/methods/:methodId/verify-password', authenticate, contributionLimiter, [
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
    const token = generatePasswordVerificationToken(userId, 'delete_payment_method');

    // Store token in database
    await storePasswordVerificationToken(userId, token, 'delete_payment_method');

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

// Delete payment method
router.delete('/methods/:methodId', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { methodId } = req.params;
    const { password_verification_token, otp } = req.body;

    // Verify OTP
    const isOTPValid = await verifyPaymentOTP(userId, otp, password_verification_token, 'delete_payment_method');
    if (!isOTPValid) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Check if payment method is used for auto-pay
    const autoPayCheck = await pool.query(
      `SELECT id, group_id FROM user_payment_preferences
       WHERE user_id = $1 AND payment_method_id = $2 AND auto_pay_enabled = TRUE`,
      [userId, methodId]
    );

    // Auto-disable auto-pay for all groups using this card
    if (autoPayCheck.rows.length > 0) {
      await pool.query(
        `UPDATE user_payment_preferences
         SET auto_pay_enabled = FALSE, payment_method_id = NULL
         WHERE user_id = $1 AND payment_method_id = $2`,
        [userId, methodId]
      );

      // TODO: Send notification email about auto-pay being disabled
    }

    // Remove payment method from preferences
    await pool.query(
      `UPDATE user_payment_preferences
       SET payment_method_id = NULL
       WHERE user_id = $1 AND payment_method_id = $2`,
      [userId, methodId]
    );

    // Log action
    await logPaymentAction({
      userId,
      action: 'delete_payment_method',
      status: 'success',
      metadata: { methodId, autoPayDisabled: autoPayCheck.rows.length > 0 },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      message: 'Payment method removed successfully',
      autoPayDisabled: autoPayCheck.rows.length > 0,
      affectedGroups: autoPayCheck.rows.map(r => r.group_id),
    });
  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({ error: error.message || 'Server error deleting payment method' });
  }
});

module.exports = router;
