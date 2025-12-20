const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Helper function to update group health based on reports
async function updateGroupHealthFromReports(groupId) {
  try {
    // Get count of pending and reviewed reports for this group
    const reportsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'reviewed') as reviewed_count,
        COUNT(*) as total_count
       FROM reports 
       WHERE reported_group_id = $1`,
      [groupId]
    );

    const pendingCount = parseInt(reportsResult.rows[0]?.pending_count || 0);
    const reviewedCount = parseInt(reportsResult.rows[0]?.reviewed_count || 0);
    const totalCount = parseInt(reportsResult.rows[0]?.total_count || 0);

    // If group has 3+ pending reports, automatically close it
    if (pendingCount >= 3) {
      await pool.query(
        'UPDATE groups SET status = $1 WHERE id = $2 AND status != $1',
        ['closed', groupId]
      );
    }

    return {
      pending_reports: pendingCount,
      reviewed_reports: reviewedCount,
      total_reports: totalCount
    };
  } catch (error) {
    console.error('Error updating group health from reports:', error);
    return null;
  }
}

// Helper function to update user status based on reports
async function updateUserStatusFromReports(userId) {
  try {
    // Get count of reports for this user
    const reportsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'reviewed') as reviewed_count,
        COUNT(*) as total_count
       FROM reports 
       WHERE reported_user_id = $1`,
      [userId]
    );

    const pendingCount = parseInt(reportsResult.rows[0]?.pending_count || 0);
    const reviewedCount = parseInt(reportsResult.rows[0]?.reviewed_count || 0);
    const totalCount = parseInt(reportsResult.rows[0]?.total_count || 0);

    // If user has 3+ pending reports or 5+ reviewed reports, mark as inactive
    if (pendingCount >= 3 || totalCount >= 5) {
      await pool.query(
        'UPDATE users SET is_active = false WHERE id = $1',
        [userId]
      );
    }

    return {
      pending_reports: pendingCount,
      reviewed_reports: reviewedCount,
      total_reports: totalCount
    };
  } catch (error) {
    console.error('Error updating user status from reports:', error);
    return null;
  }
}

// Report a group (member endpoint - requires authentication and membership)
router.post('/group/:groupId', authenticate, [
  body('reason').isIn(['spam', 'inappropriate', 'fraud', 'harassment', 'other']).withMessage('Invalid reason'),
  body('description').optional().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { groupId } = req.params;
    const { reason, description } = req.body;
    const reporterId = req.user.id;

    // Check if user is a member of the group
    const memberCheck = await pool.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, reporterId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group to report it' });
    }

    // Check if group exists
    const groupCheck = await pool.query(
      'SELECT id, name FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if user already reported this group (prevent spam)
    const existingReport = await pool.query(
      'SELECT id FROM reports WHERE reporter_id = $1 AND reported_group_id = $2 AND status = $3',
      [reporterId, groupId, 'pending']
    );

    if (existingReport.rows.length > 0) {
      return res.status(400).json({ error: 'You have already submitted a pending report for this group' });
    }

    // Create report
    const reportResult = await pool.query(
      `INSERT INTO reports (reporter_id, reported_group_id, report_type, reason, description)
       VALUES ($1, $2, 'group', $3, $4)
       RETURNING id, created_at`,
      [reporterId, groupId, reason, description || null]
    );

    // Update group health based on reports
    await updateGroupHealthFromReports(groupId);

    res.status(201).json({
      message: 'Report submitted successfully',
      report: {
        id: reportResult.rows[0].id,
        created_at: reportResult.rows[0].created_at
      }
    });
  } catch (error) {
    console.error('Report group error:', error);
    res.status(500).json({ error: 'Server error submitting report' });
  }
});

// Report a group (public endpoint - no authentication required, for website)
router.post('/group/:groupId/public', [
  body('reason').isIn(['spam', 'inappropriate', 'fraud', 'harassment', 'other']).withMessage('Invalid reason'),
  body('description').optional().trim(),
  body('email').optional().isEmail().withMessage('Invalid email format'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { groupId } = req.params;
    const { reason, description, email } = req.body;

    // Check if group exists
    const groupCheck = await pool.query(
      'SELECT id, name FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Try to find reporter by email if provided
    let reporterId = null;
    if (email) {
      const userResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      if (userResult.rows.length > 0) {
        reporterId = userResult.rows[0].id;
      }
    }

    // Check if this email/user already reported this group recently (prevent spam)
    if (reporterId) {
      const existingReport = await pool.query(
        'SELECT id FROM reports WHERE reporter_id = $1 AND reported_group_id = $2 AND status = $3 AND created_at > NOW() - INTERVAL \'24 hours\'',
        [reporterId, groupId, 'pending']
      );

      if (existingReport.rows.length > 0) {
        return res.status(400).json({ error: 'You have already submitted a report for this group recently' });
      }
    } else if (email) {
      // Check by email for anonymous reports
      const existingReport = await pool.query(
        `SELECT id FROM reports r
         LEFT JOIN users u ON r.reporter_id = u.id
         WHERE u.email = $1 AND r.reported_group_id = $2 AND r.status = $3 AND r.created_at > NOW() - INTERVAL '24 hours'`,
        [email, groupId, 'pending']
      );

      if (existingReport.rows.length > 0) {
        return res.status(400).json({ error: 'A report for this group has already been submitted recently' });
      }
    }

    // Create report (reporter_id can be null for anonymous reports)
    const reportResult = await pool.query(
      `INSERT INTO reports (reporter_id, reported_group_id, report_type, reason, description)
       VALUES ($1, $2, 'group', $3, $4)
       RETURNING id, created_at, status`,
      [reporterId, groupId, reason, description || null]
    );

    console.log('Public group report created:', {
      reportId: reportResult.rows[0].id,
      groupId,
      reporterId: reporterId || 'anonymous',
      reason,
      status: reportResult.rows[0].status
    });

    // Update group health based on reports
    await updateGroupHealthFromReports(groupId);

    res.status(201).json({
      message: 'Report submitted successfully',
      report: {
        id: reportResult.rows[0].id,
        created_at: reportResult.rows[0].created_at,
        status: reportResult.rows[0].status
      }
    });
  } catch (error) {
    console.error('Public report group error:', error);
    res.status(500).json({ error: 'Server error submitting report', details: error.message });
  }
});

// Report a member (member endpoint - requires authentication and membership)
router.post('/member/:memberId', authenticate, [
  body('groupId').notEmpty().withMessage('Group ID is required'),
  body('reason').isIn(['spam', 'inappropriate', 'fraud', 'harassment', 'other']).withMessage('Invalid reason'),
  body('description').optional().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { memberId } = req.params;
    const { groupId, reason, description } = req.body;
    const reporterId = req.user.id;

    // Check if user is a member of the group
    const memberCheck = await pool.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [groupId, reporterId, 'active']
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be an active member of this group to report a member' });
    }

    // Check if reported member exists in the group
    const reportedMemberCheck = await pool.query(
      `SELECT gm.user_id, u.name
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.id = $1 AND gm.group_id = $2`,
      [memberId, groupId]
    );

    if (reportedMemberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found in this group' });
    }

    const reportedUserId = reportedMemberCheck.rows[0].user_id;

    // Can't report yourself
    if (reportedUserId === reporterId) {
      return res.status(400).json({ error: 'You cannot report yourself' });
    }

    // Check if user already reported this member in this group (prevent spam)
    const existingReport = await pool.query(
      `SELECT id FROM reports 
       WHERE reporter_id = $1 AND reported_user_id = $2 AND reported_group_id = $3 AND status = $4`,
      [reporterId, reportedUserId, groupId, 'pending']
    );

    if (existingReport.rows.length > 0) {
      return res.status(400).json({ error: 'You have already submitted a pending report for this member' });
    }

    // Create report
    const reportResult = await pool.query(
      `INSERT INTO reports (reporter_id, reported_user_id, reported_group_id, report_type, reason, description)
       VALUES ($1, $2, $3, 'member', $4, $5)
       RETURNING id, created_at`,
      [reporterId, reportedUserId, groupId, reason, description || null]
    );

    // Update user status based on reports
    await updateUserStatusFromReports(reportedUserId);

    // Check if reported user is an admin - if so, also update group health
    const adminCheck = await pool.query(
      'SELECT admin_id FROM groups WHERE id = $1 AND admin_id = $2',
      [groupId, reportedUserId]
    );

    if (adminCheck.rows.length > 0) {
      await updateGroupHealthFromReports(groupId);
    }

    res.status(201).json({
      message: 'Report submitted successfully',
      report: {
        id: reportResult.rows[0].id,
        created_at: reportResult.rows[0].created_at
      }
    });
  } catch (error) {
    console.error('Report member error:', error);
    res.status(500).json({ error: 'Server error submitting report' });
  }
});

// Report a member (public endpoint - no authentication required, for website)
router.post('/member/:userId/public', [
  body('groupId').notEmpty().withMessage('Group ID is required'),
  body('reason').isIn(['spam', 'inappropriate', 'fraud', 'harassment', 'other']).withMessage('Invalid reason'),
  body('description').optional().trim(),
  body('email').optional().isEmail().withMessage('Invalid email format'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.params;
    const { groupId, reason, description, email } = req.body;

    // Check if user exists
    const userCheck = await pool.query(
      'SELECT id, name FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if group exists
    const groupCheck = await pool.query(
      'SELECT id, name FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Try to find reporter by email if provided
    let reporterId = null;
    if (email) {
      const reporterResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      if (reporterResult.rows.length > 0) {
        reporterId = reporterResult.rows[0].id;
      }
    }

    // Check if this email/user already reported this member recently (prevent spam)
    if (reporterId) {
      const existingReport = await pool.query(
        `SELECT id FROM reports 
         WHERE reporter_id = $1 AND reported_user_id = $2 AND reported_group_id = $3 AND status = $4 AND created_at > NOW() - INTERVAL '24 hours'`,
        [reporterId, userId, groupId, 'pending']
      );

      if (existingReport.rows.length > 0) {
        return res.status(400).json({ error: 'You have already submitted a report for this member recently' });
      }
    } else if (email) {
      // Check by email for anonymous reports
      const existingReport = await pool.query(
        `SELECT id FROM reports r
         LEFT JOIN users u ON r.reporter_id = u.id
         WHERE u.email = $1 AND r.reported_user_id = $2 AND r.reported_group_id = $3 AND r.status = $4 AND r.created_at > NOW() - INTERVAL '24 hours'`,
        [email, userId, groupId, 'pending']
      );

      if (existingReport.rows.length > 0) {
        return res.status(400).json({ error: 'A report for this member has already been submitted recently' });
      }
    }

    // Create report (reporter_id can be null for anonymous reports)
    const reportResult = await pool.query(
      `INSERT INTO reports (reporter_id, reported_user_id, reported_group_id, report_type, reason, description)
       VALUES ($1, $2, $3, 'member', $4, $5)
       RETURNING id, created_at, status`,
      [reporterId, userId, groupId, reason, description || null]
    );

    console.log('Public member report created:', {
      reportId: reportResult.rows[0].id,
      userId,
      groupId,
      reporterId: reporterId || 'anonymous',
      reason,
      status: reportResult.rows[0].status
    });

    // Update user status based on reports
    await updateUserStatusFromReports(userId);

    // Check if reported user is an admin - if so, also update group health
    const adminCheck = await pool.query(
      'SELECT admin_id FROM groups WHERE id = $1 AND admin_id = $2',
      [groupId, userId]
    );

    if (adminCheck.rows.length > 0) {
      await updateGroupHealthFromReports(groupId);
    }

    res.status(201).json({
      message: 'Report submitted successfully',
      report: {
        id: reportResult.rows[0].id,
        created_at: reportResult.rows[0].created_at,
        status: reportResult.rows[0].status
      }
    });
  } catch (error) {
    console.error('Public report member error:', error);
    res.status(500).json({ error: 'Server error submitting report', details: error.message });
  }
});

module.exports = router;

// Export helper functions for use in admin routes
module.exports.updateGroupHealthFromReports = updateGroupHealthFromReports;
module.exports.updateUserStatusFromReports = updateUserStatusFromReports;

