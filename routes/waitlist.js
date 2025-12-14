const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { contactLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Submit waitlist entry
router.post('/', contactLimiter, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').optional().trim(),
  body('groupType').optional().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: errors.array()[0].msg || 'Validation failed',
        errors: errors.array() 
      });
    }

    const { name, email, phone, groupType } = req.body;

    // Check if email already exists in waitlist
    const existingEntry = await pool.query(
      'SELECT id FROM waitlist WHERE email = $1',
      [email]
    );

    if (existingEntry.rows.length > 0) {
      return res.status(400).json({ 
        error: 'This email is already on the waitlist' 
      });
    }

    // Insert waitlist entry
    const result = await pool.query(
      `INSERT INTO waitlist (name, email, phone, group_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, group_type, created_at`,
      [name, email, phone || null, groupType || null]
    );

    res.status(201).json({
      message: 'Successfully joined the waitlist!',
      entry: result.rows[0],
    });
  } catch (error) {
    console.error('Waitlist submission error:', error);
    
    // Handle unique constraint violation
    if (error.code === '23505') {
      return res.status(400).json({ 
        error: 'This email is already on the waitlist' 
      });
    }
    
    res.status(500).json({ error: 'Server error submitting waitlist entry' });
  }
});

module.exports = router;
