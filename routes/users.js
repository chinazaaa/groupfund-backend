const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get current user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const userResult = await pool.query(
      `SELECT id, name, email, phone, birthday, is_verified, is_admin,
              notify_7_days_before, notify_1_day_before, notify_same_day,
              created_at 
       FROM users WHERE id = $1`,
      [userId]
    );

    const walletResult = await pool.query(
      'SELECT balance, account_number, bank_name, account_name, iban, swift_bic, routing_number, sort_code, branch_code, branch_address FROM wallets WHERE user_id = $1',
      [userId]
    );

    // Only return wallet if it exists and has payment details
    const wallet = walletResult.rows[0];
    const walletResponse = wallet && (wallet.account_name || wallet.bank_name || wallet.account_number)
      ? wallet
      : { balance: 0, account_number: null, bank_name: null, account_name: null, iban: null, swift_bic: null, routing_number: null, sort_code: null, branch_code: null, branch_address: null };

    res.json({
      user: userResult.rows[0],
      wallet: walletResponse,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update profile
router.put('/profile', authenticate, [
  body('name').optional().trim().notEmpty(),
  body('phone').optional().trim().notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { name, phone } = req.body;

    // Prevent birthday updates - users must contact support
    if (req.body.birthday !== undefined) {
      return res.status(403).json({ error: 'Birthday cannot be updated. Please contact support@groupfund.app to change your birthday.' });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (phone) {
      updates.push(`phone = $${paramCount++}`);
      values.push(phone);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, name, email, phone, birthday`;

    const result = await pool.query(query, values);

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Server error updating profile' });
  }
});

// Get wallet balance
router.get('/wallet', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT balance, account_number, bank_name, account_name, iban, swift_bic, routing_number, sort_code, branch_code, branch_address FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update wallet/payment details
router.put('/wallet', authenticate, [
  body('account_name').optional().trim().notEmpty().withMessage('Account name is required if provided'),
  body('bank_name').optional().trim().notEmpty().withMessage('Bank name is required if provided'),
  body('account_number').optional().trim().notEmpty().withMessage('Account number is required if provided'),
  body('iban').optional().trim(),
  body('swift_bic').optional().trim(),
  body('routing_number').optional().trim(),
  body('sort_code').optional().trim(),
  body('branch_code').optional().trim(),
  body('branch_address').optional().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { account_name, bank_name, account_number, iban, swift_bic, routing_number, sort_code, branch_code, branch_address } = req.body;

    // Check if wallet exists
    const walletCheck = await pool.query(
      'SELECT id FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (walletCheck.rows.length === 0) {
      // Create wallet if it doesn't exist (only when user explicitly adds payment details)
      await pool.query(
        'INSERT INTO wallets (user_id, account_name, bank_name, account_number, iban, swift_bic, routing_number, sort_code, branch_code, branch_address, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0)',
        [userId, account_name, bank_name, account_number, iban || null, swift_bic || null, routing_number || null, sort_code || null, branch_code || null, branch_address || null]
      );
    } else {
      // Update existing wallet
      const updates = [];
      const values = [];
      let paramCount = 1;

      if (account_name !== undefined) {
        updates.push(`account_name = $${paramCount++}`);
        values.push(account_name);
      }

      if (bank_name !== undefined) {
        updates.push(`bank_name = $${paramCount++}`);
        values.push(bank_name);
      }

      if (account_number !== undefined) {
        updates.push(`account_number = $${paramCount++}`);
        values.push(account_number);
      }

      if (iban !== undefined) {
        updates.push(`iban = $${paramCount++}`);
        values.push(iban || null);
      }

      if (swift_bic !== undefined) {
        updates.push(`swift_bic = $${paramCount++}`);
        values.push(swift_bic || null);
      }

      if (routing_number !== undefined) {
        updates.push(`routing_number = $${paramCount++}`);
        values.push(routing_number || null);
      }

      if (sort_code !== undefined) {
        updates.push(`sort_code = $${paramCount++}`);
        values.push(sort_code || null);
      }

      if (branch_code !== undefined) {
        updates.push(`branch_code = $${paramCount++}`);
        values.push(branch_code || null);
      }

      if (branch_address !== undefined) {
        updates.push(`branch_address = $${paramCount++}`);
        values.push(branch_address || null);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(userId);
      await pool.query(
        `UPDATE wallets SET ${updates.join(', ')} WHERE user_id = $${paramCount}`,
        values
      );
    }

    // Return updated wallet
    const result = await pool.query(
      'SELECT balance, account_number, bank_name, account_name, iban, swift_bic, routing_number, sort_code, branch_code, branch_address FROM wallets WHERE user_id = $1',
      [userId]
    );

    res.json({ wallet: result.rows[0] });
  } catch (error) {
    console.error('Update wallet error:', error);
    res.status(500).json({ error: 'Server error updating wallet' });
  }
});

// Delete account
router.delete('/account', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete user (cascade will handle related records due to ON DELETE CASCADE)
    // This will delete: wallets, transactions, group_members, birthday_contributions, otps
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Server error deleting account' });
  }
});

// Get notification preferences
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT notify_7_days_before, notify_1_day_before, notify_same_day
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      notify_7_days_before: result.rows[0].notify_7_days_before ?? true,
      notify_1_day_before: result.rows[0].notify_1_day_before ?? true,
      notify_same_day: result.rows[0].notify_same_day ?? true,
    });
  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update notification preferences
router.put('/notifications', authenticate, [
  body('notify_7_days_before').optional().isBoolean(),
  body('notify_1_day_before').optional().isBoolean(),
  body('notify_same_day').optional().isBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { notify_7_days_before, notify_1_day_before, notify_same_day } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (notify_7_days_before !== undefined) {
      updates.push(`notify_7_days_before = $${paramCount++}`);
      values.push(notify_7_days_before);
    }
    if (notify_1_day_before !== undefined) {
      updates.push(`notify_1_day_before = $${paramCount++}`);
      values.push(notify_1_day_before);
    }
    if (notify_same_day !== undefined) {
      updates.push(`notify_same_day = $${paramCount++}`);
      values.push(notify_same_day);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING notify_7_days_before, notify_1_day_before, notify_same_day`;
    const result = await pool.query(query, values);

    res.json({
      message: 'Notification preferences updated successfully',
      preferences: {
        notify_7_days_before: result.rows[0].notify_7_days_before,
        notify_1_day_before: result.rows[0].notify_1_day_before,
        notify_same_day: result.rows[0].notify_same_day,
      },
    });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register/Update push token
router.post('/push-token', authenticate, [
  body('pushToken').trim().notEmpty().withMessage('Push token is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { pushToken } = req.body;

    // Update user's push token
    await pool.query(
      'UPDATE users SET expo_push_token = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [pushToken, userId]
    );

    res.json({ message: 'Push token registered successfully' });
  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ error: 'Server error registering push token' });
  }
});

module.exports = router;
