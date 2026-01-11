const pool = require('../config/database');

/**
 * Credit recipient's wallet balance
 * @param {Object} creditData - Credit data
 * @param {string} creditData.recipientId - Recipient user ID
 * @param {number} creditData.amount - Amount in main currency unit
 * @param {string} creditData.currency - Currency code
 * @param {string} creditData.groupId - Group ID (optional)
 * @param {string} creditData.description - Transaction description
 * @param {string} creditData.contributionType - Contribution type ('birthday', 'subscription', 'general')
 * @param {string} creditData.contributionId - Contribution ID
 * @param {string} creditData.providerTransactionId - Provider transaction ID
 * @param {string} creditData.paymentProvider - Payment provider ('stripe', 'paystack')
 * @param {Object} creditData.fees - Fee breakdown
 * @returns {Promise<Object>} - Transaction record
 */
async function creditWallet({
  recipientId,
  amount,
  currency,
  groupId,
  description,
  contributionType,
  contributionId,
  providerTransactionId,
  paymentProvider,
  fees = {},
}) {
  try {
    await pool.query('BEGIN');

    try {
      // Ensure wallet exists
      const walletCheck = await pool.query(
        'SELECT id, balance FROM wallets WHERE user_id = $1',
        [recipientId]
      );

      if (walletCheck.rows.length === 0) {
        // Create wallet if it doesn't exist
        await pool.query(
          'INSERT INTO wallets (user_id, balance) VALUES ($1, $2)',
          [recipientId, 0]
        );
      }

      // Credit wallet balance
      await pool.query(
        `UPDATE wallets
         SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [amount, recipientId]
      );

      // Create transaction record with fee tracking
      const transactionResult = await pool.query(
        `INSERT INTO transactions
         (user_id, group_id, type, amount, description, status, payment_provider, payment_method_id,
          platform_fee, processor_fee, gross_amount, net_amount)
         VALUES ($1, $2, 'credit', $3, $4, 'completed', $5, $6, $7, $8, $9, $10)
         RETURNING id, created_at`,
        [
          recipientId,
          groupId || null,
          amount,
          description || `Auto-debit contribution via ${paymentProvider}`,
          paymentProvider,
          providerTransactionId,
          fees.platformFee || 0,
          fees.processorFee || 0,
          fees.grossAmount || amount,
          amount, // Net amount (recipient receives full contribution amount)
        ]
      );

      const transaction = transactionResult.rows[0];

      // Update contribution record to link with transaction
      if (contributionType && contributionId) {
        let contributionTable;
        switch (contributionType) {
          case 'birthday':
            contributionTable = 'birthday_contributions';
            break;
          case 'subscription':
            contributionTable = 'subscription_contributions';
            break;
          case 'general':
            contributionTable = 'general_contributions';
            break;
          default:
            contributionTable = null;
        }

        if (contributionTable) {
          await pool.query(
            `UPDATE ${contributionTable}
             SET transaction_id = $1, status = 'confirmed', payment_method = 'auto-debit',
                 payment_provider = $2, provider_transaction_id = $3
             WHERE id = $4`,
            [transaction.id, paymentProvider, providerTransactionId, contributionId]
          );
        }
      }

      // Get updated wallet balance
      const updatedWallet = await pool.query(
        'SELECT balance FROM wallets WHERE user_id = $1',
        [recipientId]
      );

      await pool.query('COMMIT');

      return {
        success: true,
        transactionId: transaction.id,
        newBalance: parseFloat(updatedWallet.rows[0].balance),
        amount,
        currency,
      };
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error crediting wallet:', error);
    throw error;
  }
}

/**
 * Record automatic payment attempt
 * @param {Object} attemptData - Attempt data
 * @param {string} attemptData.userId - User ID (contributor)
 * @param {string} attemptData.groupId - Group ID
 * @param {string} attemptData.contributionType - Contribution type
 * @param {string} attemptData.contributionId - Contribution ID
 * @param {number} attemptData.amount - Amount in main currency unit
 * @param {string} attemptData.currency - Currency code
 * @param {string} attemptData.status - Status ('pending', 'success', 'failed', 'retry')
 * @param {string} attemptData.paymentProvider - Payment provider
 * @param {string} attemptData.providerTransactionId - Provider transaction ID
 * @param {string} attemptData.errorMessage - Error message (optional)
 * @param {number} attemptData.retryCount - Retry count
 * @returns {Promise<string>} - Attempt ID
 */
async function recordPaymentAttempt({
  userId,
  groupId,
  contributionType,
  contributionId,
  amount,
  currency,
  status = 'pending',
  paymentProvider,
  providerTransactionId,
  errorMessage,
  retryCount = 0,
}) {
  try {
    const result = await pool.query(
      `INSERT INTO automatic_payment_attempts
       (user_id, group_id, contribution_type, contribution_id, amount, currency, status,
        payment_provider, provider_transaction_id, error_message, retry_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        userId,
        groupId,
        contributionType,
        contributionId || null,
        amount,
        currency,
        status,
        paymentProvider || null,
        providerTransactionId || null,
        errorMessage || null,
        retryCount,
      ]
    );

    return result.rows[0].id;
  } catch (error) {
    console.error('Error recording payment attempt:', error);
    throw error;
  }
}

/**
 * Update payment attempt status
 * @param {string} attemptId - Attempt ID
 * @param {Object} updateData - Update data
 * @param {string} updateData.status - New status
 * @param {string} updateData.providerTransactionId - Provider transaction ID
 * @param {string} updateData.errorMessage - Error message
 * @param {number} updateData.retryCount - Retry count
 * @returns {Promise<void>}
 */
async function updatePaymentAttempt(attemptId, updateData) {
  try {
    const { status, providerTransactionId, errorMessage, retryCount } = updateData;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }

    if (providerTransactionId !== undefined) {
      updates.push(`provider_transaction_id = $${paramCount++}`);
      values.push(providerTransactionId);
    }

    if (errorMessage !== undefined) {
      updates.push(`error_message = $${paramCount++}`);
      values.push(errorMessage);
    }

    if (retryCount !== undefined) {
      updates.push(`retry_count = $${paramCount++}`);
      values.push(retryCount);
    }

    if (status === 'success' || status === 'failed') {
      updates.push(`completed_at = CURRENT_TIMESTAMP`);
    }

    if (updates.length === 0) {
      return;
    }

    values.push(attemptId);

    await pool.query(
      `UPDATE automatic_payment_attempts
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}`,
      values
    );
  } catch (error) {
    console.error('Error updating payment attempt:', error);
    throw error;
  }
}

/**
 * Check if webhook event has already been processed (idempotency)
 * @param {string} providerTransactionId - Provider transaction ID
 * @param {string} provider - Payment provider
 * @returns {Promise<boolean>} - True if already processed
 */
async function isWebhookProcessed(providerTransactionId, provider) {
  try {
    const result = await pool.query(
      `SELECT id FROM transactions
       WHERE payment_method_id = $1 AND payment_provider = $2
       LIMIT 1`,
      [providerTransactionId, provider]
    );

    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking webhook idempotency:', error);
    // Return false on error to allow processing (fail-safe)
    return false;
  }
}

/**
 * Check if contribution is already confirmed (prevent double payment)
 * @param {string} contributionType - Contribution type
 * @param {string} contributionId - Contribution ID
 * @returns {Promise<boolean>} - True if already confirmed
 */
async function isContributionConfirmed(contributionType, contributionId) {
  try {
    let contributionTable;
    switch (contributionType) {
      case 'birthday':
        contributionTable = 'birthday_contributions';
        break;
      case 'subscription':
        contributionTable = 'subscription_contributions';
        break;
      case 'general':
        contributionTable = 'general_contributions';
        break;
      default:
        return false;
    }

    const result = await pool.query(
      `SELECT status FROM ${contributionTable}
       WHERE id = $1`,
      [contributionId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const status = result.rows[0].status;
    return status === 'confirmed';
  } catch (error) {
    console.error('Error checking contribution status:', error);
    // Return false on error to allow processing (fail-safe)
    return false;
  }
}

module.exports = {
  creditWallet,
  recordPaymentAttempt,
  updatePaymentAttempt,
  isWebhookProcessed,
  isContributionConfirmed,
};
