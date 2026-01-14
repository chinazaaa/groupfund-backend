const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { otpLimiter, authLimiter } = require('../middleware/rateLimiter');
const {
  generateTOTPSecret,
  verifyTOTPToken,
  generateQRCode,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  formatSecretForDisplay,
} = require('../utils/twoFactor');
const { sendOTPEmail } = require('../utils/email');
const { generateOTP } = require('../utils/helpers');
const { verifyPassword } = require('../utils/paymentHelpers');

const router = express.Router();

/**
 * GET /api/2fa/status
 * Get current 2FA status
 */
router.get('/status', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT two_factor_enabled, two_factor_method FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      enabled: result.rows[0].two_factor_enabled || false,
      method: result.rows[0].two_factor_method || 'authenticator',
    });
  } catch (error) {
    console.error('Get 2FA status error:', error);
    res.status(500).json({ error: 'Server error retrieving 2FA status' });
  }
});

/**
 * POST /api/2fa/enable
 * Step 1: Generate TOTP secret and QR code for authenticator setup
 * Returns secret key (for manual entry) and QR code (for scanning)
 */
router.post('/enable', authenticate, authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: errors.array()[0].msg || 'Validation failed',
        errors: errors.array() 
      });
    }

    const userId = req.user.id;
    const { password } = req.body;

    // Verify password
    const isValid = await verifyPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Check if 2FA is already enabled
    const userResult = await pool.query(
      'SELECT two_factor_enabled, email FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (userResult.rows[0].two_factor_enabled) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    const email = userResult.rows[0].email;

    // Generate TOTP secret (authenticator is default)
    const { secret, otpauth_url } = generateTOTPSecret(email);

    // Generate QR code
    const qrCodeDataURL = await generateQRCode(otpauth_url);

    // Store secret temporarily (will be confirmed in verify-setup step)
    // For now, just return it - we'll store it after verification
    res.json({
      secret: secret, // Raw secret (base32)
      secretFormatted: formatSecretForDisplay(secret), // Formatted for display
      qrCode: qrCodeDataURL, // QR code as data URL
      method: 'authenticator',
      message: 'Scan the QR code or enter the secret key into your authenticator app',
    });
  } catch (error) {
    console.error('Enable 2FA error:', error);
    res.status(500).json({ error: 'Server error enabling 2FA' });
  }
});

/**
 * POST /api/2fa/verify-setup
 * Step 2: Verify TOTP code to complete authenticator setup
 * This stores the secret and enables 2FA
 */
router.post('/verify-setup', authenticate, otpLimiter, [
  body('token')
    .custom((value) => {
      // Check if value exists
      if (value === undefined || value === null || value === '') {
        throw new Error('Token is required');
      }
      // Handle both string and number inputs
      const tokenStr = String(value).trim();
      if (tokenStr.length === 0) {
        throw new Error('Token is required');
      }
      if (tokenStr.length !== 6) {
        throw new Error('Token must be exactly 6 digits');
      }
      if (!/^\d+$/.test(tokenStr)) {
        throw new Error('Token must contain only numbers');
      }
      return true;
    }),
  body('secret').notEmpty().withMessage('Secret is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: errors.array()[0].msg || 'Validation failed',
        errors: errors.array() 
      });
    }

    const userId = req.user.id;
    const { token, secret } = req.body;
    
    // Convert to string (handles both string and number inputs)
    // TOTP codes should always be 6 digits, so pad with leading zeros if needed
    let tokenString = String(token).trim();
    // If it's a number that lost leading zeros (e.g., 77341 instead of 077341), pad it
    if (tokenString.length < 6 && /^\d+$/.test(tokenString)) {
      tokenString = tokenString.padStart(6, '0');
    }

    // Verify TOTP token (use trimmed string to preserve leading zeros)
    const isValid = verifyTOTPToken(tokenString, secret);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid code. Please try again.' });
    }

    // Check if 2FA is already enabled
    const userResult = await pool.query(
      'SELECT two_factor_enabled FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (userResult.rows[0].two_factor_enabled) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes(8);
    const hashedBackupCodes = backupCodes.map(code => hashBackupCode(code));

    // Store secret and enable 2FA
    await pool.query(
      `UPDATE users 
       SET two_factor_enabled = TRUE, 
           two_factor_method = 'authenticator',
           two_factor_secret = $1,
           two_factor_backup_codes = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [secret, JSON.stringify(hashedBackupCodes), userId]
    );

    res.json({
      message: '2FA enabled successfully',
      backupCodes: backupCodes, // Return codes once - user must save them
      method: 'authenticator',
      warning: 'Save these backup codes in a safe place. You will need them if you lose access to your authenticator app.',
    });
  } catch (error) {
    console.error('Verify 2FA setup error:', error);
    res.status(500).json({ error: 'Server error verifying 2FA setup' });
  }
});

/**
 * POST /api/2fa/disable
 * Disable 2FA (requires password verification)
 */
router.post('/disable', authenticate, authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: errors.array()[0].msg || 'Validation failed',
        errors: errors.array() 
      });
    }

    const userId = req.user.id;
    const { password } = req.body;

    // Verify password
    const isValid = await verifyPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Check if 2FA is enabled
    const userResult = await pool.query(
      'SELECT two_factor_enabled FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!userResult.rows[0].two_factor_enabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    // Disable 2FA
    await pool.query(
      `UPDATE users 
       SET two_factor_enabled = FALSE,
           two_factor_method = 'authenticator',
           two_factor_secret = NULL,
           two_factor_backup_codes = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [userId]
    );

    res.json({
      message: '2FA disabled successfully',
    });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({ error: 'Server error disabling 2FA' });
  }
});

/**
 * POST /api/2fa/regenerate-backup-codes
 * Regenerate backup codes (requires password verification)
 */
router.post('/regenerate-backup-codes', authenticate, authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: errors.array()[0].msg || 'Validation failed',
        errors: errors.array() 
      });
    }

    const userId = req.user.id;
    const { password } = req.body;

    // Verify password
    const isValid = await verifyPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Check if 2FA is enabled
    const userResult = await pool.query(
      'SELECT two_factor_enabled FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!userResult.rows[0].two_factor_enabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    // Generate new backup codes
    const backupCodes = generateBackupCodes(8);
    const hashedBackupCodes = backupCodes.map(code => hashBackupCode(code));

    // Update backup codes
    await pool.query(
      `UPDATE users 
       SET two_factor_backup_codes = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [JSON.stringify(hashedBackupCodes), userId]
    );

    res.json({
      message: 'Backup codes regenerated successfully',
      backupCodes: backupCodes,
      warning: 'Save these backup codes in a safe place. Previous backup codes are no longer valid.',
    });
  } catch (error) {
    console.error('Regenerate backup codes error:', error);
    res.status(500).json({ error: 'Server error regenerating backup codes' });
  }
});

module.exports = router;
