const pool = require('../config/database');
const paymentService = require('./paymentService');
const {
  checkDefaulterStatus,
  logPaymentAction,
} = require('../utils/paymentHelpers');
const {
  creditWallet,
  recordPaymentAttempt,
  updatePaymentAttempt,
  isContributionConfirmed,
} = require('../utils/walletHelpers');
const {
  sendAutoPayDisabledEmail,
  sendPaymentFailureEmail,
} = require('../utils/email');
const { createNotification } = require('../utils/notifications');

/**
 * Automatic Payment Processing Service
 * Handles automatic payment collection for birthdays, subscriptions, and general groups
 */

/**
 * Process automatic payments for a birthday
 * @param {string} userId - Birthday person's user ID
 * @param {string} groupId - Group ID
 * @returns {Promise<Object>} - Processing result
 */
async function processBirthdayPayments(userId, groupId) {
  try {
    console.log(`Processing birthday payments for user ${userId} in group ${groupId}`);

    // Get group details
    const groupResult = await pool.query(
      `SELECT id, name, contribution_amount, currency, admin_id
       FROM groups WHERE id = $1 AND group_type = 'birthday'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return {
        success: false,
        error: 'Birthday group not found',
      };
    }

    const group = groupResult.rows[0];

    // CRITICAL: Check if birthday person (recipient) is a defaulter
    const recipientDefaulterStatus = await checkDefaulterStatus(userId);
    if (recipientDefaulterStatus.hasOverdue) {
      // Skip ALL auto-payments if recipient is defaulter
      console.log(`Skipping birthday payments: Recipient ${userId} has overdue payments`);

      // Get recipient and members info for notifications
      const recipientResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );
      const recipient = recipientResult.rows[0];

      // Notify birthday person
      if (recipient && recipient.email) {
        try {
          // TODO: Create and send notification email to recipient
          await createNotification(
            userId,
            'payment_skipped',
            'Auto-Pay Skipped - Overdue Payments',
            'You have overdue payments. Please pay manually to receive contributions.',
            groupId,
            null
          );
        } catch (error) {
          console.error('Error notifying recipient:', error);
        }
      }

      // Notify ALL members with auto-pay enabled
      const autoPayMembers = await pool.query(
        `SELECT DISTINCT u.id, u.email, u.name
         FROM users u
         JOIN user_payment_preferences upp ON u.id = upp.user_id
         WHERE upp.group_id = $1 AND upp.auto_pay_enabled = TRUE
         AND EXISTS (
           SELECT 1 FROM group_members gm
           WHERE gm.group_id = $1 AND gm.user_id = u.id AND gm.status = 'active'
         )`,
        [groupId]
      );

      for (const member of autoPayMembers.rows) {
        try {
          await createNotification(
            member.id,
            'payment_skipped',
            'Auto-Pay Skipped',
            `Auto-pay skipped: ${recipient?.name || 'Birthday person'} has overdue payments. Auto-pay will resume once they clear their overdue contributions.`,
            groupId,
            userId
          );
        } catch (error) {
          console.error(`Error notifying member ${member.id}:`, error);
        }
      }

      return {
        skipped: true,
        recipient_is_defaulter: true,
        reason: 'Recipient has overdue payments',
        notifications_sent: true,
        processed: 0,
      };
    }

    // Get all active members with auto-pay enabled
    // Exclude only the birthday person (celebrant) - they receive contributions
    // Note: Admin can pay if they're not the birthday person
    // Co-admins and regular members can also pay
    const membersResult = await pool.query(
      `SELECT 
        u.id, u.email, u.name, u.stripe_customer_id, u.paystack_customer_code,
        upp.payment_method_id, upp.payment_timing, upp.provider, upp.id as preference_id
       FROM users u
       JOIN user_payment_preferences upp ON u.id = upp.user_id
       WHERE upp.group_id = $1 AND upp.auto_pay_enabled = TRUE
       AND EXISTS (
         SELECT 1 FROM group_members gm
         WHERE gm.group_id = $1 AND gm.user_id = u.id AND gm.status = 'active'
       )
       AND u.id != $2`,
      [groupId, userId] // userId is the birthday person (celebrant) - exclude them
    );

    const skippedDefaulters = [];
    const skippedAlreadyPaid = [];
    let processedCount = 0;

    // Process each member
    for (const member of membersResult.rows) {
      try {
        // Check if member is a defaulter (has overdue payments)
        const memberDefaulterStatus = await checkDefaulterStatus(member.id);
        if (memberDefaulterStatus.hasOverdue) {
          skippedDefaulters.push({
            userId: member.id,
            name: member.name,
            overdueAmount: memberDefaulterStatus.totalOverdue,
          });

          // Notify member
          await createNotification(
            member.id,
            'payment_skipped',
            'Auto-Pay Skipped - Overdue Payments',
            'You have overdue payments. Please pay manually first.',
            groupId,
            null
          );

          continue;
        }

        // CRITICAL: Check if contribution already exists and is paid/confirmed
        const existingContribution = await pool.query(
          `SELECT id, status FROM birthday_contributions
           WHERE group_id = $1 AND birthday_user_id = $2 AND contributor_id = $3
           AND EXTRACT(YEAR FROM contribution_date) = EXTRACT(YEAR FROM CURRENT_DATE)`,
          [groupId, userId, member.id]
        );

        if (existingContribution.rows.length > 0) {
          const contributionStatus = existingContribution.rows[0].status;
          if (contributionStatus === 'paid' || contributionStatus === 'confirmed') {
            skippedAlreadyPaid.push({
              userId: member.id,
              name: member.name,
              contributionId: existingContribution.rows[0].id,
            });
            continue; // Skip auto-debit - already paid manually
          }
        }

        // CRITICAL: Check for pending payment attempts to prevent duplicate charges
        const contributionIdForCheck = existingContribution.rows.length > 0 ? existingContribution.rows[0].id : null;
        
        let pendingAttemptQuery;
        let pendingAttemptParams;
        
        if (contributionIdForCheck) {
          pendingAttemptQuery = `
            SELECT id, status, created_at FROM automatic_payment_attempts
            WHERE user_id = $1 AND group_id = $2 AND contribution_type = 'birthday'
            AND (contribution_id = $3 OR contribution_id IS NULL)
            AND status IN ('pending', 'retry')
            ORDER BY created_at DESC
            LIMIT 1
          `;
          pendingAttemptParams = [member.id, groupId, contributionIdForCheck];
        } else {
          pendingAttemptQuery = `
            SELECT id, status, created_at FROM automatic_payment_attempts
            WHERE user_id = $1 AND group_id = $2 AND contribution_type = 'birthday'
            AND contribution_id IS NULL
            AND status IN ('pending', 'retry')
            ORDER BY created_at DESC
            LIMIT 1
          `;
          pendingAttemptParams = [member.id, groupId];
        }
        
        const pendingAttemptCheck = await pool.query(pendingAttemptQuery, pendingAttemptParams);

        if (pendingAttemptCheck.rows.length > 0) {
          const attempt = pendingAttemptCheck.rows[0];
          const attemptAge = Date.now() - new Date(attempt.created_at).getTime();
          const oneHour = 60 * 60 * 1000;

          if (attemptAge < oneHour) {
            console.log(`Skipping birthday payment for member ${member.id}: Pending payment attempt exists (attempt ID: ${attempt.id})`);
            continue;
          }
          console.log(`Found old pending attempt (${Math.round(attemptAge / 1000 / 60)} minutes old) for member ${member.id}, proceeding with new attempt`);
        }

        // Calculate payment timing (check if payment should happen today)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const birthdayUser = await pool.query(
          'SELECT birthday FROM users WHERE id = $1',
          [userId]
        );
        
        if (birthdayUser.rows.length === 0 || !birthdayUser.rows[0].birthday) {
          continue; // Skip if no birthday
        }

        const birthday = new Date(birthdayUser.rows[0].birthday);
        const thisYearBirthday = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
        thisYearBirthday.setHours(0, 0, 0, 0);

        // Calculate when payment should be processed based on payment_timing
        const paymentDate = member.payment_timing === '1_day_before'
          ? new Date(thisYearBirthday.getTime() - 24 * 60 * 60 * 1000)
          : thisYearBirthday;

        paymentDate.setHours(0, 0, 0, 0);

        // Check if payment should be processed today
        if (paymentDate.getTime() !== today.getTime()) {
          continue; // Not today - skip
        }

        // Process payment
        const contributionAmount = parseFloat(group.contribution_amount);
        const currency = group.currency;
        if (!currency) {
          console.error(`Group ${groupId} has no currency set`);
          continue; // Skip this payment - group must have currency
        }

        // Calculate fees
        const provider = member.provider || paymentService.selectProvider(currency, null);
        const fees = paymentService.calculateFees(contributionAmount, currency, provider, 1);

        // Get or create contribution record
        let contributionId;
        if (existingContribution.rows.length > 0) {
          contributionId = existingContribution.rows[0].id;
        } else {
          const contributionResult = await pool.query(
            `INSERT INTO birthday_contributions
             (group_id, birthday_user_id, contributor_id, amount, contribution_date, status)
             VALUES ($1, $2, $3, $4, CURRENT_DATE, 'not_paid')
             RETURNING id`,
            [groupId, userId, member.id, contributionAmount]
          );
          contributionId = contributionResult.rows[0].id;
        }

        // Record payment attempt
        const attemptId = await recordPaymentAttempt({
          userId: member.id,
          groupId,
          contributionType: 'birthday',
          contributionId,
          amount: contributionAmount,
          currency,
          status: 'pending',
          paymentProvider: provider,
          retryCount: 0,
        });

        // Charge payment
        const customerId = provider === 'stripe' 
          ? member.stripe_customer_id 
          : member.paystack_customer_code;

        if (!customerId || !member.payment_method_id) {
          console.log(`Skipping member ${member.id}: No payment method or customer ID`);
          continue;
        }

        const chargeResult = await paymentService.chargePaymentMethod({
          paymentMethodId: member.payment_method_id,
          amount: fees.grossAmount, // Charge gross amount (contribution + fees)
          currency,
          customerId,
          description: `Auto-debit contribution for ${group.name}`,
          metadata: {
            contributionType: 'birthday',
            contributionId,
            groupId,
            userId: member.id,
            recipientId: userId,
            contributionAmount,
            platformFee: fees.platformFee,
            processorFee: fees.processorFee,
            grossAmount: fees.grossAmount,
            attemptId,
            retryCount: 0,
          },
        }, provider);

        if (chargeResult.success) {
          // Payment will be confirmed via webhook
          // Webhook will credit wallet and update status
          processedCount++;
          console.log(`Payment processed successfully for member ${member.id}: ${chargeResult.transactionId}`);
        } else {
          // Handle payment failure
          await handlePaymentFailure({
            attemptId,
            memberId: member.id,
            memberName: member.name,
            memberEmail: member.email,
            groupId,
            groupName: group.name,
            contributionType: 'birthday',
            contributionId,
            amount: contributionAmount,
            currency,
            errorMessage: chargeResult.error,
            retryCount: 0,
            provider,
          });
        }
      } catch (error) {
        console.error(`Error processing payment for member ${member.id}:`, error);
        // Continue with next member
      }
    }

    return {
      processed: processedCount,
      skipped_defaulters: skippedDefaulters,
      skipped_already_paid: skippedAlreadyPaid,
      recipient_is_defaulter: false,
      notifications_sent: skippedDefaulters.length > 0,
    };
  } catch (error) {
    console.error('Error processing birthday payments:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Process automatic payments for subscription deadline
 * @param {string} groupId - Group ID
 * @returns {Promise<Object>} - Processing result
 */
async function processSubscriptionPayments(groupId) {
  try {
    console.log(`Processing subscription payments for group ${groupId}`);

    // Get group details
    const groupResult = await pool.query(
      `SELECT id, name, contribution_amount, currency, admin_id,
              subscription_frequency, subscription_deadline_day, subscription_deadline_month
       FROM groups WHERE id = $1 AND group_type = 'subscription'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return {
        success: false,
        error: 'Subscription group not found',
      };
    }

    const group = groupResult.rows[0];
    const adminId = group.admin_id;

    // CRITICAL: Check if admin (recipient) is a defaulter
    const recipientDefaulterStatus = await checkDefaulterStatus(adminId);
    if (recipientDefaulterStatus.hasOverdue) {
      // Skip ALL auto-payments if recipient is defaulter
      console.log(`Skipping subscription payments: Admin ${adminId} has overdue payments`);

      // Notify admin
      const adminResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [adminId]
      );
      const admin = adminResult.rows[0];

      if (admin && admin.email) {
        await createNotification(
          adminId,
          'payment_skipped',
          'Auto-Pay Skipped - Overdue Payments',
          'You have overdue payments. Please pay manually to receive contributions.',
          groupId,
          null
        );
      }

      // Notify ALL members with auto-pay enabled
      const autoPayMembers = await pool.query(
        `SELECT DISTINCT u.id, u.email, u.name
         FROM users u
         JOIN user_payment_preferences upp ON u.id = upp.user_id
         WHERE upp.group_id = $1 AND upp.auto_pay_enabled = TRUE
         AND EXISTS (
           SELECT 1 FROM group_members gm
           WHERE gm.group_id = $1 AND gm.user_id = u.id AND gm.status = 'active'
         )`,
        [groupId]
      );

      for (const member of autoPayMembers.rows) {
        try {
          await createNotification(
            member.id,
            'payment_skipped',
            'Auto-Pay Skipped',
            `Auto-pay skipped: ${admin?.name || 'Admin'} has overdue payments. Auto-pay will resume once they clear their overdue contributions.`,
            groupId,
            adminId
          );
        } catch (error) {
          console.error(`Error notifying member ${member.id}:`, error);
        }
      }

      return {
        skipped: true,
        recipient_is_defaulter: true,
        reason: 'Admin has overdue payments',
        notifications_sent: true,
        processed: 0,
      };
    }

    // Calculate current subscription period
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    let periodStart, periodEnd;
    if (group.subscription_frequency === 'monthly') {
      periodStart = new Date(currentYear, currentMonth - 1, 1);
      periodEnd = new Date(currentYear, currentMonth, 0); // Last day of month
    } else {
      // Annual
      periodStart = new Date(currentYear, 0, 1);
      periodEnd = new Date(currentYear, 11, 31);
    }

    // Calculate deadline date
    const deadlineDay = group.subscription_deadline_day;
    const deadlineMonth = group.subscription_frequency === 'annual' 
      ? group.subscription_deadline_month 
      : currentMonth;

    const lastDayOfMonth = new Date(currentYear, deadlineMonth, 0).getDate();
    const actualDeadlineDay = Math.min(deadlineDay, lastDayOfMonth);
    const deadlineDate = new Date(currentYear, deadlineMonth - 1, actualDeadlineDay);
    deadlineDate.setHours(0, 0, 0, 0);

    // Get all active members with auto-pay enabled
    // Exclude only the admin (group creator) - they receive contributions
    // Co-admins and regular members can pay (they're not excluded)
    const membersResult = await pool.query(
      `SELECT 
        u.id, u.email, u.name, u.stripe_customer_id, u.paystack_customer_code,
        upp.payment_method_id, upp.payment_timing, upp.provider, upp.id as preference_id
       FROM users u
       JOIN user_payment_preferences upp ON u.id = upp.user_id
       WHERE upp.group_id = $1 AND upp.auto_pay_enabled = TRUE
       AND EXISTS (
         SELECT 1 FROM group_members gm
         WHERE gm.group_id = $1 AND gm.user_id = u.id AND gm.status = 'active'
       )
       AND u.id != $2`,
      [groupId, adminId] // adminId is the group creator - exclude them, but co-admins are included
    );

    const skippedDefaulters = [];
    const skippedAlreadyPaid = [];
    let processedCount = 0;

    // Process each member
    for (const member of membersResult.rows) {
      try {
        // Check if member is a defaulter
        const memberDefaulterStatus = await checkDefaulterStatus(member.id);
        if (memberDefaulterStatus.hasOverdue) {
          skippedDefaulters.push({
            userId: member.id,
            name: member.name,
            overdueAmount: memberDefaulterStatus.totalOverdue,
          });

          await createNotification(
            member.id,
            'payment_skipped',
            'Auto-Pay Skipped - Overdue Payments',
            'You have overdue payments. Please pay manually first.',
            groupId,
            null
          );

          continue;
        }

        // Check if contribution already exists for this period
        const existingContribution = await pool.query(
          `SELECT id, status FROM subscription_contributions
           WHERE group_id = $1 AND contributor_id = $2 AND subscription_period_start = $3`,
          [groupId, member.id, periodStart]
        );

        if (existingContribution.rows.length > 0) {
          const contributionStatus = existingContribution.rows[0].status;
          if (contributionStatus === 'paid' || contributionStatus === 'confirmed') {
            skippedAlreadyPaid.push({
              userId: member.id,
              name: member.name,
              contributionId: existingContribution.rows[0].id,
            });
            continue;
          }
        }

        // CRITICAL: Check for pending payment attempts to prevent duplicate charges
        const contributionIdForCheck = existingContribution.rows.length > 0 ? existingContribution.rows[0].id : null;
        
        let pendingAttemptQuery;
        let pendingAttemptParams;
        
        if (contributionIdForCheck) {
          pendingAttemptQuery = `
            SELECT id, status, created_at FROM automatic_payment_attempts
            WHERE user_id = $1 AND group_id = $2 AND contribution_type = 'subscription'
            AND (contribution_id = $3 OR contribution_id IS NULL)
            AND status IN ('pending', 'retry')
            ORDER BY created_at DESC
            LIMIT 1
          `;
          pendingAttemptParams = [member.id, groupId, contributionIdForCheck];
        } else {
          pendingAttemptQuery = `
            SELECT id, status, created_at FROM automatic_payment_attempts
            WHERE user_id = $1 AND group_id = $2 AND contribution_type = 'subscription'
            AND contribution_id IS NULL
            AND status IN ('pending', 'retry')
            ORDER BY created_at DESC
            LIMIT 1
          `;
          pendingAttemptParams = [member.id, groupId];
        }
        
        const pendingAttemptCheck = await pool.query(pendingAttemptQuery, pendingAttemptParams);

        if (pendingAttemptCheck.rows.length > 0) {
          const attempt = pendingAttemptCheck.rows[0];
          const attemptAge = Date.now() - new Date(attempt.created_at).getTime();
          const oneHour = 60 * 60 * 1000;

          if (attemptAge < oneHour) {
            console.log(`Skipping subscription payment for member ${member.id}: Pending payment attempt exists (attempt ID: ${attempt.id})`);
            continue;
          }
          console.log(`Found old pending attempt (${Math.round(attemptAge / 1000 / 60)} minutes old) for member ${member.id}, proceeding with new attempt`);
        }

        // Calculate payment timing
        const paymentDate = member.payment_timing === '1_day_before'
          ? new Date(deadlineDate.getTime() - 24 * 60 * 60 * 1000)
          : deadlineDate;

        paymentDate.setHours(0, 0, 0, 0);

        // Check if payment should be processed today
        if (paymentDate.getTime() !== today.getTime()) {
          continue;
        }

        // Process payment
        const contributionAmount = parseFloat(group.contribution_amount);
        const currency = group.currency;
        if (!currency) {
          console.error(`Group ${groupId} has no currency set`);
          continue; // Skip this payment - group must have currency
        }

        const provider = member.provider || paymentService.selectProvider(currency, null);
        const fees = paymentService.calculateFees(contributionAmount, currency, provider, 1);

        // Get or create contribution record
        let contributionId;
        if (existingContribution.rows.length > 0) {
          contributionId = existingContribution.rows[0].id;
        } else {
          const contributionResult = await pool.query(
            `INSERT INTO subscription_contributions
             (group_id, contributor_id, amount, contribution_date, subscription_period_start, subscription_period_end, status)
             VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, 'not_paid')
             RETURNING id`,
            [groupId, member.id, contributionAmount, periodStart, periodEnd]
          );
          contributionId = contributionResult.rows[0].id;
        }

        // Record payment attempt
        const attemptId = await recordPaymentAttempt({
          userId: member.id,
          groupId,
          contributionType: 'subscription',
          contributionId,
          amount: contributionAmount,
          currency,
          status: 'pending',
          paymentProvider: provider,
          retryCount: 0,
        });

        // Charge payment
        const customerId = provider === 'stripe' 
          ? member.stripe_customer_id 
          : member.paystack_customer_code;

        if (!customerId || !member.payment_method_id) {
          continue;
        }

        const chargeResult = await paymentService.chargePaymentMethod({
          paymentMethodId: member.payment_method_id,
          amount: fees.grossAmount,
          currency,
          customerId,
          description: `Auto-debit subscription contribution for ${group.name}`,
          metadata: {
            contributionType: 'subscription',
            contributionId,
            groupId,
            userId: member.id,
            recipientId: adminId,
            contributionAmount,
            platformFee: fees.platformFee,
            processorFee: fees.processorFee,
            grossAmount: fees.grossAmount,
            attemptId,
            retryCount: 0,
          },
        }, provider);

        if (chargeResult.success) {
          processedCount++;
          console.log(`Payment processed successfully for member ${member.id}: ${chargeResult.transactionId}`);
        } else {
          await handlePaymentFailure({
            attemptId,
            memberId: member.id,
            memberName: member.name,
            memberEmail: member.email,
            groupId,
            groupName: group.name,
            contributionType: 'subscription',
            contributionId,
            amount: contributionAmount,
            currency,
            errorMessage: chargeResult.error,
            retryCount: 0,
            provider,
          });
        }
      } catch (error) {
        console.error(`Error processing payment for member ${member.id}:`, error);
      }
    }

    return {
      processed: processedCount,
      skipped_defaulters: skippedDefaulters,
      skipped_already_paid: skippedAlreadyPaid,
      recipient_is_defaulter: false,
      notifications_sent: skippedDefaulters.length > 0,
    };
  } catch (error) {
    console.error('Error processing subscription payments:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Process automatic payments for general group deadline
 * @param {string} groupId - Group ID
 * @returns {Promise<Object>} - Processing result
 */
async function processGeneralPayments(groupId) {
  try {
    console.log(`Processing general group payments for group ${groupId}`);

    // Get group details
    const groupResult = await pool.query(
      `SELECT id, name, contribution_amount, currency, admin_id, deadline
       FROM groups WHERE id = $1 AND group_type = 'general'`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return {
        success: false,
        error: 'General group not found',
      };
    }

    const group = groupResult.rows[0];
    const adminId = group.admin_id;

    // Check if deadline has passed
    if (!group.deadline) {
      return {
        success: false,
        error: 'Group has no deadline set',
      };
    }

    const deadlineDate = new Date(group.deadline);
    deadlineDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // CRITICAL: Check if admin (recipient) is a defaulter
    const recipientDefaulterStatus = await checkDefaulterStatus(adminId);
    if (recipientDefaulterStatus.hasOverdue) {
      console.log(`Skipping general payments: Admin ${adminId} has overdue payments`);

      const adminResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [adminId]
      );
      const admin = adminResult.rows[0];

      if (admin && admin.email) {
        await createNotification(
          adminId,
          'payment_skipped',
          'Auto-Pay Skipped - Overdue Payments',
          'You have overdue payments. Please pay manually to receive contributions.',
          groupId,
          null
        );
      }

      const autoPayMembers = await pool.query(
        `SELECT DISTINCT u.id, u.email, u.name
         FROM users u
         JOIN user_payment_preferences upp ON u.id = upp.user_id
         WHERE upp.group_id = $1 AND upp.auto_pay_enabled = TRUE
         AND EXISTS (
           SELECT 1 FROM group_members gm
           WHERE gm.group_id = $1 AND gm.user_id = u.id AND gm.status = 'active'
         )`,
        [groupId]
      );

      for (const member of autoPayMembers.rows) {
        try {
          await createNotification(
            member.id,
            'payment_skipped',
            'Auto-Pay Skipped',
            `Auto-pay skipped: ${admin?.name || 'Admin'} has overdue payments. Auto-pay will resume once they clear their overdue contributions.`,
            groupId,
            adminId
          );
        } catch (error) {
          console.error(`Error notifying member ${member.id}:`, error);
        }
      }

      return {
        skipped: true,
        recipient_is_defaulter: true,
        reason: 'Admin has overdue payments',
        notifications_sent: true,
        processed: 0,
      };
    }

    // Get all active members with auto-pay enabled
    // Exclude only the admin (group creator) - they receive contributions
    // Co-admins and regular members can pay (they're not excluded)
    const membersResult = await pool.query(
      `SELECT 
        u.id, u.email, u.name, u.stripe_customer_id, u.paystack_customer_code,
        upp.payment_method_id, upp.payment_timing, upp.provider, upp.id as preference_id
       FROM users u
       JOIN user_payment_preferences upp ON u.id = upp.user_id
       WHERE upp.group_id = $1 AND upp.auto_pay_enabled = TRUE
       AND EXISTS (
         SELECT 1 FROM group_members gm
         WHERE gm.group_id = $1 AND gm.user_id = u.id AND gm.status = 'active'
       )
       AND u.id != $2`,
      [groupId, adminId] // adminId is the group creator - exclude them, but co-admins are included
    );

    const skippedDefaulters = [];
    const skippedAlreadyPaid = [];
    let processedCount = 0;

    // Process each member
    for (const member of membersResult.rows) {
      try {
        // Check if member is a defaulter
        const memberDefaulterStatus = await checkDefaulterStatus(member.id);
        if (memberDefaulterStatus.hasOverdue) {
          skippedDefaulters.push({
            userId: member.id,
            name: member.name,
            overdueAmount: memberDefaulterStatus.totalOverdue,
          });

          await createNotification(
            member.id,
            'payment_skipped',
            'Auto-Pay Skipped - Overdue Payments',
            'You have overdue payments. Please pay manually first.',
            groupId,
            null
          );

          continue;
        }

        // Check if contribution already exists
        const existingContribution = await pool.query(
          `SELECT id, status FROM general_contributions
           WHERE group_id = $1 AND contributor_id = $2`,
          [groupId, member.id]
        );

        if (existingContribution.rows.length > 0) {
          const contributionStatus = existingContribution.rows[0].status;
          if (contributionStatus === 'paid' || contributionStatus === 'confirmed') {
            skippedAlreadyPaid.push({
              userId: member.id,
              name: member.name,
              contributionId: existingContribution.rows[0].id,
            });
            continue;
          }
        }

        // CRITICAL: Check for pending payment attempts to prevent duplicate charges
        // This prevents charging the user multiple times if the job runs before webhook confirms payment
        const contributionIdForCheck = existingContribution.rows.length > 0 ? existingContribution.rows[0].id : null;
        
        let pendingAttemptQuery;
        let pendingAttemptParams;
        
        if (contributionIdForCheck) {
          // Check for pending attempts with this specific contribution_id
          pendingAttemptQuery = `
            SELECT id, status, created_at FROM automatic_payment_attempts
            WHERE user_id = $1 AND group_id = $2 AND contribution_type = 'general'
            AND (contribution_id = $3 OR contribution_id IS NULL)
            AND status IN ('pending', 'retry')
            ORDER BY created_at DESC
            LIMIT 1
          `;
          pendingAttemptParams = [member.id, groupId, contributionIdForCheck];
        } else {
          // Check for pending attempts for this group/user (contribution might not exist yet)
          pendingAttemptQuery = `
            SELECT id, status, created_at FROM automatic_payment_attempts
            WHERE user_id = $1 AND group_id = $2 AND contribution_type = 'general'
            AND contribution_id IS NULL
            AND status IN ('pending', 'retry')
            ORDER BY created_at DESC
            LIMIT 1
          `;
          pendingAttemptParams = [member.id, groupId];
        }
        
        const pendingAttemptCheck = await pool.query(pendingAttemptQuery, pendingAttemptParams);

        if (pendingAttemptCheck.rows.length > 0) {
          const attempt = pendingAttemptCheck.rows[0];
          const attemptAge = Date.now() - new Date(attempt.created_at).getTime();
          const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

          // If there's a pending attempt less than 1 hour old, skip to prevent duplicate charge
          if (attemptAge < oneHour) {
            console.log(`Skipping payment for member ${member.id}: Pending payment attempt exists (attempt ID: ${attempt.id}, age: ${Math.round(attemptAge / 1000 / 60)} minutes)`);
            continue;
          }
          // If attempt is older than 1 hour, it might be stuck - we'll proceed with new attempt
          console.log(`Found old pending attempt (${Math.round(attemptAge / 1000 / 60)} minutes old) for member ${member.id}, proceeding with new attempt`);
        }

        // Calculate payment timing
        const paymentDate = member.payment_timing === '1_day_before'
          ? new Date(deadlineDate.getTime() - 24 * 60 * 60 * 1000)
          : deadlineDate;

        paymentDate.setHours(0, 0, 0, 0);

        // CRITICAL: Only process on the payment date (deadline or 1 day before)
        // This ensures general groups only charge ONCE when the deadline is reached,
        // unlike subscription groups which charge monthly/annually (recurring).
        // The job (processGeneralPaymentsJob) only calls this function for deadlines
        // that are today or tomorrow, so it won't run again after the deadline passes.
        if (paymentDate.getTime() !== today.getTime()) {
          continue; // Not the payment date - skip (ensures one-time charge only)
        }

        // Process payment
        const contributionAmount = parseFloat(group.contribution_amount);
        const currency = group.currency;
        if (!currency) {
          console.error(`Group ${groupId} has no currency set`);
          continue; // Skip this payment - group must have currency
        }

        const provider = member.provider || paymentService.selectProvider(currency, null);
        const fees = paymentService.calculateFees(contributionAmount, currency, provider, 1);

        // Get or create contribution record
        let contributionId;
        if (existingContribution.rows.length > 0) {
          contributionId = existingContribution.rows[0].id;
        } else {
          const contributionResult = await pool.query(
            `INSERT INTO general_contributions
             (group_id, contributor_id, amount, contribution_date, status)
             VALUES ($1, $2, $3, CURRENT_DATE, 'not_paid')
             RETURNING id`,
            [groupId, member.id, contributionAmount]
          );
          contributionId = contributionResult.rows[0].id;
        }

        // Record payment attempt
        const attemptId = await recordPaymentAttempt({
          userId: member.id,
          groupId,
          contributionType: 'general',
          contributionId,
          amount: contributionAmount,
          currency,
          status: 'pending',
          paymentProvider: provider,
          retryCount: 0,
        });

        // Charge payment
        const customerId = provider === 'stripe' 
          ? member.stripe_customer_id 
          : member.paystack_customer_code;

        if (!customerId || !member.payment_method_id) {
          continue;
        }

        const chargeResult = await paymentService.chargePaymentMethod({
          paymentMethodId: member.payment_method_id,
          amount: fees.grossAmount,
          currency,
          customerId,
          description: `Auto-debit contribution for ${group.name}`,
          metadata: {
            contributionType: 'general',
            contributionId,
            groupId,
            userId: member.id,
            recipientId: adminId,
            contributionAmount,
            platformFee: fees.platformFee,
            processorFee: fees.processorFee,
            grossAmount: fees.grossAmount,
            attemptId,
            retryCount: 0,
          },
        }, provider);

        if (chargeResult.success) {
          processedCount++;
          console.log(`Payment processed successfully for member ${member.id}: ${chargeResult.transactionId}`);
        } else {
          await handlePaymentFailure({
            attemptId,
            memberId: member.id,
            memberName: member.name,
            memberEmail: member.email,
            groupId,
            groupName: group.name,
            contributionType: 'general',
            contributionId,
            amount: contributionAmount,
            currency,
            errorMessage: chargeResult.error,
            retryCount: 0,
            provider,
          });
        }
      } catch (error) {
        console.error(`Error processing payment for member ${member.id}:`, error);
      }
    }

    return {
      processed: processedCount,
      skipped_defaulters: skippedDefaulters,
      skipped_already_paid: skippedAlreadyPaid,
      recipient_is_defaulter: false,
      notifications_sent: skippedDefaulters.length > 0,
    };
  } catch (error) {
    console.error('Error processing general payments:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Handle payment failure (retry or disable auto-pay)
 * @param {Object} failureData - Failure data
 */
async function handlePaymentFailure({
  attemptId,
  memberId,
  memberName,
  memberEmail,
  groupId,
  groupName,
  contributionType,
  contributionId,
  amount,
  currency,
  errorMessage,
  retryCount,
  provider,
}) {
  try {
    const maxRetries = 1; // Max 2 attempts (initial + 1 retry)
    const newRetryCount = retryCount + 1;
    const shouldRetry = newRetryCount < maxRetries;

    // Update payment attempt
    await updatePaymentAttempt(attemptId, {
      status: shouldRetry ? 'retry' : 'failed',
      errorMessage,
      retryCount: newRetryCount,
    });

    if (!shouldRetry) {
      // Auto-disable auto-pay after max retries
      await pool.query(
        `UPDATE user_payment_preferences
         SET auto_pay_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND group_id = $2`,
        [memberId, groupId]
      );

      // Send notification emails
      try {
        if (memberEmail) {
          await sendAutoPayDisabledEmail(
            memberEmail,
            memberName,
            groupName,
            `Payment failed after ${newRetryCount} attempts: ${errorMessage}`
          );

          const currencySymbol = paymentService.formatCurrency(amount, currency).replace(/[\d.,]+/g, '');
          await sendPaymentFailureEmail(
            memberEmail,
            memberName,
            amount,
            currency,
            groupName,
            errorMessage,
            newRetryCount,
            currencySymbol
          );
        }
      } catch (emailError) {
        console.error('Error sending failure emails:', emailError);
      }

      // Log action
      await logPaymentAction({
        userId: memberId,
        action: 'auto_pay_disabled_after_failure',
        amount,
        currency,
        status: 'failed',
        paymentProvider: provider,
        errorMessage: `Payment failed after ${newRetryCount} attempts: ${errorMessage}`,
        metadata: { groupId, groupName, contributionType, contributionId },
      });
    } else {
      // TODO: Implement retry logic (schedule retry for later)
      // For now, just log that retry is needed
      console.log(`Payment failed for member ${memberId}, will retry (attempt ${newRetryCount}/${maxRetries})`);
    }
  } catch (error) {
    console.error('Error handling payment failure:', error);
  }
}

module.exports = {
  processBirthdayPayments,
  processSubscriptionPayments,
  processGeneralPayments,
};
