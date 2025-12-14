const express = require('express');
const { handleEmailWebhook } = require('../controllers/webhookController');

const router = express.Router();

// Webhook endpoint for Resend email events
// This endpoint should be configured in your Resend dashboard
// URL: https://your-domain.com/api/webhook/email
router.post('/email', handleEmailWebhook);

module.exports = router;
