const Stripe = require('stripe');
const Paystack = require('paystack')(process.env.PAYSTACK_SECRET_KEY);
require('dotenv').config();

/**
 * Payment Service Abstraction Layer
 * Provides unified interface for Stripe and Paystack payment processing
 */
class PaymentService {
  constructor() {
    // Initialize Stripe if API key is available
    this.stripe = process.env.STRIPE_SECRET_KEY 
      ? new Stripe(process.env.STRIPE_SECRET_KEY, {
          apiVersion: '2024-11-20.acacia',
        })
      : null;
    
    // Paystack is initialized above
    this.paystack = process.env.PAYSTACK_SECRET_KEY ? Paystack : null;
  }

  /**
   * Select appropriate payment provider based on currency/country
   * @param {string} currency - Currency code (NGN, USD, etc.)
   * @param {string} country - Country code (NG, KE, GH, ZA, etc.)
   * @returns {string} - Provider name: 'stripe' or 'paystack'
   */
  selectProvider(currency, country) {
    // Paystack for Africa
    if (currency === 'NGN' || country === 'NG') return 'paystack'; // Nigeria
    if (currency === 'KES' || country === 'KE') return 'paystack'; // Kenya
    if (currency === 'GHS' || country === 'GH') return 'paystack'; // Ghana
    if (currency === 'ZAR' || country === 'ZA') return 'paystack'; // South Africa
    
    // Stripe for rest of world
    return 'stripe';
  }

  /**
   * Create a customer in the payment provider
   * @param {Object} customerData - Customer data
   * @param {string} customerData.email - Customer email
   * @param {string} customerData.name - Customer name
   * @param {string} provider - 'stripe' or 'paystack'
   * @returns {Promise<string>} - Customer ID
   */
  async createCustomer({ email, name }, provider = 'stripe') {
    try {
      if (provider === 'stripe' && this.stripe) {
        const customer = await this.stripe.customers.create({
          email,
          name,
        });
        return customer.id;
      } else if (provider === 'paystack' && this.paystack) {
        const response = await this.paystack.customer.create({
          email,
          first_name: name.split(' ')[0] || name,
          last_name: name.split(' ').slice(1).join(' ') || '',
        });
        if (response.status) {
          return response.data.customer_code;
        }
        throw new Error(response.message || 'Failed to create Paystack customer');
      }
      throw new Error(`Provider ${provider} not configured`);
    } catch (error) {
      console.error(`Error creating customer with ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Create a payment method (save card for future use)
   * @param {Object} paymentMethodData - Payment method data
   * @param {string} customerId - Customer ID
   * @param {string} provider - 'stripe' or 'paystack'
   * @returns {Promise<string>} - Payment method ID
   */
  async createPaymentMethod(paymentMethodData, customerId, provider = 'stripe') {
    try {
      if (provider === 'stripe' && this.stripe) {
        // For Stripe, we'll create a SetupIntent for saving cards
        // Frontend will handle the actual card collection
        const setupIntent = await this.stripe.setupIntents.create({
          customer: customerId,
          payment_method_types: ['card'],
        });
        return setupIntent.id;
      } else if (provider === 'paystack' && this.paystack) {
        // For Paystack, we'll use authorization API
        // Frontend will handle the actual card authorization
        // This is a placeholder - actual implementation depends on Paystack authorization flow
        throw new Error('Paystack payment method creation requires frontend integration');
      }
      throw new Error(`Provider ${provider} not configured`);
    } catch (error) {
      console.error(`Error creating payment method with ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Convert amount to smallest currency unit (cents/kobo)
   * @param {number} amount - Amount in main currency unit
   * @param {string} currency - Currency code
   * @returns {number} - Amount in smallest currency unit
   */
  convertToSmallestUnit(amount, currency) {
    // For most currencies, multiply by 100 (cents, kobo, etc.)
    return Math.round(amount * 100);
  }

  /**
   * Convert amount from smallest currency unit to main unit
   * @param {number} amount - Amount in smallest currency unit
   * @param {string} currency - Currency code
   * @returns {number} - Amount in main currency unit
   */
  convertFromSmallestUnit(amount, currency) {
    return amount / 100;
  }

  /**
   * Validate transaction amount (min/max limits)
   * @param {number} amount - Amount in main currency unit
   * @param {string} currency - Currency code
   * @returns {Object} - { valid: boolean, error?: string }
   */
  validateAmount(amount, currency) {
    // Minimum amounts based on processor minimums and fee coverage
    const minimums = {
      NGN: 100,    // ₦100 minimum (covers Paystack fees)
      USD: 0.50,   // $0.50 minimum
      GBP: 0.30,   // £0.30 minimum
      EUR: 0.50,   // €0.50 minimum
      KES: 10,     // KSh 10 minimum
      GHS: 1,      // ₵1 minimum
      ZAR: 2,      // R2 minimum
      CAD: 0.50,   // $0.50 CAD
      AUD: 0.50,   // $0.50 AUD
      JPY: 50,     // ¥50 minimum
    };

    // Maximum amounts (optional - prevent fraud)
    const maximums = {
      NGN: 10000000,  // ₦10M per transaction
      USD: 50000,     // $50K per transaction
      GBP: 50000,     // £50K per transaction
      EUR: 50000,     // €50K per transaction
      KES: 5000000,   // KSh 5M
      GHS: 500000,    // ₵500K
      ZAR: 1000000,   // R1M
      CAD: 50000,
      AUD: 50000,
      JPY: 5000000,   // ¥5M
    };

    const min = minimums[currency] || 0.50;
    const max = maximums[currency] || 50000;

    if (amount < min) {
      return {
        valid: false,
        error: `Minimum amount is ${this.formatCurrency(min, currency)}`,
      };
    }

    if (amount > max) {
      return {
        valid: false,
        error: `Maximum amount is ${this.formatCurrency(max, currency)}`,
      };
    }

    return { valid: true };
  }

  /**
   * Format currency amount with symbol
   * @param {number} amount - Amount
   * @param {string} currency - Currency code
   * @returns {string} - Formatted amount
   */
  formatCurrency(amount, currency) {
    const symbols = {
      NGN: '₦',
      USD: '$',
      GBP: '£',
      EUR: '€',
      KES: 'KSh',
      GHS: '₵',
      ZAR: 'R',
      CAD: '$',
      AUD: '$',
      JPY: '¥',
    };

    const symbol = symbols[currency] || currency;
    return `${symbol}${amount.toFixed(2)}`;
  }

  /**
   * Charge a payment method
   * @param {Object} chargeData - Charge data
   * @param {string} chargeData.paymentMethodId - Payment method ID
   * @param {number} chargeData.amount - Amount in main currency unit
   * @param {string} chargeData.currency - Currency code
   * @param {string} chargeData.customerId - Customer ID
   * @param {string} chargeData.description - Transaction description
   * @param {Object} chargeData.metadata - Additional metadata
   * @param {string} provider - 'stripe' or 'paystack'
   * @returns {Promise<Object>} - Payment result with transaction ID
   */
  async chargePaymentMethod({
    paymentMethodId,
    amount, // Amount in main currency unit
    currency,
    customerId,
    description,
    metadata = {},
  }, provider = 'stripe') {
    try {
      // Validate amount
      const validation = this.validateAmount(amount, currency);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          status: 'failed',
        };
      }

      if (provider === 'stripe' && this.stripe) {
        // Convert amount to cents
        const amountInCents = this.convertToSmallestUnit(amount, currency);

        // Create payment intent with idempotency key
        const idempotencyKey = metadata.idempotencyKey || `charge_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        const paymentIntent = await this.stripe.paymentIntents.create({
          amount: amountInCents,
          currency: currency.toLowerCase(),
          customer: customerId,
          payment_method: paymentMethodId,
          description,
          metadata: {
            ...metadata,
            idempotencyKey,
          },
          confirm: true,
          return_url: process.env.FRONTEND_URL || 'https://groupfund.app',
        }, {
          idempotencyKey,
        });

        if (paymentIntent.status === 'succeeded') {
          return {
            success: true,
            transactionId: paymentIntent.id,
            chargeId: paymentIntent.latest_charge,
            amount: this.convertFromSmallestUnit(paymentIntent.amount, currency),
            amountInSmallestUnit: paymentIntent.amount,
            currency: paymentIntent.currency.toUpperCase(),
            status: paymentIntent.status,
          };
        }

        // Handle requires_action (3D Secure)
        if (paymentIntent.status === 'requires_action') {
          return {
            success: false,
            requiresAction: true,
            clientSecret: paymentIntent.client_secret,
            transactionId: paymentIntent.id,
            status: paymentIntent.status,
          };
        }

        return {
          success: false,
          error: paymentIntent.last_payment_error?.message || 'Payment failed',
          status: paymentIntent.status,
          declineCode: paymentIntent.last_payment_error?.decline_code,
        };
      } else if (provider === 'paystack' && this.paystack) {
        // Convert amount to kobo
        const amountInKobo = this.convertToSmallestUnit(amount, currency);

        // For Paystack, charge using authorization code
        const response = await this.paystack.transaction.charge({
          authorization_code: paymentMethodId,
          email: metadata.email || customerId,
          amount: amountInKobo,
          currency: currency.toUpperCase(),
          metadata: JSON.stringify(metadata),
        });

        if (response.status && response.data.status === 'success') {
          return {
            success: true,
            transactionId: response.data.reference,
            chargeId: response.data.id.toString(),
            amount: this.convertFromSmallestUnit(response.data.amount, currency),
            amountInSmallestUnit: response.data.amount,
            currency: response.data.currency,
            status: 'success',
          };
        }

        return {
          success: false,
          error: response.message || 'Payment failed',
          status: response.data?.status || 'failed',
          gatewayResponse: response.data?.gateway_response,
        };
      }
      throw new Error(`Provider ${provider} not configured`);
    } catch (error) {
      console.error(`Error charging payment method with ${provider}:`, error);
      
      // Don't expose sensitive error details
      const userMessage = error.type === 'StripeCardError' 
        ? 'Your card was declined. Please check your card details.'
        : error.message || 'Payment processing failed';

      return {
        success: false,
        error: userMessage,
        status: 'failed',
        internalError: error.message, // Log internally but don't expose
      };
    }
  }

  /**
   * Verify webhook signature
   * @param {string} payload - Raw webhook payload
   * @param {string} signature - Webhook signature from header
   * @param {string} provider - 'stripe' or 'paystack'
   * @returns {boolean} - True if signature is valid
   */
  verifyWebhookSignature(payload, signature, provider = 'stripe') {
    try {
      if (provider === 'stripe' && this.stripe) {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) {
          console.error('STRIPE_WEBHOOK_SECRET not configured');
          return false;
        }
        
        const event = this.stripe.webhooks.constructEvent(
          payload,
          signature,
          webhookSecret
        );
        return !!event;
      } else if (provider === 'paystack' && this.paystack) {
        const crypto = require('crypto');
        const webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
        if (!webhookSecret) {
          console.error('PAYSTACK_WEBHOOK_SECRET not configured');
          return false;
        }

        const hash = crypto
          .createHmac('sha512', webhookSecret)
          .update(payload)
          .digest('hex');

        return hash === signature;
      }
      return false;
    } catch (error) {
      console.error(`Error verifying webhook signature for ${provider}:`, error);
      return false;
    }
  }

  /**
   * Calculate fees for a transaction
   * @param {number} amount - Amount in main currency unit
   * @param {string} currency - Currency code
   * @param {string} provider - 'stripe' or 'paystack'
   * @param {number} platformFeePercent - Platform fee percentage (default 1%)
   * @returns {Object} - Fee breakdown
   */
  calculateFees(amount, currency, provider = 'stripe', platformFeePercent = 1) {
    let processorFee = 0;
    let processorFeePercent = 0;
    let processorFeeFixed = 0;

    if (provider === 'paystack') {
      // Paystack fees
      if (currency === 'NGN') {
        processorFeePercent = 1.5;
        processorFeeFixed = 100; // ₦100
      } else if (currency === 'KES') {
        processorFeePercent = 3.0;
        processorFeeFixed = 10; // KSh 10
      } else if (currency === 'GHS') {
        processorFeePercent = 2.9;
        processorFeeFixed = 1; // ₵1
      } else if (currency === 'ZAR') {
        processorFeePercent = 3.5;
        processorFeeFixed = 2; // R2
      }
    } else if (provider === 'stripe') {
      // Stripe fees (approximate, varies by country)
      processorFeePercent = 2.9;
      // Convert fixed fee based on currency
      if (currency === 'USD') {
        processorFeeFixed = 0.30;
      } else if (currency === 'GBP') {
        processorFeeFixed = 0.20;
      } else if (currency === 'EUR') {
        processorFeeFixed = 0.25;
      } else {
        processorFeeFixed = 0.30; // Default
      }
    }

    processorFee = (amount * processorFeePercent / 100) + processorFeeFixed;
    const platformFee = (amount * platformFeePercent / 100);
    const totalFee = processorFee + platformFee;
    const grossAmount = amount + totalFee;
    const netAmount = amount; // Recipient receives full amount

    return {
      amount, // Original contribution amount
      processorFee,
      processorFeePercent,
      processorFeeFixed,
      platformFee,
      platformFeePercent,
      totalFee,
      grossAmount, // Total charged to contributor
      netAmount, // Amount recipient receives
    };
  }

  /**
   * Create a payout/transfer to recipient's bank account
   * @param {Object} payoutData - Payout data
   * @param {number} payoutData.amount - Amount in main currency unit
   * @param {string} payoutData.currency - Currency code
   * @param {Object} payoutData.bankAccount - Bank account details
   * @param {string} payoutData.bankAccount.accountNumber - Account number
   * @param {string} payoutData.bankAccount.bankCode - Bank code (Paystack) or routing number (Stripe)
   * @param {string} payoutData.bankAccount.accountName - Account name
   * @param {string} payoutData.bankAccount.country - Country code
   * @param {string} payoutData.description - Payout description
   * @param {string} provider - 'stripe' or 'paystack'
   * @returns {Promise<Object>} - Payout result
   */
  async createPayout({
    amount,
    currency,
    bankAccount,
    description,
  }, provider = 'stripe') {
    try {
      if (provider === 'stripe' && this.stripe) {
        // For Stripe, we need to create a payout to external bank account
        // This requires creating an External Account first (simplified approach)
        // Note: For production, you may need to use Stripe Connect or Payouts API
        
        // Convert amount to smallest currency unit
        const amountInCents = this.convertToSmallestUnit(amount, currency);
        
        // For Stripe, we'll use the Payouts API which requires a connected account
        // For direct bank transfers, use the bank account information
        // This is a simplified version - production may require more setup
        
        // Create payout to external bank account
        // Note: In production, you'll need to set up bank account tokens/external accounts
        const payout = await this.stripe.payouts.create({
          amount: amountInCents,
          currency: currency.toLowerCase(),
          method: 'standard', // or 'instant' for faster (higher fees)
          description: description || 'Withdrawal',
          // For production, you'll need to attach a bank account or use Stripe Connect
          // destination: bankAccount.externalAccountId, // External account ID
        });

        return {
          success: true,
          payoutId: payout.id,
          amount: this.convertFromSmallestUnit(payout.amount, currency),
          currency: payout.currency.toUpperCase(),
          status: payout.status,
          arrivalDate: payout.arrival_date,
        };
      } else if (provider === 'paystack' && this.paystack) {
        // For Paystack, we need to create a transfer recipient first, then transfer
        // Convert amount to kobo (smallest unit for NGN)
        const amountInSmallest = this.convertToSmallestUnit(amount, currency);

        // Step 1: Create transfer recipient (if not exists)
        // Check if recipient already exists based on account number
        let recipientCode = bankAccount.recipientCode;
        
        if (!recipientCode) {
          // Create new transfer recipient
          const recipientResponse = await this.paystack.transferrecipient.create({
            type: 'nuban', // Bank account
            name: bankAccount.accountName,
            account_number: bankAccount.accountNumber,
            bank_code: bankAccount.bankCode,
            currency: currency.toUpperCase(),
          });

          if (!recipientResponse.status) {
            return {
              success: false,
              error: recipientResponse.message || 'Failed to create transfer recipient',
              status: 'failed',
            };
          }

          recipientCode = recipientResponse.data.recipient_code;
        }

        // Step 2: Create transfer to recipient
        const transferResponse = await this.paystack.transfer.create({
          source: 'balance',
          amount: amountInSmallest,
          currency: currency.toUpperCase(),
          recipient: recipientCode,
          reason: description || 'Withdrawal',
        });

        if (transferResponse.status && transferResponse.data.status === 'success') {
          return {
            success: true,
            transferId: transferResponse.data.reference,
            recipientCode: recipientCode,
            amount: this.convertFromSmallestUnit(transferResponse.data.amount, currency),
            currency: transferResponse.data.currency,
            status: 'success',
            createdAt: transferResponse.data.createdAt,
          };
        }

        return {
          success: false,
          error: transferResponse.message || 'Transfer failed',
          status: transferResponse.data?.status || 'failed',
        };
      }
      throw new Error(`Provider ${provider} not configured`);
    } catch (error) {
      console.error(`Error creating payout with ${provider}:`, error);
      return {
        success: false,
        error: error.message || 'Payout processing failed',
        status: 'failed',
      };
    }
  }

  /**
   * Refund a transaction
   * @param {Object} refundData - Refund data
   * @param {string} refundData.transactionId - Transaction ID or reference to refund
   * @param {number} refundData.amount - Optional: Partial refund amount (in main currency unit). If not provided, full refund.
   * @param {string} refundData.currency - Currency code
   * @param {string} provider - 'stripe' or 'paystack'
   * @returns {Promise<Object>} - Refund result
   */
  async refundTransaction({
    transactionId,
    amount,
    currency,
  }, provider = 'stripe') {
    try {
      if (provider === 'stripe' && this.stripe) {
        // For Stripe, refund using charge ID or payment intent ID
        let refund;
        
        if (amount) {
          // Partial refund
          const amountInCents = this.convertToSmallestUnit(amount, currency);
          refund = await this.stripe.refunds.create({
            charge: transactionId,
            amount: amountInCents,
          });
        } else {
          // Full refund
          refund = await this.stripe.refunds.create({
            charge: transactionId,
          });
        }

        return {
          success: true,
          refundId: refund.id,
          amount: this.convertFromSmallestUnit(refund.amount, currency),
          currency: refund.currency.toUpperCase(),
          status: refund.status,
        };
      } else if (provider === 'paystack' && this.paystack) {
        // For Paystack, refund using transaction reference
        let refund;
        
        if (amount) {
          // Partial refund
          const amountInKobo = this.convertToSmallestUnit(amount, currency);
          refund = await this.paystack.refund.create({
            transaction: transactionId,
            amount: amountInKobo,
            currency: currency.toUpperCase(),
          });
        } else {
          // Full refund
          refund = await this.paystack.refund.create({
            transaction: transactionId,
            currency: currency.toUpperCase(),
          });
        }

        if (refund.status && refund.data.status === 'processed') {
          return {
            success: true,
            refundId: refund.data.id.toString(),
            transactionRefunded: refund.data.transaction.reference,
            amount: this.convertFromSmallestUnit(refund.data.amount, currency),
            currency: refund.data.currency,
            status: refund.data.status,
          };
        }

        return {
          success: false,
          error: refund.message || 'Refund failed',
          status: refund.data?.status || 'failed',
        };
      }
      throw new Error(`Provider ${provider} not configured`);
    } catch (error) {
      console.error(`Error refunding transaction with ${provider}:`, error);
      return {
        success: false,
        error: error.message || 'Refund processing failed',
        status: 'failed',
      };
    }
  }

  /**
   * Calculate withdrawal fee
   * @param {number} amount - Amount in main currency unit
   * @param {string} currency - Currency code
   * @param {string} provider - 'stripe' or 'paystack'
   * @returns {Object} - Fee breakdown
   */
  calculateWithdrawalFee(amount, currency, provider = 'stripe') {
    let fee = 0;
    
    // Pass-through provider fees only (no platform fee)
    if (provider === 'paystack') {
      // Paystack: ₦10 flat fee per transfer (NGN)
      if (currency === 'NGN') {
        fee = 10; // ₦10
      } else {
        // Other currencies may have different fees
        fee = this.convertToSmallestUnit(10, 'NGN'); // Estimate
      }
    } else if (provider === 'stripe') {
      // Stripe: $0.25 per payout (USD)
      if (currency === 'USD') {
        fee = 0.25;
      } else {
        // Convert $0.25 to other currencies (approximate)
        // In production, you'd use actual exchange rates
        fee = 0.25;
      }
    }

    const netAmount = amount - fee;

    return {
      amount,
      fee,
      netAmount,
    };
  }
}

module.exports = new PaymentService();
