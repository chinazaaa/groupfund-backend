const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { checkDefaulterStatus } = require('../utils/paymentHelpers');

const router = express.Router();

/**
 * DEFAULT STATUS ENDPOINTS
 */

// Check if user has any overdue payments (defaulter status)
router.get('/default-status', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check for overdue in all groups
    const defaulterStatus = await checkDefaulterStatus(userId);

    // Get overdue groups details
    const overdueContributions = await pool.query(
      `SELECT 
        g.id as group_id, g.name as group_name, g.group_type, g.currency,
        COALESCE(
          (SELECT SUM(amount) FROM birthday_contributions 
           WHERE contributor_id = $1 AND group_id = g.id 
             AND status IN ('not_paid', 'not_received') 
             AND contribution_date < CURRENT_DATE),
          0
        ) +
        COALESCE(
          (SELECT SUM(amount) FROM subscription_contributions 
           WHERE contributor_id = $1 AND group_id = g.id 
             AND status IN ('not_paid', 'not_received') 
             AND subscription_period_end < CURRENT_DATE),
          0
        ) +
        COALESCE(
          (SELECT SUM(amount) FROM general_contributions 
           WHERE contributor_id = $1 AND group_id = g.id 
             AND status IN ('not_paid', 'not_received') 
             AND EXISTS (
               SELECT 1 FROM groups gr WHERE gr.id = g.id AND gr.deadline < CURRENT_DATE
             )),
          0
        ) as overdue_amount
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1 AND gm.status = 'active'
       HAVING (
         COALESCE(
           (SELECT SUM(amount) FROM birthday_contributions 
            WHERE contributor_id = $1 AND group_id = g.id 
              AND status IN ('not_paid', 'not_received') 
              AND contribution_date < CURRENT_DATE),
           0
         ) +
         COALESCE(
           (SELECT SUM(amount) FROM subscription_contributions 
            WHERE contributor_id = $1 AND group_id = g.id 
              AND status IN ('not_paid', 'not_received') 
              AND subscription_period_end < CURRENT_DATE),
           0
         ) +
         COALESCE(
           (SELECT SUM(amount) FROM general_contributions 
            WHERE contributor_id = $1 AND group_id = g.id 
              AND status IN ('not_paid', 'not_received') 
              AND EXISTS (
                SELECT 1 FROM groups gr WHERE gr.id = g.id AND gr.deadline < CURRENT_DATE
              )),
           0
         )
       ) > 0`,
      [userId]
    );

    const overdueGroups = overdueContributions.rows.map(row => ({
      groupId: row.group_id,
      groupName: row.group_name,
      groupType: row.group_type,
      currency: row.currency,
      overdueAmount: parseFloat(row.overdue_amount) || 0,
    }));

    res.json({
      has_overdue: defaulterStatus.hasOverdue,
      overdue_count: defaulterStatus.overdueCount,
      total_overdue: defaulterStatus.totalOverdue,
      overdue_groups: overdueGroups,
    });
  } catch (error) {
    console.error('Get default status error:', error);
    res.status(500).json({ error: 'Server error getting default status' });
  }
});

// Check if user has overdue payments in specific group
router.get('/default-status/:groupId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId } = req.params;

    // Verify user is member of group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, userId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group' });
    }

    // Check for overdue in specific group
    const defaulterStatus = await checkDefaulterStatus(userId, groupId);

    // Get group details
    const groupResult = await pool.query(
      'SELECT id, name, group_type, currency, deadline, subscription_frequency, subscription_deadline_day, subscription_deadline_month FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];

    // Calculate next deadline if applicable
    let nextDeadline = null;
    if (group.group_type === 'general' && group.deadline) {
      nextDeadline = new Date(group.deadline);
    } else if (group.group_type === 'subscription') {
      const today = new Date();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      const deadlineDay = group.subscription_deadline_day;
      const deadlineMonth = group.subscription_deadline_month || currentMonth;

      if (group.subscription_frequency === 'monthly') {
        // Next deadline is this month or next month
        let deadlineYear = currentYear;
        let deadlineMonthNum = currentMonth;
        if (deadlineDay < today.getDate()) {
          deadlineMonthNum = currentMonth + 1;
          if (deadlineMonthNum > 12) {
            deadlineMonthNum = 1;
            deadlineYear = currentYear + 1;
          }
        }
        nextDeadline = new Date(deadlineYear, deadlineMonthNum - 1, Math.min(deadlineDay, new Date(deadlineYear, deadlineMonthNum, 0).getDate()));
      } else if (group.subscription_frequency === 'annual') {
        // Next deadline is this year or next year
        let deadlineYear = currentYear;
        if (deadlineMonth < currentMonth || (deadlineMonth === currentMonth && deadlineDay < today.getDate())) {
          deadlineYear = currentYear + 1;
        }
        nextDeadline = new Date(deadlineYear, deadlineMonth - 1, Math.min(deadlineDay, new Date(deadlineYear, deadlineMonth, 0).getDate()));
      }
    }

    res.json({
      has_overdue: defaulterStatus.hasOverdue,
      overdue_count: defaulterStatus.overdueCount,
      overdue_amount: defaulterStatus.totalOverdue,
      group_id: groupId,
      group_name: group.name,
      group_type: group.group_type,
      currency: group.currency,
      next_deadline: nextDeadline,
    });
  } catch (error) {
    console.error('Get default status for group error:', error);
    res.status(500).json({ error: 'Server error getting default status' });
  }
});

/**
 * PAYMENT PREFERENCES ENDPOINTS
 */

// Get user's default payment timing preference
router.get('/payment-preferences', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT default_payment_timing FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      default_payment_timing: result.rows[0].default_payment_timing || 'same_day',
    });
  } catch (error) {
    console.error('Get payment preferences error:', error);
    res.status(500).json({ error: 'Server error getting payment preferences' });
  }
});

// Update user's default payment timing preference
router.put('/payment-preferences', authenticate, [
  body('default_payment_timing').isIn(['1_day_before', 'same_day']).withMessage('Default payment timing must be 1_day_before or same_day'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { default_payment_timing } = req.body;

    await pool.query(
      'UPDATE users SET default_payment_timing = $1 WHERE id = $2',
      [default_payment_timing, userId]
    );

    res.json({
      message: 'Default payment timing preference updated successfully',
      default_payment_timing,
    });
  } catch (error) {
    console.error('Update payment preferences error:', error);
    res.status(500).json({ error: 'Server error updating payment preferences' });
  }
});

module.exports = router;
