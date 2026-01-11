const pool = require('../config/database');
const {
  processBirthdayPayments,
  processSubscriptionPayments,
  processGeneralPayments,
} = require('../services/autoPaymentProcessor');

/**
 * Scheduled job to process birthday payments
 * Should run daily at 9 AM local time
 * Checks for birthdays today (or 1 day before based on payment_timing)
 */
async function processBirthdayPaymentsJob() {
  try {
    console.log('🔄 Starting birthday payments processing job...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();

    // Get all active birthday groups
    const groupsResult = await pool.query(
      `SELECT DISTINCT g.id
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       JOIN user_payment_preferences upp ON gm.user_id = upp.user_id AND upp.group_id = g.id
       WHERE g.group_type = 'birthday' 
         AND g.status = 'active'
         AND gm.status = 'active'
         AND upp.auto_pay_enabled = TRUE`,
      []
    );

    console.log(`Found ${groupsResult.rows.length} birthday groups with auto-pay enabled`);

    let totalProcessed = 0;
    let totalSkipped = 0;

    for (const group of groupsResult.rows) {
      try {
        // Get all active members with birthdays today or tomorrow (based on payment_timing)
        // For 'same_day': Process on birthday (today)
        // For '1_day_before': Process 1 day before birthday (tomorrow's birthday = process today)
        const membersResult = await pool.query(
          `SELECT DISTINCT u.id, u.birthday, upp.payment_timing
           FROM users u
           JOIN group_members gm ON u.id = gm.user_id
           JOIN user_payment_preferences upp ON u.id = upp.user_id AND upp.group_id = $1
           WHERE gm.group_id = $1 
             AND gm.status = 'active'
             AND upp.auto_pay_enabled = TRUE
             AND u.birthday IS NOT NULL
             AND (
               -- Birthday today and payment_timing is 'same_day' (process today)
               (DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE)
                AND DATE_PART('day', u.birthday) = DATE_PART('day', CURRENT_DATE)
                AND upp.payment_timing = 'same_day')
               OR
               -- Birthday tomorrow and payment_timing is '1_day_before' (process today, 1 day before)
               (DATE_PART('month', u.birthday) = DATE_PART('month', CURRENT_DATE + INTERVAL '1 day')
                AND DATE_PART('day', u.birthday) = DATE_PART('day', CURRENT_DATE + INTERVAL '1 day')
                AND upp.payment_timing = '1_day_before')
             )`,
          [group.id]
        );

        for (const member of membersResult.rows) {
          try {
            const result = await processBirthdayPayments(member.id, group.id);
            if (result.processed > 0) {
              totalProcessed += result.processed;
            }
            if (result.skipped) {
              totalSkipped++;
            }
          } catch (error) {
            console.error(`Error processing birthday payments for user ${member.id} in group ${group.id}:`, error);
          }
        }
      } catch (error) {
        console.error(`Error processing group ${group.id}:`, error);
      }
    }

    console.log(`✅ Birthday payments job completed: ${totalProcessed} payments processed, ${totalSkipped} skipped`);
    return {
      success: true,
      processed: totalProcessed,
      skipped: totalSkipped,
    };
  } catch (error) {
    console.error('❌ Error in birthday payments job:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Scheduled job to process subscription deadline payments
 * Should run daily at 9 AM local time
 * Checks for subscription deadlines today (or 1 day before based on payment_timing)
 */
async function processSubscriptionPaymentsJob() {
  try {
    console.log('🔄 Starting subscription payments processing job...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    // Get all active subscription groups with auto-pay enabled
    const groupsResult = await pool.query(
      `SELECT DISTINCT g.id, g.subscription_frequency, g.subscription_deadline_day, g.subscription_deadline_month
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       JOIN user_payment_preferences upp ON gm.user_id = upp.user_id AND upp.group_id = g.id
       WHERE g.group_type = 'subscription' 
         AND g.status = 'active'
         AND gm.status = 'active'
         AND upp.auto_pay_enabled = TRUE`,
      []
    );

    console.log(`Found ${groupsResult.rows.length} subscription groups with auto-pay enabled`);

    let totalProcessed = 0;
    let totalSkipped = 0;

    for (const group of groupsResult.rows) {
      try {
        // Calculate deadline date for current period
        const deadlineDay = group.subscription_deadline_day;
        const deadlineMonth = group.subscription_frequency === 'annual' 
          ? group.subscription_deadline_month 
          : currentMonth;

        const lastDayOfMonth = new Date(currentYear, deadlineMonth, 0).getDate();
        const actualDeadlineDay = Math.min(deadlineDay, lastDayOfMonth);
        const deadlineDate = new Date(currentYear, deadlineMonth - 1, actualDeadlineDay);
        deadlineDate.setHours(0, 0, 0, 0);

        // Check if deadline is today or tomorrow (based on payment_timing)
        const deadlineDayOfYear = Math.floor((deadlineDate - new Date(currentYear, 0, 1)) / (1000 * 60 * 60 * 24));
        const todayDayOfYear = Math.floor((today - new Date(currentYear, 0, 1)) / (1000 * 60 * 60 * 24));
        const tomorrowDayOfYear = todayDayOfYear + 1;

        // Check if any member has payment_timing that matches today or tomorrow
        const shouldProcess = await pool.query(
          `SELECT COUNT(*) as count
           FROM user_payment_preferences upp
           WHERE upp.group_id = $1 
             AND upp.auto_pay_enabled = TRUE
             AND (
               -- Deadline today and payment_timing is 'same_day'
               ($2 = $3 AND upp.payment_timing = 'same_day')
               OR
               -- Deadline tomorrow and payment_timing is '1_day_before'
               ($2 = $4 AND upp.payment_timing = '1_day_before')
             )`,
          [group.id, deadlineDayOfYear, todayDayOfYear, tomorrowDayOfYear]
        );

        if (parseInt(shouldProcess.rows[0].count) === 0) {
          continue; // No payments to process today
        }

        const result = await processSubscriptionPayments(group.id);
        if (result.processed > 0) {
          totalProcessed += result.processed;
        }
        if (result.skipped) {
          totalSkipped++;
        }
      } catch (error) {
        console.error(`Error processing subscription payments for group ${group.id}:`, error);
      }
    }

    console.log(`✅ Subscription payments job completed: ${totalProcessed} payments processed, ${totalSkipped} skipped`);
    return {
      success: true,
      processed: totalProcessed,
      skipped: totalSkipped,
    };
  } catch (error) {
    console.error('❌ Error in subscription payments job:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Scheduled job to process general group deadline payments
 * Should run daily at 9 AM local time
 * Checks for general group deadlines today (or 1 day before based on payment_timing)
 */
async function processGeneralPaymentsJob() {
  try {
    console.log('🔄 Starting general group payments processing job...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all active general groups with deadlines and auto-pay enabled
    const groupsResult = await pool.query(
      `SELECT DISTINCT g.id, g.deadline
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       JOIN user_payment_preferences upp ON gm.user_id = upp.user_id AND upp.group_id = g.id
       WHERE g.group_type = 'general' 
         AND g.status = 'active'
         AND g.deadline IS NOT NULL
         AND gm.status = 'active'
         AND upp.auto_pay_enabled = TRUE`,
      []
    );

    console.log(`Found ${groupsResult.rows.length} general groups with auto-pay enabled`);

    let totalProcessed = 0;
    let totalSkipped = 0;

    for (const group of groupsResult.rows) {
      try {
        const deadlineDate = new Date(group.deadline);
        deadlineDate.setHours(0, 0, 0, 0);

        // Check if deadline is today or tomorrow (based on payment_timing)
        const deadlineDayOfYear = Math.floor((deadlineDate - new Date(deadlineDate.getFullYear(), 0, 1)) / (1000 * 60 * 60 * 24));
        const todayDayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 1)) / (1000 * 60 * 60 * 24));
        const tomorrowDayOfYear = todayDayOfYear + 1;

        // Check if any member has payment_timing that matches today or tomorrow
        const shouldProcess = await pool.query(
          `SELECT COUNT(*) as count
           FROM user_payment_preferences upp
           WHERE upp.group_id = $1 
             AND upp.auto_pay_enabled = TRUE
             AND (
               -- Deadline today and payment_timing is 'same_day'
               ($2 = $3 AND upp.payment_timing = 'same_day')
               OR
               -- Deadline tomorrow and payment_timing is '1_day_before'
               ($2 = $4 AND upp.payment_timing = '1_day_before')
             )`,
          [group.id, deadlineDayOfYear, todayDayOfYear, tomorrowDayOfYear]
        );

        if (parseInt(shouldProcess.rows[0].count) === 0) {
          continue; // No payments to process today
        }

        const result = await processGeneralPayments(group.id);
        if (result.processed > 0) {
          totalProcessed += result.processed;
        }
        if (result.skipped) {
          totalSkipped++;
        }
      } catch (error) {
        console.error(`Error processing general payments for group ${group.id}:`, error);
      }
    }

    console.log(`✅ General group payments job completed: ${totalProcessed} payments processed, ${totalSkipped} skipped`);
    return {
      success: true,
      processed: totalProcessed,
      skipped: totalSkipped,
    };
  } catch (error) {
    console.error('❌ Error in general group payments job:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Main job function that runs all payment processing jobs
 * Should be called by a scheduled job (cron, etc.) daily at 9 AM local time
 */
async function processAllAutoPayments() {
  try {
    console.log('🚀 Starting automatic payment processing for all group types...');
    
    const birthdayResult = await processBirthdayPaymentsJob();
    const subscriptionResult = await processSubscriptionPaymentsJob();
    const generalResult = await processGeneralPaymentsJob();

    const totalProcessed = (birthdayResult.processed || 0) + 
                          (subscriptionResult.processed || 0) + 
                          (generalResult.processed || 0);
    const totalSkipped = (birthdayResult.skipped || 0) + 
                        (subscriptionResult.skipped || 0) + 
                        (generalResult.skipped || 0);

    console.log(`✅ All automatic payment processing completed:
      - Birthday payments: ${birthdayResult.processed || 0} processed, ${birthdayResult.skipped || 0} skipped
      - Subscription payments: ${subscriptionResult.processed || 0} processed, ${subscriptionResult.skipped || 0} skipped
      - General payments: ${generalResult.processed || 0} processed, ${generalResult.skipped || 0} skipped
      - Total: ${totalProcessed} processed, ${totalSkipped} skipped`);

    return {
      success: true,
      birthday: birthdayResult,
      subscription: subscriptionResult,
      general: generalResult,
      total: {
        processed: totalProcessed,
        skipped: totalSkipped,
      },
    };
  } catch (error) {
    console.error('❌ Error in automatic payment processing:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Run if called directly (for testing)
if (require.main === module) {
  processAllAutoPayments()
    .then((result) => {
      console.log('Automatic payment processing completed:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Automatic payment processing failed:', error);
      process.exit(1);
    });
}

module.exports = {
  processBirthdayPaymentsJob,
  processSubscriptionPaymentsJob,
  processGeneralPaymentsJob,
  processAllAutoPayments,
};
