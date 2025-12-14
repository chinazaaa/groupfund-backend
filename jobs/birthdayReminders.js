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
        
        // Group members by days until birthday (7, 1, 0)
        const birthdaysByDay = {
          7: [],
          1: [],
          0: []
        };
        
        for (const member of membersResult.rows) {
          const memberBirthday = new Date(member.birthday);
          let memberNextBirthday = new Date(currentYear, memberBirthday.getMonth(), memberBirthday.getDate());
          if (memberNextBirthday < today) {
            memberNextBirthday = new Date(currentYear + 1, memberBirthday.getMonth(), memberBirthday.getDate());
          }
          
          const daysUntilMemberBirthday = Math.floor((memberNextBirthday - today) / (1000 * 60 * 60 * 24));
          
          if (daysUntilMemberBirthday === 7 || daysUntilMemberBirthday === 1 || daysUntilMemberBirthday === 0) {
            // Check if user has already paid
            const contributionCheck = await pool.query(
              `SELECT id FROM birthday_contributions 
               WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3 
               AND status IN ('paid', 'confirmed', 'not_received')`,
              [group.id, member.id, user.id]
            );
            
            const hasPaid = contributionCheck.rows.length > 0;
            
            birthdaysByDay[daysUntilMemberBirthday].push({
              id: member.id,
              name: member.name,
              hasPaid,
              contributionAmount: parseFloat(group.contribution_amount),
              currency: group.currency || 'NGN'
            });
          }
        }
        
        // Process each day (7, 1, 0) - send consolidated notification if any unpaid
        for (const [daysUntil, birthdays] of Object.entries(birthdaysByDay)) {
          const daysNum = parseInt(daysUntil);
          
          // Filter out paid birthdays and check if any unpaid remain
          const unpaidBirthdays = birthdays.filter(b => !b.hasPaid);
          
          if (unpaidBirthdays.length === 0) {
            continue; // All paid, skip
          }
          
          // Check user preferences
          let shouldNotify = false;
          if (daysNum === 7 && user.notify_7_days_before) {
            shouldNotify = true;
          } else if (daysNum === 1 && user.notify_1_day_before) {
            shouldNotify = true;
          } else if (daysNum === 0 && user.notify_same_day) {
            shouldNotify = true;
          }
          
          if (!shouldNotify) {
            continue;
          }
          
          // Check if reminder was already sent today for this group/day combination
          const reminderCheck = await pool.query(
            `SELECT id FROM notifications 
             WHERE user_id = $1 AND type = 'birthday_reminder' 
             AND group_id = $2 
             AND created_at::date = CURRENT_DATE
             AND message LIKE $3`,
            [user.id, group.id, `%${daysNum === 0 ? 'today' : daysNum === 1 ? 'tomorrow' : '7 days'}%`]
          );
          
          if (reminderCheck.rows.length > 0) {
            continue; // Already sent today
          }
          
          // Build consolidated message
          const { formatAmount } = require('../utils/currency');
          const allNames = birthdays.map(b => b.name).join(', ');
          const paidCount = birthdays.filter(b => b.hasPaid).length;
          const unpaidCount = unpaidBirthdays.length;
          
          let title = '';
          let message = '';
          
          if (daysNum === 7) {
            title = 'Birthday Reminder';
            message = `Reminder: ${allNames} ${birthdays.length > 1 ? 'have' : 'has'} birthday${birthdays.length > 1 ? 's' : ''} in 7 days in ${group.name}.`;
            if (paidCount > 0) {
              message += ` You've paid for ${paidCount} of ${birthdays.length}.`;
            }
            message += ` Don't forget to pay ${formatAmount(parseFloat(group.contribution_amount), group.currency || 'NGN')} for ${unpaidCount} remaining.`;
          } else if (daysNum === 1) {
            title = 'Birthday Reminder';
            message = `Reminder: ${allNames} ${birthdays.length > 1 ? 'have' : 'has'} birthday${birthdays.length > 1 ? 's' : ''} tomorrow in ${group.name}!`;
            if (paidCount > 0) {
              message += ` You've paid for ${paidCount} of ${birthdays.length}.`;
            }
            message += ` Don't forget to pay ${formatAmount(parseFloat(group.contribution_amount), group.currency || 'NGN')} for ${unpaidCount} remaining.`;
          } else if (daysNum === 0) {
            title = 'Birthday Reminder - Action Required';
            message = `Today ${allNames} ${birthdays.length > 1 ? 'have' : 'has'} birthday${birthdays.length > 1 ? 's' : ''} in ${group.name}!`;
            if (paidCount > 0) {
              message += ` You've paid for ${paidCount} of ${birthdays.length}.`;
            }
            message += ` Please mark your contribution${unpaidCount > 1 ? 's' : ''} of ${formatAmount(parseFloat(group.contribution_amount), group.currency || 'NGN')} as paid for ${unpaidCount} remaining.`;
          }
          
          // Send consolidated notification (use first unpaid member as related_user_id for compatibility)
          await createNotification(
            user.id,
            'birthday_reminder',
            title,
            message,
            group.id,
            unpaidBirthdays[0].id
          );
          
          // Send consolidated email
          if (user.email) {
            try {
              const { sendConsolidatedBirthdayReminderEmail } = require('../utils/email');
              await sendConsolidatedBirthdayReminderEmail(
                user.email,
                user.name,
                group.name,
                daysNum,
                birthdays,
                group.currency || 'NGN'
              );
            } catch (err) {
              console.error(`Error sending consolidated reminder email to ${user.email}:`, err);
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
