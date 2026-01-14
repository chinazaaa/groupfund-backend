const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { formatAmount } = require('../utils/currency');
const { contributionLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Helper function to get the last day of a month
function getLastDayOfMonth(year, month) {
  // month is 0-indexed (0 = January, 11 = December)
  return new Date(year, month + 1, 0).getDate();
}

// Helper function to get deadline date, handling months with fewer days
// If deadline day is 31 but month only has 30 days, use the 30th
// If deadline day is 31 but month is February (28/29 days), use the last day of February
function getDeadlineDate(year, month, deadlineDay) {
  // month is 0-indexed (0 = January, 11 = December)
  const lastDay = getLastDayOfMonth(year, month);
  const actualDay = Math.min(deadlineDay, lastDay);
  return new Date(year, month, actualDay);
}

// Contribute to subscription (Mark as Paid)
router.post('/contribute', authenticate, contributionLimiter, async (req, res) => {
  try {
    const { groupId, amount, note } = req.body;
    const contributorId = req.user.id;

    // Validate group exists and is a subscription group
    const groupCheck = await pool.query(
      `SELECT g.*
       FROM groups g
       WHERE g.id = $1 AND g.group_type = 'subscription'`,
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription group not found' });
    }

    const group = groupCheck.rows[0];
    const groupCurrency = group.currency || 'NGN';
    
    // Get admin's bank account for this currency (for manual payment display)
    const adminBankAccount = await pool.query(
      `SELECT account_name, bank_name, account_number, iban, swift_bic, routing_number, sort_code, branch_code, branch_address, is_default
       FROM wallet_bank_accounts
       WHERE user_id = $1 AND currency = $2
       ORDER BY is_default DESC, created_at DESC
       LIMIT 1`,
      [group.admin_id, groupCurrency]
    );
    
    // Add bank account to group object for response
    if (adminBankAccount.rows.length > 0) {
      group.account_name = adminBankAccount.rows[0].account_name;
      group.bank_name = adminBankAccount.rows[0].bank_name;
      group.account_number = adminBankAccount.rows[0].account_number;
      group.iban = adminBankAccount.rows[0].iban;
      group.swift_bic = adminBankAccount.rows[0].swift_bic;
      group.routing_number = adminBankAccount.rows[0].routing_number;
      group.sort_code = adminBankAccount.rows[0].sort_code;
      group.branch_code = adminBankAccount.rows[0].branch_code;
      group.branch_address = adminBankAccount.rows[0].branch_address;
    }
    
    // Check if contributor is the admin (group creator)
    const isAdmin = group.admin_id === contributorId;

    // Check if user is active member
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, contributorId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group' });
    }

    // Check if group is closed
    if (group.status === 'closed') {
      return res.status(400).json({ error: 'This group is closed and no longer accepting contributions' });
    }

    // Calculate subscription period
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    
    let periodStart, periodEnd;
    
    if (group.subscription_frequency === 'monthly') {
      // Monthly: period is current month
      periodStart = new Date(currentYear, currentMonth - 1, 1);
      // Get last day of current month (handles 28/29/30/31 days correctly)
      const lastDay = getLastDayOfMonth(currentYear, currentMonth - 1);
      periodEnd = new Date(currentYear, currentMonth - 1, lastDay);
    } else {
      // Annual: period is current year
      periodStart = new Date(currentYear, 0, 1);
      periodEnd = new Date(currentYear, 11, 31);
    }

    const contributionAmount = parseFloat(group.contribution_amount);
    // groupCurrency already declared above
    if (!groupCurrency) {
      return res.status(400).json({ error: 'Group has no currency set. Please contact the admin.' });
    }
    const actualAmount = amount || contributionAmount;

    // Get user names
    const contributorResult = await pool.query(
      'SELECT name FROM users WHERE id = $1',
      [contributorId]
    );
    const contributorName = contributorResult.rows[0]?.name || 'Someone';
    const groupName = group.name || 'Group';

    await pool.query('BEGIN');

    try {
      // Check if contribution already exists for this period
      const existingContribution = await pool.query(
        `SELECT id, transaction_id FROM subscription_contributions 
         WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3`,
        [groupId, contributorId, periodStart]
      );

      let contributionId;
      // If admin is paying, status should be 'confirmed' (they're paying to themselves)
      // Otherwise, status is 'paid' (awaiting admin confirmation)
      const contributionStatus = isAdmin ? 'confirmed' : 'paid';

      if (existingContribution.rows.length > 0) {
        contributionId = existingContribution.rows[0].id;
        await pool.query(
          `UPDATE subscription_contributions 
           SET amount = $1, contribution_date = CURRENT_DATE, status = $2, note = $3
           WHERE id = $4`,
          [actualAmount, contributionStatus, note || null, contributionId]
        );
      } else {
        const contributionResult = await pool.query(
          `INSERT INTO subscription_contributions 
           (group_id, contributor_id, amount, contribution_date, subscription_period_start, subscription_period_end, status, note)
           VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7)
           RETURNING id`,
          [groupId, contributorId, actualAmount, periodStart, periodEnd, contributionStatus, note || null]
        );
        contributionId = contributionResult.rows[0].id;
      }

      // Create transaction records
      const existingDebit = await pool.query(
        `SELECT id FROM transactions 
         WHERE user_id = $1 AND group_id = $2 AND type = 'debit' 
           AND description LIKE $3
           AND created_at::date = CURRENT_DATE`,
        [contributorId, groupId, `%Subscription contribution for ${groupName}%`]
      );

      const existingCredit = await pool.query(
        `SELECT id FROM transactions 
         WHERE user_id = $1 AND group_id = $2 AND type = 'credit' 
           AND description LIKE $3
           AND created_at::date = CURRENT_DATE`,
        [group.admin_id, groupId, `%Subscription contribution from ${contributorName}%`]
      );

      // Transaction status should match contribution status
      const transactionStatus = isAdmin ? 'confirmed' : 'paid';
      
      if (existingDebit.rows.length === 0) {
        await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, currency, description, status)
           VALUES ($1, $2, 'debit', $3, $4, $5, $6)`,
          [contributorId, groupId, actualAmount, groupCurrency, `Subscription contribution for ${groupName}`, transactionStatus]
        );
      }

      let creditTransactionId;
      if (existingCredit.rows.length === 0) {
        const creditTransaction = await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, currency, description, status)
           VALUES ($1, $2, 'credit', $3, $4, $5, $6)
           RETURNING id`,
          [group.admin_id, groupId, actualAmount, groupCurrency, `Subscription contribution from ${contributorName} (${groupName})`, transactionStatus]
        );
        creditTransactionId = creditTransaction.rows[0].id;
      } else {
        creditTransactionId = existingCredit.rows[0].id;
      }

      // Link contribution to credit transaction
      const currentTransactionId = await pool.query(
        `SELECT transaction_id FROM subscription_contributions WHERE id = $1`,
        [contributionId]
      );
      if (!currentTransactionId.rows[0]?.transaction_id && creditTransactionId) {
        await pool.query(
          `UPDATE subscription_contributions SET transaction_id = $1 WHERE id = $2`,
          [creditTransactionId, contributionId]
        );
      }

      await pool.query('COMMIT');

      // Only notify admin if it's not the admin themselves paying
      if (!isAdmin) {
        await createNotification(
          group.admin_id,
          'subscription_contribution_paid',
          'Subscription Contribution Received',
          `${contributorName} marked their subscription contribution of ${formatAmount(actualAmount, groupCurrency)} as paid${note ? `: ${note}` : ''}`,
          groupId,
          contributorId
        );
      }

      res.json({ 
        message: isAdmin 
          ? 'Payment marked as confirmed successfully (admin payment)' 
          : 'Payment marked as paid successfully' 
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Subscription contribute error:', error);
    res.status(500).json({ error: 'Server error marking payment as paid' });
  }
});

// Confirm subscription contribution (admin or co-admin confirms payment received)
router.post('/contribute/:contributionId/confirm', authenticate, async (req, res) => {
  try {
    const { contributionId } = req.params;
    const userId = req.user.id;

    // Get contribution details
    const contributionResult = await pool.query(
      `SELECT sc.*, g.name as group_name, g.currency, g.status as group_status, g.id as group_id, u.name as contributor_name
       FROM subscription_contributions sc
       JOIN groups g ON sc.group_id = g.id
       JOIN users u ON sc.contributor_id = u.id
       WHERE sc.id = $1`,
      [contributionId]
    );

    if (contributionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contribution not found' });
    }

    const contribution = contributionResult.rows[0];
    const groupId = contribution.group_id;

    // Check if user is admin or co-admin
    const { checkGroupAdminPermissions } = require('../utils/helpers');
    const permissions = await checkGroupAdminPermissions(userId, groupId, pool);
    if (!permissions.isAdminOrCoAdmin) {
      return res.status(403).json({ error: 'Only admins or co-admins can confirm contributions' });
    }

    if (contribution.group_status === 'closed') {
      return res.status(400).json({ error: 'This group is closed and no longer accepting contribution confirmations' });
    }

    if (contribution.status !== 'paid') {
      return res.status(400).json({ error: 'Contribution is not in paid status' });
    }

    await pool.query('BEGIN');

    try {
      await pool.query(
        `UPDATE subscription_contributions SET status = 'confirmed' WHERE id = $1`,
        [contributionId]
      );

      if (contribution.transaction_id) {
        await pool.query(
          `UPDATE transactions SET status = 'confirmed' WHERE id = $1`,
          [contribution.transaction_id]
        );

        await pool.query(
          `UPDATE transactions 
           SET status = 'confirmed' 
           WHERE user_id = $1 AND group_id = $2 AND type = 'debit' 
             AND description LIKE $3 AND created_at::date = (
               SELECT created_at::date FROM transactions WHERE id = $4
             )`,
          [
            contribution.contributor_id,
            contribution.group_id,
            `%Subscription contribution for%`,
            contribution.transaction_id
          ]
        );
      }

      await pool.query('COMMIT');

      // Notify contributor
      const adminName = await pool.query(
        'SELECT name FROM users WHERE id = $1',
        [userId]
      );
      const adminNameText = adminName.rows[0]?.name || 'The admin';
      
      // Get currency from group (not from contribution, as contribution may not have currency yet)
      const groupCurrencyResult = await pool.query(
        'SELECT currency FROM groups WHERE id = $1',
        [contribution.group_id]
      );
      const contributionCurrency = groupCurrencyResult.rows[0]?.currency || 'NGN'; // Fallback for display only
      
      await createNotification(
        contribution.contributor_id,
        'subscription_contribution_confirmed',
        'Payment Confirmed',
        `${adminNameText} confirmed your payment of ${formatAmount(parseFloat(contribution.amount), contributionCurrency)}. Thank you!`,
        contribution.group_id,
        userId
      );

      res.json({ message: 'Contribution confirmed successfully' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Confirm subscription contribution error:', error);
    res.status(500).json({ error: 'Server error confirming contribution' });
  }
});

// Mark subscription contribution as not received (admin or co-admin marks payment as not received)
router.post('/contribute/:contributionId/reject', authenticate, async (req, res) => {
  try {
    const { contributionId } = req.params;
    const userId = req.user.id;

    // Get contribution details
    const contributionResult = await pool.query(
      `SELECT sc.*, g.name as group_name, g.currency, g.status as group_status, g.id as group_id, g.group_type, u.name as contributor_name
       FROM subscription_contributions sc
       JOIN groups g ON sc.group_id = g.id
       JOIN users u ON sc.contributor_id = u.id
       WHERE sc.id = $1`,
      [contributionId]
    );

    if (contributionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contribution not found' });
    }

    const contribution = contributionResult.rows[0];

    if (contribution.group_type !== 'subscription') {
      return res.status(400).json({ error: 'This is not a subscription contribution' });
    }

    // Check if user is admin or co-admin
    const { checkGroupAdminPermissions } = require('../utils/helpers');
    const permissions = await checkGroupAdminPermissions(userId, contribution.group_id, pool);
    if (!permissions.isAdminOrCoAdmin) {
      return res.status(403).json({ error: 'Only admins or co-admins can reject contributions' });
    }

    if (contribution.group_status === 'closed') {
      return res.status(400).json({ error: 'This group is closed and no longer accepting contribution rejections' });
    }

    if (contribution.status !== 'paid') {
      return res.status(400).json({ error: 'Contribution is not in paid status' });
    }

    await pool.query('BEGIN');

    try {
      await pool.query(
        `UPDATE subscription_contributions SET status = 'not_received' WHERE id = $1`,
        [contributionId]
      );

      if (contribution.transaction_id) {
        await pool.query(
          `UPDATE transactions SET status = 'not_received' WHERE id = $1`,
          [contribution.transaction_id]
        );

        await pool.query(
          `UPDATE transactions 
           SET status = 'not_received' 
           WHERE user_id = $1 AND group_id = $2 AND type = 'debit' 
             AND description LIKE $3 AND created_at::date = (
               SELECT created_at::date FROM transactions WHERE id = $4
             )`,
          [
            contribution.contributor_id,
            contribution.group_id,
            `%Subscription contribution for%`,
            contribution.transaction_id
          ]
        );
      }

      await pool.query('COMMIT');

      const adminName = await pool.query(
        'SELECT name FROM users WHERE id = $1',
        [userId]
      );
      const adminNameText = adminName.rows[0]?.name || 'The admin';
      
      await createNotification(
        contribution.contributor_id,
        'subscription_contribution_not_received',
        'Payment Not Received',
        `${adminNameText} marked your payment as not received. Please check that you've paid correctly or try again.`,
        contribution.group_id,
        userId
      );

      res.json({ message: 'Contribution marked as not received successfully' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Reject subscription contribution error:', error);
    res.status(500).json({ error: 'Server error rejecting contribution' });
  }
});

// Get upcoming subscription deadlines
router.get('/upcoming', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId, days = 30 } = req.query;

    let query;
    let params;

    if (groupId) {
      const memberCheck = await pool.query(
        'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );

      if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
        return res.json({ subscriptions: [] });
      }

      query = `
        SELECT 
          g.id as group_id, g.name as group_name, g.currency, g.contribution_amount,
          g.subscription_frequency, g.subscription_platform,
          g.subscription_deadline_day, g.subscription_deadline_month,
          g.admin_id, u.name as admin_name
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        LEFT JOIN users u ON g.admin_id = u.id
        WHERE g.id = $1 AND g.group_type = 'subscription' AND gm.user_id = $2 AND gm.status = 'active'
      `;
      params = [groupId, userId];
    } else {
      query = `
        SELECT DISTINCT
          g.id as group_id, g.name as group_name, g.currency, g.contribution_amount,
          g.subscription_frequency, g.subscription_platform,
          g.subscription_deadline_day, g.subscription_deadline_month,
          g.admin_id, u.name as admin_name
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        LEFT JOIN users u ON g.admin_id = u.id
        WHERE gm.user_id = $1 AND g.group_type = 'subscription' AND gm.status = 'active'
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    const upcomingSubscriptions = result.rows.map(group => {
      let nextDeadline;
      let daysUntilDeadline;

      if (group.subscription_frequency === 'monthly') {
        // Next deadline is the deadline day of current or next month
        // Handle months with fewer days (e.g., if deadline is 31 but month only has 30 days)
        if (currentDay <= group.subscription_deadline_day) {
          nextDeadline = getDeadlineDate(currentYear, currentMonth - 1, group.subscription_deadline_day);
        } else {
          nextDeadline = getDeadlineDate(currentYear, currentMonth, group.subscription_deadline_day);
        }
      } else {
        // Annual: deadline is on specific month and day
        // Handle months with fewer days (e.g., if deadline is 31 but month only has 30 days)
        if (currentMonth < group.subscription_deadline_month || 
            (currentMonth === group.subscription_deadline_month && currentDay <= group.subscription_deadline_day)) {
          nextDeadline = getDeadlineDate(currentYear, group.subscription_deadline_month - 1, group.subscription_deadline_day);
        } else {
          nextDeadline = getDeadlineDate(currentYear + 1, group.subscription_deadline_month - 1, group.subscription_deadline_day);
        }
      }

      nextDeadline.setHours(0, 0, 0, 0);
      daysUntilDeadline = Math.ceil((nextDeadline - today) / (1000 * 60 * 60 * 24));

      // Check if user has paid for this period
      let periodStart;
      if (group.subscription_frequency === 'monthly') {
        periodStart = new Date(currentYear, currentMonth - 1, 1);
      } else {
        periodStart = new Date(currentYear, 0, 1);
      }

      return {
        ...group,
        next_deadline: nextDeadline.toISOString().split('T')[0],
        days_until_deadline: daysUntilDeadline,
        has_paid: false, // Will be updated below
      };
    }).filter(sub => sub.days_until_deadline >= 0 && sub.days_until_deadline <= parseInt(days));

    // Check payment status for each subscription
    for (const sub of upcomingSubscriptions) {
      let periodStart;
      if (sub.subscription_frequency === 'monthly') {
        periodStart = new Date(currentYear, currentMonth - 1, 1);
      } else {
        periodStart = new Date(currentYear, 0, 1);
      }

      const paymentCheck = await pool.query(
        `SELECT status FROM subscription_contributions 
         WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3`,
        [sub.group_id, userId, periodStart]
      );

      sub.has_paid = paymentCheck.rows.length > 0 && 
                     (paymentCheck.rows[0].status === 'paid' || paymentCheck.rows[0].status === 'confirmed');
      
      // Get admin's bank account for this currency (default or most recent)
      const groupCurrency = sub.currency || 'NGN';
      const adminBankAccount = await pool.query(
        `SELECT account_name, bank_name, account_number, iban, swift_bic, routing_number, sort_code, branch_code, branch_address, is_default
         FROM wallet_bank_accounts
         WHERE user_id = $1 AND currency = $2
         ORDER BY is_default DESC, created_at DESC
         LIMIT 1`,
        [sub.admin_id, groupCurrency]
      );
      
      if (adminBankAccount.rows.length > 0) {
        sub.admin_account_name = adminBankAccount.rows[0].account_name;
        sub.admin_bank_name = adminBankAccount.rows[0].bank_name;
        sub.admin_account_number = adminBankAccount.rows[0].account_number;
        sub.admin_iban = adminBankAccount.rows[0].iban;
        sub.admin_swift_bic = adminBankAccount.rows[0].swift_bic;
        sub.admin_routing_number = adminBankAccount.rows[0].routing_number;
        sub.admin_sort_code = adminBankAccount.rows[0].sort_code;
        sub.admin_branch_code = adminBankAccount.rows[0].branch_code;
        sub.admin_branch_address = adminBankAccount.rows[0].branch_address;
      }
    }

    res.json({ subscriptions: upcomingSubscriptions });
  } catch (error) {
    console.error('Get upcoming subscriptions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current payment status for a subscription group (simple check for frontend)
router.get('/:groupId/payment-status', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Check if user is active member of the group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'You are not an active member of this group' });
    }

    // Get group details
    const groupResult = await pool.query(
      `SELECT id, name, subscription_frequency, admin_id
       FROM groups WHERE id = $1 AND group_type = 'subscription'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription group not found' });
    }

    const group = groupResult.rows[0];
    const isAdmin = group.admin_id === userId;

    // Calculate current period
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    
    let periodStart;
    if (group.subscription_frequency === 'monthly') {
      periodStart = new Date(currentYear, currentMonth - 1, 1);
    } else {
      periodStart = new Date(currentYear, 0, 1);
    }
    periodStart.setHours(0, 0, 0, 0);

    // Check payment status for current period
    const paymentCheck = await pool.query(
      `SELECT id, status, contribution_date, amount, note, created_at
       FROM subscription_contributions 
       WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3`,
      [groupId, userId, periodStart]
    );

    let hasPaid = false;
    let paymentStatus = 'not_paid';
    let contributionDate = null;
    let amount = null;
    let note = null;
    let contributionId = null;

    if (paymentCheck.rows.length > 0) {
      const contribution = paymentCheck.rows[0];
      paymentStatus = contribution.status;
      hasPaid = contribution.status === 'paid' || contribution.status === 'confirmed';
      contributionDate = contribution.contribution_date;
      amount = parseFloat(contribution.amount);
      note = contribution.note;
      contributionId = contribution.id;
    }

    res.json({
      group_id: group.id,
      group_name: group.name,
      period_start: periodStart.toISOString().split('T')[0],
      has_paid: hasPaid,
      payment_status: paymentStatus,
      contribution_date: contributionDate,
      amount: amount,
      note: note,
      contribution_id: contributionId,
      is_admin: isAdmin
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get subscription compliance for a specific period (who has paid, who hasn't)
router.get('/:groupId/compliance', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { periodStart } = req.query; // ISO date string (e.g., "2024-12-01")
    const userId = req.user.id;

    // Check if user is active member of the group
    const memberCheck = await pool.query(
      'SELECT role, status FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'You are not an active member of this group' });
    }

    // Get group details
    const groupResult = await pool.query(
      `SELECT id, name, contribution_amount, currency, subscription_frequency, 
              subscription_deadline_day, subscription_deadline_month, admin_id
       FROM groups WHERE id = $1 AND group_type = 'subscription'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription group not found' });
    }

    const group = groupResult.rows[0];
    
    // Determine period start
    let periodStartDate;
    if (periodStart) {
      periodStartDate = new Date(periodStart);
    } else {
      // Default to current period
      const today = new Date();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      if (group.subscription_frequency === 'monthly') {
        periodStartDate = new Date(currentYear, currentMonth - 1, 1);
      } else {
        periodStartDate = new Date(currentYear, 0, 1);
      }
    }
    
    periodStartDate.setHours(0, 0, 0, 0);
    
    // Calculate period end
    let periodEndDate;
    if (group.subscription_frequency === 'monthly') {
      // Get last day of the month (handles 28/29/30/31 days correctly)
      const lastDay = getLastDayOfMonth(periodStartDate.getFullYear(), periodStartDate.getMonth());
      periodEndDate = new Date(periodStartDate.getFullYear(), periodStartDate.getMonth(), lastDay);
    } else {
      periodEndDate = new Date(periodStartDate.getFullYear(), 11, 31);
    }
    periodEndDate.setHours(23, 59, 59, 999);

    // Get all active members
    const membersResult = await pool.query(
      `SELECT u.id, u.name, u.email, gm.joined_at
       FROM users u
       JOIN group_members gm ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND gm.status = 'active'
       ORDER BY u.name`,
      [groupId]
    );

    const complianceData = [];
    let paidCount = 0;
    let unpaidCount = 0;
    let pendingCount = 0;

    for (const member of membersResult.rows) {
      const memberJoinDate = new Date(member.joined_at);
      memberJoinDate.setHours(0, 0, 0, 0);
      
      // Only include members who joined before or during the period
      if (memberJoinDate > periodEndDate) {
        continue; // Member joined after this period
      }

      // Check contribution status for this period
      const contributionCheck = await pool.query(
        `SELECT id, status, contribution_date, amount, note, created_at
         FROM subscription_contributions 
         WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3`,
        [groupId, member.id, periodStartDate]
      );

      let status = 'not_paid';
      let contributionDate = null;
      let amount = null;
      let note = null;
      let contributionId = null;
      let createdAt = null;

      if (contributionCheck.rows.length > 0) {
        const contribution = contributionCheck.rows[0];
        status = contribution.status;
        contributionDate = contribution.contribution_date;
        amount = parseFloat(contribution.amount);
        note = contribution.note;
        contributionId = contribution.id;
        createdAt = contribution.created_at;
      }

      const isPaid = status === 'paid' || status === 'confirmed';
      const isPending = status === 'paid'; // Awaiting confirmation
      const isUnpaid = status === 'not_paid' || status === 'not_received';

      if (isPaid && status === 'confirmed') paidCount++;
      else if (isPending) pendingCount++;
      else unpaidCount++;

      complianceData.push({
        member_id: member.id,
        member_name: member.name,
        member_email: member.email,
        joined_at: member.joined_at,
        status: status,
        contribution_date: contributionDate,
        amount: amount,
        note: note,
        contribution_id: contributionId,
        created_at: createdAt,
        is_paid: isPaid,
        is_pending: isPending,
        is_unpaid: isUnpaid,
        is_admin: member.id === group.admin_id
      });
    }

    res.json({
      group_id: group.id,
      group_name: group.name,
      currency: group.currency || 'NGN',
      contribution_amount: parseFloat(group.contribution_amount),
      subscription_frequency: group.subscription_frequency,
      period_start: periodStartDate.toISOString().split('T')[0],
      period_end: periodEndDate.toISOString().split('T')[0],
      admin_id: group.admin_id,
      summary: {
        total_members: complianceData.length,
        paid_count: paidCount,
        pending_count: pendingCount,
        unpaid_count: unpaidCount
      },
      members: complianceData
    });
  } catch (error) {
    console.error('Get subscription compliance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get subscription payment history (past periods)
router.get('/:groupId/history', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { limit = 12 } = req.query; // Number of past periods to return
    const userId = req.user.id;

    // Check if user is active member of the group
    const memberCheck = await pool.query(
      'SELECT role, status FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'You are not an active member of this group' });
    }

    // Get group details
    const groupResult = await pool.query(
      `SELECT id, name, contribution_amount, currency, subscription_frequency, 
              subscription_deadline_day, subscription_deadline_month
       FROM groups WHERE id = $1 AND group_type = 'subscription'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription group not found' });
    }

    const group = groupResult.rows[0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    // Get all unique periods from contributions
    const periodsResult = await pool.query(
      `SELECT DISTINCT subscription_period_start, subscription_period_end
       FROM subscription_contributions
       WHERE group_id = $1
       ORDER BY subscription_period_start DESC
       LIMIT $2`,
      [groupId, parseInt(limit)]
    );

    const history = [];

    for (const period of periodsResult.rows) {
      const periodStart = new Date(period.subscription_period_start);
      const periodEnd = new Date(period.subscription_period_end);

      // Get all contributions for this period
      const contributionsResult = await pool.query(
        `SELECT sc.*, u.name as contributor_name, u.email as contributor_email
         FROM subscription_contributions sc
         JOIN users u ON sc.contributor_id = u.id
         WHERE sc.group_id = $1 AND sc.subscription_period_start = $2
         ORDER BY sc.created_at DESC`,
        [groupId, periodStart]
      );

      const paid = contributionsResult.rows.filter(c => c.status === 'confirmed').length;
      const pending = contributionsResult.rows.filter(c => c.status === 'paid').length;
      const unpaid = contributionsResult.rows.filter(c => c.status === 'not_paid' || c.status === 'not_received').length;

      // Get total active members during this period
      const membersCountResult = await pool.query(
        `SELECT COUNT(*) as count
         FROM group_members
         WHERE group_id = $1 AND status = 'active' AND joined_at <= $2`,
        [groupId, periodEnd]
      );
      const totalMembers = parseInt(membersCountResult.rows[0]?.count || 0);

      history.push({
        period_start: periodStart.toISOString().split('T')[0],
        period_end: periodEnd.toISOString().split('T')[0],
        total_members: totalMembers,
        paid_count: paid,
        pending_count: pending,
        unpaid_count: unpaid,
        contributions: contributionsResult.rows.map(c => ({
          id: c.id,
          contributor_id: c.contributor_id,
          contributor_name: c.contributor_name,
          contributor_email: c.contributor_email,
          amount: parseFloat(c.amount),
          status: c.status,
          contribution_date: c.contribution_date,
          note: c.note,
          created_at: c.created_at
        }))
      });
    }

    res.json({
      group_id: group.id,
      group_name: group.name,
      subscription_frequency: group.subscription_frequency,
      history: history
    });
  } catch (error) {
    console.error('Get subscription history error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

