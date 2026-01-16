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
    // Always use Stripe for all currencies
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
   * Verify Paystack transaction and extract card details
   * @param {string} transactionReference - Paystack transaction reference
   * @returns {Promise<Object>} - Transaction details with authorization and card info
   */
  async verifyPaystackTransaction(transactionReference) {
    try {
      if (!this.paystack) {
        throw new Error('Paystack not configured');
      }

      const response = await this.paystack.transaction.verify(transactionReference);

      if (!response.status || !response.data) {
        throw new Error(response.message || 'Failed to verify transaction');
      }

      const transaction = response.data;
      
      // Check if transaction was successful
      if (transaction.status !== 'success') {
        throw new Error(`Transaction not successful. Status: ${transaction.status}`);
      }

      // Extract authorization code (payment method ID for future charges)
      const authorization = transaction.authorization;
      if (!authorization) {
        throw new Error('No authorization found in transaction. This may not be a card payment.');
      }

      const authorizationCode = authorization.authorization_code;
      if (!authorizationCode) {
        throw new Error('No authorization code found in transaction');
      }

      // Extract card details including expiry date
      // Paystack authorization object includes exp_month and exp_year as strings
      let expiryMonth = null;
      let expiryYear = null;
      
      if (authorization.exp_month) {
        expiryMonth = typeof authorization.exp_month === 'string' 
          ? parseInt(authorization.exp_month, 10) 
          : authorization.exp_month;
      }
      
      if (authorization.exp_year) {
        expiryYear = typeof authorization.exp_year === 'string' 
          ? parseInt(authorization.exp_year, 10) 
          : authorization.exp_year;
      }

      const cardDetails = {
        authorizationCode: authorizationCode,
        last4: authorization.last4 || null,
        brand: authorization.brand || null,
        cardType: authorization.card_type || null,
        bank: authorization.bank || null,
        bin: authorization.bin || null,
        expiryMonth: expiryMonth,
        expiryYear: expiryYear,
      };

      return {
        success: true,
        transactionReference: transaction.reference,
        transactionId: transaction.id.toString(),
        amount: this.convertFromSmallestUnit(transaction.amount, transaction.currency),
        currency: transaction.currency,
        authorizationCode: authorizationCode,
        cardDetails: cardDetails,
        customer: transaction.customer || null,
        metadata: transaction.metadata || {},
      };
    } catch (error) {
      console.error('Error verifying Paystack transaction:', error);
      return {
        success: false,
        error: error.message || 'Failed to verify transaction',
      };
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
        // Validate card funding type - only allow debit cards (except in test mode)
        // Allow credit cards in test mode for testing with Stripe test cards
        const isTestMode = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_');
        
        if (!isTestMode) {
          try {
            const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
            if (paymentMethod && paymentMethod.card && paymentMethod.card.funding) {
              const funding = paymentMethod.card.funding;
              if (funding === 'credit') {
                return {
                  success: false,
                  error: 'Credit cards are not accepted. Please use a debit card.',
                  status: 'failed',
                };
              }
              if (funding === 'prepaid') {
                return {
                  success: false,
                  error: 'Prepaid cards are not accepted. Please use a debit card.',
                  status: 'failed',
                };
              }
              // Allow 'debit' and 'unknown' (some cards may not have funding type available)
            }
          } catch (retrieveError) {
            // If we can't retrieve the payment method, log warning but continue
            // (payment method might be valid but retrieval failed)
            console.warn('Could not retrieve payment method to check funding type:', retrieveError.message);
          }
        } else {
          // In test mode, allow all card types (including credit cards for testing)
          console.log(`⚠️  Test mode: Allowing all card types for payment method: ${paymentMethodId}`);
        }

        // Convert amount to cents
        const amountInCents = this.convertToSmallestUnit(amount, currency);

        // Ensure payment method is attached to customer (required for Stripe)
        // This is necessary because payment methods can only be reused if they're attached to a customer
        try {
          const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
          // Check if payment method is already attached to this customer
          if (!paymentMethod.customer || paymentMethod.customer !== customerId) {
            // Attach payment method to customer
            await this.stripe.paymentMethods.attach(paymentMethodId, {
              customer: customerId,
            });
          }
        } catch (attachError) {
          // Check if this is the "cannot reuse payment method" error
          if (attachError.message && attachError.message.includes('previously used') && attachError.message.includes('without Customer attachment')) {
            return {
              success: false,
              error: 'This payment method cannot be reused. Please add a new payment method in the app settings.',
              status: 'failed',
              requiresNewPaymentMethod: true,
            };
          }
          // If payment method is already attached, ignore the error
          // If it's a different error, log it but continue (might still work)
          if (!attachError.message.includes('already been attached')) {
            console.warn('Could not attach payment method to customer:', attachError.message);
          }
        }

        // Create payment intent with idempotency key
        const idempotencyKey = metadata.idempotencyKey || `charge_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        let paymentIntent;
        try {
          paymentIntent = await this.stripe.paymentIntents.create({
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
        } catch (createError) {
          // Check if this is the "cannot reuse payment method" error
          if (createError.message && createError.message.includes('previously used') && createError.message.includes('without Customer attachment')) {
            return {
              success: false,
              error: 'This payment method cannot be reused. Please add a new payment method in the app settings.',
              status: 'failed',
              requiresNewPaymentMethod: true,
            };
          }
          // Re-throw other errors
          throw createError;
        }

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
        // Paystack uses the same Secret Key for API calls and webhook verification
        // Use PAYSTACK_WEBHOOK_SECRET if set, otherwise fall back to PAYSTACK_SECRET_KEY
        const webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
        if (!webhookSecret) {
          console.error('PAYSTACK_WEBHOOK_SECRET or PAYSTACK_SECRET_KEY not configured');
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
      // Stripe fees for UK merchants
      // UK cards: 1.5% + £0.20
      // European (EEA) cards: 2.5% + £0.20
      // International (non-EEA) cards: 3.25% + £0.20
      // Currency conversion: +2% if currency differs from settlement currency (GBP)
      
      // Use conservative estimate (international rate) since we can't know card origin in advance
      // For non-GBP currencies, add currency conversion fee
      if (currency === 'GBP') {
        // UK currency - no conversion fee
        processorFeePercent = 2.5; // Average between UK (1.5%) and EEA (2.5%)
        processorFeeFixed = 0.20; // £0.20
      } else if (currency === 'EUR') {
        // European currency - EEA card + conversion
        processorFeePercent = 4.5; // 2.5% + 2% conversion
        processorFeeFixed = 0.20; // €0.20 (approximately £0.17)
      } else if (currency === 'USD') {
        // US currency - international card + conversion
        processorFeePercent = 5.25; // 3.25% + 2% conversion
        processorFeeFixed = 0.30; // $0.30 (Stripe's standard USD fixed fee)
      } else if (currency === 'NGN') {
        // Nigerian currency - international card + conversion
        processorFeePercent = 5.25; // 3.25% + 2% conversion
        // Fixed fee: £0.20 ≈ ₦250-300 (using approximate exchange rate ~1250-1500 NGN/GBP)
        processorFeeFixed = 250; // ₦250 (approximately £0.20 at current rates)
      } else if (currency === 'KES') {
        // Kenyan Shilling - international card + conversion
        processorFeePercent = 5.25; // 3.25% + 2% conversion
        // Fixed fee: £0.20 ≈ KSh 30-35 (using approximate exchange rate ~150-175 KES/GBP)
        processorFeeFixed = 30; // KSh 30 (approximately £0.20 at current rates)
      } else if (currency === 'GHS') {
        // Ghanaian Cedi - international card + conversion
        processorFeePercent = 5.25; // 3.25% + 2% conversion
        // Fixed fee: £0.20 ≈ ₵3-4 (using approximate exchange rate ~15-20 GHS/GBP)
        processorFeeFixed = 3; // ₵3 (approximately £0.20 at current rates)
      } else if (currency === 'ZAR') {
        // South African Rand - international card + conversion
        processorFeePercent = 5.25; // 3.25% + 2% conversion
        // Fixed fee: £0.20 ≈ R4-5 (using approximate exchange rate ~20-25 ZAR/GBP)
        processorFeeFixed = 4; // R4 (approximately £0.20 at current rates)
      } else if (currency === 'CAD') {
        // Canadian Dollar - international card + conversion
        processorFeePercent = 5.25; // 3.25% + 2% conversion
        // Fixed fee: £0.20 ≈ C$0.30-0.35 (using approximate exchange rate ~1.5-1.75 CAD/GBP)
        processorFeeFixed = 0.30; // C$0.30 (approximately £0.20 at current rates)
      } else if (currency === 'AUD') {
        // Australian Dollar - international card + conversion
        processorFeePercent = 5.25; // 3.25% + 2% conversion
        // Fixed fee: £0.20 ≈ A$0.35-0.40 (using approximate exchange rate ~1.75-2 AUD/GBP)
        processorFeeFixed = 0.35; // A$0.35 (approximately £0.20 at current rates)
      } else if (currency === 'JPY') {
        // Japanese Yen - international card + conversion
        processorFeePercent = 5.25; // 3.25% + 2% conversion
        // Fixed fee: £0.20 ≈ ¥30-35 (using approximate exchange rate ~150-175 JPY/GBP)
        processorFeeFixed = 30; // ¥30 (approximately £0.20 at current rates)
      } else {
        // Other currencies - use international rate + conversion
        processorFeePercent = 5.25; // 3.25% + 2% conversion
        processorFeeFixed = 0.20; // Default to £0.20 equivalent (will need manual adjustment)
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
   * Validate bank account details with Stripe before saving
   * @param {Object} bankAccountData - Bank account data
   * @param {string} bankAccountData.accountNumber - Account number
   * @param {string} bankAccountData.routingNumber - Routing number (US) or sort code (UK)
   * @param {string} bankAccountData.accountHolderName - Account holder name
   * @param {string} bankAccountData.accountHolderType - Account holder type ('individual' or 'company')
   * @param {string} bankAccountData.currency - Currency code (USD, EUR, GBP)
   * @param {string} bankAccountData.country - Country code (US, GB, etc.)
   * @param {string} bankAccountData.iban - IBAN (for EUR/GBP)
   * @returns {Promise<Object>} - Validation result
   */
  async validateBankAccount(bankAccountData, provider = 'stripe') {
    try {
      if (provider === 'stripe' && this.stripe) {
        const {
          accountNumber,
          routingNumber,
          accountHolderName,
          accountHolderType = 'individual',
          currency,
          country,
          iban,
        } = bankAccountData;

        // For USD (US bank accounts)
        if (currency === 'USD' && country === 'US') {
          if (!routingNumber || !accountNumber) {
            return {
              valid: false,
              error: 'Routing number and account number are required for US bank accounts',
            };
          }

          try {
            // Create a bank account token to validate the account
            const token = await this.stripe.tokens.create({
              bank_account: {
                country: 'US',
                currency: 'usd',
                account_number: accountNumber,
                routing_number: routingNumber,
                account_holder_name: accountHolderName,
                account_holder_type: accountHolderType,
              },
            });

            // Check if token was created successfully
            if (token && token.id) {
              return {
                valid: true,
                tokenId: token.id,
                bankAccount: token.bank_account,
              };
            }

            return {
              valid: false,
              error: 'Failed to validate bank account',
            };
          } catch (error) {
            // Stripe will return an error if the bank account is invalid
            return {
              valid: false,
              error: error.message || 'Invalid bank account details',
              stripeError: error.type || null,
            };
          }
        }

        // For EUR/GBP (European/UK bank accounts using IBAN)
        if ((currency === 'EUR' || currency === 'GBP') && iban) {
          try {
            // Validate IBAN format and create token
            const countryCode = currency === 'GBP' ? 'GB' : 'EU';
            const token = await this.stripe.tokens.create({
              bank_account: {
                country: countryCode,
                currency: currency.toLowerCase(),
                account_number: iban, // IBAN can be used as account_number for EUR/GBP
                account_holder_name: accountHolderName,
                account_holder_type: accountHolderType,
              },
            });

            if (token && token.id) {
              return {
                valid: true,
                tokenId: token.id,
                bankAccount: token.bank_account,
              };
            }

            return {
              valid: false,
              error: 'Failed to validate bank account',
            };
          } catch (error) {
            return {
              valid: false,
              error: error.message || 'Invalid bank account details',
              stripeError: error.type || null,
            };
          }
        }

        // For EUR/GBP without IBAN (using account number and sort code for UK)
        if (currency === 'GBP' && !iban && accountNumber && routingNumber) {
          try {
            const token = await this.stripe.tokens.create({
              bank_account: {
                country: 'GB',
                currency: 'gbp',
                account_number: accountNumber,
                routing_number: routingNumber, // Sort code for UK
                account_holder_name: accountHolderName,
                account_holder_type: accountHolderType,
              },
            });

            if (token && token.id) {
              return {
                valid: true,
                tokenId: token.id,
                bankAccount: token.bank_account,
              };
            }

            return {
              valid: false,
              error: 'Failed to validate bank account',
            };
          } catch (error) {
            return {
              valid: false,
              error: error.message || 'Invalid bank account details',
              stripeError: error.type || null,
            };
          }
        }

        return {
          valid: false,
          error: `Bank account validation not supported for ${currency} without required fields`,
        };
      }

      // For non-Stripe providers or when Stripe is not configured, skip validation
      // (You can add Paystack validation here if needed)
      return {
        valid: true,
        skipped: true,
        message: 'Bank account validation skipped (provider not configured)',
      };
    } catch (error) {
      console.error('Error validating bank account:', error);
      return {
        valid: false,
        error: error.message || 'Error validating bank account',
      };
    }
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
        // The old Paystack SDK doesn't have transaction.refund, so we use the HTTP API directly
        const https = require('https');
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        
        if (!secretKey) {
          throw new Error('Paystack secret key not configured');
        }

        // Prepare refund payload
        const refundPayload = {
          transaction: transactionId,
          currency: currency.toUpperCase(),
        };

        // Add amount for partial refund
        if (amount) {
          refundPayload.amount = this.convertToSmallestUnit(amount, currency);
        }

        // Make HTTP request to Paystack refund API
        const refund = await new Promise((resolve, reject) => {
          const postData = JSON.stringify(refundPayload);
          
          const options = {
            hostname: 'api.paystack.co',
            port: 443,
            path: '/refund',
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${secretKey}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
          };

          const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
              data += chunk;
            });

            res.on('end', () => {
              try {
                const response = JSON.parse(data);
                resolve(response);
              } catch (parseError) {
                reject(new Error(`Failed to parse Paystack response: ${parseError.message}`));
              }
            });
          });

          req.on('error', (error) => {
            reject(error);
          });

          req.write(postData);
          req.end();
        });

        if (refund.status && refund.data && refund.data.status === 'processed') {
          return {
            success: true,
            refundId: refund.data.id ? refund.data.id.toString() : null,
            transactionRefunded: refund.data.transaction?.reference || transactionId,
            amount: refund.data.amount ? this.convertFromSmallestUnit(refund.data.amount, currency) : amount,
            currency: refund.data.currency || currency.toUpperCase(),
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
    if (provider === 'stripe') {
      // Stripe payout fees:
      // USD: 1% fee
      // CAD: 1% fee
      // AUD: 1% fee
      // EUR: Free (0%)
      // GBP: Free (0%)
      if (currency === 'USD' || currency === 'CAD' || currency === 'AUD') {
        fee = amount * 0.01; // 1% fee for USD, CAD, and AUD
      } else if (currency === 'EUR' || currency === 'GBP') {
        fee = 0; // Free for EUR and GBP
      } else {
        // Other currencies not supported yet
        fee = 0;
      }
    } else if (provider === 'paystack') {
      // Paystack: ₦10 flat fee per transfer (NGN)
      if (currency === 'NGN') {
        fee = 10; // ₦10
      } else {
        // Other currencies may have different fees
        fee = this.convertToSmallestUnit(10, 'NGN'); // Estimate
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
