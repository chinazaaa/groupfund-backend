const { Resend } = require('resend');
require('dotenv').config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
let resend = null;

if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
}

/**
 * Email received event structure from Resend webhook
 * @typedef {Object} EmailReceivedEvent
 * @property {string} type - Event type, should be 'email.received'
 * @property {string} created_at - Timestamp when the event was created
 * @property {Object} data - Email data
 * @property {string} data.email_id - Unique identifier for the email
 * @property {string} data.created_at - Timestamp when the email was created
 * @property {string} data.from - Sender email address
 * @property {string[]} data.to - Array of recipient email addresses
 * @property {string[]} data.bcc - Array of BCC email addresses
 * @property {string[]} data.cc - Array of CC email addresses
 * @property {string} data.message_id - Message ID
 * @property {string} data.subject - Email subject
 * @property {Array<Object>} [data.attachments] - Array of attachment objects
 * @property {string} data.attachments[].id - Attachment ID
 * @property {string} data.attachments[].filename - Attachment filename
 * @property {string} data.attachments[].content_type - Attachment MIME type
 * @property {string} data.attachments[].content_disposition - Content disposition
 * @property {string} [data.attachments[].content_id] - Content ID if inline
 */

class WebhookService {
  /**
   * Process email.received event from Resend webhook
   * This method handles incoming emails and can:
   * - Extract email body and attachments
   * - Process email content
   * - Store email data if needed
   * - Trigger business logic based on email content
   * 
   * @param {EmailReceivedEvent} event - The email received event from Resend
   * @returns {Promise<void>}
   */
  async processEmailReceived(event) {
    try {
      const { email_id, from, to, subject, attachments } = event.data;

      console.log(`Processing email received event for email_id: ${email_id}`);

      // If you need to fetch additional email details,
      // you can use the Resend API with the email_id
      // Note: The webhook event already contains most email metadata
      if (resend && email_id) {
        try {
          // Fetch additional email details if needed
          const emailResponse = await resend.emails.get(email_id);

          if (emailResponse.data) {
            console.log('Email details fetched:', {
              email_id,
              from,
              to,
              subject,
              attachmentsCount: attachments?.length || 0,
            });

            // Process attachments if available
            if (attachments && attachments.length > 0) {
              await this.processAttachments(attachments, email_id);
            }
          }
        } catch (error) {
          console.error(`Error fetching email details for ${email_id}:`, error.message);
          // Continue processing even if fetching fails
        }
      } else {
        // Process attachments from webhook event data
        if (attachments && attachments.length > 0) {
          await this.processAttachments(attachments, email_id);
        }
      }

      // Add your custom business logic here
      // For example:
      // - Store email in database
      // - Parse email content for specific actions
      // - Trigger notifications
      // - Process attachments
      // - Update user records based on email content

      console.log(`Successfully processed email received event for email_id: ${email_id}`);
    } catch (error) {
      console.error('Error processing email received event:', error);
      throw error;
    }
  }

  /**
   * Process email attachments
   * Override this method to implement custom attachment processing
   * 
   * @param {Array<Object>} attachments - Array of attachment objects
   * @param {string} emailId - The email ID
   * @returns {Promise<void>}
   */
  async processAttachments(attachments, emailId) {
    // Implement your attachment processing logic here
    // For example: download attachments, process images, etc.
    console.log(`Processing ${attachments.length} attachment(s) for email_id: ${emailId}`);
    
    attachments.forEach((attachment) => {
      console.log(`Attachment: ${attachment.filename} (${attachment.content_type})`);
    });
  }
}

module.exports = new WebhookService();
