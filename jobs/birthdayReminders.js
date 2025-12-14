const pool = require('../config/database');
const { createNotification } = require('../utils/notifications');
const { sendBirthdayEmail } = require('../utils/email');

/**
 * Check for upcoming birthdays and send reminder notifications
 * NOTE: This job is currently disabled. Use the admin endpoints instead:
 * - POST /api/admin/birthdays/trigger-birthday-wishes
 * - POST /api/admin/birthdays/trigger-reminders
 * - POST /api/admin/birthdays/send-monthly-newsletter
 * 
 * This function is kept for reference but should not be run automatically.
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
      
      // Get all groups the user is in (exclude closed groups - they don't accept contributions)
      const groupsResult = await pool.query(
        `SELECT g.id, g.name, g.contribution_amount, g.currency
         FROM groups g
         JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.user_id = $1 AND gm.status = 'active' AND g.status = 'active'`,
        [user.id]
      );
      
      // Collect all groups with birthdays organized by day (7, 1, 0)
      const groupsByDay = {
        7: [],
        1: [],
        0: []
      };
      
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
        
        // Add group to the appropriate day if it has any birthdays
        for (const [daysUntil, birthdays] of Object.entries(birthdaysByDay)) {
          const daysNum = parseInt(daysUntil);
          const unpaidBirthdays = birthdays.filter(b => !b.hasPaid);
          
          // Only include groups with at least one unpaid birthday
          if (unpaidBirthdays.length > 0) {
            groupsByDay[daysNum].push({
              groupId: group.id,
              groupName: group.name,
              currency: group.currency || 'NGN',
              birthdays: birthdays
            });
          }
        }
      }
      
      // Process each day (7, 1, 0) - send one comprehensive email and simple notification
      for (const [daysUntil, groups] of Object.entries(groupsByDay)) {
        const daysNum = parseInt(daysUntil);
        
        if (groups.length === 0) {
          continue; // No groups with unpaid birthdays
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
        
        // Check if reminder was already sent today for this day
        const reminderCheck = await pool.query(
          `SELECT id FROM notifications 
           WHERE user_id = $1 AND type = 'birthday_reminder' 
           AND created_at::date = CURRENT_DATE
           AND message LIKE $2`,
          [user.id, `%${daysNum === 0 ? 'today' : daysNum === 1 ? 'tomorrow' : '7 days'}%`]
        );
        
        if (reminderCheck.rows.length > 0) {
          continue; // Already sent today
        }
        
        // Build simple notification message
        let title = '';
        let message = '';
        
        if (daysNum === 7) {
          title = 'Birthday Reminder';
          message = '7 days reminder: One or more birthdays coming up. Check your email for details.';
        } else if (daysNum === 1) {
          title = 'Birthday Reminder';
          message = 'Tomorrow reminder: One or more birthdays tomorrow. Check your email for details.';
        } else if (daysNum === 0) {
          title = 'Birthday Reminder - Action Required';
          message = 'Today reminder: One or more birthdays today. Check your email for details.';
        }
        
        // Send simple notification (use first group and first unpaid member for compatibility)
        const firstGroup = groups[0];
        const firstUnpaid = firstGroup.birthdays.find(b => !b.hasPaid);
        
        await createNotification(
          user.id,
          'birthday_reminder',
          title,
          message,
          firstGroup.groupId,
          firstUnpaid.id
        );
        
        // Send comprehensive email with all groups
        if (user.email) {
          try {
            const { sendComprehensiveBirthdayReminderEmail } = require('../utils/email');
            await sendComprehensiveBirthdayReminderEmail(
              user.email,
              user.name,
              daysNum,
              groups.map(g => ({
                groupName: g.groupName,
                currency: g.currency,
                birthdays: g.birthdays
              }))
            );
          } catch (err) {
            console.error(`Error sending comprehensive reminder email to ${user.email}:`, err);
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
// COMMENTED OUT: Use admin endpoints instead for manual triggering
// if (require.main === module) {
//   checkBirthdayReminders()
//     .then(() => {
//       console.log('Birthday reminders job completed');
//       process.exit(0);
//     })
//     .catch((error) => {
//       console.error('Birthday reminders job failed:', error);
//       process.exit(1);
//     });
// }

/**
 * Check for overdue contributions and send escalating reminders
 * Sends reminders 3, 7, and 14 days after a birthday has passed if contribution is still unpaid
 */
async function checkOverdueContributions() {
  try {
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // Get all active users
    const usersResult = await pool.query(
      `SELECT id, name, email, expo_push_token,
              notify_7_days_before, notify_1_day_before, notify_same_day
       FROM users 
       WHERE is_verified = TRUE AND is_active = TRUE`
    );

    for (const user of usersResult.rows) {
      // Get all groups the user is in (exclude closed groups - they don't accept contributions)
      const groupsResult = await pool.query(
        `SELECT g.id, g.name, g.contribution_amount, g.currency
         FROM groups g
         JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.user_id = $1 AND gm.status = 'active' AND g.status = 'active'`,
        [user.id]
      );

      // Track overdue contributions by days overdue (3, 7, 14)
      const overdueByDays = {
        3: [],
        7: [],
        14: []
      };

      for (const group of groupsResult.rows) {
        // Get user's join date for this group
        const userJoinDateResult = await pool.query(
          `SELECT joined_at FROM group_members 
           WHERE group_id = $1 AND user_id = $2 AND status = 'active'`,
          [group.id, user.id]
        );
        
        if (userJoinDateResult.rows.length === 0) continue;
        const userJoinDate = new Date(userJoinDateResult.rows[0].joined_at);

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
          const thisYearBirthday = new Date(currentYear, memberBirthday.getMonth(), memberBirthday.getDate());
          
          // Check if birthday has passed this year AND user was a member when the birthday occurred
          // Only consider overdue if user joined before or on the birthday date
          if (thisYearBirthday < today && userJoinDate <= thisYearBirthday) {
            const daysOverdue = Math.floor((today - thisYearBirthday) / (1000 * 60 * 60 * 24));
            
            // Check if user has paid for this birthday
            const contributionCheck = await pool.query(
              `SELECT id, status FROM birthday_contributions 
               WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
               AND EXTRACT(YEAR FROM contribution_date) = $4`,
              [group.id, member.id, user.id, currentYear]
            );

            // Check if contribution is paid (status is 'paid' or 'confirmed')
            // 'not_received' means they marked as paid but celebrant rejected it, so still overdue
            const hasPaid = contributionCheck.rows.length > 0 && 
                           (contributionCheck.rows[0].status === 'paid' || 
                            contributionCheck.rows[0].status === 'confirmed');

            // If not paid and overdue by 3, 7, or 14 days, add to reminder list
            if (!hasPaid && (daysOverdue === 3 || daysOverdue === 7 || daysOverdue === 14)) {
              // Check if reminder was already sent today for this specific overdue period
              const reminderCheck = await pool.query(
                `SELECT id FROM notifications 
                 WHERE user_id = $1 AND type = 'overdue_contribution' 
                 AND created_at::date = CURRENT_DATE
                 AND message LIKE $2
                 AND group_id = $3`,
                [user.id, `%${daysOverdue} days overdue%`, group.id]
              );

              if (reminderCheck.rows.length === 0) {
                overdueByDays[daysOverdue].push({
                  groupId: group.id,
                  groupName: group.name,
                  currency: group.currency || 'NGN',
                  contributionAmount: parseFloat(group.contribution_amount),
                  birthdayUserId: member.id,
                  birthdayUserName: member.name,
                  birthdayDate: thisYearBirthday.toISOString().split('T')[0],
                  daysOverdue: daysOverdue
                });
              }
            }
          }
        }
      }

      // Send reminders for each overdue period (3, 7, 14 days)
      for (const [daysOverdue, overdueList] of Object.entries(overdueByDays)) {
        const daysNum = parseInt(daysOverdue);
        
        if (overdueList.length === 0) {
          continue;
        }

        // Check user preferences - use same_day preference for overdue reminders
        if (!user.notify_same_day) {
          continue; // Skip if user doesn't want same-day notifications
        }

        // Send notification for each overdue contribution
        for (const overdue of overdueList) {
          const title = daysNum === 3 
            ? '⚠️ Overdue Contribution - 3 Days'
            : daysNum === 7
            ? '⚠️ Overdue Contribution - 7 Days'
            : '⚠️ Overdue Contribution - 14 Days';
          
          const message = `${overdue.birthdayUserName}'s birthday was ${daysNum} days ago. Please send your contribution of ${overdue.contributionAmount} ${overdue.currency} in ${overdue.groupName}.`;

          await createNotification(
            user.id,
            'overdue_contribution',
            title,
            message,
            overdue.groupId,
            overdue.birthdayUserId
          );
        }

        // Send comprehensive email if user has email
        if (user.email && overdueList.length > 0) {
          try {
            const { sendOverdueContributionEmail } = require('../utils/email');
            await sendOverdueContributionEmail(
              user.email,
              user.name,
              daysNum,
              overdueList.map(o => ({
                groupName: o.groupName,
                currency: o.currency,
                contributionAmount: o.contributionAmount,
                birthdayUserName: o.birthdayUserName,
                birthdayDate: o.birthdayDate
              }))
            );
          } catch (err) {
            console.error(`Error sending overdue contribution email to ${user.email}:`, err);
          }
        }
      }
    }

    console.log('Overdue contributions check completed');
  } catch (error) {
    console.error('Error checking overdue contributions:', error);
  }
}

module.exports = { checkBirthdayReminders, checkOverdueContributions };
