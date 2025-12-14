const pool = require('../config/database');
const { createNotification } = require('../utils/notifications');
const { sendBirthdayEmail } = require('../utils/email');

/**
 * Check for upcoming birthdays and send reminder notifications
 * This should be run daily (e.g., via cron job)
 */
async function checkBirthdayReminders() {
  try {
    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];
    
    // Get all active users with their notification preferences
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
      
      // Check if it's the user's birthday today
      if (daysUntil === 0) {
        // Send birthday wish notification
        await createNotification(
          user.id,
          'birthday_wish',
          '🎉 Happy Birthday!',
          `Happy Birthday, ${user.name}! 🎂🎉 Wishing you a wonderful day filled with joy and celebration!`,
          null,
          user.id
        );

        // Send birthday email to the celebrant
        if (user.email) {
          try {
            // Send email (non-blocking - don't fail if email fails)
            await sendBirthdayEmail(user.email, user.name);
            console.log(`Birthday email sent successfully to ${user.email}`);
          } catch (err) {
            console.error(`Error sending birthday email to ${user.email}:`, err);
            // Don't throw - email is non-critical, continue with other users
          }
        }
      }
      
      // Get all groups the user is in
      const groupsResult = await pool.query(
        `SELECT g.id, g.name, g.contribution_amount
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
          
          // Check if user wants to be notified for this reminder time
          if (daysUntilMemberBirthday === 7 && user.notify_7_days_before) {
            await createNotification(
              user.id,
              'birthday_reminder',
              'Birthday Reminder',
              `Reminder: ${member.name}'s birthday is in 7 days. Don't forget to pay ₦${parseFloat(group.contribution_amount).toLocaleString('en-NG')} in ${group.name}.`,
              group.id,
              member.id
            );
          } else if (daysUntilMemberBirthday === 1 && user.notify_1_day_before) {
            await createNotification(
              user.id,
              'birthday_reminder',
              'Birthday Reminder',
              `Reminder: ${member.name}'s birthday is tomorrow! Don't forget to pay ₦${parseFloat(group.contribution_amount).toLocaleString('en-NG')} in ${group.name}.`,
              group.id,
              member.id
            );
          } else if (daysUntilMemberBirthday === 0 && user.notify_same_day) {
            // Check if user has already paid
            const contributionCheck = await pool.query(
              `SELECT id FROM birthday_contributions 
               WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3 AND status = 'paid'`,
              [group.id, member.id, user.id]
            );
            
            if (contributionCheck.rows.length === 0) {
              // User hasn't paid yet, send reminder
              await createNotification(
                user.id,
                'birthday_reminder',
                'Birthday Reminder - Action Required',
                `Today is ${member.name}'s birthday! Please mark your contribution of ₦${parseFloat(group.contribution_amount).toLocaleString('en-NG')} as paid in ${group.name}.`,
                group.id,
                member.id
              );
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
