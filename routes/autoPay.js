const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { require2FA } = require('../middleware/require2FA');
const { otpLimiter, contributionLimiter } = require('../middleware/rateLimiter');
const paymentService = require('../services/paymentService');
const {
  verifyPassword,
  generatePasswordVerificationToken,
  verifyPasswordVerificationToken,
  storePasswordVerificationToken,
  requestPaymentOTP,
  verifyPaymentOTP,
  verifyPaymentCode,
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

// Step 1: Verify password before enabling auto-pay (requires 2FA)
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

    // Verify password first
    const isValid = await verifyPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Check if 2FA is enabled (after password is verified)
    const twoFactorResult = await pool.query(
      'SELECT two_factor_enabled FROM users WHERE id = $1',
      [userId]
    );
    if (twoFactorResult.rows.length === 0 || !twoFactorResult.rows[0].two_factor_enabled) {
      return res.status(403).json({
        error: 'Two-factor authentication (2FA) is required for this feature',
        code: '2FA_REQUIRED',
        message: 'Please enable 2FA in your security settings to use this feature',
      });
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

    // Check if user has 2FA enabled with authenticator
    const userResult = await pool.query(
      'SELECT two_factor_enabled, two_factor_method, two_factor_secret, email FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // 2FA must be enabled (require2FA middleware should have already checked this)
    if (!user.two_factor_enabled) {
      return res.status(403).json({
        error: 'Two-factor authentication (2FA) is required for this feature',
        code: '2FA_REQUIRED',
        message: 'Please enable 2FA in your security settings to use this feature',
      });
    }

    // If 2FA is enabled with authenticator, skip OTP request (user gets code from authenticator)
    if (user.two_factor_method === 'authenticator' && user.two_factor_secret) {
      return res.json({
        message: 'Please enter the code from your authenticator app',
        requires2FA: true,
      });
    }

    // If 2FA is enabled with email, send email OTP
    if (user.two_factor_method === 'email') {
      const email = user.email;

      // Request OTP
      await requestPaymentOTP(userId, email, 'enable_auto_pay', password_verification_token);

      return res.json({
        message: 'OTP sent to your email',
        requires2FA: true,
        method: 'email',
      });
    }

    // Unknown 2FA method or invalid state
    return res.status(400).json({ error: 'Invalid 2FA configuration' });
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: error.message || 'Server error during OTP request' });
  }
});

// Step 3: Enable auto-pay for user in group (requires password + OTP verification + 2FA)
router.post('/:groupId/auto-pay/enable', authenticate, require2FA, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('payment_method_id').optional().isUUID().withMessage('Payment method ID must be a valid UUID'),
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
    // Verify code (2FA code if 2FA enabled, otherwise OTP)
    const isValidCode = await verifyPaymentCode(userId, otp, password_verification_token, 'enable_auto_pay');
    if (!isValidCode) {
      return res.status(401).json({ 
        error: 'Invalid or expired code. If using an authenticator app, make sure you\'re using the current code. If the issue persists, try disabling and re-adding 2FA in your security settings.' 
      });
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
      'SELECT id, name, group_type, deadline, currency, admin_id FROM groups WHERE id = $1',
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

    // Validate group has currency
    if (!group.currency) {
      return res.status(400).json({
        error: 'Group has no currency set. Please contact the group admin.',
      });
    }

    const groupCurrency = group.currency;
    const provider = paymentService.selectProvider(groupCurrency, null);

    // Validate bank account required for group's currency
    // Check for a bank account in wallet_bank_accounts for the group's currency
    // This ensures the recipient (group admin) can receive funds from auto-pay
    const recipientBankAccountCheck = await pool.query(
      `SELECT id FROM wallet_bank_accounts 
       WHERE user_id = $1 AND currency = $2`,
      [group.admin_id, groupCurrency]
    );

    if (recipientBankAccountCheck.rows.length === 0) {
      return res.status(400).json({
        error: `Group admin needs a bank account for ${groupCurrency} to receive auto-pay contributions. Please ask the group admin to add a bank account for ${groupCurrency}.`,
        currency: groupCurrency,
        code: 'RECIPIENT_BANK_ACCOUNT_REQUIRED',
      });
    }

    let paymentMethod;

    // If payment_method_id is provided, use it
    if (payment_method_id) {
      // Verify payment method exists and belongs to user
      // payment_method_id is the UUID from user_payment_methods table
      const paymentMethodCheck = await pool.query(
        `SELECT id, payment_method_id, provider, currency, is_active
         FROM user_payment_methods
         WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
        [payment_method_id, userId]
      );

      if (paymentMethodCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Payment method not found or inactive.',
        });
      }

      paymentMethod = paymentMethodCheck.rows[0];
    } else {
      // Auto-select default payment method for this currency
      // First, try to find a default payment method for this currency
      let defaultMethodQuery = `
        SELECT id, payment_method_id, provider, currency, is_active
        FROM user_payment_methods
        WHERE user_id = $1 AND is_active = TRUE AND provider = $2 AND is_default = TRUE
      `;
      const defaultMethodParams = [userId, provider];

      // For Paystack, require exact currency match
      if (provider === 'paystack') {
        defaultMethodQuery += ` AND currency = $3`;
        defaultMethodParams.push(groupCurrency);
      } else {
        // For Stripe, prefer matching currency but allow any Stripe card (they can charge in multiple currencies)
        defaultMethodQuery += ` ORDER BY CASE WHEN currency = $3 THEN 0 ELSE 1 END, created_at ASC LIMIT 1`;
        defaultMethodParams.push(groupCurrency);
      }

      const defaultMethodResult = await pool.query(defaultMethodQuery, defaultMethodParams);

      if (defaultMethodResult.rows.length > 0) {
        // Found a default payment method
        paymentMethod = defaultMethodResult.rows[0];
      } else {
        // No default found, try to find any payment method for this currency
        // Use the latest (most recently added) payment method
        let anyMethodQuery = `
          SELECT id, payment_method_id, provider, currency, is_active
          FROM user_payment_methods
          WHERE user_id = $1 AND is_active = TRUE AND provider = $2
        `;
        const anyMethodParams = [userId, provider];

        if (provider === 'paystack') {
          anyMethodQuery += ` AND currency = $3 ORDER BY created_at DESC LIMIT 1`;
          anyMethodParams.push(groupCurrency);
        } else {
          // For Stripe, prefer matching currency, then use latest (most recently added)
          anyMethodQuery += ` ORDER BY CASE WHEN currency = $3 THEN 0 ELSE 1 END, created_at DESC LIMIT 1`;
          anyMethodParams.push(groupCurrency);
        }

        const anyMethodResult = await pool.query(anyMethodQuery, anyMethodParams);

        if (anyMethodResult.rows.length === 0) {
          // No payment method found for this currency
          return res.status(400).json({
            error: `No payment method found for ${groupCurrency}. Please add a payment method first.`,
            code: 'NO_PAYMENT_METHOD',
            currency: groupCurrency,
            provider: provider,
            action: 'add_payment_method',
          });
        }

        // Use the first available payment method
        paymentMethod = anyMethodResult.rows[0];
      }
    }

    // Validate provider match (should already match from our query, but double-check)
    if (paymentMethod.provider !== provider) {
      return res.status(400).json({
        error: `Payment method provider (${paymentMethod.provider}) does not match group currency provider (${provider}). Please use a ${provider} payment method for ${groupCurrency} groups.`,
        groupCurrency: groupCurrency,
        paymentMethodCurrency: paymentMethod.currency,
        requiredProvider: provider,
        paymentMethodProvider: paymentMethod.provider,
      });
    }

    // For Paystack, validate currency matches (Paystack cards are currency-specific)
    // For Stripe, allow any currency (Stripe cards can charge in multiple currencies)
    if (provider === 'paystack' && paymentMethod.currency && paymentMethod.currency !== groupCurrency) {
      return res.status(400).json({
        error: `Payment method currency (${paymentMethod.currency}) does not match group currency (${groupCurrency}). Please use a ${groupCurrency} payment method for this group.`,
        groupCurrency: groupCurrency,
        paymentMethodCurrency: paymentMethod.currency,
      });
    }
    // For Stripe: No currency validation needed - Stripe cards can charge in any currency

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
        error: 'Customer account not found. Please add a payment method first.',
      });
    }

    // Use the provider's payment_method_id (not our UUID)
    const providerPaymentMethodId = paymentMethod.payment_method_id;

    // Create or update payment preference
    const preferenceCheck = await pool.query(
      'SELECT id FROM user_payment_preferences WHERE user_id = $1 AND group_id = $2',
      [userId, groupId]
    );

    if (preferenceCheck.rows.length > 0) {
      // Update existing preference
      // Store provider's payment_method_id (not our UUID) in user_payment_preferences
      await pool.query(
        `UPDATE user_payment_preferences
         SET auto_pay_enabled = TRUE, payment_method_id = $1, payment_timing = $2, provider = $3, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $4 AND group_id = $5`,
        [providerPaymentMethodId, payment_timing, provider, userId, groupId]
      );
    } else {
      // Create new preference
      // Store provider's payment_method_id (not our UUID) in user_payment_preferences
      await pool.query(
        `INSERT INTO user_payment_preferences
         (user_id, group_id, auto_pay_enabled, payment_method_id, payment_timing, provider)
         VALUES ($1, $2, TRUE, $3, $4, $5)`,
        [userId, groupId, providerPaymentMethodId, payment_timing, provider]
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

// Step 1: Verify password before disabling auto-pay (requires 2FA)
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

    // Verify password first
    const isValid = await verifyPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Check if 2FA is enabled (after password is verified)
    const twoFactorResult = await pool.query(
      'SELECT two_factor_enabled FROM users WHERE id = $1',
      [userId]
    );
    if (twoFactorResult.rows.length === 0 || !twoFactorResult.rows[0].two_factor_enabled) {
      return res.status(403).json({
        error: 'Two-factor authentication (2FA) is required for this feature',
        code: '2FA_REQUIRED',
        message: 'Please enable 2FA in your security settings to use this feature',
      });
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

// Step 2: Request OTP after password verification for disabling auto-pay
router.post('/:groupId/auto-pay/disable/request-otp', authenticate, otpLimiter, [
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

    // Check if user has 2FA enabled with authenticator
    const userResult = await pool.query(
      'SELECT two_factor_enabled, two_factor_method, two_factor_secret, email FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // 2FA must be enabled (require2FA middleware should have already checked this)
    if (!user.two_factor_enabled) {
      return res.status(403).json({
        error: 'Two-factor authentication (2FA) is required for this feature',
        code: '2FA_REQUIRED',
        message: 'Please enable 2FA in your security settings to use this feature',
      });
    }

    // If 2FA is enabled with authenticator, skip OTP request (user gets code from authenticator)
    if (user.two_factor_method === 'authenticator' && user.two_factor_secret) {
      return res.json({
        message: 'Please enter the code from your authenticator app',
        requires2FA: true,
      });
    }

    // If 2FA is enabled with email, send email OTP
    if (user.two_factor_method === 'email') {
      const email = user.email;

      // Request OTP
      await requestPaymentOTP(userId, email, 'disable_auto_pay', password_verification_token);

      return res.json({
        message: 'OTP sent to your email',
        requires2FA: true,
        method: 'email',
      });
    }

    // Unknown 2FA method or invalid state
    return res.status(400).json({ error: 'Invalid 2FA configuration' });
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: error.message || 'Server error during OTP request' });
  }
});

// Step 3: Disable auto-pay for user in group (requires password + OTP verification + 2FA)
router.post('/:groupId/auto-pay/disable', authenticate, require2FA, contributionLimiter, [
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
    // Verify code (2FA code if 2FA enabled, otherwise OTP)
    const isValidCode = await verifyPaymentCode(userId, otp, password_verification_token, 'disable_auto_pay');
    if (!isValidCode) {
      return res.status(401).json({ 
        error: 'Invalid or expired code. If using an authenticator app, make sure you\'re using the current code. If the issue persists, try disabling and re-adding 2FA in your security settings.' 
      });
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
 * GET PAYMENT METHODS FOR GROUP
 */

// Get available payment methods for a group (filtered by group currency)
router.get('/:groupId/auto-pay/payment-methods', authenticate, async (req, res) => {
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

    // Get group currency
    const groupResult = await pool.query(
      'SELECT currency FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const groupCurrency = groupResult.rows[0].currency;
    if (!groupCurrency) {
      return res.status(400).json({ error: 'Group has no currency set' });
    }

    // Get payment methods that match the group's currency/provider
    const provider = paymentService.selectProvider(groupCurrency, null);

    let query = `
      SELECT id, payment_method_id, provider, payment_method_type, currency, last4, brand,
             expiry_month, expiry_year, is_default, is_active, created_at, updated_at
      FROM user_payment_methods
      WHERE user_id = $1 AND is_active = TRUE AND provider = $2
    `;
    const params = [userId, provider];

    // For Paystack, require currency match (Paystack cards are currency-specific)
    // For Stripe, show all cards (Stripe cards can charge in multiple currencies)
    if (provider === 'paystack') {
      query += ` AND (currency = $3 OR currency IS NULL)`;
      params.push(groupCurrency);
      query += ` ORDER BY is_default DESC, created_at DESC`;
    } else {
      // For Stripe, show all cards (they can charge in multiple currencies)
      // Prefer matching currency if specified, but show all Stripe cards
      query += ` ORDER BY 
        CASE WHEN currency = $3 THEN 0 ELSE 1 END,
        is_default DESC, 
        created_at DESC`;
      params.push(groupCurrency);
    }

    const result = await pool.query(query, params);

    const paymentMethods = result.rows.map(method => ({
      id: method.id,
      paymentMethodId: method.payment_method_id,
      provider: method.provider,
      paymentMethodType: method.payment_method_type,
      currency: method.currency,
      last4: method.last4, // camelCase (primary)
      last_4_digits: method.last4, // snake_case (alias for compatibility)
      brand: method.brand,
      expiryMonth: method.expiry_month,
      expiryYear: method.expiry_year,
      isDefault: method.is_default,
      displayName: method.last4 
        ? `${method.brand || 'Card'} •••• ${method.last4}${method.expiry_month && method.expiry_year ? ` (${method.expiry_month}/${method.expiry_year.toString().slice(-2)})` : ''}`
        : 'Payment Method',
    }));

    res.json({
      paymentMethods,
      groupCurrency,
      requiredProvider: provider,
    });
  } catch (error) {
    console.error('Get payment methods for group error:', error);
    res.status(500).json({ error: 'Server error getting payment methods' });
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
        payment_method: null,
        provider: null,
      });
    }

    const preference = preferenceResult.rows[0];

    // Get payment method details if auto-pay is enabled
    let paymentMethod = null;
    if (preference.auto_pay_enabled && preference.payment_method_id) {
      const methodResult = await pool.query(
        `SELECT id, payment_method_id, provider, payment_method_type, currency, last4, brand,
                expiry_month, expiry_year, is_default
         FROM user_payment_methods
         WHERE user_id = $1 AND payment_method_id = $2 AND is_active = TRUE`,
        [userId, preference.payment_method_id]
      );

      if (methodResult.rows.length > 0) {
        const method = methodResult.rows[0];
        paymentMethod = {
          id: method.id,
          paymentMethodId: method.payment_method_id,
          provider: method.provider,
          paymentMethodType: method.payment_method_type,
          currency: method.currency,
          last4: method.last4, // camelCase (primary)
          last_4_digits: method.last4, // snake_case (alias for compatibility)
          brand: method.brand,
          expiryMonth: method.expiry_month,
          expiryYear: method.expiry_year,
          isDefault: method.is_default,
          displayName: method.last4 
            ? `${method.brand || 'Card'} •••• ${method.last4}${method.expiry_month && method.expiry_year ? ` (${method.expiry_month}/${method.expiry_year.toString().slice(-2)})` : ''}`
            : 'Payment Method',
        };
      }
    }

    // Explicitly convert boolean to ensure it's true/false, not 't'/'f' or null
    const autoPayEnabled = preference.auto_pay_enabled === true || preference.auto_pay_enabled === 't' || preference.auto_pay_enabled === 'true';

    res.json({
      auto_pay_enabled: autoPayEnabled,
      payment_timing: preference.payment_timing,
      payment_method: paymentMethod,
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

// Step 2: Request OTP after password verification for updating preferences
router.put('/:groupId/auto-pay/preferences/request-otp', authenticate, otpLimiter, [
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

    // Check if user has 2FA enabled with authenticator
    const userResult = await pool.query(
      'SELECT two_factor_enabled, two_factor_method, two_factor_secret, email FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // 2FA must be enabled (require2FA middleware should have already checked this)
    if (!user.two_factor_enabled) {
      return res.status(403).json({
        error: 'Two-factor authentication (2FA) is required for this feature',
        code: '2FA_REQUIRED',
        message: 'Please enable 2FA in your security settings to use this feature',
      });
    }

    // If 2FA is enabled with authenticator, skip OTP request (user gets code from authenticator)
    if (user.two_factor_method === 'authenticator' && user.two_factor_secret) {
      return res.json({
        message: 'Please enter the code from your authenticator app',
        requires2FA: true,
      });
    }

    // If 2FA is enabled with email, send email OTP
    if (user.two_factor_method === 'email') {
      const email = user.email;

      // Request OTP
      await requestPaymentOTP(userId, email, 'update_auto_pay_preferences', password_verification_token);

      return res.json({
        message: 'OTP sent to your email',
        requires2FA: true,
        method: 'email',
      });
    }

    // Unknown 2FA method or invalid state
    return res.status(400).json({ error: 'Invalid 2FA configuration' });
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: error.message || 'Server error during OTP request' });
  }
});

// Step 3: Update auto-pay preferences for group (requires password + OTP verification)
// Can update payment_timing and/or payment_method_id
router.put('/:groupId/auto-pay/preferences', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('payment_timing').optional().isIn(['1_day_before', 'same_day']).withMessage('Payment timing must be 1_day_before or same_day'),
  body('payment_method_id').optional().isUUID().withMessage('Payment method ID must be a valid UUID'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { groupId } = req.params;
    const { password_verification_token, otp, payment_timing, payment_method_id } = req.body;

    // Verify OTP
    // Verify code (2FA code if 2FA enabled, otherwise OTP)
    const isValidCode = await verifyPaymentCode(userId, otp, password_verification_token, 'update_auto_pay_preferences');
    if (!isValidCode) {
      return res.status(401).json({ 
        error: 'Invalid or expired code. If using an authenticator app, make sure you\'re using the current code. If the issue persists, try disabling and re-adding 2FA in your security settings.' 
      });
    }

    // Verify user is member of group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, userId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group' });
    }

    // Check that auto-pay is enabled for this group
    const preferenceCheck = await pool.query(
      'SELECT auto_pay_enabled, provider FROM user_payment_preferences WHERE user_id = $1 AND group_id = $2',
      [userId, groupId]
    );

    if (preferenceCheck.rows.length === 0 || !preferenceCheck.rows[0].auto_pay_enabled) {
      return res.status(400).json({
        error: 'Auto-pay is not enabled for this group. Please enable auto-pay first.',
        code: 'AUTO_PAY_NOT_ENABLED',
      });
    }

    const existingPreference = preferenceCheck.rows[0];
    const currentProvider = existingPreference.provider;

    // Get group details to validate currency and provider
    const groupResult = await pool.query(
      'SELECT id, name, currency FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];
    const groupCurrency = group.currency;
    const requiredProvider = paymentService.selectProvider(groupCurrency, null);

    // If updating payment method, validate it
    let providerPaymentMethodId = null;
    if (payment_method_id) {
      // Verify payment method exists and belongs to user
      const paymentMethodCheck = await pool.query(
        `SELECT id, payment_method_id, provider, currency, is_active
         FROM user_payment_methods
         WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
        [payment_method_id, userId]
      );

      if (paymentMethodCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Payment method not found or inactive.',
        });
      }

      const newPaymentMethod = paymentMethodCheck.rows[0];

      // Validate provider match
      if (newPaymentMethod.provider !== requiredProvider) {
        return res.status(400).json({
          error: `Payment method provider (${newPaymentMethod.provider}) does not match group currency provider (${requiredProvider}). Please use a ${requiredProvider} payment method for ${groupCurrency} groups.`,
          groupCurrency: groupCurrency,
          paymentMethodCurrency: newPaymentMethod.currency,
          requiredProvider: requiredProvider,
          paymentMethodProvider: newPaymentMethod.provider,
        });
      }

      // For Paystack, validate currency matches
      if (requiredProvider === 'paystack' && newPaymentMethod.currency && newPaymentMethod.currency !== groupCurrency) {
        return res.status(400).json({
          error: `Payment method currency (${newPaymentMethod.currency}) does not match group currency (${groupCurrency}). Please use a ${groupCurrency} payment method for this group.`,
          groupCurrency: groupCurrency,
          paymentMethodCurrency: newPaymentMethod.currency,
        });
      }

      providerPaymentMethodId = newPaymentMethod.payment_method_id;
    }

    // Check for overdue payments
    const defaulterStatus = await checkDefaulterStatus(userId, groupId);
    if (defaulterStatus.hasOverdue) {
      return res.status(400).json({
        error: 'Please pay all overdue contributions before updating auto-pay preferences',
        overdueAmount: defaulterStatus.totalOverdue,
      });
    }

    // Build update query dynamically based on what's being updated
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (payment_timing !== undefined) {
      updates.push(`payment_timing = $${paramCount++}`);
      values.push(payment_timing);
    }

    if (providerPaymentMethodId !== null) {
      updates.push(`payment_method_id = $${paramCount++}`);
      values.push(providerPaymentMethodId);
      // Also update provider if payment method changed (should match, but ensure consistency)
      if (requiredProvider !== currentProvider) {
        updates.push(`provider = $${paramCount++}`);
        values.push(requiredProvider);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update. Please provide payment_timing and/or payment_method_id.' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId, groupId);

    // Update preference
    await pool.query(
      `UPDATE user_payment_preferences
       SET ${updates.join(', ')}
       WHERE user_id = $${paramCount++} AND group_id = $${paramCount++}`,
      values
    );

    const groupName = group.name;

    // Log action
    const updateMetadata = { groupId, groupName };
    if (payment_timing !== undefined) {
      updateMetadata.paymentTiming = payment_timing;
    }
    if (payment_method_id) {
      updateMetadata.paymentMethodId = payment_method_id;
    }

    await logPaymentAction({
      userId,
      action: 'update_auto_pay_preferences',
      status: 'success',
      metadata: updateMetadata,
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

        const emailMetadata = { groupName };
        if (payment_timing !== undefined) {
          emailMetadata.paymentTiming = payment_timing;
        }
        if (payment_method_id) {
          emailMetadata.paymentMethodChanged = true;
        }

        await sendSecurityEmail(
          userEmail,
          userName,
          'update_auto_pay_preferences',
          `auto-pay preferences were updated for the group "${groupName}"`,
          emailMetadata
        );
      }
    } catch (emailError) {
      console.error('Error sending security email:', emailError);
      // Don't fail the request if email fails
    }

    // Build response message
    const updateMessages = [];
    if (payment_timing !== undefined) {
      updateMessages.push('payment timing');
    }
    if (payment_method_id) {
      updateMessages.push('payment method');
    }
    const message = `${updateMessages.join(' and ')} ${updateMessages.length === 1 ? 'was' : 'were'} updated successfully`;

    // Get updated preference to return
    const updatedPreference = await pool.query(
      `SELECT auto_pay_enabled, payment_timing, payment_method_id, provider
       FROM user_payment_preferences
       WHERE user_id = $1 AND group_id = $2`,
      [userId, groupId]
    );

    const response = {
      message: message.charAt(0).toUpperCase() + message.slice(1),
      group_id: groupId,
    };

    if (payment_timing !== undefined) {
      response.payment_timing = updatedPreference.rows[0]?.payment_timing;
    }

    if (payment_method_id) {
      response.payment_method_id = payment_method_id;
    }

    res.json(response);
  } catch (error) {
    console.error('Update auto-pay preferences error:', error);
    res.status(500).json({ error: error.message || 'Server error updating preferences' });
  }
});

module.exports = router;
