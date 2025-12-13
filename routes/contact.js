const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { sendContactConfirmationEmail } = require('../utils/email');

const router = express.Router();

// Submit contact form
router.post('/submit', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('subject').trim().notEmpty().withMessage('Subject is required'),
  body('message').trim().notEmpty().withMessage('Message is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, subject, message } = req.body;

    const result = await pool.query(
      `INSERT INTO contact_submissions (name, email, subject, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, subject, message, created_at`,
      [name, email, subject, message]
    );

    // Send confirmation email (don't fail the request if email fails)
    try {
      await sendContactConfirmationEmail(email, name, subject);
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
      // Continue even if email fails
    }

    res.status(201).json({
      message: 'Thank you for your message! We\'ll get back to you soon.',
      submission: result.rows[0],
    });
  } catch (error) {
    console.error('Contact submission error:', error);
    res.status(500).json({ error: 'Server error submitting contact form' });
  }
});

module.exports = router;

