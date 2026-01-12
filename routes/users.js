const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { otpLimiter, contributionLimiter } = require('../middleware/rateLimiter');
const {
  verifyPassword,
  generatePasswordVerificationToken,
  verifyPasswordVerificationToken,
  storePasswordVerificationToken,
  requestPaymentOTP,
  verifyPaymentOTP,
  logPaymentAction,
} = require('../utils/paymentHelpers');
const { sendSecurityEmail } = require('../utils/email');

const router = express.Router();

// Get current user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const userResult = await pool.query(
      `SELECT id, name, email, birthday, is_verified, is_admin,
              notify_7_days_before, notify_1_day_before, notify_same_day,
              created_at 
       FROM users WHERE id = $1`,
      [userId]
    );

    const walletResult = await pool.query(
      'SELECT balance, account_number, bank_name, account_name, iban, swift_bic, routing_number, sort_code, branch_code, branch_address FROM wallets WHERE user_id = $1',
      [userId]
    );

    // Only return wallet if it exists and has payment details
    const wallet = walletResult.rows[0];
    const walletResponse = wallet && (wallet.account_name || wallet.bank_name || wallet.account_number)
      ? wallet
      : { balance: 0, account_number: null, bank_name: null, account_name: null, iban: null, swift_bic: null, routing_number: null, sort_code: null, branch_code: null, branch_address: null };

    // Calculate member/reliability score
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day
    const currentYear = today.getFullYear();

    // Get all groups the user is/was a member of (active or past)
    const groupsResult = await pool.query(
      `SELECT g.id, g.name, g.group_type, g.subscription_frequency, g.subscription_deadline_day, g.subscription_deadline_month, g.deadline, gm.joined_at, gm.status
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       WHERE gm.user_id = $1 AND gm.status IN ('active', 'inactive')
       ORDER BY gm.joined_at DESC`,
      [userId]
    );

    let totalContributions = 0; // Total contributions expected (all past/today birthdays)
    let totalOverdue = 0;
    let totalOnTime = 0;
    let totalGroups = groupsResult.rows.length;

    // Calculate metrics for each group
    for (const group of groupsResult.rows) {
      const userJoinDate = new Date(group.joined_at);
      userJoinDate.setHours(0, 0, 0, 0); // Normalize to start of day

      // Get all members in this group with birthdays
      const membersResult = await pool.query(
        `SELECT u.id, u.name, u.birthday
         FROM users u
         JOIN group_members gm ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.status = 'active' AND u.birthday IS NOT NULL AND u.id != $2`,
        [group.id, userId]
      );

      for (const member of membersResult.rows) {
        const memberBirthday = new Date(member.birthday);
        const thisYearBirthday = new Date(currentYear, memberBirthday.getMonth(), memberBirthday.getDate());
        thisYearBirthday.setHours(0, 0, 0, 0); // Normalize to start of day
        
        // Only count if user was a member when birthday occurred
        if (userJoinDate <= thisYearBirthday) {
          const isPast = thisYearBirthday < today;
          const isToday = thisYearBirthday.getTime() === today.getTime();
          const isPastOrToday = isPast || isToday;
          
          if (isPastOrToday) {
            // Birthday has passed or is today, check contribution status
            // Don't filter by year - just get the most recent contribution for this birthday
            const contributionCheck = await pool.query(
              `SELECT status, contribution_date FROM birthday_contributions 
               WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
               ORDER BY contribution_date DESC
               LIMIT 1`,
              [group.id, member.id, userId]
            );

            let isFullyPaid = false; // Only 'confirmed' is fully paid
            let status = null;
            let contributionDate = null;
            let paidOnTime = false;

            // Count all birthdays that have passed (or are today) as expected contributions
            // This ensures we have a proper denominator for reliability calculation
            if (isPastOrToday) {
              totalContributions++;
            }

            if (contributionCheck.rows.length > 0) {
              status = contributionCheck.rows[0].status;
              contributionDate = contributionCheck.rows[0].contribution_date ? new Date(contributionCheck.rows[0].contribution_date) : null;
              isFullyPaid = (status === 'confirmed');
              
              // On-time = confirmed AND paid on or before birthday
              if (isFullyPaid && contributionDate) {
                contributionDate.setHours(0, 0, 0, 0);
                paidOnTime = contributionDate <= thisYearBirthday;
              }
            }

            // On-time = confirmed AND paid on or before birthday
            if (paidOnTime) {
              totalOnTime++;
            } else if (status === 'not_paid' || status === 'not_received') {
              // Not paid or rejected - overdue if birthday has passed
              if (isPast) {
                totalOverdue++;
              }
              // If it's today and not paid/not_received, it's expected but not overdue yet
            } else if (status === 'paid') {
              // Paid but awaiting confirmation - overdue if birthday has passed
              if (isPast) {
                totalOverdue++;
              }
              // If it's today and paid, it's expected but not overdue yet
            } else if (status === 'confirmed' && !paidOnTime) {
              // Confirmed but paid AFTER birthday - this is overdue (late payment)
              totalOverdue++;
            } else if (!contributionCheck.rows.length) {
              // No contribution record = not_paid
              // Only count as overdue if birthday has passed (not today)
              if (isPast) {
                totalOverdue++;
              }
              // If it's today and no record, it's expected but not overdue yet
            }
          }
        }
      }
    }

    // Calculate metrics for subscription groups
    for (const group of groupsResult.rows.filter(g => g.group_type === 'subscription')) {
      const userJoinDate = new Date(group.joined_at);
      userJoinDate.setHours(0, 0, 0, 0);
      
      const currentMonth = today.getMonth() + 1;
      let periodStart;
      if (group.subscription_frequency === 'monthly') {
        periodStart = new Date(currentYear, currentMonth - 1, 1);
      } else {
        periodStart = new Date(currentYear, 0, 1);
      }
      periodStart.setHours(0, 0, 0, 0);

      let deadlineDate;
      if (group.subscription_frequency === 'monthly') {
        deadlineDate = new Date(currentYear, currentMonth - 1, group.subscription_deadline_day || 1);
      } else {
        deadlineDate = new Date(currentYear, (group.subscription_deadline_month || 1) - 1, group.subscription_deadline_day || 1);
      }
      deadlineDate.setHours(0, 0, 0, 0);
      const isDeadlinePassed = deadlineDate < today;

      // Only count if user was a member when deadline occurred
      if (userJoinDate <= deadlineDate && isDeadlinePassed) {
        const contributionCheck = await pool.query(
          `SELECT status, contribution_date 
           FROM subscription_contributions 
           WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3
           ORDER BY contribution_date DESC
           LIMIT 1`,
          [group.id, userId, periodStart]
        );

        totalContributions++;

        if (contributionCheck.rows.length > 0) {
          const status = contributionCheck.rows[0].status;
          const contributionDate = contributionCheck.rows[0].contribution_date ? new Date(contributionCheck.rows[0].contribution_date) : null;
          const isFullyPaid = (status === 'confirmed');
          
          if (isFullyPaid && contributionDate) {
            contributionDate.setHours(0, 0, 0, 0);
            const paidOnTime = contributionDate <= deadlineDate;
            if (paidOnTime) {
              totalOnTime++;
            } else {
              totalOverdue++;
            }
          } else if (status === 'not_paid' || status === 'not_received' || status === 'paid') {
            totalOverdue++;
          }
        } else {
          totalOverdue++;
        }
      }
    }

    // Calculate metrics for general groups
    for (const group of groupsResult.rows.filter(g => g.group_type === 'general')) {
      if (!group.deadline) {
        continue; // Skip groups without deadlines
      }

      const userJoinDate = new Date(group.joined_at);
      userJoinDate.setHours(0, 0, 0, 0);
      
      const deadlineDate = new Date(group.deadline);
      deadlineDate.setHours(0, 0, 0, 0);
      const isDeadlinePassed = deadlineDate < today;

      // Only count if user was a member when deadline occurred
      if (userJoinDate <= deadlineDate && isDeadlinePassed) {
        const contributionCheck = await pool.query(
          `SELECT status, contribution_date 
           FROM general_contributions 
           WHERE group_id = $1 AND contributor_id = $2
           ORDER BY contribution_date DESC
           LIMIT 1`,
          [group.id, userId]
        );

        totalContributions++;

        if (contributionCheck.rows.length > 0) {
          const status = contributionCheck.rows[0].status;
          const contributionDate = contributionCheck.rows[0].contribution_date ? new Date(contributionCheck.rows[0].contribution_date) : null;
          const isFullyPaid = (status === 'confirmed');
          
          if (isFullyPaid && contributionDate) {
            contributionDate.setHours(0, 0, 0, 0);
            const paidOnTime = contributionDate <= deadlineDate;
            if (paidOnTime) {
              totalOnTime++;
            } else {
              totalOverdue++;
            }
          } else if (status === 'not_paid' || status === 'not_received' || status === 'paid') {
            totalOverdue++;
          }
        } else {
          totalOverdue++;
        }
      }
    }

    // Get reports count for this user
    const reportsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_reports,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_reports,
        COUNT(*) FILTER (WHERE status = 'dismissed') as dismissed_reports,
        COUNT(*) FILTER (WHERE status IN ('pending', 'resolved')) as total_valid_reports,
        COUNT(*) as total_reports
       FROM reports 
       WHERE reported_user_id = $1`,
      [userId]
    );

    const pendingReports = parseInt(reportsResult.rows[0]?.pending_reports || 0);
    const resolvedReports = parseInt(reportsResult.rows[0]?.resolved_reports || 0);
    const dismissedReports = parseInt(reportsResult.rows[0]?.dismissed_reports || 0);
    const totalValidReports = parseInt(reportsResult.rows[0]?.total_valid_reports || 0); // All reports except dismissed
    const totalReports = parseInt(reportsResult.rows[0]?.total_reports || 0);

    // Reliability starts at 100% and only reduces for overdue contributions and reports
    let reliabilityScore = 100; // Start at 100% (excellent)
    let onTimeRate = 100;

    // totalContributions now represents all birthdays that have passed (or are today)
    // totalOverdue represents contributions that are overdue (which are a subset of totalContributions)
    // So we should use totalContributions as the denominator, not totalContributions + totalOverdue
    const totalExpected = totalContributions;

    // Only reduce reliability if there are overdue contributions
    // If no overdue contributions, reliability stays at 100%
    if (totalOverdue > 0 && totalExpected > 0) {
      // Calculate on-time rate based on on-time vs total expected contributions
      // This reduces from 100% based on how many are overdue
      onTimeRate = (totalOnTime / totalExpected) * 100;
      reliabilityScore = Math.round(onTimeRate);
    } else if (totalOverdue === 0 && totalExpected > 0) {
      // If no overdue contributions, keep at 100%
      onTimeRate = 100;
      reliabilityScore = 100;
    }

    // Reduce reliability based on reports
    // Pending reports (not yet reviewed) are more urgent: -5 points each
    // Resolved reports (valid concerns) still matter but less urgent: -3 points each
    // Dismissed reports don't affect reliability (they were false/invalid)
    const reportPenalty = (pendingReports * 5) + (resolvedReports * 3);
    reliabilityScore = Math.max(0, reliabilityScore - reportPenalty);
    
    // Update on_time_rate to reflect report penalty (but don't go below 0)
    onTimeRate = Math.max(0, onTimeRate - reportPenalty);

    // Generate summary text
    let summaryText = '';
    let rating = 'excellent';

    if (totalContributions === 0 && totalOverdue === 0 && totalValidReports === 0) {
      summaryText = 'New member - No contribution history yet';
      rating = 'new';
    } else if (totalOverdue === 0 && totalValidReports === 0) {
      summaryText = 'Excellent - No overdue contributions';
      rating = 'excellent';
    } else if (reliabilityScore >= 90) {
      summaryText = 'Very reliable - Excellent payment record';
      rating = 'excellent';
    } else if (reliabilityScore >= 75) {
      summaryText = 'Reliable - Good payment record';
      rating = 'good';
    } else if (reliabilityScore >= 50) {
      summaryText = 'Moderate - Some overdue contributions';
      rating = 'moderate';
    } else {
      summaryText = 'Poor - Multiple overdue contributions';
      rating = 'poor';
    }

    // Add specific details
    if (totalOverdue > 0) {
      summaryText += ` (${totalOverdue} overdue)`;
    }
    if (totalValidReports > 0) {
      summaryText += ` (${totalValidReports} report${totalValidReports > 1 ? 's' : ''})`;
    }

    // Add reliability score to user response
    const userData = userResult.rows[0];
    userData.reliability_score = reliabilityScore;
    userData.reliability_rating = rating;
    userData.reliability_text = summaryText;
    userData.on_time_rate = Math.round(onTimeRate * 10) / 10;
    userData.pending_reports = pendingReports;
    userData.resolved_reports = resolvedReports;
    userData.dismissed_reports = dismissedReports;
    userData.total_valid_reports = totalValidReports; // All reports except dismissed (pending + resolved)
    userData.total_reports = totalReports; // All reports including dismissed
    userData.report_penalty = reportPenalty;

    res.json({
      user: userData,
      wallet: walletResponse,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update profile
router.put('/profile', authenticate, [
  body('name').optional().trim().notEmpty(),
  body('birthday').optional().isISO8601().withMessage('Birthday must be a valid date (YYYY-MM-DD)'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { name, birthday } = req.body;

    // Check if user already has a birthday set
    if (birthday !== undefined) {
      const userCheck = await pool.query(
        'SELECT birthday FROM users WHERE id = $1',
        [userId]
      );

      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // If birthday is already set, prevent updating it
      if (userCheck.rows[0].birthday !== null) {
        return res.status(403).json({ error: 'Birthday cannot be updated once set. Please contact support@groupfund.app to change your birthday.' });
      }
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (birthday !== undefined) {
      updates.push(`birthday = $${paramCount++}`);
      values.push(birthday);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, name, email, birthday`;

    const result = await pool.query(query, values);

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Server error updating profile' });
  }
});

// Get wallet balances (all currencies)
router.get('/wallet', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get wallet details (bank account info)
    const walletResult = await pool.query(
      'SELECT account_number, bank_name, account_name, iban, swift_bic, routing_number, sort_code, branch_code, branch_address FROM wallets WHERE user_id = $1',
      [userId]
    );

    // Get all currency balances
    const { getAllCurrencyBalances } = require('../utils/walletHelpers');
    const balances = await getAllCurrencyBalances(userId);

    // Get bank accounts per currency
    const bankAccountsResult = await pool.query(
      `SELECT id, currency, account_name, bank_name, account_number, iban, swift_bic,
              routing_number, sort_code, branch_code, branch_address, bank_code, is_default,
              created_at, updated_at
       FROM wallet_bank_accounts
       WHERE user_id = $1
       ORDER BY currency, is_default DESC`,
      [userId]
    );

    // Group bank accounts by currency
    const bankAccountsByCurrency = {};
    for (const account of bankAccountsResult.rows) {
      const currency = account.currency;
      if (!bankAccountsByCurrency[currency]) {
        bankAccountsByCurrency[currency] = [];
      }
      bankAccountsByCurrency[currency].push({
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

    // Merge balances with bank accounts per currency
    const balancesWithAccounts = balances.map(balance => ({
      ...balance,
      bankAccount: bankAccountsByCurrency[balance.currency]?.[0] || null, // Default account for this currency
      hasBankAccount: !!bankAccountsByCurrency[balance.currency]?.length,
      bankAccountsCount: bankAccountsByCurrency[balance.currency]?.length || 0,
    }));

    // Always return bank accounts, even if no balances exist
    // This allows users to see their bank accounts and create groups before receiving contributions
    res.json({
      wallet: {
        balances: balancesWithAccounts, // Array of { currency, balance, updatedAt, bankAccount, hasBankAccount }
        totalBalances: balances.length, // Number of currencies with balances
        bankAccountsByCurrency, // All bank accounts grouped by currency (always included, even if empty)
      }
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get wallet transaction history (credits and debits/withdrawals)
router.get('/wallet/history', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency, type, limit = 50, offset = 0 } = req.query;

    // Build query to get wallet transactions (credits that entered wallet and withdrawals)
    // Only include transactions that actually affected wallet_balances:
    // 1. Credits with payment_provider (created via creditWallet - money entered wallet)
    // 2. Withdrawals (money left wallet)
    let query = `
      SELECT 
        t.id, t.type, t.amount, t.currency, t.description, t.status, t.created_at,
        t.reference, t.withdrawal_fee, t.payment_provider, t.payment_method_id,
        t.platform_fee, t.processor_fee, t.gross_amount, t.net_amount,
        g.id as group_id, g.name as group_name,
        w.id as withdrawal_id, w.net_amount as withdrawal_net_amount, w.scheduled_at, w.processed_at
      FROM transactions t
      LEFT JOIN groups g ON t.group_id = g.id
      LEFT JOIN withdrawals w ON w.id::text = t.reference::text AND t.type = 'withdrawal'
      WHERE t.user_id = $1
        AND (
          (t.type = 'credit' AND t.payment_provider IS NOT NULL) -- Credits that entered wallet via creditWallet
          OR t.type = 'withdrawal' -- Withdrawals from wallet
        )
    `;
    const params = [userId];
    let paramCount = 2;

    // Filter by currency if provided
    if (currency) {
      query += ` AND t.currency = $${paramCount++}`;
      params.push(currency.toUpperCase());
    }

    // Filter by type if provided (credit or withdrawal)
    if (type) {
      if (type === 'credit') {
        query += ` AND t.type = 'credit' AND t.payment_provider IS NOT NULL`;
      } else if (type === 'withdrawal') {
        query += ` AND t.type = $${paramCount++}`;
        params.push(type);
      }
      // Note: 'debit' type is not used for wallet history (only withdrawals)
    }

    query += ` ORDER BY t.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Format transactions
    const transactions = result.rows.map(row => {
      const transaction = {
        id: row.id,
        type: row.type,
        amount: parseFloat(row.amount),
        currency: row.currency || 'NGN',
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        reference: row.reference,
        paymentProvider: row.payment_provider,
        paymentMethodId: row.payment_method_id,
      };

      // Add group info if available
      if (row.group_id) {
        transaction.group = {
          id: row.group_id,
          name: row.group_name,
        };
      }

      // Add withdrawal-specific info
      if (row.type === 'withdrawal') {
        transaction.withdrawalFee = row.withdrawal_fee ? parseFloat(row.withdrawal_fee) : 0;
        transaction.netAmount = row.withdrawal_net_amount ? parseFloat(row.withdrawal_net_amount) : parseFloat(row.amount) - (row.withdrawal_fee ? parseFloat(row.withdrawal_fee) : 0);
        transaction.withdrawalId = row.withdrawal_id;
        transaction.scheduledAt = row.scheduled_at;
        transaction.processedAt = row.processed_at;
      }

      // Add fee info for credits (if available)
      if (row.type === 'credit') {
        if (row.platform_fee !== null) {
          transaction.fees = {
            platformFee: parseFloat(row.platform_fee || 0),
            processorFee: parseFloat(row.processor_fee || 0),
            grossAmount: row.gross_amount ? parseFloat(row.gross_amount) : parseFloat(row.amount),
            netAmount: row.net_amount ? parseFloat(row.net_amount) : parseFloat(row.amount),
          };
        }
      }

      return transaction;
    });

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM transactions
      WHERE user_id = $1
        AND (
          (type = 'credit' AND payment_provider IS NOT NULL)
          OR type = 'withdrawal'
        )
    `;
    const countParams = [userId];
    let countParamCount = 2;

    if (currency) {
      countQuery += ` AND currency = $${countParamCount++}`;
      countParams.push(currency.toUpperCase());
    }

    if (type) {
      if (type === 'credit') {
        countQuery += ` AND type = 'credit' AND payment_provider IS NOT NULL`;
      } else if (type === 'withdrawal') {
        countQuery += ` AND type = $${countParamCount++}`;
        countParams.push(type);
      }
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      transactions,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Get wallet history error:', error);
    res.status(500).json({ error: 'Server error retrieving wallet history' });
  }
});

// Step 1: Verify password before updating wallet
router.post('/wallet/verify-password', authenticate, contributionLimiter, [
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
    const token = generatePasswordVerificationToken(userId, 'update_wallet');

    // Store token in database
    await storePasswordVerificationToken(userId, token, 'update_wallet');

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
router.post('/wallet/request-otp', authenticate, otpLimiter, [
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
    await requestPaymentOTP(userId, email, 'update_wallet', password_verification_token);

    res.json({
      message: 'OTP sent to your email',
    });
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: error.message || 'Server error during OTP request' });
  }
});

// Step 3: Update wallet/payment details (requires password + OTP verification)
router.put('/wallet', authenticate, contributionLimiter, [
  body('password_verification_token').notEmpty().withMessage('Password verification token is required'),
  body('otp').notEmpty().isLength({ min: 6, max: 6 }).withMessage('OTP is required (6 digits)'),
  body('account_name').optional().trim().notEmpty().withMessage('Account name is required if provided'),
  body('bank_name').optional().trim().notEmpty().withMessage('Bank name is required if provided'),
  body('account_number').optional().trim().notEmpty().withMessage('Account number is required if provided'),
  body('iban').optional().trim(),
  body('swift_bic').optional().trim(),
  body('routing_number').optional().trim(),
  body('sort_code').optional().trim(),
  body('branch_code').optional().trim(),
  body('branch_address').optional().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { password_verification_token, otp, account_name, bank_name, account_number, iban, swift_bic, routing_number, sort_code, branch_code, branch_address } = req.body;

    // Verify password token
    const tokenData = verifyPasswordVerificationToken(password_verification_token);
    if (!tokenData || tokenData.action !== 'update_wallet' || tokenData.userId !== userId) {
      return res.status(401).json({ error: 'Invalid or expired password verification token' });
    }

    // Verify OTP
    const isValidOTP = await verifyPaymentOTP(userId, otp, password_verification_token, 'update_wallet');
    if (!isValidOTP) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Check if wallet exists and get current bank details
    const walletCheck = await pool.query(
      'SELECT id, account_name, bank_name, account_number FROM wallets WHERE user_id = $1',
      [userId]
    );

    const currentWallet = walletCheck.rows.length > 0 ? walletCheck.rows[0] : null;

    // Check if user is trying to remove bank details (setting to null/empty)
    // Only check removal if wallet exists and has bank details currently
    if (currentWallet && currentWallet.account_name && currentWallet.bank_name && currentWallet.account_number) {
      const isRemovingAccountName = account_name !== undefined && (!account_name || account_name.trim() === '');
      const isRemovingBankName = bank_name !== undefined && (!bank_name || bank_name.trim() === '');
      const isRemovingAccountNumber = account_number !== undefined && (!account_number || account_number.trim() === '');

      // If trying to remove any critical bank detail, check if user is in active groups
      if (isRemovingAccountName || isRemovingBankName || isRemovingAccountNumber) {
        // Check if user is in any active groups
        const activeGroupsCheck = await pool.query(
          `SELECT COUNT(*) as group_count
           FROM group_members gm
           JOIN groups g ON gm.group_id = g.id
           WHERE gm.user_id = $1 AND gm.status = $2 AND g.status != $3`,
          [userId, 'active', 'closed']
        );

        const activeGroupsCount = parseInt(activeGroupsCheck.rows[0].group_count) || 0;

        if (activeGroupsCount > 0) {
          return res.status(400).json({
            error: `Cannot remove bank details. You must leave all groups first. You are currently a member of ${activeGroupsCount} group(s).`,
            activeGroupsCount,
          });
        }
      }
    }

    if (walletCheck.rows.length === 0) {
      // Validate that required bank details are provided when creating wallet
      if (!account_name || !bank_name || !account_number) {
        return res.status(400).json({
          error: 'Account name, bank name, and account number are required',
        });
      }

      // Create wallet if it doesn't exist (only when user explicitly adds payment details)
      await pool.query(
        'INSERT INTO wallets (user_id, account_name, bank_name, account_number, iban, swift_bic, routing_number, sort_code, branch_code, branch_address, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0)',
        [userId, account_name, bank_name, account_number, iban || null, swift_bic || null, routing_number || null, sort_code || null, branch_code || null, branch_address || null]
      );
    } else {
      // Update existing wallet
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

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(userId);
      await pool.query(
        `UPDATE wallets SET ${updates.join(', ')} WHERE user_id = $${paramCount}`,
        values
      );
    }

    // Get user info for email notification
    const userResult = await pool.query(
      'SELECT email, name FROM users WHERE id = $1',
      [userId]
    );

    const userEmail = userResult.rows[0]?.email;
    const userName = userResult.rows[0]?.name;

    // Return updated wallet with all currency balances
    const walletDetailsResult = await pool.query(
      'SELECT account_number, bank_name, account_name, iban, swift_bic, routing_number, sort_code, branch_code, branch_address FROM wallets WHERE user_id = $1',
      [userId]
    );

    // Get all currency balances
    const { getAllCurrencyBalances } = require('../utils/walletHelpers');
    const balances = await getAllCurrencyBalances(userId);

    const wallet = walletDetailsResult.rows[0] || {};
    const result = {
      account_number: wallet.account_number || null,
      bank_name: wallet.bank_name || null,
      account_name: wallet.account_name || null,
      iban: wallet.iban || null,
      swift_bic: wallet.swift_bic || null,
      routing_number: wallet.routing_number || null,
      sort_code: wallet.sort_code || null,
      branch_code: wallet.branch_code || null,
      branch_address: wallet.branch_address || null,
      balances: balances,
      totalBalances: balances.length,
    };

    // Send security email notification
    try {
      if (userEmail && userName) {
        const updatedFields = [];
        if (account_name !== undefined) updatedFields.push('account name');
        if (bank_name !== undefined) updatedFields.push('bank name');
        if (account_number !== undefined) updatedFields.push('account number');
        if (iban !== undefined) updatedFields.push('IBAN');
        if (swift_bic !== undefined) updatedFields.push('SWIFT/BIC');
        if (routing_number !== undefined) updatedFields.push('routing number');
        if (sort_code !== undefined) updatedFields.push('sort code');
        if (branch_code !== undefined) updatedFields.push('branch code');
        if (branch_address !== undefined) updatedFields.push('branch address');

        await sendSecurityEmail(
          userEmail,
          userName,
          'wallet_details_updated',
          `You updated your wallet details: ${updatedFields.join(', ')}`,
          {
            updatedFields,
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
      action: 'wallet_details_updated',
      amount: 0,
      currency: null,
      status: 'success',
      paymentProvider: null,
      metadata: {
        updatedFields: account_name !== undefined ? 'account_name' : null,
      },
    });

    res.json({
      message: 'Wallet details updated successfully',
      wallet: result,
    });
  } catch (error) {
    console.error('Update wallet error:', error);
    res.status(500).json({ error: 'Server error updating wallet' });
  }
});

// Delete account
router.delete('/account', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete user (cascade will handle related records due to ON DELETE CASCADE)
    // This will delete: wallets, transactions, group_members, birthday_contributions, otps
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Server error deleting account' });
  }
});

// Get notification preferences
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT notify_7_days_before, notify_1_day_before, notify_same_day,
              notify_chat_mentions, notify_chat_all_messages
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      notify_7_days_before: result.rows[0].notify_7_days_before ?? true,
      notify_1_day_before: result.rows[0].notify_1_day_before ?? true,
      notify_same_day: result.rows[0].notify_same_day ?? true,
      notify_chat_mentions: result.rows[0].notify_chat_mentions ?? true,
      notify_chat_all_messages: result.rows[0].notify_chat_all_messages ?? false,
    });
  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update notification preferences
router.put('/notifications', authenticate, [
  body('notify_7_days_before').optional().isBoolean(),
  body('notify_1_day_before').optional().isBoolean(),
  body('notify_same_day').optional().isBoolean(),
  body('notify_chat_mentions').optional().isBoolean(),
  body('notify_chat_all_messages').optional().isBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { notify_7_days_before, notify_1_day_before, notify_same_day, notify_chat_mentions, notify_chat_all_messages } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (notify_7_days_before !== undefined) {
      updates.push(`notify_7_days_before = $${paramCount++}`);
      values.push(notify_7_days_before);
    }
    if (notify_1_day_before !== undefined) {
      updates.push(`notify_1_day_before = $${paramCount++}`);
      values.push(notify_1_day_before);
    }
    if (notify_same_day !== undefined) {
      updates.push(`notify_same_day = $${paramCount++}`);
      values.push(notify_same_day);
    }
    if (notify_chat_mentions !== undefined) {
      updates.push(`notify_chat_mentions = $${paramCount++}`);
      values.push(notify_chat_mentions);
    }
    if (notify_chat_all_messages !== undefined) {
      updates.push(`notify_chat_all_messages = $${paramCount++}`);
      values.push(notify_chat_all_messages);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING notify_7_days_before, notify_1_day_before, notify_same_day, notify_chat_mentions, notify_chat_all_messages`;
    const result = await pool.query(query, values);

    res.json({
      message: 'Notification preferences updated successfully',
      preferences: {
        notify_7_days_before: result.rows[0].notify_7_days_before,
        notify_1_day_before: result.rows[0].notify_1_day_before,
        notify_same_day: result.rows[0].notify_same_day,
        notify_chat_mentions: result.rows[0].notify_chat_mentions ?? true,
        notify_chat_all_messages: result.rows[0].notify_chat_all_messages ?? false,
      },
    });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register/Update push token
router.post('/push-token', authenticate, [
  body('pushToken').trim().notEmpty().withMessage('Push token is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { pushToken } = req.body;

    // Update user's push token
    await pool.query(
      'UPDATE users SET expo_push_token = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [pushToken, userId]
    );

    res.json({ message: 'Push token registered successfully' });
  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ error: 'Server error registering push token' });
  }
});

// Get email preferences
router.get('/email-preferences', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT 
        email_pref_payment_success,
        email_pref_autopay_success,
        email_pref_autopay_disabled,
        email_pref_payment_failure,
        email_pref_withdrawal_request,
        email_pref_withdrawal_completed,
        email_pref_withdrawal_failed,
        email_pref_security,
        email_pref_deadline_update,
        email_pref_contribution_amount_update,
        email_pref_birthday_reminder,
        email_pref_comprehensive_birthday_reminder,
        email_pref_comprehensive_reminder,
        email_pref_overdue_contribution,
        email_pref_admin_overdue_notification,
        email_pref_admin_upcoming_deadline,
        email_pref_max_members_update,
        email_pref_member_left_subscription,
        email_pref_monthly_newsletter
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      emailPreferences: {
        // Payment & Transaction Emails
        payment_success: result.rows[0].email_pref_payment_success ?? true,
        autopay_success: result.rows[0].email_pref_autopay_success ?? true,
        autopay_disabled: result.rows[0].email_pref_autopay_disabled ?? true,
        payment_failure: result.rows[0].email_pref_payment_failure ?? true,
        withdrawal_request: result.rows[0].email_pref_withdrawal_request ?? true,
        withdrawal_completed: result.rows[0].email_pref_withdrawal_completed ?? true,
        withdrawal_failed: result.rows[0].email_pref_withdrawal_failed ?? true,
        security: result.rows[0].email_pref_security ?? true,
        
        // Group Updates (Important)
        deadline_update: result.rows[0].email_pref_deadline_update ?? true,
        contribution_amount_update: result.rows[0].email_pref_contribution_amount_update ?? true,
        
        // Birthday Emails
        birthday_reminder: result.rows[0].email_pref_birthday_reminder ?? false,
        comprehensive_birthday_reminder: result.rows[0].email_pref_comprehensive_birthday_reminder ?? false,
        
        // Reminder Emails
        comprehensive_reminder: result.rows[0].email_pref_comprehensive_reminder ?? false,
        overdue_contribution: result.rows[0].email_pref_overdue_contribution ?? false,
        admin_overdue_notification: result.rows[0].email_pref_admin_overdue_notification ?? false,
        admin_upcoming_deadline: result.rows[0].email_pref_admin_upcoming_deadline ?? false,
        
        // Group Updates (Less Critical)
        max_members_update: result.rows[0].email_pref_max_members_update ?? false,
        member_left_subscription: result.rows[0].email_pref_member_left_subscription ?? false,
        
        // Newsletter
        monthly_newsletter: result.rows[0].email_pref_monthly_newsletter ?? false,
      },
    });
  } catch (error) {
    console.error('Get email preferences error:', error);
    res.status(500).json({ error: 'Server error retrieving email preferences' });
  }
});

// Update email preferences
router.put('/email-preferences', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      payment_success,
      autopay_success,
      autopay_disabled,
      payment_failure,
      withdrawal_request,
      withdrawal_completed,
      withdrawal_failed,
      security,
      deadline_update,
      contribution_amount_update,
      birthday_reminder,
      comprehensive_birthday_reminder,
      comprehensive_reminder,
      overdue_contribution,
      admin_overdue_notification,
      admin_upcoming_deadline,
      max_members_update,
      member_left_subscription,
      monthly_newsletter,
    } = req.body;

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    const preferences = {
      email_pref_payment_success: payment_success,
      email_pref_autopay_success: autopay_success,
      email_pref_autopay_disabled: autopay_disabled,
      email_pref_payment_failure: payment_failure,
      email_pref_withdrawal_request: withdrawal_request,
      email_pref_withdrawal_completed: withdrawal_completed,
      email_pref_withdrawal_failed: withdrawal_failed,
      email_pref_security: security,
      email_pref_deadline_update: deadline_update,
      email_pref_contribution_amount_update: contribution_amount_update,
      email_pref_birthday_reminder: birthday_reminder,
      email_pref_comprehensive_birthday_reminder: comprehensive_birthday_reminder,
      email_pref_comprehensive_reminder: comprehensive_reminder,
      email_pref_overdue_contribution: overdue_contribution,
      email_pref_admin_overdue_notification: admin_overdue_notification,
      email_pref_admin_upcoming_deadline: admin_upcoming_deadline,
      email_pref_max_members_update: max_members_update,
      email_pref_member_left_subscription: member_left_subscription,
      email_pref_monthly_newsletter: monthly_newsletter,
    };

    for (const [key, value] of Object.entries(preferences)) {
      if (value !== undefined && value !== null) {
        updates.push(`${key} = $${paramCount++}`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No preferences provided to update' });
    }

    values.push(userId);
    const query = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount}`;
    
    await pool.query(query, values);

    res.json({ message: 'Email preferences updated successfully' });
  } catch (error) {
    console.error('Update email preferences error:', error);
    res.status(500).json({ error: 'Server error updating email preferences' });
  }
});

module.exports = router;
