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

// Get member summary/reliability score (for viewing before accepting join requests)
// NOTE: This route must come before /:memberId routes to avoid conflicts
router.get('/summary/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // Get user basic info
    const userResult = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const today = new Date();
    const currentYear = today.getFullYear();

    // Get all groups the user is/was a member of (active or past)
    const groupsResult = await pool.query(
      `SELECT g.id, g.name, gm.joined_at, gm.status
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       WHERE gm.user_id = $1 AND gm.status IN ('active', 'inactive')
       ORDER BY gm.joined_at DESC`,
      [userId]
    );

    let totalContributions = 0;
    let totalOverdue = 0;
    let totalOnTime = 0;
    let totalGroups = groupsResult.rows.length;

    // Calculate metrics for each group
    for (const group of groupsResult.rows) {
      const userJoinDate = new Date(group.joined_at);

      // Get all members in this group with birthdays
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
        
        // Only count if user was a member when birthday occurred
        if (userJoinDate <= thisYearBirthday) {
          // Count today and past birthdays as expected
          // Today's birthday: count as expected but not overdue if not paid
          // Past birthday: count as expected and overdue if not paid
          const isToday = thisYearBirthday.toDateString() === today.toDateString();
          const isPast = thisYearBirthday < today;
          const isPastOrToday = isPast || isToday;
          
          if (isPastOrToday) {
            // Birthday has passed or is today, check contribution status
            // Don't filter by year - just get the most recent contribution for this birthday
            const contributionCheck = await pool.query(
              `SELECT status, contribution_date FROM birthday_contributions 
               WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
               ORDER BY contribution_date DESC
               LIMIT 1`,
              [group.id, member.id, userId]
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
              totalContributions++; // Only count non-confirmed as "expected"
            }

            // On-time = confirmed AND paid on or before birthday
            if (paidOnTime) {
              totalOnTime++;
            } else if (status === 'not_paid' || status === 'not_received') {
              // Not paid or rejected - overdue if birthday has passed
              if (isPast) {
                totalOverdue++;
              }
              // If it's today and not paid/not_received, it's expected but not overdue yet
            } else if (status === 'paid') {
              // Paid but awaiting confirmation - overdue if birthday has passed
              if (isPast) {
                totalOverdue++;
              }
              // If it's today and paid, it's expected but not overdue yet
            } else if (status === 'confirmed' && !paidOnTime) {
              // Confirmed but paid AFTER birthday - this is overdue (late payment)
              totalOverdue++;
            } else if (!contributionCheck.rows.length) {
              // No contribution record = not_paid
              // Only count as overdue if birthday has passed (not today)
              if (isPast) {
                totalOverdue++;
              }
              // If it's today and no record, it's expected but not overdue yet
            }
          }
        }
      }
    }

    // Calculate reliability score (0-100)
    // Formula: (on-time payments / total contributions) * 100
    // If no contributions yet, give neutral score of 50
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
      summaryText = 'New member - No contribution history yet';
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

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        member_since: user.created_at
      },
      metrics: {
        total_groups: totalGroups,
        total_contributions: totalContributions,
        total_on_time: totalOnTime,
        total_overdue: totalOverdue,
        on_time_rate: Math.round(onTimeRate * 10) / 10, // Round to 1 decimal
        reliability_score: reliabilityScore
      },
      summary: {
        text: summaryText,
        rating: rating // 'new', 'excellent', 'good', 'moderate', 'poor'
      }
    });
  } catch (error) {
    console.error('Get member summary error:', error);
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

    // Get member info and group name before removing
    const memberCheck = await pool.query(
      `SELECT gm.role, gm.user_id, g.name as group_name
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       WHERE gm.id = $1 AND gm.group_id = $2`,
      [memberId, groupId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (memberCheck.rows[0].role === 'admin') {
      return res.status(400).json({ error: 'Cannot remove admin member' });
    }

    const removedUserId = memberCheck.rows[0].user_id;
    const groupName = memberCheck.rows[0].group_name;

    // Remove member
    await pool.query('DELETE FROM group_members WHERE id = $1', [memberId]);

    // Notify the removed member
    await createNotification(
      removedUserId,
      'group_removed',
      'Removed from Group',
      `You've been removed from ${groupName}`,
      groupId
    );

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
