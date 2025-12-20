const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { generateInviteCode } = require('../utils/helpers');

const router = express.Router();

// Helper function to get the last day of a month
function getLastDayOfMonth(year, month) {
  // month is 0-indexed (0 = January, 11 = December)
  return new Date(year, month + 1, 0).getDate();
}

// Helper function to get deadline date, handling months with fewer days
function getDeadlineDate(year, month, deadlineDay) {
  // month is 0-indexed (0 = January, 11 = December)
  const lastDay = getLastDayOfMonth(year, month);
  const actualDay = Math.min(deadlineDay, lastDay);
  return new Date(year, month, actualDay);
}

// Create group
router.post('/create', authenticate, [
  body('name').trim().notEmpty().withMessage('Group name is required'),
  body('contributionAmount').isFloat({ min: 0 }).withMessage('Contribution amount must be a positive number'),
  body('maxMembers').isInt({ min: 2 }).withMessage('Max members must be at least 2'),
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code'),
  body('groupType').optional().isIn(['birthday', 'subscription', 'general']).withMessage('Group type must be birthday, subscription, or general'),
  // Subscription-specific validations
  body('subscriptionFrequency').optional().isIn(['monthly', 'annual']).withMessage('Subscription frequency must be monthly or annual'),
  body('subscriptionPlatform').optional().trim().notEmpty().withMessage('Subscription platform is required for subscription groups'),
  body('subscriptionDeadlineDay').optional().isInt({ min: 1, max: 31 }).withMessage('Subscription deadline day must be between 1 and 31'),
  body('subscriptionDeadlineMonth').optional().isInt({ min: 1, max: 12 }).withMessage('Subscription deadline month must be between 1 and 12'),
  // General group validations
  body('deadline').optional().isISO8601().withMessage('Deadline must be a valid date'),
  // Notes/description field (optional for all group types)
  body('notes').optional().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      name, 
      contributionAmount, 
      maxMembers, 
      currency = 'NGN',
      groupType = 'birthday',
      subscriptionFrequency,
      subscriptionPlatform,
      subscriptionDeadlineDay,
      subscriptionDeadlineMonth,
      deadline,
      notes
    } = req.body;
    const adminId = req.user.id;

    // Validate birthday group: user must have birthday set
    if (groupType === 'birthday') {
      const userResult = await pool.query(
        'SELECT birthday FROM users WHERE id = $1',
        [adminId]
      );
      
      if (userResult.rows.length === 0 || !userResult.rows[0].birthday) {
        return res.status(400).json({ 
          error: 'You must set your birthday before creating a birthday group. Please update your profile first.' 
        });
      }
    }

    // Validate subscription group fields
    if (groupType === 'subscription') {
      if (!subscriptionFrequency) {
        return res.status(400).json({ error: 'Subscription frequency is required for subscription groups' });
      }
      if (!subscriptionPlatform) {
        return res.status(400).json({ error: 'Subscription platform is required for subscription groups' });
      }
      if (!subscriptionDeadlineDay || subscriptionDeadlineDay < 1 || subscriptionDeadlineDay > 31) {
        return res.status(400).json({ error: 'Subscription deadline day is required and must be between 1 and 31' });
      }
      if (subscriptionFrequency === 'annual' && (!subscriptionDeadlineMonth || subscriptionDeadlineMonth < 1 || subscriptionDeadlineMonth > 12)) {
        return res.status(400).json({ error: 'Subscription deadline month is required for annual subscriptions (1-12)' });
      }
    }

    // Validate general group deadline
    if (groupType === 'general' && deadline) {
      const deadlineDate = new Date(deadline);
      if (deadlineDate < new Date()) {
        return res.status(400).json({ error: 'Deadline cannot be in the past' });
      }
    }

    // Generate unique invite code
    let inviteCode;
    let isUnique = false;
    while (!isUnique) {
      inviteCode = generateInviteCode();
      const checkResult = await pool.query('SELECT id FROM groups WHERE invite_code = $1', [inviteCode]);
      if (checkResult.rows.length === 0) {
        isUnique = true;
      }
    }

    // Build insert query based on group type
    let insertFields = 'name, invite_code, contribution_amount, max_members, admin_id, currency, group_type';
    let insertValues = '$1, $2, $3, $4, $5, $6, $7';
    let params = [name, inviteCode, contributionAmount, maxMembers, adminId, currency, groupType];
    let paramCount = 8;

    // Add notes if provided
    if (notes !== undefined && notes !== null && notes.trim() !== '') {
      insertFields += ', notes';
      insertValues += `, $${paramCount++}`;
      params.push(notes.trim());
    }

    if (groupType === 'subscription') {
      insertFields += ', subscription_frequency, subscription_platform, subscription_deadline_day';
      insertValues += `, $${paramCount++}, $${paramCount++}, $${paramCount++}`;
      params.push(subscriptionFrequency, subscriptionPlatform, subscriptionDeadlineDay);
      
      if (subscriptionFrequency === 'annual') {
        insertFields += ', subscription_deadline_month';
        insertValues += `, $${paramCount++}`;
        params.push(subscriptionDeadlineMonth);
      }
    } else if (groupType === 'general' && deadline) {
      insertFields += ', deadline';
      insertValues += `, $${paramCount++}`;
      params.push(deadline);
    }

    // Create group
    const groupResult = await pool.query(
      `INSERT INTO groups (${insertFields}) 
       VALUES (${insertValues}) 
       RETURNING id, name, invite_code, contribution_amount, max_members, admin_id, currency, accepting_requests, group_type, is_public, subscription_frequency, subscription_platform, subscription_deadline_day, subscription_deadline_month, deadline, notes, created_at`,
      params
    );

    const group = groupResult.rows[0];

    // Add admin as group member
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role, status) 
       VALUES ($1, $2, 'admin', 'active')`,
      [group.id, adminId]
    );

    res.status(201).json({
      message: 'Group created successfully',
      group,
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Server error creating group' });
  }
});

// Get group details by invite code (for preview before joining)
router.get('/preview/:inviteCode', authenticate, async (req, res) => {
  try {
    const { inviteCode } = req.params;

    const groupResult = await pool.query(
      `SELECT 
        g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.accepting_requests, g.group_type,
        g.subscription_frequency, g.subscription_platform, g.subscription_deadline_day, g.subscription_deadline_month, g.deadline, g.notes,
        COUNT(gm.id) FILTER (WHERE gm.status = 'active') as current_members,
        u.name as admin_name
       FROM groups g
       LEFT JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN users u ON g.admin_id = u.id
       WHERE g.invite_code = $1
       GROUP BY g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.accepting_requests, g.group_type,
                g.subscription_frequency, g.subscription_platform, g.subscription_deadline_day, g.subscription_deadline_month, g.deadline, g.notes, g.created_at, u.name`,
      [inviteCode]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const group = groupResult.rows[0];
    
    res.json({
      group: {
        id: group.id,
        name: group.name,
        invite_code: group.invite_code,
        contribution_amount: parseFloat(group.contribution_amount),
        max_members: parseInt(group.max_members),
        currency: group.currency || 'NGN',
        status: group.status || 'active',
        accepting_requests: group.accepting_requests !== false, // Default to true if null
        current_members: parseInt(group.current_members || 0),
        admin_name: group.admin_name,
        group_type: group.group_type || 'birthday',
        subscription_frequency: group.subscription_frequency,
        subscription_platform: group.subscription_platform,
        subscription_deadline_day: group.subscription_deadline_day,
        subscription_deadline_month: group.subscription_deadline_month,
        deadline: group.deadline,
        notes: group.notes,
        created_at: group.created_at,
      },
    });
  } catch (error) {
    console.error('Get group preview error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Join group by invite code
router.post('/join', authenticate, [
  body('inviteCode').trim().notEmpty().withMessage('Invite code is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { inviteCode } = req.body;
    const userId = req.user.id;

    // Find group
    const groupResult = await pool.query(
      `SELECT g.*, COUNT(gm.id) as current_members
       FROM groups g 
       LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.status = 'active'
       WHERE g.invite_code = $1 
       GROUP BY g.id`,
      [inviteCode]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const group = groupResult.rows[0];

    // Check birthday requirement for birthday groups
    if (group.group_type === 'birthday') {
      const userResult = await pool.query(
        'SELECT birthday FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0 || !userResult.rows[0].birthday) {
        return res.status(400).json({ 
          error: 'You must set your birthday before joining a birthday group. Please update your profile first.' 
        });
      }
    }

    // Check if group is closed
    if (group.status === 'closed') {
      return res.status(400).json({ error: 'This group is closed and no longer accepting new members' });
    }

    // Check if already a member (active or pending)
    const memberCheck = await pool.query(
      'SELECT id, status FROM group_members WHERE group_id = $1 AND user_id = $2',
      [group.id, userId]
    );

    const isAdmin = group.admin_id === userId;

    // Check if group is accepting new requests (group creator can bypass this restriction)
    if (group.accepting_requests === false && !isAdmin) {
      return res.status(400).json({ error: 'This group is not currently accepting new join requests' });
    }

    if (memberCheck.rows.length > 0) {
      const memberStatus = memberCheck.rows[0].status;
      const memberId = memberCheck.rows[0].id;
      
      if (memberStatus === 'pending') {
        return res.status(400).json({ error: 'Your join request is still pending admin approval' });
      } else if (memberStatus === 'active') {
        return res.status(400).json({ error: 'You are already a member of this group' });
      } else if (memberStatus === 'inactive') {
        // User was previously rejected, allow them to rejoin
        // Note: Group creator (admin) shouldn't normally be inactive, but if they are, they can rejoin directly as active
        await pool.query(
          `UPDATE group_members 
           SET status = $1, role = $2, joined_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [isAdmin ? 'active' : 'pending', isAdmin ? 'admin' : 'member', memberId]
        );
        
        // Get user name for notification
        const userNameResult = await pool.query(
          'SELECT name FROM users WHERE id = $1',
          [userId]
        );
        const userName = userNameResult.rows[0]?.name || 'Someone';

        // Notify admin if join request is pending
        if (!isAdmin && group.admin_id) {
          await createNotification(
            group.admin_id,
            'group_invite',
            'New Join Request',
            `${userName} wants to join ${group.name}`,
            group.id,
            userId
          );
        }

        return res.json({
          message: isAdmin ? 'Rejoined group successfully' : 'Join request submitted. Waiting for admin approval.',
          group: {
            id: group.id,
            name: group.name,
            contributionAmount: group.contribution_amount,
            maxMembers: group.max_members,
            currency: group.currency || 'NGN',
            currentMembers: parseInt(group.current_members) + (isAdmin ? 1 : 0),
          },
        });
      }
      // If status is something else (like 'removed'), allow them to rejoin by inserting new record
    }

    // Check if group is full
    if (parseInt(group.current_members) >= group.max_members) {
      return res.status(400).json({ error: 'Group is full' });
    }

    // Add member (pending approval if not admin)
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role, status) 
       VALUES ($1, $2, $3, $4)`,
      [group.id, userId, isAdmin ? 'admin' : 'member', isAdmin ? 'active' : 'pending']
    );

    // Get user name for notification
    const userNameResult = await pool.query(
      'SELECT name FROM users WHERE id = $1',
      [userId]
    );
    const userName = userNameResult.rows[0]?.name || 'Someone';

    // Notify admin if join request is pending
    if (!isAdmin && group.admin_id) {
      await createNotification(
        group.admin_id,
        'group_invite',
        'New Join Request',
        `${userName} wants to join ${group.name}`,
        group.id,
        userId
      );
    }

    res.json({
      message: isAdmin ? 'Joined group successfully' : 'Join request submitted. Waiting for admin approval.',
      group: {
        id: group.id,
        name: group.name,
        contributionAmount: group.contribution_amount,
        maxMembers: group.max_members,
        currency: group.currency || 'NGN',
        currentMembers: parseInt(group.current_members) + 1,
      },
    });
  } catch (error) {
    console.error('Join group error:', error);
    res.status(500).json({ error: 'Server error joining group' });
  }
});

// Get user's groups
router.get('/my-groups', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT
        g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.accepting_requests, g.group_type,
        g.subscription_frequency, g.subscription_platform, g.subscription_deadline_day, g.subscription_deadline_month, g.deadline, g.notes,
        g.created_at,
        gm.role, gm.status as member_status, gm.joined_at,
        COUNT(DISTINCT gm2.id) FILTER (WHERE gm2.status = 'active') as active_members,
        u.name as admin_name
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       LEFT JOIN group_members gm2 ON g.id = gm2.group_id
       LEFT JOIN users u ON g.admin_id = u.id
       WHERE gm.user_id = $1
         AND gm.status != 'inactive'
       GROUP BY g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.accepting_requests, g.group_type,
                g.subscription_frequency, g.subscription_platform, g.subscription_deadline_day, g.subscription_deadline_month, g.deadline, g.notes,
                g.created_at, gm.role, gm.status, gm.joined_at, u.name
       ORDER BY gm.joined_at DESC`,
      [userId]
    );

    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all upcoming deadlines across all group types (unified view)
// IMPORTANT: This must be before /:groupId routes to avoid route conflicts
router.get('/upcoming', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    const upcomingItems = [];

    // Get all groups user is a member of
    const groupsResult = await pool.query(
      `SELECT g.*, gm.role, gm.status as member_status
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1 AND gm.status = 'active'`,
      [userId]
    );

    for (const group of groupsResult.rows) {
      if (group.group_type === 'birthday') {
        // Get upcoming birthdays in this group
        const birthdaysResult = await pool.query(
          `SELECT * FROM (
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
              AND u.id != $2
          ) subquery
          WHERE days_until_birthday >= 0 AND days_until_birthday <= $3
          ORDER BY days_until_birthday ASC`,
          [group.id, userId, parseInt(days)]
        );

        for (const birthday of birthdaysResult.rows) {
          // Check if user has paid for this birthday
          const paymentCheck = await pool.query(
            `SELECT status FROM birthday_contributions 
             WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
             AND EXTRACT(YEAR FROM contribution_date) = $4`,
            [group.id, birthday.id, userId, currentYear]
          );

          const hasPaid = paymentCheck.rows.length > 0 && 
                         (paymentCheck.rows[0].status === 'paid' || paymentCheck.rows[0].status === 'confirmed');

          upcomingItems.push({
            type: 'birthday',
            group_id: group.id,
            group_name: group.name,
            group_type: 'birthday',
            currency: group.currency || 'NGN',
            contribution_amount: parseFloat(group.contribution_amount),
            deadline_date: birthday.next_birthday_date,
            days_until_deadline: birthday.days_until_birthday,
            has_paid: hasPaid,
            event_name: `${birthday.name}'s Birthday`,
            event_user_id: birthday.id,
            event_user_name: birthday.name
          });
        }
      } else if (group.group_type === 'subscription') {
        // Calculate next subscription deadline
        let nextDeadline;
        if (group.subscription_frequency === 'monthly') {
          // Next deadline is the deadline day of current or next month
          if (currentDay <= group.subscription_deadline_day) {
            nextDeadline = getDeadlineDate(currentYear, currentMonth - 1, group.subscription_deadline_day);
          } else {
            nextDeadline = getDeadlineDate(currentYear, currentMonth, group.subscription_deadline_day);
          }
        } else {
          // Annual: deadline is on specific month and day
          if (currentMonth < group.subscription_deadline_month || 
              (currentMonth === group.subscription_deadline_month && currentDay <= group.subscription_deadline_day)) {
            nextDeadline = getDeadlineDate(currentYear, group.subscription_deadline_month - 1, group.subscription_deadline_day);
          } else {
            nextDeadline = getDeadlineDate(currentYear + 1, group.subscription_deadline_month - 1, group.subscription_deadline_day);
          }
        }

        nextDeadline.setHours(0, 0, 0, 0);
        const daysUntilDeadline = Math.ceil((nextDeadline - today) / (1000 * 60 * 60 * 24));

        if (daysUntilDeadline >= 0 && daysUntilDeadline <= parseInt(days)) {
          // Check if user has paid for current period
          let periodStart;
          if (group.subscription_frequency === 'monthly') {
            periodStart = new Date(currentYear, currentMonth - 1, 1);
          } else {
            periodStart = new Date(currentYear, 0, 1);
          }

          const paymentCheck = await pool.query(
            `SELECT status FROM subscription_contributions 
             WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3`,
            [group.id, userId, periodStart]
          );

          const hasPaid = paymentCheck.rows.length > 0 && 
                         (paymentCheck.rows[0].status === 'paid' || paymentCheck.rows[0].status === 'confirmed');

          // Get admin account details
          const adminWallet = await pool.query(
            `SELECT w.account_number, w.bank_name, w.account_name, u.name as admin_name
             FROM wallets w
             JOIN users u ON w.user_id = u.id
             WHERE w.user_id = $1`,
            [group.admin_id]
          );

          upcomingItems.push({
            type: 'subscription',
            group_id: group.id,
            group_name: group.name,
            group_type: 'subscription',
            currency: group.currency || 'NGN',
            contribution_amount: parseFloat(group.contribution_amount),
            subscription_frequency: group.subscription_frequency,
            subscription_platform: group.subscription_platform,
            deadline_date: nextDeadline.toISOString().split('T')[0],
            days_until_deadline: daysUntilDeadline,
            has_paid: hasPaid,
            event_name: `${group.subscription_platform} Subscription`,
            admin_account_number: adminWallet.rows[0]?.account_number,
            admin_bank_name: adminWallet.rows[0]?.bank_name,
            admin_account_name: adminWallet.rows[0]?.account_name,
            admin_name: adminWallet.rows[0]?.admin_name
          });
        }
      } else if (group.group_type === 'general') {
        // Check if group has a deadline
        if (group.deadline) {
          const deadline = new Date(group.deadline);
          deadline.setHours(0, 0, 0, 0);
          const daysUntilDeadline = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));

          if (daysUntilDeadline >= 0 && daysUntilDeadline <= parseInt(days)) {
            // Check if user has paid
            const paymentCheck = await pool.query(
              `SELECT status FROM general_contributions 
               WHERE group_id = $1 AND contributor_id = $2`,
              [group.id, userId]
            );

            const hasPaid = paymentCheck.rows.length > 0 && 
                           (paymentCheck.rows[0].status === 'paid' || paymentCheck.rows[0].status === 'confirmed');

            // Get admin account details
            const adminWallet = await pool.query(
              `SELECT w.account_number, w.bank_name, w.account_name, u.name as admin_name
               FROM wallets w
               JOIN users u ON w.user_id = u.id
               WHERE w.user_id = $1`,
              [group.admin_id]
            );

            upcomingItems.push({
              type: 'general',
              group_id: group.id,
              group_name: group.name,
              group_type: 'general',
              currency: group.currency || 'NGN',
              contribution_amount: parseFloat(group.contribution_amount),
              deadline_date: group.deadline,
              days_until_deadline: daysUntilDeadline,
              has_paid: hasPaid,
              event_name: group.name,
              admin_account_number: adminWallet.rows[0]?.account_number,
              admin_bank_name: adminWallet.rows[0]?.bank_name,
              admin_account_name: adminWallet.rows[0]?.account_name,
              admin_name: adminWallet.rows[0]?.admin_name
            });
          }
        }
      }
    }

    // Sort by days until deadline (soonest first)
    upcomingItems.sort((a, b) => a.days_until_deadline - b.days_until_deadline);

    res.json({
      upcoming: upcomingItems,
      total: upcomingItems.length
    });
  } catch (error) {
    console.error('Get upcoming groups error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all overdue contributions across all group types (unified view)
// IMPORTANT: This must be before /:groupId routes to avoid route conflicts
router.get('/overdue', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId } = req.query;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    const overdueItems = [];

    // Get all groups user is a member of
    let groupsQuery = `
      SELECT g.*, gm.role, gm.status as member_status, gm.joined_at
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = $1 AND gm.status = 'active'
    `;
    const groupsParams = [userId];
    
    if (groupId) {
      groupsQuery += ` AND g.id = $2`;
      groupsParams.push(groupId);
    }

    const groupsResult = await pool.query(groupsQuery, groupsParams);

    for (const group of groupsResult.rows) {
      const userJoinDate = new Date(group.joined_at);
      userJoinDate.setHours(0, 0, 0, 0);

      if (group.group_type === 'birthday') {
        // Get overdue birthday contributions
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
          thisYearBirthday.setHours(0, 0, 0, 0);
          
          const daysSinceBirthday = Math.floor((today - thisYearBirthday) / (1000 * 60 * 60 * 24));
          
          // Only mark as overdue if birthday was at least 1 day ago and user was a member
          if (daysSinceBirthday >= 1 && userJoinDate <= thisYearBirthday) {
            const contributionCheck = await pool.query(
              `SELECT status FROM birthday_contributions 
               WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
               AND EXTRACT(YEAR FROM contribution_date) = $4`,
              [group.id, member.id, userId, currentYear]
            );

            const isOverdue = contributionCheck.rows.length === 0 || 
                             contributionCheck.rows[0].status === 'not_paid' || 
                             contributionCheck.rows[0].status === 'not_received';
            
            if (isOverdue) {
              overdueItems.push({
                type: 'birthday',
                group_id: group.id,
                group_name: group.name,
                group_type: 'birthday',
                currency: group.currency || 'NGN',
                contribution_amount: parseFloat(group.contribution_amount),
                deadline_date: thisYearBirthday.toISOString().split('T')[0],
                days_overdue: daysSinceBirthday,
                status: contributionCheck.rows.length > 0 ? contributionCheck.rows[0].status : 'not_paid',
                event_name: `${member.name}'s Birthday`,
                event_user_id: member.id,
                event_user_name: member.name
              });
            }
          }
        }
      } else if (group.group_type === 'subscription') {
        // Calculate subscription deadline
        let deadlineDate;
        if (group.subscription_frequency === 'monthly') {
          // Check current month deadline
          deadlineDate = getDeadlineDate(currentYear, currentMonth - 1, group.subscription_deadline_day);
        } else {
          // Annual - check if deadline has passed this year
          deadlineDate = getDeadlineDate(currentYear, group.subscription_deadline_month - 1, group.subscription_deadline_day);
        }

        deadlineDate.setHours(0, 0, 0, 0);
        const daysSinceDeadline = Math.floor((today - deadlineDate) / (1000 * 60 * 60 * 24));

        // Only mark as overdue if deadline has passed (at least 1 day ago)
        if (daysSinceDeadline >= 1) {
          // Check if user has paid for the period that includes this deadline
          let periodStart;
          if (group.subscription_frequency === 'monthly') {
            periodStart = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), 1);
          } else {
            periodStart = new Date(deadlineDate.getFullYear(), 0, 1);
          }

          const contributionCheck = await pool.query(
            `SELECT status FROM subscription_contributions 
             WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3`,
            [group.id, userId, periodStart]
          );

          const isOverdue = contributionCheck.rows.length === 0 || 
                           contributionCheck.rows[0].status === 'not_paid' || 
                           contributionCheck.rows[0].status === 'not_received';
          
          if (isOverdue) {
            // Get admin account details
            const adminWallet = await pool.query(
              `SELECT w.account_number, w.bank_name, w.account_name, u.name as admin_name
               FROM wallets w
               JOIN users u ON w.user_id = u.id
               WHERE w.user_id = $1`,
              [group.admin_id]
            );

            overdueItems.push({
              type: 'subscription',
              group_id: group.id,
              group_name: group.name,
              group_type: 'subscription',
              currency: group.currency || 'NGN',
              contribution_amount: parseFloat(group.contribution_amount),
              subscription_frequency: group.subscription_frequency,
              subscription_platform: group.subscription_platform,
              deadline_date: deadlineDate.toISOString().split('T')[0],
              days_overdue: daysSinceDeadline,
              status: contributionCheck.rows.length > 0 ? contributionCheck.rows[0].status : 'not_paid',
              event_name: `${group.subscription_platform} Subscription`,
              admin_account_number: adminWallet.rows[0]?.account_number,
              admin_bank_name: adminWallet.rows[0]?.bank_name,
              admin_account_name: adminWallet.rows[0]?.account_name,
              admin_name: adminWallet.rows[0]?.admin_name
            });
          }
        }
      } else if (group.group_type === 'general') {
        // Check if group has a deadline that has passed
        if (group.deadline) {
          const deadline = new Date(group.deadline);
          deadline.setHours(0, 0, 0, 0);
          const daysSinceDeadline = Math.floor((today - deadline) / (1000 * 60 * 60 * 24));
          
          // Only mark as overdue if deadline has passed (at least 1 day ago)
          if (daysSinceDeadline >= 1) {
            const contributionCheck = await pool.query(
              `SELECT status FROM general_contributions 
               WHERE group_id = $1 AND contributor_id = $2`,
              [group.id, userId]
            );

            const isOverdue = contributionCheck.rows.length === 0 || 
                             contributionCheck.rows[0].status === 'not_paid' || 
                             contributionCheck.rows[0].status === 'not_received';
            
            if (isOverdue) {
              // Get admin account details
              const adminWallet = await pool.query(
                `SELECT w.account_number, w.bank_name, w.account_name, u.name as admin_name
                 FROM wallets w
                 JOIN users u ON w.user_id = u.id
                 WHERE w.user_id = $1`,
                [group.admin_id]
              );

              overdueItems.push({
                type: 'general',
                group_id: group.id,
                group_name: group.name,
                group_type: 'general',
                currency: group.currency || 'NGN',
                contribution_amount: parseFloat(group.contribution_amount),
                deadline_date: group.deadline,
                days_overdue: daysSinceDeadline,
                status: contributionCheck.rows.length > 0 ? contributionCheck.rows[0].status : 'not_paid',
                event_name: group.name,
                admin_account_number: adminWallet.rows[0]?.account_number,
                admin_bank_name: adminWallet.rows[0]?.bank_name,
                admin_account_name: adminWallet.rows[0]?.account_name,
                admin_name: adminWallet.rows[0]?.admin_name
              });
            }
          }
        }
      }
    }

    // Sort by days overdue (most overdue first)
    overdueItems.sort((a, b) => b.days_overdue - a.days_overdue);

    res.json({
      overdue: overdueItems,
      total: overdueItems.length
    });
  } catch (error) {
    console.error('Get overdue groups error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper function to calculate admin reliability
// This calculates the admin's reliability based on their payment history as a member
async function calculateAdminReliability(adminId) {
  try {
    // Get admin's payment history across all groups they're a member of
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();

    let totalContributions = 0;
    let totalOnTime = 0;
    let totalOverdue = 0;

    // Get all groups where admin is a member (not admin)
    const memberGroupsResult = await pool.query(
      `SELECT g.id, g.group_type, g.subscription_frequency, g.subscription_deadline_day, g.subscription_deadline_month
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1 AND gm.status = 'active' AND gm.role = 'member'`,
      [adminId]
    );

    // Calculate reliability from birthday contributions
    for (const group of memberGroupsResult.rows.filter(g => g.group_type === 'birthday')) {
      const membersResult = await pool.query(
        `SELECT u.id, u.birthday
         FROM users u
         JOIN group_members gm ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.status = 'active' AND u.birthday IS NOT NULL AND u.id != $2`,
        [group.id, adminId]
      );

      for (const member of membersResult.rows) {
        const memberBirthday = new Date(member.birthday);
        const thisYearBirthday = new Date(currentYear, memberBirthday.getMonth(), memberBirthday.getDate());
        thisYearBirthday.setHours(0, 0, 0, 0);
        const isPast = thisYearBirthday < today;
        const isToday = thisYearBirthday.getTime() === today.getTime();

        if (isPast || isToday) {
          const contributionCheck = await pool.query(
            `SELECT status, contribution_date 
             FROM birthday_contributions 
             WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
             ORDER BY contribution_date DESC
             LIMIT 1`,
            [group.id, member.id, adminId]
          );

          totalContributions++;

          if (contributionCheck.rows.length > 0) {
            const status = contributionCheck.rows[0].status;
            const contributionDate = contributionCheck.rows[0].contribution_date ? new Date(contributionCheck.rows[0].contribution_date) : null;
            const isFullyPaid = (status === 'confirmed');
            
            if (isFullyPaid && contributionDate) {
              contributionDate.setHours(0, 0, 0, 0);
              const paidOnTime = contributionDate <= thisYearBirthday;
              if (paidOnTime) {
                totalOnTime++;
              } else if (isPast) {
                totalOverdue++;
              }
            } else if (isPast && (status === 'not_paid' || status === 'not_received' || status === 'paid')) {
              totalOverdue++;
            }
          } else if (isPast) {
            totalOverdue++;
          }
        }
      }
    }

    // Calculate reliability from subscription contributions
    for (const group of memberGroupsResult.rows.filter(g => g.group_type === 'subscription')) {
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
        deadlineDate = getDeadlineDate(currentYear, currentMonth - 1, group.subscription_deadline_day);
      } else {
        deadlineDate = getDeadlineDate(currentYear, group.subscription_deadline_month - 1, group.subscription_deadline_day);
      }
      deadlineDate.setHours(0, 0, 0, 0);
      const isDeadlinePassed = deadlineDate < today;

      if (isDeadlinePassed) {
        const contributionCheck = await pool.query(
          `SELECT status, contribution_date 
           FROM subscription_contributions 
           WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3
           ORDER BY contribution_date DESC
           LIMIT 1`,
          [group.id, adminId, periodStart]
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

    // Calculate reliability score (0-100)
    let reliabilityScore = 50; // Default neutral score
    let onTimeRate = 0;

    if (totalContributions > 0) {
      onTimeRate = (totalOnTime / totalContributions) * 100;
      reliabilityScore = Math.round(onTimeRate);
    }

    // Generate summary text
    let summaryText = '';
    let rating = 'neutral';

    if (totalContributions === 0) {
      summaryText = 'New admin - No contribution history yet';
      rating = 'new';
    } else if (totalOverdue === 0) {
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

    return {
      metrics: {
        total_contributions: totalContributions,
        total_on_time: totalOnTime,
        total_overdue: totalOverdue,
        on_time_rate: totalContributions > 0 ? Math.round(onTimeRate * 10) / 10 : 0,
        reliability_score: reliabilityScore
      },
      summary: {
        text: summaryText,
        rating: rating // 'new', 'excellent', 'good', 'moderate', 'poor'
      }
    };
  } catch (error) {
    console.error('Error calculating admin reliability:', error);
    return {
      metrics: {
        total_contributions: 0,
        total_on_time: 0,
        total_overdue: 0,
        on_time_rate: 0,
        reliability_score: 50
      },
      summary: {
        text: 'Unable to calculate reliability',
        rating: 'neutral'
      }
    };
  }
}

// Search for discoverable subscription groups
// This endpoint allows users to search for public subscription groups by platform name or group name
router.get('/discover', authenticate, async (req, res) => {
  try {
    const { query, limit = 20 } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchTerm = `%${query.trim().toLowerCase()}%`;

    // Search for public subscription groups matching platform name or group name
    const groupsResult = await pool.query(
      `SELECT 
        g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, 
        g.status, g.accepting_requests, g.subscription_frequency, g.subscription_platform,
        g.subscription_deadline_day, g.subscription_deadline_month, g.notes, g.created_at,
        g.admin_id,
        COUNT(gm.id) FILTER (WHERE gm.status = 'active') as current_members,
        u.name as admin_name,
        CASE WHEN EXISTS (
          SELECT 1 FROM group_members gm2 
          WHERE gm2.group_id = g.id AND gm2.user_id = $2 AND gm2.status = 'active'
        ) THEN true ELSE false END as is_member
       FROM groups g
       LEFT JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN users u ON g.admin_id = u.id
       WHERE g.group_type = 'subscription' 
         AND g.is_public = TRUE
         AND g.status = 'active'
         AND (
           LOWER(g.subscription_platform) LIKE $1 
           OR LOWER(g.name) LIKE $1
         )
       GROUP BY g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, 
                g.currency, g.status, g.accepting_requests, g.subscription_frequency, 
                g.subscription_platform, g.subscription_deadline_day, 
                g.subscription_deadline_month, g.notes, g.created_at, g.admin_id, u.name
       ORDER BY g.created_at DESC
       LIMIT $3`,
      [searchTerm, userId, parseInt(limit)]
    );

    // Get health metrics and admin reliability for each group
    const groupsWithHealth = await Promise.all(
      groupsResult.rows.map(async (group) => {
        // Calculate health for subscription group
        const healthData = await calculateSubscriptionGroupHealth(group.id);
        
        // Calculate admin reliability
        const adminReliability = await calculateAdminReliability(group.admin_id);
        
        return {
          id: group.id,
          name: group.name,
          invite_code: group.invite_code,
          subscription_platform: group.subscription_platform,
          contribution_amount: parseFloat(group.contribution_amount),
          currency: group.currency || 'NGN',
          max_members: parseInt(group.max_members),
          current_members: parseInt(group.current_members || 0),
          subscription_frequency: group.subscription_frequency,
          subscription_deadline_day: group.subscription_deadline_day,
          subscription_deadline_month: group.subscription_deadline_month,
          accepting_requests: group.accepting_requests !== false,
          notes: group.notes,
          is_member: group.is_member,
          admin: {
            id: group.admin_id,
            name: group.admin_name,
            reliability: adminReliability
          },
          created_at: group.created_at,
          health: healthData
        };
      })
    );

    res.json({
      groups: groupsWithHealth,
      total: groupsWithHealth.length
    });
  } catch (error) {
    console.error('Search subscription groups error:', error);
    res.status(500).json({ error: 'Server error searching groups' });
  }
});

// Helper function to calculate subscription group health
async function calculateSubscriptionGroupHealth(groupId) {
  try {
    const groupResult = await pool.query(
      `SELECT id, name, subscription_frequency, subscription_deadline_day, subscription_deadline_month
       FROM groups WHERE id = $1 AND group_type = 'subscription'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return null;
    }

    const group = groupResult.rows[0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    // Get all active members
    const membersResult = await pool.query(
      `SELECT u.id, u.name, gm.joined_at
       FROM users u
       JOIN group_members gm ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND gm.status = 'active'`,
      [groupId]
    );

    let totalExpectedContributions = 0;
    let totalOverdueContributions = 0;
    let membersWithOverdue = new Set();
    let totalOnTime = 0;

    // Calculate period start for current period
    let periodStart;
    if (group.subscription_frequency === 'monthly') {
      periodStart = new Date(currentYear, currentMonth - 1, 1);
    } else {
      periodStart = new Date(currentYear, 0, 1);
    }
    periodStart.setHours(0, 0, 0, 0);

    // Calculate deadline for current period
    let deadlineDate;
    if (group.subscription_frequency === 'monthly') {
      deadlineDate = getDeadlineDate(currentYear, currentMonth - 1, group.subscription_deadline_day);
    } else {
      deadlineDate = getDeadlineDate(currentYear, group.subscription_deadline_month - 1, group.subscription_deadline_day);
    }
    deadlineDate.setHours(0, 0, 0, 0);
    const isDeadlinePassed = deadlineDate < today;

    // Check contributions for current period
    for (const member of membersResult.rows) {
      const memberJoinDate = new Date(member.joined_at);
      memberJoinDate.setHours(0, 0, 0, 0);

      // Only count if member joined before or during the period
      if (memberJoinDate <= deadlineDate) {
        const contributionCheck = await pool.query(
          `SELECT status, contribution_date 
           FROM subscription_contributions 
           WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3
           ORDER BY contribution_date DESC
           LIMIT 1`,
          [groupId, member.id, periodStart]
        );

        let isFullyPaid = false;
        let status = null;
        let contributionDate = null;
        let paidOnTime = false;

        if (contributionCheck.rows.length > 0) {
          status = contributionCheck.rows[0].status;
          contributionDate = contributionCheck.rows[0].contribution_date ? new Date(contributionCheck.rows[0].contribution_date) : null;
          isFullyPaid = (status === 'confirmed');
          
          // On-time = confirmed AND paid on or before deadline
          if (isFullyPaid && contributionDate) {
            contributionDate.setHours(0, 0, 0, 0);
            paidOnTime = contributionDate <= deadlineDate;
          }
        }

        if (!isFullyPaid) {
          totalExpectedContributions++;
        }

        if (paidOnTime) {
          totalOnTime++;
        } else if (status === 'not_paid' || status === 'not_received') {
          if (isDeadlinePassed) {
            totalOverdueContributions++;
            membersWithOverdue.add(member.id);
          }
        } else if (status === 'paid') {
          if (isDeadlinePassed) {
            totalOverdueContributions++;
            membersWithOverdue.add(member.id);
          }
        } else if (status === 'confirmed' && !paidOnTime) {
          totalOverdueContributions++;
          membersWithOverdue.add(member.id);
        } else if (!contributionCheck.rows.length && isDeadlinePassed) {
          totalOverdueContributions++;
          membersWithOverdue.add(member.id);
        }
      }
    }

    // Get reports count for this group
    const reportsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_reports,
        COUNT(*) FILTER (WHERE status = 'reviewed') as reviewed_reports,
        COUNT(*) as total_reports
       FROM reports 
       WHERE reported_group_id = $1`,
      [groupId]
    );

    const pendingReports = parseInt(reportsResult.rows[0]?.pending_reports || 0);
    const reviewedReports = parseInt(reportsResult.rows[0]?.reviewed_reports || 0);
    const totalReports = parseInt(reportsResult.rows[0]?.total_reports || 0);

    // Debug logging
    if (totalReports > 0) {
      console.log('Group health calculation - reports found:', {
        groupId,
        pendingReports,
        reviewedReports,
        totalReports
      });
    }

    // Calculate base health score from contributions
    let healthScore = 100;
    let complianceRate = 100;

    if (totalExpectedContributions > 0) {
      complianceRate = (totalOnTime / totalExpectedContributions) * 100;
      healthScore = Math.round(complianceRate);
    }

    // Reduce health score based on reports
    // Each pending report reduces score by 5 points, each reviewed report by 2 points
    const reportPenalty = (pendingReports * 5) + (reviewedReports * 2);
    healthScore = Math.max(0, healthScore - reportPenalty);
    
    // Update compliance rate to reflect reports penalty
    // Compliance rate should also be reduced by reports
    complianceRate = Math.max(0, complianceRate - reportPenalty);

    // If group has 3+ pending reports, consider closing it
    if (pendingReports >= 3) {
      await pool.query(
        'UPDATE groups SET status = $1 WHERE id = $2 AND status != $1',
        ['closed', groupId]
      );
    }

    // Generate health summary
    let healthText = '';
    let healthRating = 'healthy';
    const membersWithOverdueCount = membersWithOverdue.size;

    if (totalExpectedContributions === 0 && totalReports === 0) {
      healthText = 'New group - No contribution history yet';
      healthRating = 'new';
    } else if (pendingReports >= 3) {
      healthText = `Reported - ${pendingReports} pending report${pendingReports > 1 ? 's' : ''}. Group has been closed.`;
      healthRating = 'reported';
    } else if (membersWithOverdueCount === 0 && totalReports === 0) {
      healthText = 'Healthy - All contributions up to date';
      healthRating = 'healthy';
    } else if (totalReports > 0 && healthScore < 50) {
      healthText = `Unhealthy - ${totalReports} report${totalReports > 1 ? 's' : ''} and ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions`;
      healthRating = 'unhealthy';
    } else if (healthScore >= 90) {
      healthText = `Mostly healthy - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions${totalReports > 0 ? `, ${totalReports} report${totalReports > 1 ? 's' : ''}` : ''}`;
      healthRating = 'mostly_healthy';
    } else if (healthScore >= 75) {
      healthText = `Moderate - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions${totalReports > 0 ? `, ${totalReports} report${totalReports > 1 ? 's' : ''}` : ''}`;
      healthRating = 'moderate';
    } else {
      healthText = `Unhealthy - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions${totalReports > 0 ? `, ${totalReports} report${totalReports > 1 ? 's' : ''}` : ''}`;
      healthRating = 'unhealthy';
    }

    return {
      metrics: {
        total_members: membersResult.rows.length,
        total_expected_contributions: totalExpectedContributions,
        total_on_time: totalOnTime,
        total_overdue: totalOverdueContributions,
        members_with_overdue: membersWithOverdueCount,
        compliance_rate: Math.round(complianceRate * 10) / 10,
        health_score: healthScore,
        pending_reports: pendingReports,
        reviewed_reports: reviewedReports,
        total_reports: totalReports,
        report_penalty: reportPenalty
      },
      health: {
        text: healthText,
        rating: healthRating
      }
    };
  } catch (error) {
    console.error('Error calculating subscription group health:', error);
    return null;
  }
}

// Get group health/score (accessible to everyone, even non-members)
router.get('/:groupId/health', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Get group basic info including group type
    const groupResult = await pool.query(
      'SELECT id, name, status, group_type, subscription_frequency, subscription_deadline_day, subscription_deadline_month FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];
    const groupType = group.group_type || 'birthday';

    // Handle subscription groups
    if (groupType === 'subscription') {
      const healthData = await calculateSubscriptionGroupHealth(groupId);
      
      if (!healthData) {
        return res.status(500).json({ error: 'Error calculating group health' });
      }

      return res.json({
        group: {
          id: group.id,
          name: group.name,
          status: group.status,
          group_type: groupType
        },
        ...healthData
      });
    }

    // Handle birthday groups (existing logic)
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day
    const currentYear = today.getFullYear();

    // Get all active members with birthdays
    const membersResult = await pool.query(
      `SELECT u.id, u.name, u.birthday
       FROM users u
       JOIN group_members gm ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND gm.status = 'active' AND u.birthday IS NOT NULL
       ORDER BY 
         EXTRACT(MONTH FROM u.birthday),
         EXTRACT(DAY FROM u.birthday)`,
      [groupId]
    );

    let totalExpectedContributions = 0;
    let totalOverdueContributions = 0;
    let membersWithOverdue = new Set();
    let totalContributions = 0;
    let totalOnTime = 0;

    // Calculate health metrics for each member's birthday
    for (const member of membersResult.rows) {
      const memberBirthday = new Date(member.birthday);
      const thisYearBirthday = new Date(currentYear, memberBirthday.getMonth(), memberBirthday.getDate());
      thisYearBirthday.setHours(0, 0, 0, 0); // Normalize to start of day
      const isPast = thisYearBirthday < today;
      const isToday = thisYearBirthday.getTime() === today.getTime();

      // Get all active members who should contribute (excluding the birthday person)
      const contributorsResult = await pool.query(
        `SELECT u.id, u.name, gm.joined_at
         FROM users u
         JOIN group_members gm ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.status = 'active' AND u.id != $2`,
        [groupId, member.id]
      );

      for (const contributor of contributorsResult.rows) {
        const contributorJoinDate = new Date(contributor.joined_at);
        contributorJoinDate.setHours(0, 0, 0, 0); // Normalize to start of day
        
        // Only count if contributor was a member when birthday occurred
        if (contributorJoinDate <= thisYearBirthday) {
          // Count today and past birthdays
          const isPastOrToday = isPast || isToday;
          
          if (isPastOrToday) {
            // Check contribution status first
            const contributionCheck = await pool.query(
              `SELECT status, contribution_date 
               FROM birthday_contributions 
               WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
               ORDER BY contribution_date DESC
               LIMIT 1`,
              [groupId, member.id, contributor.id]
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
            }

            // "Expected" = contributions that are still needed
            // Expected includes: not_paid, paid (awaiting confirmation), not_received (rejected)
            // NOT expected: confirmed (regardless of when paid - it's fully done)
            if (!isFullyPaid) {
              totalExpectedContributions++;
            }

            totalContributions++;

            // On-time = confirmed AND paid on or before birthday
            if (paidOnTime) {
              totalOnTime++;
            } else if (status === 'not_paid' || status === 'not_received') {
              // Not paid or rejected - overdue if birthday has passed
              if (isPast) {
                totalOverdueContributions++;
                membersWithOverdue.add(contributor.id);
              }
              // If it's today and not paid/not_received, it's expected but not overdue yet
            } else if (status === 'paid') {
              // Paid but awaiting confirmation - overdue if birthday has passed
              if (isPast) {
                totalOverdueContributions++;
                membersWithOverdue.add(contributor.id);
              }
              // If it's today and paid, it's expected but not overdue yet
            } else if (status === 'confirmed' && !paidOnTime) {
              // Confirmed but paid AFTER birthday - this is overdue (late payment)
              totalOverdueContributions++;
              membersWithOverdue.add(contributor.id);
            } else if (!contributionCheck.rows.length) {
              // No contribution record = not_paid
              // Only count as overdue if birthday has passed (not today)
              if (isPast) {
                totalOverdueContributions++;
                membersWithOverdue.add(contributor.id);
              }
              // If it's today and no record, it's expected but not overdue yet
            }
          }
        }
      }
    }

    // Get reports count for this group
    const reportsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_reports,
        COUNT(*) FILTER (WHERE status = 'reviewed') as reviewed_reports,
        COUNT(*) as total_reports
       FROM reports 
       WHERE reported_group_id = $1`,
      [groupId]
    );

    const pendingReports = parseInt(reportsResult.rows[0]?.pending_reports || 0);
    const reviewedReports = parseInt(reportsResult.rows[0]?.reviewed_reports || 0);
    const totalReports = parseInt(reportsResult.rows[0]?.total_reports || 0);

    // Debug logging
    if (totalReports > 0) {
      console.log('Group health calculation - reports found:', {
        groupId,
        pendingReports,
        reviewedReports,
        totalReports
      });
    }

    // Calculate base health score from contributions
    // Formula: (on-time contributions / total expected contributions) * 100
    let healthScore = 100; // Default perfect score
    let complianceRate = 100;

    if (totalExpectedContributions > 0) {
      complianceRate = (totalOnTime / totalExpectedContributions) * 100;
      healthScore = Math.round(complianceRate);
    }

    // Reduce health score based on reports
    // Each pending report reduces score by 5 points, each reviewed report by 2 points
    const reportPenalty = (pendingReports * 5) + (reviewedReports * 2);
    healthScore = Math.max(0, healthScore - reportPenalty);
    
    // Update compliance rate to reflect reports penalty
    // Compliance rate should also be reduced by reports
    complianceRate = Math.max(0, complianceRate - reportPenalty);

    // If group has 3+ pending reports, consider closing it
    if (pendingReports >= 3) {
      await pool.query(
        'UPDATE groups SET status = $1 WHERE id = $2 AND status != $1',
        ['closed', groupId]
      );
    }

    // Generate health summary
    let healthText = '';
    let healthRating = 'healthy';
    const membersWithOverdueCount = membersWithOverdue.size;

    if (totalExpectedContributions === 0 && totalReports === 0) {
      healthText = 'New group - No contribution history yet';
      healthRating = 'new';
    } else if (pendingReports >= 3) {
      healthText = `Reported - ${pendingReports} pending report${pendingReports > 1 ? 's' : ''}. Group has been closed.`;
      healthRating = 'reported';
    } else if (membersWithOverdueCount === 0 && totalReports === 0) {
      healthText = 'Healthy - All contributions up to date';
      healthRating = 'healthy';
    } else if (totalReports > 0 && healthScore < 50) {
      healthText = `Unhealthy - ${totalReports} report${totalReports > 1 ? 's' : ''} and ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions`;
      healthRating = 'unhealthy';
    } else if (healthScore >= 90) {
      healthText = `Mostly healthy - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions${totalReports > 0 ? `, ${totalReports} report${totalReports > 1 ? 's' : ''}` : ''}`;
      healthRating = 'mostly_healthy';
    } else if (healthScore >= 75) {
      healthText = `Moderate - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions${totalReports > 0 ? `, ${totalReports} report${totalReports > 1 ? 's' : ''}` : ''}`;
      healthRating = 'moderate';
    } else {
      healthText = `Unhealthy - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions${totalReports > 0 ? `, ${totalReports} report${totalReports > 1 ? 's' : ''}` : ''}`;
      healthRating = 'unhealthy';
    }

    res.json({
      group: {
        id: group.id,
        name: group.name,
        status: group.status,
        group_type: groupType
      },
      metrics: {
        total_members: membersResult.rows.length,
        total_expected_contributions: totalExpectedContributions,
        total_on_time: totalOnTime,
        total_overdue: totalOverdueContributions,
        members_with_overdue: membersWithOverdueCount,
        compliance_rate: Math.round(complianceRate * 10) / 10, // Round to 1 decimal
        health_score: healthScore,
        pending_reports: pendingReports,
        reviewed_reports: reviewedReports,
        total_reports: totalReports,
        report_penalty: reportPenalty
      },
      health: {
        text: healthText,
        rating: healthRating // 'new', 'healthy', 'mostly_healthy', 'moderate', 'unhealthy', 'reported'
      }
    });
  } catch (error) {
    console.error('Get group health error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get group details
router.get('/:groupId', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Check if user is member and get their status
    const memberCheck = await pool.query(
      'SELECT role, status FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    // Get group details
    const groupResult = await pool.query(
      `SELECT g.*, u.name as admin_name,
        COUNT(DISTINCT gm.id) FILTER (WHERE gm.status = 'active') as active_members,
        COUNT(DISTINCT gm2.id) FILTER (WHERE gm2.status = 'pending') as pending_members
       FROM groups g
       LEFT JOIN users u ON g.admin_id = u.id
       LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.status = 'active'
       LEFT JOIN group_members gm2 ON g.id = gm2.group_id AND gm2.status = 'pending'
       WHERE g.id = $1
       GROUP BY g.id, u.name`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];
    const userStatus = memberCheck.rows[0].status;
    const userRole = memberCheck.rows[0].role;
    
    group.userRole = userRole;
    group.userStatus = userStatus;

    // If user is pending or inactive, only return basic info
    if (userStatus !== 'active') {
      return res.json({
        group: {
          id: group.id,
          name: group.name,
          invite_code: group.invite_code,
          userRole: userRole,
          userStatus: userStatus,
          status: userStatus, // Return actual status (pending or inactive)
        },
      });
    }

    // Include admin wallet information for subscription and general groups
    if (group.group_type === 'subscription' || group.group_type === 'general') {
      const walletResult = await pool.query(
        `SELECT account_name, bank_name, account_number, iban, swift_bic, routing_number, sort_code, branch_code, branch_address
         FROM wallets
         WHERE user_id = $1`,
        [group.admin_id]
      );

      if (walletResult.rows.length > 0) {
        const wallet = walletResult.rows[0];
        group.admin_wallet = {
          account_name: wallet.account_name || null,
          bank_name: wallet.bank_name || null,
          account_number: wallet.account_number || null,
          iban: wallet.iban || null,
          swift_bic: wallet.swift_bic || null,
          routing_number: wallet.routing_number || null,
          sort_code: wallet.sort_code || null,
          branch_code: wallet.branch_code || null,
          branch_address: wallet.branch_address || null,
        };
      } else {
        // If no wallet found, set admin_wallet to null
        group.admin_wallet = null;
      }
    }

    // Calculate group health score based on group type
    let healthScore = 100;
    let complianceRate = 100;
    let healthText = 'Healthy - All contributions up to date';
    let healthRating = 'healthy';
    let pendingReports = 0;
    let reviewedReports = 0;
    let totalReports = 0;
    let reportPenalty = 0;

    // For subscription groups, use the subscription health calculation
    if (group.group_type === 'subscription') {
      const healthData = await calculateSubscriptionGroupHealth(groupId);
      if (healthData) {
        healthScore = healthData.metrics.health_score;
        complianceRate = healthData.metrics.compliance_rate;
        healthText = healthData.health.text;
        healthRating = healthData.health.rating;
        pendingReports = healthData.metrics.pending_reports || 0;
        reviewedReports = healthData.metrics.reviewed_reports || 0;
        totalReports = healthData.metrics.total_reports || 0;
        reportPenalty = healthData.metrics.report_penalty || 0;
      }
    } else {
      // For birthday and general groups, use birthday health calculation
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day
      const currentYear = today.getFullYear();

      // Get all active members with birthdays
      const membersResult = await pool.query(
        `SELECT u.id, u.name, u.birthday
         FROM users u
         JOIN group_members gm ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.status = 'active' AND u.birthday IS NOT NULL
         ORDER BY 
           EXTRACT(MONTH FROM u.birthday),
           EXTRACT(DAY FROM u.birthday)`,
        [groupId]
      );

      let totalExpectedContributions = 0;
      let totalOverdueContributions = 0;
      let membersWithOverdue = new Set();
      let totalContributions = 0;
      let totalOnTime = 0;

      // Calculate health metrics for each member's birthday
      for (const member of membersResult.rows) {
        const memberBirthday = new Date(member.birthday);
        const thisYearBirthday = new Date(currentYear, memberBirthday.getMonth(), memberBirthday.getDate());
        thisYearBirthday.setHours(0, 0, 0, 0); // Normalize to start of day
        const isPast = thisYearBirthday < today;
        const isToday = thisYearBirthday.getTime() === today.getTime();

        // Get all active members who should contribute (excluding the birthday person)
        const contributorsResult = await pool.query(
          `SELECT u.id, u.name, gm.joined_at
           FROM users u
           JOIN group_members gm ON u.id = gm.user_id
           WHERE gm.group_id = $1 AND gm.status = 'active' AND u.id != $2`,
          [groupId, member.id]
        );

        for (const contributor of contributorsResult.rows) {
          const contributorJoinDate = new Date(contributor.joined_at);
          contributorJoinDate.setHours(0, 0, 0, 0); // Normalize to start of day
          
          // Only count if contributor was a member when birthday occurred
          if (contributorJoinDate <= thisYearBirthday) {
            // Count today and past birthdays
            const isPastOrToday = isPast || isToday;
            
            if (isPastOrToday) {
              // Check contribution status first
              const contributionCheck = await pool.query(
                `SELECT status, contribution_date 
                 FROM birthday_contributions 
                 WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
                 ORDER BY contribution_date DESC
                 LIMIT 1`,
                [groupId, member.id, contributor.id]
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
              }

              // "Expected" = contributions that are still needed
              // Expected includes: not_paid, paid (awaiting confirmation), not_received (rejected)
              // NOT expected: confirmed (regardless of when paid - it's fully done)
              if (!isFullyPaid) {
                totalExpectedContributions++;
              }

              totalContributions++;

              // On-time = confirmed AND paid on or before birthday
              if (paidOnTime) {
                totalOnTime++;
              } else if (status === 'not_paid' || status === 'not_received') {
                // Not paid or rejected - overdue if birthday has passed
                if (isPast) {
                  totalOverdueContributions++;
                  membersWithOverdue.add(contributor.id);
                }
                // If it's today and not paid/not_received, it's expected but not overdue yet
              } else if (status === 'paid') {
                // Paid but awaiting confirmation - overdue if birthday has passed
                if (isPast) {
                  totalOverdueContributions++;
                  membersWithOverdue.add(contributor.id);
                }
                // If it's today and paid, it's expected but not overdue yet
              } else if (status === 'confirmed' && !paidOnTime) {
                // Confirmed but paid AFTER birthday - this is overdue (late payment)
                totalOverdueContributions++;
                membersWithOverdue.add(contributor.id);
              } else if (!contributionCheck.rows.length) {
                // No contribution record = not_paid
                // Only count as overdue if birthday has passed (not today)
                if (isPast) {
                  totalOverdueContributions++;
                  membersWithOverdue.add(contributor.id);
                }
                // If it's today and no record, it's expected but not overdue yet
              }
            }
          }
        }
      }

      // Get reports count for this group
      const reportsResult = await pool.query(
        `SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending_reports,
          COUNT(*) FILTER (WHERE status = 'reviewed') as reviewed_reports,
          COUNT(*) as total_reports
         FROM reports 
         WHERE reported_group_id = $1`,
        [groupId]
      );

      pendingReports = parseInt(reportsResult.rows[0]?.pending_reports || 0);
      reviewedReports = parseInt(reportsResult.rows[0]?.reviewed_reports || 0);
      totalReports = parseInt(reportsResult.rows[0]?.total_reports || 0);

      // Debug logging
      if (totalReports > 0) {
        console.log('Group health calculation - reports found:', {
          groupId,
          pendingReports,
          reviewedReports,
          totalReports
        });
      }

      // Calculate base health score from contributions
      // Formula: (on-time contributions / total expected contributions) * 100
      healthScore = 100; // Default perfect score
      complianceRate = 100;

      if (totalExpectedContributions > 0) {
        complianceRate = (totalOnTime / totalExpectedContributions) * 100;
        healthScore = Math.round(complianceRate);
      }

      // Reduce health score based on reports
      // Each pending report reduces score by 5 points, each reviewed report by 2 points
      reportPenalty = (pendingReports * 5) + (reviewedReports * 2);
      healthScore = Math.max(0, healthScore - reportPenalty);
      
      // Update compliance rate to reflect reports penalty
      // Compliance rate should also be reduced by reports
      complianceRate = Math.max(0, complianceRate - reportPenalty);

      // If group has 3+ pending reports, consider closing it
      if (pendingReports >= 3) {
        await pool.query(
          'UPDATE groups SET status = $1 WHERE id = $2 AND status != $1',
          ['closed', groupId]
        );
      }

      // Generate health summary
      const membersWithOverdueCount = membersWithOverdue.size;

      if (totalExpectedContributions === 0 && totalReports === 0) {
        healthText = 'New group - No contribution history yet';
        healthRating = 'new';
      } else if (pendingReports >= 3) {
        healthText = `Reported - ${pendingReports} pending report${pendingReports > 1 ? 's' : ''}. Group has been closed.`;
        healthRating = 'reported';
      } else if (membersWithOverdueCount === 0 && totalReports === 0) {
        healthText = 'Healthy - All contributions up to date';
        healthRating = 'healthy';
      } else if (totalReports > 0 && healthScore < 50) {
        healthText = `Unhealthy - ${totalReports} report${totalReports > 1 ? 's' : ''} and ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions`;
        healthRating = 'unhealthy';
      } else if (healthScore >= 90) {
        healthText = `Mostly healthy - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions${totalReports > 0 ? `, ${totalReports} report${totalReports > 1 ? 's' : ''}` : ''}`;
        healthRating = 'mostly_healthy';
      } else if (healthScore >= 75) {
        healthText = `Moderate - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions${totalReports > 0 ? `, ${totalReports} report${totalReports > 1 ? 's' : ''}` : ''}`;
        healthRating = 'moderate';
      } else {
        healthText = `Unhealthy - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions${totalReports > 0 ? `, ${totalReports} report${totalReports > 1 ? 's' : ''}` : ''}`;
        healthRating = 'unhealthy';
      }
    }

    // Add health score to group response
    group.health_score = healthScore;
    group.health_rating = healthRating;
    group.health_text = healthText;
    group.pending_reports = pendingReports;
    group.reviewed_reports = reviewedReports;
    group.total_reports = totalReports;

    res.json({ group });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update group settings (admin only)
router.put('/:groupId', authenticate, [
  body('name').optional().trim().notEmpty(),
  body('contributionAmount').optional().isFloat({ min: 0 }),
  body('maxMembers').optional().isInt({ min: 2 }),
  body('acceptingRequests').optional().isBoolean(),
  body('isPublic').optional().isBoolean(),
  body('notes').optional().trim(),
  body('deadline').optional().isISO8601().withMessage('Deadline must be a valid date'),
  body('subscriptionDeadlineDay').optional().isInt({ min: 1, max: 31 }).withMessage('Subscription deadline day must be between 1 and 31'),
  body('subscriptionDeadlineMonth').optional().isInt({ min: 1, max: 12 }).withMessage('Subscription deadline month must be between 1 and 12'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { groupId } = req.params;
    const userId = req.user.id;

    // Check if user is admin and get group type
    const groupCheck = await pool.query(
      `SELECT g.group_type, gm.role 
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE g.id = $1 AND gm.user_id = $2`,
      [groupId, userId]
    );

    if (groupCheck.rows.length === 0 || groupCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update group settings' });
    }

    const groupType = groupCheck.rows[0].group_type;
    const { 
      name, 
      contributionAmount, 
      maxMembers, 
      acceptingRequests,
      isPublic,
      notes,
      deadline,
      subscriptionDeadlineDay,
      subscriptionDeadlineMonth
    } = req.body;

    // Validate isPublic can only be set for subscription groups
    if (isPublic !== undefined && groupType !== 'subscription') {
      return res.status(400).json({ error: 'Only subscription groups can be made public' });
    }

    // Get current group details before updating (to check if contribution amount, deadline, or max_members changed)
    const currentGroupResult = await pool.query(
      'SELECT contribution_amount, name, currency, deadline, subscription_deadline_day, subscription_deadline_month, subscription_frequency, max_members FROM groups WHERE id = $1',
      [groupId]
    );

    if (currentGroupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const currentGroup = currentGroupResult.rows[0];
    const oldContributionAmount = parseFloat(currentGroup.contribution_amount);
    const isContributionAmountChanging = contributionAmount !== undefined && 
                                         parseFloat(contributionAmount) !== oldContributionAmount;
    
    // Check if max_members is changing (only for birthday groups)
    let isMaxMembersChanging = false;
    let oldMaxMembers = null;
    let newMaxMembers = null;
    
    if (groupType === 'birthday' && maxMembers !== undefined) {
      oldMaxMembers = currentGroup.max_members;
      newMaxMembers = maxMembers;
      if (oldMaxMembers !== newMaxMembers) {
        isMaxMembersChanging = true;
      }
    }
    
    // Check if deadline is changing
    let isDeadlineChanging = false;
    let oldDeadline = null;
    let newDeadline = null;
    
    if (groupType === 'general' && deadline !== undefined) {
      const oldDate = currentGroup.deadline ? new Date(currentGroup.deadline).toISOString().split('T')[0] : null;
      const newDate = new Date(deadline).toISOString().split('T')[0];
      if (oldDate !== newDate) {
        isDeadlineChanging = true;
        oldDeadline = oldDate;
        newDeadline = newDate;
      }
    } else if (groupType === 'subscription') {
      const oldDay = currentGroup.subscription_deadline_day;
      const oldMonth = currentGroup.subscription_deadline_month;
      const newDay = subscriptionDeadlineDay !== undefined ? subscriptionDeadlineDay : oldDay;
      const newMonth = subscriptionDeadlineMonth !== undefined ? subscriptionDeadlineMonth : oldMonth;
      
      if ((subscriptionDeadlineDay !== undefined && subscriptionDeadlineDay !== oldDay) ||
          (subscriptionDeadlineMonth !== undefined && subscriptionDeadlineMonth !== oldMonth)) {
        isDeadlineChanging = true;
        oldDeadline = { day: oldDay, month: oldMonth };
        newDeadline = { day: newDay, month: newMonth };
      }
    }

    // Validate deadline fields based on group type
    if (groupType === 'general' && deadline) {
      const deadlineDate = new Date(deadline);
      if (deadlineDate < new Date()) {
        return res.status(400).json({ error: 'Deadline cannot be in the past' });
      }
    }

    if (groupType === 'subscription') {
      if (subscriptionDeadlineDay !== undefined && (subscriptionDeadlineDay < 1 || subscriptionDeadlineDay > 31)) {
        return res.status(400).json({ error: 'Subscription deadline day must be between 1 and 31' });
      }
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (contributionAmount !== undefined) {
      updates.push(`contribution_amount = $${paramCount++}`);
      values.push(contributionAmount);
    }

    if (maxMembers !== undefined) {
      updates.push(`max_members = $${paramCount++}`);
      values.push(maxMembers);
    }

    if (acceptingRequests !== undefined) {
      updates.push(`accepting_requests = $${paramCount++}`);
      values.push(acceptingRequests);
    }

    // Update is_public for subscription groups only
    if (groupType === 'subscription' && isPublic !== undefined) {
      updates.push(`is_public = $${paramCount++}`);
      values.push(isPublic);
    }

    // Update notes (for all group types)
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      // Allow setting notes to null/empty string to clear them
      values.push(notes === null || notes === '' ? null : notes.trim());
    }

    // Update deadline for general groups
    if (groupType === 'general' && deadline !== undefined) {
      updates.push(`deadline = $${paramCount++}`);
      values.push(deadline);
    }

    // Update subscription deadline for subscription groups
    if (groupType === 'subscription') {
      if (subscriptionDeadlineDay !== undefined) {
        updates.push(`subscription_deadline_day = $${paramCount++}`);
        values.push(subscriptionDeadlineDay);
      }
      if (subscriptionDeadlineMonth !== undefined) {
        updates.push(`subscription_deadline_month = $${paramCount++}`);
        values.push(subscriptionDeadlineMonth);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(groupId);
    const query = `UPDATE groups SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

    const result = await pool.query(query, values);
    const updatedGroup = result.rows[0];

    // If contribution amount changed, notify all members
    if (isContributionAmountChanging) {
      try {
        // Get all active members (excluding the admin who made the change)
        const membersResult = await pool.query(
          `SELECT u.id, u.name, u.email, u.expo_push_token
           FROM users u
           JOIN group_members gm ON u.id = gm.user_id
           WHERE gm.group_id = $1 AND gm.status = 'active' AND u.id != $2`,
          [groupId, userId]
        );

        const newContributionAmount = parseFloat(contributionAmount);
        const groupName = updatedGroup.name || currentGroup.name;
        const currency = updatedGroup.currency || currentGroup.currency || 'NGN';

        // Get admin name for email
        const adminResult = await pool.query(
          'SELECT name FROM users WHERE id = $1',
          [userId]
        );
        const adminName = adminResult.rows[0]?.name || 'Group Admin';

        // Send notifications to all members
        const { createNotification } = require('../utils/notifications');
        const { sendContributionAmountUpdateEmail } = require('../utils/email');

        for (const member of membersResult.rows) {
          // Send email
          if (member.email) {
            try {
              await sendContributionAmountUpdateEmail(
                member.email,
                member.name,
                groupName,
                oldContributionAmount,
                newContributionAmount,
                currency,
                adminName
              );
            } catch (err) {
              console.error(`Error sending contribution amount update email to ${member.email}:`, err);
            }
          }

          // Send in-app and push notifications
          try {
            await createNotification(
              member.id,
              'contribution_amount_updated',
              'Contribution Amount Updated',
              `Group Admin has updated the contribution amount for "${groupName}". Check your email for more information.`,
              groupId,
              null
            );
          } catch (err) {
            console.error(`Error sending notification to user ${member.id}:`, err);
          }
        }
      } catch (error) {
        console.error('Error sending contribution amount update notifications:', error);
        // Don't fail the request if notifications fail
      }
    }

    // If deadline changed, notify all members
    if (isDeadlineChanging) {
      try {
        // Get all active members (excluding the admin who made the change)
        const membersResult = await pool.query(
          `SELECT u.id, u.name, u.email, u.expo_push_token
           FROM users u
           JOIN group_members gm ON u.id = gm.user_id
           WHERE gm.group_id = $1 AND gm.status = 'active' AND u.id != $2`,
          [groupId, userId]
        );

        const groupName = updatedGroup.name || currentGroup.name;

        // Get admin name for email
        const adminResult = await pool.query(
          'SELECT name FROM users WHERE id = $1',
          [userId]
        );
        const adminName = adminResult.rows[0]?.name || 'Group Admin';

        // Send notifications to all members
        const { createNotification } = require('../utils/notifications');
        const { sendDeadlineUpdateEmail } = require('../utils/email');

        for (const member of membersResult.rows) {
          // Send email
          if (member.email) {
            try {
              if (groupType === 'general') {
                await sendDeadlineUpdateEmail(
                  member.email,
                  member.name,
                  groupName,
                  'general',
                  oldDeadline,
                  newDeadline,
                  null,
                  adminName
                );
              } else if (groupType === 'subscription') {
                await sendDeadlineUpdateEmail(
                  member.email,
                  member.name,
                  groupName,
                  'subscription',
                  oldDeadline,
                  newDeadline,
                  currentGroup.subscription_frequency,
                  adminName
                );
              }
            } catch (err) {
              console.error(`Error sending deadline update email to ${member.email}:`, err);
            }
          }

          // Send in-app and push notifications
          try {
            await createNotification(
              member.id,
              'deadline_updated',
              'Deadline Updated',
              `Group Admin has updated the deadline for "${groupName}". Check your email for more information.`,
              groupId,
              null
            );
          } catch (err) {
            console.error(`Error sending notification to user ${member.id}:`, err);
          }
        }
      } catch (error) {
        console.error('Error sending deadline update notifications:', error);
        // Don't fail the request if notifications fail
      }
    }

    // If max_members changed for birthday groups, notify all members
    if (isMaxMembersChanging && groupType === 'birthday') {
      try {
        // Get all active members (excluding the admin who made the change)
        const membersResult = await pool.query(
          `SELECT u.id, u.name, u.email, u.expo_push_token
           FROM users u
           JOIN group_members gm ON u.id = gm.user_id
           WHERE gm.group_id = $1 AND gm.status = 'active' AND u.id != $2`,
          [groupId, userId]
        );

        const groupName = updatedGroup.name || currentGroup.name;

        // Get admin name for email
        const adminResult = await pool.query(
          'SELECT name FROM users WHERE id = $1',
          [userId]
        );
        const adminName = adminResult.rows[0]?.name || 'Group Admin';

        // Send notifications to all members
        const { createNotification } = require('../utils/notifications');
        const { sendMaxMembersUpdateEmail } = require('../utils/email');

        for (const member of membersResult.rows) {
          // Send email
          if (member.email) {
            try {
              await sendMaxMembersUpdateEmail(
                member.email,
                member.name,
                groupName,
                oldMaxMembers,
                newMaxMembers,
                adminName
              );
            } catch (err) {
              console.error(`Error sending max members update email to ${member.email}:`, err);
            }
          }

          // Send in-app and push notifications
          try {
            await createNotification(
              member.id,
              'max_members_updated',
              'Max Members Updated',
              `Group Admin has updated the max members for "${groupName}". Check your email for more information.`,
              groupId,
              null
            );
          } catch (err) {
            console.error(`Error sending notification to user ${member.id}:`, err);
          }
        }
      } catch (error) {
        console.error('Error sending max members update notifications:', error);
        // Don't fail the request if notifications fail
      }
    }

    res.json({ group: updatedGroup });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ error: 'Server error updating group' });
  }
});

// Close group (creator or admin only)
router.put('/:groupId/close', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    const isSystemAdmin = req.user.is_admin;

    // Get group details
    const groupResult = await pool.query(
      'SELECT id, admin_id, status FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];

    // Check if user is the creator or a system admin
    if (group.admin_id !== userId && !isSystemAdmin) {
      return res.status(403).json({ error: 'Only the group creator or an admin can close this group' });
    }

    // Check if group is already closed
    if (group.status === 'closed') {
      return res.status(400).json({ error: 'Group is already closed' });
    }

    // Close the group
    const result = await pool.query(
      'UPDATE groups SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, status',
      ['closed', groupId]
    );

    res.json({
      message: 'Group closed successfully',
      group: result.rows[0],
    });
  } catch (error) {
    console.error('Close group error:', error);
    res.status(500).json({ error: 'Server error closing group' });
  }
});

// Reopen group (creator or admin only)
router.put('/:groupId/reopen', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    const isSystemAdmin = req.user.is_admin;

    // Get group details
    const groupResult = await pool.query(
      'SELECT id, admin_id, status FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];

    // Check if user is the creator or a system admin
    if (group.admin_id !== userId && !isSystemAdmin) {
      return res.status(403).json({ error: 'Only the group creator or an admin can reopen this group' });
    }

    // Check if group is already active
    if (group.status === 'active') {
      return res.status(400).json({ error: 'Group is already open' });
    }

    // Reopen the group
    const result = await pool.query(
      'UPDATE groups SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, status',
      ['active', groupId]
    );

    res.json({
      message: 'Group reopened successfully',
      group: result.rows[0],
    });
  } catch (error) {
    console.error('Reopen group error:', error);
    res.status(500).json({ error: 'Server error reopening group' });
  }
});

// Get group compliance view (shows who hasn't paid for each birthday in a group)
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
      'SELECT id, name, contribution_amount, currency, admin_id FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];
    const currentYear = new Date().getFullYear();
    const today = new Date();

    // Get all active members with birthdays
    const membersResult = await pool.query(
      `SELECT u.id, u.name, u.birthday
       FROM users u
       JOIN group_members gm ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND gm.status = 'active' AND u.birthday IS NOT NULL
       ORDER BY 
         EXTRACT(MONTH FROM u.birthday),
         EXTRACT(DAY FROM u.birthday)`,
      [groupId]
    );

    const complianceData = [];

    for (const member of membersResult.rows) {
      const memberBirthday = new Date(member.birthday);
      const thisYearBirthday = new Date(currentYear, memberBirthday.getMonth(), memberBirthday.getDate());
      const nextYearBirthday = new Date(currentYear + 1, memberBirthday.getMonth(), memberBirthday.getDate());
      
      // Determine which birthday to check (this year or next year)
      const birthdayToCheck = thisYearBirthday < today ? nextYearBirthday : thisYearBirthday;
      const isPast = thisYearBirthday < today;
      const daysUntilOrSince = Math.floor((today - thisYearBirthday) / (1000 * 60 * 60 * 24));

      // Get all active members who should contribute (only those who were members when birthday occurred)
      const contributorsResult = await pool.query(
        `SELECT u.id, u.name, gm.joined_at
         FROM users u
         JOIN group_members gm ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.status = 'active' AND u.id != $2`,
        [groupId, member.id]
      );

      const contributors = [];
      let paidCount = 0;
      let unpaidCount = 0;
      let overdueCount = 0;

      for (const contributor of contributorsResult.rows) {
        // Only include contributors who were members when the birthday occurred
        const contributorJoinDate = new Date(contributor.joined_at);
        if (contributorJoinDate > thisYearBirthday) {
          // Contributor joined after the birthday, skip them
          continue;
        }

        // Check contribution status for this year's birthday
        const contributionCheck = await pool.query(
          `SELECT id, status, contribution_date, amount, note
           FROM birthday_contributions 
           WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
           AND EXTRACT(YEAR FROM contribution_date) = $4`,
          [groupId, member.id, contributor.id, currentYear]
        );

        let status = 'not_paid';
        let contributionDate = null;
        let amount = null;
        let note = null;

        if (contributionCheck.rows.length > 0) {
          status = contributionCheck.rows[0].status;
          contributionDate = contributionCheck.rows[0].contribution_date;
          amount = parseFloat(contributionCheck.rows[0].amount);
          note = contributionCheck.rows[0].note;
        }

        const isPaid = status === 'paid' || status === 'confirmed';
        // 'not_received' means they marked as paid but celebrant rejected it, so still overdue
        const isOverdue = isPast && !isPaid && (status === 'not_paid' || status === 'not_received');

        if (isPaid) paidCount++;
        else if (isOverdue) {
          unpaidCount++;
          overdueCount++;
        } else {
          unpaidCount++;
        }

        contributors.push({
          contributor_id: contributor.id,
          contributor_name: contributor.name,
          status: status,
          contribution_date: contributionDate,
          amount: amount,
          note: note,
          is_overdue: isOverdue,
          days_overdue: isOverdue ? daysUntilOrSince : null,
          is_admin: contributor.id === group.admin_id
        });
      }

      complianceData.push({
        birthday_user_id: member.id,
        birthday_user_name: member.name,
        birthday_date: member.birthday,
        this_year_birthday: thisYearBirthday.toISOString().split('T')[0],
        is_past: isPast,
        days_until_or_since: daysUntilOrSince,
        total_contributors: contributors.length,
        paid_count: paidCount,
        unpaid_count: unpaidCount,
        overdue_count: overdueCount,
        contributors: contributors
      });
    }

    res.json({
      group_id: group.id,
      group_name: group.name,
      currency: group.currency || 'NGN',
      contribution_amount: parseFloat(group.contribution_amount),
      admin_id: group.admin_id,
      compliance: complianceData
    });
  } catch (error) {
    console.error('Get group compliance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
