const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { require2FA } = require('../middleware/require2FA');
const { otpLimiter, contributionLimiter } = require('../middleware/rateLimiter');
const {
  verifyPassword,
  generatePasswordVerificationToken,
  verifyPasswordVerificationToken,
  storePasswordVerificationToken,
  requestPaymentOTP,
  verifyPaymentOTP,
  verifyPaymentCode,
  logPaymentAction,
} = require('../utils/paymentHelpers');
const { sendSecurityEmail } = require('../utils/email');

const router = express.Router();

// Get all bank accounts (grouped by currency)
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT id, currency, account_name, bank_name, account_number, iban, swift_bic,
              routing_number, sort_code, branch_code, branch_address, bank_code, is_default,
              created_at, updated_at
       FROM wallet_bank_accounts
       WHERE user_id = $1
       ORDER BY currency, is_default DESC, created_at DESC`,
      [userId]
    );

    // Group by currency
    const accountsByCurrency = {};
    for (const account of result.rows) {
      if (!accountsByCurrency[account.currency]) {
        accountsByCurrency[account.currency] = [];
      }
      accountsByCurrency[account.currency].push({
        id: account.id,
        account_name: account.account_name,
        bank_name: account.bank_name,
        account_number: account.account_number ? `****${account.account_number.slice(-4)}` : null, // Mask for security
        iban: account.iban,
        swift_bic: account.swift_bic,
        routing_number: account.routing_number,
        sort_code: account.sort_code,
        branch_code: account.branch_code,
        branch_address: account.branch_address,
        bank_code: account.bank_code,
        is_default: account.is_default,
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      });
    }

    res.json({
      bankAccounts: accountsByCurrency,
      currencies: Object.keys(accountsByCurrency),
    });
  } catch (error) {
    console.error('Get bank accounts error:', error);
    res.status(500).json({ error: 'Server error retrieving bank accounts' });
  }
});

// Get bank account for a specific currency
router.get('/:currency', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency } = req.params;

    // Get default account for currency, or any account if no default
    const result = await pool.query(
      `SELECT id, currency, account_name, bank_name, account_number, iban, swift_bic,
              routing_number, sort_code, branch_code, branch_address, bank_code, is_default,
              created_at, updated_at
       FROM wallet_bank_accounts
       WHERE user_id = $1 AND currency = $2
       ORDER BY is_default DESC, created_at DESC
       LIMIT 1`,
      [userId, currency.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `No bank account found for ${currency}` });
    }

    const account = result.rows[0];
    res.json({
      bankAccount: {
        id: account.id,
        currency: account.currency,
        account_name: account.account_name,
        bank_name: account.bank_name,
        account_number: account.account_number ? `****${account.account_number.slice(-4)}` : null, // Mask for security
        iban: account.iban,
        swift_bic: account.swift_bic,
        routing_number: account.routing_number,
        sort_code: account.sort_code,
        branch_code: account.branch_code,
        branch_address: account.branch_address,
        bank_code: account.bank_code,
        is_default: account.is_default,
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      },
    });
  } catch (error) {
    console.error('Get bank account error:', error);
    res.status(500).json({ error: 'Server error retrieving bank account' });
  }
});

// Step 1: Verify password before adding/updating/deleting bank account (requires 2FA)
router.post('/verify-password', authenticate, contributionLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be 3 characters'),
  body('action').optional().isIn(['add', 'delete', 'update']).withMessage('Action must be "add", "delete", or "update"'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password, currency, action: requestedAction } = req.body;

    // Only support USD, EUR, GBP for bank accounts (since withdrawals are only supported for these)
    if (currency) {
      const currencyUpper = currency.toUpperCase();
      const supportedCurrencies = ['USD', 'EUR', 'GBP'];
      if (!supportedCurrencies.includes(currencyUpper)) {
        return res.status(400).json({
          error: `Bank accounts for ${currencyUpper} are not supported. Currently supported currencies: USD, EUR, GBP. Coming soon!`,
          currency: currencyUpper,
          supportedCurrencies,
        });
      }
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

    // Determine action based on parameter or default to 'add'
    // Format: {action}_bank_account_{currency} or {action}_bank_account if no currency
    let action;
    if (requestedAction) {
      if (currency) {
        action = `${requestedAction}_bank_account_${currency.toUpperCase()}`;
      } else {
        action = `${requestedAction}_bank_account`;
      }
    } else {
      // Default to 'add' for backward compatibility
      action = currency ? `add_bank_account_${currency.toUpperCase()}` : 'add_bank_account';
    }

    // Generate password verification token
    const token = generatePasswordVerificationToken(userId, action);

    // Store token in database
    await storePasswordVerificationToken(userId, token, action);

    res.json({
      verified: true,
      token,
      action, // Return the action so client knows which action was authorized
      expiresIn: 300, // 5 minutes in seconds
    });
  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).json({ error: 'Server error during password verification' });
  }
});

// Step 2: Request OTP after password verification (skip if 2FA enabled with authenticator)
router.post('/request-otp', authenticate, otpLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password_verification_token } = req.body;

    // Verify token and extract action from it
    const tokenData = verifyPasswordVerificationToken(password_verification_token);
    if (!tokenData || tokenData.userId !== userId) {
      return res.status(401).json({ error: 'Invalid or expired password verification token' });
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
      const action = tokenData.action; // Use action from the token (already set during verify-password)

      // Request OTP
      await requestPaymentOTP(userId, email, action, password_verification_token);

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

// Step 3: Add/Update bank account for a currency (requires password + OTP verification + 2FA)
router.post('/', authenticate, require2FA, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').notEmpty().isLength({ min: 6, max: 6 }).withMessage('OTP is required (6 digits)'),
  body('currency').isLength({ min: 3, max: 3 }).withMessage('Currency is required (3 characters, e.g., USD, NGN)'),
  body('account_name').trim().notEmpty().withMessage('Account name is required'),
  body('bank_name').trim().notEmpty().withMessage('Bank name is required'),
  body('account_number').trim().notEmpty().withMessage('Account number is required'),
  body('iban').optional().trim(),
  body('swift_bic').optional().trim(),
  body('routing_number').optional().trim(),
  body('sort_code').optional().trim(),
  body('branch_code').optional().trim(),
  body('branch_address').optional().trim(),
  body('bank_code').optional().trim(), // For Paystack (Nigerian bank code)
  body('is_default').optional().isBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const {
      password_verification_token,
      otp,
      currency,
      account_name,
      bank_name,
      account_number,
      iban,
      swift_bic,
      routing_number,
      sort_code,
      branch_code,
      branch_address,
      bank_code,
      is_default = true, // Default to true if this is the first account for this currency
    } = req.body;

    const currencyUpper = currency.toUpperCase();

    // Only support USD, EUR, GBP for bank accounts (since withdrawals are only supported for these)
    const supportedCurrencies = ['USD', 'EUR', 'GBP'];
    if (!supportedCurrencies.includes(currencyUpper)) {
      return res.status(400).json({
        error: `Bank accounts for ${currencyUpper} are not supported. Currently supported currencies: USD, EUR, GBP. Coming soon!`,
        currency: currencyUpper,
        supportedCurrencies,
      });
    }

    // Verify password token
    const action = `add_bank_account_${currencyUpper}`;
    const tokenData = verifyPasswordVerificationToken(password_verification_token);
    if (!tokenData || tokenData.action !== action || tokenData.userId !== userId) {
      return res.status(401).json({ error: 'Invalid or expired password verification token' });
    }

    // Verify OTP
    // Verify code (2FA code if 2FA enabled, otherwise OTP)
    const isValidCode = await verifyPaymentCode(userId, otp, password_verification_token, action);
    if (!isValidCode) {
      return res.status(401).json({ 
        error: 'Invalid or expired code. If using an authenticator app, make sure you\'re using the current code. If the issue persists, try disabling and re-adding 2FA in your security settings.' 
      });
    }

    await pool.query('BEGIN');

    try {
      // If setting as default, unset other defaults for this currency
      if (is_default) {
        await pool.query(
          `UPDATE wallet_bank_accounts 
           SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND currency = $2`,
          [userId, currencyUpper]
        );
      }

      // Check if account already exists (same currency + account number)
      const existingAccount = await pool.query(
        'SELECT id FROM wallet_bank_accounts WHERE user_id = $1 AND currency = $2 AND account_number = $3',
        [userId, currencyUpper, account_number]
      );

      if (existingAccount.rows.length > 0) {
        // Update existing account
        await pool.query(
          `UPDATE wallet_bank_accounts
           SET account_name = $1, bank_name = $2, iban = $3, swift_bic = $4,
               routing_number = $5, sort_code = $6, branch_code = $7,
               branch_address = $8, bank_code = $9, is_default = $10, updated_at = CURRENT_TIMESTAMP
           WHERE id = $11`,
          [
            account_name,
            bank_name,
            iban || null,
            swift_bic || null,
            routing_number || null,
            sort_code || null,
            branch_code || null,
            branch_address || null,
            bank_code || null,
            is_default,
            existingAccount.rows[0].id,
          ]
        );
      } else {
        // Create new account
        await pool.query(
          `INSERT INTO wallet_bank_accounts
           (user_id, currency, account_name, bank_name, account_number, iban, swift_bic,
            routing_number, sort_code, branch_code, branch_address, bank_code, is_default)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            userId,
            currencyUpper,
            account_name,
            bank_name,
            account_number,
            iban || null,
            swift_bic || null,
            routing_number || null,
            sort_code || null,
            branch_code || null,
            branch_address || null,
            bank_code || null,
            is_default,
          ]
        );
      }

      await pool.query('COMMIT');

      // Get user info for email notification
      const userResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );

      const userEmail = userResult.rows[0]?.email;
      const userName = userResult.rows[0]?.name;

      // Send security email notification
      try {
        if (userEmail && userName) {
          await sendSecurityEmail(
            userEmail,
            userName,
            'bank_account_added',
            `You added a bank account for ${currencyUpper} withdrawals: ${bank_name} - ****${account_number.slice(-4)}`,
            {
              currency: currencyUpper,
              bankName: bank_name,
              accountNumber: `****${account_number.slice(-4)}`,
              timestamp: new Date().toISOString(),
            }
          );
        }
      } catch (emailError) {
        console.error('Error sending security email:', emailError);
        // Don't fail the request if email fails
      }

      // Log action
      await logPaymentAction({
        userId,
        action: existingAccount.rows.length > 0 ? 'bank_account_updated' : 'bank_account_added',
        amount: 0,
        currency: currencyUpper,
        status: 'success',
        paymentProvider: null,
        metadata: {
          currency: currencyUpper,
          bankName: bank_name,
          isDefault: is_default,
        },
      });

      res.json({
        message: existingAccount.rows.length > 0
          ? 'Bank account updated successfully'
          : 'Bank account added successfully',
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Add/Update bank account error:', error);
    res.status(500).json({ error: 'Server error adding/updating bank account' });
  }
});

// Update bank account by ID (requires password + OTP verification + 2FA)
router.put('/:currency/:accountId', authenticate, require2FA, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').notEmpty().isLength({ min: 6, max: 6 }).withMessage('OTP is required (6 digits)'),
  body('account_name').optional().trim().notEmpty().withMessage('Account name cannot be empty'),
  body('bank_name').optional().trim().notEmpty().withMessage('Bank name cannot be empty'),
  body('account_number').optional().trim().notEmpty().withMessage('Account number cannot be empty'),
  body('iban').optional().trim(),
  body('swift_bic').optional().trim(),
  body('routing_number').optional().trim(),
  body('sort_code').optional().trim(),
  body('branch_code').optional().trim(),
  body('branch_address').optional().trim(),
  body('bank_code').optional().trim(),
  body('is_default').optional().isBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { currency, accountId } = req.params;
    const {
      password_verification_token,
      otp,
      account_name,
      bank_name,
      account_number,
      iban,
      swift_bic,
      routing_number,
      sort_code,
      branch_code,
      branch_address,
      bank_code,
      is_default,
    } = req.body;

    const currencyUpper = currency.toUpperCase();

    // Verify password token
    const action = `update_bank_account_${currencyUpper}`;
    const tokenData = verifyPasswordVerificationToken(password_verification_token);
    if (!tokenData || tokenData.action !== action || tokenData.userId !== userId) {
      return res.status(401).json({ error: 'Invalid or expired password verification token' });
    }

    // Verify OTP
    // Verify code (2FA code if 2FA enabled, otherwise OTP)
    const isValidCode = await verifyPaymentCode(userId, otp, password_verification_token, action);
    if (!isValidCode) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    // Check if account exists and belongs to user
    const accountCheck = await pool.query(
      'SELECT id, currency, is_default FROM wallet_bank_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Bank account not found' });
    }

    const existingAccount = accountCheck.rows[0];
    const accountCurrency = existingAccount.currency;

    // If currency in URL doesn't match account currency, return error
    if (accountCurrency !== currencyUpper) {
      return res.status(400).json({
        error: `Currency mismatch. Account is for ${accountCurrency}, but URL specifies ${currencyUpper}`,
      });
    }

    await pool.query('BEGIN');

    try {
      // If setting as default, unset other defaults for this currency
      if (is_default === true) {
        await pool.query(
          `UPDATE wallet_bank_accounts 
           SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND currency = $2 AND id != $3`,
          [userId, currencyUpper, accountId]
        );
      }

      // Build update query dynamically
      const updates = [];
      const values = [];
      let paramCount = 1;

      if (account_name !== undefined) {
        updates.push(`account_name = $${paramCount++}`);
        values.push(account_name);
      }

      if (bank_name !== undefined) {
        updates.push(`bank_name = $${paramCount++}`);
        values.push(bank_name);
      }

      if (account_number !== undefined) {
        updates.push(`account_number = $${paramCount++}`);
        values.push(account_number);
      }

      if (iban !== undefined) {
        updates.push(`iban = $${paramCount++}`);
        values.push(iban || null);
      }

      if (swift_bic !== undefined) {
        updates.push(`swift_bic = $${paramCount++}`);
        values.push(swift_bic || null);
      }

      if (routing_number !== undefined) {
        updates.push(`routing_number = $${paramCount++}`);
        values.push(routing_number || null);
      }

      if (sort_code !== undefined) {
        updates.push(`sort_code = $${paramCount++}`);
        values.push(sort_code || null);
      }

      if (branch_code !== undefined) {
        updates.push(`branch_code = $${paramCount++}`);
        values.push(branch_code || null);
      }

      if (branch_address !== undefined) {
        updates.push(`branch_address = $${paramCount++}`);
        values.push(branch_address || null);
      }

      if (bank_code !== undefined) {
        updates.push(`bank_code = $${paramCount++}`);
        values.push(bank_code || null);
      }

      if (is_default !== undefined) {
        updates.push(`is_default = $${paramCount++}`);
        values.push(is_default);
      }

      if (updates.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: 'No fields to update' });
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(accountId);

      // Update account
      await pool.query(
        `UPDATE wallet_bank_accounts
         SET ${updates.join(', ')}
         WHERE id = $${paramCount}`,
        values
      );

      await pool.query('COMMIT');

      // Send security email
      try {
        const userResult = await pool.query(
          'SELECT email, name FROM users WHERE id = $1',
          [userId]
        );

        if (userResult.rows.length > 0) {
          await sendSecurityEmail(
            userResult.rows[0].email,
            userResult.rows[0].name,
            'bank_account_updated',
            `You updated a bank account for ${currencyUpper} withdrawals.`,
            {
              currency: currencyUpper,
              accountId,
              isDefault: is_default,
              timestamp: new Date().toISOString(),
            }
          );
        }
      } catch (emailError) {
        console.error('Error sending security email:', emailError);
      }

      // Log action
      await logPaymentAction({
        userId,
        action: 'bank_account_updated',
        amount: 0,
        currency: currencyUpper,
        status: 'success',
        paymentProvider: null,
        metadata: {
          currency: currencyUpper,
          accountId,
          isDefault: is_default,
        },
      });

      res.json({
        message: 'Bank account updated successfully',
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Update bank account error:', error);
    res.status(500).json({ error: 'Server error updating bank account' });
  }
});

// Delete bank account for a currency (requires password + OTP verification + 2FA)
router.delete('/:currency/:accountId', authenticate, require2FA, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').notEmpty().isLength({ min: 6, max: 6 }).withMessage('OTP is required (6 digits)'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { currency, accountId } = req.params;
    const { password_verification_token, otp } = req.body;

    // Verify password token
    const action = `delete_bank_account_${currency.toUpperCase()}`;
    const tokenData = verifyPasswordVerificationToken(password_verification_token);
    if (!tokenData || tokenData.action !== action || tokenData.userId !== userId) {
      return res.status(401).json({ error: 'Invalid or expired password verification token' });
    }

    // Verify OTP
    // Verify code (2FA code if 2FA enabled, otherwise OTP)
    const isValidCode = await verifyPaymentCode(userId, otp, password_verification_token, action);
    if (!isValidCode) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    // Check if account belongs to user and currency matches
    const accountCheck = await pool.query(
      'SELECT id, is_default FROM wallet_bank_accounts WHERE id = $1 AND user_id = $2 AND currency = $3',
      [accountId, userId, currency.toUpperCase()]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Bank account not found' });
    }

    // Check if user has pending withdrawals for this currency
    const pendingWithdrawals = await pool.query(
      `SELECT COUNT(*) as count FROM withdrawals 
       WHERE user_id = $1 AND currency = $2 AND status IN ('pending', 'processing')`,
      [userId, currency.toUpperCase()]
    );

    if (parseInt(pendingWithdrawals.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'Cannot delete bank account. You have pending withdrawals for this currency.',
      });
    }

    // Check if this is the only account for this currency and user has balance
    const { getCurrencyBalance } = require('../utils/walletHelpers');
    const balance = await getCurrencyBalance(userId, currency.toUpperCase());

    if (balance > 0) {
      const otherAccounts = await pool.query(
        'SELECT COUNT(*) as count FROM wallet_bank_accounts WHERE user_id = $1 AND currency = $2 AND id != $3',
        [userId, currency.toUpperCase(), accountId]
      );

      if (parseInt(otherAccounts.rows[0].count) === 0) {
        return res.status(400).json({
          error: `Cannot delete bank account. You have a balance of ${currency.toUpperCase()} ${balance}. Please add another bank account or withdraw all funds first.`,
        });
      }
    }

    // Delete account
    await pool.query(
      'DELETE FROM wallet_bank_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    // If deleted account was default, set another account as default (if exists)
    if (accountCheck.rows[0].is_default) {
      const newDefault = await pool.query(
        `UPDATE wallet_bank_accounts 
         SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND currency = $2 AND id != $3
         LIMIT 1
         RETURNING id`,
        [userId, currency.toUpperCase(), accountId]
      );
    }

    // Send security email
    try {
      const userResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length > 0) {
        await sendSecurityEmail(
          userResult.rows[0].email,
          userResult.rows[0].name,
          'bank_account_deleted',
          `You deleted a bank account for ${currency.toUpperCase()} withdrawals.`,
          {
            currency: currency.toUpperCase(),
            timestamp: new Date().toISOString(),
          }
        );
      }
    } catch (emailError) {
      console.error('Error sending security email:', emailError);
    }

    // Log action
    await logPaymentAction({
      userId,
      action: 'bank_account_deleted',
      amount: 0,
      currency: currency.toUpperCase(),
      status: 'success',
      paymentProvider: null,
      metadata: {
        currency: currency.toUpperCase(),
        accountId,
      },
    });

    res.json({
      message: 'Bank account deleted successfully',
    });
  } catch (error) {
    console.error('Delete bank account error:', error);
    res.status(500).json({ error: 'Server error deleting bank account' });
  }
});

module.exports = router;
