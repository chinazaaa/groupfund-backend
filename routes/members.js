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
    today.setHours(0, 0, 0, 0); // Normalize to start of day
    const currentYear = today.getFullYear();

    // Get all groups the user is/was a member of (active or past)
    const groupsResult = await pool.query(
      `SELECT g.id, g.name, g.group_type, g.subscription_frequency, g.subscription_deadline_day, g.subscription_deadline_month, g.deadline, gm.joined_at, gm.status
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       WHERE gm.user_id = $1 AND gm.status IN ('active', 'inactive')
       ORDER BY gm.joined_at DESC`,
      [userId]
    );

    let totalContributions = 0; // Total contributions expected (all past/today birthdays)
    let totalOverdue = 0;
    let totalOnTime = 0;
    let totalGroups = groupsResult.rows.length;

    // Calculate metrics for each group
    for (const group of groupsResult.rows) {
      const userJoinDate = new Date(group.joined_at);
      userJoinDate.setHours(0, 0, 0, 0); // Normalize to start of day

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
        thisYearBirthday.setHours(0, 0, 0, 0); // Normalize to start of day
        
        // Only count if user was a member when birthday occurred
        if (userJoinDate <= thisYearBirthday) {
          const isPast = thisYearBirthday < today;
          const isToday = thisYearBirthday.getTime() === today.getTime();
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

            // Count all birthdays that have passed (or are today) as expected contributions
            // This ensures we have a proper denominator for reliability calculation
            if (isPastOrToday) {
              totalContributions++;
            }

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

    // Calculate metrics for subscription groups
    for (const group of groupsResult.rows.filter(g => g.group_type === 'subscription')) {
      const userJoinDate = new Date(group.joined_at);
      userJoinDate.setHours(0, 0, 0, 0);
      
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
        deadlineDate = new Date(currentYear, currentMonth - 1, group.subscription_deadline_day || 1);
      } else {
        deadlineDate = new Date(currentYear, (group.subscription_deadline_month || 1) - 1, group.subscription_deadline_day || 1);
      }
      deadlineDate.setHours(0, 0, 0, 0);
      const isDeadlinePassed = deadlineDate < today;

      // Only count if user was a member when deadline occurred
      if (userJoinDate <= deadlineDate && isDeadlinePassed) {
        const contributionCheck = await pool.query(
          `SELECT status, contribution_date 
           FROM subscription_contributions 
           WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3
           ORDER BY contribution_date DESC
           LIMIT 1`,
          [group.id, userId, periodStart]
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

    // Calculate metrics for general groups
    for (const group of groupsResult.rows.filter(g => g.group_type === 'general')) {
      if (!group.deadline) {
        continue; // Skip groups without deadlines
      }

      const userJoinDate = new Date(group.joined_at);
      userJoinDate.setHours(0, 0, 0, 0);
      
      const deadlineDate = new Date(group.deadline);
      deadlineDate.setHours(0, 0, 0, 0);
      const isDeadlinePassed = deadlineDate < today;

      // Only count if user was a member when deadline occurred
      if (userJoinDate <= deadlineDate && isDeadlinePassed) {
        const contributionCheck = await pool.query(
          `SELECT status, contribution_date 
           FROM general_contributions 
           WHERE group_id = $1 AND contributor_id = $2
           ORDER BY contribution_date DESC
           LIMIT 1`,
          [group.id, userId]
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

    // Get reports count for this user
    const reportsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_reports,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_reports,
        COUNT(*) FILTER (WHERE status IN ('pending', 'resolved')) as total_valid_reports
       FROM reports 
       WHERE reported_user_id = $1`,
      [userId]
    );

    const pendingReports = parseInt(reportsResult.rows[0]?.pending_reports || 0);
    const resolvedReports = parseInt(reportsResult.rows[0]?.resolved_reports || 0);
    const totalValidReports = parseInt(reportsResult.rows[0]?.total_valid_reports || 0);

    // Reliability starts at 100% and only reduces for overdue contributions and reports
    let reliabilityScore = 100; // Start at 100% (excellent)
    let onTimeRate = 100;

    // totalContributions now represents all birthdays that have passed (or are today)
    // totalOverdue represents contributions that are overdue (which are a subset of totalContributions)
    // So we should use totalContributions as the denominator, not totalContributions + totalOverdue
    const totalExpected = totalContributions;

    // Only reduce reliability if there are overdue contributions
    // If no overdue contributions, reliability stays at 100%
    if (totalOverdue > 0 && totalExpected > 0) {
      // Calculate on-time rate based on on-time vs total expected contributions
      // This reduces from 100% based on how many are overdue
      onTimeRate = (totalOnTime / totalExpected) * 100;
      reliabilityScore = Math.round(onTimeRate);
    } else if (totalOverdue === 0 && totalExpected > 0) {
      // If no overdue contributions, keep at 100%
      onTimeRate = 100;
      reliabilityScore = 100;
    }

    // Reduce reliability based on reports
    // Pending reports (not yet reviewed) are more urgent: -5 points each
    // Resolved reports (valid concerns) still matter but less urgent: -3 points each
    // Dismissed reports don't affect reliability (they were false/invalid)
    const reportPenalty = (pendingReports * 5) + (resolvedReports * 3);
    reliabilityScore = Math.max(0, reliabilityScore - reportPenalty);
    
    // Update on_time_rate to reflect report penalty (but don't go below 0)
    onTimeRate = Math.max(0, onTimeRate - reportPenalty);

    // Generate summary text
    let summaryText = '';
    let rating = 'excellent';

    if (totalContributions === 0 && totalOverdue === 0 && totalValidReports === 0) {
      summaryText = 'New member - No contribution history yet';
      rating = 'new';
    } else if (totalOverdue === 0 && totalValidReports === 0) {
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
    if (totalValidReports > 0) {
      summaryText += ` (${totalValidReports} report${totalValidReports > 1 ? 's' : ''})`;
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
        total_contributions: totalContributions, // All contributions (past/today birthdays)
        total_on_time: totalOnTime, // Confirmed and paid on/before birthday
        total_overdue: totalOverdue, // Overdue contributions
        on_time_rate: Math.round(onTimeRate * 10) / 10, // Round to 1 decimal
        reliability_score: reliabilityScore,
        pending_reports: pendingReports,
        resolved_reports: resolvedReports,
        total_valid_reports: totalValidReports,
        report_penalty: reportPenalty
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

    // Get member info and group details before removing
    const memberCheck = await pool.query(
      `SELECT gm.role, gm.user_id, g.name as group_name, g.group_type, g.subscription_platform, g.admin_id, u.name as user_name
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       JOIN users u ON gm.user_id = u.id
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
    const groupType = memberCheck.rows[0].group_type;
    const subscriptionPlatform = memberCheck.rows[0].subscription_platform;
    const adminId = memberCheck.rows[0].admin_id;
    const userName = memberCheck.rows[0].user_name;

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

    // Notify admin if member was removed from a subscription group
    if (groupType === 'subscription' && adminId) {
      const platformName = subscriptionPlatform || 'the subscription';
      
      // Send in-app and push notification
      await createNotification(
        adminId,
        'member_removed_subscription',
        'Member Removed from Subscription Group',
        `${userName} has been removed from ${groupName} (${platformName}). You may want to change the subscription password or update access credentials.`,
        groupId,
        removedUserId
      );

      // Send email notification
      try {
        const adminResult = await pool.query(
          'SELECT email, name FROM users WHERE id = $1',
          [adminId]
        );
        
        if (adminResult.rows.length > 0 && adminResult.rows[0].email) {
          const { sendMemberLeftSubscriptionEmail } = require('../utils/email');
          await sendMemberLeftSubscriptionEmail(
            adminResult.rows[0].email,
            adminResult.rows[0].name,
            userName,
            groupName,
            subscriptionPlatform,
            true // isRemoved = true (admin removed the member)
          );
        }
      } catch (err) {
        console.error(`Error sending member removed subscription email to admin ${adminId}:`, err);
        // Don't fail the request if email fails
      }
    }

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

    // Check if user is member and get group info
    const memberCheck = await pool.query(
      `SELECT gm.role, g.group_type, g.admin_id, g.name as group_name, g.subscription_platform, u.name as user_name
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.user_id = $2`,
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'You are not a member of this group' });
    }

    const memberInfo = memberCheck.rows[0];
    const groupType = memberInfo.group_type;
    const adminId = memberInfo.admin_id;
    const groupName = memberInfo.group_name;
    const subscriptionPlatform = memberInfo.subscription_platform;
    const userName = memberInfo.user_name;

    // Don't allow admin to leave (or handle differently)
    if (memberInfo.role === 'admin') {
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

    // Notify admin if member left a subscription group
    if (groupType === 'subscription' && adminId && adminId !== userId) {
      const platformName = subscriptionPlatform || 'the subscription';
      
      // Send in-app and push notification
      await createNotification(
        adminId,
        'member_left_subscription',
        'Member Left Subscription Group',
        `${userName} has left ${groupName} (${platformName}). You may want to change the subscription password or update access credentials.`,
        groupId,
        userId
      );

      // Send email notification
      try {
        const adminResult = await pool.query(
          'SELECT email, name FROM users WHERE id = $1',
          [adminId]
        );
        
        if (adminResult.rows.length > 0 && adminResult.rows[0].email) {
          const { sendMemberLeftSubscriptionEmail } = require('../utils/email');
          await sendMemberLeftSubscriptionEmail(
            adminResult.rows[0].email,
            adminResult.rows[0].name,
            userName,
            groupName,
            subscriptionPlatform,
            false // isRemoved = false (member left voluntarily)
          );
        }
      } catch (err) {
        console.error(`Error sending member left subscription email to admin ${adminId}:`, err);
        // Don't fail the request if email fails
      }
    }

    res.json({ message: 'Left group successfully' });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
