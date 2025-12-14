const { Resend } = require('resend');
require('dotenv').config();

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Send OTP email using Resend
const sendOTPEmail = async (email, otp, type = 'verification') => {
  try {
    const subject = type === 'forgot-password' 
      ? 'Password Reset OTP - GroupFund' 
      : 'Email Verification OTP - GroupFund';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <p style="color: #374151; font-size: 16px; margin-bottom: 20px;">Your OTP code is:</p>
          <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; border: 2px solid #6366f1;">
            <h1 style="color: #6366f1; font-size: 36px; letter-spacing: 8px; margin: 0; font-weight: bold;">${otp}</h1>
          </div>
          <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">This code will expire in 10 minutes.</p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            If you didn't request this, please ignore this email.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

// Send SMS OTP (placeholder - integrate with SMS service like Twilio)
const sendOTPSMS = async (phone, otp) => {
  // TODO: Integrate with SMS service
  console.log(`SMS OTP to ${phone}: ${otp}`);
  return true;
};

// Send contact form confirmation email
const sendContactConfirmationEmail = async (email, name, subject) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">Thank You for Contacting Us!</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            We've received your message regarding "<strong>${subject}</strong>" and we appreciate you taking the time to reach out to us.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Our team will review your message and get back to you within 24 hours. We're here to help!
          </p>
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              <strong>What's next?</strong><br>
              You'll receive a response from our support team at this email address within 24 hours.
            </p>
          </div>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong>The GroupFund Team</strong>
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated confirmation email. Please do not reply to this message.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: 'We\'ve Received Your Message - GroupFund',
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Contact confirmation email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending contact confirmation email:', error);
    return false;
  }
};

// Send welcome email after successful signup
const sendWelcomeEmail = async (email, name) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">Welcome to GroupFund, ${name}! 🎉</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-bottom: 20px;">
            We're thrilled to have you join our community! Your account has been successfully verified and you're all set to start managing birthday contributions with your groups.
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0; font-weight: 600;">Here's what you can do:</p>
            <ul style="color: #6b7280; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li>Create or join birthday groups</li>
              <li>Manage contributions and track payments</li>
              <li>Receive birthday reminders</li>
              <li>Send and receive birthday wishes</li>
            </ul>
          </div>

          <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #bae6fd;">
            <p style="color: #0369a1; font-size: 14px; margin: 0; font-weight: 600; margin-bottom: 8px;">💡 Getting Started:</p>
            <p style="color: #0c4a6e; font-size: 14px; margin: 0; line-height: 1.6;">
              Complete your profile by adding your payment details to start receiving contributions. You can also create a group or join one using an invite code!
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            If you have any questions or need help, feel free to reach out to us through the app or visit our <a href="https://groupfund.app/faq" style="color: #6366f1; text-decoration: none;">FAQ section</a>.
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br/>
            <strong>The GroupFund Team</strong>
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated email, please do not reply.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: 'Welcome to GroupFund! 🎉',
      html,
    });

    if (error) {
      console.error('Resend error sending welcome email:', error);
      return false;
    }

    console.log('Welcome email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    return false;
  }
};

// Send birthday email to celebrant
const sendBirthdayEmail = async (email, name) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); padding: 40px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 36px;">🎉🎂🎉</h1>
          <h1 style="color: white; margin: 10px 0 0 0; font-size: 32px;">Happy Birthday!</h1>
        </div>
        <div style="background: #f9fafb; padding: 40px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 28px; margin-top: 0; text-align: center;">Happy Birthday, ${name}! 🎈</h2>
          <p style="color: #374151; font-size: 18px; line-height: 1.7; margin-bottom: 20px; text-align: center;">
            Wishing you a day filled with joy, laughter, and all the happiness in the world! 🎊
          </p>
          
          <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 30px; border-radius: 12px; margin: 30px 0; text-align: center; border: 2px solid #fbbf24;">
            <p style="color: #78350f; font-size: 20px; margin: 0; font-weight: 600;">
              🎁 May your special day be as wonderful as you are! 🎁
            </p>
          </div>

          <div style="background: white; padding: 25px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0; font-weight: 600;">✨ On this special day:</p>
            <ul style="color: #6b7280; font-size: 15px; line-height: 2; margin: 0; padding-left: 20px;">
              <li>Celebrate with your loved ones</li>
              <li>Enjoy every moment</li>
              <li>Make beautiful memories</li>
              <li>Receive contributions from your group members</li>
            </ul>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px; text-align: center;">
            Your GroupFund family is celebrating with you today! 🎉
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px; text-align: center;">
            With warmest wishes,<br/>
            <strong style="color: #f59e0b;">The GroupFund Team</strong> 🎂
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
            This is an automated birthday email from GroupFund.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: `🎉 Happy Birthday, ${name}! 🎂`,
      html,
    });

    if (error) {
      console.error('Resend error sending birthday email:', error);
      return false;
    }

    console.log('Birthday email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending birthday email:', error);
    return false;
  }
};

module.exports = {
  sendOTPEmail,
  sendOTPSMS,
  sendContactConfirmationEmail,
  sendWelcomeEmail,
  sendBirthdayEmail,
};
