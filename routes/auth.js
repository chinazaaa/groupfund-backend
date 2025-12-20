const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { generateOTP } = require('../utils/helpers');
const { sendOTPEmail } = require('../utils/email');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Signup
router.post('/signup', authLimiter, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user (birthday is optional and can be set later in profile)
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, birthday',
      [name, email, passwordHash]
    );

    const user = result.rows[0];

    // Generate and store OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      'INSERT INTO otps (user_id, phone, email, code, type, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [user.id, null, email, otp, 'signup', expiresAt]
    );

    // Send OTP via email
    await sendOTPEmail(email, otp, 'signup');

    res.status(201).json({
      message: 'User created successfully. Please verify OTP.',
      userId: user.id,
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

// Verify OTP
router.post('/verify-otp', otpLimiter, [
  body('userId').optional().notEmpty().withMessage('User ID must not be empty if provided'),
  body('email').optional().isEmail().withMessage('Valid email is required if provided'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('type').optional().isIn(['signup', 'forgot-password', 'login']),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId, email, otp, type = 'signup' } = req.body;

    // Validate that either userId or email is provided
    if (!userId && !email) {
      return res.status(400).json({ error: 'Either userId or email is required' });
    }

    let actualUserId;

    if (userId) {
      // Use provided userId
      const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      actualUserId = userId;
    } else {
      // Look up user by email
      const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      actualUserId = userResult.rows[0].id;
    }

    // Find valid OTP
    const otpResult = await pool.query(
      `SELECT * FROM otps 
       WHERE user_id = $1 AND code = $2 AND type = $3 AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [actualUserId, otp, type]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Mark OTP as used
    await pool.query('UPDATE otps SET is_used = TRUE WHERE id = $1', [otpResult.rows[0].id]);

    // If signup, mark user as verified and send welcome email
    if (type === 'signup') {
      await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [actualUserId]);
      // Note: Wallet will be created only when user adds payment details in their profile
      
      // Get user details for welcome email
      const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [actualUserId]);
      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        // Send welcome email (non-blocking - don't fail if email fails)
        const { sendWelcomeEmail } = require('../utils/email');
        sendWelcomeEmail(user.email, user.name).catch(err => {
          console.error('Error sending welcome email:', err);
          // Don't throw - email is non-critical
        });
      }
    }

    // Get user data for response
    const userResult = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [actualUserId]);
    const user = userResult.rows[0];

    res.json({ 
      message: 'OTP verified successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ error: 'Server error during OTP verification' });
  }
});

// Resend OTP
router.post('/resend-otp', otpLimiter, [
  body('userId').optional().notEmpty().withMessage('User ID must not be empty if provided'),
  body('email').optional().isEmail().withMessage('Valid email is required if provided'),
  body('type').optional().isIn(['signup', 'forgot-password', 'login']),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId, email, type = 'signup' } = req.body;

    // Validate that either userId or email is provided
    if (!userId && !email) {
      return res.status(400).json({ error: 'Either userId or email is required' });
    }

    let user;
    let userEmail;

    if (userId) {
      // Look up user by ID
      const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      user = userResult.rows[0];
      userEmail = user.email;
    } else {
      // Look up user by email
      const userResult = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      user = userResult.rows[0];
      userEmail = user.email;
    }

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      'INSERT INTO otps (user_id, phone, email, code, type, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [user.id, null, userEmail, otp, type, expiresAt]
    );

    await sendOTPEmail(userEmail, otp, type);

    res.json({ message: 'OTP resent successfully' });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Server error resending OTP' });
  }
});

// Login
router.post('/login', authLimiter, [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const userResult = await pool.query(
      'SELECT id, name, email, password_hash, is_verified, is_active FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if verified
    if (!user.is_verified) {
      return res.status(403).json({ 
        error: 'Please verify your email first',
        status: 403,
        userId: user.id,
        email: user.email
      });
    }

    // Check if account is active
    if (user.is_active === false) {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact support.' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '10000d' }
    );

    // Get wallet balance (wallet may not exist if user hasn't added payment details)
    const walletResult = await pool.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [user.id]
    );

    const wallet = walletResult.rows[0];
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        wallet: wallet ? { balance: wallet.balance || 0 } : { balance: 0 },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Forgot Password
router.post('/forgot-password', authLimiter, [
  body('email').isEmail().withMessage('Valid email is required'),
], async (req, res) => {
  try {
    const { email } = req.body;

    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      // Don't reveal if user exists
      return res.json({ message: 'If the email exists, an OTP has been sent' });
    }

    const user = userResult.rows[0];

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      'INSERT INTO otps (user_id, phone, email, code, type, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [user.id, null, email, otp, 'forgot-password', expiresAt]
    );

    await sendOTPEmail(email, otp, 'forgot-password');

    res.json({ message: 'If the email exists, an OTP has been sent', userId: user.id });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset Password
router.post('/reset-password', authLimiter, [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId, otp, newPassword } = req.body;

    // Verify OTP
    const otpResult = await pool.query(
      `SELECT * FROM otps 
       WHERE user_id = $1 AND code = $2 AND type = 'forgot-password' AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [userId, otp]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Mark OTP as used
    await pool.query('UPDATE otps SET is_used = TRUE WHERE id = $1', [otpResult.rows[0].id]);

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error resetting password' });
  }
});

// Change Password (authenticated)
router.post('/change-password', authLimiter, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], require('../middleware/auth').authenticate, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Get current password hash
    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error changing password' });
  }
});

module.exports = router;
