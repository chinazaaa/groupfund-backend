const express = require('express');
const { handleEmailWebhook } = require('../controllers/webhookController');
const paymentService = require('../services/paymentService');
const pool = require('../config/database');
const { logPaymentAction } = require('../utils/paymentHelpers');
const {
  creditWallet,
  recordPaymentAttempt,
  updatePaymentAttempt,
  isWebhookProcessed,
  isContributionConfirmed,
} = require('../utils/walletHelpers');
const {
  sendPaymentSuccessEmail,
  sendAutoPaySuccessEmail,
  sendAutoPayDisabledEmail,
  sendPaymentFailureEmail,
  sendWithdrawalCompletedEmail,
  sendWithdrawalFailedEmail,
} = require('../utils/email');
const { createNotification } = require('../utils/notifications');

const router = express.Router();

// Webhook endpoint for Resend email events
// This endpoint should be configured in your Resend dashboard
// URL: https://your-domain.com/api/webhook/email
router.post('/email', handleEmailWebhook);

// Stripe webhook endpoint
// URL: https://your-domain.com/api/webhook/stripe
// Configure this URL in your Stripe Dashboard: Settings > Webhooks
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const payload = req.body;

    console.log('🔔 Stripe webhook received - checking signature and payload');

    if (!signature || !payload) {
      console.error('❌ Missing signature or payload in Stripe webhook');
      return res.status(400).json({ error: 'Missing signature or payload' });
    }

    // Verify webhook signature
    const isValid = paymentService.verifyWebhookSignature(
      payload.toString(),
      signature,
      'stripe'
    );

    if (!isValid) {
      console.error('❌ Invalid Stripe webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    console.log('✅ Stripe webhook signature verified');

    // Parse event
    const event = JSON.parse(payload.toString());
    console.log('📨 Stripe webhook event received:', event.type, 'ID:', event.id);

    // Handle different event types
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handleStripePaymentSuccess(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handleStripePaymentFailure(event.data.object);
        break;
      case 'charge.dispute.created':
        await handleStripeDispute(event.data.object);
        break;
      case 'payout.paid':
        await handleStripePayoutSuccess(event.data.object);
        break;
      case 'payout.failed':
        await handleStripePayoutFailure(event.data.object);
        break;
      default:
        console.log('Unhandled Stripe webhook event type:', event.type);
    }

    // Return 200 quickly to acknowledge receipt
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(400).json({ error: 'Webhook processing failed' });
  }
});

// Paystack webhook endpoint
// URL: https://your-domain.com/api/webhook/paystack
// Configure this URL in your Paystack Dashboard: Settings > Webhooks
router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const payload = req.body;

    if (!signature || !payload) {
      return res.status(400).json({ error: 'Missing signature or payload' });
    }

    // Verify webhook signature
    const isValid = paymentService.verifyWebhookSignature(
      payload.toString(),
      signature,
      'paystack'
    );

    if (!isValid) {
      console.error('Invalid Paystack webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Parse event
    const event = JSON.parse(payload.toString());
    console.log('Paystack webhook event:', event.event, event.data?.reference);

    // Handle different event types
    switch (event.event) {
      case 'charge.success':
        await handlePaystackPaymentSuccess(event.data);
        break;
      case 'charge.failed':
        await handlePaystackPaymentFailure(event.data);
        break;
      case 'transfer.success':
        await handlePaystackTransferSuccess(event.data);
        break;
      case 'transfer.failed':
        await handlePaystackTransferFailure(event.data);
        break;
      default:
        console.log('Unhandled Paystack webhook event type:', event.event);
    }

    // Return 200 quickly to acknowledge receipt
    res.json({ received: true });
  } catch (error) {
    console.error('Paystack webhook error:', error);
    res.status(400).json({ error: 'Webhook processing failed' });
  }
});

// Handle Stripe payment success
async function handleStripePaymentSuccess(paymentIntent) {
  try {
    const { id, amount, currency, customer, metadata, status } = paymentIntent;

    if (status !== 'succeeded') {
      return;
    }

    // Check idempotency - prevent duplicate processing
    const alreadyProcessed = await isWebhookProcessed(id, 'stripe');
    if (alreadyProcessed) {
      console.log('Stripe webhook already processed (idempotency check):', id);
      return;
    }

    // Extract metadata to identify the contribution
    const { contributionType, contributionId, groupId, userId, recipientId } = metadata || {};

    if (!contributionType || !contributionId || !recipientId) {
      console.log('Missing required metadata in Stripe payment:', id, { contributionType, contributionId, recipientId });
      return;
    }

    // Check if contribution is already confirmed (prevent double payment)
    const alreadyConfirmed = await isContributionConfirmed(contributionType, contributionId);
    if (alreadyConfirmed) {
      console.log('Contribution already confirmed (prevent double payment):', contributionId);
      return;
    }

    // Get contribution amount and fees from metadata or calculate
    const contributionAmount = parseFloat(metadata.contributionAmount) || paymentService.convertFromSmallestUnit(amount, currency.toUpperCase());
    const fees = {
      platformFee: parseFloat(metadata.platformFee) || 0,
      processorFee: parseFloat(metadata.processorFee) || 0,
      grossAmount: parseFloat(metadata.grossAmount) || contributionAmount,
    };

    // Credit recipient's wallet
    console.log(`Crediting wallet for recipient ${recipientId}, contribution ${contributionId}, type ${contributionType}`);
    const creditResult = await creditWallet({
      recipientId,
      amount: contributionAmount, // Recipient receives full contribution amount (not including fees)
      currency: currency.toUpperCase(),
      groupId,
      description: `Auto-debit contribution via Stripe`,
      contributionType,
      contributionId,
      providerTransactionId: id,
      paymentProvider: 'stripe',
      fees,
    });
    console.log(`Wallet credited successfully. Transaction ID: ${creditResult.transactionId}, New balance: ${creditResult.newBalance}`);

    // Update payment attempt status
    await updatePaymentAttempt(
      metadata.attemptId || null,
      {
        status: 'success',
        providerTransactionId: id,
      }
    );

    // Log success
    await logPaymentAction({
      userId: userId || recipientId,
      action: 'auto_debit_success',
      amount: contributionAmount,
      currency: currency.toUpperCase(),
      status: 'success',
      paymentProvider: 'stripe',
      providerTransactionId: id,
      metadata: { contributionType, contributionId, groupId, transactionId: creditResult.transactionId },
    });

    // Send notifications to recipient and contributor
    try {
      const recipientResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [recipientId]
      );
      const contributorResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );
      const groupResult = await pool.query(
        'SELECT name FROM groups WHERE id = $1',
        [groupId]
      );

      if (recipientResult.rows.length > 0 && contributorResult.rows.length > 0 && groupResult.rows.length > 0) {
        const recipientEmail = recipientResult.rows[0].email;
        const recipientName = recipientResult.rows[0].name;
        const contributorEmail = contributorResult.rows[0].email;
        const contributorName = contributorResult.rows[0].name;
        const groupName = groupResult.rows[0].name;
        const currencySymbol = paymentService.formatCurrency(contributionAmount, currency.toUpperCase()).replace(/[\d.,]+/g, '');

        // Send email to recipient
        await sendPaymentSuccessEmail(
          recipientEmail,
          recipientName,
          contributionAmount,
          currency.toUpperCase(),
          contributorName,
          groupName,
          currencySymbol
        );

        // Send push and in-app notification to recipient
        const { formatAmount } = require('../utils/currency');
        const formattedAmount = formatAmount(contributionAmount, currency.toUpperCase());
        let recipientNotificationType;
        let recipientNotificationTitle;
        
        switch (contributionType) {
          case 'subscription':
            recipientNotificationType = 'subscription_contribution_paid';
            recipientNotificationTitle = 'Subscription Contribution Received';
            break;
          case 'birthday':
            recipientNotificationType = 'contribution_paid';
            recipientNotificationTitle = 'Contribution Received';
            break;
          case 'general':
            recipientNotificationType = 'general_contribution_paid';
            recipientNotificationTitle = 'Contribution Received';
            break;
          default:
            recipientNotificationType = 'contribution_paid';
            recipientNotificationTitle = 'Contribution Received';
        }
        
        await createNotification(
          recipientId,
          recipientNotificationType,
          recipientNotificationTitle,
          `${contributorName} made an automatic payment of ${formattedAmount} for ${groupName}`,
          groupId,
          userId
        );

        // Send email, push, and in-app notification to contributor (the person who paid)
        await sendAutoPaySuccessEmail(
          contributorEmail,
          contributorName,
          contributionAmount,
          currency.toUpperCase(),
          groupName,
          currencySymbol
        );

        // Send push and in-app notification to contributor
        await createNotification(
          userId,
          'autopay_success',
          'Auto-Pay Successful',
          `Your automatic payment of ${currencySymbol}${contributionAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for ${groupName} has been processed successfully.`,
          groupId,
          recipientId
        );
      }
    } catch (emailError) {
      console.error('Error sending payment notifications:', emailError);
      // Don't fail the webhook if email fails
    }

    console.log('Stripe payment success processed:', id, 'Amount:', contributionAmount, currency.toUpperCase());
  } catch (error) {
    console.error('Error handling Stripe payment success:', error);
    // Don't throw - webhook should return 200 even on error (to prevent retries)
  }
}

// Handle Stripe payment failure
async function handleStripePaymentFailure(paymentIntent) {
  try {
    const { id, amount, currency, customer, metadata, last_payment_error } = paymentIntent;

    // Extract metadata
    const { contributionType, contributionId, groupId, userId, attemptId, retryCount = 0 } = metadata || {};

    if (!contributionType || !contributionId || !userId || !groupId) {
      console.log('Missing required metadata in Stripe payment failure:', id);
      return;
    }

    const maxRetries = 1; // Max 2 attempts (initial + 1 retry)
    const currentRetryCount = parseInt(retryCount) || 0;
    const newRetryCount = currentRetryCount + 1;
    const shouldRetry = newRetryCount < maxRetries;
    const errorMessage = last_payment_error?.message || 'Payment failed';
    const declineCode = last_payment_error?.decline_code || 'unknown';

    // Get contribution amount
    const contributionAmount = parseFloat(metadata.contributionAmount) || paymentService.convertFromSmallestUnit(amount, currency.toUpperCase());

    // Update payment attempt status
    await updatePaymentAttempt(attemptId || null, {
      status: shouldRetry ? 'retry' : 'failed',
      errorMessage: `${errorMessage} (Code: ${declineCode})`,
      retryCount: newRetryCount,
    });

    if (!shouldRetry) {
      // Auto-disable auto-pay after max retries
      await pool.query(
        `UPDATE user_payment_preferences
         SET auto_pay_enabled = FALSE
         WHERE user_id = $1 AND group_id = $2`,
        [userId, groupId]
      );

      // Get user email for notification
      const userResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );

      const userEmail = userResult.rows[0]?.email;
      const userName = userResult.rows[0]?.name;

      // Get group name
      const groupResult = await pool.query(
        'SELECT name FROM groups WHERE id = $1',
        [groupId]
      );
      const groupName = groupResult.rows[0]?.name || 'Group';

      // TODO: Send notification email about auto-pay being disabled
      console.log('Auto-pay disabled for user:', userId, 'group:', groupId, 'after', newRetryCount, 'failed attempts');
    }

    // Log failure
    await logPaymentAction({
      userId,
      action: 'auto_debit_failed',
      amount: contributionAmount,
      currency: currency.toUpperCase(),
      status: 'failed',
      paymentProvider: 'stripe',
      providerTransactionId: id,
      errorMessage: `${errorMessage} (Code: ${declineCode})`,
      metadata: { contributionType, contributionId, groupId, shouldRetry, retryCount: newRetryCount },
    });

    console.log('Stripe payment failure processed:', id, 'Retry:', newRetryCount, 'Should retry:', shouldRetry);
  } catch (error) {
    console.error('Error handling Stripe payment failure:', error);
    // Don't throw - webhook should return 200 even on error
  }
}

// Handle Stripe dispute (chargeback)
async function handleStripeDispute(dispute) {
  try {
    const { id, charge, amount, reason, status } = dispute;

    // Log dispute
    await logPaymentAction({
      userId: null, // Will need to look up from charge
      action: 'chargeback',
      amount: amount / 100,
      status: 'pending',
      paymentProvider: 'stripe',
      providerTransactionId: id,
      metadata: { chargeId: charge, reason, status },
    });

    // TODO: Handle dispute/chargeback (respond with evidence, update records, etc.)
    console.log('Stripe dispute received:', id, reason);
  } catch (error) {
    console.error('Error handling Stripe dispute:', error);
  }
}

// Handle Paystack payment success
async function handlePaystackPaymentSuccess(data) {
  try {
    const { reference, amount, currency, customer, metadata, status } = data;

    if (status !== 'success') {
      return;
    }

    // Check idempotency - prevent duplicate processing
    const alreadyProcessed = await isWebhookProcessed(reference, 'paystack');
    if (alreadyProcessed) {
      console.log('Paystack webhook already processed (idempotency check):', reference);
      return;
    }

    // Parse metadata if it's a string (Paystack sends metadata as string)
    let parsedMetadata = metadata;
    if (typeof metadata === 'string') {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch (e) {
        parsedMetadata = {};
      }
    }

    const { contributionType, contributionId, groupId, userId, recipientId, contributionAmount, platformFee, processorFee, grossAmount } = parsedMetadata || {};

    if (!contributionType || !contributionId || !recipientId) {
      console.log('Missing required metadata in Paystack payment:', reference, { contributionType, contributionId, recipientId });
      return;
    }

    // Check if contribution is already confirmed (prevent double payment)
    const alreadyConfirmed = await isContributionConfirmed(contributionType, contributionId);
    if (alreadyConfirmed) {
      console.log('Contribution already confirmed (prevent double payment):', contributionId);
      return;
    }

    // Get contribution amount and fees
    const contribAmount = parseFloat(contributionAmount) || paymentService.convertFromSmallestUnit(amount, currency.toUpperCase());
    const fees = {
      platformFee: parseFloat(platformFee) || 0,
      processorFee: parseFloat(processorFee) || 0,
      grossAmount: parseFloat(grossAmount) || contribAmount,
    };

    // Credit recipient's wallet
    console.log(`Crediting wallet for recipient ${recipientId}, contribution ${contributionId}, type ${contributionType}`);
    const creditResult = await creditWallet({
      recipientId,
      amount: contribAmount,
      currency: currency.toUpperCase(),
      groupId,
      description: `Auto-debit contribution via Paystack`,
      contributionType,
      contributionId,
      providerTransactionId: reference,
      paymentProvider: 'paystack',
      fees,
    });
    console.log(`Wallet credited successfully. Transaction ID: ${creditResult.transactionId}, New balance: ${creditResult.newBalance}`);

    // Update payment attempt status
    await updatePaymentAttempt(parsedMetadata.attemptId || null, {
      status: 'success',
      providerTransactionId: reference,
    });

    // Log success
    await logPaymentAction({
      userId: userId || recipientId,
      action: 'auto_debit_success',
      amount: contribAmount,
      currency: currency.toUpperCase(),
      status: 'success',
      paymentProvider: 'paystack',
      providerTransactionId: reference,
      metadata: { contributionType, contributionId, groupId, transactionId: creditResult.transactionId },
    });

    // Send notifications to recipient and contributor
    try {
      const recipientResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [recipientId]
      );
      const contributorResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );
      const groupResult = await pool.query(
        'SELECT name FROM groups WHERE id = $1',
        [groupId]
      );

      if (recipientResult.rows.length > 0 && contributorResult.rows.length > 0 && groupResult.rows.length > 0) {
        const recipientEmail = recipientResult.rows[0].email;
        const recipientName = recipientResult.rows[0].name;
        const contributorEmail = contributorResult.rows[0].email;
        const contributorName = contributorResult.rows[0].name;
        const groupName = groupResult.rows[0].name;
        const currencySymbol = paymentService.formatCurrency(contribAmount, currency.toUpperCase()).replace(/[\d.,]+/g, '');

        // Send email to recipient
        await sendPaymentSuccessEmail(
          recipientEmail,
          recipientName,
          contribAmount,
          currency.toUpperCase(),
          contributorName,
          groupName,
          currencySymbol
        );

        // Send push and in-app notification to recipient
        const { formatAmount } = require('../utils/currency');
        const formattedAmount = formatAmount(contribAmount, currency.toUpperCase());
        let recipientNotificationType;
        let recipientNotificationTitle;
        
        switch (contributionType) {
          case 'subscription':
            recipientNotificationType = 'subscription_contribution_paid';
            recipientNotificationTitle = 'Subscription Contribution Received';
            break;
          case 'birthday':
            recipientNotificationType = 'contribution_paid';
            recipientNotificationTitle = 'Contribution Received';
            break;
          case 'general':
            recipientNotificationType = 'general_contribution_paid';
            recipientNotificationTitle = 'Contribution Received';
            break;
          default:
            recipientNotificationType = 'contribution_paid';
            recipientNotificationTitle = 'Contribution Received';
        }
        
        await createNotification(
          recipientId,
          recipientNotificationType,
          recipientNotificationTitle,
          `${contributorName} made an automatic payment of ${formattedAmount} for ${groupName}`,
          groupId,
          userId
        );

        // Send email, push, and in-app notification to contributor (the person who paid)
        await sendAutoPaySuccessEmail(
          contributorEmail,
          contributorName,
          contribAmount,
          currency.toUpperCase(),
          groupName,
          currencySymbol
        );

        // Send push and in-app notification to contributor
        await createNotification(
          userId,
          'autopay_success',
          'Auto-Pay Successful',
          `Your automatic payment of ${currencySymbol}${contribAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for ${groupName} has been processed successfully.`,
          groupId,
          recipientId
        );
      }
    } catch (emailError) {
      console.error('Error sending payment notifications:', emailError);
      // Don't fail the webhook if email fails
    }

    console.log('Paystack payment success processed:', reference, 'Amount:', contribAmount, currency.toUpperCase());
  } catch (error) {
    console.error('Error handling Paystack payment success:', error);
  }
}

// Handle Paystack payment failure
async function handlePaystackPaymentFailure(data) {
  try {
    const { reference, amount, currency, customer, metadata, gateway_response, message } = data;

    // Parse metadata if it's a string
    let parsedMetadata = metadata;
    if (typeof metadata === 'string') {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch (e) {
        parsedMetadata = {};
      }
    }

    const { contributionType, contributionId, groupId, userId, attemptId, retryCount = 0 } = parsedMetadata || {};

    if (!contributionType || !contributionId || !userId || !groupId) {
      console.log('Missing required metadata in Paystack payment failure:', reference);
      return;
    }

    const maxRetries = 1; // Max 2 attempts (initial + 1 retry)
    const currentRetryCount = parseInt(retryCount) || 0;
    const newRetryCount = currentRetryCount + 1;
    const shouldRetry = newRetryCount < maxRetries;
    const errorMessage = gateway_response || message || 'Payment failed';

    // Get contribution amount
    const contributionAmount = parseFloat(parsedMetadata.contributionAmount) || paymentService.convertFromSmallestUnit(amount, currency.toUpperCase());

    // Update payment attempt status
    await updatePaymentAttempt(attemptId || null, {
      status: shouldRetry ? 'retry' : 'failed',
      errorMessage,
      retryCount: newRetryCount,
    });

    if (!shouldRetry) {
      // Auto-disable auto-pay after max retries
      await pool.query(
        `UPDATE user_payment_preferences
         SET auto_pay_enabled = FALSE
         WHERE user_id = $1 AND group_id = $2`,
        [userId, groupId]
      );

      // Get user email for notification
      const userResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );

      const userEmail = userResult.rows[0]?.email;
      const userName = userResult.rows[0]?.name;

      // Get group name
      const groupResult = await pool.query(
        'SELECT name FROM groups WHERE id = $1',
        [groupId]
      );
      const groupName = groupResult.rows[0]?.name || 'Group';

      // Send notification email about auto-pay being disabled
      try {
        if (userEmail && userName) {
          await sendAutoPayDisabledEmail(
            userEmail,
            userName,
            groupName,
            `Payment failed after ${newRetryCount} attempts: ${errorMessage}`
          );
        }
      } catch (emailError) {
        console.error('Error sending auto-pay disabled email:', emailError);
        // Don't fail the webhook if email fails
      }

      // Also send payment failure email
      try {
        if (userEmail && userName) {
          const currencySymbol = paymentService.formatCurrency(contributionAmount, currency.toUpperCase()).replace(/[\d.,]+/g, '');
          await sendPaymentFailureEmail(
            userEmail,
            userName,
            contributionAmount,
            currency.toUpperCase(),
            groupName,
            errorMessage,
            newRetryCount,
            currencySymbol
          );
        }
      } catch (emailError) {
        console.error('Error sending payment failure email:', emailError);
      }

      console.log('Auto-pay disabled for user:', userId, 'group:', groupId, 'after', newRetryCount, 'failed attempts');
    }

    // Log failure
    await logPaymentAction({
      userId,
      action: 'auto_debit_failed',
      amount: contributionAmount,
      currency: currency.toUpperCase(),
      status: 'failed',
      paymentProvider: 'paystack',
      providerTransactionId: reference,
      errorMessage,
      metadata: { contributionType, contributionId, groupId, shouldRetry, retryCount: newRetryCount },
    });

    console.log('Paystack payment failure processed:', reference, 'Retry:', newRetryCount, 'Should retry:', shouldRetry);
  } catch (error) {
    console.error('Error handling Paystack payment failure:', error);
  }
}

// Handle Paystack transfer success (withdrawal)
async function handlePaystackTransferSuccess(data) {
  try {
    const reference = data.reference;
    console.log('Paystack transfer success:', reference);

    // Find withdrawal by provider transaction ID
    const withdrawalResult = await pool.query(
      `SELECT w.*, u.email, u.name
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.provider_transaction_id = $1 OR w.id::text = $1
       LIMIT 1`,
      [reference]
    );

    if (withdrawalResult.rows.length === 0) {
      console.log('Withdrawal not found for transfer reference:', reference);
      return;
    }

    const withdrawal = withdrawalResult.rows[0];

    // Check if already processed (idempotency)
    if (withdrawal.status === 'completed') {
      console.log('Withdrawal already completed:', withdrawal.id);
      return;
    }

    // Update withdrawal status
    await pool.query(
      `UPDATE withdrawals
       SET status = 'completed', processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [withdrawal.id]
    );

    // Update transaction status
    await pool.query(
      `UPDATE transactions
       SET status = 'completed'
       WHERE reference = $1 AND type = 'withdrawal'`,
      [withdrawal.id]
    );

    // Send email notification
    try {
      if (withdrawal.email) {
        const netAmount = typeof withdrawal.net_amount === 'string' ? parseFloat(withdrawal.net_amount) : Number(withdrawal.net_amount);
        const requestedAmount = typeof withdrawal.amount === 'string' ? parseFloat(withdrawal.amount) : Number(withdrawal.amount);
        const fee = typeof withdrawal.fee === 'string' ? parseFloat(withdrawal.fee) : Number(withdrawal.fee || 0);
        const currencySymbol = paymentService.formatCurrency(netAmount, withdrawal.currency).replace(/[\d.,]+/g, '');
        await sendWithdrawalCompletedEmail(
          withdrawal.email,
          withdrawal.name,
          netAmount,
          withdrawal.currency,
          currencySymbol,
          reference,
          requestedAmount,
          fee
        );
      }
    } catch (emailError) {
      console.error('Error sending withdrawal completed email:', emailError);
    }

    // Create notification
    try {
      const { createNotification } = require('../utils/notifications');
      await createNotification(
        withdrawal.user_id,
        'withdrawal_completed',
        'Withdrawal Completed',
        `Your withdrawal of ${withdrawal.currency} ${withdrawal.net_amount} has been processed successfully.`,
        null,
        null
      );
    } catch (notificationError) {
      console.error('Error creating withdrawal notification:', notificationError);
    }

    // Log action
    await logPaymentAction({
      userId: withdrawal.user_id,
      action: 'withdrawal_completed_webhook',
      amount: withdrawal.net_amount,
      currency: withdrawal.currency,
      status: 'completed',
      paymentProvider: 'paystack',
      metadata: {
        withdrawalId: withdrawal.id,
        transactionId: reference,
        fee: withdrawal.fee,
      },
    });

    console.log(`Withdrawal ${withdrawal.id} marked as completed via webhook`);
  } catch (error) {
    console.error('Error handling Paystack transfer success:', error);
  }
}

// Handle Paystack transfer failure (withdrawal)
async function handlePaystackTransferFailure(data) {
  try {
    const reference = data.reference;
    const message = data.message || 'Transfer failed';
    console.log('Paystack transfer failure:', reference, message);

    // Find withdrawal by provider transaction ID
    const withdrawalResult = await pool.query(
      `SELECT w.*, u.email, u.name
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.provider_transaction_id = $1 OR w.id::text = $1
       LIMIT 1`,
      [reference]
    );

    if (withdrawalResult.rows.length === 0) {
      console.log('Withdrawal not found for transfer reference:', reference);
      return;
    }

    const withdrawal = withdrawalResult.rows[0];

    // Check if already processed (idempotency)
    if (withdrawal.status === 'failed' || withdrawal.status === 'completed') {
      console.log('Withdrawal already processed:', withdrawal.id);
      return;
    }

    // Update withdrawal status
    await pool.query(
      `UPDATE withdrawals
       SET status = 'failed', error_message = $1, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [message, withdrawal.id]
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

    // Send email notification
    try {
      if (withdrawal.email) {
        const { sendWithdrawalFailedEmail } = require('../utils/email');
        const currencySymbol = paymentService.formatCurrency(withdrawal.amount, withdrawal.currency).replace(/[\d.,]+/g, '');
        await sendWithdrawalFailedEmail(
          withdrawal.email,
          withdrawal.name,
          withdrawal.amount,
          withdrawal.currency,
          currencySymbol,
          null // Don't pass error message to email - use generic message
        );
      }
    } catch (emailError) {
      console.error('Error sending withdrawal failed email:', emailError);
    }

    // Create notification
    try {
      const { createNotification } = require('../utils/notifications');
      await createNotification(
        withdrawal.user_id,
        'withdrawal_failed',
        'Withdrawal Failed',
        `Unfortunately, an error occurred while processing your withdrawal. Your funds have been returned to your wallet. Please try again.`,
        null,
        null
      );
    } catch (notificationError) {
      console.error('Error creating withdrawal notification:', notificationError);
    }

    // Log action
    await logPaymentAction({
      userId: withdrawal.user_id,
      action: 'withdrawal_failed_webhook',
      amount: withdrawal.amount,
      currency: withdrawal.currency,
      status: 'failed',
      paymentProvider: 'paystack',
      errorMessage: message,
      metadata: {
        withdrawalId: withdrawal.id,
        transactionId: reference,
        fee: withdrawal.fee,
      },
    });

    console.log(`Withdrawal ${withdrawal.id} marked as failed via webhook`);
  } catch (error) {
    console.error('Error handling Paystack transfer failure:', error);
  }
}

// Handle Stripe payout success (withdrawal)
async function handleStripePayoutSuccess(payout) {
  try {
    const payoutId = payout.id;
    console.log('Stripe payout success:', payoutId);

    // Find withdrawal by provider transaction ID
    const withdrawalResult = await pool.query(
      `SELECT w.*, u.email, u.name
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.provider_transaction_id = $1 OR w.id::text = $1
       LIMIT 1`,
      [payoutId]
    );

    if (withdrawalResult.rows.length === 0) {
      console.log('Withdrawal not found for payout ID:', payoutId);
      return;
    }

    const withdrawal = withdrawalResult.rows[0];

    // Check if already processed (idempotency)
    if (withdrawal.status === 'completed') {
      console.log('Withdrawal already completed:', withdrawal.id);
      return;
    }

    // Update withdrawal status
    await pool.query(
      `UPDATE withdrawals
       SET status = 'completed', processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [withdrawal.id]
    );

    // Update transaction status
    await pool.query(
      `UPDATE transactions
       SET status = 'completed'
       WHERE reference = $1 AND type = 'withdrawal'`,
      [withdrawal.id]
    );

    // Send email notification
    try {
      if (withdrawal.email) {
        const paymentService = require('../services/paymentService');
        const { sendWithdrawalCompletedEmail } = require('../utils/email');
        const netAmount = typeof withdrawal.net_amount === 'string' ? parseFloat(withdrawal.net_amount) : Number(withdrawal.net_amount);
        const requestedAmount = typeof withdrawal.amount === 'string' ? parseFloat(withdrawal.amount) : Number(withdrawal.amount);
        const fee = typeof withdrawal.fee === 'string' ? parseFloat(withdrawal.fee) : Number(withdrawal.fee || 0);
        const currencySymbol = paymentService.formatCurrency(netAmount, withdrawal.currency).replace(/[\d.,]+/g, '');
        await sendWithdrawalCompletedEmail(
          withdrawal.email,
          withdrawal.name,
          netAmount,
          withdrawal.currency,
          currencySymbol,
          payoutId,
          requestedAmount,
          fee
        );
      }
    } catch (emailError) {
      console.error('Error sending withdrawal completed email:', emailError);
    }

    // Create notification
    try {
      const { createNotification } = require('../utils/notifications');
      await createNotification(
        withdrawal.user_id,
        'withdrawal_completed',
        'Withdrawal Completed',
        `Your withdrawal of ${withdrawal.currency} ${withdrawal.net_amount} has been processed successfully.`,
        null,
        null
      );
    } catch (notificationError) {
      console.error('Error creating withdrawal notification:', notificationError);
    }

    // Log action
    await logPaymentAction({
      userId: withdrawal.user_id,
      action: 'withdrawal_completed_webhook',
      amount: withdrawal.net_amount,
      currency: withdrawal.currency,
      status: 'completed',
      paymentProvider: 'stripe',
      metadata: {
        withdrawalId: withdrawal.id,
        transactionId: payoutId,
        fee: withdrawal.fee,
      },
    });

    console.log(`Withdrawal ${withdrawal.id} marked as completed via webhook`);
  } catch (error) {
    console.error('Error handling Stripe payout success:', error);
  }
}

// Handle Stripe payout failure (withdrawal)
async function handleStripePayoutFailure(payout) {
  try {
    const payoutId = payout.id;
    const failureMessage = payout.failure_message || 'Payout failed';
    console.log('Stripe payout failure:', payoutId, failureMessage);

    // Find withdrawal by provider transaction ID
    const withdrawalResult = await pool.query(
      `SELECT w.*, u.email, u.name
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.provider_transaction_id = $1 OR w.id::text = $1
       LIMIT 1`,
      [payoutId]
    );

    if (withdrawalResult.rows.length === 0) {
      console.log('Withdrawal not found for payout ID:', payoutId);
      return;
    }

    const withdrawal = withdrawalResult.rows[0];

    // Check if already processed (idempotency)
    if (withdrawal.status === 'failed' || withdrawal.status === 'completed') {
      console.log('Withdrawal already processed:', withdrawal.id);
      return;
    }

    // Update withdrawal status
    await pool.query(
      `UPDATE withdrawals
       SET status = 'failed', error_message = $1, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [failureMessage, withdrawal.id]
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

    // Send email notification
    try {
      if (withdrawal.email) {
        const paymentService = require('../services/paymentService');
        const { sendWithdrawalFailedEmail } = require('../utils/email');
        const currencySymbol = paymentService.formatCurrency(withdrawal.amount, withdrawal.currency).replace(/[\d.,]+/g, '');
        await sendWithdrawalFailedEmail(
          withdrawal.email,
          withdrawal.name,
          withdrawal.amount,
          withdrawal.currency,
          currencySymbol,
          null // Don't pass error message to email - use generic message
        );
      }
    } catch (emailError) {
      console.error('Error sending withdrawal failed email:', emailError);
    }

    // Create notification
    try {
      const { createNotification } = require('../utils/notifications');
      await createNotification(
        withdrawal.user_id,
        'withdrawal_failed',
        'Withdrawal Failed',
        `Unfortunately, an error occurred while processing your withdrawal. Your funds have been returned to your wallet. Please try again.`,
        null,
        null
      );
    } catch (notificationError) {
      console.error('Error creating withdrawal notification:', notificationError);
    }

    // Log action
    await logPaymentAction({
      userId: withdrawal.user_id,
      action: 'withdrawal_failed_webhook',
      amount: withdrawal.amount,
      currency: withdrawal.currency,
      status: 'failed',
      paymentProvider: 'stripe',
      errorMessage: failureMessage,
      metadata: {
        withdrawalId: withdrawal.id,
        transactionId: payoutId,
        fee: withdrawal.fee,
      },
    });

    console.log(`Withdrawal ${withdrawal.id} marked as failed via webhook`);
  } catch (error) {
    console.error('Error handling Stripe payout failure:', error);
  }
}

// Export handler function for manual processing
module.exports = router;
module.exports.handleStripePaymentSuccess = handleStripePaymentSuccess;

