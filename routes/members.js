const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');

const router = express.Router();

// Get group members
router.get('/group/:groupId', authenticate, async (req, res) => {
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

    const userStatus = memberCheck.rows[0].status;
    const isAdmin = memberCheck.rows[0].role === 'admin';

    // If user is pending and not admin, only return their own info
    if (userStatus === 'pending' && !isAdmin) {
      const result = await pool.query(
        `SELECT 
          gm.id as member_id,
          u.id as user_id, u.name, u.email, u.phone, u.birthday,
          gm.role, gm.status, gm.joined_at
         FROM group_members gm
         JOIN users u ON gm.user_id = u.id
         WHERE gm.group_id = $1 AND gm.user_id = $2`,
        [groupId, userId]
      );
      return res.json({ members: result.rows });
    }

    // Get all members (admins can see active and pending, regular members can only see active)
    // Never show inactive/rejected members
    const result = await pool.query(
      `SELECT 
        gm.id as member_id,
        u.id as user_id, u.name, u.email, u.phone, u.birthday,
        gm.role, gm.status, gm.joined_at
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
         AND gm.status != 'inactive'
         ${!isAdmin ? "AND gm.status = 'active'" : ''}
       ORDER BY 
         CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END,
         gm.joined_at ASC`,
      [groupId]
    );

    res.json({ members: result.rows });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Approve/Reject member (admin only)
router.post('/:memberId/approve', authenticate, async (req, res) => {
  try {
    const { memberId } = req.params;
    const { groupId, action } = req.body; // action: 'approve' or 'reject'
    const userId = req.user.id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use "approve" or "reject"' });
    }

    // Check if requester is admin
    const adminCheck = await pool.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = $3',
      [groupId, userId, 'admin']
    );

    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only admins can approve members' });
    }

    // Check if member exists and is pending
    const memberCheck = await pool.query(
      `SELECT gm.status, gm.user_id, u.name as user_name, g.name as group_name
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       JOIN groups g ON gm.group_id = g.id
       WHERE gm.id = $1 AND gm.group_id = $2`,
      [memberId, groupId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (memberCheck.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Member is not pending approval' });
    }

    const memberUserId = memberCheck.rows[0].user_id;
    const memberName = memberCheck.rows[0].user_name;
    const groupName = memberCheck.rows[0].group_name;

    // Update status
    const newStatus = action === 'approve' ? 'active' : 'inactive';
    await pool.query(
      'UPDATE group_members SET status = $1 WHERE id = $2',
      [newStatus, memberId]
    );

    // Notify the member about approval/rejection
    if (action === 'approve') {
      await createNotification(
        memberUserId,
        'group_approved',
        'Join Request Approved',
        `Your request to join ${groupName} has been approved!`,
        groupId
      );
    } else {
      await createNotification(
        memberUserId,
        'group_rejected',
        'Join Request Declined',
        `Your request to join ${groupName} has been declined.`,
        groupId
      );
    }

    res.json({ message: `Member ${action}d successfully` });
  } catch (error) {
    console.error('Approve member error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove member (admin only)
router.delete('/:memberId', authenticate, async (req, res) => {
  try {
    const { memberId } = req.params;
    const { groupId } = req.body;
    const userId = req.user.id;

    // Check if requester is admin
    const adminCheck = await pool.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = $3',
      [groupId, userId, 'admin']
    );

    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only admins can remove members' });
    }

    // Don't allow removing admin
    const memberCheck = await pool.query(
      'SELECT role FROM group_members WHERE id = $1 AND group_id = $2',
      [memberId, groupId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (memberCheck.rows[0].role === 'admin') {
      return res.status(400).json({ error: 'Cannot remove admin member' });
    }

    await pool.query('DELETE FROM group_members WHERE id = $1', [memberId]);

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Leave group
router.post('/leave', authenticate, async (req, res) => {
  try {
    const { groupId } = req.body;
    const userId = req.user.id;

    // Check if user is member
    const memberCheck = await pool.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'You are not a member of this group' });
    }

    // Don't allow admin to leave (or handle differently)
    if (memberCheck.rows[0].role === 'admin') {
      // Check if there are other admins
      const adminCount = await pool.query(
        'SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = $2 AND status = $3',
        [groupId, 'admin', 'active']
      );

      if (parseInt(adminCount.rows[0].count) === 1) {
        return res.status(400).json({ error: 'Cannot leave group. You are the only admin. Transfer admin role first.' });
      }
    }

    await pool.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    res.json({ message: 'Left group successfully' });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
