const pool = require('../config/database');
const paymentService = require('../services/paymentService');
const {
  updatePaymentAttempt,
  recordPaymentAttempt,
  isContributionConfirmed,
} = require('../utils/walletHelpers');
const { logPaymentAction } = require('../utils/paymentHelpers');
const { sendAutoPayDisabledEmail, sendPaymentFailureEmail } = require('../utils/email');

/**
 * Payment Retry Processor
 * Processes failed payment attempts that need retry
 * Should be run periodically (e.g., every hour) to retry failed payments
 */

/**
 * Retry failed payment attempts
 * @returns {Promise<Object>} - Retry result
 */
async function retryFailedPayments() {
  try {
    console.log('🔄 Starting payment retry processing...');

    // Get all payment attempts with status 'retry' that haven't been retried yet
    const retryAttempts = await pool.query(
      `SELECT apa.*, u.email, u.name, u.stripe_customer_id, u.paystack_customer_code,
              upp.payment_method_id, upp.provider, g.name as group_name, g.currency
       FROM automatic_payment_attempts apa
       JOIN users u ON apa.user_id = u.id
       JOIN user_payment_preferences upp ON apa.user_id = upp.user_id AND apa.group_id = upp.group_id
       JOIN groups g ON apa.group_id = g.id
       WHERE apa.status = 'retry'
         AND apa.retry_count < 2
         AND upp.auto_pay_enabled = TRUE
       ORDER BY apa.created_at ASC
       LIMIT 100`, // Limit to 100 retries per run
      []
    );

    console.log(`Found ${retryAttempts.rows.length} payment attempts to retry`);

    let retryCount = 0;
    let successCount = 0;
    let finalFailureCount = 0;

    for (const attempt of retryAttempts.rows) {
      try {
        // CRITICAL: Check if contribution is already confirmed (prevent double payment)
        const alreadyConfirmed = await isContributionConfirmed(
          attempt.contribution_type,
          attempt.contribution_id
        );

        if (alreadyConfirmed) {
          console.log(`Skipping retry for attempt ${attempt.id}: Contribution already confirmed`);
          
          // Update attempt status
          await updatePaymentAttempt(attempt.id, {
            status: 'success',
            errorMessage: 'Contribution already confirmed (paid manually)',
          });

          continue;
        }

        // Check if user is still a defaulter (skip if they are)
        const { checkDefaulterStatus } = require('../utils/paymentHelpers');
        const defaulterStatus = await checkDefaulterStatus(attempt.user_id, attempt.group_id);
        if (defaulterStatus.hasOverdue) {
          console.log(`Skipping retry for attempt ${attempt.id}: User is a defaulter`);
          continue;
        }

        // Calculate fees
        const provider = attempt.provider || paymentService.selectProvider(attempt.currency, null);
        const fees = paymentService.calculateFees(attempt.amount, attempt.currency, provider, 1);

        // Get customer ID
        const customerId = provider === 'stripe' 
          ? attempt.stripe_customer_id 
          : attempt.paystack_customer_code;

        if (!customerId || !attempt.payment_method_id) {
          console.log(`Skipping retry for attempt ${attempt.id}: No payment method or customer ID`);
          continue;
        }

        // Retry payment
        const chargeResult = await paymentService.chargePaymentMethod({
          paymentMethodId: attempt.payment_method_id,
          amount: fees.grossAmount,
          currency: attempt.currency,
          customerId,
          description: `Auto-debit retry for ${attempt.group_name}`,
          metadata: {
            contributionType: attempt.contribution_type,
            contributionId: attempt.contribution_id,
            groupId: attempt.group_id,
            userId: attempt.user_id,
            contributionAmount: attempt.amount,
            platformFee: fees.platformFee,
            processorFee: fees.processorFee,
            grossAmount: fees.grossAmount,
            attemptId: attempt.id,
            retryCount: attempt.retry_count + 1,
            isRetry: true,
          },
        }, provider);

        retryCount++;

        if (chargeResult.success) {
          successCount++;
          
          // Update attempt status
          await updatePaymentAttempt(attempt.id, {
            status: 'success',
            providerTransactionId: chargeResult.transactionId,
          });

          console.log(`Retry successful for attempt ${attempt.id}: ${chargeResult.transactionId}`);
        } else {
          // Update retry count
          const newRetryCount = attempt.retry_count + 1;
          const maxRetries = 1; // Max 2 attempts (initial + 1 retry)
          const shouldRetryAgain = newRetryCount < maxRetries;

          await updatePaymentAttempt(attempt.id, {
            status: shouldRetryAgain ? 'retry' : 'failed',
            errorMessage: chargeResult.error,
            retryCount: newRetryCount,
          });

          if (!shouldRetryAgain) {
            finalFailureCount++;
            
            // Auto-disable auto-pay after max retries
            await pool.query(
              `UPDATE user_payment_preferences
               SET auto_pay_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
               WHERE user_id = $1 AND group_id = $2`,
              [attempt.user_id, attempt.group_id]
            );

            // Send notification emails
            try {
              if (attempt.email) {
                await sendAutoPayDisabledEmail(
                  attempt.email,
                  attempt.name,
                  attempt.group_name,
                  `Payment failed after ${newRetryCount + 1} attempts: ${chargeResult.error}`
                );

                const currencySymbol = paymentService.formatCurrency(attempt.amount, attempt.currency).replace(/[\d.,]+/g, '');
                await sendPaymentFailureEmail(
                  attempt.email,
                  attempt.name,
                  attempt.amount,
                  attempt.currency,
                  attempt.group_name,
                  chargeResult.error,
                  newRetryCount,
                  currencySymbol
                );
              }
            } catch (emailError) {
              console.error('Error sending failure emails:', emailError);
            }

            // Log action
            await logPaymentAction({
              userId: attempt.user_id,
              action: 'auto_pay_disabled_after_retry_failure',
              amount: attempt.amount,
              currency: attempt.currency,
              status: 'failed',
              paymentProvider: provider,
              errorMessage: `Payment failed after ${newRetryCount + 1} attempts: ${chargeResult.error}`,
              metadata: {
                groupId: attempt.group_id,
                groupName: attempt.group_name,
                contributionType: attempt.contribution_type,
                contributionId: attempt.contribution_id,
                attemptId: attempt.id,
              },
            });

            console.log(`Retry failed for attempt ${attempt.id} after ${newRetryCount + 1} attempts: ${chargeResult.error}`);
          } else {
            console.log(`Retry failed for attempt ${attempt.id}, will retry again (attempt ${newRetryCount + 1}/${maxRetries + 1})`);
          }
        }
      } catch (error) {
        console.error(`Error retrying payment attempt ${attempt.id}:`, error);
      }
    }

    console.log(`✅ Payment retry processing completed: ${retryCount} attempted, ${successCount} succeeded, ${finalFailureCount} final failures`);
    return {
      success: true,
      attempted: retryCount,
      succeeded: successCount,
      final_failures: finalFailureCount,
    };
  } catch (error) {
    console.error('❌ Error in payment retry processing:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Run if called directly (for testing)
if (require.main === module) {
  retryFailedPayments()
    .then((result) => {
      console.log('Payment retry processing completed:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Payment retry processing failed:', error);
      process.exit(1);
    });
}

module.exports = {
  retryFailedPayments,
};
