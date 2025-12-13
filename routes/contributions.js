const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get contribution history
router.get('/history', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, groupId, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        t.id, t.type, t.amount, t.description, t.status, t.created_at,
        g.id as group_id, g.name as group_name, g.currency,
        bc.note
      FROM transactions t
      LEFT JOIN groups g ON t.group_id = g.id
      LEFT JOIN birthday_contributions bc ON bc.transaction_id = t.id
      WHERE t.user_id = $1
    `;
    const params = [userId];
    let paramCount = 2;

    if (type) {
      query += ` AND t.type = $${paramCount++}`;
      params.push(type);
    }

    if (groupId) {
      query += ` AND t.group_id = $${paramCount++}`;
      params.push(groupId);
    }

    query += ` ORDER BY t.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Map transaction status to contribution status for each row
    const allContributions = await Promise.all(result.rows.map(async (row) => {
      let contributionStatus = row.status || 'completed';
      
      // If there's a note, it's likely a birthday contribution - check birthday_contributions table
      if (row.note) {
        const contributionResult = await pool.query(
          `SELECT bc.status FROM birthday_contributions bc
           WHERE bc.transaction_id = $1 LIMIT 1`,
          [row.id]
        );
        if (contributionResult.rows.length > 0) {
          contributionStatus = contributionResult.rows[0].status;
          // Map: 'paid' = awaiting confirmation, 'confirmed', 'not_received', 'not_paid'
        } else if (row.status === 'completed') {
          // Legacy completed status
          contributionStatus = 'confirmed';
        }
      } else if (row.status === 'completed') {
        // Non-birthday transactions that are completed
        contributionStatus = 'confirmed';
      }

      return {
        ...row,
        status: contributionStatus,
        currency: row.currency || 'NGN',
      };
    }));

    // Filter contributions based on type:
    // - For sent (debit): Filter out "not_paid" but keep "not_received", "paid", and "confirmed"
    // - For received (credit): Filter out both "not_paid" and "not_received", only show "paid" and "confirmed"
    const contributions = allContributions.filter(contribution => {
      // Always filter out "not_paid"
      if (contribution.status === 'not_paid') {
        return false;
      }
      
      // For received (credit) contributions, also filter out "not_received"
      if (contribution.type === 'credit' && contribution.status === 'not_received') {
        return false;
      }
      
      // For sent (debit) contributions, keep "not_received" so sender can see it
      return true;
    });

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM transactions WHERE user_id = $1';
    const countParams = [userId];
    let countParamCount = 2;

    if (type) {
      countQuery += ` AND type = $${countParamCount++}`;
      countParams.push(type);
    }

    if (groupId) {
      countQuery += ` AND group_id = $${countParamCount++}`;
      countParams.push(groupId);
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      contributions: contributions,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Get contribution history error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get received history (birthday contributions received)
router.get('/received', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    // Query from transactions table for received payments (type='credit')
    // This ensures consistency with what's shown in contribution history
    const result = await pool.query(
      `SELECT 
        t.id, t.amount, t.created_at as contribution_date, t.status, t.created_at, 
        t.description, bc.note, bc.id as contribution_id, bc.status as contribution_status,
        g.id as group_id, g.name as group_name, g.currency,
        bc.contributor_id, u.name as contributor_name
       FROM transactions t
       LEFT JOIN groups g ON t.group_id = g.id
       LEFT JOIN birthday_contributions bc ON bc.transaction_id = t.id
       LEFT JOIN users u ON bc.contributor_id = u.id
       WHERE t.user_id = $1 AND t.type = 'credit'
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), parseInt(offset)]
    );

    // Format the response to match the expected structure
    // Extract contributor name from description if not found in join
    const contributions = result.rows.map((row) => {
      let contributorName = row.contributor_name;
      
      // If contributor_name is not available, try to extract from description
      if (!contributorName && row.description) {
        // Description format: "Birthday gift from [Name] (Group Name)" or "Birthday gift from [Name]"
        const match = row.description.match(/Birthday gift from ([^(]+)/);
        if (match) {
          contributorName = match[1].trim();
        }
      }
      
      // Get contribution status from birthday_contributions table
      let contributionStatus = row.contribution_status || row.status || 'completed';
      if (!row.contribution_status && row.status === 'completed') {
        // Legacy: if transaction status is 'completed' but no contribution record, treat as confirmed
        contributionStatus = 'confirmed';
      }

      return {
        id: row.id,
        amount: row.amount,
        contribution_date: row.contribution_date,
        status: contributionStatus,
        created_at: row.created_at,
        note: row.note,
        group_id: row.group_id,
        group_name: row.group_name,
        currency: row.currency || 'NGN',
        contributor_id: row.contributor_id,
        contributor_name: contributorName || 'Unknown',
        contribution_id: row.contribution_id,
      };
    }).filter(contribution => {
      // For received history (celebrant): Only show "paid" (awaiting) or "confirmed", filter out "not_paid" and "not_received"
      return contribution.status === 'paid' || contribution.status === 'confirmed';
    });

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM transactions WHERE user_id = $1 AND type = 'credit'",
      [userId]
    );

    res.json({
      contributions: contributions,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Get received history error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add money to wallet (simulate bank transfer)
router.post('/add-money', authenticate, async (req, res) => {
  try {
    const { amount, reference } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // In a real app, this would verify the bank transfer first
    // For now, we'll just add it to the wallet

    await pool.query('BEGIN');

    try {
      // Add to wallet
      await pool.query(
        'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
        [amount, userId]
      );

      // Create transaction record
      await pool.query(
        `INSERT INTO transactions (user_id, type, amount, description, status, reference)
         VALUES ($1, 'credit', $2, 'Bank transfer - Add money', 'completed', $3)`,
        [userId, amount, reference || `REF-${Date.now()}`]
      );

      await pool.query('COMMIT');

      // Get updated balance
      const walletResult = await pool.query(
        'SELECT balance FROM wallets WHERE user_id = $1',
        [userId]
      );

      res.json({
        message: 'Money added successfully',
        balance: parseFloat(walletResult.rows[0].balance),
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Add money error:', error);
    res.status(500).json({ error: 'Server error adding money' });
  }
});

// Transfer out (withdraw from wallet)
router.post('/transfer-out', authenticate, async (req, res) => {
  try {
    const { amount, bankAccount, bankName, accountName } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!bankAccount || !accountName) {
      return res.status(400).json({ error: 'Bank account details required' });
    }

    // Check wallet balance
    const walletResult = await pool.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (walletResult.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const currentBalance = parseFloat(walletResult.rows[0].balance);
    if (currentBalance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await pool.query('BEGIN');

    try {
      // Deduct from wallet
      await pool.query(
        'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2',
        [amount, userId]
      );

      // Create transaction record (pending until bank transfer completes)
      await pool.query(
        `INSERT INTO transactions (user_id, type, amount, description, status, reference)
         VALUES ($1, 'debit', $2, $3, 'pending', $4)`,
        [
          userId,
          amount,
          `Transfer to ${accountName} - ${bankAccount} (${bankName || 'N/A'})`,
          `TXN-${Date.now()}`,
        ]
      );

      await pool.query('COMMIT');

      // Get updated balance
      const updatedWallet = await pool.query(
        'SELECT balance FROM wallets WHERE user_id = $1',
        [userId]
      );

      res.json({
        message: 'Transfer request submitted. Processing...',
        balance: parseFloat(updatedWallet.rows[0].balance),
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Transfer out error:', error);
    res.status(500).json({ error: 'Server error processing transfer' });
  }
});

module.exports = router;
