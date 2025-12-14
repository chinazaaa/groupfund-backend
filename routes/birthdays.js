const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { formatAmount } = require('../utils/currency');

const router = express.Router();

// Get upcoming birthdays
router.get('/upcoming', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId, days = 30 } = req.query;

    let query;
    let params;

    if (groupId) {
      // Check if user is active member of the group
      const memberCheck = await pool.query(
        'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );

      if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
        return res.json({ birthdays: [] });
      }

      // Upcoming birthdays in a specific group (include all members including current user)
      query = `
        SELECT * FROM (
          SELECT 
            u.id, u.name, u.email, u.phone, u.birthday,
            g.id as group_id, g.name as group_name, g.currency,
            (
              SELECT MAKE_DATE(
                EXTRACT(YEAR FROM CURRENT_DATE)::integer + 
                CASE 
                  WHEN (DATE_PART('month', u.birthday) < DATE_PART('month', CURRENT_DATE))
                       OR (DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE) 
                           AND DATE_PART('day', u.birthday) < DATE_PART('day', CURRENT_DATE))
                  THEN 1
                  ELSE 0
                END,
                DATE_PART('month', u.birthday)::integer,
                DATE_PART('day', u.birthday)::integer
              )
            ) as next_birthday_date,
            (
              SELECT (MAKE_DATE(
                EXTRACT(YEAR FROM CURRENT_DATE)::integer + 
                CASE 
                  WHEN (DATE_PART('month', u.birthday) < DATE_PART('month', CURRENT_DATE))
                       OR (DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE) 
                           AND DATE_PART('day', u.birthday) < DATE_PART('day', CURRENT_DATE))
                  THEN 1
                  ELSE 0
                END,
                DATE_PART('month', u.birthday)::integer,
                DATE_PART('day', u.birthday)::integer
              ) - CURRENT_DATE)::integer
            ) as days_until_birthday
          FROM group_members gm
          JOIN groups g ON gm.group_id = g.id
          JOIN users u ON gm.user_id = u.id
          WHERE gm.group_id = $1 
            AND gm.status = 'active'
            AND u.birthday IS NOT NULL
        ) subquery
        WHERE days_until_birthday >= 0 AND days_until_birthday <= $2
        ORDER BY days_until_birthday ASC
      `;
      params = [groupId, parseInt(days)];
    } else {
      // Upcoming birthdays across all user's groups (include all members including current user)
      query = `
        SELECT * FROM (
          SELECT DISTINCT
            u.id, u.name, u.email, u.phone, u.birthday,
            g.id as group_id, g.name as group_name, g.currency,
            (
              SELECT MAKE_DATE(
                EXTRACT(YEAR FROM CURRENT_DATE)::integer + 
                CASE 
                  WHEN (DATE_PART('month', u.birthday) < DATE_PART('month', CURRENT_DATE))
                       OR (DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE) 
                           AND DATE_PART('day', u.birthday) < DATE_PART('day', CURRENT_DATE))
                  THEN 1
                  ELSE 0
                END,
                DATE_PART('month', u.birthday)::integer,
                DATE_PART('day', u.birthday)::integer
              )
            ) as next_birthday_date,
            (
              SELECT (MAKE_DATE(
                EXTRACT(YEAR FROM CURRENT_DATE)::integer + 
                CASE 
                  WHEN (DATE_PART('month', u.birthday) < DATE_PART('month', CURRENT_DATE))
                       OR (DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE) 
                           AND DATE_PART('day', u.birthday) < DATE_PART('day', CURRENT_DATE))
                  THEN 1
                  ELSE 0
                END,
                DATE_PART('month', u.birthday)::integer,
                DATE_PART('day', u.birthday)::integer
              ) - CURRENT_DATE)::integer
            ) as days_until_birthday
          FROM group_members gm1
          JOIN groups g ON gm1.group_id = g.id
          JOIN group_members gm2 ON g.id = gm2.group_id
          JOIN users u ON gm2.user_id = u.id
          WHERE gm1.user_id = $1
            AND gm1.status = 'active'
            AND gm2.status = 'active'
            AND u.birthday IS NOT NULL
        ) subquery
        WHERE days_until_birthday >= 0 AND days_until_birthday <= $2
        ORDER BY days_until_birthday ASC, group_name ASC
      `;
      params = [userId, parseInt(days)];
    }

    const result = await pool.query(query, params);

    // Format dates to ensure they're strings and add formatted date strings
    const formattedBirthdays = result.rows.map(row => ({
      ...row,
      birthday: row.birthday ? new Date(row.birthday).toISOString().split('T')[0] : null,
      next_birthday_date: row.next_birthday_date ? new Date(row.next_birthday_date).toISOString().split('T')[0] : null,
      next_birthday_formatted: row.next_birthday_date ? new Date(row.next_birthday_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null,
    }));

    res.json({ birthdays: formattedBirthdays });
  } catch (error) {
    console.error('Get upcoming birthdays error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get past birthdays for a group
router.get('/past', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId, limit = 50 } = req.query;

    if (!groupId) {
      return res.status(400).json({ error: 'Group ID is required' });
    }

    // Check if user is active member of the group
    const memberCheck = await pool.query(
      'SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
      return res.json({ birthdays: [] });
    }

    // Get past birthdays in the group (birthdays that have already passed this year)
    const query = `
      SELECT * FROM (
        SELECT 
          u.id, u.name, u.email, u.phone, u.birthday,
          g.id as group_id, g.name as group_name, g.currency,
          (
            SELECT MAKE_DATE(
              EXTRACT(YEAR FROM CURRENT_DATE)::integer + 
              CASE 
                WHEN (DATE_PART('month', u.birthday) < DATE_PART('month', CURRENT_DATE))
                     OR (DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE) 
                         AND DATE_PART('day', u.birthday) < DATE_PART('day', CURRENT_DATE))
                THEN 0
                ELSE -1
              END,
              DATE_PART('month', u.birthday)::integer,
              DATE_PART('day', u.birthday)::integer
            )
          ) as last_birthday_date,
          (
            SELECT (CURRENT_DATE - MAKE_DATE(
              EXTRACT(YEAR FROM CURRENT_DATE)::integer + 
              CASE 
                WHEN (DATE_PART('month', u.birthday) < DATE_PART('month', CURRENT_DATE))
                     OR (DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE) 
                         AND DATE_PART('day', u.birthday) < DATE_PART('day', CURRENT_DATE))
                THEN 0
                ELSE -1
              END,
              DATE_PART('month', u.birthday)::integer,
              DATE_PART('day', u.birthday)::integer
            ))::integer
          ) as days_since_birthday
        FROM group_members gm
        JOIN groups g ON gm.group_id = g.id
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = $1 
          AND gm.status = 'active'
          AND u.birthday IS NOT NULL
      ) subquery
      WHERE days_since_birthday >= 0
        AND EXTRACT(YEAR FROM last_birthday_date) = EXTRACT(YEAR FROM CURRENT_DATE)
      ORDER BY days_since_birthday ASC
      LIMIT $2
    `;
    
    const params = [groupId, parseInt(limit)];
    const result = await pool.query(query, params);

    // Format dates to ensure they're strings and add formatted date strings
    const formattedBirthdays = result.rows.map(row => ({
      ...row,
      birthday: row.birthday ? new Date(row.birthday).toISOString().split('T')[0] : null,
      last_birthday_date: row.last_birthday_date ? new Date(row.last_birthday_date).toISOString().split('T')[0] : null,
      last_birthday_formatted: row.last_birthday_date ? new Date(row.last_birthday_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null,
    }));

    res.json({ birthdays: formattedBirthdays });
  } catch (error) {
    console.error('Get past birthdays error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get overdue contributions (contributions that are not_paid after birthday has passed)
router.get('/overdue', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId } = req.query;

    // Get all groups the user is in
    let groupsQuery = `
      SELECT DISTINCT g.id, g.name, g.currency, g.contribution_amount
      FROM group_members gm
      JOIN groups g ON gm.group_id = g.id
      WHERE gm.user_id = $1 AND gm.status = 'active'
    `;
    const groupsParams = [userId];
    
    if (groupId) {
      groupsQuery += ` AND g.id = $2`;
      groupsParams.push(groupId);
    }

    const groupsResult = await pool.query(groupsQuery, groupsParams);
    const groups = groupsResult.rows;

    const overdueContributions = [];

    for (const group of groups) {
      // Get user's join date for this group
      const userJoinDateResult = await pool.query(
        `SELECT joined_at FROM group_members 
         WHERE group_id = $1 AND user_id = $2 AND status = 'active'`,
        [group.id, userId]
      );
      
      if (userJoinDateResult.rows.length === 0) continue;
      const userJoinDate = new Date(userJoinDateResult.rows[0].joined_at);

      // Get all active members in this group
      const membersResult = await pool.query(
        `SELECT u.id, u.name, u.birthday
         FROM users u
         JOIN group_members gm ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.status = 'active' AND u.birthday IS NOT NULL`,
        [group.id]
      );

      for (const member of membersResult.rows) {
        // Calculate if birthday has passed this year
        const memberBirthday = new Date(member.birthday);
        const today = new Date();
        const currentYear = today.getFullYear();
        
        // Get this year's birthday date
        const thisYearBirthday = new Date(currentYear, memberBirthday.getMonth(), memberBirthday.getDate());
        
        // Check if birthday has passed AND user was a member when the birthday occurred
        // Only consider overdue if user joined before or on the birthday date
        if (thisYearBirthday < today && userJoinDate <= thisYearBirthday) {
          // Birthday has passed, check if user has paid
          const contributionCheck = await pool.query(
            `SELECT id, status, contribution_date, amount
             FROM birthday_contributions 
             WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
             AND EXTRACT(YEAR FROM contribution_date) = $4`,
            [group.id, member.id, userId, currentYear]
          );

          // If no contribution or status is 'not_paid' or 'not_received', it's overdue
          // 'not_received' means they marked as paid but celebrant rejected it, so still overdue
          const isOverdue = contributionCheck.rows.length === 0 || 
                           contributionCheck.rows[0].status === 'not_paid' || 
                           contributionCheck.rows[0].status === 'not_received';
          
          if (isOverdue) {
            const daysOverdue = Math.floor((today - thisYearBirthday) / (1000 * 60 * 60 * 24));
            
            overdueContributions.push({
              group_id: group.id,
              group_name: group.name,
              currency: group.currency || 'NGN',
              birthday_user_id: member.id,
              birthday_user_name: member.name,
              birthday_date: thisYearBirthday.toISOString().split('T')[0],
              days_overdue: daysOverdue,
              contribution_amount: parseFloat(group.contribution_amount || 0),
              status: contributionCheck.rows.length > 0 ? contributionCheck.rows[0].status : 'not_paid'
            });
          }
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
    console.error('Get overdue contributions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get birthday details
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // Get user birthday info
    const userResult = await pool.query(
      'SELECT id, name, email, phone, birthday FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check if current user is active member in any shared groups with the birthday user
    const groupsResult = await pool.query(
      `SELECT g.id, g.name, g.contribution_amount, g.max_members, g.currency
       FROM groups g
       JOIN group_members gm1 ON g.id = gm1.group_id
       JOIN group_members gm2 ON g.id = gm2.group_id
       WHERE gm1.user_id = $1 AND gm2.user_id = $2
         AND gm1.status = 'active' AND gm2.status = 'active'`,
      [currentUserId, userId]
    );

    // If no shared active groups, return empty data
    if (groupsResult.rows.length === 0) {
      return res.json({
        user: userResult.rows[0],
        wallet: null,
        sharedGroups: [],
        contributions: [],
      });
    }

    // Get contribution history for this user's birthdays
    const contributionsResult = await pool.query(
      `SELECT 
        bc.id, bc.amount, bc.contribution_date, bc.status,
        g.id as group_id, g.name as group_name, g.currency,
        u.name as contributor_name, u.id as contributor_id
       FROM birthday_contributions bc
       JOIN groups g ON bc.group_id = g.id
       JOIN users u ON bc.contributor_id = u.id
       WHERE bc.birthday_user_id = $1
       ORDER BY bc.contribution_date DESC`,
      [userId]
    );

    // Get wallet info for the birthday user (only if payment details exist)
    const walletResult = await pool.query(
      'SELECT account_number, bank_name, account_name, iban, swift_bic, routing_number, sort_code, branch_code, branch_address FROM wallets WHERE user_id = $1',
      [userId]
    );

    // Only return wallet if it has all payment details set
    const wallet = walletResult.rows[0];
    const walletResponse = wallet && wallet.account_name && wallet.bank_name && wallet.account_number
      ? wallet
      : null;

    res.json({
      user,
      wallet: walletResponse,
      sharedGroups: groupsResult.rows,
      contributions: contributionsResult.rows,
    });
  } catch (error) {
    console.error('Get birthday details error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get calendar view (birthdays by month)
router.get('/calendar/:year/:month', authenticate, async (req, res) => {
  try {
    const { year, month } = req.params;
    const { groupId } = req.query;
    const userId = req.user.id;

    let query = `
      SELECT DISTINCT
        u.id, u.name, u.birthday,
        EXTRACT(DAY FROM u.birthday) as day,
        g.id as group_id, g.name as group_name
       FROM group_members gm1
       JOIN groups g ON gm1.group_id = g.id
       JOIN group_members gm2 ON g.id = gm2.group_id
       JOIN users u ON gm2.user_id = u.id
       WHERE gm1.user_id = $1
         AND gm1.status = 'active'
         AND gm2.status = 'active'
         AND u.birthday IS NOT NULL
         AND EXTRACT(MONTH FROM u.birthday) = $2
         AND EXTRACT(YEAR FROM u.birthday) <= $3
    `;
    
    const params = [userId, parseInt(month), parseInt(year)];
    
    // Filter by group if provided
    if (groupId) {
      query += ` AND g.id = $4`;
      params.push(groupId);
    }
    
    query += ` ORDER BY EXTRACT(DAY FROM u.birthday) ASC`;

    const result = await pool.query(query, params);

    res.json({ birthdays: result.rows });
  } catch (error) {
    console.error('Get calendar error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Contribute to birthday (Mark as Paid)
router.post('/contribute', authenticate, require('../middleware/rateLimiter').contributionLimiter, async (req, res) => {
  try {
    const { groupId, birthdayUserId, amount, note } = req.body;
    const contributorId = req.user.id;

    // Validate all users are in the same group
    const groupCheck = await pool.query(
      `SELECT COUNT(*) FROM group_members 
       WHERE group_id = $1 AND user_id IN ($2, $3) AND status = 'active'`,
      [groupId, contributorId, birthdayUserId]
    );

    if (parseInt(groupCheck.rows[0].count) !== 2) {
      return res.status(400).json({ error: 'Both users must be active members of the group' });
    }

    // Check if group is closed (closed groups cannot accept new contributions)
    const groupStatusCheck = await pool.query(
      'SELECT status FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupStatusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (groupStatusCheck.rows[0].status === 'closed') {
      return res.status(400).json({ error: 'This group is closed and no longer accepting contributions' });
    }

    // Get group contribution amount and currency
    const groupResult = await pool.query(
      'SELECT contribution_amount, currency FROM groups WHERE id = $1',
      [groupId]
    );

    const contributionAmount = parseFloat(groupResult.rows[0].contribution_amount);
    const groupCurrency = groupResult.rows[0].currency || 'NGN';
    const actualAmount = amount || contributionAmount;

    // Get user names for transaction description
    const birthdayUserResult = await pool.query(
      'SELECT name FROM users WHERE id = $1',
      [birthdayUserId]
    );
    const contributorResult = await pool.query(
      'SELECT name FROM users WHERE id = $1',
      [contributorId]
    );
    const birthdayUserName = birthdayUserResult.rows[0]?.name || 'Someone';
    const contributorName = contributorResult.rows[0]?.name || 'Someone';

    // Get group name for transaction description
    const groupNameResult = await pool.query(
      'SELECT name FROM groups WHERE id = $1',
      [groupId]
    );
    const groupName = groupNameResult.rows[0]?.name || 'Group';

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Check if contribution already exists
      const existingContribution = await pool.query(
        `SELECT id, transaction_id FROM birthday_contributions 
         WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3`,
        [groupId, birthdayUserId, contributorId]
      );

      let contributionId;

      if (existingContribution.rows.length > 0) {
        contributionId = existingContribution.rows[0].id;

        // Update existing contribution - set to 'paid' (awaiting confirmation)
        await pool.query(
          `UPDATE birthday_contributions 
           SET amount = $1, contribution_date = CURRENT_DATE, status = 'paid', note = $2
           WHERE id = $3`,
          [actualAmount, note || null, contributionId]
        );
      } else {
        // Create new birthday contribution record (marked as 'paid' - awaiting confirmation)
        const contributionResult = await pool.query(
          `INSERT INTO birthday_contributions 
           (group_id, birthday_user_id, contributor_id, amount, contribution_date, status, note)
           VALUES ($1, $2, $3, $4, CURRENT_DATE, 'paid', $5)
           RETURNING id`,
          [groupId, birthdayUserId, contributorId, actualAmount, note || null]
        );
        contributionId = contributionResult.rows[0].id;
      }

      // Always create transaction records to show in contribution history
      // Check if transactions already exist for this contribution (to avoid duplicates)
      const existingDebit = await pool.query(
        `SELECT id FROM transactions 
         WHERE user_id = $1 AND group_id = $2 AND type = 'debit' 
           AND description LIKE $3
           AND created_at::date = CURRENT_DATE`,
        [contributorId, groupId, `%Birthday contribution for ${birthdayUserName}%`]
      );

      const existingCredit = await pool.query(
        `SELECT id FROM transactions 
         WHERE user_id = $1 AND group_id = $2 AND type = 'credit' 
           AND description LIKE $3
           AND created_at::date = CURRENT_DATE`,
        [birthdayUserId, groupId, `%Birthday gift from ${contributorName}%`]
      );

      if (existingDebit.rows.length === 0) {
        // Create debit transaction (contributor - sent) with status 'paid' (awaiting confirmation)
        await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, description, status)
           VALUES ($1, $2, 'debit', $3, $4, 'paid')`,
          [contributorId, groupId, actualAmount, `Birthday contribution for ${birthdayUserName} (${groupName})`]
        );
      }

      let creditTransactionId;
      if (existingCredit.rows.length === 0) {
        // Create credit transaction (birthday user - received) with status 'paid' (awaiting confirmation)
        const creditTransaction = await pool.query(
          `INSERT INTO transactions (user_id, group_id, type, amount, description, status)
           VALUES ($1, $2, 'credit', $3, $4, 'paid')
           RETURNING id`,
          [birthdayUserId, groupId, actualAmount, `Birthday gift from ${contributorName} (${groupName})`]
        );
        creditTransactionId = creditTransaction.rows[0].id;
      } else {
        creditTransactionId = existingCredit.rows[0].id;
      }

      // Link contribution to credit transaction if not already linked
      const currentTransactionId = await pool.query(
        `SELECT transaction_id FROM birthday_contributions WHERE id = $1`,
        [contributionId]
      );
      if (!currentTransactionId.rows[0]?.transaction_id && creditTransactionId) {
        await pool.query(
          `UPDATE birthday_contributions SET transaction_id = $1 WHERE id = $2`,
          [creditTransactionId, contributionId]
        );
      }

      await pool.query('COMMIT');

      // Notify birthday user that contribution was marked as paid
      await createNotification(
        birthdayUserId,
        'contribution_paid',
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
    console.error('Contribute error:', error);
    res.status(500).json({ error: 'Server error marking payment as paid' });
  }
});

// Confirm contribution (celebrant confirms payment received)
router.post('/contribute/:contributionId/confirm', authenticate, async (req, res) => {
  try {
    const { contributionId } = req.params;
    const celebrantId = req.user.id;

    // Get contribution details
    const contributionResult = await pool.query(
      `SELECT bc.*, g.name as group_name, g.currency, g.status as group_status, u.name as contributor_name
       FROM birthday_contributions bc
       JOIN groups g ON bc.group_id = g.id
       JOIN users u ON bc.contributor_id = u.id
       WHERE bc.id = $1 AND bc.birthday_user_id = $2`,
      [contributionId, celebrantId]
    );

    if (contributionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contribution not found or you are not the celebrant' });
    }

    const contribution = contributionResult.rows[0];

    // Check if group is closed (closed groups cannot have contributions confirmed/rejected)
    if (contribution.group_status === 'closed') {
      return res.status(400).json({ error: 'This group is closed and no longer accepting contribution confirmations' });
    }

    if (contribution.status !== 'paid') {
      return res.status(400).json({ error: 'Contribution is not in paid status' });
    }

    await pool.query('BEGIN');

    try {
      // Update contribution status to confirmed
      await pool.query(
        `UPDATE birthday_contributions SET status = 'confirmed' WHERE id = $1`,
        [contributionId]
      );

      // Update related transactions to confirmed
      if (contribution.transaction_id) {
        // Update credit transaction (received)
        await pool.query(
          `UPDATE transactions SET status = 'confirmed' WHERE id = $1`,
          [contribution.transaction_id]
        );

        // Find and update debit transaction (sent)
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
            `%Birthday contribution for%`,
            contribution.transaction_id
          ]
        );
      }

      await pool.query('COMMIT');

      // Notify contributor that payment was confirmed
      const celebrantName = await pool.query(
        'SELECT name FROM users WHERE id = $1',
        [celebrantId]
      );
      const celebrantNameText = celebrantName.rows[0]?.name || 'The celebrant';
      const contributionCurrency = contribution.currency || 'NGN';
      
      await createNotification(
        contribution.contributor_id,
        'contribution_confirmed',
        'Payment Confirmed',
        `${celebrantNameText} confirmed your payment of ${formatAmount(parseFloat(contribution.amount), contributionCurrency)}. Thank you!`,
        contribution.group_id,
        celebrantId
      );

      res.json({ message: 'Contribution confirmed successfully' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Confirm contribution error:', error);
    res.status(500).json({ error: 'Server error confirming contribution' });
  }
});

// Mark contribution as not received (celebrant marks payment as not received)
router.post('/contribute/:contributionId/reject', authenticate, async (req, res) => {
  try {
    const { contributionId } = req.params;
    const celebrantId = req.user.id;

    // Get contribution details
    const contributionResult = await pool.query(
      `SELECT bc.*, g.name as group_name, g.currency, g.status as group_status, u.name as contributor_name
       FROM birthday_contributions bc
       JOIN groups g ON bc.group_id = g.id
       JOIN users u ON bc.contributor_id = u.id
       WHERE bc.id = $1 AND bc.birthday_user_id = $2`,
      [contributionId, celebrantId]
    );

    if (contributionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contribution not found or you are not the celebrant' });
    }

    const contribution = contributionResult.rows[0];

    // Check if group is closed (closed groups cannot have contributions confirmed/rejected)
    if (contribution.group_status === 'closed') {
      return res.status(400).json({ error: 'This group is closed and no longer accepting contribution rejections' });
    }

    if (contribution.status !== 'paid') {
      return res.status(400).json({ error: 'Contribution is not in paid status' });
    }

    await pool.query('BEGIN');

    try {
      // Update contribution status to not_received (stays at not_received, doesn't go back to not_paid)
      await pool.query(
        `UPDATE birthday_contributions SET status = 'not_received' WHERE id = $1`,
        [contributionId]
      );

      // Update related transactions to not_received
      if (contribution.transaction_id) {
        // Update credit transaction (received)
        await pool.query(
          `UPDATE transactions SET status = 'not_received' WHERE id = $1`,
          [contribution.transaction_id]
        );

        // Find and update debit transaction (sent)
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
            `%Birthday contribution for%`,
            contribution.transaction_id
          ]
        );
      }

      await pool.query('COMMIT');

      // Notify contributor that payment was not received
      const celebrantName = await pool.query(
        'SELECT name FROM users WHERE id = $1',
        [celebrantId]
      );
      const celebrantNameText = celebrantName.rows[0]?.name || 'The celebrant';
      
      await createNotification(
        contribution.contributor_id,
        'contribution_not_received',
        'Payment Not Received',
        `${celebrantNameText} marked your payment as not received. Please check that you've paid correctly or try again.`,
        contribution.group_id,
        celebrantId
      );

      res.json({ message: 'Contribution marked as not received successfully' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Reject contribution error:', error);
    res.status(500).json({ error: 'Server error rejecting contribution' });
  }
});

module.exports = router;
