const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { formatAmount } = require('../utils/currency');
const { contributionLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Contribute to subscription (Mark as Paid)
router.post('/contribute', authenticate, contributionLimiter, async (req, res) => {
  try {
    const { groupId, amount, note } = req.body;
    const contributorId = req.user.id;

    // Validate group exists and is a subscription group
    const groupCheck = await pool.query(
      `SELECT g.*, u.account_number, u.bank_name, u.account_name
       FROM groups g
       LEFT JOIN wallets u ON g.admin_id = u.user_id
       WHERE g.id = $1 AND g.group_type = 'subscription'`,
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription group not found' });
    }

    const group = groupCheck.rows[0];

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
      periodEnd = new Date(currentYear, currentMonth, 0); // Last day of current month
    } else {
      // Annual: period is current year
      periodStart = new Date(currentYear, 0, 1);
      periodEnd = new Date(currentYear, 11, 31);
    }

    const contributionAmount = parseFloat(group.contribution_amount);
    const groupCurrency = group.currency || 'NGN';
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

      if (existingContribution.rows.length > 0) {
        contributionId = existingContribution.rows[0].id;
        await pool.query(
          `UPDATE subscription_contributions 
           SET amount = $1, contribution_date = CURRENT_DATE, status = 'paid', note = $2
           WHERE id = $3`,
          [actualAmount, note || null, contributionId]
        );
      } else {
        const contributionResult = await pool.query(
          `INSERT INTO subscription_contributions 
           (group_id, contributor_id, amount, contribution_date, subscription_period_start, subscription_period_end, status, note)
           VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, 'paid', $6)
           RETURNING id`,
          [groupId, contributorId, actualAmount, periodStart, periodEnd, note || null]
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

      if (existingDebit.rows.length === 0) {
        await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, description, status)
           VALUES ($1, $2, 'debit', $3, $4, 'paid')`,
          [contributorId, groupId, actualAmount, `Subscription contribution for ${groupName}`]
        );
      }

      let creditTransactionId;
      if (existingCredit.rows.length === 0) {
        const creditTransaction = await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, description, status)
           VALUES ($1, $2, 'credit', $3, $4, 'paid')
           RETURNING id`,
          [group.admin_id, groupId, actualAmount, `Subscription contribution from ${contributorName} (${groupName})`]
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

      // Notify admin that contribution was marked as paid
      await createNotification(
        group.admin_id,
        'subscription_contribution_paid',
        'Subscription Contribution Received',
        `${contributorName} marked their subscription contribution of ${formatAmount(actualAmount, groupCurrency)} as paid${note ? `: ${note}` : ''}`,
        groupId,
        contributorId
      );

      res.json({ message: 'Payment marked as paid successfully' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Subscription contribute error:', error);
    res.status(500).json({ error: 'Server error marking payment as paid' });
  }
});

// Confirm subscription contribution (admin confirms payment received)
router.post('/contribute/:contributionId/confirm', authenticate, async (req, res) => {
  try {
    const { contributionId } = req.params;
    const adminId = req.user.id;

    // Get contribution details and verify admin owns the group
    const contributionResult = await pool.query(
      `SELECT sc.*, g.name as group_name, g.currency, g.status as group_status, g.admin_id, u.name as contributor_name
       FROM subscription_contributions sc
       JOIN groups g ON sc.group_id = g.id
       JOIN users u ON sc.contributor_id = u.id
       WHERE sc.id = $1 AND g.admin_id = $2`,
      [contributionId, adminId]
    );

    if (contributionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contribution not found or you are not the group admin' });
    }

    const contribution = contributionResult.rows[0];

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
        [adminId]
      );
      const adminNameText = adminName.rows[0]?.name || 'The admin';
      const contributionCurrency = contribution.currency || 'NGN';
      
      await createNotification(
        contribution.contributor_id,
        'subscription_contribution_confirmed',
        'Payment Confirmed',
        `${adminNameText} confirmed your payment of ${formatAmount(parseFloat(contribution.amount), contributionCurrency)}. Thank you!`,
        contribution.group_id,
        adminId
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

// Mark subscription contribution as not received (admin marks payment as not received)
router.post('/contribute/:contributionId/reject', authenticate, async (req, res) => {
  try {
    const { contributionId } = req.params;
    const adminId = req.user.id;

    const contributionResult = await pool.query(
      `SELECT sc.*, g.name as group_name, g.currency, g.status as group_status, g.admin_id, u.name as contributor_name
       FROM subscription_contributions sc
       JOIN groups g ON sc.group_id = g.id
       JOIN users u ON sc.contributor_id = u.id
       WHERE sc.id = $1 AND g.admin_id = $2`,
      [contributionId, adminId]
    );

    if (contributionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contribution not found or you are not the group admin' });
    }

    const contribution = contributionResult.rows[0];

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
        [adminId]
      );
      const adminNameText = adminName.rows[0]?.name || 'The admin';
      
      await createNotification(
        contribution.contributor_id,
        'subscription_contribution_not_received',
        'Payment Not Received',
        `${adminNameText} marked your payment as not received. Please check that you've paid correctly or try again.`,
        contribution.group_id,
        adminId
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
          g.admin_id, u.name as admin_name, u.account_number, u.bank_name, u.account_name
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        LEFT JOIN wallets w ON g.admin_id = w.user_id
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
          g.admin_id, u.name as admin_name, u.account_number, u.bank_name, u.account_name
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        LEFT JOIN wallets w ON g.admin_id = w.user_id
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
        if (currentDay <= group.subscription_deadline_day) {
          nextDeadline = new Date(currentYear, currentMonth - 1, group.subscription_deadline_day);
        } else {
          nextDeadline = new Date(currentYear, currentMonth, group.subscription_deadline_day);
        }
      } else {
        // Annual: deadline is on specific month and day
        if (currentMonth < group.subscription_deadline_month || 
            (currentMonth === group.subscription_deadline_month && currentDay <= group.subscription_deadline_day)) {
          nextDeadline = new Date(currentYear, group.subscription_deadline_month - 1, group.subscription_deadline_day);
        } else {
          nextDeadline = new Date(currentYear + 1, group.subscription_deadline_month - 1, group.subscription_deadline_day);
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
    }

    res.json({ subscriptions: upcomingSubscriptions });
  } catch (error) {
    console.error('Get upcoming subscriptions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

