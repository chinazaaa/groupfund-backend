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
  logPaymentAction,
} = require('../utils/paymentHelpers');
const {
  sendWithdrawalRequestEmail,
  sendWithdrawalCompletedEmail,
  sendWithdrawalFailedEmail,
} = require('../utils/email');
const { createNotification } = require('../utils/notifications');

const router = express.Router();

/**
 * WITHDRAWAL MANAGEMENT
 */

// Step 1: Verify password before requesting withdrawal (requires 2FA)
router.post('/verify-password', authenticate, contributionLimiter, [
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
    const token = generatePasswordVerificationToken(userId, 'withdrawal');

    // Store token in database for audit
    await storePasswordVerificationToken(userId, token, 'withdrawal');

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
    await requestPaymentOTP(userId, email, 'withdrawal', password_verification_token);

    res.json({
      message: 'OTP sent to your email',
    });
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: error.message || 'Server error during OTP request' });
  }
});

// Step 3: Request withdrawal (requires password + OTP verification + 2FA)
router.post('/request', authenticate, require2FA, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').notEmpty().isLength({ min: 6, max: 6 }).withMessage('OTP is required (6 digits)'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be 3 characters (e.g., NGN, USD)'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password_verification_token, otp, amount, currency: requestedCurrency } = req.body;

    // Verify password token
    const tokenData = verifyPasswordVerificationToken(password_verification_token);
    if (!tokenData || tokenData.action !== 'withdrawal' || tokenData.userId !== userId) {
      return res.status(401).json({ error: 'Invalid or expired password verification token' });
    }

    // Verify OTP
    const isValidOTP = await verifyPaymentOTP(userId, otp, password_verification_token, 'withdrawal');
    if (!isValidOTP) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Validate currency - MUST be provided (comes from user's groups)
    if (!requestedCurrency) {
      return res.status(400).json({
        error: 'Currency is required. Please specify which currency you want to withdraw.',
      });
    }
    const currency = requestedCurrency.toUpperCase();

    // Get currency-specific bank account for withdrawal
    const bankAccountResult = await pool.query(
      `SELECT wba.id, wba.account_name, wba.bank_name, wba.account_number, wba.iban, wba.swift_bic,
              wba.routing_number, wba.sort_code, wba.branch_code, wba.branch_address, wba.bank_code,
              u.email, u.name
       FROM wallet_bank_accounts wba
       JOIN users u ON wba.user_id = u.id
       WHERE wba.user_id = $1 AND wba.currency = $2
       ORDER BY wba.is_default DESC, wba.created_at DESC
       LIMIT 1`,
      [userId, currency]
    );

    if (bankAccountResult.rows.length === 0) {
      return res.status(404).json({
        error: `No bank account found for ${currency}. Please add a bank account for ${currency} withdrawals first.`,
        currency,
      });
    }

    const bankAccount = bankAccountResult.rows[0];

    // Validate bank details
    if (!bankAccount.account_name || !bankAccount.account_number || !bankAccount.bank_name) {
      return res.status(400).json({
        error: 'Bank account details incomplete. Please update your bank account details.',
      });
    }
    const withdrawalAmount = parseFloat(amount);

    // Check minimum withdrawal amount
    const minWithdrawal = currency === 'NGN' ? 1000 : 10; // ₦1,000 or $10
    if (withdrawalAmount < minWithdrawal) {
      return res.status(400).json({
        error: `Minimum withdrawal amount is ${currency === 'NGN' ? '₦' : '$'}${minWithdrawal}`,
        minimum: minWithdrawal,
      });
    }

    // Check wallet balance for the specific currency
    const { getCurrencyBalance } = require('../utils/walletHelpers');
    const currentBalance = await getCurrencyBalance(userId, currency);
    
    if (currentBalance < withdrawalAmount) {
      return res.status(400).json({
        error: 'Insufficient balance',
        currentBalance,
        requested: withdrawalAmount,
        currency,
      });
    }

    // Select provider based on currency
    const provider = paymentService.selectProvider(currency, null);

    // Calculate withdrawal fee
    const feeCalculation = paymentService.calculateWithdrawalFee(withdrawalAmount, currency, provider);
    const netAmount = feeCalculation.netAmount;

    // Check if balance covers withdrawal + fee
    if (currentBalance < withdrawalAmount) {
      return res.status(400).json({
        error: 'Insufficient balance (including fees)',
        currentBalance,
        requested: withdrawalAmount,
        fee: feeCalculation.fee,
        netAmount,
      });
    }

    await pool.query('BEGIN');

    try {
      // Deduct from currency-specific wallet balance immediately (held for 24 hours)
      await pool.query(
        `UPDATE wallet_balances 
         SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 AND currency = $3`,
        [withdrawalAmount, userId, currency]
      );

      // Also update main wallet balance for backward compatibility (optional)
      // Get total of all balances for primary currency
      const primaryBalanceResult = await pool.query(
        `SELECT COALESCE(SUM(balance), 0) as total_balance
         FROM wallet_balances
         WHERE user_id = $1 AND currency = $2`,
        [userId, currency]
      );
      
      const primaryBalance = parseFloat(primaryBalanceResult.rows[0]?.total_balance || 0);
      await pool.query(
        `UPDATE wallets SET balance = $1, currency = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3`,
        [primaryBalance, currency, userId]
      );

      // Calculate scheduled time (24 hours from now)
      const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Create withdrawal record
      const withdrawalResult = await pool.query(
        `INSERT INTO withdrawals
         (user_id, amount, currency, bank_account_number, bank_name, account_name,
          status, payment_provider, fee, net_amount, scheduled_at, bank_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11)
         RETURNING id, scheduled_at`,
        [
          userId,
          withdrawalAmount,
          currency,
          bankAccount.account_number,
          bankAccount.bank_name,
          bankAccount.account_name,
          provider,
          feeCalculation.fee,
          netAmount,
          scheduledAt,
          bankAccount.id, // Store bank account ID for reference
        ]
      );

      const withdrawal = withdrawalResult.rows[0];

      // Create transaction record with currency
      await pool.query(
        `INSERT INTO transactions
         (user_id, type, amount, currency, description, status, reference, withdrawal_fee)
         VALUES ($1, 'withdrawal', $2, $3, $4, 'pending', $5, $6)`,
        [
          userId,
          withdrawalAmount,
          currency,
          `Withdrawal to ${bankAccount.account_name} - ${bankAccount.bank_name} (****${bankAccount.account_number.slice(-4)})`,
          withdrawal.id,
          feeCalculation.fee,
        ]
      );

      await pool.query('COMMIT');

      // Send email notification
      try {
        const currencySymbol = paymentService.formatCurrency(withdrawalAmount, currency).replace(/[\d.,]+/g, '');
        await sendWithdrawalRequestEmail(
          bankAccount.email,
          bankAccount.name,
          withdrawalAmount,
          currency,
          currencySymbol,
          scheduledAt,
          bankAccount.account_number
        );
      } catch (emailError) {
        console.error('Error sending withdrawal request email:', emailError);
        // Don't fail the request if email fails
      }

      // Create in-app and push notification
      try {
        const currencySymbol = paymentService.formatCurrency(withdrawalAmount, currency).replace(/[\d.,]+/g, '');
        await createNotification(
          userId,
          'withdrawal_requested',
          'Withdrawal Requested',
          `Your withdrawal of ${currencySymbol}${withdrawalAmount.toLocaleString()} ${currency} has been submitted and will be processed in 24 hours.`,
          null,
          null
        );
      } catch (notificationError) {
        console.error('Error creating withdrawal request notification:', notificationError);
        // Don't fail the request if notification fails
      }

      // Log action
      await logPaymentAction({
        userId,
        action: 'withdrawal_requested',
        amount: withdrawalAmount,
        currency,
        status: 'pending',
        paymentProvider: provider,
        metadata: {
          withdrawalId: withdrawal.id,
          netAmount,
          fee: feeCalculation.fee,
          scheduledAt: withdrawal.scheduled_at,
        },
      });

      // Get updated balance for this currency
      const updatedBalance = await getCurrencyBalance(userId, currency);

      res.json({
        message: 'Withdrawal request submitted successfully',
        withdrawal: {
          id: withdrawal.id,
          amount: withdrawalAmount,
          currency,
          fee: feeCalculation.fee,
          netAmount,
          status: 'pending',
          scheduledAt: withdrawal.scheduled_at,
        },
        walletBalance: {
          currency,
          balance: updatedBalance,
        },
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Withdrawal request error:', error);
    res.status(500).json({ error: 'Server error processing withdrawal request' });
  }
});

// Get withdrawal history
router.get('/history', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT id, amount, currency, status, fee, net_amount, scheduled_at, processed_at, error_message, created_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), parseInt(offset)]
    );

    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM withdrawals WHERE user_id = $1',
      [userId]
    );

    res.json({
      withdrawals: result.rows,
      total: parseInt(totalResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Get withdrawal history error:', error);
    res.status(500).json({ error: 'Server error retrieving withdrawal history' });
  }
});

// Get withdrawal details
router.get('/:withdrawalId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { withdrawalId } = req.params;

    const result = await pool.query(
      `SELECT id, amount, currency, status, fee, net_amount, bank_account_number, bank_name,
              account_name, payment_provider, provider_transaction_id, scheduled_at, processed_at,
              error_message, created_at, updated_at
       FROM withdrawals
       WHERE id = $1 AND user_id = $2`,
      [withdrawalId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    // Mask account number for security (show last 4 digits only)
    const withdrawal = result.rows[0];
    if (withdrawal.bank_account_number) {
      const accountNumber = withdrawal.bank_account_number;
      withdrawal.bank_account_number = '****' + accountNumber.slice(-4);
    }

    res.json({
      withdrawal,
    });
  } catch (error) {
    console.error('Get withdrawal details error:', error);
    res.status(500).json({ error: 'Server error retrieving withdrawal details' });
  }
});

module.exports = router;
