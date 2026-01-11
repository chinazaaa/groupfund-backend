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
            We're thrilled to have you join our community! Your account has been successfully verified and you're all set to start managing contributions with your groups.
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0; font-weight: 600;">Here's what you can do:</p>
            <ul style="color: #6b7280; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li><strong>Birthday Groups:</strong> Create or join groups to celebrate birthdays and manage contributions</li>
              <li><strong>Subscription Groups:</strong> Set up monthly or annual subscription groups (like Netflix, Spotify, etc.)</li>
              <li><strong>General Groups:</strong> Create groups for any occasion (weddings, baby showers, events, etc.)</li>
              <li>Manage contributions and track payments across all group types</li>
              <li>Receive reminders for upcoming deadlines</li>
              <li>Send and receive birthday wishes (for birthday groups)</li>
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

// Send comprehensive reminder email for all group types (birthday, subscription, general)
// groups: array of group objects with different structures based on type:
//   - birthday: { groupName, currency, birthdays: [{ name, hasPaid, contributionAmount, currency }] }
//   - subscription: { groupName, currency, subscriptionPlatform, subscriptionFrequency, contributionAmount, deadlineDate }
//   - general: { groupName, currency, contributionAmount, deadlineDate }
const sendComprehensiveReminderEmail = async (email, userName, daysUntil, groups) => {
  try {
    const { formatAmount } = require('./currency');
    
    // Separate groups by type
    const birthdayGroups = groups.filter(g => g.groupType === 'birthday');
    const subscriptionGroups = groups.filter(g => g.groupType === 'subscription');
    const generalGroups = groups.filter(g => g.groupType === 'general');
    
    // Calculate totals
    let totalUnpaid = 0;
    let totalItems = 0;
    let subject = '';
    let titleText = '';
    let messageText = '';
    let urgencyText = '';
    let actionText = '';
    
    // Count birthday items
    birthdayGroups.forEach(group => {
      totalItems += group.birthdays.length;
      totalUnpaid += group.birthdays.filter(b => !b.hasPaid).length;
    });
    
    // Count subscription items
    subscriptionGroups.forEach(() => {
      totalItems++;
      totalUnpaid++;
    });
    
    // Count general items
    generalGroups.forEach(() => {
      totalItems++;
      totalUnpaid++;
    });
    
    // Build subject and messages based on group types
    const hasOnlyBirthdays = birthdayGroups.length > 0 && subscriptionGroups.length === 0 && generalGroups.length === 0;
    const hasOnlySubscriptions = subscriptionGroups.length > 0 && birthdayGroups.length === 0 && generalGroups.length === 0;
    const hasOnlyGeneral = generalGroups.length > 0 && birthdayGroups.length === 0 && subscriptionGroups.length === 0;
    
    if (daysUntil === 7) {
      if (hasOnlyBirthdays) {
        subject = `Birthday Reminder: ${totalUnpaid} birthday${totalUnpaid > 1 ? 's' : ''} in 7 days - GroupFund`;
        titleText = 'Birthday Reminder - 7 Days';
        messageText = `You have ${totalUnpaid} unpaid birthday${totalUnpaid > 1 ? 's' : ''} in ${totalItems} total birthday${totalItems > 1 ? 's' : ''} coming up in 7 days across your groups.`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid and wish them a happy birthday! 🎉';
      } else if (hasOnlySubscriptions) {
        subject = `Subscription Reminder: ${totalUnpaid} subscription${totalUnpaid > 1 ? 's' : ''} due in 7 days - GroupFund`;
        titleText = 'Subscription Reminder - 7 Days';
        messageText = `You have ${totalUnpaid} upcoming subscription${totalUnpaid > 1 ? 's' : ''} due in 7 days.`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid!';
      } else if (hasOnlyGeneral) {
        subject = `Group Reminder: ${totalUnpaid} deadline${totalUnpaid > 1 ? 's' : ''} in 7 days - GroupFund`;
        titleText = 'Group Reminder - 7 Days';
        messageText = `You have ${totalUnpaid} upcoming deadline${totalUnpaid > 1 ? 's' : ''} in 7 days.`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid!';
      } else {
        subject = `Reminder: ${totalUnpaid} upcoming deadline${totalUnpaid > 1 ? 's' : ''} in 7 days - GroupFund`;
        titleText = 'Upcoming Deadlines Reminder - 7 Days';
        messageText = `You have ${totalUnpaid} upcoming deadline${totalUnpaid > 1 ? 's' : ''} in 7 days across your groups.`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid!';
      }
      urgencyText = 'You have 7 days to prepare your contributions.';
    } else if (daysUntil === 1) {
      if (hasOnlyBirthdays) {
        subject = `Birthday Reminder: ${totalUnpaid} birthday${totalUnpaid > 1 ? 's' : ''} tomorrow! - GroupFund`;
        titleText = 'Birthday Reminder - Tomorrow!';
        messageText = `You have ${totalUnpaid} unpaid birthday${totalUnpaid > 1 ? 's' : ''} in ${totalItems} total birthday${totalItems > 1 ? 's' : ''} tomorrow across your groups!`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid and wish them a happy birthday! 🎉';
      } else if (hasOnlySubscriptions) {
        subject = `Subscription Reminder: ${totalUnpaid} subscription${totalUnpaid > 1 ? 's' : ''} due tomorrow! - GroupFund`;
        titleText = 'Subscription Reminder - Tomorrow!';
        messageText = `You have ${totalUnpaid} subscription${totalUnpaid > 1 ? 's' : ''} due tomorrow!`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid!';
      } else if (hasOnlyGeneral) {
        subject = `Group Reminder: ${totalUnpaid} deadline${totalUnpaid > 1 ? 's' : ''} tomorrow! - GroupFund`;
        titleText = 'Group Reminder - Tomorrow!';
        messageText = `You have ${totalUnpaid} deadline${totalUnpaid > 1 ? 's' : ''} tomorrow!`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid!';
      } else {
        subject = `Reminder: ${totalUnpaid} deadline${totalUnpaid > 1 ? 's' : ''} tomorrow! - GroupFund`;
        titleText = 'Upcoming Deadlines Reminder - Tomorrow!';
        messageText = `You have ${totalUnpaid} deadline${totalUnpaid > 1 ? 's' : ''} tomorrow across your groups!`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid!';
      }
      urgencyText = 'Action needed: Please mark your contributions as paid today.';
    } else if (daysUntil === 0) {
      if (hasOnlyBirthdays) {
        subject = `Action Required: ${totalUnpaid} birthday${totalUnpaid > 1 ? 's' : ''} today! - GroupFund`;
        titleText = 'Birthday Reminder - Today!';
        messageText = `You have ${totalUnpaid} unpaid birthday${totalUnpaid > 1 ? 's' : ''} in ${totalItems} total birthday${totalItems > 1 ? 's' : ''} today across your groups!`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid and wish them a happy birthday! 🎉';
      } else if (hasOnlySubscriptions) {
        subject = `Action Required: ${totalUnpaid} subscription${totalUnpaid > 1 ? 's' : ''} due today! - GroupFund`;
        titleText = 'Subscription Reminder - Today!';
        messageText = `You have ${totalUnpaid} subscription${totalUnpaid > 1 ? 's' : ''} due today!`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid!';
      } else if (hasOnlyGeneral) {
        subject = `Action Required: ${totalUnpaid} deadline${totalUnpaid > 1 ? 's' : ''} today! - GroupFund`;
        titleText = 'Group Reminder - Today!';
        messageText = `You have ${totalUnpaid} deadline${totalUnpaid > 1 ? 's' : ''} today!`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid!';
      } else {
        subject = `Action Required: ${totalUnpaid} deadline${totalUnpaid > 1 ? 's' : ''} today! - GroupFund`;
        titleText = 'Upcoming Deadlines - Today!';
        messageText = `You have ${totalUnpaid} deadline${totalUnpaid > 1 ? 's' : ''} today across your groups!`;
        actionText = 'Log in to the GroupFund app to mark your contributions as paid!';
      }
      urgencyText = 'Action required: Please pay and mark your contributions as paid now.';
    }
    
    // Build groups HTML sections
    const groupsHtml = [];
    
    // Birthday groups
    birthdayGroups.forEach(group => {
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
      
      groupsHtml.push(`
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
              <p style="color: #374151; font-size: 18px; margin: 0 0 10px 0; font-weight: 700;">
                🎂 ${group.groupName}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 15px 0;">
                ${groupUnpaid} of ${groupTotal} unpaid
              </p>
              ${birthdaysListHtml}
            </div>
          `);
    });
    
    // Subscription groups
    subscriptionGroups.forEach(group => {
      const deadlineText = new Date(group.deadlineDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      groupsHtml.push(`
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #8b5cf6;">
              <p style="color: #374151; font-size: 18px; margin: 0 0 10px 0; font-weight: 700;">
                📺 ${group.groupName} - ${group.subscriptionPlatform}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">
                ${group.subscriptionFrequency === 'monthly' ? 'Monthly' : 'Annual'} subscription
              </p>
              <div style="background: #fef2f2; padding: 12px; border-radius: 8px; margin: 8px 0; border-left: 3px solid #ef4444;">
                <p style="color: #374151; font-size: 15px; margin: 0; font-weight: 600;">
                  Amount: ${formatAmount(group.contributionAmount, group.currency)}
                </p>
                <p style="color: #6b7280; font-size: 13px; margin: 4px 0 0 0;">
                  Deadline: ${deadlineText}
                </p>
                <p style="color: #ef4444; font-size: 13px; margin: 4px 0 0 0; font-weight: 600;">
                  ❌ Not Paid
                </p>
              </div>
            </div>
          `);
    });
    
    // General groups
    generalGroups.forEach(group => {
      const deadlineText = new Date(group.deadlineDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      groupsHtml.push(`
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
              <p style="color: #374151; font-size: 18px; margin: 0 0 10px 0; font-weight: 700;">
                📋 ${group.groupName}
              </p>
              <div style="background: #fef2f2; padding: 12px; border-radius: 8px; margin: 8px 0; border-left: 3px solid #ef4444;">
                <p style="color: #374151; font-size: 15px; margin: 0; font-weight: 600;">
                  Amount: ${formatAmount(group.contributionAmount, group.currency)}
                </p>
                <p style="color: #6b7280; font-size: 13px; margin: 4px 0 0 0;">
                  Deadline: ${deadlineText}
                </p>
                <p style="color: #ef4444; font-size: 13px; margin: 4px 0 0 0; font-weight: 600;">
                  ❌ Not Paid
                </p>
              </div>
            </div>
          `);
    });
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">${hasOnlyBirthdays ? '🎂' : '📅'} GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">${titleText}</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${userName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            ${messageText}
          </p>
          
          ${groupsHtml.join('')}

          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600; text-align: center;">
              ⚠️ ${urgencyText}
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            ${actionText}
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
      console.error('Resend error sending comprehensive reminder email:', error);
      return false;
    }

    console.log('Comprehensive reminder email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending comprehensive reminder email:', error);
    return false;
  }
};

// Send monthly newsletter email for all group types
// groupsWithBirthdays: array of { groupName, currency, contributionAmount, birthdays: [{ id, name, birthday }] }
// subscriptionGroups: array of { groupName, currency, contributionAmount, subscriptionPlatform, subscriptionFrequency, deadlineDay }
// generalGroups: array of { groupName, currency, contributionAmount, deadline }
const sendMonthlyNewsletter = async (email, userName, userId, monthName, groupsWithBirthdays = [], subscriptionGroups = [], generalGroups = []) => {
  try {
    const { formatAmount } = require('./currency');
    
    // Determine newsletter type and build subject/title
    const hasBirthdays = groupsWithBirthdays.length > 0;
    const hasSubscriptions = subscriptionGroups.length > 0;
    const hasGeneral = generalGroups.length > 0;
    const totalItems = groupsWithBirthdays.reduce((sum, g) => sum + g.birthdays.length, 0) + 
                      subscriptionGroups.length + generalGroups.length;
    
    let subject = '';
    let titleText = '';
    let introText = '';
    
    if (hasBirthdays && !hasSubscriptions && !hasGeneral) {
      // Only birthdays
      const uniqueBirthdayIds = new Set();
      groupsWithBirthdays.forEach(group => {
        group.birthdays.forEach(birthday => {
          uniqueBirthdayIds.add(birthday.id);
        });
      });
      const totalUniqueBirthdays = uniqueBirthdayIds.size;
      subject = `Monthly Birthday Newsletter - ${monthName} - GroupFund`;
      titleText = `Monthly Birthday Newsletter - ${monthName}`;
      introText = `Here's your monthly birthday newsletter! You have ${totalUniqueBirthdays} birthday${totalUniqueBirthdays > 1 ? 's' : ''} coming up in ${monthName} across your groups.`;
    } else {
      // Mixed or other types
      subject = `Monthly Newsletter - ${monthName} - GroupFund`;
      titleText = `Monthly Newsletter - ${monthName}`;
      introText = `Here's your monthly summary for ${monthName}! You have ${totalItems} upcoming item${totalItems > 1 ? 's' : ''} this month across your groups.`;
    }

    // Build groups sections
    const groupsHtml = [];
    
    // Birthday groups
    groupsWithBirthdays.forEach(group => {
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

      const birthdayGroupHtml = `
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
      groupsHtml.push(birthdayGroupHtml);
    });
    
    // Subscription groups
    subscriptionGroups.forEach(group => {
      const deadlineText = `${monthName} ${group.deadlineDay}`;
      const subscriptionGroupHtml = `
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #8b5cf6;">
              <p style="color: #374151; font-size: 18px; margin: 0 0 10px 0; font-weight: 700;">
                📺 ${group.groupName} - ${group.subscriptionPlatform}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">
                <strong>Contribution:</strong> ${formatAmount(group.contributionAmount, group.currency)}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">
                <strong>Frequency:</strong> ${group.subscriptionFrequency === 'monthly' ? 'Monthly' : 'Annual'}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                <strong>Deadline:</strong> ${deadlineText}
              </p>
            </div>
          `;
      groupsHtml.push(subscriptionGroupHtml);
    });
    
    // General groups
    generalGroups.forEach(group => {
      const deadlineDate = new Date(group.deadline);
      const deadlineText = deadlineDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const generalGroupHtml = `
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
              <p style="color: #374151; font-size: 18px; margin: 0 0 10px 0; font-weight: 700;">
                📋 ${group.groupName}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">
                <strong>Contribution:</strong> ${formatAmount(group.contributionAmount, group.currency)}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                <strong>Deadline:</strong> ${deadlineText}
              </p>
            </div>
          `;
      groupsHtml.push(generalGroupHtml);
    });
    
    const groupsHtmlContent = groupsHtml.join('');

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
            ${introText}
          </p>
          
          ${groupsHtmlContent}

          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600; text-align: center;">
              💡 Tip: Mark your contributions as paid in the app to stay organized!
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Log in to the GroupFund app to view all upcoming deadlines and manage your contributions! 🎉
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
      console.error('Resend error sending monthly newsletter:', error);
      return false;
    }

    console.log('Monthly newsletter sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending monthly newsletter:', error);
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
          
          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #374151; font-size: 16px; line-height: 1.7; margin: 0 0 15px 0;">
              Or use the website to signup:
            </p>
            <a href="https://www.groupfund.app/" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
              Visit GroupFund.app
            </a>
          </div>
          
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

// Send beta invitation email to waitlist members
const sendBetaInvitationEmail = async (email, firstName) => {
  try {
    // Extract first name from full name
    const name = firstName.split(' ')[0];
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">You're invited to beta test GroupFund 🎉</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Thanks for joining the GroupFund waitlist, you're one of the first people getting access.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            GroupFund helps you organise birthday contributions with friends, family, church, and office groups without chasing people or losing track of who has paid. Now we're opening our early beta and would love you to test it.
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0; font-weight: 600;">How to join the beta</p>
            
            <div style="margin: 20px 0;">
              <p style="color: #374151; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">If you use Android</p>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 5px 0;">
                <a href="https://play.google.com/store/apps/details?id=com.groupfund.app" style="color: #6366f1; text-decoration: none; font-weight: 600; font-size: 15px;">👉 Click here to install from Google Play</a>
              </p>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 10px 0 0 0;">
                Install the beta version of GroupFund from Google Play.
              </p>
            </div>
            
            <div style="margin: 20px 0; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #374151; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">If you use iPhone (iOS)</p>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 5px 0;">
                <a href="https://testflight.apple.com/join/9Wa3Qr9m" style="color: #6366f1; text-decoration: none; font-weight: 600; font-size: 15px;">👉 Click here to join TestFlight</a>
              </p>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 10px 0 0 0;">
                Install the TestFlight app if asked, then tap Start Testing to install GroupFund.
              </p>
            </div>
              <div style="margin: 20px 0; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #374151; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">If you want to use Web App</p>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 5px 0;">
                <a href="https://groupfund.app" style="color: #6366f1; text-decoration: none; font-weight: 600; font-size: 15px;">👉 Click here to get started</a>
              </p>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 10px 0 0 0;">
                Click Signup, then get started with GroupFund.
              </p>
            </div>
          </div>

          <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #bae6fd;">
            <p style="color: #374151; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Once you're in</p>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
              Please create a test birthday group (or your real one) and try inviting a few friends or family members so you can see how it works in a real scenario.
            </p>
          </div>

          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0; font-weight: 600;">Join the Discord community</p>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 5px 0;">
              We've set up a Discord for quick updates, feedback, and bug reports:
            </p>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 5px 0;">
              <a href="https://discord.gg/8sANRQTyT" style="color: #6366f1; text-decoration: none; font-weight: 600; font-size: 15px;">👉 Click here to join our Discord community</a>
            </p>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 15px 0 0 0;">
              Inside the server you'll see:
            </p>
            <ul style="color: #6b7280; font-size: 14px; line-height: 1.8; margin: 10px 0; padding-left: 20px;">
              <li><strong>#general-chat</strong> – general discussion and community</li>
              <li><strong>#product-updates</strong> – what's new in the app</li>
              <li><strong>#bug-reports</strong> – anything that's broken or confusing</li>
              <li><strong>#feature-requests</strong> – ideas you'd love to see in GroupFund</li>
            </ul>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 15px 0 0 0;">
              Your feedback now will shape how GroupFund works for thousands of groups later, so nothing is "too small" to share.
            </p>
          </div>

          <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #86efac;">
            <p style="color: #374151; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Know someone who'd love GroupFund?</p>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
              If you know anyone that's interested, tell them to join the waitlist via <a href="https://www.groupfund.app/waitlist" style="color: #6366f1; text-decoration: none; font-weight: 600;">https://www.groupfund.app/waitlist</a>
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Thank you again for being early.
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 20px;">
            Best regards,<br/>
            <strong>Chinaza Obiekwe</strong><br/>
            Founder, GroupFund
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated email. Please do not reply to this message.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: 'You\'re invited to beta test GroupFund 🎉',
      html,
    });

    if (error) {
      console.error('Resend error sending beta invitation email:', error);
      return false;
    }

    console.log('Beta invitation email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending beta invitation email:', error);
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

    if (daysOverdue === 1) {
      subject = `Reminder: ${totalOverdue} contribution${totalOverdue > 1 ? 's' : ''} 1 day overdue - GroupFund`;
      titleText = 'Reminder: Overdue Contribution - 1 Day';
      messageText = `You have ${totalOverdue} contribution${totalOverdue > 1 ? 's' : ''} that ${totalOverdue > 1 ? 'are' : 'is'} 1 day overdue.`;
      urgencyText = 'This is a friendly reminder to send your contribution.';
    } else if (daysOverdue === 3) {
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
      const deadlineDate = new Date(contribution.deadlineDate);
      const formattedDate = deadlineDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      
      let eventTitle = '';
      let eventDetails = '';
      
      if (contribution.groupType === 'birthday') {
        eventTitle = `🎂 ${contribution.eventName}`;
        eventDetails = `Birthday: ${formattedDate}`;
      } else if (contribution.groupType === 'subscription') {
        eventTitle = `📺 ${contribution.eventName}`;
        eventDetails = `Subscription: ${contribution.subscriptionPlatform} (${contribution.subscriptionFrequency === 'monthly' ? 'Monthly' : 'Annual'}) - Deadline: ${formattedDate}`;
      } else if (contribution.groupType === 'general') {
        eventTitle = `📋 ${contribution.eventName}`;
        eventDetails = `Deadline: ${formattedDate}`;
      } else {
        // Fallback for backward compatibility
        eventTitle = `🎂 ${contribution.birthdayUserName || contribution.eventName}`;
        eventDetails = `Deadline: ${formattedDate}`;
      }
      
      return `
            <div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 12px 0; border-left: 4px solid #ef4444;">
              <p style="color: #374151; font-size: 16px; margin: 0 0 8px 0; font-weight: 600;">
                ${eventTitle}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 4px 0;">
                ${eventDetails}
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

// Send email to group admin about overdue contributions from members
// overdueMembers: array of { memberName, memberEmail, contributionAmount, currency, eventName, deadlineDate, daysOverdue, groupType, subscriptionPlatform, subscriptionFrequency }
const sendAdminOverdueNotificationEmail = async (adminEmail, adminName, groupName, groupType, daysOverdue, overdueMembers) => {
  try {
    const { formatAmount } = require('./currency');
    
    let subject = '';
    let titleText = '';
    let messageText = '';
    let urgencyText = '';

    const totalOverdue = overdueMembers.length;

    if (daysOverdue === 1) {
      subject = `Reminder: ${totalOverdue} member${totalOverdue > 1 ? 's' : ''} with overdue contributions in ${groupName} - GroupFund`;
      titleText = 'Reminder: Overdue Contributions - 1 Day';
      messageText = `${totalOverdue} member${totalOverdue > 1 ? 's have' : ' has'} contribution${totalOverdue > 1 ? 's' : ''} that ${totalOverdue > 1 ? 'are' : 'is'} 1 day overdue in your group "${groupName}".`;
      urgencyText = 'This is a friendly reminder to follow up with these members.';
    } else if (daysOverdue === 3) {
      subject = `⚠️ ${totalOverdue} member${totalOverdue > 1 ? 's' : ''} with overdue contributions in ${groupName} - GroupFund`;
      titleText = '⚠️ Overdue Contributions - 3 Days';
      messageText = `${totalOverdue} member${totalOverdue > 1 ? 's have' : ' has'} contribution${totalOverdue > 1 ? 's' : ''} that ${totalOverdue > 1 ? 'are' : 'is'} 3 days overdue in your group "${groupName}".`;
      urgencyText = 'Please follow up with these members as soon as possible.';
    } else if (daysOverdue === 7) {
      subject = `⚠️ ${totalOverdue} member${totalOverdue > 1 ? 's' : ''} with overdue contributions in ${groupName} - GroupFund`;
      titleText = '⚠️ Overdue Contributions - 7 Days';
      messageText = `${totalOverdue} member${totalOverdue > 1 ? 's have' : ' has'} contribution${totalOverdue > 1 ? 's' : ''} that ${totalOverdue > 1 ? 'are' : 'is'} 7 days overdue in your group "${groupName}".`;
      urgencyText = 'This is a reminder that contributions are now 7 days overdue. Please follow up immediately.';
    } else if (daysOverdue === 14) {
      subject = `🚨 Urgent: ${totalOverdue} member${totalOverdue > 1 ? 's' : ''} with overdue contributions in ${groupName} - GroupFund`;
      titleText = '🚨 Urgent - Overdue Contributions - 14 Days';
      messageText = `${totalOverdue} member${totalOverdue > 1 ? 's have' : ' has'} contribution${totalOverdue > 1 ? 's' : ''} that ${totalOverdue > 1 ? 'are' : 'is'} 14 days overdue in your group "${groupName}".`;
      urgencyText = 'This is a final reminder. Contributions are significantly overdue. Please follow up immediately.';
    }

    // Build members list
    const membersHtml = overdueMembers.map(member => {
      const deadlineDate = new Date(member.deadlineDate);
      const formattedDate = deadlineDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      
      let eventTitle = '';
      let eventDetails = '';
      
      if (groupType === 'subscription') {
        eventTitle = `📺 ${member.eventName}`;
        eventDetails = `Subscription: ${member.subscriptionPlatform} (${member.subscriptionFrequency === 'monthly' ? 'Monthly' : 'Annual'}) - Deadline: ${formattedDate}`;
      } else if (groupType === 'general') {
        eventTitle = `📋 ${member.eventName}`;
        eventDetails = `Deadline: ${formattedDate}`;
      } else {
        eventTitle = `🎂 ${member.eventName}`;
        eventDetails = `Deadline: ${formattedDate}`;
      }
      
      // Highlight if this member is the admin
      const memberLabel = member.isAdmin 
        ? `<strong style="color: #dc2626;">${member.memberName} (You - Group Admin)</strong>`
        : member.memberName;
      
      return `
            <div style="background: ${member.isAdmin ? '#fff7ed' : '#fef2f2'}; padding: 15px; border-radius: 8px; margin: 12px 0; border-left: 4px solid ${member.isAdmin ? '#f59e0b' : '#ef4444'};">
              <p style="color: #374151; font-size: 16px; margin: 0 0 8px 0; font-weight: 600;">
                ${eventTitle}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 4px 0;">
                ${eventDetails}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 4px 0;">
                Member: ${memberLabel}${member.memberEmail ? ` (${member.memberEmail})` : ''}
              </p>
              <p style="color: #dc2626; font-size: 16px; margin: 8px 0 0 0; font-weight: 700;">
                Amount: ${formatAmount(member.contributionAmount, member.currency)}
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
            Hi ${adminName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            ${messageText}
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 18px; margin: 0 0 10px 0; font-weight: 700;">
              📋 Group: ${groupName}
            </p>
          </div>

          ${membersHtml}

          <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #ef4444;">
            <p style="color: #dc2626; font-size: 16px; margin: 0; font-weight: 700; text-align: center;">
              ⚠️ ${urgencyText}
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Please log in to the GroupFund app to view the full details and follow up with these members. Thank you for managing your group effectively.
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br/>
            <strong style="color: #6366f1;">The GroupFund Team</strong>
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated notification email from GroupFund. You can manage your notification preferences in the app settings.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: adminEmail,
      subject,
      html,
    });

    if (error) {
      console.error('Resend error sending admin overdue notification email:', error);
      return false;
    }

    console.log('Admin overdue notification email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending admin overdue notification email:', error);
    return false;
  }
};

// Send email to group admin about upcoming deadlines for members
// upcomingMembers: array of { memberName, memberEmail, contributionAmount, currency, eventName, deadlineDate, daysUntil, groupType, subscriptionPlatform, subscriptionFrequency, isAdmin }
const sendAdminUpcomingDeadlineEmail = async (adminEmail, adminName, groupName, groupType, daysUntil, upcomingMembers) => {
  try {
    const { formatAmount } = require('./currency');
    
    let subject = '';
    let titleText = '';
    let messageText = '';
    let urgencyText = '';

    const totalUpcoming = upcomingMembers.length;

    if (daysUntil === 7) {
      subject = `Reminder: ${totalUpcoming} member${totalUpcoming > 1 ? 's' : ''} with upcoming deadlines in ${groupName} - GroupFund`;
      titleText = 'Upcoming Deadline Reminder - 7 Days';
      messageText = `${totalUpcoming} member${totalUpcoming > 1 ? 's have' : ' has'} upcoming deadline${totalUpcoming > 1 ? 's' : ''} in 7 days in your group "${groupName}".`;
      urgencyText = 'Members have 7 days to prepare their contributions.';
    } else if (daysUntil === 1) {
      subject = `Reminder: ${totalUpcoming} member${totalUpcoming > 1 ? 's' : ''} with deadlines tomorrow in ${groupName} - GroupFund`;
      titleText = 'Upcoming Deadline Reminder - Tomorrow';
      messageText = `${totalUpcoming} member${totalUpcoming > 1 ? 's have' : ' has'} upcoming deadline${totalUpcoming > 1 ? 's' : ''} tomorrow in your group "${groupName}".`;
      urgencyText = 'Action needed: Please remind members to mark their contributions as paid today.';
    } else if (daysUntil === 0) {
      subject = `Action Required: ${totalUpcoming} member${totalUpcoming > 1 ? 's' : ''} with deadlines today in ${groupName} - GroupFund`;
      titleText = 'Upcoming Deadline Reminder - Today';
      messageText = `${totalUpcoming} member${totalUpcoming > 1 ? 's have' : ' has'} upcoming deadline${totalUpcoming > 1 ? 's' : ''} today in your group "${groupName}".`;
      urgencyText = 'Action required: Please remind members to mark their contributions as paid now.';
    }

    // Build members list
    const membersHtml = upcomingMembers.map(member => {
      const deadlineDate = new Date(member.deadlineDate);
      const formattedDate = deadlineDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      
      let eventTitle = '';
      let eventDetails = '';
      
      if (groupType === 'subscription') {
        eventTitle = `📺 ${member.eventName}`;
        eventDetails = `Subscription: ${member.subscriptionPlatform} (${member.subscriptionFrequency === 'monthly' ? 'Monthly' : 'Annual'}) - Deadline: ${formattedDate}`;
      } else if (groupType === 'general') {
        eventTitle = `📋 ${member.eventName}`;
        eventDetails = `Deadline: ${formattedDate}`;
      } else {
        eventTitle = `🎂 ${member.eventName}`;
        eventDetails = `Deadline: ${formattedDate}`;
      }
      
      // Highlight if this member is the admin
      const memberLabel = member.isAdmin 
        ? `<strong style="color: #f59e0b;">${member.memberName} (You - Group Admin)</strong>`
        : member.memberName;
      
      return `
            <div style="background: ${member.isAdmin ? '#fffbeb' : '#f0f9ff'}; padding: 15px; border-radius: 8px; margin: 12px 0; border-left: 4px solid ${member.isAdmin ? '#f59e0b' : '#3b82f6'};">
              <p style="color: #374151; font-size: 16px; margin: 0 0 8px 0; font-weight: 600;">
                ${eventTitle}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 4px 0;">
                ${eventDetails}
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 4px 0;">
                Member: ${memberLabel}${member.memberEmail ? ` (${member.memberEmail})` : ''}
              </p>
              <p style="color: #1e40af; font-size: 16px; margin: 8px 0 0 0; font-weight: 700;">
                Amount: ${formatAmount(member.contributionAmount, member.currency)}
              </p>
            </div>
          `;
    }).join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">📅 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1e40af; font-size: 24px; margin-top: 0;">${titleText}</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${adminName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            ${messageText}
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6;">
            <p style="color: #374151; font-size: 18px; margin: 0 0 10px 0; font-weight: 700;">
              📋 Group: ${groupName}
            </p>
          </div>

          ${membersHtml}

          <div style="background: #dbeafe; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #3b82f6;">
            <p style="color: #1e40af; font-size: 16px; margin: 0; font-weight: 700; text-align: center;">
              ⚠️ ${urgencyText}
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Please log in to the GroupFund app to view the full details and remind members about their upcoming deadlines. Thank you for managing your group effectively.
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br/>
            <strong style="color: #3b82f6;">The GroupFund Team</strong>
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated notification email from GroupFund. You can manage your notification preferences in the app settings.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: adminEmail,
      subject,
      html,
    });

    if (error) {
      console.error('Resend error sending admin upcoming deadline email:', error);
      return false;
    }

    console.log('Admin upcoming deadline email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending admin upcoming deadline email:', error);
    return false;
  }
};

// Send email notification when group admin updates contribution amount
const sendContributionAmountUpdateEmail = async (email, memberName, groupName, oldAmount, newAmount, currency, adminName) => {
  try {
    const { formatAmount } = require('./currency');
    
    const subject = `Contribution Amount Updated - ${groupName}`;
    const oldAmountFormatted = formatAmount(oldAmount, currency);
    const newAmountFormatted = formatAmount(newAmount, currency);
    const isIncrease = newAmount > oldAmount;
    const changeType = isIncrease ? 'increased' : 'decreased';
    const changeEmoji = isIncrease ? '📈' : '📉';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">${changeEmoji} GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1e40af; font-size: 24px; margin-top: 0;">
            Contribution Amount Updated
          </h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${memberName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            The group admin <strong>${adminName}</strong> has ${changeType} the contribution amount for the group <strong>"${groupName}"</strong>.
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
              <span style="color: #6b7280; font-size: 14px;">Previous Amount:</span>
              <span style="color: #374151; font-size: 18px; font-weight: 600;">${oldAmountFormatted}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #6b7280; font-size: 14px;">New Amount:</span>
              <span style="color: ${isIncrease ? '#dc2626' : '#059669'}; font-size: 20px; font-weight: 700;">${newAmountFormatted}</span>
            </div>
          </div>

          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600;">
              ⚠️ Important: Please Review
            </p>
            <p style="color: #4338ca; font-size: 14px; margin: 10px 0 0 0; line-height: 1.6;">
              Please check if you're still okay with this new contribution amount. If this change doesn't work for you, you can leave the group at any time.
            </p>
          </div>

          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
            <p style="color: #374151; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">
              What you can do:
            </p>
            <ul style="color: #6b7280; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>Review the new contribution amount in the app</li>
              <li>Continue participating if you're comfortable with the change</li>
              <li>Leave the group if this doesn't work for you</li>
            </ul>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            If you have any questions or concerns, please reach out to the group admin or contact our support team.
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong style="color: #6366f1;">The GroupFund Team</strong>
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated notification. Please do not reply to this email.
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
      console.error('Resend error sending contribution amount update email:', error);
      return false;
    }

    console.log('Contribution amount update email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending contribution amount update email:', error);
    return false;
  }
};

// Send email notification when group admin updates deadline
const sendDeadlineUpdateEmail = async (email, memberName, groupName, groupType, oldDeadline, newDeadline, subscriptionFrequency, adminName) => {
  try {
    const subject = `Deadline Updated - ${groupName}`;
    
    let oldDeadlineFormatted = '';
    let newDeadlineFormatted = '';
    let deadlineDescription = '';

    if (groupType === 'general') {
      // Format dates for general groups
      const oldDate = oldDeadline ? new Date(oldDeadline) : null;
      const newDate = new Date(newDeadline);
      
      oldDeadlineFormatted = oldDate ? oldDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not set';
      newDeadlineFormatted = newDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      deadlineDescription = 'Group Deadline';
    } else if (groupType === 'subscription') {
      // Format subscription deadlines
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      
      const oldDay = oldDeadline.day;
      const oldMonth = oldDeadline.month;
      const newDay = newDeadline.day;
      const newMonth = newDeadline.month;
      
      if (subscriptionFrequency === 'monthly') {
        oldDeadlineFormatted = oldDay ? `Day ${oldDay} of each month` : 'Not set';
        newDeadlineFormatted = `Day ${newDay} of each month`;
        deadlineDescription = 'Monthly Subscription Deadline';
      } else {
        oldDeadlineFormatted = oldDay && oldMonth ? `${monthNames[oldMonth - 1]} ${oldDay}` : 'Not set';
        newDeadlineFormatted = `${monthNames[newMonth - 1]} ${newDay}`;
        deadlineDescription = 'Annual Subscription Deadline';
      }
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">📅 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1e40af; font-size: 24px; margin-top: 0;">
            Deadline Updated
          </h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${memberName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            The group admin <strong>${adminName}</strong> has updated the deadline for the group <strong>"${groupName}"</strong>.
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">${deadlineDescription}:</p>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
              <span style="color: #6b7280; font-size: 14px;">Previous Deadline:</span>
              <span style="color: #374151; font-size: 18px; font-weight: 600;">${oldDeadlineFormatted}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #6b7280; font-size: 14px;">New Deadline:</span>
              <span style="color: #6366f1; font-size: 20px; font-weight: 700;">${newDeadlineFormatted}</span>
            </div>
          </div>

          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600;">
              ⚠️ Important: Please Review
            </p>
            <p style="color: #4338ca; font-size: 14px; margin: 10px 0 0 0; line-height: 1.6;">
              Please check if you're still okay with this new deadline. If this change doesn't work for you, you can leave the group at any time.
            </p>
          </div>

          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
            <p style="color: #374151; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">
              What you can do:
            </p>
            <ul style="color: #6b7280; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>Review the new deadline in the app</li>
              <li>Continue participating if you're comfortable with the change</li>
              <li>Leave the group if this doesn't work for you</li>
            </ul>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            If you have any questions or concerns, please reach out to the group admin or contact our support team.
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong style="color: #6366f1;">The GroupFund Team</strong>
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated notification. Please do not reply to this email.
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
      console.error('Resend error sending deadline update email:', error);
      return false;
    }

    console.log('Deadline update email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending deadline update email:', error);
    return false;
  }
};

// Send email notification when group admin updates max members for birthday groups
const sendMaxMembersUpdateEmail = async (email, memberName, groupName, oldMaxMembers, newMaxMembers, adminName) => {
  try {
    const subject = `Max Members Updated - ${groupName}`;
    const isIncrease = newMaxMembers > oldMaxMembers;
    const changeType = isIncrease ? 'increased' : 'decreased';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">👥 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1e40af; font-size: 24px; margin-top: 0;">
            Max Members Updated
          </h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${memberName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            The group admin <strong>${adminName}</strong> has ${changeType} the maximum number of members for the birthday group <strong>"${groupName}"</strong>.
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">Maximum Members:</p>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
              <span style="color: #6b7280; font-size: 14px;">Previous Max:</span>
              <span style="color: #374151; font-size: 18px; font-weight: 600;">${oldMaxMembers} member${oldMaxMembers !== 1 ? 's' : ''}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #6b7280; font-size: 14px;">New Max:</span>
              <span style="color: #6366f1; font-size: 20px; font-weight: 700;">${newMaxMembers} member${newMaxMembers !== 1 ? 's' : ''}</span>
            </div>
          </div>

          ${isIncrease ? `
          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600;">
              💡 Important: How This Affects You
            </p>
            <p style="color: #4338ca; font-size: 14px; margin: 10px 0 0 0; line-height: 1.6;">
              As the number of members increases, the amount you pay each year will also increase. This is because in birthday groups, each member contributes to every other member's birthday. With more members, there are more birthdays to contribute to throughout the year.
            </p>
          </div>
          ` : `
          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600;">
              💡 Good News
            </p>
            <p style="color: #4338ca; font-size: 14px; margin: 10px 0 0 0; line-height: 1.6;">
              With fewer maximum members, you'll have fewer birthdays to contribute to each year, which means lower total annual contributions.
            </p>
          </div>
          `}

          <div style="background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #4338ca; font-size: 16px; margin: 0; font-weight: 600;">
              ⚠️ Important: Please Review
            </p>
            <p style="color: #4338ca; font-size: 14px; margin: 10px 0 0 0; line-height: 1.6;">
              Please check if you're still okay with this change. If this doesn't work for you, you can leave the group at any time.
            </p>
          </div>

          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
            <p style="color: #374151; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">
              What you can do:
            </p>
            <ul style="color: #6b7280; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>Review the new max members limit in the app</li>
              <li>Consider how this affects your annual contribution amount</li>
              <li>Continue participating if you're comfortable with the change</li>
              <li>Leave the group if this doesn't work for you</li>
            </ul>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            If you have any questions or concerns, please reach out to the group admin or contact our support team.
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong style="color: #6366f1;">The GroupFund Team</strong>
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated notification. Please do not reply to this email.
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
      console.error('Resend error sending max members update email:', error);
      return false;
    }

    console.log('Max members update email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending max members update email:', error);
    return false;
  }
};

// Alias for backward compatibility
const sendMonthlyBirthdayNewsletter = async (email, userName, userId, monthName, groupsWithBirthdays) => {
  return sendMonthlyNewsletter(email, userName, userId, monthName, groupsWithBirthdays, [], []);
};

// Send email to admin when a member leaves or is removed from a subscription group
const sendMemberLeftSubscriptionEmail = async (adminEmail, adminName, memberName, groupName, subscriptionPlatform, isRemoved = false) => {
  try {
    const action = isRemoved ? 'removed from' : 'left';
    const subject = `Member ${action.charAt(0).toUpperCase() + action.slice(1)} Subscription Group - ${groupName}`;
    const platformName = subscriptionPlatform || 'the subscription';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🔐 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1e40af; font-size: 24px; margin-top: 0;">
            Member ${action.charAt(0).toUpperCase() + action.slice(1)} Subscription Group
          </h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${adminName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            <strong>${memberName}</strong> has ${action} your subscription group <strong>"${groupName}"</strong> (${platformName}).
          </p>
          
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <p style="color: #92400e; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">
              ⚠️ Important Security Action Required:
            </p>
            <ul style="color: #78350f; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>Change the subscription account password</li>
              <li>Update access credentials if shared</li>
              <li>Review active sessions and log out any unauthorized devices</li>
              <li>Update payment information if needed</li>
            </ul>
          </div>

          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">
              Group Details:
            </p>
            <p style="color: #6b7280; font-size: 14px; margin: 5px 0;">
              <strong>Group:</strong> ${groupName}
            </p>
            <p style="color: #6b7280; font-size: 14px; margin: 5px 0;">
              <strong>Platform:</strong> ${platformName}
            </p>
            <p style="color: #6b7280; font-size: 14px; margin: 5px 0;">
              <strong>Member:</strong> ${memberName}
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Please take the necessary security steps to protect your subscription account. If you have any questions, feel free to contact our support team.
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong style="color: #6366f1;">The GroupFund Team</strong>
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated security notification. Please do not reply to this email.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: adminEmail,
      subject,
      html,
    });

    if (error) {
      console.error('Resend error sending member left subscription email:', error);
      return false;
    }

    console.log('Member left subscription email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending member left subscription email:', error);
    return false;
  }
};

// Send Merry Christmas email to users
const sendMerryChristmasEmail = async (email, name) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 40px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 36px;">🎄🎅🎄</h1>
          <h1 style="color: white; margin: 10px 0 0 0; font-size: 32px;">Merry Christmas!</h1>
        </div>
        <div style="background: #f9fafb; padding: 40px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 28px; margin-top: 0; text-align: center;">Merry Christmas, ${name}! 🎁</h2>
          <p style="color: #374151; font-size: 18px; line-height: 1.7; margin-bottom: 20px; text-align: center;">
            Wishing you a joyful Christmas season filled with love, laughter, and wonderful moments with your loved ones! 🎊
          </p>
          
          <div style="background: linear-gradient(135deg, #e0e7ff 0%, #ddd6fe 100%); padding: 30px; border-radius: 12px; margin: 30px 0; text-align: center; border: 2px solid #6366f1;">
            <p style="color: #4338ca; font-size: 20px; margin: 0; font-weight: 600;">
              🎄 May your Christmas be merry and bright! 🎄
            </p>
          </div>

          <div style="background: white; padding: 25px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0; font-weight: 600;">✨ This holiday season:</p>
            <ul style="color: #6b7280; font-size: 15px; line-height: 2; margin: 0; padding-left: 20px;">
              <li>Celebrate with family and friends</li>
              <li>Create beautiful memories</li>
              <li>Share joy and kindness</li>
              <li>Enjoy the festive spirit</li>
            </ul>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px; text-align: center;">
            Thank you for being part of the GroupFund family! 🎉
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px; text-align: center;">
            With warmest wishes,<br/>
            <strong style="color: #6366f1;">The GroupFund Team</strong> 🎅
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
            This is an automated Christmas greeting from GroupFund.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: `🎄 Merry Christmas, ${name}! 🎅`,
      html,
    });

    if (error) {
      console.error('Resend error sending Merry Christmas email:', error);
      return false;
    }

    console.log('Merry Christmas email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending Merry Christmas email:', error);
    return false;
  }
};
// Send Happy New Year email to users
const sendHappyNewYearEmail = async (email, name) => {
  try {
    const currentYear = new Date().getFullYear();

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 40px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 36px;">🎆🥂🎆</h1>
          <h1 style="color: white; margin: 10px 0 0 0; font-size: 32px;">Happy New Year!</h1>
        </div>
        <div style="background: #f9fafb; padding: 40px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 28px; margin-top: 0; text-align: center;">Happy New Year, ${name}! 🎉</h2>
          <p style="color: #374151; font-size: 18px; line-height: 1.7; margin-bottom: 20px; text-align: center;">
            Wishing you a bright and successful New Year filled with joy, growth, and amazing moments with the people who matter most. ✨
          </p>
          
          <div style="background: linear-gradient(135deg, #e0e7ff 0%, #ddd6fe 100%); padding: 30px; border-radius: 12px; margin: 30px 0; text-align: center; border: 2px solid #6366f1;">
            <p style="color: #4338ca; font-size: 20px; margin: 0; font-weight: 600;">
              🎆 Here’s to new beginnings, bold goals, and shared wins in in ${currentYear}! 🎆
            </p>
          </div>

          <div style="background: white; padding: 25px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0; font-weight: 600;">✨ As we start this new year:</p>
            <ul style="color: #6b7280; font-size: 15px; line-height: 2; margin: 0; padding-left: 20px;">
              <li>Set fresh goals and chase big dreams</li>
              <li>Create meaningful moments with loved ones</li>
              <li>Share kindness, generosity, and support</li>
              <li>Make this your best year yet</li>
            </ul>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px; text-align: center;">
            Thank you for being part of the GroupFund family — here’s to many more milestones together this year. 🥂
          </p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px; text-align: center;">
            With warmest wishes,<br/>
            <strong style="color: #6366f1;">The GroupFund Team</strong> 🎉
          </p>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
            This is an automated New Year greeting from GroupFund.
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: `🎆 Happy New Year, ${name}! 🎉`,
      html,
    });

    if (error) {
      console.error('Resend error sending Happy New Year email:', error);
      return false;
    }

    console.log('Happy New Year email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending Happy New Year email:', error);
    return false;
  }
};

// Send custom email (for admin use)
const sendCustomEmail = async (email, subject, html) => {
  try {
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

    console.log('Custom email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending custom email:', error);
    return false;
  }
};

// Send payment success notification email to recipient
const sendPaymentSuccessEmail = async (email, name, amount, currency, contributorName, groupName, currencySymbol) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">Payment Received! 💰</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            You've received a contribution from <strong>${contributorName}</strong> in the group <strong>${groupName}</strong>.
          </p>
          <div style="background: white; padding: 30px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; text-align: center;">
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">Amount received:</p>
            <h1 style="color: #10b981; font-size: 36px; margin: 0; font-weight: bold;">${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h1>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 10px;">${currency}</p>
          </div>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            The funds have been credited to your wallet. You can withdraw them anytime from your wallet.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong>The GroupFund Team</strong>
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: `Payment Received: ${currencySymbol}${amount} from ${contributorName}`,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Payment success email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending payment success email:', error);
    return false;
  }
};

// Send auto-pay disabled notification email
const sendAutoPayDisabledEmail = async (email, name, groupName, reason) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">Auto-Pay Disabled</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Your auto-pay has been disabled for the group <strong>${groupName}</strong>.
          </p>
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <p style="color: #92400e; font-size: 14px; margin: 0;">
              <strong>Reason:</strong> ${reason || 'Payment failed after multiple attempts'}
            </p>
          </div>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            You can re-enable auto-pay after fixing the issue (update your payment method, add funds, etc.) in the app settings.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong>The GroupFund Team</strong>
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            If you have questions or need assistance, please contact support at ${process.env.SECURITY_EMAIL || 'support@groupfund.app'}
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: `Auto-Pay Disabled: ${groupName}`,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Auto-pay disabled email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending auto-pay disabled email:', error);
    return false;
  }
};

// Send security email notification for critical payment actions
const sendSecurityEmail = async (email, name, action, details, metadata = {}) => {
  try {
    const actionTitles = {
      'enable_auto_pay': 'Auto-Pay Enabled',
      'disable_auto_pay': 'Auto-Pay Disabled',
      'update_auto_pay_preferences': 'Auto-Pay Preferences Updated',
      'add_payment_method': 'Payment Method Added',
      'delete_payment_method': 'Payment Method Removed',
    };

    const actionTitle = actionTitles[action] || 'Account Activity';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">Security Alert: ${actionTitle}</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            We're writing to confirm that ${details} was performed on your GroupFund account.
          </p>
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 14px; margin: 5px 0;"><strong>Date:</strong> ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</p>
            <p style="color: #374151; font-size: 14px; margin: 5px 0;"><strong>Action:</strong> ${actionTitle}</p>
            ${metadata.groupName ? `<p style="color: #374151; font-size: 14px; margin: 5px 0;"><strong>Group:</strong> ${metadata.groupName}</p>` : ''}
            ${metadata.paymentTiming ? `<p style="color: #374151; font-size: 14px; margin: 5px 0;"><strong>Payment Timing:</strong> ${metadata.paymentTiming === '1_day_before' ? '1 Day Before' : 'Same Day'}</p>` : ''}
          </div>
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <p style="color: #92400e; font-size: 14px; margin: 0; font-weight: bold;">
              ⚠️ Security Warning
            </p>
            <p style="color: #92400e; font-size: 14px; margin: 10px 0 0 0;">
              If you didn't make this change, please contact us immediately at <strong>${process.env.SECURITY_EMAIL || 'security@groupfund.app'}</strong> to secure your account. We take account security seriously and will investigate any unauthorized activity.
            </p>
          </div>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            You can review your account security settings in the app.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong>The GroupFund Security Team</strong>
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: `Security Alert: ${actionTitle} on Your GroupFund Account`,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Security email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending security email:', error);
    return false;
  }
};

// Send payment failure notification email
const sendPaymentFailureEmail = async (email, name, amount, currency, groupName, errorMessage, retryCount, currencySymbol) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">Payment Failed</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Your automatic payment for <strong>${groupName}</strong> failed.
          </p>
          <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444;">
            <p style="color: #991b1b; font-size: 14px; margin: 0 0 10px 0;"><strong>Amount:</strong> ${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p style="color: #991b1b; font-size: 14px; margin: 0 0 10px 0;"><strong>Reason:</strong> ${errorMessage || 'Payment declined'}</p>
            ${retryCount > 0 ? `<p style="color: #991b1b; font-size: 14px; margin: 0;">We'll retry this payment automatically (Attempt ${retryCount + 1}/2)</p>` : ''}
          </div>
          ${retryCount >= 1 ? '<p style="color: #dc2626; font-size: 16px; line-height: 1.7; font-weight: bold;">After 2 failed attempts, auto-pay will be disabled. Please update your payment method to continue using auto-pay.</p>' : ''}
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Please check your payment method and ensure there are sufficient funds, or update your card details in the app.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong>The GroupFund Team</strong>
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: `Payment Failed: ${groupName}`,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Payment failure email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending payment failure email:', error);
    return false;
  }
};

// Send withdrawal request email
const sendWithdrawalRequestEmail = async (email, name, amount, currency, currencySymbol, scheduledAt) => {
  try {
    const scheduledDate = new Date(scheduledAt).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">Withdrawal Request Received</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Your withdrawal request has been received and is being processed.
          </p>
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 10px 0;"><strong>Amount:</strong> ${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}</p>
            <p style="color: #374151; font-size: 16px; margin: 0;"><strong>Scheduled for:</strong> ${scheduledDate}</p>
          </div>
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <p style="color: #92400e; font-size: 14px; margin: 0; font-weight: bold;">⏰ 24-Hour Security Hold</p>
            <p style="color: #92400e; font-size: 14px; margin: 10px 0 0 0;">
              Your funds are held for 24 hours as a security measure. This helps us detect and prevent fraudulent withdrawals.
            </p>
          </div>
          <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444;">
            <p style="color: #991b1b; font-size: 14px; margin: 0; font-weight: bold;">🔒 Security Alert</p>
            <p style="color: #991b1b; font-size: 14px; margin: 10px 0 0 0;">
              If you didn't make this withdrawal, please contact us immediately at <strong>${process.env.SECURITY_EMAIL || 'security@groupfund.app'}</strong>
            </p>
          </div>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong>The GroupFund Team</strong>
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: 'Withdrawal Request Received - GroupFund',
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Withdrawal request email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending withdrawal request email:', error);
    return false;
  }
};

// Send withdrawal completed email
const sendWithdrawalCompletedEmail = async (email, name, amount, currency, currencySymbol, transactionId) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">✅ Withdrawal Completed</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Your withdrawal has been processed successfully and funds have been sent to your bank account.
          </p>
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366f1;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 10px 0;"><strong>Amount:</strong> ${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}</p>
            <p style="color: #374151; font-size: 16px; margin: 0;"><strong>Transaction ID:</strong> ${transactionId}</p>
          </div>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Funds should appear in your bank account within 1-3 business days, depending on your bank's processing time.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong>The GroupFund Team</strong>
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: 'Withdrawal Completed - GroupFund',
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Withdrawal completed email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending withdrawal completed email:', error);
    return false;
  }
};

// Send withdrawal failed email
const sendWithdrawalFailedEmail = async (email, name, amount, currency, currencySymbol, errorMessage) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎂 GroupFund</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1a1a1a; font-size: 24px; margin-top: 0;">❌ Withdrawal Failed</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Hi ${name},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Unfortunately, your withdrawal request could not be processed.
          </p>
          <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444;">
            <p style="color: #991b1b; font-size: 16px; margin: 0 0 10px 0;"><strong>Amount:</strong> ${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}</p>
            <p style="color: #991b1b; font-size: 16px; margin: 0;"><strong>Reason:</strong> ${errorMessage || 'Processing error'}</p>
          </div>
          <p style="color: #374151; font-size: 16px; line-height: 1.7;">
            Your funds have been returned to your wallet. Please check your bank account details and try again, or contact support if the issue persists.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-top: 30px;">
            Best regards,<br>
            <strong>The GroupFund Team</strong>
          </p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'GroupFund <onboarding@resend.dev>',
      to: email,
      subject: 'Withdrawal Failed - GroupFund',
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Withdrawal failed email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending withdrawal failed email:', error);
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
  sendComprehensiveReminderEmail,
  sendMonthlyBirthdayNewsletter, // Alias for backward compatibility
  sendMonthlyNewsletter,
  sendWaitlistConfirmationEmail,
  sendBetaInvitationEmail,
  sendOverdueContributionEmail,
  sendAdminOverdueNotificationEmail,
  sendAdminUpcomingDeadlineEmail,
  sendContributionAmountUpdateEmail,
  sendDeadlineUpdateEmail,
  sendMaxMembersUpdateEmail,
  sendMemberLeftSubscriptionEmail,
  sendMerryChristmasEmail,
  sendHappyNewYearEmail,
  sendCustomEmail,
  sendPaymentSuccessEmail,
  sendAutoPayDisabledEmail,
  sendPaymentFailureEmail,
  sendSecurityEmail,
  sendWithdrawalRequestEmail,
  sendWithdrawalCompletedEmail,
  sendWithdrawalFailedEmail,
};
