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
      `SELECT w.*, u.email, u.name
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

        // Get currency from withdrawal record (must be set)
        const currency = withdrawal.currency;
        if (!currency) {
          throw new Error('Withdrawal has no currency specified');
        }
        const provider = withdrawal.payment_provider || paymentService.selectProvider(currency, null);

        // Get currency-specific bank account details
        // If bank_account_id exists in withdrawal, use that; otherwise get default for currency
        let bankAccountResult;
        if (withdrawal.bank_account_id) {
          bankAccountResult = await pool.query(
            `SELECT account_number, bank_name, account_name, iban, swift_bic,
                    routing_number, sort_code, branch_code, branch_address, bank_code
             FROM wallet_bank_accounts 
             WHERE id = $1 AND user_id = $2 AND currency = $3`,
            [withdrawal.bank_account_id, withdrawal.user_id, currency]
          );
        } else {
          // Fallback: Get default account for currency (for old withdrawals)
          bankAccountResult = await pool.query(
            `SELECT account_number, bank_name, account_name, iban, swift_bic,
                    routing_number, sort_code, branch_code, branch_address, bank_code
             FROM wallet_bank_accounts 
             WHERE user_id = $1 AND currency = $2
             ORDER BY is_default DESC, created_at DESC
             LIMIT 1`,
            [withdrawal.user_id, currency]
          );
        }

        if (bankAccountResult.rows.length === 0) {
          throw new Error(`No bank account found for ${currency}. User needs to add bank account for this currency.`);
        }

        const bankAccount = bankAccountResult.rows[0];

        // Prepare bank account object based on provider
        let bankAccountForPayout;
        if (provider === 'paystack') {
          // For Paystack, we need bank code (required for Nigerian banks)
          if (!bankAccount.bank_code) {
            throw new Error(`Bank code required for ${currency} withdrawals via Paystack. Please update your bank account details.`);
          }
          bankAccountForPayout = {
            accountNumber: bankAccount.account_number,
            bankCode: bankAccount.bank_code,
            accountName: bankAccount.account_name,
            country: currency === 'NGN' ? 'NG' : null,
            recipientCode: null, // Will be created if needed
          };
        } else {
          // For Stripe, use routing number and other international fields
          bankAccountForPayout = {
            accountNumber: bankAccount.account_number,
            routingNumber: bankAccount.routing_number, // Required for US banks
            accountName: bankAccount.account_name,
            country: currency === 'USD' ? 'US' : (currency === 'GBP' ? 'GB' : null),
            iban: bankAccount.iban, // For EU/UK banks
            swiftBic: bankAccount.swift_bic,
            sortCode: bankAccount.sort_code, // For UK banks
            branchCode: bankAccount.branch_code,
          };
        }

        // Create payout
        const payoutResult = await paymentService.createPayout({
          amount: withdrawal.net_amount, // Net amount after fees
          currency,
          bankAccount: bankAccountForPayout,
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
              const netAmount = typeof withdrawal.net_amount === 'string' ? parseFloat(withdrawal.net_amount) : Number(withdrawal.net_amount);
              const currencySymbol = paymentService.formatCurrency(netAmount, currency).replace(/[\d.,]+/g, '');
              await sendWithdrawalCompletedEmail(
                withdrawal.email,
                withdrawal.name,
                netAmount,
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

          // Refund amount back to currency-specific wallet balance
          await pool.query(
            `INSERT INTO wallet_balances (user_id, currency, balance)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, currency)
             DO UPDATE SET 
               balance = wallet_balances.balance + $3,
               updated_at = CURRENT_TIMESTAMP`,
            [withdrawal.user_id, currency, withdrawal.amount]
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
              const amount = typeof withdrawal.amount === 'string' ? parseFloat(withdrawal.amount) : Number(withdrawal.amount);
              const currencySymbol = paymentService.formatCurrency(amount, currency).replace(/[\d.,]+/g, '');
              await sendWithdrawalFailedEmail(
                withdrawal.email,
                withdrawal.name,
                amount,
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

          // Refund amount back to currency-specific wallet balance
          const withdrawalCurrency = withdrawal.currency || 'NGN';
          await pool.query(
            `INSERT INTO wallet_balances (user_id, currency, balance)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, currency)
             DO UPDATE SET 
               balance = wallet_balances.balance + $3,
               updated_at = CURRENT_TIMESTAMP`,
            [withdrawal.user_id, withdrawalCurrency, withdrawal.amount]
          );

          failureCount++;

          // Send email notification
          try {
            if (withdrawal.email) {
              const amount = typeof withdrawal.amount === 'string' ? parseFloat(withdrawal.amount) : Number(withdrawal.amount);
              const currencySymbol = paymentService.formatCurrency(amount, withdrawal.currency).replace(/[\d.,]+/g, '');
              await sendWithdrawalFailedEmail(
                withdrawal.email,
                withdrawal.name,
                amount,
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
