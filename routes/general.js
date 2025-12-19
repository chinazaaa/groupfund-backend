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
      `SELECT g.*, w.account_number, w.bank_name, w.account_name
       FROM groups g
       LEFT JOIN wallets w ON g.admin_id = w.user_id
       WHERE g.id = $1 AND g.group_type = 'general'`,
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'General group not found' });
    }

    const group = groupCheck.rows[0];
    
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
      // If admin is paying, status should be 'confirmed' (they're paying to themselves)
      // Otherwise, status is 'paid' (awaiting admin confirmation)
      const contributionStatus = isAdmin ? 'confirmed' : 'paid';

      if (existingContribution.rows.length > 0) {
        contributionId = existingContribution.rows[0].id;
        await pool.query(
          `UPDATE general_contributions 
           SET amount = $1, contribution_date = CURRENT_DATE, status = $2, note = $3
           WHERE id = $4`,
          [actualAmount, contributionStatus, note || null, contributionId]
        );
      } else {
        const contributionResult = await pool.query(
          `INSERT INTO general_contributions 
           (group_id, contributor_id, amount, contribution_date, status, note)
           VALUES ($1, $2, $3, CURRENT_DATE, $4, $5)
           RETURNING id`,
          [groupId, contributorId, actualAmount, contributionStatus, note || null]
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

      // Transaction status should match contribution status
      const transactionStatus = isAdmin ? 'confirmed' : 'paid';
      
      if (existingDebit.rows.length === 0) {
        await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, description, status)
           VALUES ($1, $2, 'debit', $3, $4, $5)`,
          [contributorId, groupId, actualAmount, `Contribution for ${groupName}`, transactionStatus]
        );
      }

      let creditTransactionId;
      if (existingCredit.rows.length === 0) {
        const creditTransaction = await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, description, status)
           VALUES ($1, $2, 'credit', $3, $4, $5)
           RETURNING id`,
          [group.admin_id, groupId, actualAmount, `Contribution from ${contributorName} (${groupName})`, transactionStatus]
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

      // Only notify admin if it's not the admin themselves paying
      if (!isAdmin) {
        await createNotification(
          group.admin_id,
          'general_contribution_paid',
          'Contribution Received',
          `${contributorName} marked their contribution of ${formatAmount(actualAmount, groupCurrency)} as paid${note ? `: ${note}` : ''}`,
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

    // First check if contribution exists and verify admin access
    const contributionCheck = await pool.query(
      `SELECT gc.id, g.admin_id, g.group_type
       FROM general_contributions gc
       JOIN groups g ON gc.group_id = g.id
       WHERE gc.id = $1`,
      [contributionId]
    );

    if (contributionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'General contribution not found' });
    }

    if (contributionCheck.rows[0].group_type !== 'general') {
      return res.status(400).json({ error: 'This is not a general group contribution' });
    }

    if (contributionCheck.rows[0].admin_id !== adminId) {
      return res.status(403).json({ error: 'Only the group admin can reject contributions' });
    }

    // Get full contribution details
    const contributionResult = await pool.query(
      `SELECT gc.*, g.name as group_name, g.currency, g.status as group_status, g.admin_id, u.name as contributor_name
       FROM general_contributions gc
       JOIN groups g ON gc.group_id = g.id
       JOIN users u ON gc.contributor_id = u.id
       WHERE gc.id = $1 AND g.admin_id = $2`,
      [contributionId, adminId]
    );

    if (contributionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contribution not found' });
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

// Get upcoming general groups (groups with deadlines coming up)
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
        return res.json({ groups: [] });
      }

      query = `
        SELECT 
          g.id as group_id, g.name as group_name, g.currency, g.contribution_amount, g.deadline,
          g.admin_id, u.name as admin_name, w.account_number, w.bank_name, w.account_name
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        LEFT JOIN users u ON g.admin_id = u.id
        LEFT JOIN wallets w ON g.admin_id = w.user_id
        WHERE g.id = $1 AND g.group_type = 'general' AND gm.user_id = $2 AND gm.status = 'active'
          AND g.deadline IS NOT NULL
      `;
      params = [groupId, userId];
    } else {
      query = `
        SELECT DISTINCT
          g.id as group_id, g.name as group_name, g.currency, g.contribution_amount, g.deadline,
          g.admin_id, u.name as admin_name, w.account_number, w.bank_name, w.account_name
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        LEFT JOIN users u ON g.admin_id = u.id
        LEFT JOIN wallets w ON g.admin_id = w.user_id
        WHERE gm.user_id = $1 AND g.group_type = 'general' AND gm.status = 'active'
          AND g.deadline IS NOT NULL
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingGroups = result.rows.map(group => {
      if (!group.deadline) {
        return null;
      }

      const deadline = new Date(group.deadline);
      deadline.setHours(0, 0, 0, 0);
      const daysUntilDeadline = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));

      return {
        ...group,
        days_until_deadline: daysUntilDeadline,
        has_paid: false, // Will be updated below
      };
    }).filter(group => 
      group !== null && 
      group.days_until_deadline >= 0 && 
      group.days_until_deadline <= parseInt(days)
    );

    // Check payment status for each group
    for (const group of upcomingGroups) {
      const paymentCheck = await pool.query(
        `SELECT status FROM general_contributions 
         WHERE group_id = $1 AND contributor_id = $2`,
        [group.group_id, userId]
      );

      group.has_paid = paymentCheck.rows.length > 0 && 
                       (paymentCheck.rows[0].status === 'paid' || paymentCheck.rows[0].status === 'confirmed');
    }

    // Sort by days until deadline (soonest first)
    upcomingGroups.sort((a, b) => a.days_until_deadline - b.days_until_deadline);

    res.json({ groups: upcomingGroups });
  } catch (error) {
    console.error('Get upcoming general groups error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current payment status for a general group (simple check for frontend)
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
      `SELECT id, name, admin_id
       FROM groups WHERE id = $1 AND group_type = 'general'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'General group not found' });
    }

    const group = groupResult.rows[0];
    const isAdmin = group.admin_id === userId;

    // Check payment status
    const paymentCheck = await pool.query(
      `SELECT id, status, contribution_date, amount, note, created_at
       FROM general_contributions 
       WHERE group_id = $1 AND contributor_id = $2`,
      [groupId, userId]
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

// Get general group compliance (who has paid, who hasn't)
router.get('/:groupId/compliance', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
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
      `SELECT id, name, contribution_amount, currency, deadline
       FROM groups WHERE id = $1 AND group_type = 'general'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'General group not found' });
    }

    const group = groupResult.rows[0];

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
      // Check contribution status
      const contributionCheck = await pool.query(
        `SELECT id, status, contribution_date, amount, note, created_at
         FROM general_contributions 
         WHERE group_id = $1 AND contributor_id = $2`,
        [groupId, member.id]
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
        is_unpaid: isUnpaid
      });
    }

    res.json({
      group_id: group.id,
      group_name: group.name,
      currency: group.currency || 'NGN',
      contribution_amount: parseFloat(group.contribution_amount),
      deadline: group.deadline,
      summary: {
        total_members: complianceData.length,
        paid_count: paidCount,
        pending_count: pendingCount,
        unpaid_count: unpaidCount
      },
      members: complianceData
    });
  } catch (error) {
    console.error('Get general group compliance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get general group payment history
router.get('/:groupId/history', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { limit = 50 } = req.query;
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
      `SELECT id, name, contribution_amount, currency, deadline
       FROM groups WHERE id = $1 AND group_type = 'general'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'General group not found' });
    }

    const group = groupResult.rows[0];

    // Get all contributions ordered by date
    const contributionsResult = await pool.query(
      `SELECT gc.*, u.name as contributor_name, u.email as contributor_email
       FROM general_contributions gc
       JOIN users u ON gc.contributor_id = u.id
       WHERE gc.group_id = $1
       ORDER BY gc.created_at DESC
       LIMIT $2`,
      [groupId, parseInt(limit)]
    );

    const paid = contributionsResult.rows.filter(c => c.status === 'confirmed').length;
    const pending = contributionsResult.rows.filter(c => c.status === 'paid').length;
    const unpaid = contributionsResult.rows.filter(c => c.status === 'not_paid' || c.status === 'not_received').length;

    // Get total active members
    const membersCountResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM group_members
       WHERE group_id = $1 AND status = 'active'`,
      [groupId]
    );
    const totalMembers = parseInt(membersCountResult.rows[0]?.count || 0);

    res.json({
      group_id: group.id,
      group_name: group.name,
      deadline: group.deadline,
      summary: {
        total_members: totalMembers,
        paid_count: paid,
        pending_count: pending,
        unpaid_count: unpaid
      },
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
  } catch (error) {
    console.error('Get general group history error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

