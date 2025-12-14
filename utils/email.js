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
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 40px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 36px;">🎉🎂🎉</h1>
          <h1 style="color: white; margin: 10px 0 0 0; font-size: 32px;">Happy Birthday!</h1>
        </div>
        <div style="background: #f9fafb; padding: 40px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 28px; margin-top: 0; text-align: center;">Happy Birthday, ${name}! 🎈</h2>
          <p style="color: #374151; font-size: 18px; line-height: 1.7; margin-bottom: 20px; text-align: center;">
            Wishing you a day filled with joy, laughter, and all the happiness in the world! 🎊
          </p>
          
          <div style="background: linear-gradient(135deg, #e0e7ff 0%, #ddd6fe 100%); padding: 30px; border-radius: 12px; margin: 30px 0; text-align: center; border: 2px solid #6366f1;">
            <p style="color: #4338ca; font-size: 20px; margin: 0; font-weight: 600;">
              🎁 May your special day be as wonderful as you are! 🎁
            </p>
          </div>

          <div style="background: white; padding: 25px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
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
            <strong style="color: #6366f1;">The GroupFund Team</strong> 🎂
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

// Send birthday reminder email (7 days before, 1 day before, or same day)
const sendBirthdayReminderEmail = async (email, userName, memberName, daysUntil, contributionAmount, currency, groupName) => {
  try {
    let subject = '';
    let titleText = '';
    let messageText = '';
    let urgencyText = '';

    if (daysUntil === 7) {
      subject = `Birthday Reminder: ${memberName}'s birthday is in 7 days - GroupFund`;
      titleText = 'Birthday Reminder - 7 Days';
      messageText = `${memberName}'s birthday is in 7 days. Don't forget to prepare your contribution!`;
      urgencyText = 'You have 7 days to prepare your contribution.';
    } else if (daysUntil === 1) {
      subject = `Birthday Reminder: ${memberName}'s birthday is tomorrow! - GroupFund`;
      titleText = 'Birthday Reminder - Tomorrow!';
      messageText = `${memberName}'s birthday is tomorrow! Don't forget to mark your contribution as paid!`;
      urgencyText = 'Action needed: Please mark your contribution as paid today.';
    } else if (daysUntil === 0) {
      subject = `Action Required: ${memberName}'s birthday is today! - GroupFund`;
      titleText = 'Birthday Reminder - Today!';
      messageText = `Today is ${memberName}'s birthday! Please mark your contribution as paid.`;
      urgencyText = 'Action required: Please mark your contribution as paid now.';
    } else {
      // Fallback for any other day
      subject = `Birthday Reminder: ${memberName}'s birthday is in ${daysUntil} days - GroupFund`;
      titleText = `Birthday Reminder - ${daysUntil} Days`;
      messageText = `${memberName}'s birthday is in ${daysUntil} days.`;
      urgencyText = `You have ${daysUntil} days to prepare your contribution.`;
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">${titleText}</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${userName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            ${messageText}
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 10px 0; font-weight: 600;">📋 Contribution Details:</p>
            <p style="color: #6b7280; font-size: 14px; margin: 5px 0;">
              <strong>Group:</strong> ${groupName}
            </p>
            <p style="color: #6b7280; font-size: 14px; margin: 5px 0;">
              <strong>Amount:</strong> ${contributionAmount}
            </p>
            <p style="color: #6b7280; font-size: 14px; margin: 5px 0;">
              <strong>Celebrant:</strong> ${memberName}
            </p>
          </div>

          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600; text-align: center;">
              ⚠️ ${urgencyText}
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Log in to the GroupFund app to mark your contribution as paid and wish ${memberName} a happy birthday! 🎉
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br/>
            <strong style="color: #6366f1;">The GroupFund Team</strong>
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated reminder email from GroupFund. You can manage your notification preferences in the app settings.
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
      console.error('Resend error sending birthday reminder email:', error);
      return false;
    }

    console.log('Birthday reminder email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending birthday reminder email:', error);
    return false;
  }
};

// Send comprehensive birthday reminder email for all groups
// groupsWithBirthdays: array of { groupName, currency, birthdays: [{ name, hasPaid, contributionAmount, currency }] }
const sendComprehensiveBirthdayReminderEmail = async (email, userName, daysUntil, groupsWithBirthdays) => {
  try {
    const { formatAmount } = require('./currency');
    
    let subject = '';
    let titleText = '';
    let messageText = '';
    let urgencyText = '';

    // Calculate totals across all groups
    let totalUnpaid = 0;
    let totalBirthdays = 0;
    groupsWithBirthdays.forEach(group => {
      totalBirthdays += group.birthdays.length;
      totalUnpaid += group.birthdays.filter(b => !b.hasPaid).length;
    });

    if (daysUntil === 7) {
      subject = `Birthday Reminder: ${totalUnpaid} birthday${totalUnpaid > 1 ? 's' : ''} in 7 days - GroupFund`;
      titleText = 'Birthday Reminder - 7 Days';
      messageText = `You have ${totalUnpaid} unpaid birthday${totalUnpaid > 1 ? 's' : ''} in ${totalBirthdays} total birthday${totalBirthdays > 1 ? 's' : ''} coming up in 7 days across your groups.`;
      urgencyText = 'You have 7 days to prepare your contributions.';
    } else if (daysUntil === 1) {
      subject = `Birthday Reminder: ${totalUnpaid} birthday${totalUnpaid > 1 ? 's' : ''} tomorrow! - GroupFund`;
      titleText = 'Birthday Reminder - Tomorrow!';
      messageText = `You have ${totalUnpaid} unpaid birthday${totalUnpaid > 1 ? 's' : ''} in ${totalBirthdays} total birthday${totalBirthdays > 1 ? 's' : ''} tomorrow across your groups!`;
      urgencyText = 'Action needed: Please mark your contributions as paid today.';
    } else if (daysUntil === 0) {
      subject = `Action Required: ${totalUnpaid} birthday${totalUnpaid > 1 ? 's' : ''} today! - GroupFund`;
      titleText = 'Birthday Reminder - Today!';
      messageText = `You have ${totalUnpaid} unpaid birthday${totalUnpaid > 1 ? 's' : ''} in ${totalBirthdays} total birthday${totalBirthdays > 1 ? 's' : ''} today across your groups!`;
      urgencyText = 'Action required: Please pay and mark your contributions as paid now.';
    }

    // Build groups sections with their birthdays
    const groupsHtml = groupsWithBirthdays.map(group => {
      const groupUnpaid = group.birthdays.filter(b => !b.hasPaid).length;
      const groupTotal = group.birthdays.length;
      
      const birthdaysListHtml = group.birthdays.map(birthday => {
        const statusText = birthday.hasPaid ? '✅ Paid' : '❌ Not Paid';
        const statusColor = birthday.hasPaid ? '#10b981' : '#ef4444';
        return `
              <div style="background: ${birthday.hasPaid ? '#f0fdf4' : '#fef2f2'}; padding: 12px; border-radius: 8px; margin: 8px 0; border-left: 3px solid ${statusColor};">
                <p style="color: #374151; font-size: 15px; margin: 0; font-weight: 600;">
                  ${birthday.name} - ${formatAmount(birthday.contributionAmount, birthday.currency || group.currency)}
                </p>
                <p style="color: ${statusColor}; font-size: 13px; margin: 4px 0 0 0; font-weight: 600;">
                  ${statusText}
                </p>
              </div>
            `;
      }).join('');

      return `
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
              <p style="color: #374151; font-size: 18px; margin: 0 0 10px 0; font-weight: 700;">
                📋 ${group.groupName}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 15px 0;">
                ${groupUnpaid} of ${groupTotal} unpaid
              </p>
              ${birthdaysListHtml}
            </div>
          `;
    }).join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">${titleText}</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${userName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            ${messageText}
          </p>
          
          ${groupsHtml}

          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600; text-align: center;">
              ⚠️ ${urgencyText}
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Log in to the GroupFund app to mark your contributions as paid and wish them a happy birthday! 🎉
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br/>
            <strong style="color: #6366f1;">The GroupFund Team</strong>
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated reminder email from GroupFund. You can manage your notification preferences in the app settings.
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
      console.error('Resend error sending comprehensive birthday reminder email:', error);
      return false;
    }

    console.log('Comprehensive birthday reminder email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending comprehensive birthday reminder email:', error);
    return false;
  }
};

// Send monthly birthday newsletter email
// groupsWithBirthdays: array of { groupName, currency, contributionAmount, birthdays: [{ id, name, birthday }] }
const sendMonthlyBirthdayNewsletter = async (email, userName, userId, monthName, groupsWithBirthdays) => {
  try {
    const { formatAmount } = require('./currency');
    
    const subject = `Monthly Birthday Newsletter - ${monthName} - GroupFund`;
    const titleText = `Monthly Birthday Newsletter - ${monthName}`;
    
    // Calculate unique birthdays (deduplicate across groups)
    const uniqueBirthdayIds = new Set();
    groupsWithBirthdays.forEach(group => {
      group.birthdays.forEach(birthday => {
        uniqueBirthdayIds.add(birthday.id);
      });
    });
    const totalUniqueBirthdays = uniqueBirthdayIds.size;

    // Build groups sections with their birthdays
    const groupsHtml = groupsWithBirthdays.map(group => {
      const birthdaysListHtml = group.birthdays.map(birthday => {
        // Format birthday date (just day and month)
        const birthdayDate = new Date(birthday.birthday);
        const day = birthdayDate.getDate();
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthName = monthNames[birthdayDate.getMonth()];
        const formattedDate = `${monthName} ${day}`;
        
        // Check if this birthday is the current user
        const isCurrentUser = birthday.id === userId;
        const displayName = isCurrentUser ? `${birthday.name} (you)` : birthday.name;
        
        return `
              <div style="background: #f9fafb; padding: 12px; border-radius: 8px; margin: 8px 0; border-left: 3px solid #6366f1;">
                <p style="color: #374151; font-size: 15px; margin: 0; font-weight: 600;">
                  ${displayName} - ${formattedDate}
                </p>
              </div>
            `;
      }).join('');

      return `
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
              <p style="color: #374151; font-size: 18px; margin: 0 0 10px 0; font-weight: 700;">
                📋 ${group.groupName}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 15px 0;">
                <strong>Contribution:</strong> ${formatAmount(group.contributionAmount, group.currency)}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 15px 0; font-weight: 600;">
                ${group.birthdays.length} birthday${group.birthdays.length > 1 ? 's' : ''} this month:
              </p>
              ${birthdaysListHtml}
            </div>
          `;
    }).join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">${titleText}</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${userName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Here's your monthly birthday newsletter! You have ${totalUniqueBirthdays} birthday${totalUniqueBirthdays > 1 ? 's' : ''} coming up in ${monthName} across your groups.
          </p>
          
          ${groupsHtml}

          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600; text-align: center;">
              💡 Tip: Mark your contributions as paid in the app to stay organized!
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Log in to the GroupFund app to view all upcoming birthdays and manage your contributions! 🎉
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br/>
            <strong style="color: #6366f1;">The GroupFund Team</strong>
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is a monthly newsletter from GroupFund. You can manage your notification preferences in the app settings.
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
      console.error('Resend error sending monthly birthday newsletter:', error);
      return false;
    }

    console.log('Monthly birthday newsletter sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending monthly birthday newsletter:', error);
    return false;
  }
};

// Send waitlist confirmation email
const sendWaitlistConfirmationEmail = async (email, name) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">You're on the Waitlist! 🎉</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Thank you for joining the GroupFund waitlist! We're excited to have you on board and can't wait to share what we're building.
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0; font-weight: 600;">What happens next?</p>
            <ul style="color: #6b7280; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li>We'll notify you as soon as GroupFund is available in your area</li>
              <li>You'll be among the first to access new features and updates</li>
              <li>We'll keep you informed about our launch progress</li>
            </ul>
          </div>

          <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #bae6fd;">
            <p style="color: #0369a1; font-size: 14px; margin: 0; font-weight: 600; margin-bottom: 8px;">💡 About GroupFund:</p>
            <p style="color: #0c4a6e; font-size: 14px; margin: 0; line-height: 1.6;">
              GroupFund makes it easy to organize and manage birthday contributions with your groups. Create groups, track contributions, and never miss a birthday celebration!
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            We appreciate your interest and patience. Stay tuned for updates!
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br/>
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
      subject: 'Welcome to the GroupFund Waitlist! 🎉',
      html,
    });

    if (error) {
      console.error('Resend error sending waitlist confirmation email:', error);
      return false;
    }

    console.log('Waitlist confirmation email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending waitlist confirmation email:', error);
    return false;
  }
};

// Send overdue contribution reminder email
// overdueContributions: array of { groupName, currency, contributionAmount, birthdayUserName, birthdayDate }
const sendOverdueContributionEmail = async (email, userName, daysOverdue, overdueContributions) => {
  try {
    const { formatAmount } = require('./currency');
    
    let subject = '';
    let titleText = '';
    let messageText = '';
    let urgencyText = '';

    const totalOverdue = overdueContributions.length;

    if (daysOverdue === 3) {
      subject = `⚠️ Overdue Contribution: ${totalOverdue} payment${totalOverdue > 1 ? 's' : ''} 3 days overdue - GroupFund`;
      titleText = '⚠️ Overdue Contribution - 3 Days';
      messageText = `You have ${totalOverdue} contribution${totalOverdue > 1 ? 's' : ''} that ${totalOverdue > 1 ? 'are' : 'is'} 3 days overdue.`;
      urgencyText = 'Please send your contribution as soon as possible.';
    } else if (daysOverdue === 7) {
      subject = `⚠️ Overdue Contribution: ${totalOverdue} payment${totalOverdue > 1 ? 's' : ''} 7 days overdue - GroupFund`;
      titleText = '⚠️ Overdue Contribution - 7 Days';
      messageText = `You have ${totalOverdue} contribution${totalOverdue > 1 ? 's' : ''} that ${totalOverdue > 1 ? 'are' : 'is'} 7 days overdue.`;
      urgencyText = 'This is a reminder that your contribution is now 7 days overdue. Please pay immediately.';
    } else if (daysOverdue === 14) {
      subject = `🚨 Urgent: ${totalOverdue} payment${totalOverdue > 1 ? 's' : ''} 14 days overdue - GroupFund`;
      titleText = '🚨 Urgent - Overdue Contribution - 14 Days';
      messageText = `You have ${totalOverdue} contribution${totalOverdue > 1 ? 's' : ''} that ${totalOverdue > 1 ? 'are' : 'is'} 14 days overdue.`;
      urgencyText = 'This is a final reminder. Your contribution is significantly overdue. Please pay immediately.';
    }

    // Build contributions list
    const contributionsHtml = overdueContributions.map(contribution => {
      const birthdayDate = new Date(contribution.birthdayDate);
      const formattedDate = birthdayDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      
      return `
            <div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 12px 0; border-left: 4px solid #ef4444;">
              <p style="color: #374151; font-size: 16px; margin: 0 0 8px 0; font-weight: 600;">
                🎂 ${contribution.birthdayUserName}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 4px 0;">
                Birthday: ${formattedDate}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 4px 0;">
                Group: ${contribution.groupName}
              </p>
              <p style="color: #dc2626; font-size: 16px; margin: 8px 0 0 0; font-weight: 700;">
                Amount: ${formatAmount(contribution.contributionAmount, contribution.currency)}
              </p>
            </div>
          `;
    }).join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">⚠️ GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #dc2626; font-size: 24px; margin-top: 0;">${titleText}</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${userName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            ${messageText}
          </p>
          
          ${contributionsHtml}

          <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #ef4444;">
            <p style="color: #dc2626; font-size: 16px; margin: 0; font-weight: 700; text-align: center;">
              ⚠️ ${urgencyText}
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Please log in to the GroupFund app to mark your contributions as paid. Thank you for your prompt attention to this matter.
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br/>
            <strong style="color: #6366f1;">The GroupFund Team</strong>
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated reminder email from GroupFund. You can manage your notification preferences in the app settings.
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
      console.error('Resend error sending overdue contribution email:', error);
      return false;
    }

    console.log('Overdue contribution email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending overdue contribution email:', error);
    return false;
  }
};

module.exports = {
  sendOTPEmail,
  sendOTPSMS,
  sendContactConfirmationEmail,
  sendWelcomeEmail,
  sendBirthdayEmail,
  sendBirthdayReminderEmail,
  sendComprehensiveBirthdayReminderEmail,
  sendMonthlyBirthdayNewsletter,
  sendWaitlistConfirmationEmail,
  sendOverdueContributionEmail,
};
