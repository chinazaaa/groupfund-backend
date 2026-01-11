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
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be 3 characters (e.g., USD, NGN)'),
  body('currencies').optional().isArray().withMessage('Currencies must be an array'),
  body('currencies.*').optional().isLength({ min: 3, max: 3 }).withMessage('Each currency must be 3 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password_verification_token, otp, payment_method_data, provider, currency: requestedCurrency, currencies: requestedCurrencies } = req.body;

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
    const paymentMethodId = payment_method_data.payment_method_id || payment_method_data.authorization_code;

    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Payment method ID is required' });
    }

    // Extract card details from payment_method_data for display
    let last4 = payment_method_data.last4 || payment_method_data.last_4 || null;
    let brand = payment_method_data.brand || payment_method_data.card_brand || null;
    let expiryMonth = payment_method_data.expiry_month || payment_method_data.exp_month || null;
    let expiryYear = payment_method_data.expiry_year || payment_method_data.exp_year || null;
    const paymentMethodType = payment_method_data.type || 'card';
    const isDefault = payment_method_data.is_default || false;

    // If card details are missing, try to fetch from provider
    if ((!last4 || !brand) && provider === 'stripe' && paymentService.stripe) {
      try {
        const stripePaymentMethod = await paymentService.stripe.paymentMethods.retrieve(paymentMethodId);
        if (stripePaymentMethod && stripePaymentMethod.card) {
          last4 = last4 || stripePaymentMethod.card.last4 || null;
          brand = brand || stripePaymentMethod.card.brand || null;
          expiryMonth = expiryMonth || stripePaymentMethod.card.exp_month || null;
          expiryYear = expiryYear || stripePaymentMethod.card.exp_year || null;
        }
      } catch (stripeError) {
        console.warn('Could not fetch payment method details from Stripe:', stripeError.message);
        // Continue with whatever was provided or null
      }
    }

    // Warn if critical fields are still missing (but don't fail the request)
    if (!last4) {
      console.warn(`Payment method ${paymentMethodId} added without last4. Frontend should provide this.`);
    }
    if (!brand) {
      console.warn(`Payment method ${paymentMethodId} added without brand. Frontend should provide this.`);
    }

    // Determine currencies to process
    // Support both single currency (backward compatibility) and multiple currencies
    let currencies = [];
    if (requestedCurrencies && Array.isArray(requestedCurrencies) && requestedCurrencies.length > 0) {
      // Use currencies array if provided
      currencies = requestedCurrencies.map(c => c.toUpperCase());
    } else if (requestedCurrency) {
      // Use single currency if provided (backward compatibility)
      currencies = [requestedCurrency.toUpperCase()];
    } else {
      // Default based on provider
      if (provider === 'paystack') {
        currencies = ['NGN'];
      } else {
        currencies = ['USD'];
      }
    }

    // Validate currencies are compatible with provider
    const paystackCurrencies = ['NGN', 'KES', 'GHS', 'ZAR'];
    const invalidCurrencies = [];
    for (const currency of currencies) {
      const currencyProvider = paymentService.selectProvider(currency, null);
      if (currencyProvider !== provider) {
        invalidCurrencies.push(currency);
      }
    }

    if (invalidCurrencies.length > 0) {
      return res.status(400).json({
        error: `The following currencies are not compatible with ${provider}: ${invalidCurrencies.join(', ')}. ${provider === 'paystack' ? 'Paystack supports: NGN, KES, GHS, ZAR' : 'Stripe supports: USD, EUR, GBP, CAD, AUD, JPY, and other international currencies'}.`,
        invalidCurrencies,
        provider,
      });
    }

    // Remove duplicates
    currencies = [...new Set(currencies)];

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // If setting as default, unset other defaults
      if (isDefault) {
        await client.query(
          `UPDATE user_payment_methods 
           SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1`,
          [userId]
        );
      }

      const createdPaymentMethods = [];

      // Create or update payment method for each currency
      for (const currency of currencies) {
        // Check if payment method already exists for this user, provider, and currency
        const existingMethod = await client.query(
          `SELECT id FROM user_payment_methods 
           WHERE user_id = $1 AND payment_method_id = $2 AND currency = $3`,
          [userId, paymentMethodId, currency]
        );

        let savedMethodId;
        if (existingMethod.rows.length > 0) {
          // Update existing method (reactivate if it was soft-deleted)
          await client.query(
            `UPDATE user_payment_methods
             SET provider = $1, payment_method_type = $2, last4 = $3, brand = $4,
                 expiry_month = $5, expiry_year = $6, is_default = $7, is_active = TRUE,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $8`,
            [provider, paymentMethodType, last4, brand, expiryMonth, expiryYear, isDefault, existingMethod.rows[0].id]
          );
          savedMethodId = existingMethod.rows[0].id;
        } else {
          // Create new payment method record for this currency
          const insertResult = await client.query(
            `INSERT INTO user_payment_methods
             (user_id, payment_method_id, provider, payment_method_type, currency, last4, brand, expiry_month, expiry_year, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING id, currency, created_at, updated_at`,
            [userId, paymentMethodId, provider, paymentMethodType, currency, last4, brand, expiryMonth, expiryYear, isDefault]
          );
          savedMethodId = insertResult.rows[0].id;
        }

        // Fetch the created/updated method for response
        const methodResult = await client.query(
          `SELECT id, payment_method_id, provider, payment_method_type, currency, last4, brand,
                  expiry_month, expiry_year, is_default, is_active, created_at, updated_at
           FROM user_payment_methods
           WHERE id = $1`,
          [savedMethodId]
        );

        createdPaymentMethods.push(methodResult.rows[0]);
      }

      await client.query('COMMIT');

      // Log action
      await logPaymentAction({
        userId,
        action: 'add_payment_method',
        status: 'success',
        paymentProvider: provider,
        providerTransactionId: paymentMethodId,
        metadata: { 
          provider, 
          paymentMethodType,
          currencies: currencies.join(','),
          count: createdPaymentMethods.length,
          last4,
          brand,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      // Format response
      const formattedMethods = createdPaymentMethods.map(method => ({
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
        isActive: method.is_active,
        createdAt: method.created_at,
        updatedAt: method.updated_at,
      }));

      res.json({
        message: `Payment method added successfully for ${currencies.length} ${currencies.length === 1 ? 'currency' : 'currencies'}`,
        paymentMethod: formattedMethods[0], // First method for backward compatibility
        paymentMethods: formattedMethods, // All methods
        customerId,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

// Get user's saved payment methods (optionally filtered by currency)
router.get('/methods', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency } = req.query; // Optional: filter by currency

    // Build query with optional currency filter
    let query = `
      SELECT id, payment_method_id, provider, payment_method_type, currency, last4, brand,
             expiry_month, expiry_year, is_default, is_active, created_at, updated_at
      FROM user_payment_methods
      WHERE user_id = $1 AND is_active = TRUE
    `;
    const params = [userId];

    if (currency) {
      // Filter by currency and provider
      // For Paystack: currency must match exactly
      // For Stripe: cards can charge in multiple currencies, but we prefer matching currency
      const currencyUpper = currency.toUpperCase();
      const provider = paymentService.selectProvider(currencyUpper, null);
      
      query += ` AND provider = $2`;
      params.push(provider);
      
      // For Paystack, also require currency match
      if (provider === 'paystack') {
        query += ` AND (currency = $3 OR currency IS NULL)`;
        params.push(currencyUpper);
      } else {
        // For Stripe, prefer matching currency but allow others
        query += ` AND (currency = $3 OR currency IS NULL OR currency != $3)`;
        params.push(currencyUpper);
      }
    }

    query += ` ORDER BY is_default DESC, created_at DESC`;

    const result = await pool.query(query, params);

    // Get groups that use each payment method (from user_payment_preferences)
    const paymentMethods = await Promise.all(
      result.rows.map(async (method) => {
        const groupsResult = await pool.query(
          `SELECT upp.group_id, upp.auto_pay_enabled, upp.payment_timing,
                  g.name as group_name, g.currency
           FROM user_payment_preferences upp
           LEFT JOIN groups g ON upp.group_id = g.id
           WHERE upp.user_id = $1 AND upp.payment_method_id = $2`,
          [userId, method.payment_method_id]
        );

        // Handle null values - return null instead of undefined
        const last4Value = method.last4 || null;
        const brandValue = method.brand || null;

        return {
          id: method.id,
          paymentMethodId: method.payment_method_id,
          provider: method.provider,
          paymentMethodType: method.payment_method_type,
          currency: method.currency,
          last4: last4Value, // camelCase (primary) - null if not available
          last_4_digits: last4Value, // snake_case (alias for compatibility) - null if not available
          brand: brandValue, // null if not available
          expiryMonth: method.expiry_month,
          expiryYear: method.expiry_year,
          isDefault: method.is_default,
          isActive: method.is_active,
          createdAt: method.created_at,
          updatedAt: method.updated_at,
          groups: groupsResult.rows.map(g => ({
            groupId: g.group_id,
            groupName: g.group_name,
            currency: g.currency,
            autoPayEnabled: g.auto_pay_enabled,
            paymentTiming: g.payment_timing,
          })),
        };
      })
    );

    res.json({
      paymentMethods,
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

// Update payment method (e.g., set as default, update card details)
router.put('/methods/:methodId', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('is_default').optional().isBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { methodId } = req.params;
    const { password_verification_token, otp, is_default } = req.body;

    // Verify OTP
    const isOTPValid = await verifyPaymentOTP(userId, otp, password_verification_token, 'edit_payment_method');
    if (!isOTPValid) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Check if payment method belongs to user
    const methodCheck = await pool.query(
      'SELECT id, payment_method_id, provider FROM user_payment_methods WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
      [methodId, userId]
    );

    if (methodCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    await pool.query('BEGIN');

    try {
      // If setting as default, unset other defaults
      if (is_default === true) {
        await pool.query(
          `UPDATE user_payment_methods 
           SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND id != $2`,
          [userId, methodId]
        );
      }

      // Update payment method
      const updates = [];
      const values = [];
      let paramCount = 1;

      if (is_default !== undefined) {
        updates.push(`is_default = $${paramCount++}`);
        values.push(is_default);
      }

      if (updates.length > 0) {
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(methodId);
        await pool.query(
          `UPDATE user_payment_methods SET ${updates.join(', ')} WHERE id = $${paramCount}`,
          values
        );
      }

      await pool.query('COMMIT');

      // Log action
      await logPaymentAction({
        userId,
        action: 'edit_payment_method',
        status: 'success',
        metadata: { methodId, is_default },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        message: 'Payment method updated successfully',
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
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

    // Check if payment method exists and belongs to user
    const methodCheck = await pool.query(
      'SELECT id, payment_method_id FROM user_payment_methods WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
      [methodId, userId]
    );

    if (methodCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    const providerPaymentMethodId = methodCheck.rows[0].payment_method_id;

    // Check if payment method is used for auto-pay
    const autoPayCheck = await pool.query(
      `SELECT id, group_id FROM user_payment_preferences
       WHERE user_id = $1 AND payment_method_id = $2 AND auto_pay_enabled = TRUE`,
      [userId, providerPaymentMethodId]
    );

    await pool.query('BEGIN');

    try {
      // Auto-disable auto-pay for all groups using this card
      if (autoPayCheck.rows.length > 0) {
        await pool.query(
          `UPDATE user_payment_preferences
           SET auto_pay_enabled = FALSE, payment_method_id = NULL
           WHERE user_id = $1 AND payment_method_id = $2`,
          [userId, providerPaymentMethodId]
        );
      }

      // Remove payment method from preferences
      await pool.query(
        `UPDATE user_payment_preferences
         SET payment_method_id = NULL
         WHERE user_id = $1 AND payment_method_id = $2`,
        [userId, providerPaymentMethodId]
      );

      // Soft delete payment method (set is_active = FALSE)
      await pool.query(
        `UPDATE user_payment_methods
         SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [methodId]
      );

      await pool.query('COMMIT');

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
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({ error: error.message || 'Server error deleting payment method' });
  }
});

module.exports = router;
