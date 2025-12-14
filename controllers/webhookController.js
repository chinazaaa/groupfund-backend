const webhookService = require('../services/webhookService');

/**
 * Handle Resend webhook events
 * This controller processes incoming webhook events from Resend
 * Currently supports: email.received
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const handleEmailWebhook = async (req, res) => {
  try {
    const event = req.body;

    // Verify the event type
    if (!event || !event.type) {
      return res.status(400).json({ 
        error: 'Invalid webhook event: missing type' 
      });
    }

    // Handle different event types
    switch (event.type) {
      case 'email.received':
        // Process the email received event
        await webhookService.processEmailReceived(event);
        break;

      // Add more event types as needed
      // case 'email.sent':
      // case 'email.delivered':
      // case 'email.bounced':
      // case 'email.complained':
      //   await webhookService.processEmailEvent(event);
      //   break;

      default:
        console.log(`Unhandled webhook event type: ${event.type}`);
        // Return 200 to acknowledge receipt even if we don't handle it
        return res.status(200).json({ 
          message: `Event type ${event.type} received but not processed` 
        });
    }

    // Return success response
    res.status(200).json({ 
      message: 'Webhook event processed successfully',
      eventType: event.type 
    });
  } catch (error) {
    console.error('Error handling webhook:', error);
    
    // Return 500 error but still acknowledge receipt to Resend
    // This prevents Resend from retrying
    res.status(500).json({ 
      error: 'Error processing webhook event',
      message: error.message 
    });
  }
};

module.exports = {
  handleEmailWebhook,
};
