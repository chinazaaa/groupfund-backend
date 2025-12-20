const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { requireAdmin } = require('../middleware/admin');
const { adminLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// All routes require admin authentication and rate limiting
router.use(adminLimiter);
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
        g.id, g.name, g.invite_code, g.contribution_amount, g.currency, g.group_type,
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
        g.currency, g.status, g.group_type, g.created_at, g.updated_at,
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

    query += ` GROUP BY g.id, g.name, g.invite_code, g.contribution_amount, g.max_members, g.currency, g.status, g.group_type, g.created_at, g.updated_at, u.name, u.email
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

// Get all contributions (birthday, subscription, and general)
router.get('/contributions', async (req, res) => {
  try {
    const { page = 1, limit = 50, status, groupId, userId, contributionType } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build WHERE conditions
    const whereConditions = [];
    const params = [];
    let paramCount = 1;

    if (status) {
      whereConditions.push(`status = $${paramCount++}`);
      params.push(status);
    }

    if (groupId) {
      whereConditions.push(`group_id = $${paramCount++}`);
      params.push(groupId);
    }

    // Build UNION query for all contribution types
    let birthdayWhere = whereConditions.length > 0 ? ` AND ${whereConditions.join(' AND ')}` : '';
    let subscriptionWhere = whereConditions.length > 0 ? ` AND ${whereConditions.join(' AND ')}` : '';
    let generalWhere = whereConditions.length > 0 ? ` AND ${whereConditions.join(' AND ')}` : '';

    // Add userId filter for each type
    if (userId) {
      const userIdParam = `$${paramCount++}`;
      params.push(userId);
      birthdayWhere += ` AND (birthday_user_id = ${userIdParam} OR contributor_id = ${userIdParam})`;
      subscriptionWhere += ` AND contributor_id = ${userIdParam}`;
      generalWhere += ` AND contributor_id = ${userIdParam}`;
    }

    // Filter by contribution type if specified
    if (contributionType === 'birthday') {
      subscriptionWhere = ' AND 1=0'; // Exclude subscription
      generalWhere = ' AND 1=0'; // Exclude general
    } else if (contributionType === 'subscription') {
      birthdayWhere = ' AND 1=0'; // Exclude birthday
      generalWhere = ' AND 1=0'; // Exclude general
    } else if (contributionType === 'general') {
      birthdayWhere = ' AND 1=0'; // Exclude birthday
      subscriptionWhere = ' AND 1=0'; // Exclude subscription
    }

    // Build the UNION query
    const query = `
      SELECT 
        id, amount, contribution_date, status, note, created_at,
        group_id, group_name, currency,
        birthday_user_id, birthday_user_name,
        contributor_id, contributor_name,
        transaction_type, contribution_type,
        subscription_period_start, subscription_period_end
      FROM (
        -- Birthday contributions
        SELECT 
          bc.id, bc.amount, bc.contribution_date, bc.status, bc.note, bc.created_at,
          g.id as group_id, g.name as group_name, g.currency,
          u1.id as birthday_user_id, u1.name as birthday_user_name,
          u2.id as contributor_id, u2.name as contributor_name,
          t.type as transaction_type,
          'birthday' as contribution_type,
          NULL::DATE as subscription_period_start,
          NULL::DATE as subscription_period_end
        FROM birthday_contributions bc
        LEFT JOIN groups g ON bc.group_id = g.id
        LEFT JOIN users u1 ON bc.birthday_user_id = u1.id
        LEFT JOIN users u2 ON bc.contributor_id = u2.id
        LEFT JOIN transactions t ON bc.transaction_id = t.id
        WHERE 1=1 ${birthdayWhere}
        
        UNION ALL
        
        -- Subscription contributions
        SELECT 
          sc.id, sc.amount, sc.contribution_date, sc.status, sc.note, sc.created_at,
          g.id as group_id, g.name as group_name, g.currency,
          NULL::UUID as birthday_user_id, NULL::TEXT as birthday_user_name,
          u.id as contributor_id, u.name as contributor_name,
          t.type as transaction_type,
          'subscription' as contribution_type,
          sc.subscription_period_start,
          sc.subscription_period_end
        FROM subscription_contributions sc
        LEFT JOIN groups g ON sc.group_id = g.id
        LEFT JOIN users u ON sc.contributor_id = u.id
        LEFT JOIN transactions t ON sc.transaction_id = t.id
        WHERE 1=1 ${subscriptionWhere}
        
        UNION ALL
        
        -- General contributions
        SELECT 
          gc.id, gc.amount, gc.contribution_date, gc.status, gc.note, gc.created_at,
          g.id as group_id, g.name as group_name, g.currency,
          NULL::UUID as birthday_user_id, NULL::TEXT as birthday_user_name,
          u.id as contributor_id, u.name as contributor_name,
          t.type as transaction_type,
          'general' as contribution_type,
          NULL::DATE as subscription_period_start,
          NULL::DATE as subscription_period_end
        FROM general_contributions gc
        LEFT JOIN groups g ON gc.group_id = g.id
        LEFT JOIN users u ON gc.contributor_id = u.id
        LEFT JOIN transactions t ON gc.transaction_id = t.id
        WHERE 1=1 ${generalWhere}
      ) all_contributions
      ORDER BY created_at DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;
    params.push(parseInt(limit), offset);

    // Build count query
    const countParams = [];
    let countParamCount = 1;
    const countWhereConditions = [];

    if (status) {
      countWhereConditions.push(`status = $${countParamCount++}`);
      countParams.push(status);
    }

    if (groupId) {
      countWhereConditions.push(`group_id = $${countParamCount++}`);
      countParams.push(groupId);
    }

    let birthdayCountWhere = countWhereConditions.length > 0 ? ` AND ${countWhereConditions.join(' AND ')}` : '';
    let subscriptionCountWhere = countWhereConditions.length > 0 ? ` AND ${countWhereConditions.join(' AND ')}` : '';
    let generalCountWhere = countWhereConditions.length > 0 ? ` AND ${countWhereConditions.join(' AND ')}` : '';

    if (userId) {
      const userIdParam = `$${countParamCount++}`;
      countParams.push(userId);
      birthdayCountWhere += ` AND (birthday_user_id = ${userIdParam} OR contributor_id = ${userIdParam})`;
      subscriptionCountWhere += ` AND contributor_id = ${userIdParam}`;
      generalCountWhere += ` AND contributor_id = ${userIdParam}`;
    }

    if (contributionType === 'birthday') {
      subscriptionCountWhere = ' AND 1=0';
      generalCountWhere = ' AND 1=0';
    } else if (contributionType === 'subscription') {
      birthdayCountWhere = ' AND 1=0';
      generalCountWhere = ' AND 1=0';
    } else if (contributionType === 'general') {
      birthdayCountWhere = ' AND 1=0';
      subscriptionCountWhere = ' AND 1=0';
    }

    const countQuery = `
      SELECT COUNT(*) as total FROM (
        SELECT id FROM birthday_contributions WHERE 1=1 ${birthdayCountWhere}
        UNION ALL
        SELECT id FROM subscription_contributions WHERE 1=1 ${subscriptionCountWhere}
        UNION ALL
        SELECT id FROM general_contributions WHERE 1=1 ${generalCountWhere}
      ) all_contributions
    `;

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

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
    
    // Total contributions (all types)
    const totalContributions = await pool.query(`
      SELECT COUNT(*) as count FROM (
        SELECT id FROM birthday_contributions
        UNION ALL
        SELECT id FROM subscription_contributions
        UNION ALL
        SELECT id FROM general_contributions
      ) all_contributions
    `);
    
    // Contribution status counts (all types)
    const contributionStatusCounts = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'not_paid') as not_paid,
        COUNT(*) FILTER (WHERE status = 'paid') as paid,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
        COUNT(*) FILTER (WHERE status = 'not_received') as not_received
      FROM (
        SELECT status FROM birthday_contributions
        UNION ALL
        SELECT status FROM subscription_contributions
        UNION ALL
        SELECT status FROM general_contributions
      ) all_contributions
    `);
    
    // Users registered in last 30 days
    const recentUsers = await pool.query(`
      SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '30 days'
    `);
    
    // Groups created in last 30 days
    const recentGroups = await pool.query(`
      SELECT COUNT(*) as count FROM groups WHERE created_at >= NOW() - INTERVAL '30 days'
    `);
    
    // Total waitlist entries
    const totalWaitlist = await pool.query('SELECT COUNT(*) as count FROM waitlist');
    
    // Waitlist entries in last 30 days
    const recentWaitlist = await pool.query(`
      SELECT COUNT(*) as count FROM waitlist WHERE created_at >= NOW() - INTERVAL '30 days'
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
      waitlist: {
        total: parseInt(totalWaitlist.rows[0].count),
        recent_30_days: parseInt(recentWaitlist.rows[0].count),
      },
    });
  } catch (error) {
    console.error('Get system stats error:', error);
    res.status(500).json({ error: 'Server error fetching statistics' });
  }
});

// Get today's birthdays
router.get('/birthdays/today', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Query users whose birthday month and day match today
    // Include notification status checks
    const query = `
      SELECT 
        u.id, u.name, u.email, u.phone, u.birthday,
        u.is_verified, u.is_active, u.created_at,
        u.expo_push_token,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.user_id = u.id) as group_count,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM notifications n 
            WHERE n.user_id = u.id 
              AND n.type = 'birthday_wish' 
              AND n.created_at::date = CURRENT_DATE
          ) THEN true 
          ELSE false 
        END as in_app_notification_sent,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM notifications n 
            WHERE n.user_id = u.id 
              AND n.type = 'birthday_wish' 
              AND n.created_at::date = CURRENT_DATE
          ) AND u.expo_push_token IS NOT NULL 
          THEN true 
          ELSE false 
        END as push_notification_sent,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM birthday_email_log bel 
            WHERE bel.user_id = u.id 
              AND bel.sent_at = CURRENT_DATE
          ) THEN true 
          ELSE false 
        END as email_sent,
        CASE 
          WHEN u.email IS NOT NULL AND u.email != '' THEN true 
          ELSE false 
        END as email_available
      FROM users u
      WHERE u.birthday IS NOT NULL
        AND DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE)
        AND DATE_PART('day', u.birthday) = DATE_PART('day', CURRENT_DATE)
      ORDER BY u.name ASC
      LIMIT $1 OFFSET $2
    `;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM users u
      WHERE u.birthday IS NOT NULL
        AND DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE)
        AND DATE_PART('day', u.birthday) = DATE_PART('day', CURRENT_DATE)
    `;

    const countResult = await pool.query(countQuery);
    const total = parseInt(countResult.rows[0].total);

    const result = await pool.query(query, [parseInt(limit), offset]);

    res.json({
      birthdays: result.rows.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        birthday: user.birthday,
        is_verified: user.is_verified,
        is_active: user.is_active !== undefined ? user.is_active : true,
        created_at: user.created_at,
        group_count: parseInt(user.group_count || 0),
        notifications: {
          in_app_sent: user.in_app_notification_sent,
          push_sent: user.push_notification_sent,
          push_token_available: !!user.expo_push_token,
          email_sent: user.email_sent,
          email_available: user.email_available,
        },
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get today\'s birthdays error:', error);
    res.status(500).json({ error: 'Server error fetching today\'s birthdays' });
  }
});

// Trigger birthday wishes for celebrants (today's birthdays)
router.post('/birthdays/trigger-birthday-wishes', async (req, res) => {
  try {
    const { createNotification } = require('../utils/notifications');
    const { sendBirthdayEmail } = require('../utils/email');
    
    const results = {
      sent: 0,
      skipped: 0,
      details: []
    };

    // Process today's birthdays
    const todayBirthdayUsers = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.birthday, u.expo_push_token,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM notifications n 
            WHERE n.user_id = u.id 
              AND n.type = 'birthday_wish' 
              AND n.created_at::date = CURRENT_DATE
          ) THEN true 
          ELSE false 
        END as in_app_notification_sent,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM birthday_email_log bel 
            WHERE bel.user_id = u.id 
              AND bel.sent_at = CURRENT_DATE
          ) THEN true 
          ELSE false 
        END as email_sent
       FROM users u
       WHERE u.birthday IS NOT NULL 
         AND u.is_verified = TRUE
         AND DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE)
         AND DATE_PART('day', u.birthday) = DATE_PART('day', CURRENT_DATE)`
    );

    for (const user of todayBirthdayUsers.rows) {
      if (!user.in_app_notification_sent) {
        await createNotification(
          user.id,
          'birthday_wish',
          '🎉 Happy Birthday!',
          `Happy Birthday, ${user.name}! 🎂🎉 Wishing you a wonderful day filled with joy and celebration!`,
          null,
          user.id
        );
        results.sent++;
        results.details.push({
          user_id: user.id,
          name: user.name,
          email: user.email,
          notification_sent: true,
          email_sent: false
        });
      } else {
        results.skipped++;
      }

      if (user.email && !user.email_sent) {
        try {
          await sendBirthdayEmail(user.email, user.name);
          await pool.query(
            `INSERT INTO birthday_email_log (user_id, email, sent_at)
             VALUES ($1, $2, CURRENT_DATE)
             ON CONFLICT (user_id, sent_at) DO NOTHING`,
            [user.id, user.email]
          );
          if (results.details.length > 0) {
            const detail = results.details.find(d => d.user_id === user.id);
            if (detail) {
              detail.email_sent = true;
            }
          }
        } catch (err) {
          console.error(`Error sending birthday email to ${user.email}:`, err);
        }
      } else if (user.email && user.email_sent) {
        results.skipped++;
      }
    }

    res.json({
      message: 'Birthday wishes processed successfully',
      summary: {
        total: results.sent + results.skipped,
        sent: results.sent,
        skipped: results.skipped
      },
      details: results.details
    });
  } catch (error) {
    console.error('Error triggering birthday wishes:', error);
    res.status(500).json({ error: 'Server error triggering birthday wishes', message: error.message });
  }
});

// Trigger reminders to contributors for all group types (7 days, 1 day, same day - respects user preferences)
// Handles: birthday groups, subscription groups, and general groups
router.post('/contributions/trigger-reminders', async (req, res) => {
  try {
    const { checkContributionsReminders } = require('../jobs/contributionsReminders');
    
    await checkContributionsReminders();
    
    res.json({ 
      message: 'Reminders triggered successfully',
      note: 'Reminders are sent for upcoming deadlines (7 days, 1 day, same day) for all group types. Admin notifications are also sent for subscription and general groups.'
    });
  } catch (error) {
    console.error('Error triggering reminders:', error);
    res.status(500).json({ error: 'Server error triggering reminders', message: error.message });
  }
});

// Manually send birthday notifications to a specific user
router.post('/birthdays/:userId/send-notifications', async (req, res) => {
  try {
    const { userId } = req.params;
    const { sendInApp = true, sendPush = true, sendEmail = true } = req.body;

    // Get user details
    const userResult = await pool.query(
      `SELECT id, name, email, expo_push_token, birthday, is_verified
       FROM users 
       WHERE id = $1 AND birthday IS NOT NULL`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or has no birthday set' });
    }

    const user = userResult.rows[0];

    // Check if today is their birthday
    const isTodayBirthday = await pool.query(
      `SELECT 1 FROM users 
       WHERE id = $1 
         AND DATE_PART('month', birthday) = DATE_PART('month', CURRENT_DATE)
         AND DATE_PART('day', birthday) = DATE_PART('day', CURRENT_DATE)`,
      [userId]
    );

    if (isTodayBirthday.rows.length === 0) {
      return res.status(400).json({ 
        error: 'Today is not this user\'s birthday',
        user_birthday: user.birthday
      });
    }

    const results = {
      in_app_notification: { sent: false, error: null },
      push_notification: { sent: false, error: null },
      email: { sent: false, error: null },
    };

    // Send in-app notification
    if (sendInApp) {
      try {
        const { createNotification } = require('../utils/notifications');
        await createNotification(
          user.id,
          'birthday_wish',
          '🎉 Happy Birthday!',
          `Happy Birthday, ${user.name}! 🎂🎉 Wishing you a wonderful day filled with joy and celebration!`,
          null,
          user.id
        );
        results.in_app_notification.sent = true;
      } catch (error) {
        results.in_app_notification.error = error.message;
        console.error('Error sending in-app notification:', error);
      }
    }

    // Send push notification (handled by createNotification if push token exists)
    if (sendPush) {
      if (!user.expo_push_token) {
        results.push_notification.error = 'User has no push token registered';
      } else {
        // Push notification is sent automatically by createNotification if token exists
        // If we already sent in-app, push was sent too. Otherwise, send it separately
        if (!sendInApp) {
          try {
            const { createNotification } = require('../utils/notifications');
            await createNotification(
              user.id,
              'birthday_wish',
              '🎉 Happy Birthday!',
              `Happy Birthday, ${user.name}! 🎂🎉 Wishing you a wonderful day filled with joy and celebration!`,
              null,
              user.id
            );
            results.push_notification.sent = true;
          } catch (error) {
            results.push_notification.error = error.message;
            console.error('Error sending push notification:', error);
          }
        } else {
          results.push_notification.sent = results.in_app_notification.sent;
        }
      }
    }

    // Send email
    if (sendEmail) {
      if (!user.email) {
        results.email.error = 'User has no email address';
      } else {
        try {
          const { sendBirthdayEmail } = require('../utils/email');
          await sendBirthdayEmail(user.email, user.name);
          // Log email send in birthday_email_log
          await pool.query(
            `INSERT INTO birthday_email_log (user_id, email, sent_at)
             VALUES ($1, $2, CURRENT_DATE)
             ON CONFLICT (user_id, sent_at) DO NOTHING`,
            [user.id, user.email]
          );
          results.email.sent = true;
        } catch (error) {
          results.email.error = error.message;
          console.error('Error sending birthday email:', error);
        }
      }
    }

    res.json({
      message: 'Birthday notifications sent',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      results,
    });
  } catch (error) {
    console.error('Error sending birthday notifications:', error);
    res.status(500).json({ error: 'Server error sending birthday notifications' });
  }
});

// Send monthly newsletter to all users (includes birthdays, subscriptions, and general groups)
router.post('/contributions/send-monthly-newsletter', async (req, res) => {
  try {
    const pool = require('../config/database');
    const { createNotification } = require('../utils/notifications');
    const { sendMonthlyNewsletter } = require('../utils/email');
    const { formatAmount } = require('../utils/currency');
    
    const results = {
      sent: 0,
      skipped: 0,
      errors: 0,
      details: []
    };
    
    // Get current month name
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    const monthName = monthNames[currentMonth];
    
    // Get all active users
    const usersResult = await pool.query(
      `SELECT id, name, email, expo_push_token
       FROM users 
       WHERE is_verified = TRUE AND email IS NOT NULL AND email != ''`
    );
    
    for (const user of usersResult.rows) {
      try {
        // Check if monthly newsletter was already sent this month
        const newsletterCheck = await pool.query(
          `SELECT id FROM notifications 
           WHERE user_id = $1 AND type = 'monthly_newsletter' 
           AND DATE_PART('year', created_at) = $2 
           AND DATE_PART('month', created_at) = $3`,
          [user.id, currentYear, currentMonth + 1] // PostgreSQL months are 1-12
        );
        
        if (newsletterCheck.rows.length > 0) {
          results.skipped++;
          results.details.push({
            user_id: user.id,
            user_name: user.name,
            email: user.email,
            status: 'skipped',
            reason: 'Already sent this month'
          });
          continue;
        }
        
        // Get all groups the user is in
        const groupsResult = await pool.query(
          `SELECT g.id, g.name, g.contribution_amount, g.currency, g.group_type,
                  g.subscription_frequency, g.subscription_platform, 
                  g.subscription_deadline_day, g.subscription_deadline_month, g.deadline
           FROM groups g
           JOIN group_members gm ON g.id = gm.group_id
           WHERE gm.user_id = $1 AND gm.status = 'active' AND g.status = 'active'`,
          [user.id]
        );
        
        // Collect all groups with birthdays in current month
        const groupsWithBirthdays = [];
        // Collect subscription groups with deadlines this month
        const subscriptionGroups = [];
        // Collect general groups with deadlines this month
        const generalGroups = [];
        
        for (const group of groupsResult.rows) {
          if (group.group_type === 'birthday') {
            // Get all active members in this group with birthdays in current month
            const membersResult = await pool.query(
              `SELECT u.id, u.name, u.birthday
               FROM users u
               JOIN group_members gm ON u.id = gm.user_id
               WHERE gm.group_id = $1 AND gm.status = 'active' 
               AND u.birthday IS NOT NULL
               AND DATE_PART('month', u.birthday) = $2`,
              [group.id, currentMonth + 1] // PostgreSQL months are 1-12
            );
            
            if (membersResult.rows.length > 0) {
              groupsWithBirthdays.push({
                groupId: group.id,
                groupName: group.name,
                currency: group.currency || 'NGN',
                contributionAmount: parseFloat(group.contribution_amount),
                birthdays: membersResult.rows.map(m => ({
                  id: m.id,
                  name: m.name,
                  birthday: m.birthday
                }))
              });
            }
          } else if (group.group_type === 'subscription') {
            // Check if subscription deadline is in current month
            if (group.subscription_frequency === 'monthly') {
              // Monthly subscriptions always have a deadline this month
              subscriptionGroups.push({
                groupId: group.id,
                groupName: group.name,
                currency: group.currency || 'NGN',
                contributionAmount: parseFloat(group.contribution_amount),
                subscriptionPlatform: group.subscription_platform,
                subscriptionFrequency: group.subscription_frequency,
                deadlineDay: group.subscription_deadline_day
              });
            } else if (group.subscription_frequency === 'annual') {
              // Annual subscriptions - check if deadline month matches current month
              if (group.subscription_deadline_month === currentMonth + 1) {
                subscriptionGroups.push({
                  groupId: group.id,
                  groupName: group.name,
                  currency: group.currency || 'NGN',
                  contributionAmount: parseFloat(group.contribution_amount),
                  subscriptionPlatform: group.subscription_platform,
                  subscriptionFrequency: group.subscription_frequency,
                  deadlineDay: group.subscription_deadline_day
                });
              }
            }
          } else if (group.group_type === 'general' && group.deadline) {
            // Check if general group deadline is in current month
            const deadlineDate = new Date(group.deadline);
            if (deadlineDate.getMonth() === currentMonth && deadlineDate.getFullYear() === currentYear) {
              generalGroups.push({
                groupId: group.id,
                groupName: group.name,
                currency: group.currency || 'NGN',
                contributionAmount: parseFloat(group.contribution_amount),
                deadline: group.deadline
              });
            }
          }
        }
        
        // Check if user has any groups at all
        const hasGroups = groupsResult.rows.length > 0;
        const hasUpcomingItems = groupsWithBirthdays.length > 0 || subscriptionGroups.length > 0 || generalGroups.length > 0;
        
        // Only send if user has at least one group with upcoming items this month
        if (hasUpcomingItems) {
          // Send email
          let emailSent = false;
          if (user.email) {
            try {
              const { sendMonthlyNewsletter } = require('../utils/email');
              await sendMonthlyNewsletter(
                user.email,
                user.name,
                user.id,
                monthName,
                groupsWithBirthdays.map(g => ({
                  groupName: g.groupName,
                  currency: g.currency,
                  contributionAmount: g.contributionAmount,
                  birthdays: g.birthdays
                })),
                subscriptionGroups,
                generalGroups
              );
              emailSent = true;
            } catch (err) {
              console.error(`Error sending monthly newsletter email to ${user.email}:`, err);
            }
          }
          
          // Send simple notification
          const totalItems = groupsWithBirthdays.reduce((sum, g) => sum + g.birthdays.length, 0) + 
                            subscriptionGroups.length + generalGroups.length;
          const notificationText = totalItems > 0 
            ? `Your monthly summary for ${monthName} (${totalItems} item${totalItems > 1 ? 's' : ''}) is in your email. Check it out!`
            : `Your monthly summary for ${monthName} is in your email. Check it out!`;
          
          try {
            await createNotification(
              user.id,
              'monthly_newsletter',
              'Monthly Newsletter',
              notificationText,
              null,
              null
            );
          } catch (err) {
            console.error(`Error sending monthly newsletter notification to user ${user.id}:`, err);
          }
          
          results.sent++;
          results.details.push({
            user_id: user.id,
            user_name: user.name,
            email: user.email,
            status: 'sent',
            email_sent: emailSent,
            birthday_groups_count: groupsWithBirthdays.length,
            subscription_groups_count: subscriptionGroups.length,
            general_groups_count: generalGroups.length,
            total_birthdays: groupsWithBirthdays.reduce((sum, g) => sum + g.birthdays.length, 0),
            total_items: totalItems
          });
        } else {
          results.skipped++;
          results.details.push({
            user_id: user.id,
            user_name: user.name,
            email: user.email,
            status: 'skipped',
            reason: hasGroups ? 'No upcoming items in current month' : 'User has no groups',
            groups_count: groupsResult.rows.length
          });
        }
      } catch (error) {
        console.error(`Error processing monthly newsletter for user ${user.id}:`, error);
        results.errors++;
        results.details.push({
          user_id: user.id,
          user_name: user.name,
          email: user.email,
          status: 'error',
          error: error.message
        });
      }
    }
    
    res.json({
      message: 'Monthly newsletter processed successfully',
      month: monthName,
      year: currentYear,
      summary: {
        total: results.sent + results.skipped + results.errors,
        sent: results.sent,
        skipped: results.skipped,
        errors: results.errors
      },
      details: results.details
    });
  } catch (error) {
    console.error('Error sending monthly newsletter:', error);
    res.status(500).json({ error: 'Server error sending monthly newsletter', message: error.message });
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

// Get all waitlist entries
router.get('/waitlist', async (req, res) => {
  try {
    const { page = 1, limit = 50, search, groupType } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        id, name, email, phone, group_type, created_at, beta_email_sent
      FROM waitlist
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (search) {
      query += ` AND (name ILIKE $${paramCount} OR email ILIKE $${paramCount} OR phone ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (groupType) {
      query += ` AND group_type = $${paramCount++}`;
      params.push(groupType);
    }

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM waitlist
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 1;

    if (search) {
      countQuery += ` AND (name ILIKE $${countParamCount} OR email ILIKE $${countParamCount} OR phone ILIKE $${countParamCount})`;
      countParams.push(`%${search}%`);
      countParamCount++;
    }

    if (groupType) {
      countQuery += ` AND group_type = $${countParamCount++}`;
      countParams.push(groupType);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      entries: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get waitlist entries error:', error);
    res.status(500).json({ error: 'Server error fetching waitlist entries' });
  }
});

// Delete waitlist entry
router.delete('/waitlist/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM waitlist WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Waitlist entry not found' });
    }

    res.json({ message: 'Waitlist entry deleted successfully' });
  } catch (error) {
    console.error('Delete waitlist entry error:', error);
    res.status(500).json({ error: 'Server error deleting waitlist entry' });
  }
});

// Test beta invitation email to a specific email address
router.post('/waitlist/test-beta-invitation', async (req, res) => {
  try {
    const { sendBetaInvitationEmail } = require('../utils/email');
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const testName = name || 'Test User';
    const emailSent = await sendBetaInvitationEmail(email, testName);

    if (emailSent) {
      res.json({
        message: 'Test beta invitation email sent successfully',
        email: email,
        name: testName,
        note: 'This was a test email - the waitlist database was not updated'
      });
    } else {
      res.status(500).json({
        error: 'Failed to send test beta invitation email',
        email: email
      });
    }
  } catch (error) {
    console.error('Error sending test beta invitation email:', error);
    res.status(500).json({
      error: 'Server error sending test beta invitation email',
      message: error.message
    });
  }
});

// Trigger beta invitation emails to waitlist members
router.post('/waitlist/send-beta-invitations', async (req, res) => {
  try {
    const { sendBetaInvitationEmail } = require('../utils/email');
    
    // Get all waitlist entries that haven't received the beta email
    const waitlistEntries = await pool.query(
      'SELECT id, name, email FROM waitlist WHERE beta_email_sent = FALSE ORDER BY created_at ASC'
    );

    if (waitlistEntries.rows.length === 0) {
      return res.json({
        message: 'No waitlist entries found that need beta invitation emails',
        sent: 0,
        failed: 0,
        total: 0
      });
    }

    let sentCount = 0;
    let failedCount = 0;
    const failedEmails = [];

    // Send emails to each waitlist member
    for (const entry of waitlistEntries.rows) {
      try {
        const emailSent = await sendBetaInvitationEmail(entry.email, entry.name);
        
        if (emailSent) {
          // Update the beta_email_sent flag
          await pool.query(
            'UPDATE waitlist SET beta_email_sent = TRUE WHERE id = $1',
            [entry.id]
          );
          sentCount++;
        } else {
          failedCount++;
          failedEmails.push(entry.email);
          console.error(`Failed to send beta invitation email to ${entry.email}`);
        }
      } catch (error) {
        failedCount++;
        failedEmails.push(entry.email);
        console.error(`Error sending beta invitation email to ${entry.email}:`, error);
      }
    }

    res.json({
      message: `Beta invitation emails processed`,
      sent: sentCount,
      failed: failedCount,
      total: waitlistEntries.rows.length,
      ...(failedEmails.length > 0 && { failed_emails: failedEmails })
    });
  } catch (error) {
    console.error('Error triggering beta invitation emails:', error);
    res.status(500).json({ 
      error: 'Server error triggering beta invitation emails', 
      message: error.message 
    });
  }
});

// Trigger overdue contribution reminders for all group types (1, 3, 7, 14 days after deadline)
router.post('/contributions/trigger-overdue-reminders', async (req, res) => {
  try {
    const { checkOverdueContributions } = require('../jobs/contributionsReminders');
    
    await checkOverdueContributions();
    
    res.json({ 
      message: 'Overdue contribution reminders triggered successfully',
      note: 'Reminders are sent for contributions that are 1, 3, 7, or 14 days overdue'
    });
  } catch (error) {
    console.error('Error triggering overdue contribution reminders:', error);
    res.status(500).json({ error: 'Server error triggering overdue contribution reminders', message: error.message });
  }
});

module.exports = router;

