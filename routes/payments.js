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
  body('action').optional().isIn(['add-payment-method', 'edit-payment-method', 'update-payment-method', 'delete-payment-method', 'update-currencies']).withMessage('Invalid action. Must be one of: add-payment-method, edit-payment-method, update-payment-method, delete-payment-method, update-currencies'),
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

    // Map action to internal action name
    // Note: 'update-payment-method' is an alias for 'edit-payment-method' for backward compatibility
    const actionMap = {
      'add-payment-method': 'add_payment_method',
      'edit-payment-method': 'edit_payment_method',
      'update-payment-method': 'edit_payment_method', // Alias for edit-payment-method
      'delete-payment-method': 'delete_payment_method',
      'update-currencies': 'update_payment_method_currencies',
    };

    const internalAction = actionMap[action] || 'add_payment_method';

    // Request OTP
    await requestPaymentOTP(userId, email, internalAction, password_verification_token);

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
  body('provider').optional().isIn(['stripe']).withMessage('Provider must be stripe (Paystack is no longer supported)'),
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be 3 characters (e.g., USD, NGN)'),
  body('currencies').optional().isArray().withMessage('Currencies must be an array'),
  body('currencies.*').optional().isLength({ min: 3, max: 3 }).withMessage('Each currency must be 3 characters'),
  body('payment_method_data').optional().notEmpty().withMessage('Payment method data is required for Stripe'),
  body('transaction_reference').optional().notEmpty().withMessage('Transaction reference is required for Paystack'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password_verification_token, otp, payment_method_data, transaction_reference, provider, currency: requestedCurrency, currencies: requestedCurrencies } = req.body;

    // Default to Stripe if no provider specified
    if (!provider) {
      provider = 'stripe';
    }
    
    // Only Stripe is supported now
    if (provider !== 'stripe') {
      return res.status(400).json({ error: 'Only Stripe is supported. Please use provider: "stripe"' });
    }
    
    // Provider-specific validation
    if (provider === 'stripe' && !payment_method_data) {
      return res.status(400).json({ error: 'Payment method data is required for Stripe' });
    }

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

    // Handle different flows for Stripe vs Paystack
    let paymentMethodId;
    let last4;
    let brand;
    let expiryMonth;
    let expiryYear;
    let paymentMethodType = 'card';
    let isDefault = false;
    let verificationTransactionId = null;
    let verificationAmount = null;
    let transactionCurrency = null;

    if (provider === 'paystack') {
      // For Paystack: Verify transaction and extract card details
      if (!transaction_reference) {
        return res.status(400).json({ error: 'Transaction reference is required for Paystack' });
      }

      console.log(`🔍 Verifying Paystack transaction: ${transaction_reference}`);
      
      const verificationResult = await paymentService.verifyPaystackTransaction(transaction_reference);
      
      if (!verificationResult.success) {
        return res.status(400).json({
          error: verificationResult.error || 'Failed to verify Paystack transaction',
        });
      }

      // Extract payment method details from verification
      paymentMethodId = verificationResult.authorizationCode;
      last4 = verificationResult.cardDetails.last4;
      brand = verificationResult.cardDetails.brand;
      expiryMonth = verificationResult.cardDetails.expiryMonth;
      expiryYear = verificationResult.cardDetails.expiryYear;
      verificationTransactionId = verificationResult.transactionReference;
      verificationAmount = verificationResult.amount;
      transactionCurrency = verificationResult.currency;

      // Extract is_default from request body if provided (Paystack doesn't provide this)
      if (req.body.is_default !== undefined) {
        isDefault = req.body.is_default === true;
      }

      console.log(`✅ Verified Paystack transaction. Authorization code: ${paymentMethodId}, Last4: ${last4}, Brand: ${brand}`);
      
    } else if (provider === 'stripe') {
      // For Stripe: Use payment_method_data from frontend
      if (!payment_method_data) {
        return res.status(400).json({ error: 'Payment method data is required for Stripe' });
      }

      paymentMethodId = payment_method_data.payment_method_id;

      if (!paymentMethodId) {
        return res.status(400).json({ error: 'Payment method ID is required' });
      }

      // Extract card details from payment_method_data
      last4 = payment_method_data.last4 || payment_method_data.last_4 || null;
      brand = payment_method_data.brand || null;
      expiryMonth = payment_method_data.expiry_month || payment_method_data.exp_month || null;
      expiryYear = payment_method_data.expiry_year || payment_method_data.exp_year || null;
      paymentMethodType = payment_method_data.type || 'card';
      isDefault = payment_method_data.is_default || false;

      // If card details are missing, try to fetch from Stripe
      // Also check card funding type (debit vs credit)
      let cardFunding = null;
      if (paymentService.stripe) {
        try {
          const stripePaymentMethod = await paymentService.stripe.paymentMethods.retrieve(paymentMethodId);
          if (stripePaymentMethod && stripePaymentMethod.card) {
            last4 = last4 || stripePaymentMethod.card.last4 || null;
            brand = brand || stripePaymentMethod.card.brand || null;
            expiryMonth = expiryMonth || stripePaymentMethod.card.exp_month || null;
            expiryYear = expiryYear || stripePaymentMethod.card.exp_year || null;
            cardFunding = stripePaymentMethod.card.funding || null;
          }
        } catch (stripeError) {
          console.warn('Could not fetch payment method details from Stripe:', stripeError.message);
          // Continue with whatever was provided or null
        }
      }

      // Validate card funding type - only allow debit cards (except in test mode)
      // Allow credit cards in test mode for testing with Stripe test cards
      const isTestMode = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_');
      
      if (cardFunding && !isTestMode) {
        if (cardFunding === 'credit') {
          return res.status(400).json({
            error: 'Credit cards are not accepted. Please use a debit card.',
            cardFunding,
          });
        }
        if (cardFunding === 'prepaid') {
          return res.status(400).json({
            error: 'Prepaid cards are not accepted. Please use a debit card.',
            cardFunding,
          });
        }
        if (cardFunding !== 'debit' && cardFunding !== 'unknown') {
          // Allow 'unknown' as some cards may not have funding type available
          return res.status(400).json({
            error: 'Only debit cards are accepted.',
            cardFunding,
          });
        }
      } else if (cardFunding === 'credit' && isTestMode) {
        // Log that credit card is allowed in test mode
        console.log(`⚠️  Credit card accepted in test mode: ${paymentMethodId}`);
      } else if (!cardFunding) {
        // If funding type is not available, log a warning but allow it
        // (Some cards may not have funding type available immediately)
        console.warn(`Payment method ${paymentMethodId} added without funding type. Card will be accepted but funding type should be verified.`);
      }

      // Warn if critical fields are still missing (but don't fail the request)
      if (!last4) {
        console.warn(`Payment method ${paymentMethodId} added without last4. Frontend should provide this.`);
      }
      if (!brand) {
        console.warn(`Payment method ${paymentMethodId} added without brand. Frontend should provide this.`);
      }
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
      // Default to USD for Stripe (can be changed to any supported currency)
      currencies = ['USD'];
    }

    // Validate currencies are compatible with provider (Stripe supports most currencies)
    // Note: Stripe supports NGN for accepting payments from Nigerian customers (if merchant is US-based)
    // All currencies will use Stripe now
    const invalidCurrencies = [];
    for (const currency of currencies) {
      const currencyProvider = paymentService.selectProvider(currency, null);
      if (currencyProvider !== provider) {
        invalidCurrencies.push(currency);
      }
    }

    if (invalidCurrencies.length > 0) {
      return res.status(400).json({
        error: `The following currencies are not compatible with ${provider}: ${invalidCurrencies.join(', ')}. Stripe supports most international currencies including USD, EUR, GBP, NGN, CAD, AUD, JPY, etc.`,
        invalidCurrencies,
        provider,
      });
    }

    // Remove duplicates
    currencies = [...new Set(currencies)];

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const createdPaymentMethods = [];

      // Create or update payment method for each currency
      for (const currency of currencies) {
        // If setting as default, unset other defaults for this currency and provider
        // This ensures only one default payment method per currency per provider
        if (isDefault) {
          await client.query(
            `UPDATE user_payment_methods 
             SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND currency = $2 AND provider = $3 
             AND payment_method_id != $4 AND is_default = TRUE`,
            [userId, currency, provider, paymentMethodId]
          );
        }
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

      // Auto-refund Paystack verification charges
      // For Paystack, we always refund the verification charge after saving the payment method
      let refundResult = null;
      
      if (provider === 'paystack' && verificationTransactionId && verificationAmount) {
        try {
          console.log(`🔄 Auto-refunding Paystack verification charge: ${verificationTransactionId} (${verificationAmount} ${currencies[0]})`);
          
          refundResult = await paymentService.refundTransaction({
            transactionId: verificationTransactionId,
            amount: verificationAmount,
            currency: currencies[0],
          }, 'paystack');

          if (refundResult.success) {
            console.log(`✅ Successfully refunded verification charge: ${refundResult.refundId}`);
            
            // Log refund action
            await logPaymentAction({
              userId,
              action: 'refund_verification_charge',
              status: 'success',
              paymentProvider: provider,
              providerTransactionId: verificationTransactionId,
              metadata: {
                refundId: refundResult.refundId,
                amount: verificationAmount,
                currency: currencies[0],
                paymentMethodId: paymentMethodId,
              },
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
            });
          } else {
            console.error(`❌ Failed to refund verification charge: ${refundResult.error}`);
            
            // Log failed refund (but don't fail the payment method save)
            await logPaymentAction({
              userId,
              action: 'refund_verification_charge',
              status: 'failed',
              paymentProvider: provider,
              providerTransactionId: verificationTransactionId,
              metadata: {
                error: refundResult.error,
                amount: verificationAmount,
                currency: currencies[0],
                paymentMethodId: paymentMethodId,
              },
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
            });
          }
        } catch (refundError) {
          // Log error but don't fail the payment method save
          console.error('❌ Error during automatic refund of verification charge:', refundError);
          refundResult = {
            success: false,
            error: refundError.message || 'Refund processing failed',
          };
          // Payment method is already saved, so we just log the error
        }
      }

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
          verificationRefunded: refundResult ? (refundResult.success ? 'success' : 'failed') : 'not_applicable',
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

      // Build response
      const response = {
        message: `Payment method added successfully for ${currencies.length} ${currencies.length === 1 ? 'currency' : 'currencies'}`,
        paymentMethod: formattedMethods[0], // First method for backward compatibility
        paymentMethods: formattedMethods, // All methods
        customerId,
      };

      // Add refund info if applicable (for Paystack verification charges)
      if (refundResult !== null) {
        response.verificationRefund = {
          success: refundResult.success,
          status: refundResult.success ? 'refunded' : 'failed',
          refundId: refundResult.refundId || null,
          error: refundResult.error || null,
          note: refundResult.success 
            ? 'Verification charge has been automatically refunded'
            : `Refund failed: ${refundResult.error || 'Unknown error'}. Please contact support.`,
        };
      }

      res.json(response);
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

    // Cleanup: Ensure only one default per currency per provider
    // If multiple cards are default for the same currency, keep only the most recently created one
    const currencyDefaults = {};
    for (const method of result.rows) {
      if (method.is_default) {
        const key = `${method.currency}_${method.provider}`;
        if (!currencyDefaults[key]) {
          currencyDefaults[key] = [];
        }
        currencyDefaults[key].push(method);
      }
    }

    // Fix any duplicates: keep the most recently created default, unset others
    for (const [key, methods] of Object.entries(currencyDefaults)) {
      if (methods.length > 1) {
        // Sort by created_at DESC to get the most recent
        methods.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        // Keep the first (most recent), unset the rest
        const toUnset = methods.slice(1);
        for (const method of toUnset) {
          await pool.query(
            `UPDATE user_payment_methods 
             SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [method.id]
          );
          // Update the result array to reflect the change
          const methodIndex = result.rows.findIndex(m => m.id === method.id);
          if (methodIndex !== -1) {
            result.rows[methodIndex].is_default = false;
          }
        }
      }
    }

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

// Verify password before bulk updating currencies
// IMPORTANT: This must come BEFORE /methods/:methodId to avoid route matching conflicts
router.post('/methods/bulk-update-currencies/verify-password', authenticate, contributionLimiter, [
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
    const token = generatePasswordVerificationToken(userId, 'update_payment_method_currencies');

    // Store token in database
    await storePasswordVerificationToken(userId, token, 'update_payment_method_currencies');

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

// Bulk update currencies for a payment method (add/remove currencies)
// IMPORTANT: This must come BEFORE /methods/:methodId to avoid route matching conflicts
router.put('/methods/bulk-update-currencies', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('payment_method_id').notEmpty().withMessage('Payment method ID is required'),
  body('currencies').isArray({ min: 0 }).withMessage('Currencies must be an array'),
  body('currencies.*').isLength({ min: 3, max: 3 }).withMessage('Each currency must be 3 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password_verification_token, otp, payment_method_id, currencies: requestedCurrencies } = req.body;

    // Verify OTP
    const isOTPValid = await verifyPaymentOTP(userId, otp, password_verification_token, 'update_payment_method_currencies');
    if (!isOTPValid) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Get existing payment method entries for this payment_method_id
    const existingMethods = await pool.query(
      `SELECT id, currency, provider, last4, brand, expiry_month, expiry_year, is_default
       FROM user_payment_methods
       WHERE user_id = $1 AND payment_method_id = $2 AND is_active = TRUE`,
      [userId, payment_method_id]
    );

    if (existingMethods.rows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    const existingMethod = existingMethods.rows[0]; // Use first entry to get provider info
    const provider = existingMethod.provider;

    // Normalize requested currencies
    const requestedCurrenciesUpper = [...new Set(requestedCurrencies.map(c => c.toUpperCase()))];

    // Validate all currencies are compatible with provider
    const paystackCurrencies = ['NGN', 'KES', 'GHS', 'ZAR'];
    const invalidCurrencies = [];
    for (const currency of requestedCurrenciesUpper) {
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

    // Get existing currencies
    const existingCurrencies = existingMethods.rows.map(m => m.currency);
    
    // Determine what to add and what to remove
    const currenciesToAdd = requestedCurrenciesUpper.filter(c => !existingCurrencies.includes(c));
    const currenciesToRemove = existingCurrencies.filter(c => !requestedCurrenciesUpper.includes(c));

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Remove currencies (soft delete)
      if (currenciesToRemove.length > 0) {
        const methodsToRemove = existingMethods.rows.filter(m => currenciesToRemove.includes(m.currency));
        
        for (const methodToRemove of methodsToRemove) {
          // Check if this payment method is used for auto-pay in groups with this currency
          const affectedGroups = await client.query(
            `SELECT upp.group_id, g.name as group_name, g.currency
             FROM user_payment_preferences upp
             JOIN groups g ON upp.group_id = g.id
             WHERE upp.user_id = $1 AND upp.payment_method_id = $2 AND upp.auto_pay_enabled = TRUE AND g.currency = $3`,
            [userId, payment_method_id, methodToRemove.currency]
          );

          // Soft delete the entry
          await client.query(
            `UPDATE user_payment_methods
             SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [methodToRemove.id]
          );

          // If it was used for auto-pay in groups with this currency, disable auto-pay for those groups
          if (affectedGroups.rows.length > 0) {
            await client.query(
              `UPDATE user_payment_preferences
               SET auto_pay_enabled = FALSE, payment_method_id = NULL
               WHERE user_id = $1 AND payment_method_id = $2 AND group_id = ANY($3::uuid[])`,
              [userId, payment_method_id, affectedGroups.rows.map(g => g.group_id)]
            );
          }
        }
      }

      // Add new currencies (create new entries)
      if (currenciesToAdd.length > 0) {
        for (const currency of currenciesToAdd) {
          // Use display details from existing entry
          await client.query(
            `INSERT INTO user_payment_methods
             (user_id, payment_method_id, provider, payment_method_type, currency, last4, brand, expiry_month, expiry_year, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              userId,
              payment_method_id,
              provider,
              'card',
              currency,
              existingMethod.last4,
              existingMethod.brand,
              existingMethod.expiry_month,
              existingMethod.expiry_year,
              false, // New entries are not default
            ]
          );
        }
      }

      await client.query('COMMIT');

      // Fetch all active entries for this payment method
      const updatedMethods = await client.query(
        `SELECT id, payment_method_id, provider, payment_method_type, currency, last4, brand,
                expiry_month, expiry_year, is_default, is_active, created_at, updated_at
         FROM user_payment_methods
         WHERE user_id = $1 AND payment_method_id = $2 AND is_active = TRUE
         ORDER BY currency`,
        [userId, payment_method_id]
      );

      // Log action
      await logPaymentAction({
        userId,
        action: 'update_payment_method_currencies',
        status: 'success',
        paymentProvider: provider,
        providerTransactionId: payment_method_id,
        metadata: {
          added: currenciesToAdd,
          removed: currenciesToRemove,
          finalCurrencies: requestedCurrenciesUpper,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        message: `Payment method currencies updated successfully. ${currenciesToAdd.length > 0 ? `Added: ${currenciesToAdd.join(', ')}. ` : ''}${currenciesToRemove.length > 0 ? `Removed: ${currenciesToRemove.join(', ')}.` : ''}`,
        added: currenciesToAdd,
        removed: currenciesToRemove,
        paymentMethods: updatedMethods.rows.map(method => ({
          id: method.id,
          paymentMethodId: method.payment_method_id,
          provider: method.provider,
          paymentMethodType: method.payment_method_type,
          currency: method.currency,
          last4: method.last4,
          last_4_digits: method.last4,
          brand: method.brand,
          expiryMonth: method.expiry_month,
          expiryYear: method.expiry_year,
          isDefault: method.is_default,
          isActive: method.is_active,
          createdAt: method.created_at,
          updatedAt: method.updated_at,
        })),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Bulk update payment method currencies error:', error);
    res.status(500).json({ error: error.message || 'Server error updating payment method currencies' });
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

// Update payment method (e.g., set as default, update card details, change currency)
router.put('/methods/:methodId', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('is_default').optional().isBoolean(),
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be 3 characters (e.g., USD, NGN)'),
  body('last4').optional().isLength({ min: 4, max: 4 }).withMessage('last4 must be exactly 4 digits'),
  body('brand').optional().isString().withMessage('brand must be a string'),
  body('expiry_month').optional().isInt({ min: 1, max: 12 }).withMessage('expiry_month must be between 1 and 12'),
  body('expiry_year').optional().isInt({ min: 2000, max: 2100 }).withMessage('expiry_year must be a valid year'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { methodId } = req.params;
    const { password_verification_token, otp, is_default, currency: newCurrency, last4, brand, expiry_month, expiry_year } = req.body;

    // Verify OTP
    const isOTPValid = await verifyPaymentOTP(userId, otp, password_verification_token, 'edit_payment_method');
    if (!isOTPValid) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Check if payment method belongs to user
    const methodCheck = await pool.query(
      `SELECT id, payment_method_id, provider, currency, last4, brand, expiry_month, expiry_year
       FROM user_payment_methods 
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
      [methodId, userId]
    );

    if (methodCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    const currentMethod = methodCheck.rows[0];

    // Validate currency change if provided
    if (newCurrency !== undefined) {
      const newCurrencyUpper = newCurrency.toUpperCase();
      
      // Check if currency is compatible with provider
      const currencyProvider = paymentService.selectProvider(newCurrencyUpper, null);
      if (currencyProvider !== currentMethod.provider) {
        return res.status(400).json({
          error: `Currency ${newCurrencyUpper} is not compatible with ${currentMethod.provider}. ${currentMethod.provider === 'paystack' ? 'Paystack supports: NGN, KES, GHS, ZAR' : 'Stripe supports: USD, EUR, GBP, CAD, AUD, JPY, and other international currencies'}.`,
          currentProvider: currentMethod.provider,
          requestedCurrency: newCurrencyUpper,
        });
      }

      // Check if payment method entry with new currency already exists
      const existingEntry = await pool.query(
        `SELECT id FROM user_payment_methods 
         WHERE user_id = $1 AND payment_method_id = $2 AND currency = $3 AND id != $4 AND is_active = TRUE`,
        [userId, currentMethod.payment_method_id, newCurrencyUpper, methodId]
      );

      if (existingEntry.rows.length > 0) {
        return res.status(400).json({
          error: `A payment method entry with currency ${newCurrencyUpper} already exists for this card. Each currency requires a separate entry.`,
          existingEntryId: existingEntry.rows[0].id,
        });
      }

      // Check if this payment method is used for auto-pay in groups with the old currency
      const autoPayCheck = await pool.query(
        `SELECT upp.group_id, g.name as group_name, g.currency
         FROM user_payment_preferences upp
         JOIN groups g ON upp.group_id = g.id
         WHERE upp.user_id = $1 AND upp.payment_method_id = $2 AND upp.auto_pay_enabled = TRUE AND g.currency = $3`,
        [userId, currentMethod.payment_method_id, currentMethod.currency]
      );

      if (autoPayCheck.rows.length > 0) {
        // Warn but don't block - user can update currency, but auto-pay will need to be reconfigured
        console.warn(`Currency change for payment method ${methodId} will affect auto-pay in ${autoPayCheck.rows.length} group(s)`);
      }
    }

    await pool.query('BEGIN');

    try {
      // If setting as default, mark ALL currency entries for this card as default
      // This ensures the card is default for all currencies it supports
      // NOTE: Setting a card as default does NOT change existing auto-pay preferences.
      // Auto-pay preferences are only updated when explicitly changed via the preferences endpoint
      // or when a payment method is deleted/currencies are removed.
      if (is_default === true) {
        // Get all currency entries for this payment method (same payment_method_id)
        const allCardEntries = await pool.query(
          `SELECT currency FROM user_payment_methods
           WHERE user_id = $1 AND payment_method_id = $2 AND is_active = TRUE`,
          [userId, currentMethod.payment_method_id]
        );

        // For each currency this card supports, unset other defaults
        // IMPORTANT: Unset ALL other cards' defaults for these currencies, not just for this provider
        // This ensures only one card is default per currency across all providers
        for (const entry of allCardEntries.rows) {
          await pool.query(
            `UPDATE user_payment_methods 
             SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND currency = $2 AND provider = $3 
             AND payment_method_id != $4 AND is_default = TRUE`,
            [userId, entry.currency, currentMethod.provider, currentMethod.payment_method_id]
          );
        }

        // Set ALL entries for this card as default
        await pool.query(
          `UPDATE user_payment_methods 
           SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND payment_method_id = $2 AND is_active = TRUE`,
          [userId, currentMethod.payment_method_id]
        );
      } else if (is_default === false) {
        // If unsetting default, unset for ALL currency entries of this card
        await pool.query(
          `UPDATE user_payment_methods 
           SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND payment_method_id = $2 AND is_active = TRUE`,
          [userId, currentMethod.payment_method_id]
        );
      }

      // Update payment method
      const updates = [];
      const values = [];
      let paramCount = 1;

      // Update currency (if provided and different)
      if (newCurrency !== undefined) {
        const newCurrencyUpper = newCurrency.toUpperCase();
        if (newCurrencyUpper !== currentMethod.currency) {
          updates.push(`currency = $${paramCount++}`);
          values.push(newCurrencyUpper);
        }
      }

      // Note: is_default is handled above for ALL entries of this card
      // We don't need to update it here for the single entry since we've already
      // updated all entries for this payment_method_id

      // Update display details (only if provided and different from current)
      if (last4 !== undefined && last4 !== currentMethod.last4) {
        updates.push(`last4 = $${paramCount++}`);
        values.push(last4);
      }

      if (brand !== undefined && brand !== currentMethod.brand) {
        updates.push(`brand = $${paramCount++}`);
        values.push(brand);
      }

      if (expiry_month !== undefined && expiry_month !== currentMethod.expiry_month) {
        updates.push(`expiry_month = $${paramCount++}`);
        values.push(expiry_month);
      }

      if (expiry_year !== undefined && expiry_year !== currentMethod.expiry_year) {
        updates.push(`expiry_year = $${paramCount++}`);
        values.push(expiry_year);
      }

      // If is_default was the only update, we've already handled it above
      // Otherwise, update the specific entry with other fields
      if (updates.length > 0) {
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(methodId);
        await pool.query(
          `UPDATE user_payment_methods SET ${updates.join(', ')} WHERE id = $${paramCount}`,
          values
        );
      } else if (is_default === undefined) {
        // No updates provided and is_default wasn't set
        await pool.query('ROLLBACK');
        return res.status(400).json({ 
          error: 'No valid fields to update. Provide at least one of: currency, is_default, last4, brand, expiry_month, expiry_year' 
        });
      }
      // If only is_default was provided, we've already updated all entries above, so no need to update the single entry

      await pool.query('COMMIT');

      // Fetch updated method for response
      const updatedMethod = await pool.query(
        `SELECT id, payment_method_id, provider, payment_method_type, currency, last4, brand,
                expiry_month, expiry_year, is_default, is_active, created_at, updated_at
         FROM user_payment_methods
         WHERE id = $1`,
        [methodId]
      );

      // Log action
      await logPaymentAction({
        userId,
        action: 'edit_payment_method',
        status: 'success',
        metadata: { 
          methodId, 
          oldCurrency: currentMethod.currency,
          newCurrency: newCurrency !== undefined ? newCurrency.toUpperCase() : currentMethod.currency,
          updatedFields: {
            currency: newCurrency !== undefined && newCurrency.toUpperCase() !== currentMethod.currency ? newCurrency.toUpperCase() : undefined,
            is_default: is_default !== undefined ? is_default : undefined,
            last4: last4 !== undefined ? 'updated' : undefined,
            brand: brand !== undefined ? 'updated' : undefined,
            expiry_month: expiry_month !== undefined ? expiry_month : undefined,
            expiry_year: expiry_year !== undefined ? expiry_year : undefined,
          }
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      const method = updatedMethod.rows[0];
      res.json({
        message: 'Payment method updated successfully',
        paymentMethod: {
          id: method.id,
          paymentMethodId: method.payment_method_id,
          provider: method.provider,
          paymentMethodType: method.payment_method_type,
          currency: method.currency,
          last4: method.last4,
          last_4_digits: method.last4,
          brand: method.brand,
          expiryMonth: method.expiry_month,
          expiryYear: method.expiry_year,
          isDefault: method.is_default,
          isActive: method.is_active,
          createdAt: method.created_at,
          updatedAt: method.updated_at,
        },
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

    // Get all currency entries for this card (same payment_method_id)
    // This ensures we delete the entire card, not just one currency entry
    const allCardEntries = await pool.query(
      `SELECT id, currency FROM user_payment_methods
       WHERE user_id = $1 AND payment_method_id = $2 AND is_active = TRUE`,
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

      // Soft delete ALL currency entries for this card (entire card deletion)
      // This ensures the entire card is removed, not just one currency entry
      await pool.query(
        `UPDATE user_payment_methods
         SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND payment_method_id = $2 AND is_active = TRUE`,
        [userId, providerPaymentMethodId]
      );

      await pool.query('COMMIT');

      // Notify user if auto-pay was disabled
      if (autoPayCheck.rows.length > 0) {
        const { createNotification } = require('../utils/notifications');
        const { sendAutoPayDisabledEmail } = require('../utils/email');

        // Get group names for notification
        const groupNamesResult = await pool.query(
          `SELECT id, name FROM groups WHERE id = ANY($1::uuid[])`,
          [autoPayCheck.rows.map(r => r.group_id)]
        );

        const groupNames = groupNamesResult.rows.map(g => g.name).join(', ');

        // Send in-app notification
        try {
          await createNotification(
            userId,
            'auto_pay_disabled_card_deleted',
            'Auto-Pay Disabled',
            `Auto-pay has been disabled for ${autoPayCheck.rows.length} group(s) because the payment method was removed. Please add a new payment method and re-enable auto-pay.`,
            null, // No specific group_id since multiple groups affected
            null
          );
        } catch (notifError) {
          console.error('Error creating notification:', notifError);
        }

        // Send email notification for each affected group
        try {
          const userResult = await pool.query(
            'SELECT email, name FROM users WHERE id = $1',
            [userId]
          );

          if (userResult.rows.length > 0 && userResult.rows[0].email) {
            // Send email for each group
            for (const groupInfo of groupNamesResult.rows) {
              await sendAutoPayDisabledEmail(
                userResult.rows[0].email,
                userResult.rows[0].name,
                groupInfo.name,
                'Payment method was removed'
              );
            }
          }
        } catch (emailError) {
          console.error('Error sending auto-pay disabled email:', emailError);
          // Don't fail the request if email fails
        }
      }

      // Log action
      await logPaymentAction({
        userId,
        action: 'delete_payment_method',
        status: 'success',
        metadata: { 
          methodId, 
          payment_method_id: providerPaymentMethodId,
          deletedEntries: allCardEntries.rows.length,
          currencies: allCardEntries.rows.map(e => e.currency),
          autoPayDisabled: autoPayCheck.rows.length > 0 
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        message: `Payment method removed successfully${allCardEntries.rows.length > 1 ? ` (${allCardEntries.rows.length} currency entries deleted)` : ''}`,
        autoPayDisabled: autoPayCheck.rows.length > 0,
        affectedGroups: autoPayCheck.rows.map(r => r.group_id),
        deletedCurrencies: allCardEntries.rows.map(e => e.currency),
        deletedEntriesCount: allCardEntries.rows.length,
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
