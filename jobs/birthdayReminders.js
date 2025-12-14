const pool = require('../config/database');
const { createNotification } = require('../utils/notifications');
const { sendBirthdayEmail, sendBirthdayReminderEmail } = require('../utils/email');

/**
 * Check for upcoming birthdays and send reminder notifications
 * This should be run daily (e.g., via cron job)
 */
async function checkBirthdayReminders() {
  try {
    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];
    
    // Get all active users with their notification preferences
    // First, get users whose birthday is TODAY (using SQL date comparison to avoid timezone issues)
    // Also check if notifications were already sent today
    const todayBirthdayUsers = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.birthday, u.expo_push_token,
        u.notify_7_days_before, u.notify_1_day_before, u.notify_same_day,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM notifications n 
            WHERE n.user_id = u.id 
              AND n.type = 'birthday_wish' 
              AND n.created_at::date = CURRENT_DATE
          ) THEN true 
          ELSE false 
        END as in_app_notification_sent,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM birthday_email_log bel 
            WHERE bel.user_id = u.id 
              AND bel.sent_at = CURRENT_DATE
          ) THEN true 
          ELSE false 
        END as email_sent
       FROM users u
       WHERE u.birthday IS NOT NULL 
         AND u.is_verified = TRUE
         AND DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE)
         AND DATE_PART('day', u.birthday) = DATE_PART('day', CURRENT_DATE)`
    );

    // Send birthday wishes to users whose birthday is today
    for (const user of todayBirthdayUsers.rows) {
      let sentInApp = false;
      let sentPush = false;
      let sentEmail = false;

      // Check and send in-app notification (if not already sent)
      if (!user.in_app_notification_sent) {
        try {
          await createNotification(
            user.id,
            'birthday_wish',
            '🎉 Happy Birthday!',
            `Happy Birthday, ${user.name}! 🎂🎉 Wishing you a wonderful day filled with joy and celebration!`,
            null,
            user.id
          );
          sentInApp = true;
          // Push notification is sent automatically by createNotification if push token exists
          if (user.expo_push_token) {
            sentPush = true;
          }
          console.log(`Birthday in-app notification sent to ${user.name} (${user.email})${user.expo_push_token ? ' + push notification' : ''}`);
        } catch (err) {
          console.error(`Error sending in-app notification to ${user.email}:`, err);
        }
      } else {
        console.log(`Skipping in-app notification for ${user.name} (${user.email}): Already sent today`);
        // Check if push was sent (notification exists and user has push token)
        if (user.expo_push_token) {
          sentPush = true;
        }
      }

      // Send birthday email to the celebrant (only if not already sent)
      if (user.email && !user.email_sent) {
        try {
          await sendBirthdayEmail(user.email, user.name);
          // Log email send in birthday_email_log
          await pool.query(
            `INSERT INTO birthday_email_log (user_id, email, sent_at)
             VALUES ($1, $2, CURRENT_DATE)
             ON CONFLICT (user_id, sent_at) DO NOTHING`,
            [user.id, user.email]
          );
          sentEmail = true;
          console.log(`Birthday email sent successfully to ${user.email}`);
        } catch (err) {
          console.error(`Error sending birthday email to ${user.email}:`, err);
          // Don't throw - email is non-critical, continue with other users
        }
      } else if (user.email && user.email_sent) {
        console.log(`Skipping email for ${user.name} (${user.email}): Already sent today`);
        sentEmail = true;
      }

      // Summary log
      if (user.in_app_notification_sent && user.email_sent) {
        console.log(`All notifications already sent for ${user.name} (${user.email})`);
      }
    }

    // Get all active users with their notification preferences for reminder calculations
    const usersResult = await pool.query(
      `SELECT id, name, email, birthday, 
              notify_7_days_before, notify_1_day_before, notify_same_day
       FROM users 
       WHERE birthday IS NOT NULL AND is_verified = TRUE`
    );

    for (const user of usersResult.rows) {
      const userBirthday = new Date(user.birthday);
      const currentYear = today.getFullYear();
      
      // Calculate next birthday date
      let nextBirthday = new Date(currentYear, userBirthday.getMonth(), userBirthday.getDate());
      if (nextBirthday < today) {
        // Birthday already passed this year, use next year
        nextBirthday = new Date(currentYear + 1, userBirthday.getMonth(), userBirthday.getDate());
      }
      
      // Calculate days until birthday
      const daysUntil = Math.floor((nextBirthday - today) / (1000 * 60 * 60 * 24));
      
      // Get all groups the user is in
      const groupsResult = await pool.query(
        `SELECT g.id, g.name, g.contribution_amount, g.currency
         FROM groups g
         JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.user_id = $1 AND gm.status = 'active'`,
        [user.id]
      );
      
      // For each group, check for upcoming birthdays of other members
      for (const group of groupsResult.rows) {
        // Get all active members in this group
        const membersResult = await pool.query(
          `SELECT u.id, u.name, u.birthday
           FROM users u
           JOIN group_members gm ON u.id = gm.user_id
           WHERE gm.group_id = $1 AND gm.status = 'active' AND u.id != $2 AND u.birthday IS NOT NULL`,
          [group.id, user.id]
        );
        
        for (const member of membersResult.rows) {
          const memberBirthday = new Date(member.birthday);
          let memberNextBirthday = new Date(currentYear, memberBirthday.getMonth(), memberBirthday.getDate());
          if (memberNextBirthday < today) {
            memberNextBirthday = new Date(currentYear + 1, memberBirthday.getMonth(), memberBirthday.getDate());
          }
          
          const daysUntilMemberBirthday = Math.floor((memberNextBirthday - today) / (1000 * 60 * 60 * 24));
          
          // Check if user has already paid (for all reminder types)
          // Skip reminders if status is 'paid', 'confirmed', or 'not_received'
          const contributionCheck = await pool.query(
            `SELECT id FROM birthday_contributions 
             WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3 
             AND status IN ('paid', 'confirmed', 'not_received')`,
            [group.id, member.id, user.id]
          );
          
          const hasPaid = contributionCheck.rows.length > 0;
          
          // Check if reminder was already sent today (to prevent duplicates)
          const reminderCheck = await pool.query(
            `SELECT id FROM notifications 
             WHERE user_id = $1 AND type = 'birthday_reminder' 
             AND group_id = $2 AND related_user_id = $3 
             AND created_at::date = CURRENT_DATE`,
            [user.id, group.id, member.id]
          );
          
          const reminderAlreadySent = reminderCheck.rows.length > 0;
          
          // Check if user wants to be notified for this reminder time
          if (daysUntilMemberBirthday === 7 && user.notify_7_days_before && !hasPaid && !reminderAlreadySent) {
            await createNotification(
              user.id,
              'birthday_reminder',
              'Birthday Reminder',
              `Reminder: ${member.name}'s birthday is in 7 days. Don't forget to pay ₦${parseFloat(group.contribution_amount).toLocaleString('en-NG')} in ${group.name}.`,
              group.id,
              member.id
            );

            // Send reminder email
            if (user.email) {
              try {
                await sendBirthdayReminderEmail(
                  user.email,
                  user.name,
                  member.name,
                  7,
                  `${group.currency || 'NGN'} ${parseFloat(group.contribution_amount).toLocaleString('en-NG')}`,
                  group.currency || 'NGN',
                  group.name
                );
              } catch (err) {
                console.error(`Error sending 7-day reminder email to ${user.email}:`, err);
              }
            }
          } else if (daysUntilMemberBirthday === 1 && user.notify_1_day_before && !hasPaid && !reminderAlreadySent) {
            await createNotification(
              user.id,
              'birthday_reminder',
              'Birthday Reminder',
              `Reminder: ${member.name}'s birthday is tomorrow! Don't forget to pay ₦${parseFloat(group.contribution_amount).toLocaleString('en-NG')} in ${group.name}.`,
              group.id,
              member.id
            );

            // Send reminder email
            if (user.email) {
              try {
                await sendBirthdayReminderEmail(
                  user.email,
                  user.name,
                  member.name,
                  1,
                  `${group.currency || 'NGN'} ${parseFloat(group.contribution_amount).toLocaleString('en-NG')}`,
                  group.currency || 'NGN',
                  group.name
                );
              } catch (err) {
                console.error(`Error sending 1-day reminder email to ${user.email}:`, err);
              }
            }
          } else if (daysUntilMemberBirthday === 0 && user.notify_same_day && !hasPaid && !reminderAlreadySent) {
            // User hasn't paid yet, send reminder
            await createNotification(
              user.id,
              'birthday_reminder',
              'Birthday Reminder - Action Required',
              `Today is ${member.name}'s birthday! Please mark your contribution of ₦${parseFloat(group.contribution_amount).toLocaleString('en-NG')} as paid in ${group.name}.`,
              group.id,
              member.id
            );

            // Send reminder email
            if (user.email) {
              try {
                await sendBirthdayReminderEmail(
                  user.email,
                  user.name,
                  member.name,
                  0,
                  `${group.currency || 'NGN'} ${parseFloat(group.contribution_amount).toLocaleString('en-NG')}`,
                  group.currency || 'NGN',
                  group.name
                );
              } catch (err) {
                console.error(`Error sending same-day reminder email to ${user.email}:`, err);
              }
            }
          }
        }
      }
    }
    
    console.log('Birthday reminders check completed');
  } catch (error) {
    console.error('Error checking birthday reminders:', error);
  }
}

// Run if called directly (for testing)
if (require.main === module) {
  checkBirthdayReminders()
    .then(() => {
      console.log('Birthday reminders job completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Birthday reminders job failed:', error);
      process.exit(1);
    });
}

module.exports = { checkBirthdayReminders };
