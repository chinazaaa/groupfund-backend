const pool = require('../config/database');
const paymentService = require('../services/paymentService');
const {
  sendWithdrawalCompletedEmail,
  sendWithdrawalFailedEmail,
} = require('../utils/email');
const { logPaymentAction } = require('../utils/paymentHelpers');
const { createNotification } = require('../utils/notifications');

/**
 * Withdrawal Processing Job
 * Processes pending withdrawals after 24-hour hold period
 * Should run periodically (e.g., every hour) to process eligible withdrawals
 */

/**
 * Process pending withdrawals that have passed the 24-hour hold period
 * @returns {Promise<Object>} - Processing result
 */
async function processPendingWithdrawals() {
  try {
    console.log('🔄 Starting withdrawal processing job...');
    const now = new Date();

    // Get all pending withdrawals where scheduled_at has passed
    const pendingWithdrawals = await pool.query(
      `SELECT w.*, u.email, u.name, u.currency as user_currency
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.status = 'pending'
         AND w.scheduled_at <= $1
       ORDER BY w.scheduled_at ASC
       LIMIT 100`, // Process up to 100 withdrawals per run
      [now]
    );

    console.log(`Found ${pendingWithdrawals.rows.length} withdrawals ready for processing`);

    let processedCount = 0;
    let successCount = 0;
    let failureCount = 0;

    for (const withdrawal of pendingWithdrawals.rows) {
      try {
        // Update status to processing
        await pool.query(
          'UPDATE withdrawals SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          ['processing', withdrawal.id]
        );

        // Get user wallet to verify balance (in case of refunds or other adjustments)
        const walletResult = await pool.query(
          'SELECT balance FROM wallets WHERE user_id = $1',
          [withdrawal.user_id]
        );

        // Prepare bank account details for payout
        const currency = withdrawal.currency || withdrawal.user_currency || 'NGN';
        const provider = withdrawal.payment_provider || paymentService.selectProvider(currency, null);

        // For Paystack, we need to get bank code
        // For Stripe, we need routing number and other details
        // Get full wallet details including international fields
        const fullWalletResult = await pool.query(
          `SELECT account_number, bank_name, account_name, iban, swift_bic,
                  routing_number, sort_code, branch_code, branch_address
           FROM wallets WHERE user_id = $1`,
          [withdrawal.user_id]
        );

        if (fullWalletResult.rows.length === 0) {
          throw new Error('Wallet not found');
        }

        const wallet = fullWalletResult.rows[0];

        // Prepare bank account object based on provider
        let bankAccount;
        if (provider === 'paystack') {
          // For Paystack, we need bank code (look up from bank name or use a mapping)
          // For now, we'll use a placeholder - in production, you'd have a bank code lookup
          bankAccount = {
            accountNumber: wallet.account_number,
            bankCode: withdrawal.bank_code || '000', // Placeholder - needs bank code lookup
            accountName: wallet.account_name,
            country: currency === 'NGN' ? 'NG' : null,
            recipientCode: null, // Will be created if needed
          };
        } else {
          // For Stripe, use routing number and other international fields
          bankAccount = {
            accountNumber: wallet.account_number,
            routingNumber: wallet.routing_number,
            accountName: wallet.account_name,
            country: currency === 'USD' ? 'US' : null,
            iban: wallet.iban,
            swiftBic: wallet.swift_bic,
            sortCode: wallet.sort_code,
            branchCode: wallet.branch_code,
          };
        }

        // Create payout
        const payoutResult = await paymentService.createPayout({
          amount: withdrawal.net_amount, // Net amount after fees
          currency,
          bankAccount,
          description: `Withdrawal #${withdrawal.id}`,
        }, provider);

        processedCount++;

        if (payoutResult.success) {
          // Update withdrawal status
          await pool.query(
            `UPDATE withdrawals
             SET status = 'completed', provider_transaction_id = $1, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [payoutResult.transferId || payoutResult.payoutId, withdrawal.id]
          );

          // Update transaction status
          await pool.query(
            `UPDATE transactions
             SET status = 'completed'
             WHERE reference = $1 AND type = 'withdrawal'`,
            [withdrawal.id]
          );

          successCount++;

          // Send email notification
          try {
            if (withdrawal.email) {
              const currencySymbol = paymentService.formatCurrency(withdrawal.net_amount, currency).replace(/[\d.,]+/g, '');
              await sendWithdrawalCompletedEmail(
                withdrawal.email,
                withdrawal.name,
                withdrawal.net_amount,
                currency,
                currencySymbol,
                payoutResult.transferId || payoutResult.payoutId
              );
            }
          } catch (emailError) {
            console.error('Error sending withdrawal completed email:', emailError);
          }

          // Create notification
          try {
            await createNotification(
              withdrawal.user_id,
              'withdrawal_completed',
              'Withdrawal Completed',
              `Your withdrawal of ${currency} ${withdrawal.net_amount} has been processed successfully.`,
              null,
              null
            );
          } catch (notificationError) {
            console.error('Error creating withdrawal notification:', notificationError);
          }

          // Log action
          await logPaymentAction({
            userId: withdrawal.user_id,
            action: 'withdrawal_completed',
            amount: withdrawal.net_amount,
            currency,
            status: 'completed',
            paymentProvider: provider,
            metadata: {
              withdrawalId: withdrawal.id,
              transactionId: payoutResult.transferId || payoutResult.payoutId,
              fee: withdrawal.fee,
            },
          });

          console.log(`Withdrawal ${withdrawal.id} processed successfully: ${payoutResult.transferId || payoutResult.payoutId}`);
        } else {
          // Update withdrawal status to failed
          await pool.query(
            `UPDATE withdrawals
             SET status = 'failed', error_message = $1, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [payoutResult.error || 'Payout processing failed', withdrawal.id]
          );

          // Refund amount back to wallet
          await pool.query(
            'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
            [withdrawal.amount, withdrawal.user_id]
          );

          // Update transaction status
          await pool.query(
            `UPDATE transactions
             SET status = 'failed'
             WHERE reference = $1 AND type = 'withdrawal'`,
            [withdrawal.id]
          );

          failureCount++;

          // Send email notification
          try {
            if (withdrawal.email) {
              const currencySymbol = paymentService.formatCurrency(withdrawal.amount, currency).replace(/[\d.,]+/g, '');
              await sendWithdrawalFailedEmail(
                withdrawal.email,
                withdrawal.name,
                withdrawal.amount,
                currency,
                currencySymbol,
                payoutResult.error || 'Payout processing failed'
              );
            }
          } catch (emailError) {
            console.error('Error sending withdrawal failed email:', emailError);
          }

          // Create notification
          try {
            await createNotification(
              withdrawal.user_id,
              'withdrawal_failed',
              'Withdrawal Failed',
              `Your withdrawal request failed: ${payoutResult.error || 'Processing error'}. Funds have been returned to your wallet.`,
              null,
              null
            );
          } catch (notificationError) {
            console.error('Error creating withdrawal notification:', notificationError);
          }

          // Log action
          await logPaymentAction({
            userId: withdrawal.user_id,
            action: 'withdrawal_failed',
            amount: withdrawal.amount,
            currency,
            status: 'failed',
            paymentProvider: provider,
            errorMessage: payoutResult.error || 'Payout processing failed',
            metadata: {
              withdrawalId: withdrawal.id,
              fee: withdrawal.fee,
            },
          });

          console.log(`Withdrawal ${withdrawal.id} failed: ${payoutResult.error}`);
        }
      } catch (error) {
        console.error(`Error processing withdrawal ${withdrawal.id}:`, error);

        // Update withdrawal status to failed
        try {
          await pool.query(
            `UPDATE withdrawals
             SET status = 'failed', error_message = $1, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [error.message, withdrawal.id]
          );

          // Refund amount back to wallet
          await pool.query(
            'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
            [withdrawal.amount, withdrawal.user_id]
          );

          failureCount++;

          // Send email notification
          try {
            if (withdrawal.email) {
              const currencySymbol = paymentService.formatCurrency(withdrawal.amount, withdrawal.currency).replace(/[\d.,]+/g, '');
              await sendWithdrawalFailedEmail(
                withdrawal.email,
                withdrawal.name,
                withdrawal.amount,
                withdrawal.currency,
                currencySymbol,
                error.message
              );
            }
          } catch (emailError) {
            console.error('Error sending withdrawal failed email:', emailError);
          }
        } catch (updateError) {
          console.error('Error updating failed withdrawal:', updateError);
        }
      }
    }

    console.log(`✅ Withdrawal processing completed: ${processedCount} processed, ${successCount} succeeded, ${failureCount} failed`);
    return {
      success: true,
      processed: processedCount,
      succeeded: successCount,
      failed: failureCount,
    };
  } catch (error) {
    console.error('❌ Error in withdrawal processing:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Run if called directly (for testing)
if (require.main === module) {
  processPendingWithdrawals()
    .then((result) => {
      console.log('Withdrawal processing completed:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Withdrawal processing failed:', error);
      process.exit(1);
    });
}

module.exports = {
  processPendingWithdrawals,
};
