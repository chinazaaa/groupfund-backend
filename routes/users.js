const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

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
      `SELECT g.id, g.name, gm.joined_at, gm.status
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

            if (contributionCheck.rows.length > 0) {
              status = contributionCheck.rows[0].status;
              contributionDate = contributionCheck.rows[0].contribution_date ? new Date(contributionCheck.rows[0].contribution_date) : null;
              isFullyPaid = (status === 'confirmed');
              
              // On-time = confirmed AND paid on or before birthday
              if (isFullyPaid && contributionDate) {
                contributionDate.setHours(0, 0, 0, 0);
                paidOnTime = contributionDate <= thisYearBirthday;
              }
              
              // Total contributions = only confirmed contributions
              if (isFullyPaid) {
                totalContributions++;
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

    // Get reports count for this user
    const reportsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_reports,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_reports,
        COUNT(*) FILTER (WHERE status IN ('pending', 'resolved')) as total_valid_reports
       FROM reports 
       WHERE reported_user_id = $1`,
      [userId]
    );

    const pendingReports = parseInt(reportsResult.rows[0]?.pending_reports || 0);
    const resolvedReports = parseInt(reportsResult.rows[0]?.resolved_reports || 0);
    const totalValidReports = parseInt(reportsResult.rows[0]?.total_valid_reports || 0);

    // Reliability starts at 100% and only reduces for overdue contributions and reports
    let reliabilityScore = 100; // Start at 100% (excellent)
    let onTimeRate = 100;

    // Calculate total expected contributions (confirmed + overdue)
    // This ensures we account for overdue contributions even when there are no confirmed ones yet
    const totalExpected = totalContributions + totalOverdue;

    // Only reduce reliability if there are overdue contributions
    // If deadlines haven't passed yet, reliability remains at 100%
    if (totalOverdue > 0 && totalExpected > 0) {
      // Calculate on-time rate based on on-time vs total expected (confirmed + overdue)
      onTimeRate = (totalOnTime / totalExpected) * 100;
      reliabilityScore = Math.round(onTimeRate);
    } else if (totalOverdue === 0 && totalContributions > 0) {
      // If no overdue but there are confirmed contributions, calculate based on on-time rate
      onTimeRate = (totalOnTime / totalContributions) * 100;
      reliabilityScore = Math.round(onTimeRate);
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
    userData.total_valid_reports = totalValidReports;
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

// Get wallet balance
router.get('/wallet', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT balance, account_number, bank_name, account_name, iban, swift_bic, routing_number, sort_code, branch_code, branch_address FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update wallet/payment details
router.put('/wallet', authenticate, [
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
    const { account_name, bank_name, account_number, iban, swift_bic, routing_number, sort_code, branch_code, branch_address } = req.body;

    // Check if wallet exists
    const walletCheck = await pool.query(
      'SELECT id FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (walletCheck.rows.length === 0) {
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

    // Return updated wallet
    const result = await pool.query(
      'SELECT balance, account_number, bank_name, account_name, iban, swift_bic, routing_number, sort_code, branch_code, branch_address FROM wallets WHERE user_id = $1',
      [userId]
    );

    res.json({ wallet: result.rows[0] });
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
      `SELECT notify_7_days_before, notify_1_day_before, notify_same_day
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
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { notify_7_days_before, notify_1_day_before, notify_same_day } = req.body;

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

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING notify_7_days_before, notify_1_day_before, notify_same_day`;
    const result = await pool.query(query, values);

    res.json({
      message: 'Notification preferences updated successfully',
      preferences: {
        notify_7_days_before: result.rows[0].notify_7_days_before,
        notify_1_day_before: result.rows[0].notify_1_day_before,
        notify_same_day: result.rows[0].notify_same_day,
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

module.exports = router;
