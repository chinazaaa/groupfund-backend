const pool = require('../config/database');
const { createNotification } = require('../utils/notifications');
const { sendBirthdayEmail } = require('../utils/email');

/**
 * Check for upcoming deadlines (birthdays, subscriptions, general groups) and send reminder notifications
 * NOTE: This job is currently disabled. Use the admin endpoints instead:
 * - POST /api/admin/birthdays/trigger-birthday-wishes (birthday-specific)
 * - POST /api/admin/contributions/trigger-reminders (all group types)
 * - POST /api/admin/contributions/trigger-overdue-reminders (all group types)
 * - POST /api/admin/birthdays/send-monthly-newsletter (birthday-specific)
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
    // For birthday reminders, we only need users with birthdays set
    // For subscription/general reminders, we need all active users
    const usersResult = await pool.query(
      `SELECT id, name, email, birthday, 
              notify_7_days_before, notify_1_day_before, notify_same_day
       FROM users 
       WHERE is_verified = TRUE AND is_active = TRUE`
    );

    for (const user of usersResult.rows) {
      // Helper function to get deadline date, handling months with fewer days
      function getLastDayOfMonth(year, month) {
        return new Date(year, month + 1, 0).getDate();
      }
      
      function getDeadlineDate(year, month, deadlineDay) {
        const lastDay = getLastDayOfMonth(year, month);
        const actualDay = Math.min(deadlineDay, lastDay);
        return new Date(year, month, actualDay);
      }
      
      // Get all groups the user is in (exclude closed groups - they don't accept contributions)
      const groupsResult = await pool.query(
        `SELECT g.id, g.name, g.contribution_amount, g.currency, g.group_type,
                g.subscription_frequency, g.subscription_platform, 
                g.subscription_deadline_day, g.subscription_deadline_month, g.deadline
         FROM groups g
         JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.user_id = $1 AND gm.status = 'active' AND g.status = 'active'`,
        [user.id]
      );
      
      // Collect all groups with deadlines organized by day (7, 1, 0)
      const groupsByDay = {
        7: [],
        1: [],
        0: []
      };
      
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();
      
      // For each group, check for upcoming deadlines based on group type
      for (const group of groupsResult.rows) {
        if (group.group_type === 'birthday') {
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
              groupType: 'birthday',
              birthdays: birthdays
            });
          }
        }
        } else if (group.group_type === 'subscription') {
        // Calculate next subscription deadline
        let nextDeadline;
        if (group.subscription_frequency === 'monthly') {
          if (currentDay <= group.subscription_deadline_day) {
            nextDeadline = getDeadlineDate(currentYear, currentMonth - 1, group.subscription_deadline_day);
          } else {
            nextDeadline = getDeadlineDate(currentYear, currentMonth, group.subscription_deadline_day);
          }
        } else {
          // Annual
          if (currentMonth < group.subscription_deadline_month || 
              (currentMonth === group.subscription_deadline_month && currentDay <= group.subscription_deadline_day)) {
            nextDeadline = getDeadlineDate(currentYear, group.subscription_deadline_month - 1, group.subscription_deadline_day);
          } else {
            nextDeadline = getDeadlineDate(currentYear + 1, group.subscription_deadline_month - 1, group.subscription_deadline_day);
          }
        }
        
        nextDeadline.setHours(0, 0, 0, 0);
        const daysUntilDeadline = Math.ceil((nextDeadline - today) / (1000 * 60 * 60 * 24));
        
        if (daysUntilDeadline === 7 || daysUntilDeadline === 1 || daysUntilDeadline === 0) {
          // Check if user has paid for current period
          let periodStart;
          if (group.subscription_frequency === 'monthly') {
            periodStart = new Date(currentYear, currentMonth - 1, 1);
          } else {
            periodStart = new Date(currentYear, 0, 1);
          }
          
          const contributionCheck = await pool.query(
            `SELECT id FROM subscription_contributions 
             WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3
             AND status IN ('paid', 'confirmed')`,
            [group.id, user.id, periodStart]
          );
          
          const hasPaid = contributionCheck.rows.length > 0;
          
          if (!hasPaid) {
            groupsByDay[daysUntilDeadline].push({
              groupId: group.id,
              groupName: group.name,
              currency: group.currency || 'NGN',
              groupType: 'subscription',
              subscriptionPlatform: group.subscription_platform,
              subscriptionFrequency: group.subscription_frequency,
              contributionAmount: parseFloat(group.contribution_amount),
              deadlineDate: nextDeadline.toISOString().split('T')[0]
            });
          }
        }
      } else if (group.group_type === 'general') {
        // Check if group has a deadline
        if (group.deadline) {
          const deadline = new Date(group.deadline);
          deadline.setHours(0, 0, 0, 0);
          const daysUntilDeadline = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
          
          if (daysUntilDeadline === 7 || daysUntilDeadline === 1 || daysUntilDeadline === 0) {
            // Check if user has paid
            const contributionCheck = await pool.query(
              `SELECT id FROM general_contributions 
               WHERE group_id = $1 AND contributor_id = $2
               AND status IN ('paid', 'confirmed')`,
              [group.id, user.id]
            );
            
            const hasPaid = contributionCheck.rows.length > 0;
            
            if (!hasPaid) {
              groupsByDay[daysUntilDeadline].push({
                groupId: group.id,
                groupName: group.name,
                currency: group.currency || 'NGN',
                groupType: 'general',
                contributionAmount: parseFloat(group.contribution_amount),
                deadlineDate: group.deadline
              });
            }
          }
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
        
        // Check if reminder was already sent today for this day (check all reminder types)
        const reminderCheck = await pool.query(
          `SELECT id FROM notifications 
           WHERE user_id = $1 AND type IN ('birthday_reminder', 'subscription_reminder', 'general_reminder', 'reminder')
           AND created_at::date = CURRENT_DATE
           AND message LIKE $2`,
          [user.id, `%${daysNum === 0 ? 'today' : daysNum === 1 ? 'tomorrow' : '7 days'}%`]
        );
        
        if (reminderCheck.rows.length > 0) {
          continue; // Already sent today
        }
        
        // Build simple notification message based on group types
        let title = '';
        let message = '';
        let notificationType = 'reminder';
        let relatedUserId = null;
        
        // Check what types of groups we have
        const hasBirthdayGroups = groups.some(g => g.groupType === 'birthday');
        const hasSubscriptionGroups = groups.some(g => g.groupType === 'subscription');
        const hasGeneralGroups = groups.some(g => g.groupType === 'general');
        
        if (hasBirthdayGroups && !hasSubscriptionGroups && !hasGeneralGroups) {
          // Only birthday groups
          notificationType = 'birthday_reminder';
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
          const firstGroup = groups.find(g => g.groupType === 'birthday');
          const firstUnpaid = firstGroup.birthdays.find(b => !b.hasPaid);
          relatedUserId = firstUnpaid?.id;
        } else if (hasSubscriptionGroups && !hasBirthdayGroups && !hasGeneralGroups) {
          // Only subscription groups
          notificationType = 'subscription_reminder';
          const firstGroup = groups.find(g => g.groupType === 'subscription');
          if (daysNum === 7) {
            title = 'Subscription Reminder';
            message = `7 days reminder: Upcoming subscription ${firstGroup.subscriptionPlatform} in ${firstGroup.groupName}. Check your email for details.`;
          } else if (daysNum === 1) {
            title = 'Subscription Reminder';
            message = `Tomorrow reminder: Subscription ${firstGroup.subscriptionPlatform} in ${firstGroup.groupName} is due tomorrow. Check your email for details.`;
          } else if (daysNum === 0) {
            title = 'Subscription Reminder - Action Required';
            message = `Today reminder: Subscription ${firstGroup.subscriptionPlatform} in ${firstGroup.groupName} is due today. Check your email for details.`;
          }
        } else if (hasGeneralGroups && !hasBirthdayGroups && !hasSubscriptionGroups) {
          // Only general groups
          notificationType = 'general_reminder';
          const firstGroup = groups.find(g => g.groupType === 'general');
          if (daysNum === 7) {
            title = 'Group Reminder';
            message = `7 days reminder: Upcoming deadline for ${firstGroup.groupName}. Check your email for details.`;
          } else if (daysNum === 1) {
            title = 'Group Reminder';
            message = `Tomorrow reminder: Deadline for ${firstGroup.groupName} is tomorrow. Check your email for details.`;
          } else if (daysNum === 0) {
            title = 'Group Reminder - Action Required';
            message = `Today reminder: Deadline for ${firstGroup.groupName} is today. Check your email for details.`;
          }
        } else {
          // Mixed group types
          notificationType = 'reminder';
          if (daysNum === 7) {
            title = 'Upcoming Deadlines Reminder';
            message = '7 days reminder: You have upcoming deadlines. Check your email for details.';
          } else if (daysNum === 1) {
            title = 'Upcoming Deadlines Reminder';
            message = 'Tomorrow reminder: You have deadlines tomorrow. Check your email for details.';
          } else if (daysNum === 0) {
            title = 'Upcoming Deadlines - Action Required';
            message = 'Today reminder: You have deadlines today. Check your email for details.';
          }
        }
        
        // Send simple notification (use first group)
        const firstGroup = groups[0];
        
        await createNotification(
          user.id,
          notificationType,
          title,
          message,
          firstGroup.groupId,
          relatedUserId
        );
        
        // Send comprehensive email with all groups
        if (user.email) {
          try {
            const { sendComprehensiveReminderEmail } = require('../utils/email');
            await sendComprehensiveReminderEmail(
              user.email,
              user.name,
              daysNum,
              groups
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
 * Check for overdue contributions and send escalating reminders for all group types
 * Sends reminders 1, 3, 7, and 14 days after a deadline has passed if contribution is still unpaid
 * Handles: birthday groups, subscription groups, and general groups
 */
async function checkOverdueContributions() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    
    console.log(`[Overdue Reminders] Starting check at ${today.toISOString()}`);
    
    // Helper function to get deadline date, handling months with fewer days
    function getLastDayOfMonth(year, month) {
      return new Date(year, month + 1, 0).getDate();
    }
    
    function getDeadlineDate(year, month, deadlineDay) {
      const lastDay = getLastDayOfMonth(year, month);
      const actualDay = Math.min(deadlineDay, lastDay);
      return new Date(year, month, actualDay);
    }
    
    // Get all active users
    const usersResult = await pool.query(
      `SELECT id, name, email, expo_push_token,
              notify_7_days_before, notify_1_day_before, notify_same_day
       FROM users 
       WHERE is_verified = TRUE AND is_active = TRUE`
    );

    console.log(`[Overdue Reminders] Processing ${usersResult.rows.length} users`);

    for (const user of usersResult.rows) {
      // Get all groups the user is in (exclude closed groups - they don't accept contributions)
      const groupsResult = await pool.query(
        `SELECT g.id, g.name, g.contribution_amount, g.currency, g.group_type,
                g.subscription_frequency, g.subscription_platform,
                g.subscription_deadline_day, g.subscription_deadline_month, g.deadline
         FROM groups g
         JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.user_id = $1 AND gm.status = 'active' AND g.status = 'active'`,
        [user.id]
      );

      // Track overdue contributions by days overdue (1, 3, 7, 14)
      const overdueByDays = {
        1: [],
        3: [],
        7: [],
        14: []
      };
      
      let userOverdueCount = 0;

      console.log(`[Overdue Reminders] User ${user.id} (${user.name}) is in ${groupsResult.rows.length} groups`);
      
      for (const group of groupsResult.rows) {
        // Get user's join date for this group
        const userJoinDateResult = await pool.query(
          `SELECT joined_at FROM group_members 
           WHERE group_id = $1 AND user_id = $2 AND status = 'active'`,
          [group.id, user.id]
        );
        
        if (userJoinDateResult.rows.length === 0) continue;
        const userJoinDate = new Date(userJoinDateResult.rows[0].joined_at);
        userJoinDate.setHours(0, 0, 0, 0);
        
        console.log(`[Overdue Reminders] Checking group ${group.id} (${group.group_name || group.name}, type: ${group.group_type}) for user ${user.id}`);

        if (group.group_type === 'birthday') {
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
            thisYearBirthday.setHours(0, 0, 0, 0);
            
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
              
              console.log(`[Overdue Reminders] Birthday group ${group.id} (${member.name}'s birthday): hasPaid=${hasPaid}, contributionCheck.rows.length=${contributionCheck.rows.length}, daysOverdue=${daysOverdue}, birthday=${thisYearBirthday.toISOString().split('T')[0]}`);

              // If not paid and overdue by 1, 3, 7, or 14 days, add to reminder list
              if (!hasPaid && (daysOverdue === 1 || daysOverdue === 3 || daysOverdue === 7 || daysOverdue === 14)) {
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
                  userOverdueCount++;
                  overdueByDays[daysOverdue].push({
                    groupId: group.id,
                    groupName: group.name,
                    groupType: 'birthday',
                    currency: group.currency || 'NGN',
                    contributionAmount: parseFloat(group.contribution_amount),
                    eventName: `${member.name}'s Birthday`,
                    deadlineDate: thisYearBirthday.toISOString().split('T')[0],
                    daysOverdue: daysOverdue,
                    relatedUserId: member.id
                  });
                  console.log(`[Overdue Reminders] Found overdue birthday: User ${user.id}, Group ${group.id}, ${daysOverdue} days overdue`);
                } else {
                  console.log(`[Overdue Reminders] Skipping - reminder already sent today for user ${user.id}, group ${group.id}, ${daysOverdue} days`);
                }
              } else if (hasPaid) {
                console.log(`[Overdue Reminders] User ${user.id} has already paid for birthday group ${group.id} (${member.name}'s birthday)`);
              } else if (daysOverdue < 1) {
                console.log(`[Overdue Reminders] Birthday group ${group.id} for user ${user.id}: birthday hasn't passed yet (${daysOverdue} days)`);
              } else if (daysOverdue > 14) {
                console.log(`[Overdue Reminders] Birthday group ${group.id} for user ${user.id}: too overdue (${daysOverdue} days, max is 14)`);
              } else {
                console.log(`[Overdue Reminders] Birthday group ${group.id} for user ${user.id}: daysOverdue=${daysOverdue}, not in reminder list (must be exactly 1,3,7,14)`);
              }
            }
          }
        } else if (group.group_type === 'subscription') {
          // Calculate subscription deadline
          let deadlineDate;
          if (group.subscription_frequency === 'monthly') {
            // For monthly, check current month's deadline first
            deadlineDate = getDeadlineDate(currentYear, currentMonth - 1, group.subscription_deadline_day);
            // If current month's deadline hasn't passed yet, check previous month
            if (deadlineDate > today) {
              const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
              const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
              deadlineDate = getDeadlineDate(prevYear, prevMonth - 1, group.subscription_deadline_day);
            }
          } else {
            // Annual - check if deadline has passed this year
            deadlineDate = getDeadlineDate(currentYear, group.subscription_deadline_month - 1, group.subscription_deadline_day);
            // If deadline hasn't passed yet this year, check last year's deadline
            if (deadlineDate > today) {
              deadlineDate = getDeadlineDate(currentYear - 1, group.subscription_deadline_month - 1, group.subscription_deadline_day);
            }
          }
          
          deadlineDate.setHours(0, 0, 0, 0);
          
          console.log(`[Overdue Reminders] Subscription group ${group.id}: deadline=${deadlineDate.toISOString().split('T')[0]}, today=${today.toISOString().split('T')[0]}, userJoined=${userJoinDate.toISOString().split('T')[0]}`);
          
          // Only consider overdue if deadline has passed and user was a member when deadline occurred
          if (deadlineDate < today && userJoinDate <= deadlineDate) {
            const daysOverdue = Math.floor((today - deadlineDate) / (1000 * 60 * 60 * 24));
            
            console.log(`[Overdue Reminders] Subscription group ${group.id}: daysOverdue=${daysOverdue}, checking payment status...`);
            
            // Check if user has paid for the period that includes this deadline
            let periodStart;
            if (group.subscription_frequency === 'monthly') {
              periodStart = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), 1);
            } else {
              periodStart = new Date(deadlineDate.getFullYear(), 0, 1);
            }
            
            const contributionCheck = await pool.query(
              `SELECT id, status FROM subscription_contributions 
               WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3`,
              [group.id, user.id, periodStart]
            );

            const hasPaid = contributionCheck.rows.length > 0 && 
                           (contributionCheck.rows[0].status === 'paid' || 
                            contributionCheck.rows[0].status === 'confirmed');

            // If not paid and overdue by 1, 3, 7, or 14 days, add to reminder list
            if (!hasPaid && (daysOverdue === 1 || daysOverdue === 3 || daysOverdue === 7 || daysOverdue === 14)) {
              const reminderCheck = await pool.query(
                `SELECT id FROM notifications 
                 WHERE user_id = $1 AND type = 'overdue_contribution' 
                 AND created_at::date = CURRENT_DATE
                 AND message LIKE $2
                 AND group_id = $3`,
                [user.id, `%${daysOverdue} days overdue%`, group.id]
              );

              if (reminderCheck.rows.length === 0) {
                userOverdueCount++;
                overdueByDays[daysOverdue].push({
                  groupId: group.id,
                  groupName: group.name,
                  groupType: 'subscription',
                  currency: group.currency || 'NGN',
                  contributionAmount: parseFloat(group.contribution_amount),
                  subscriptionPlatform: group.subscription_platform,
                  subscriptionFrequency: group.subscription_frequency,
                  eventName: `${group.subscription_platform} Subscription`,
                  deadlineDate: deadlineDate.toISOString().split('T')[0],
                  daysOverdue: daysOverdue,
                  relatedUserId: null
                });
                console.log(`[Overdue Reminders] Found overdue subscription: User ${user.id}, Group ${group.id}, ${daysOverdue} days overdue`);
              } else {
                console.log(`[Overdue Reminders] Skipping - reminder already sent today for user ${user.id}, group ${group.id}, ${daysOverdue} days`);
              }
            } else if (hasPaid) {
              console.log(`[Overdue Reminders] User ${user.id} has already paid for subscription group ${group.id}`);
            } else if (daysOverdue < 1) {
              console.log(`[Overdue Reminders] Subscription group ${group.id} for user ${user.id}: deadline hasn't passed yet (${daysOverdue} days)`);
            } else if (daysOverdue > 14) {
              console.log(`[Overdue Reminders] Subscription group ${group.id} for user ${user.id}: too overdue (${daysOverdue} days, max is 14)`);
            } else {
              console.log(`[Overdue Reminders] Subscription group ${group.id} for user ${user.id}: daysOverdue=${daysOverdue}, not in reminder list (must be exactly 1,3,7,14)`);
            }
          }
        } else if (group.group_type === 'general' && group.deadline) {
          // Check if general group deadline has passed
          const deadlineDate = new Date(group.deadline);
          deadlineDate.setHours(0, 0, 0, 0);
          
          console.log(`[Overdue Reminders] General group ${group.id}: deadline=${deadlineDate.toISOString().split('T')[0]}, today=${today.toISOString().split('T')[0]}, userJoined=${userJoinDate.toISOString().split('T')[0]}`);
          
          // Only consider overdue if deadline has passed and user was a member when deadline occurred
          if (deadlineDate < today && userJoinDate <= deadlineDate) {
            const daysOverdue = Math.floor((today - deadlineDate) / (1000 * 60 * 60 * 24));
            
            console.log(`[Overdue Reminders] General group ${group.id}: daysOverdue=${daysOverdue}, checking payment status...`);
            
            // Check if user has paid
            const contributionCheck = await pool.query(
              `SELECT id, status FROM general_contributions 
               WHERE group_id = $1 AND contributor_id = $2`,
              [group.id, user.id]
            );

            const hasPaid = contributionCheck.rows.length > 0 && 
                           (contributionCheck.rows[0].status === 'paid' || 
                            contributionCheck.rows[0].status === 'confirmed');

            // If not paid and overdue by 1, 3, 7, or 14 days, add to reminder list
            if (!hasPaid && (daysOverdue === 1 || daysOverdue === 3 || daysOverdue === 7 || daysOverdue === 14)) {
              const reminderCheck = await pool.query(
                `SELECT id FROM notifications 
                 WHERE user_id = $1 AND type = 'overdue_contribution' 
                 AND created_at::date = CURRENT_DATE
                 AND message LIKE $2
                 AND group_id = $3`,
                [user.id, `%${daysOverdue} days overdue%`, group.id]
              );

              if (reminderCheck.rows.length === 0) {
                userOverdueCount++;
                overdueByDays[daysOverdue].push({
                  groupId: group.id,
                  groupName: group.name,
                  groupType: 'general',
                  currency: group.currency || 'NGN',
                  contributionAmount: parseFloat(group.contribution_amount),
                  eventName: group.name,
                  deadlineDate: group.deadline,
                  daysOverdue: daysOverdue,
                  relatedUserId: null
                });
                console.log(`[Overdue Reminders] Found overdue general: User ${user.id}, Group ${group.id}, ${daysOverdue} days overdue`);
              } else {
                console.log(`[Overdue Reminders] Skipping - reminder already sent today for user ${user.id}, group ${group.id}, ${daysOverdue} days`);
              }
            } else if (hasPaid) {
              console.log(`[Overdue Reminders] User ${user.id} has already paid for general group ${group.id}`);
            } else if (daysOverdue < 1) {
              console.log(`[Overdue Reminders] General group ${group.id} for user ${user.id}: deadline hasn't passed yet (${daysOverdue} days)`);
            } else if (daysOverdue > 14) {
              console.log(`[Overdue Reminders] General group ${group.id} for user ${user.id}: too overdue (${daysOverdue} days, max is 14)`);
            } else {
              console.log(`[Overdue Reminders] General group ${group.id} for user ${user.id}: daysOverdue=${daysOverdue}, not in reminder list (must be exactly 1,3,7,14)`);
            }
          }
        }
      }

      // Send reminders for each overdue period (1, 3, 7, 14 days)
      for (const [daysOverdue, overdueList] of Object.entries(overdueByDays)) {
        const daysNum = parseInt(daysOverdue);
        
        if (overdueList.length === 0) {
          continue;
        }

        // Check user preferences - use same_day preference for overdue reminders
        if (!user.notify_same_day) {
          console.log(`[Overdue Reminders] Skipping user ${user.id} - notify_same_day is false`);
          continue; // Skip if user doesn't want same-day notifications
        }
        
        console.log(`[Overdue Reminders] Processing ${overdueList.length} overdue items for user ${user.id} at ${daysNum} days overdue`);

        // Send notification for each overdue contribution
        for (const overdue of overdueList) {
          const title = daysNum === 1
            ? 'Reminder: Overdue Contribution - 1 Day'
            : daysNum === 3 
            ? '⚠️ Overdue Contribution - 3 Days'
            : daysNum === 7
            ? '⚠️ Overdue Contribution - 7 Days'
            : '⚠️ Overdue Contribution - 14 Days';
          
          let message = '';
          if (overdue.groupType === 'birthday') {
            message = `${overdue.eventName} was ${daysNum} ${daysNum === 1 ? 'day' : 'days'} ago. Please send your contribution of ${overdue.contributionAmount} ${overdue.currency} in ${overdue.groupName}.`;
          } else if (overdue.groupType === 'subscription') {
            message = `Upcoming subscription ${overdue.subscriptionPlatform} in ${overdue.groupName} deadline was ${daysNum} ${daysNum === 1 ? 'day' : 'days'} ago. Please send your contribution of ${overdue.contributionAmount} ${overdue.currency}.`;
          } else if (overdue.groupType === 'general') {
            message = `Deadline for ${overdue.groupName} was ${daysNum} ${daysNum === 1 ? 'day' : 'days'} ago. Please send your contribution of ${overdue.contributionAmount} ${overdue.currency}.`;
          }

          await createNotification(
            user.id,
            'overdue_contribution',
            title,
            message,
            overdue.groupId,
            overdue.relatedUserId
          );
          console.log(`[Overdue Reminders] Sent notification to user ${user.id} for ${overdue.groupName} (${daysNum} days overdue)`);
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
                groupType: o.groupType,
                currency: o.currency,
                contributionAmount: o.contributionAmount,
                eventName: o.eventName,
                deadlineDate: o.deadlineDate,
                subscriptionPlatform: o.subscriptionPlatform,
                subscriptionFrequency: o.subscriptionFrequency
              }))
            );
            console.log(`[Overdue Reminders] Sent email to ${user.email} for ${overdueList.length} overdue items`);
          } catch (err) {
            console.error(`[Overdue Reminders] Error sending email to ${user.email}:`, err);
          }
        } else if (!user.email) {
          console.log(`[Overdue Reminders] User ${user.id} has no email address`);
        }
      }
      
      if (userOverdueCount > 0) {
        console.log(`[Overdue Reminders] User ${user.id} (${user.name}) has ${userOverdueCount} overdue contribution(s)`);
      }
    }

    console.log('[Overdue Reminders] Overdue contributions check completed');
  } catch (error) {
    console.error('Error checking overdue contributions:', error);
  }
}

module.exports = { checkBirthdayReminders, checkOverdueContributions };
