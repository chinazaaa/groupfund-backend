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
       RETURNING id, name, invite_code, contribution_amount, max_members, admin_id, currency, created_at`,
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
        g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.created_at,
        COUNT(gm.id) FILTER (WHERE gm.status = 'active') as current_members,
        u.name as admin_name
       FROM groups g
       LEFT JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN users u ON g.admin_id = u.id
       WHERE g.invite_code = $1
       GROUP BY g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.created_at, u.name`,
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

    if (memberCheck.rows.length > 0) {
      const memberStatus = memberCheck.rows[0].status;
      const memberId = memberCheck.rows[0].id;
      
      if (memberStatus === 'pending') {
        return res.status(400).json({ error: 'Your join request is still pending admin approval' });
      } else if (memberStatus === 'active') {
        return res.status(400).json({ error: 'You are already a member of this group' });
      } else if (memberStatus === 'inactive') {
        // User was previously rejected, allow them to rejoin by updating status to pending
        const isAdmin = group.admin_id === userId;
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
    const isAdmin = group.admin_id === userId;
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
        g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.created_at,
        gm.role, gm.status as member_status,
        COUNT(DISTINCT gm2.id) FILTER (WHERE gm2.status = 'active') as active_members,
        u.name as admin_name
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       LEFT JOIN group_members gm2 ON g.id = gm2.group_id
       LEFT JOIN users u ON g.admin_id = u.id
       WHERE gm.user_id = $1
         AND gm.status != 'inactive'
       GROUP BY g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.created_at, gm.role, gm.status, u.name
       ORDER BY g.created_at DESC`,
      [userId]
    );

    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Get groups error:', error);
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

    const { name, contributionAmount, maxMembers } = req.body;
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

module.exports = router;
