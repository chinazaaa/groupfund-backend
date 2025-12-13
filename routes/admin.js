const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { requireAdmin } = require('../middleware/admin');

const router = express.Router();

// All routes require admin authentication
router.use(requireAdmin);

// Get all users
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 50, search, is_verified, is_admin, is_active } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        u.id, u.name, u.email, u.phone, u.birthday, 
        u.is_verified, u.is_admin, u.is_active, u.created_at, u.updated_at,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.user_id = u.id) as group_count
      FROM users u
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (search) {
      query += ` AND (u.name ILIKE $${paramCount} OR u.email ILIKE $${paramCount} OR u.phone ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (is_verified !== undefined) {
      query += ` AND u.is_verified = $${paramCount}`;
      params.push(is_verified === 'true');
      paramCount++;
    }

    if (is_admin !== undefined) {
      query += ` AND u.is_admin = $${paramCount}`;
      params.push(is_admin === 'true');
      paramCount++;
    }

    if (is_active !== undefined) {
      query += ` AND u.is_active = $${paramCount}`;
      params.push(is_active === 'true');
      paramCount++;
    }

    // Get total count - build a proper count query
    let countQuery = `
      SELECT COUNT(*) as total
      FROM users u
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 1;

    if (search) {
      countQuery += ` AND (u.name ILIKE $${countParamCount} OR u.email ILIKE $${countParamCount} OR u.phone ILIKE $${countParamCount})`;
      countParams.push(`%${search}%`);
      countParamCount++;
    }

    if (is_verified !== undefined) {
      countQuery += ` AND u.is_verified = $${countParamCount}`;
      countParams.push(is_verified === 'true');
      countParamCount++;
    }

    if (is_admin !== undefined) {
      countQuery += ` AND u.is_admin = $${countParamCount}`;
      countParams.push(is_admin === 'true');
      countParamCount++;
    }

    if (is_active !== undefined) {
      countQuery += ` AND u.is_active = $${countParamCount}`;
      countParams.push(is_active === 'true');
      countParamCount++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY u.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      users: result.rows.map(user => ({
        ...user,
        is_active: user.is_active !== undefined ? user.is_active : true,
        group_count: parseInt(user.group_count || 0),
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ error: 'Server error fetching users' });
  }
});

// Get user by ID
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const userResult = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.phone, u.birthday, 
        u.is_verified, u.is_admin, u.is_active, u.created_at, u.updated_at,
        u.notify_7_days_before, u.notify_1_day_before, u.notify_same_day
      FROM users u
      WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's groups
    const groupsResult = await pool.query(
      `SELECT 
        g.id, g.name, g.invite_code, g.contribution_amount, g.currency,
        gm.role, gm.status, gm.joined_at
      FROM group_members gm
      JOIN groups g ON gm.group_id = g.id
      WHERE gm.user_id = $1
      ORDER BY gm.joined_at DESC`,
      [userId]
    );

    // Get user's transaction count
    const transactionCount = await pool.query(
      'SELECT COUNT(*) as count FROM transactions WHERE user_id = $1',
      [userId]
    );

    res.json({
      user: {
        ...userResult.rows[0],
        is_active: userResult.rows[0].is_active !== undefined ? userResult.rows[0].is_active : true,
      },
      groups: groupsResult.rows,
      transaction_count: parseInt(transactionCount.rows[0].count || 0),
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ error: 'Server error fetching user' });
  }
});

// Update user (verify, activate/deactivate, make admin)
router.put('/users/:userId', [
  body('is_verified').optional().isBoolean(),
  body('is_admin').optional().isBoolean(),
  body('is_active').optional().isBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.params;
    const { is_verified, is_admin, is_active } = req.body;

    // Prevent admin from removing their own admin status
    if (is_admin === false && req.user.id === userId) {
      return res.status(400).json({ error: 'Cannot remove your own admin status' });
    }

    // Prevent admin from deactivating themselves
    if (is_active === false && req.user.id === userId) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (is_verified !== undefined) {
      updates.push(`is_verified = $${paramCount++}`);
      values.push(is_verified);
    }

    if (is_admin !== undefined) {
      updates.push(`is_admin = $${paramCount++}`);
      values.push(is_admin);
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, name, email, is_verified, is_admin, is_active`;
    const result = await pool.query(query, values);

    res.json({
      message: 'User updated successfully',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Server error updating user' });
  }
});

// Get all groups
router.get('/groups', async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, 
        g.currency, g.created_at, g.updated_at,
        u.name as admin_name, u.email as admin_email,
        COUNT(gm.id) FILTER (WHERE gm.status = 'active') as active_members,
        COUNT(gm.id) FILTER (WHERE gm.status = 'pending') as pending_members
      FROM groups g
      LEFT JOIN users u ON g.admin_id = u.id
      LEFT JOIN group_members gm ON g.id = gm.group_id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (search) {
      query += ` AND (g.name ILIKE $${paramCount} OR g.invite_code ILIKE $${paramCount} OR u.name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Get total count - build a proper count query
    let countQuery = `
      SELECT COUNT(DISTINCT g.id) as total
      FROM groups g
      LEFT JOIN users u ON g.admin_id = u.id
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 1;

    if (search) {
      countQuery += ` AND (g.name ILIKE $${countParamCount} OR g.invite_code ILIKE $${countParamCount} OR u.name ILIKE $${countParamCount})`;
      countParams.push(`%${search}%`);
      countParamCount++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    query += ` GROUP BY g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.created_at, g.updated_at, u.name, u.email
               ORDER BY g.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      groups: result.rows.map(group => ({
        ...group,
        contribution_amount: parseFloat(group.contribution_amount),
        max_members: parseInt(group.max_members),
        active_members: parseInt(group.active_members || 0),
        pending_members: parseInt(group.pending_members || 0),
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all groups error:', error);
    res.status(500).json({ error: 'Server error fetching groups' });
  }
});

// Get group members (admin only)
router.get('/groups/:groupId/members', async (req, res) => {
  try {
    const { groupId } = req.params;

    const result = await pool.query(
      `SELECT 
        gm.id as member_id,
        u.id as user_id, u.name, u.email, u.phone, u.birthday, u.is_verified, u.is_active,
        gm.role, gm.status, gm.joined_at
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY 
         CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END,
         gm.joined_at ASC`,
      [groupId]
    );

    res.json({ members: result.rows });
  } catch (error) {
    console.error('Get group members error:', error);
    res.status(500).json({ error: 'Server error fetching group members' });
  }
});

// Get all transactions
router.get('/transactions', async (req, res) => {
  try {
    const { page = 1, limit = 50, type, status, userId, groupId } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        t.id, t.type, t.amount, t.description, t.status, t.reference, t.created_at,
        u.id as user_id, u.name as user_name, u.email as user_email,
        g.id as group_id, g.name as group_name
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN groups g ON t.group_id = g.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (type) {
      query += ` AND t.type = $${paramCount++}`;
      params.push(type);
    }

    if (status) {
      query += ` AND t.status = $${paramCount++}`;
      params.push(status);
    }

    if (userId) {
      query += ` AND t.user_id = $${paramCount++}`;
      params.push(userId);
    }

    if (groupId) {
      query += ` AND t.group_id = $${paramCount++}`;
      params.push(groupId);
    }

    // Get total count - build a proper count query
    let countQuery = `
      SELECT COUNT(*) as total
      FROM transactions t
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 1;

    if (type) {
      countQuery += ` AND t.type = $${countParamCount++}`;
      countParams.push(type);
    }

    if (status) {
      countQuery += ` AND t.status = $${countParamCount++}`;
      countParams.push(status);
    }

    if (userId) {
      countQuery += ` AND t.user_id = $${countParamCount++}`;
      countParams.push(userId);
    }

    if (groupId) {
      countQuery += ` AND t.group_id = $${countParamCount++}`;
      countParams.push(groupId);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY t.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      transactions: result.rows.map(transaction => ({
        ...transaction,
        amount: parseFloat(transaction.amount),
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all transactions error:', error);
    res.status(500).json({ error: 'Server error fetching transactions' });
  }
});

// Get all contributions
router.get('/contributions', async (req, res) => {
  try {
    const { page = 1, limit = 50, status, groupId, userId } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        bc.id, bc.amount, bc.contribution_date, bc.status, bc.note, bc.created_at,
        g.id as group_id, g.name as group_name, g.currency,
        u1.id as birthday_user_id, u1.name as birthday_user_name,
        u2.id as contributor_id, u2.name as contributor_name,
        t.type as transaction_type
      FROM birthday_contributions bc
      LEFT JOIN groups g ON bc.group_id = g.id
      LEFT JOIN users u1 ON bc.birthday_user_id = u1.id
      LEFT JOIN users u2 ON bc.contributor_id = u2.id
      LEFT JOIN transactions t ON bc.transaction_id = t.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (status) {
      query += ` AND bc.status = $${paramCount++}`;
      params.push(status);
    }

    if (groupId) {
      query += ` AND bc.group_id = $${paramCount++}`;
      params.push(groupId);
    }

    if (userId) {
      query += ` AND (bc.birthday_user_id = $${paramCount} OR bc.contributor_id = $${paramCount})`;
      params.push(userId);
      paramCount++;
    }

    // Get total count - build a proper count query
    let countQuery = `
      SELECT COUNT(*) as total
      FROM birthday_contributions bc
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 1;

    if (status) {
      countQuery += ` AND bc.status = $${countParamCount++}`;
      countParams.push(status);
    }

    if (groupId) {
      countQuery += ` AND bc.group_id = $${countParamCount++}`;
      countParams.push(groupId);
    }

    if (userId) {
      countQuery += ` AND (bc.birthday_user_id = $${countParamCount} OR bc.contributor_id = $${countParamCount})`;
      countParams.push(userId);
      countParamCount++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY bc.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      contributions: result.rows.map(contribution => ({
        ...contribution,
        amount: parseFloat(contribution.amount),
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all contributions error:', error);
    res.status(500).json({ error: 'Server error fetching contributions' });
  }
});

// Get system statistics
router.get('/stats', async (req, res) => {
  try {
    // Total users
    const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users');
    
    // Verified users
    const verifiedUsers = await pool.query('SELECT COUNT(*) as count FROM users WHERE is_verified = true');
    
    // Admin users
    const adminUsers = await pool.query('SELECT COUNT(*) as count FROM users WHERE is_admin = true');
    
    // Total groups
    const totalGroups = await pool.query('SELECT COUNT(*) as count FROM groups');
    
    // Active groups (groups with at least 2 active members)
    const activeGroups = await pool.query(`
      SELECT COUNT(DISTINCT g.id) as count
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.status = 'active'
      GROUP BY g.id
      HAVING COUNT(gm.id) >= 2
    `);
    
    // Total transactions
    const totalTransactions = await pool.query('SELECT COUNT(*) as count FROM transactions');
    
    // Total transaction amount
    const totalTransactionAmount = await pool.query(`
      SELECT 
        COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) as total_credits,
        COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0) as total_debits,
        COALESCE(SUM(amount) FILTER (WHERE type = 'contribution'), 0) as total_contributions,
        COALESCE(SUM(amount) FILTER (WHERE type = 'birthday_gift'), 0) as total_birthday_gifts
      FROM transactions
      WHERE status = 'completed'
    `);
    
    // Total wallet balance
    const totalWalletBalance = await pool.query('SELECT COALESCE(SUM(balance), 0) as total FROM wallets');
    
    // Total contributions
    const totalContributions = await pool.query('SELECT COUNT(*) as count FROM birthday_contributions');
    
    // Contribution status counts
    const contributionStatusCounts = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'not_paid') as not_paid,
        COUNT(*) FILTER (WHERE status = 'paid') as paid,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
        COUNT(*) FILTER (WHERE status = 'not_received') as not_received
      FROM birthday_contributions
    `);
    
    // Users registered in last 30 days
    const recentUsers = await pool.query(`
      SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '30 days'
    `);
    
    // Groups created in last 30 days
    const recentGroups = await pool.query(`
      SELECT COUNT(*) as count FROM groups WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    res.json({
      users: {
        total: parseInt(totalUsers.rows[0].count),
        verified: parseInt(verifiedUsers.rows[0].count),
        admins: parseInt(adminUsers.rows[0].count),
        recent_30_days: parseInt(recentUsers.rows[0].count),
      },
      groups: {
        total: parseInt(totalGroups.rows[0].count),
        active: parseInt(activeGroups.rows.length > 0 ? activeGroups.rows[0].count : 0),
        recent_30_days: parseInt(recentGroups.rows[0].count),
      },
      transactions: {
        total: parseInt(totalTransactions.rows[0].count),
        amounts: {
          total_credits: parseFloat(totalTransactionAmount.rows[0].total_credits || 0),
          total_debits: parseFloat(totalTransactionAmount.rows[0].total_debits || 0),
          total_contributions: parseFloat(totalTransactionAmount.rows[0].total_contributions || 0),
          total_birthday_gifts: parseFloat(totalTransactionAmount.rows[0].total_birthday_gifts || 0),
        },
      },
      contributions: {
        total: parseInt(totalContributions.rows[0].count),
        not_paid: parseInt(contributionStatusCounts.rows[0].not_paid || 0),
        paid: parseInt(contributionStatusCounts.rows[0].paid || 0),
        confirmed: parseInt(contributionStatusCounts.rows[0].confirmed || 0),
        not_received: parseInt(contributionStatusCounts.rows[0].not_received || 0),
      },
      wallets: {
        total_balance: parseFloat(totalWalletBalance.rows[0].total || 0),
      },
    });
  } catch (error) {
    console.error('Get system stats error:', error);
    res.status(500).json({ error: 'Server error fetching statistics' });
  }
});

// Get all notifications
router.get('/notifications', async (req, res) => {
  try {
    const { page = 1, limit = 50, type, is_read, userId } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        n.id, n.type, n.title, n.message, n.is_read, n.created_at,
        u.id as user_id, u.name as user_name, u.email as user_email,
        g.id as group_id, g.name as group_name,
        ru.id as related_user_id, ru.name as related_user_name
      FROM notifications n
      LEFT JOIN users u ON n.user_id = u.id
      LEFT JOIN groups g ON n.group_id = g.id
      LEFT JOIN users ru ON n.related_user_id = ru.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (type) {
      query += ` AND n.type = $${paramCount++}`;
      params.push(type);
    }

    if (is_read !== undefined) {
      query += ` AND n.is_read = $${paramCount++}`;
      params.push(is_read === 'true');
    }

    if (userId) {
      query += ` AND n.user_id = $${paramCount++}`;
      params.push(userId);
    }

    // Get total count - build a proper count query
    let countQuery = `
      SELECT COUNT(*) as total
      FROM notifications n
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 1;

    if (type) {
      countQuery += ` AND n.type = $${countParamCount++}`;
      countParams.push(type);
    }

    if (is_read !== undefined) {
      countQuery += ` AND n.is_read = $${countParamCount++}`;
      countParams.push(is_read === 'true');
    }

    if (userId) {
      countQuery += ` AND n.user_id = $${countParamCount++}`;
      countParams.push(userId);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY n.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      notifications: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all notifications error:', error);
    res.status(500).json({ error: 'Server error fetching notifications' });
  }
});

// Deactivate user (admin only) - changed from delete to deactivate
router.put('/users/:userId/deactivate', async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent admin from deactivating themselves
    if (req.user.id === userId) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    // Check if user exists and get their status
    const userCheck = await pool.query('SELECT id, is_active, is_admin FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deactivating admin users
    if (userCheck.rows[0].is_admin) {
      return res.status(400).json({ error: 'Cannot deactivate admin users' });
    }

    const isActive = userCheck.rows[0].is_active;
    
    // Toggle active status
    await pool.query('UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [!isActive, userId]);

    res.json({ 
      message: isActive ? 'User deactivated successfully' : 'User activated successfully',
      is_active: !isActive
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ error: 'Server error deactivating user' });
  }
});

// Get all contact submissions
router.get('/contact-submissions', async (req, res) => {
  try {
    const { page = 1, limit = 50, is_read } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        id, name, email, subject, message, is_read, created_at
      FROM contact_submissions
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (is_read !== undefined) {
      query += ` AND is_read = $${paramCount++}`;
      params.push(is_read === 'true');
    }

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM contact_submissions
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 1;

    if (is_read !== undefined) {
      countQuery += ` AND is_read = $${countParamCount++}`;
      countParams.push(is_read === 'true');
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      submissions: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get contact submissions error:', error);
    res.status(500).json({ error: 'Server error fetching contact submissions' });
  }
});

// Mark contact submission as read
router.put('/contact-submissions/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_read } = req.body;

    const result = await pool.query(
      'UPDATE contact_submissions SET is_read = $1 WHERE id = $2 RETURNING id, is_read',
      [is_read !== undefined ? is_read : true, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact submission not found' });
    }

    res.json({
      message: 'Contact submission updated successfully',
      submission: result.rows[0],
    });
  } catch (error) {
    console.error('Update contact submission error:', error);
    res.status(500).json({ error: 'Server error updating contact submission' });
  }
});

// Delete contact submission
router.delete('/contact-submissions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM contact_submissions WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact submission not found' });
    }

    res.json({ message: 'Contact submission deleted successfully' });
  } catch (error) {
    console.error('Delete contact submission error:', error);
    res.status(500).json({ error: 'Server error deleting contact submission' });
  }
});

module.exports = router;

