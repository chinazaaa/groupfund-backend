const pool = require('../config/database');

/**
 * Middleware to require 2FA to be enabled for financial features
 * Blocks access to bank accounts, payment methods, auto pay, etc.
 * if 2FA is not enabled
 */
const require2FA = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Check if 2FA is enabled
    const result = await pool.query(
      'SELECT two_factor_enabled FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const twoFactorEnabled = result.rows[0].two_factor_enabled;

    if (!twoFactorEnabled) {
      return res.status(403).json({
        error: 'Two-factor authentication (2FA) is required for this feature',
        code: '2FA_REQUIRED',
        message: 'Please enable 2FA in your security settings to use this feature',
      });
    }

    // 2FA is enabled, proceed
    next();
  } catch (error) {
    console.error('Require 2FA middleware error:', error);
    res.status(500).json({ error: 'Server error checking 2FA status' });
  }
};

module.exports = { require2FA };
