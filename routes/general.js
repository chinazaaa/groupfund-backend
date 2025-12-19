const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { formatAmount } = require('../utils/currency');
const { contributionLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Contribute to general group (Mark as Paid)
router.post('/contribute', authenticate, contributionLimiter, async (req, res) => {
  try {
    const { groupId, amount, note } = req.body;
    const contributorId = req.user.id;

    // Validate group exists and is a general group
    const groupCheck = await pool.query(
      `SELECT g.*, u.account_number, u.bank_name, u.account_name
       FROM groups g
       LEFT JOIN wallets u ON g.admin_id = u.user_id
       WHERE g.id = $1 AND g.group_type = 'general'`,
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'General group not found' });
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
      // Check if contribution already exists
      const existingContribution = await pool.query(
        `SELECT id, transaction_id FROM general_contributions 
         WHERE group_id = $1 AND contributor_id = $2`,
        [groupId, contributorId]
      );

      let contributionId;

      if (existingContribution.rows.length > 0) {
        contributionId = existingContribution.rows[0].id;
        await pool.query(
          `UPDATE general_contributions 
           SET amount = $1, contribution_date = CURRENT_DATE, status = 'paid', note = $2
           WHERE id = $3`,
          [actualAmount, note || null, contributionId]
        );
      } else {
        const contributionResult = await pool.query(
          `INSERT INTO general_contributions 
           (group_id, contributor_id, amount, contribution_date, status, note)
           VALUES ($1, $2, $3, CURRENT_DATE, 'paid', $4)
           RETURNING id`,
          [groupId, contributorId, actualAmount, note || null]
        );
        contributionId = contributionResult.rows[0].id;
      }

      // Create transaction records
      const existingDebit = await pool.query(
        `SELECT id FROM transactions 
         WHERE user_id = $1 AND group_id = $2 AND type = 'debit' 
           AND description LIKE $3
           AND created_at::date = CURRENT_DATE`,
        [contributorId, groupId, `%Contribution for ${groupName}%`]
      );

      const existingCredit = await pool.query(
        `SELECT id FROM transactions 
         WHERE user_id = $1 AND group_id = $2 AND type = 'credit' 
           AND description LIKE $3
           AND created_at::date = CURRENT_DATE`,
        [group.admin_id, groupId, `%Contribution from ${contributorName}%`]
      );

      if (existingDebit.rows.length === 0) {
        await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, description, status)
           VALUES ($1, $2, 'debit', $3, $4, 'paid')`,
          [contributorId, groupId, actualAmount, `Contribution for ${groupName}`]
        );
      }

      let creditTransactionId;
      if (existingCredit.rows.length === 0) {
        const creditTransaction = await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, description, status)
           VALUES ($1, $2, 'credit', $3, $4, 'paid')
           RETURNING id`,
          [group.admin_id, groupId, actualAmount, `Contribution from ${contributorName} (${groupName})`]
        );
        creditTransactionId = creditTransaction.rows[0].id;
      } else {
        creditTransactionId = existingCredit.rows[0].id;
      }

      // Link contribution to credit transaction
      const currentTransactionId = await pool.query(
        `SELECT transaction_id FROM general_contributions WHERE id = $1`,
        [contributionId]
      );
      if (!currentTransactionId.rows[0]?.transaction_id && creditTransactionId) {
        await pool.query(
          `UPDATE general_contributions SET transaction_id = $1 WHERE id = $2`,
          [creditTransactionId, contributionId]
        );
      }

      await pool.query('COMMIT');

      // Notify admin that contribution was marked as paid
      await createNotification(
        group.admin_id,
        'general_contribution_paid',
        'Contribution Received',
        `${contributorName} marked their contribution of ${formatAmount(actualAmount, groupCurrency)} as paid${note ? `: ${note}` : ''}`,
        groupId,
        contributorId
      );

      res.json({ message: 'Payment marked as paid successfully' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('General contribute error:', error);
    res.status(500).json({ error: 'Server error marking payment as paid' });
  }
});

// Confirm general contribution (admin confirms payment received)
router.post('/contribute/:contributionId/confirm', authenticate, async (req, res) => {
  try {
    const { contributionId } = req.params;
    const adminId = req.user.id;

    // Get contribution details and verify admin owns the group
    const contributionResult = await pool.query(
      `SELECT gc.*, g.name as group_name, g.currency, g.status as group_status, g.admin_id, u.name as contributor_name
       FROM general_contributions gc
       JOIN groups g ON gc.group_id = g.id
       JOIN users u ON gc.contributor_id = u.id
       WHERE gc.id = $1 AND g.admin_id = $2`,
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
        `UPDATE general_contributions SET status = 'confirmed' WHERE id = $1`,
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
            `%Contribution for%`,
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
        'general_contribution_confirmed',
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
    console.error('Confirm general contribution error:', error);
    res.status(500).json({ error: 'Server error confirming contribution' });
  }
});

// Mark general contribution as not received (admin marks payment as not received)
router.post('/contribute/:contributionId/reject', authenticate, async (req, res) => {
  try {
    const { contributionId } = req.params;
    const adminId = req.user.id;

    const contributionResult = await pool.query(
      `SELECT gc.*, g.name as group_name, g.currency, g.status as group_status, g.admin_id, u.name as contributor_name
       FROM general_contributions gc
       JOIN groups g ON gc.group_id = g.id
       JOIN users u ON gc.contributor_id = u.id
       WHERE gc.id = $1 AND g.admin_id = $2`,
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
        `UPDATE general_contributions SET status = 'not_received' WHERE id = $1`,
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
            `%Contribution for%`,
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
        'general_contribution_not_received',
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
    console.error('Reject general contribution error:', error);
    res.status(500).json({ error: 'Server error rejecting contribution' });
  }
});

// Get overdue general contributions
router.get('/overdue', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId } = req.query;

    let groupsQuery = `
      SELECT DISTINCT g.id, g.name, g.currency, g.contribution_amount, g.deadline
      FROM group_members gm
      JOIN groups g ON gm.group_id = g.id
      WHERE gm.user_id = $1 AND gm.status = 'active' AND g.group_type = 'general'
    `;
    const groupsParams = [userId];
    
    if (groupId) {
      groupsQuery += ` AND g.id = $2`;
      groupsParams.push(groupId);
    }

    const groupsResult = await pool.query(groupsQuery, groupsParams);
    const groups = groupsResult.rows;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueContributions = [];

    for (const group of groups) {
      // Check if deadline has passed
      if (!group.deadline) {
        continue; // No deadline set, skip
      }

      const deadline = new Date(group.deadline);
      deadline.setHours(0, 0, 0, 0);
      
      const daysOverdue = Math.floor((today - deadline) / (1000 * 60 * 60 * 24));
      
      if (daysOverdue >= 1) {
        // Deadline has passed, check if user has paid
        const contributionCheck = await pool.query(
          `SELECT status FROM general_contributions 
           WHERE group_id = $1 AND contributor_id = $2`,
          [group.id, userId]
        );

        const isOverdue = contributionCheck.rows.length === 0 || 
                         contributionCheck.rows[0].status === 'not_paid' || 
                         contributionCheck.rows[0].status === 'not_received';
        
        if (isOverdue) {
          overdueContributions.push({
            group_id: group.id,
            group_name: group.name,
            currency: group.currency || 'NGN',
            deadline: group.deadline,
            days_overdue: daysOverdue,
            contribution_amount: parseFloat(group.contribution_amount || 0),
            status: contributionCheck.rows.length > 0 ? contributionCheck.rows[0].status : 'not_paid'
          });
        }
      }
    }

    // Sort by days overdue (most overdue first)
    overdueContributions.sort((a, b) => b.days_overdue - a.days_overdue);

    res.json({ 
      overdue_contributions: overdueContributions,
      total: overdueContributions.length
    });
  } catch (error) {
    console.error('Get overdue general contributions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

