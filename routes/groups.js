const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { generateInviteCode } = require('../utils/helpers');

const router = express.Router();

// Create group
router.post('/create', authenticate, [
  body('name').trim().notEmpty().withMessage('Group name is required'),
  body('contributionAmount').isFloat({ min: 0 }).withMessage('Contribution amount must be a positive number'),
  body('maxMembers').isInt({ min: 2 }).withMessage('Max members must be at least 2'),
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, contributionAmount, maxMembers, currency = 'NGN' } = req.body;
    const adminId = req.user.id;

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

    // Create group
    const groupResult = await pool.query(
      `INSERT INTO groups (name, invite_code, contribution_amount, max_members, admin_id, currency) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, name, invite_code, contribution_amount, max_members, admin_id, currency, accepting_requests, created_at`,
      [name, inviteCode, contributionAmount, maxMembers, adminId, currency]
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
        g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.accepting_requests, g.created_at,
        COUNT(gm.id) FILTER (WHERE gm.status = 'active') as current_members,
        u.name as admin_name
       FROM groups g
       LEFT JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN users u ON g.admin_id = u.id
       WHERE g.invite_code = $1
       GROUP BY g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.accepting_requests, g.created_at, u.name`,
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
        g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.accepting_requests, g.created_at,
        gm.role, gm.status as member_status,
        COUNT(DISTINCT gm2.id) FILTER (WHERE gm2.status = 'active') as active_members,
        u.name as admin_name
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       LEFT JOIN group_members gm2 ON g.id = gm2.group_id
       LEFT JOIN users u ON g.admin_id = u.id
       WHERE gm.user_id = $1
         AND gm.status != 'inactive'
       GROUP BY g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.accepting_requests, g.created_at, gm.role, gm.status, u.name
       ORDER BY g.created_at DESC`,
      [userId]
    );

    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get group health/score (accessible to everyone, even non-members)
router.get('/:groupId/health', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Get group basic info
    const groupResult = await pool.query(
      'SELECT id, name, status FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];
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
          // Count today and past birthdays as expected
          // Today's birthday: count as expected but not overdue if not paid
          // Past birthday: count as expected and overdue if not paid
          const isPastOrToday = isPast || isToday;
          
          if (isPastOrToday) {
            totalExpectedContributions++;

            // Check contribution status
            // Check for any contribution for this birthday (don't filter by year since contribution_date 
            // is when they paid, not when the birthday was)
            // We'll match by group, birthday_user, and contributor - there should only be one per year anyway
            const contributionCheck = await pool.query(
              `SELECT status, contribution_date 
               FROM birthday_contributions 
               WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
               ORDER BY contribution_date DESC
               LIMIT 1`,
              [groupId, member.id, contributor.id]
            );

            totalContributions++;

            if (contributionCheck.rows.length > 0) {
              const status = contributionCheck.rows[0].status;
              if (status === 'paid' || status === 'confirmed') {
                totalOnTime++;
              } else if (status === 'not_paid' || status === 'not_received') {
                // Only count as overdue if birthday has passed (not today)
                if (isPast) {
                  totalOverdueContributions++;
                  membersWithOverdue.add(contributor.id);
                }
                // If it's today and not paid, it's expected but not overdue yet
              }
            } else {
              // No contribution record
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

    // Calculate health score (0-100)
    // Formula: (on-time contributions / total expected contributions) * 100
    let healthScore = 100; // Default perfect score
    let complianceRate = 100;

    if (totalExpectedContributions > 0) {
      complianceRate = (totalOnTime / totalExpectedContributions) * 100;
      healthScore = Math.round(complianceRate);
    }

    // Generate health summary
    let healthText = '';
    let healthRating = 'healthy';
    const membersWithOverdueCount = membersWithOverdue.size;

    if (totalExpectedContributions === 0) {
      healthText = 'New group - No contribution history yet';
      healthRating = 'new';
    } else if (membersWithOverdueCount === 0) {
      healthText = 'Healthy - All contributions up to date';
      healthRating = 'healthy';
    } else if (healthScore >= 90) {
      healthText = `Mostly healthy - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions`;
      healthRating = 'mostly_healthy';
    } else if (healthScore >= 75) {
      healthText = `Moderate - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions`;
      healthRating = 'moderate';
    } else {
      healthText = `Unhealthy - ${membersWithOverdueCount} member${membersWithOverdueCount > 1 ? 's' : ''} with overdue contributions`;
      healthRating = 'unhealthy';
    }

    res.json({
      group: {
        id: group.id,
        name: group.name,
        status: group.status
      },
      metrics: {
        total_members: membersResult.rows.length,
        total_expected_contributions: totalExpectedContributions,
        total_on_time: totalOnTime,
        total_overdue: totalOverdueContributions,
        members_with_overdue: membersWithOverdueCount,
        compliance_rate: Math.round(complianceRate * 10) / 10, // Round to 1 decimal
        health_score: healthScore
      },
      health: {
        text: healthText,
        rating: healthRating // 'new', 'healthy', 'mostly_healthy', 'moderate', 'unhealthy'
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
       GROUP BY g.id, u.name, g.accepting_requests`,
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
], async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Check if user is admin
    const memberCheck = await pool.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0 || memberCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update group settings' });
    }

    const { name, contributionAmount, maxMembers, acceptingRequests } = req.body;
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

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(groupId);
    const query = `UPDATE groups SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

    const result = await pool.query(query, values);

    res.json({ group: result.rows[0] });
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
      'SELECT id, name, contribution_amount, currency FROM groups WHERE id = $1',
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
          days_overdue: isOverdue ? daysUntilOrSince : null
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
      compliance: complianceData
    });
  } catch (error) {
    console.error('Get group compliance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
