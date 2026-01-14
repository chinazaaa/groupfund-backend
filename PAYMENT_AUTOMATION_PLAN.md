# Payment Automation Implementation Plan

## Executive Summary

This document outlines the plan to implement automatic payment collection for GroupFund, allowing users to automatically charge cards on birthdays and deadlines, with money credited to recipients' in-app wallet balances.

---

## Core Decisions

### 1. **Smart Wallet System (Most Flexible)**
- Unified wallet balance that works with Stripe
- Users can opt-in to auto-pay per group
- Simple, flexible architecture

### 2. **In-App Wallet Balance (Receive & Withdraw Only)**
- All payments credit to user's wallet.balance
- **Wallet balance CANNOT be used to pay contributions**
- **Contributions must come from debit cards only** (not wallet balance)
- Wallet is ONLY for:
  - Receiving money (from contributions)
  - Withdrawing money to bank account
- Users cannot use wallet balance to pay for anything
- Existing wallet system already in place

### 3. **Payment Provider Strategy**
- **Stripe only** for all payments
- Supported currencies: EUR, USD, GBP only
- All credit to same wallet.balance system

### 4. **Fee Structure (Affordable Model)**
- **Contributor pays fees** (added on top of contribution amount)
- **Recipient receives full contribution amount**
- **Minimal platform fee** (1-2% maximum, keeping it competitive)
- Transparent fee display in UI
- Goal: Keep it affordable so users don't switch to WhatsApp

### 5. **Payment Preferences**
- Users can choose **when** to be debited for auto-pay
- Options: **1 day before** or **same day**
- Applied per group or globally (user preference)
- If "1 day before": Card debited 1 day before birthday/deadline
- If "same day": Card debited on the actual birthday/deadline
- Users must set preference when enabling auto-pay

### 6. **User Requirements**
- **Bank details required** to join or create any group
- Prevents debit/credit failures (must have withdrawal account)
- **Debit card details required** if user wants to enable auto-pay
- **Withdrawal account required** to enable withdrawals (already have bank details)
- Enforced at group join/creation time (validation)

### 7. **Payment Confirmation (Final Decision)**
- **Auto-debit payments**: Auto-confirm (status = 'confirmed' immediately)
  - Payment processed by Stripe → Verified by webhook → Auto-confirm
  - No manual confirmation needed (payment already verified by processor)
- **Manual payments**: Manual confirmation required (status = 'paid' → recipient confirms → 'confirmed')
  - User marks as paid manually (paid directly to recipient's bank account)
  - Recipient must confirm they received the payment
  - After confirmation: Status = 'confirmed'
- **Logic**: If payment_method = 'auto-debit' AND webhook confirms success → Status = 'confirmed' immediately
- **Logic**: If payment_method = 'manual' → Status = 'paid' → Recipient confirms → Status = 'confirmed'

---

## Payment Flow

### Payment Timing Summary by Group Type

1. **Birthday Groups**: 
   - Payments happen **once per year** when each person's birthday occurs
   - Each member's birthday is individual (different dates)
   - Payment timing: On birthday or 1 day before (based on user's payment preference)

2. **Subscription Groups**: 
   - Payments happen **recurring** on the deadline day set in the group
   - **Always uses the deadline date set in the group** - not when user joined or when group was created
   - **Monthly subscriptions**: Payment on the deadline day each month (e.g., 12th of each month)
   - **Annual subscriptions**: Payment on the deadline day/month each year (e.g., 15th of December each year)
   - Admin can change the deadline day (and month for annual) - payments will be debited on the updated deadline day
   - Payment timing: On deadline day or 1 day before (based on user's payment preference)

3. **General Groups**: 
   - Payments happen **once** - not recurring (one-time deadline)
   - Once the deadline passes, that's it - no more automatic payments
   - **If deadline has passed**: Auto-pay cannot be enabled (validation blocks it)
   - **If auto-pay already enabled and deadline passes**: Auto-pay should be disabled (no more payments possible)
   - Payment timing: On deadline day or 1 day before (based on user's payment preference)

### Automatic Collection Flow

```
BIRTHDAY EXAMPLE:

**Note:** Birthday payments happen once per year when each person's birthday occurs. Each member's birthday is individual.

1. User's birthday arrives (or 1 day before, based on payment preference)
   ↓
2. System checks each member's payment preference
   ├─ "1 day before" → Charged 1 day before birthday
   └─ "Same day" → Charged on birthday
   ↓
3. **Check if birthday person (recipient) is a defaulter**
   ├─ YES → Skip ALL auto-payments
   │   ├─ Notify birthday person:
   │   │   "You have overdue payments. Please pay manually to receive contributions."
   │   └─ Notify ALL members with auto-pay enabled:
   │       "Auto-pay skipped: [Birthday Person Name] has overdue payments. 
   │        Auto-pay will resume once they clear their overdue contributions."
   └─ NO → Continue to step 4
   ↓
4. For each member (only if recipient not defaulter):
   ├─ **Check if member is a defaulter (has overdue payments)**
   │   ├─ YES → Skip auto-pay for this member
   │   └─ NO → Continue to next check
   ├─ **CRITICAL: Check if payment status is still 'not_paid'**
   │   ├─ If status = 'paid' OR 'confirmed' → Skip auto-debit (already paid manually)
   │   └─ If status = 'not_paid' OR 'not_received' → Continue to auto-debit
   ├─ Calculate total amount (contribution + fees)
   ├─ Charge card via Stripe
   └─ Charge goes to your Stripe account
   ↓
4. Money goes to YOUR Stripe account
   ↓
5. Webhook confirms payment success
   ↓
6. System credits birthday person's wallet.balance
   ├─ Update: wallets.balance += contribution_amount
   ├─ Create transaction records
   ├─ Status: 'confirmed' (AUTO-CONFIRMED - payment verified by Stripe)
   └─ Send notifications
   ↓
7. Birthday person sees money in their wallet
   ├─ Auto-debit payments: Status shows 'confirmed' automatically (payment verified by Stripe)
   └─ Manual payments: Status shows 'paid', recipient must confirm they received it
   ↓
8. Later, when they withdraw:
   └─ Use Stripe Payouts API
   ↓
9. Money sent to their bank account
```

### Subscription Deadline Flow

**Note:** Subscription groups have a recurring deadline. **Payments always use the deadline date set in the group** (not when user joined or when group was created). Monthly subscriptions: deadline day each month (e.g., 12th of each month). Annual subscriptions: deadline day/month each year (e.g., 15th of December each year). Admin can change the deadline day (and month for annual), and payments will be debited on the updated deadline day.

```
SUBSCRIPTION DEADLINE EXAMPLE:

1. Subscription deadline approaches (e.g., 12th of month - recurring monthly)
   ↓
2. **Check if admin (recipient) is a defaulter**
   ├─ YES → Skip ALL auto-payments
   │   ├─ Notify admin:
   │   │   "You have overdue payments. Please pay manually to receive contributions."
   │   └─ Notify ALL members with auto-pay enabled:
   │       "Auto-pay skipped: [Admin Name] has overdue payments. 
   │        Auto-pay will resume once they clear their overdue contributions."
   └─ NO → Continue to step 3
   ↓
3. System checks each member's payment preference
   ├─ "1 day before" → Charged 1 day before deadline (11th)
   └─ "Same day" → Charged on deadline (12th)
   ↓
4. For each member (only if admin not defaulter):
   ├─ **Check if member is a defaulter (has overdue payments)**
   │   ├─ YES → Skip auto-pay for this member
   │   └─ NO → Continue to next check
   ├─ **CRITICAL: Check if payment status is still 'not_paid'**
   │   ├─ If status = 'paid' OR 'confirmed' → Skip auto-debit (already paid manually)
   │   └─ If status = 'not_paid' OR 'not_received' → Continue to auto-debit
   ├─ Calculate total amount (contribution + fees)
   └─ Charge card via Stripe
   ↓
4. Webhook confirms payment success
   ↓
5. Money credited to admin's wallet.balance
   ├─ Status: 'confirmed' (AUTO-CONFIRMED - payment verified by Stripe)
   └─ Send notifications
   ↓
6. Admin receives funds in wallet
   ↓
7. Admin can withdraw when ready
```

### General Group Deadline Flow

```
GENERAL GROUP DEADLINE EXAMPLE:

1. Group deadline approaches
   ↓
2. **Check if admin (recipient) is a defaulter**
   ├─ YES → Skip ALL auto-payments
   │   ├─ Notify admin:
   │   │   "You have overdue payments. Please pay manually to receive contributions."
   │   └─ Notify ALL members with auto-pay enabled:
   │       "Auto-pay skipped: [Admin Name] has overdue payments. 
   │        Auto-pay will resume once they clear their overdue contributions."
   └─ NO → Continue to step 3
   ↓
3. System checks each member's payment preference
   ├─ "1 day before" → Charged 1 day before deadline
   └─ "Same day" → Charged on deadline
   ↓
4. For each member (only if admin not defaulter):
   ├─ **Check if member is a defaulter (has overdue payments)**
   │   ├─ YES → Skip auto-pay for this member
   │   └─ NO → Continue to next check
   ├─ **CRITICAL: Check if payment status is still 'not_paid'**
   │   ├─ If status = 'paid' OR 'confirmed' → Skip auto-debit (already paid manually)
   │   └─ If status = 'not_paid' OR 'not_received' → Continue to auto-debit
   ├─ Calculate total amount (contribution + fees)
   └─ Charge card via Stripe
   ↓
4. Webhook confirms payment success
   ↓
5. Money credited to admin's wallet.balance
   ├─ Status: 'confirmed' (AUTO-CONFIRMED - payment verified by Stripe)
   └─ Send notifications
   ↓
6. Admin receives funds in wallet
```

---

## Technical Architecture

### 1. Payment Provider Routing

```javascript
// Pseudo-code for provider selection
function selectProvider(currency) {
  // Only Stripe, supporting EUR, USD, GBP
  if (['EUR', 'USD', 'GBP'].includes(currency)) return 'stripe';
  throw new Error(`Unsupported currency: ${currency}. Supported currencies: EUR, USD, GBP`);
}
```

### 2. Money Flow

**Collection:**
- Stripe charges user's card → Money goes to YOUR Stripe account
- You credit recipient's wallet.balance in your database
- User sees balance increase in app

**Withdrawal:**
- User requests withdrawal from wallet
- You use Stripe Payouts API
- Money sent directly to user's bank account

### 3. Fee Calculation

**Model: Contributor Pays (Transparent) - AUTO-DEBIT ONLY**
```
User wants to contribute: $50 (via auto-debit)
├─ Payment processor fee (Stripe): ~$1.75 (2.9% + $0.30)
├─ Platform fee (your fee): $0.50 (1% - keeping it low)
└─ Total charged to user: $52.25

Recipient receives: $50 (full amount)
Your profit: $0.50 per transaction
```

**Manual Payments: NO FEES**
- User pays directly to recipient's bank account (outside the app)
- User marks as "paid" in the app (just updating status)
- NO platform fee (payment didn't go through the app)
- NO revenue from manual payments

**Keep fees low** - This is a simple app competing with WhatsApp. Users will switch if it's too expensive.

---

## Database Changes Required

### 1. Payment Method Storage

```sql
-- Store payment methods for auto-pay
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);

-- Auto-pay preferences per group
CREATE TABLE IF NOT EXISTS user_payment_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  auto_pay_enabled BOOLEAN DEFAULT FALSE,
  payment_method_type VARCHAR(20), -- 'card', 'bank_account', etc.
  payment_method_id VARCHAR(255), -- Provider-specific ID
  provider VARCHAR(20) DEFAULT 'stripe', -- 'stripe' only
  payment_timing VARCHAR(20) DEFAULT 'same_day', -- '1_day_before' or 'same_day'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, group_id)
);

CREATE INDEX idx_user_payment_preferences_user_id ON user_payment_preferences(user_id);
CREATE INDEX idx_user_payment_preferences_group_id ON user_payment_preferences(group_id);
CREATE INDEX idx_user_payment_preferences_payment_timing ON user_payment_preferences(payment_timing);

-- Global payment preferences (user-level default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_payment_timing VARCHAR(20) DEFAULT 'same_day'; 
-- '1_day_before' or 'same_day' - used when no group-specific preference
```

### 2. Fee Tracking

```sql
-- Add fee tracking to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS processor_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gross_amount DECIMAL(10, 2); -- Amount charged to user
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS net_amount DECIMAL(10, 2); -- Amount recipient receives
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20) DEFAULT 'stripe'; -- 'stripe', 'manual'
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method_id VARCHAR(255); -- Provider transaction ID
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS withdrawal_fee DECIMAL(10, 2) DEFAULT 0; -- Fee for withdrawals (if any)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payout_fee DECIMAL(10, 2) DEFAULT 0; -- Payout provider fee (Stripe charges)
```

### 3. Automatic Payment Attempts

```sql
-- Track automatic payment attempts
CREATE TABLE IF NOT EXISTS automatic_payment_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  contribution_type VARCHAR(20), -- 'birthday', 'subscription', 'general'
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'success', 'failed', 'retry'
  payment_provider VARCHAR(20),
  provider_transaction_id VARCHAR(255),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_automatic_payment_attempts_user_id ON automatic_payment_attempts(user_id);
CREATE INDEX idx_automatic_payment_attempts_group_id ON automatic_payment_attempts(group_id);
CREATE INDEX idx_automatic_payment_attempts_status ON automatic_payment_attempts(status);
```

---

## API Endpoints Needed

### 1. Payment Method Management

```
POST /api/payments/methods/verify-password
- Step 1: Verify password before adding payment method
- Body: { password }
- Returns: { verified: true, token: "temp_token" } or error

POST /api/payments/methods/request-otp
- Step 2: Request OTP after password verification
- Requires: Password verification token
- Body: { action: "add-payment-method" }
- Sends 6-digit OTP to user's email
- Returns: { message: "OTP sent to your email" }

POST /api/payments/methods
- Step 3: Add payment method (requires password + OTP verification)
- Body: { password_verification_token, otp, payment_method_data }
- Verify password token and OTP before proceeding
- Add payment method (debit card only - not wallet balance)
- Provider: Stripe only
- Store securely
- Note: Wallet balance cannot be used as payment method

GET /api/payments/methods
- Get user's saved payment methods
- Returns: Only debit cards (not wallet balance)
- No 2FA required (read-only)

PUT /api/payments/methods/:methodId/verify-password
- Step 1: Verify password before editing payment method
- Body: { password }
- Returns: { verified: true, token: "temp_token" } or error

PUT /api/payments/methods/:methodId
- Step 3: Update payment method (requires password + OTP verification)
- Body: { password_verification_token, otp, payment_method_data }
- Verify password token and OTP before proceeding

DELETE /api/payments/methods/:methodId/verify-password
- Step 1: Verify password before deleting payment method
- Body: { password }
- Returns: { verified: true, token: "temp_token" } or error

DELETE /api/payments/methods/:methodId
- Step 3: Remove payment method (requires password + OTP verification)
- Body: { password_verification_token, otp }
- Verify password token and OTP before proceeding
- **Auto-disable auto-pay**: Before deletion, check if this payment method is used for auto-pay
  - If used for auto-pay: Automatically disable auto-pay for all groups using this card
  - Update: Set `auto_pay_enabled = false` for all affected groups in `user_payment_preferences`
  - Notification: Send email/notification "Auto-pay disabled: Your debit card was removed. Please add a new card to re-enable auto-pay."
  - Result: Contributions revert to manual payment (user must mark as paid manually)

POST /api/payments/methods/:methodId/set-default
- Set default payment method for group
- Note: Must be debit card (wallet balance not allowed)
- No 2FA required (low-risk action)
```

### 2. Auto-Pay Management

```
POST /api/groups/:groupId/auto-pay/enable/verify-password
- Step 1: Verify password before enabling auto-pay
- Body: { password }
- Returns: { verified: true, token: "temp_token" } or error

POST /api/groups/:groupId/auto-pay/enable/request-otp
- Step 2: Request OTP after password verification
- Requires: Password verification token
- Sends 6-digit OTP to user's email
- Returns: { message: "OTP sent to your email" }

POST /api/groups/:groupId/auto-pay/enable
- Step 3: Enable auto-pay for user in group (requires password + OTP verification)
- Requires payment method (debit card)
- Requires payment timing preference ('1_day_before' or 'same_day')
- Body: { password_verification_token, otp, payment_method_id, payment_timing }
- Verify password token and OTP before proceeding
- **Check for overdue payments** - If user has overdue payments, reject with error: "Please pay all overdue contributions before enabling auto-pay"
- **For general groups: Check if deadline has passed** - If deadline < today, reject with error: "Cannot enable auto-pay: Group deadline has passed"

POST /api/groups/:groupId/auto-pay/disable/verify-password
- Step 1: Verify password before disabling auto-pay
- Body: { password }
- Returns: { verified: true, token: "temp_token" } or error

POST /api/groups/:groupId/auto-pay/disable
- Step 3: Disable auto-pay for user in group (requires password + OTP verification)
- Body: { password_verification_token, otp }
- Verify password token and OTP before proceeding

GET /api/groups/:groupId/auto-pay/status
- Check auto-pay status for user in group
- Returns: { auto_pay_enabled, payment_timing, payment_method_id }
- No 2FA required (read-only)

PUT /api/groups/:groupId/auto-pay/preferences/verify-password
- Step 1: Verify password before updating preferences
- Body: { password }
- Returns: { verified: true, token: "temp_token" } or error

PUT /api/groups/:groupId/auto-pay/preferences
- Step 3: Update payment timing preference for group (requires password + OTP verification)
- Body: { password_verification_token, otp, payment_timing: '1_day_before' | 'same_day' }
- Verify password token and OTP before proceeding
- **Check for overdue payments** - If user has overdue payments, reject with error: "Please pay all overdue contributions before updating auto-pay preferences"
```

### 2b. Defaulter Management

```
GET /api/users/default-status
- Check if user has any overdue payments (defaulter status)
- Returns: { has_overdue: boolean, overdue_groups: [...], total_overdue: amount }

GET /api/users/default-status/:groupId
- Check if user has overdue payments in specific group
- Returns: { has_overdue: boolean, overdue_amount: amount, deadline: date }
```

### 2a. Payment Preferences

```
GET /api/users/payment-preferences
- Get user's default payment timing preference
- Returns: { default_payment_timing }

PUT /api/users/payment-preferences
- Update user's default payment timing preference
- Body: { default_payment_timing: '1_day_before' | 'same_day' }
- This becomes default for all new groups
```

### 3. Automatic Payment Processing

```
POST /api/admin/payments/process-birthday/:userId
- Admin endpoint to trigger automatic payments for birthday
- Can be called by scheduled job
- **First checks if birthday person (recipient) is defaulter**
  - If defaulter → Skip ALL payments
    - Notify birthday person: "You have overdue payments. Please pay manually to receive contributions."
    - Notify ALL members with auto-pay: "Auto-pay skipped: [Name] has overdue payments."
    - Return: { skipped: true, recipient_is_defaulter: true, reason: "Recipient has overdue payments", notifications_sent: true }
- **Then checks each member for overdue payments (defaulters)**
  - Skips defaulters (they can't pay if they haven't paid themselves)
  - Notifies each defaulter member: "You have overdue payments. Please pay manually first."
- **CRITICAL: For each member, check if payment status is still 'not_paid'**
  - Before ANY auto-debit attempt, check contribution status
  - If status = 'paid' OR 'confirmed' → Skip auto-debit (already paid manually)
  - If status = 'not_paid' OR 'not_received' → Proceed with auto-debit
- **Returns:** { processed: number, skipped_defaulters: [...], skipped_already_paid: [...], recipient_is_defaulter: boolean, notifications_sent: boolean }

POST /api/admin/payments/process-subscription/:groupId
- Process automatic payments for subscription deadline
- **First checks if admin (recipient) is defaulter**
  - If defaulter → Skip ALL payments
    - Notify admin: "You have overdue payments. Please pay manually to receive contributions."
    - Notify ALL members with auto-pay: "Auto-pay skipped: [Admin Name] has overdue payments."
    - Return: { skipped: true, recipient_is_defaulter: true, reason: "Admin has overdue payments", notifications_sent: true }
- **Then checks each member for overdue payments (defaulters)**
  - Skips defaulters
  - Notifies each defaulter member
- **CRITICAL: For each member, check if payment status is still 'not_paid'**
  - Before ANY auto-debit attempt, check contribution status
  - If status = 'paid' OR 'confirmed' → Skip auto-debit (already paid manually)
  - If status = 'not_paid' OR 'not_received' → Proceed with auto-debit
- **Returns:** { processed: number, skipped_defaulters: [...], skipped_already_paid: [...], recipient_is_defaulter: boolean, notifications_sent: boolean }

POST /api/admin/payments/process-general/:groupId
- Process automatic payments for general group deadline
- **First checks if admin (recipient) is defaulter**
  - If defaulter → Skip ALL payments
    - Notify admin: "You have overdue payments. Please pay manually to receive contributions."
    - Notify ALL members with auto-pay: "Auto-pay skipped: [Admin Name] has overdue payments."
    - Return: { skipped: true, recipient_is_defaulter: true, reason: "Admin has overdue payments", notifications_sent: true }
- **Then checks each member for overdue payments (defaulters)**
  - Skips defaulters
  - Notifies each defaulter member
- **CRITICAL: For each member, check if payment status is still 'not_paid'**
  - Before ANY auto-debit attempt, check contribution status
  - If status = 'paid' OR 'confirmed' → Skip auto-debit (already paid manually)
  - If status = 'not_paid' OR 'not_received' → Proceed with auto-debit
- **Returns:** { processed: number, skipped_defaulters: [...], skipped_already_paid: [...], recipient_is_defaulter: boolean, notifications_sent: boolean }
```

### 3a. Wallet/Account Management (Requires 2FA)

```
PUT /api/users/wallet/verify-password
- Step 1: Verify password before updating wallet/account details
- Body: { password }
- Returns: { verified: true, token: "temp_token" } or error

PUT /api/users/wallet/request-otp
- Step 2: Request OTP after password verification
- Requires: Password verification token
- Body: { action: "update-account-details" }
- Sends 6-digit OTP to user's email
- Returns: { message: "OTP sent to your email" }

DELETE /api/users/account
- Delete user account
- **CRITICAL: Check wallet balance before deletion**
  - If balance > 0: Return error 400 "Cannot delete account. Please withdraw all funds ({amount} {currency_symbol} remaining) before deleting your account."
  - Format: Use user's currency symbol (e.g., "$50 remaining" for USD, "€50 remaining" for EUR, "£30 remaining" for GBP)
  - If balance = 0: Allow deletion (cascade will handle related records)
- Requires: Authentication
- Returns: { message: "Account deleted successfully" } or error

PUT /api/users/wallet
- Step 3: Update wallet/account details (requires password + OTP verification)
- Body: { password_verification_token, otp, account_name, bank_name, account_number, ... }
- Verify password token and OTP before proceeding
- **Bank details removal check**: If removing bank details (setting to null/empty), check if user is in any active groups
  - If in active groups: Return error 400 "Cannot remove bank details. You must leave all groups first. You are currently a member of [X] group(s)."
  - If not in any groups: Allow removal
- **Always allow UPDATE/EDIT**: Users can update/edit bank details (change bank name, account number, etc.) - only removal is blocked
- Updates bank account details for withdrawals

GET /api/users/wallet
- Get wallet balance and account details
- No 2FA required (read-only)
```

### 3b. Withdrawal (Requires 2FA)

```
POST /api/contributions/withdraw/verify-password
- Step 1: Verify password before withdrawing
- Body: { password }
- Returns: { verified: true, token: "temp_token" } or error

POST /api/contributions/withdraw/request-otp
- Step 2: Request OTP after password verification
- Requires: Password verification token
- Body: { amount }
- Sends 6-digit OTP to user's email
- Returns: { message: "OTP sent to your email" }

POST /api/contributions/withdraw
- Step 3: Withdraw money (requires password + OTP verification)
- Body: { password_verification_token, otp, amount, bank_account, bank_name, account_name }
- Verify password token and OTP before proceeding
- **24-hour hold period**: Mark withdrawal as 'pending' (status = 'pending')
- **Email notification**: Send security email to user
  - Subject: "Withdrawal Request Received"
  - Content: "Your withdrawal request of {amount} {currency_symbol} has been received. Funds will be sent to your bank account within 24 hours. If you didn't make this withdrawal, please contact security@groupfund.app immediately."
- **Scheduled processing**: Process withdrawal after 24-hour hold (scheduled job)
- Uses Stripe Payouts API after hold period
```

### 4. Webhooks (Provider Callbacks)

```
POST /api/webhooks/stripe
- Handle Stripe webhook events (payment succeeded, failed, etc.)
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Set up Stripe account and API keys (store in environment variables)
- [ ] Create payment service layer for Stripe
- [ ] Database migrations (payment methods, fees, preferences)
- [ ] Basic payment method storage endpoints
- [ ] **Security**: Set up webhook signature verification
- [ ] **Security**: Implement rate limiting for payment endpoints
- [ ] **Security**: Add input validation for payment endpoints
- [ ] **Security**: Set up audit logging for payment attempts

### Phase 2: Payment Collection (Week 3-4)
- [ ] Implement card charging (Stripe)
- [ ] Fee calculation logic
- [ ] Wallet credit on successful payment
- [ ] Webhook handlers for payment confirmation
- [ ] **Webhook handler for payment failures** - Handle final failure webhooks, auto-disable auto-pay, send email notification
- [ ] Transaction recording with fees
- [ ] **Security**: Webhook signature verification (critical!)
- [ ] **Security**: Idempotency handling (prevent duplicate processing)
- [ ] **Security**: Error handling (don't expose sensitive data)
- [ ] **Security**: Transaction amount validation (min/max limits)
- [ ] **Security**: User authorization checks (users can only charge their own cards)

### Phase 3: Auto-Pay Setup (Week 5-6)
- [ ] Bank details validation (required for join/create groups)
- [ ] **Bank details removal check** - Prevent removal if user is in any active group (must leave groups first)
- [ ] **Bank details update** - Always allow update/edit of bank details (only removal is blocked)
- [ ] **Security**: Two-factor verification (password + email OTP) for critical actions
- [ ] **Security**: Password verification endpoints for critical actions
- [ ] **Security**: OTP generation and email sending for payment actions
- [ ] **Security**: OTP verification middleware for protected endpoints
- [ ] **Security**: Email notifications for all critical actions
- [ ] **Security**: Security email templates (action confirmations with fraud warnings)
- [ ] **Security**: Set up security@groupfund.app email (monitor for fraud reports)
- [ ] UI for users to enable auto-pay per group
- [ ] Payment method selection UI (debit card required)
- [ ] Payment timing preference UI (1 day before / same day)
- [ ] Auto-pay preference storage
- [ ] Validation and error handling

### Phase 4: Automatic Processing (Week 7-8)
- [ ] Scheduled job to check birthdays/deadlines (recommended: run at 9 AM local time)
- [ ] Payment timing logic (1 day before vs same day)
- [ ] Automatic payment trigger logic (respects payment_timing preference)
- [ ] **Defaulter check logic** - Check recipient for overdue payments first
- [ ] **Defaulter check logic** - Check each member for overdue payments
- [ ] Retry logic for failed payments (max 2 attempts: initial + 1 retry)
- [ ] **CRITICAL: Status check before ANY auto-debit** - Check if payment status is still 'not_paid' before ANY auto-debit attempt (initial and retries) (prevent double payment)
- [ ] Payment confirmation logic
  - Auto-debit payments: Auto-confirm (status = 'confirmed' immediately after webhook verification)
  - Manual payments: Manual confirmation required (status = 'paid' → recipient confirms → 'confirmed')
- [ ] **Notification system for recipient defaulter** - Notify recipient and all members
- [ ] **Notification system for member defaulter** - Notify defaulter members
- [ ] Notification system for payment results
- [ ] Admin endpoints for manual triggers

### Phase 5: Withdrawals (Week 9-10)
- [ ] Stripe Payouts API integration
- [ ] Withdrawal request handling (24-hour hold period)
- [ ] **Security email notification** - Send email when withdrawal requested (with security warning)
- [ ] **Scheduled job** - Process pending withdrawals after 24-hour hold period
- [ ] Bank account verification
- [ ] Withdrawal status tracking (pending → processing → completed/failed)

### Phase 6: Testing & Polish (Week 11-12)
- [ ] End-to-end testing
- [ ] Error handling improvements
- [ ] Fee transparency in UI
- [ ] Documentation
- [ ] Production deployment

---

## Key Considerations

### 1. **Keep It Affordable**
- Platform fee: 1-2% maximum
- Transparent fee display
- Remember: Users will use WhatsApp if too expensive

### 2. **Opt-In Auto-Pay**
- Users must explicitly enable auto-pay per group
- **Requires debit card details** to enable auto-pay
- Users choose payment timing: **1 day before** or **same day**
- Can disable anytime
- Clear consent and understanding

### 2a. **Bank Details Required**
- **Users MUST have bank details** to join or create any group
- Prevents debit/credit failures (must have withdrawal account)
- Validation enforced at:
  - Group creation time
  - Group join time
- Ensures recipient can receive funds (withdrawal account must exist)
- Error message: "Please add your bank details in your profile to join/create groups"
- **Bank details removal restriction**:
  - **Prevent removal if user is in any active group**
  - Check if user is member of any active group before allowing removal
  - If in active groups: Block removal, return error "Cannot remove bank details. You must leave all groups first. You are currently a member of [X] group(s)."
  - If not in any groups (or only in closed groups): Allow removal
  - **Always allow UPDATE/EDIT**: Users can update/edit bank details (change bank name, account number, etc.) - only removal is blocked
  - **Rationale**: Prevents money from getting stuck, prevents payment failures, consistent with validation requirement

### 3. **Failed Payment Handling**
- **Simple retry strategy**: Max 2 attempts (initial + 1 retry) - it's just a contribution app, not buy/sell
- **After 2 attempts fail**: Auto-disable auto-pay, send email notification, revert to manual payment
- **User can re-enable**: User can re-enable auto-pay after fixing the issue (add new card, update card, add funds, etc.)
- Email notifications for failures
- User-friendly error messages

### 4. **Currency Support**
- Your app supports: EUR, USD, GBP only
- All payments processed via Stripe
- Fee calculation per currency

### 5. **Security (Critical - Protect Users' Money)**
- **PCI Compliance**: Never store card details directly (use Stripe tokens only)
- **Payment Method Storage**: Only store payment method IDs/tokens (never actual card numbers)
- **Webhook Verification**: Always verify webhook signatures from Stripe
- **Encryption**: Encrypt sensitive payment data at rest and in transit (HTTPS required)
- **Authentication**: JWT tokens required for all payment endpoints
- **Authorization**: Users can only access their own payment methods and transactions
- **Two-Factor Verification (2FA)**: Password + Email OTP required for critical payment actions
- **Rate Limiting**: Strict rate limits on payment endpoints (prevent abuse)
- **Fraud Prevention**: Monitor for suspicious patterns, limit transaction amounts
- **Audit Logging**: Log all payment attempts (success/failure) for security auditing
- **Error Handling**: Never expose sensitive payment details in error messages
- **API Keys**: Store API keys securely (environment variables, never in code)
- **Database Security**: Encrypt sensitive columns, use parameterized queries (prevent SQL injection)
- **Security Monitoring**: Set up alerts for failed payments, unusual patterns
- **Regular Audits**: Periodic security reviews and penetration testing

### 6. **User Experience**
- Clear fee breakdown before payment
- Real-time payment status
- Easy auto-pay toggle
- Payment timing selection (1 day before / same day)
- Simple withdrawal process
- Clear error messages when bank details missing

### 7. **Validation Requirements**
- Bank details MUST exist before joining/creating groups
- **Bank details removal**: Prevent removal if user is in any active group (must leave groups first)
- **Bank details update**: Always allow update/edit of bank details (only removal is blocked)
- Debit card required only if enabling auto-pay
- Withdrawal account = bank details (already required)
- Enforce at API level (not just UI)

### 8. **Wallet Usage Rules (Critical)**
- **Wallet balance CANNOT be used to pay contributions**
- **All contributions must come from debit cards** (Stripe)
- Wallet is ONLY for:
  - Receiving money (credited when others contribute to you)
  - Withdrawing money to bank account
- Users cannot pay contributions using wallet balance
- This ensures all payments go through payment processors (fees, security, tracking)

---

## Example User Flow

### Setting Up Auto-Pay

```
1. User tries to join/create a group
   ↓
2. System checks: Does user have bank details?
   ├─ NO → Error: "Please add bank details in your profile to join/create groups"
   └─ YES → Continue
   ↓
3. User joins a birthday group
   ↓
4. App shows: "Enable auto-pay for this group?"
   ↓
5. User clicks "Enable"
   ↓
6. System checks: Does user have debit card saved?
   ├─ NO → Prompt to add debit card
   │   ├─ User adds card (Stripe handles securely)
   │   ├─ Card details never touch your server
   │   └─ Provider returns payment method token
   └─ YES → Use existing card
   ↓
7. App shows: "When should we charge your card?"
   ├─ Option 1: "1 day before" (recommended)
   └─ Option 2: "Same day"
   ↓
8. User selects payment timing preference
   ↓
9. System stores:
   ├─ user_payment_preferences.auto_pay_enabled = true
   ├─ user_payment_preferences.payment_timing = '1_day_before' or 'same_day'
   └─ user_payment_preferences.payment_method_id = [token]
   ↓
10. On birthday/deadline (or 1 day before), card is automatically charged
```

### Automatic Payment (With Payment Timing)

```
1. Birthday/deadline approaches
   ↓
2. System checks payment timing preferences
   ├─ For "1 day before": Process 1 day before birthday/deadline
   └─ For "same day": Process on birthday/deadline
   ↓
3. System finds all group members with auto_pay_enabled = true
   ↓
4. **Check if recipient (birthday person/admin) is a defaulter**
   ├─ YES → Skip ALL auto-payments
   │   ├─ Notify recipient:
   │   │   "You have overdue payments. Please pay manually to receive contributions."
   │   ├─ Notify ALL members with auto-pay enabled:
   │   │   "Auto-pay skipped: [Recipient Name] has overdue payments. 
   │   │    Auto-pay will resume once they clear their overdue contributions."
   │   └─ Exit process (no payments processed)
   └─ NO → Continue to step 5
   ↓
5. For each member (only if recipient not defaulter):
   ├─ **Check if member is a defaulter (has overdue payments)**
   │   ├─ YES → Skip auto-pay for this member, send notification
   │   │   "You have overdue payments. Please pay manually first."
   │   └─ NO → Continue to next check
   ├─ **CRITICAL: Check if payment status is still 'not_paid'**
   │   ├─ If status = 'paid' OR 'confirmed' → Skip auto-debit (already paid manually)
   │   └─ If status = 'not_paid' OR 'not_received' → Continue to auto-debit
   ├─ Calculate total amount (contribution + fees)
   ├─ Charge card via appropriate provider (based on payment_timing)
   ├─ Webhook confirms payment success
   ├─ On success: Credit recipient's wallet.balance
   │   ├─ Status: 'confirmed' (auto-confirmed - payment verified by Stripe)
   │   ├─ Auto-confirm because it's auto-debit (no manual confirmation needed)
   │   └─ Send notification
   ├─ On failure: Retry (max 3 times)
   └─ Send notification to user
   ↓
5. Recipient receives all payments in wallet
   ├─ If confirmation required: Shows as 'paid', recipient can confirm
   └─ If auto-confirmed: Shows as 'confirmed' automatically
   ↓
6. Recipient can withdraw to bank when ready
   ├─ Must have withdrawal account (bank details already required)
   ├─ **Wallet balance can ONLY be withdrawn** (cannot be used to pay contributions)
   └─ Use Stripe Payout API
```

### Group Join/Create Validation

```
1. User tries to create a group
   ↓
2. System checks: Does user have bank details in wallet?
   ├─ NO → Return error: "Bank details required to create groups. Please add your bank account in your profile."
   └─ YES → Allow group creation
   ↓
3. User tries to join a group
   ↓
4. System checks: Does user have bank details in wallet?
   ├─ NO → Return error: "Bank details required to join groups. Please add your bank account in your profile."
   └─ YES → Allow group join
   ↓
5. This ensures:
   ├─ Recipients can receive funds (withdrawal account exists)
   ├─ Debit/credit won't fail (bank details present)
   └─ Users are prepared for automatic payments

### Wallet Usage Rules

```
IMPORTANT: Wallet Balance Rules

✅ Wallet CAN be used for:
- Receiving money (credited when others contribute to you)
- Withdrawing money to bank account

❌ Wallet CANNOT be used for:
- Paying contributions (must use debit card)
- Any payments (must use debit card)

Why?
- All contributions must go through payment processors (Stripe)
- Ensures fees are collected properly
- Better security and tracking
- Consistent payment flow
```

---

## Revenue Model & Monetization

### Revenue Sources

**Primary Revenue: Platform Fees on Auto-Debit Contributions ONLY**
- **Platform fee**: 1-2% of contribution amount (contributor pays)
- **Applies to**: Auto-debit contributions ONLY (payments processed via Stripe)
- Revenue source: Every time someone uses auto-debit to contribute
- Example: $50 auto-debit contribution → $0.50 platform fee (1%) → Your revenue: $0.50

**NO Revenue from Manual Payments**
- **Manual payments**: User pays directly to recipient's bank account (outside the app)
- **No platform fee**: Payment didn't go through the app, so no fee can be collected
- User just marks as "paid" in the app (they already paid outside)
- Your revenue: $0 on manual payments (payment happened outside the app)

**Revenue from Withdrawals (USD Only)**
- **GBP withdrawals**: FREE (no fee, no revenue)
- **EUR withdrawals**: FREE (no fee, no revenue)
- **USD withdrawals**: 1% fee = YOUR REVENUE
- Example: $100 USD withdrawal → $1.00 revenue (1% fee)

**Revenue Summary:**
- ✅ **Auto-debit contributions**: Platform fee (1-2%) = YOUR REVENUE
- ❌ **Manual payments**: No platform fee (payment happened outside the app)
- ✅ **USD withdrawals**: 1% fee = YOUR REVENUE
- ❌ **GBP/EUR withdrawals**: FREE (no revenue)
- **Total Revenue**: Auto-debit contributions (1-2%) + USD withdrawals (1%)

### Revenue Examples

**Scenario 1: Birthday Group - All Auto-Debit (5 members, $50 each)**
```
Total contributions: $250 (5 × $50)
All via auto-debit
Platform fee (1%): $2.50 (5 × $0.50)
Your revenue: $2.50
```

**Scenario 2: Birthday Group - Mixed (3 auto-debit, 2 manual, $50 each)**
```
Total contributions: $250 (5 × $50)
Auto-debit: $150 (3 × $50) → Platform fee: $1.50 → Your revenue: $1.50
Manual: $100 (2 × $50) → Platform fee: $0 → Your revenue: $0
Total revenue: $1.50 (only from auto-debit)
```

**Scenario 3: Subscription Group (10 members, $50/month each, all auto-debit)**
```
Total contributions: $500 (10 × $50)
All via auto-debit
Platform fee (1%): $5 (10 × $0.50)
Your revenue: $5/month
Annual revenue per group: $60/year
```

**Scenario 4: Withdrawals**
```
User withdraws $100 (USD)
Withdrawal fee: $1.00 (1%)
Your revenue: $1.00

User withdraws £100 (GBP)
Withdrawal fee: FREE
Your revenue: £0

User withdraws €100 (EUR)
Withdrawal fee: FREE
Your revenue: €0
```

### Why Revenue Only from Auto-Debit?

1. **Auto-debit payments go through the app** - Stripe processes payment, you can collect fees
2. **Manual payments happen outside the app** - User pays directly to recipient's bank account, no way to collect fees
3. **Manual is just marking as paid** - User already paid outside, just updating status in app
4. **This incentivizes auto-debit usage** - Users benefit from convenience, you benefit from fees
5. **Fair model** - Only charge fees when providing payment processing service

### Revenue Model: Platform Fees on Auto-Debit Contributions and USD Withdrawals

- **Revenue source 1**: Platform fees (1-2%) on AUTO-DEBIT contributions
- **Revenue source 2**: Withdrawal fee (1%) on USD withdrawals only
- **Applies to**: Payments processed via Stripe (auto-debit)
- **NOT from**: Manual payments (payment happened outside the app)
- **NOT from**: GBP/EUR withdrawals (FREE - no fee)
- **Rationale**: Charge fees for payment processing services (auto-debit) and USD withdrawals. GBP/EUR withdrawals are free. Manual payments are free because payment happens outside the app.

---

## Fee Structure Details

### Stripe Fees
- **Cards**: 2.9% + $0.30 per transaction (USD)
- **Cards**: 1.4% + €0.25 per transaction (EUR)
- **Cards**: 1.4% + £0.20 per transaction (GBP)
- Varies slightly by country
- Lower fees for higher volumes

### Your Platform Fee
- **Recommendation**: 1-2% maximum
- Keep competitive with WhatsApp groups (free but manual)
- Consider: 1% for low amounts, 2% cap
- Display transparently: "Platform fee: $0.50 (1%)"

### Example Calculations

**USD ($50 contribution):**
```
Contribution: $50
Stripe fee: $1.75 (2.9% + $0.30)
Platform fee: $0.50 (1%)
Total charged: $52.25
Recipient receives: $50
Your profit: $0.50
```

**EUR (€50 contribution):**
```
Contribution: €50
Stripe fee: €0.95 (1.4% + €0.25)
Platform fee: €0.50 (1%)
Total charged: €51.45
Recipient receives: €50
Your profit: €0.50
```

**GBP (£50 contribution):**
```
Contribution: £50
Stripe fee: £0.90 (1.4% + £0.20)
Platform fee: £0.50 (1%)
Total charged: £51.40
Recipient receives: £50
Your profit: £0.50
```

---

## Withdrawal Fees

### Withdrawal Fee Structure

**Withdrawal Fees by Currency:**
- **GBP**: FREE (no withdrawal fee)
- **EUR**: FREE (no withdrawal fee)
- **USD**: 1% fee

**Examples:**
- Withdraw £100 → Pay £0 → Receive £100
- Withdraw €100 → Pay €0 → Receive €100
- Withdraw $100 → Pay $1.00 (1% fee) → Receive $99.00

### Fee Transparency
- Show fees clearly before withdrawal
- Display: "Withdrawal fee: FREE" for GBP/EUR, or "Withdrawal fee: $X.XX (1%)" for USD
- Show: "You'll receive: [amount]"
- User sees exactly what they'll get

### Minimum Withdrawal Amount
- **Recommendation: $10 (USD), €10 (EUR), £10 (GBP) minimum**
- Ensures withdrawal is worth processing
- Prevents micro-withdrawals

---

## Webhook Events to Handle

### Stripe Webhooks
- `payment_intent.succeeded` - Payment successful
- `payment_intent.payment_failed` - Payment failed
- `charge.dispute.created` - Chargeback/dispute created (cardholder disputes payment)
- `charge.dispute.updated` - Chargeback/dispute updated
- `charge.dispute.closed` - Chargeback/dispute closed (resolved)
- `payout.paid` - Withdrawal completed


---

## Error Handling & Edge Cases

### Payment Failures & Retry Logic

**Retry Strategy (One-Time Payments):**
- **Note**: Contributions are one-time payments (not subscriptions), so Stripe don't automatically retry
- **Our retry strategy**: Simple - max 2 attempts total (initial + 1 retry)
  - Attempt 1: Initial charge attempt
  - Attempt 2: Retry after initial failure (only for recoverable errors like network issues)
  - If both fail: Disable auto-pay, notify user, revert to manual payment
- **Rationale**: It's just a contribution app - if the person doesn't want to pay, it's not a big deal (not buy/sell)
- **Keep it simple**: No need for many retries - 2 attempts max, then disable auto-pay

**Failure Handling by Reason:**
1. **Insufficient funds** → Try once, if fails → Retry once → If both fail: Disable auto-pay, notify user, revert to manual
2. **Card expired** → Try once, fails immediately → Disable auto-pay, notify user to update card
3. **Bank declined** → Try once, if fails → Retry once → If both fail: Disable auto-pay, notify user, revert to manual
4. **Network error** → Try once, if fails → Retry immediately (usually succeeds on retry)
5. **Card not found** → Try once, fails immediately → Disable auto-pay, notify user, require card update
6. **Both attempts failed** → **Disable auto-pay, send email, revert to manual payment, user can re-enable**

**CRITICAL: Status Check Before ANY Auto-Debit (Prevent Double Payment)**
- **Before ANY auto-debit attempt (initial OR retry), ALWAYS check if payment status is still 'not_paid'**
- If status is 'paid' or 'confirmed' → Skip auto-debit (user already paid manually)
- If status is still 'not_paid' → Proceed with auto-debit
- This prevents double-charging if user manually pays before scheduled auto-debit time
- Check contribution status before each auto-debit attempt (initial and retries)

**Status Check Logic:**
```
Before auto-debit (initial attempt):
1. Query contribution status: SELECT status FROM [table] WHERE ...
2. If status = 'paid' OR status = 'confirmed' → Skip auto-debit, log "Already paid manually"
3. If status = 'not_paid' OR status = 'not_received' → Proceed with auto-debit

Before retry attempt:
1. Query contribution status: SELECT status FROM [table] WHERE ...
2. If status = 'paid' OR status = 'confirmed' → Skip retry, log "Already paid manually"
3. If status = 'not_paid' OR status = 'not_received' → Proceed with retry
```

**Card Expiration Handling:**
- Detect expired cards via Stripe notifications
- Email user 30 days before expiration
- Email user when card expires
- Disable auto-pay for expired cards
- Prompt user to update card in app
- Re-enable auto-pay after card updated

### Defaulters & Payment Restrictions (Critical)

**Defaulter Definition:**
- User (recipient) who hasn't paid their own required contributions by the deadline
- Status: 'not_paid' after deadline has passed
- Overdue contributions (1+ days past deadline)

**Critical Rule: Defaulters CANNOT Receive Auto-Payments**
- **If recipient (birthday person/admin) is a defaulter → Skip ALL auto-payments to them**
- System should NOT auto-debit other people's cards to pay a defaulter
- Recipient must clear their overdue payments first before receiving auto-payments
- **Notify ALL members with auto-pay enabled** - Let them know why auto-pay was skipped

**Defaulter Check Logic (Before Auto-Pay):**
```
BIRTHDAY EXAMPLE:
1. User's birthday arrives
2. Check if BIRTHDAY PERSON (recipient) has any overdue payments
   ├─ YES (defaulter) → Skip ALL auto-payments
   │   ├─ Notify birthday person:
   │   │   "You have overdue payments. Please pay manually to receive contributions."
   │   └─ Notify ALL members with auto-pay enabled:
   │       "Auto-pay skipped: [Birthday Person Name] has overdue payments. 
   │        Auto-pay will resume once they clear their overdue contributions."
   └─ NO → Proceed with auto-pay
3. For each group member (if recipient not defaulter):
   ├─ Check if member is defaulter (they have overdue)
   ├─ If defaulter → Skip charging their card, notify them
   │   "You have overdue payments. Please pay manually first."
   └─ If not defaulter → Charge their card

SUBSCRIPTION/GENERAL EXAMPLE:
1. Deadline arrives
2. Check if ADMIN (recipient) has any overdue payments
   ├─ YES (defaulter) → Skip ALL auto-payments
   │   ├─ Notify admin:
   │   │   "You have overdue payments. Please pay manually to receive contributions."
   │   └─ Notify ALL members with auto-pay enabled:
   │       "Auto-pay skipped: [Admin Name] has overdue payments. 
   │        Auto-pay will resume once they clear their overdue contributions."
   └─ NO → Proceed with auto-pay
3. For each group member (if admin not defaulter):
   ├─ Check if member is defaulter
   ├─ If defaulter → Skip charging their card, notify them
   │   "You have overdue payments. Please pay manually first."
   └─ If not defaulter → Charge their card
```

**Additional Defaulter Rules:**
1. **Defaulters cannot enable auto-pay** - Must pay overdue first
2. **Auto-pay disabled for defaulters** - If user defaults, disable their auto-pay
3. **Manual payment required** - Defaulters must manually pay overdue first
4. **Notification to defaulters** - Email: "You have overdue payments. Please pay manually."

**Recipient Defaulter Check (Critical):**
- Check RECIPIENT's overdue status before processing any auto-payments
- Birthday groups: Check if birthday person has overdue payments
- Subscription/General: Check if admin has overdue payments
- If recipient is defaulter → Skip ALL auto-payments, notify recipient AND all members
- If recipient not defaulter → Process auto-payments (but skip defaulter members)

**Notifications When Recipient is Defaulter:**
1. **Notify recipient (birthday person/admin):**
   - Email/notification: "You have overdue payments. Please pay manually to receive contributions."
   - Subject: "Overdue Payments - Auto-Pay Disabled"
   
2. **Notify ALL members with auto-pay enabled:**
   - Email/notification: "Auto-pay skipped: [Recipient Name] has overdue payments. Auto-pay will resume once they clear their overdue contributions."
   - Subject: "Auto-Pay Skipped - Recipient Has Overdue Payments"
   - Include: Recipient name, group name, reason (overdue payments)
   - Action: Members can still pay manually if they want

**Re-enabling After Default:**
- Recipient must manually pay all overdue contributions
- System verifies all payments are 'confirmed'
- Auto-payments resume after recipient clears defaults

### Edge Cases
1. **User leaves group before payment** → Skip payment
2. **User disables auto-pay after deadline** → Process if deadline already passed (based on payment_timing)
3. **Multiple birthdays same day** → Process all in parallel
4. **User has no payment method** → Skip auto-pay, notify to add method (manual payment still available)
5. **User changes payment timing after payment scheduled** → Use timing at time of payment
6. **User "1 day before" but joins group 1 day before birthday** → Process immediately or skip to next cycle?
7. **User has no bank details** → Cannot join/create group (enforced validation)
8. **User removes bank details after joining group** → ✅ **DECIDED: Prevent removal if user is in any active group**
   - **Check**: Before allowing bank details removal, check if user is member of any active group
   - **If user is in active groups**: Block removal, return error 400 "Cannot remove bank details. You must leave all groups first. You are currently a member of [X] group(s)."
   - **If user is not in any groups (or only in closed groups)**: Allow removal
   - **Always allow UPDATE/EDIT**: Users can always update/edit bank details (change bank name, account number, etc.) - only removal is blocked
   - **Rationale**: Prevents money from getting stuck (if they receive contributions but have no bank details, can't withdraw), prevents payment failures, consistent with validation requirement
9. **User tries to pay with wallet balance** → Reject payment, require debit card (wallet is receive/withdraw only)
10. **User has wallet balance but no debit card** → Cannot enable auto-pay (must have debit card for contributions)
11. **User has multiple payment methods** → Use default payment method or allow selection per group?
12. **Payment method expires** → Disable auto-pay, notify user, require card update
13. **User removes/deletes debit card** → ✅ **Auto-disable auto-pay, revert to manual payment**
   - **Check**: Before allowing card deletion, check if user has auto-pay enabled for any groups
   - **Action**: Automatically disable auto-pay for all groups using this card
   - **Update**: Set `auto_pay_enabled = false` for all affected groups in `user_payment_preferences`
   - **Notification**: Send email/notification to user "Auto-pay disabled: Your debit card was removed. Please add a new card to re-enable auto-pay."
   - **Result**: Contributions revert to manual payment (user must mark as paid manually)
   - **Rationale**: Can't charge a card that doesn't exist, user must re-enable auto-pay after adding new card
13. **User tries to delete account with wallet balance** → Prevent deletion, require withdrawal first
14. **Different currencies in same group** → ✅ Same currency per group (set at group creation, no conversion needed)
15. **Chargeback received** → Handle via Stripe dispute system, respond with evidence, update records
17. **Partial payment failure** → Some members charged, others failed → Notify admin, retry failures
18. **Webhook delayed/missing** → Fallback to polling Stripe API for payment status
19. **Recipient is defaulter (has overdue payments)** → Skip ALL auto-payments to them, notify recipient
20. **Member is defaulter (has overdue payments)** → Skip charging their card, notify member
21. **Recipient has overdue in one group but not others** → Skip ALL payments until all overdue cleared? (recommended: check ALL groups)
22. **Recipient pays overdue manually** → Auto-payments resume after overdue cleared
23. **Member is defaulter but recipient not defaulter** → Skip charging defaulter member's card, process other members
24. **Recipient defaults after auto-pay enabled** → Disable ALL auto-payments to them, notify recipient
25. **User pays manually before scheduled auto-debit time** → Check status before initial auto-debit (must be 'not_paid'), skip auto-debit if status is 'paid' or 'confirmed' (prevent double payment)
26. **Auto-debit fails, user pays manually, retry triggers** → Check status before retry (must be 'not_paid'), skip retry if status is 'paid' or 'confirmed' (prevent double payment)
27. **User pays manually while auto-debit retry is pending** → Status check prevents double charge when retry executes
28. **User requests withdrawal** → 24-hour hold period, send security email, process after 24 hours
29. **Fraudulent withdrawal attempt** → 24-hour hold gives time to detect and prevent, user can contact security@groupfund.app
30. **Payment fails after 2 attempts (initial + 1 retry)** → ✅ **Auto-disable auto-pay, revert to manual payment**
   - **Strategy**: Simple - max 2 attempts total (initial + 1 retry) - it's just a contribution app, not buy/sell
   - **Trigger**: Payment fails after 2 attempts (initial charge attempt + 1 retry)
   - **Action**: Automatically disable auto-pay for the affected group
   - **Update**: Set `auto_pay_enabled = false` for the group in `user_payment_preferences`
   - **Notification**: Send email "Auto-Pay Disabled - Payment Failed"
     - Subject: "Auto-Pay Disabled - Payment Failed"
     - Content: "Your automatic payment for [Group Name] failed after 2 attempts. Auto-pay has been disabled and contributions have reverted to manual payment. Please check your payment method and re-enable auto-pay if the issue is resolved."
   - **Result**: Contributions revert to manual payment (user must mark as paid manually)
   - **Re-enable**: User can re-enable auto-pay after fixing the issue (add new card, update card, add funds, etc.)
   - **Validation**: System validates payment method exists before allowing re-enable
31. **General group deadline has passed** → ✅ **Cannot enable auto-pay, disable if already enabled**
   - **Trigger**: User tries to enable auto-pay for general group with deadline in the past
   - **Validation**: Check if group is general type AND deadline < today
   - **Action**: Block enable request, return error "Cannot enable auto-pay: Group deadline has passed"
   - **If already enabled**: Disable auto-pay automatically (set `auto_pay_enabled = false`)
   - **Notification**: Send email if auto-pay was disabled: "Auto-Pay Disabled - Deadline Passed"
     - Subject: "Auto-Pay Disabled - Deadline Passed"
     - Content: "Auto-pay has been disabled for [Group Name] because the deadline has passed. General groups have one-time deadlines, so no more automatic payments will be processed."
   - **Rationale**: General groups are one-time deadlines, no point in auto-pay after deadline passes

---

## Security Checklist (Protect Users' Money)

### Payment Data Security
- [ ] **Never store card details directly** - Only store payment method tokens from Stripe
- [ ] **PCI Compliance** - Use Stripe for all card handling (they're PCI compliant)
- [ ] **Payment Method IDs** - Only store payment method IDs (pm_xxx from Stripe)
- [ ] **Encrypt sensitive data at rest** - Encrypt payment tokens, API keys in database
- [ ] **HTTPS everywhere** - All API endpoints must use HTTPS (no HTTP)
- [ ] **Environment variables** - Store Stripe API keys in environment variables (never in code)
- [ ] **Secrets management** - Use secure secret management (AWS Secrets Manager, HashiCorp Vault, or similar)

### Webhook Security
- [ ] **Verify webhook signatures** - Always verify Stripe webhook signatures (stripe-signature header)
- [ ] **Webhook endpoint authentication** - Restrict webhook endpoints (IP whitelist if possible)
- [ ] **Idempotency** - Handle duplicate webhook events (use event IDs to prevent double-processing)
- [ ] **Webhook timeout** - Return 200 OK quickly, process webhook asynchronously

### Authentication & Authorization
- [ ] **JWT authentication required** - All payment endpoints require valid JWT token
- [ ] **User authorization** - Users can only access their own payment methods/transactions
- [ ] **Admin-only endpoints** - Restrict admin payment endpoints to admin users only
- [ ] **Token expiration** - JWT tokens expire (don't use permanent tokens)
- [ ] **Refresh tokens** - Implement refresh token mechanism (optional but recommended)

### Rate Limiting & Abuse Prevention
- [ ] **Rate limit payment endpoints** - Strict limits on payment creation endpoints
- [ ] **Rate limit auto-pay triggers** - Prevent abuse of automatic payment triggers
- [ ] **IP-based limiting** - Rate limit by IP address (prevent distributed attacks)
- [ ] **User-based limiting** - Rate limit by user ID (prevent individual abuse)
- [ ] **Transaction limits** - Set maximum transaction amounts (prevent fraud)
- [ ] **Daily limits** - Set daily transaction limits per user

### Fraud Prevention
- [ ] **Transaction monitoring** - Monitor for suspicious patterns (large amounts, rapid transactions)
- [ ] **Velocity checks** - Limit number of transactions per user per day
- [ ] **Amount validation** - Validate transaction amounts (min/max limits)
- [ ] **Geolocation checks** - Monitor for transactions from unusual locations (optional)
- [ ] **Card verification** - Require CVV for one-time payments (Stripe handle this)
- [ ] **3D Secure** - Enable 3D Secure for additional verification (Stripe support)

### Database Security
- [ ] **Parameterized queries** - Use parameterized queries (prevent SQL injection)
- [ ] **Database encryption** - Encrypt database at rest (use encrypted database instances)
- [ ] **Sensitive column encryption** - Encrypt payment tokens, API keys in database
- [ ] **Database backups** - Regular encrypted backups (protect against data loss)
- [ ] **Access control** - Limit database access (only application has access)
- [ ] **Connection security** - Use SSL/TLS for database connections

### Error Handling & Logging
- [ ] **Don't expose sensitive data** - Never log or return card numbers, CVV, API keys
- [ ] **Generic error messages** - Return generic errors to users (don't reveal system details)
- [ ] **Audit logging** - Log all payment attempts (success/failure) with user ID, timestamp
- [ ] **Error tracking** - Use error tracking service (Sentry) for security errors
- [ ] **Structured logging** - Use structured logging for easy searching/analysis
- [ ] **Log retention** - Keep audit logs for at least 1 year (compliance)

### Security Email Notifications
- [ ] **Email notifications for critical actions** - Send confirmation emails for all critical actions
- [ ] **Email templates** - Create email templates for each critical action type
- [ ] **Fraud warning in emails** - Include security warning in all notification emails
- [ ] **Action details in emails** - Include action details (date, time, masked data)
- [ ] **Security contact email** - Set up security@groupfund.app (or similar) for fraud reports
- [ ] **Email monitoring** - Monitor security email for fraud reports
- [ ] **Actions to notify:**
  - Add/edit account details (wallet/bank account)
  - Add/edit/delete debit card (payment method)
  - Add/edit withdrawal account
  - Withdraw money (with amount and account details)
  - Enable/disable auto-pay
  - Update payment timing preferences

### API Security
- [ ] **Input validation** - Validate all input (amounts, user IDs, group IDs)
- [ ] **CORS configuration** - Restrict CORS to trusted domains only
- [ ] **Security headers** - Use Helmet.js (already implemented) for security headers
- [ ] **Content-Type validation** - Only accept JSON for payment endpoints
- [ ] **Request size limits** - Limit request body size (prevent DoS attacks)
- [ ] **Timeout configuration** - Set appropriate timeouts for payment API calls

### Monitoring & Alerts
- [ ] **Failed payment alerts** - Alert on high failure rates (>10%)
- [ ] **Unusual transaction alerts** - Alert on large amounts, rapid transactions
- [ ] **Webhook delivery failures** - Alert if webhooks fail to process
- [ ] **Security event alerts** - Alert on authentication failures, unauthorized access attempts
- [ ] **System monitoring** - Monitor API response times, error rates
- [ ] **Payment provider status** - Monitor Stripe status (downtime alerts)

### Compliance & Auditing
- [ ] **Regular security audits** - Quarterly security reviews
- [ ] **Penetration testing** - Annual penetration testing by third party
- [ ] **Compliance documentation** - Document security measures (PCI, GDPR if applicable)
- [ ] **Incident response plan** - Plan for security incidents (data breach, fraud)
- [ ] **Security training** - Train team on security best practices
- [ ] **Vulnerability scanning** - Regular dependency vulnerability scanning (npm audit)

### Two-Factor Verification (2FA) for Critical Actions
- [ ] **Password verification required** - Users must enter password for critical actions
- [ ] **Email OTP required** - Users must enter 6-digit OTP sent to email
- [ ] **Critical actions requiring 2FA**:
  - Add/edit account details (wallet/bank account)
  - Add/edit debit card (payment method)
  - Add/edit withdrawal account
  - Withdraw money
  - Enable auto-pay
  - Disable auto-pay
  - Update payment timing preferences
  - Delete payment method
- [ ] **OTP generation** - Generate 6-digit OTP (expires in 10 minutes)
- [ ] **OTP email sending** - Send OTP to user's registered email
- [ ] **OTP verification** - Verify OTP before allowing action
- [ ] **OTP storage** - Store OTP in database with expiration
- [ ] **OTP type** - Use 'payment-action' or 'critical-action' type
- [ ] **Password + OTP flow** - Step 1: Verify password, Step 2: Send OTP, Step 3: Verify OTP, Step 4: Execute action
- [ ] **Rate limiting** - Limit OTP requests (prevent abuse)
- [ ] **OTP one-time use** - Mark OTP as used after verification
- [ ] **OTP expiration** - OTP expires after 10 minutes
- [ ] **Security email notifications** - Send confirmation emails for all critical actions
- [ ] **Fraud warning in emails** - Include security warning: "If you didn't make this change, contact security@groupfund.app immediately"

### Additional Security Measures
- [ ] **Two-factor verification** - ✅ Implemented for critical payment actions (password + email OTP)
- [ ] **Account lockout** - Lock accounts after multiple failed payment attempts
- [ ] **Session management** - Secure session handling (logout, session timeout)
- [ ] **Secure password storage** - Already using bcrypt (good) - keep it
- [ ] **Email verification** - Already implemented (good) - keep it
- [ ] **Phone verification** - Consider phone verification for large transactions (optional)

---

## Monitoring & Analytics

### Key Metrics to Track
- Payment success rate
- Average transaction amount
- Fee revenue
- Failed payment reasons
- Auto-pay adoption rate
- Withdrawal processing time
- Provider performance (Stripe)

### Alerts to Set Up
- High failure rate (>10%)
- Payment processing delays
- Webhook delivery failures
- Unusual transaction patterns

---

## Security Best Practices (How to Prevent Hacking)

### 1. **Never Store Card Details**
```
❌ DON'T: Store card number in database
✅ DO: Store only payment method token from Stripe

Example:
- User adds card → Stripe returns token: pm_1ABC123
- Store only: pm_1ABC123 (not the actual card number)
- Use token for future charges
```

### 2. **Always Verify Webhook Signatures**
```
❌ DON'T: Process webhooks without verification
✅ DO: Verify signature before processing

Stripe:
- Check stripe-signature header
- Use Stripe.webhooks.constructEvent() to verify

If signature doesn't match → Reject webhook (possible attack)
```

### 3. **Use Environment Variables for API Keys**
```
❌ DON'T: Hardcode API keys in code
✅ DO: Store in environment variables

.env file:
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

Never commit .env to git (add to .gitignore)
```

### 4. **Rate Limit Payment Endpoints**
```
✅ Already implemented: express-rate-limit
- Payment endpoints: 50 requests per 15 minutes
- Prevents brute force attacks
- Prevents automated abuse
```

### 5. **Validate All Input**
```
❌ DON'T: Trust user input
✅ DO: Validate everything

- Amount: Must be positive number, within min/max limits
- User ID: Must belong to authenticated user
- Group ID: Must exist and user must be member
- Payment method ID: Must belong to user

Use express-validator (already implemented)
```

### 6. **Log All Payment Attempts**
```
✅ Audit logging for security:
- Who: user_id
- What: payment attempt (success/failure)
- When: timestamp
- Amount: transaction amount
- Result: success or failure reason

Use for:
- Fraud detection
- Security audits
- Dispute resolution
```

### 7. **Don't Expose Sensitive Data in Errors**
```
❌ DON'T: Return detailed error messages
Error: "Stripe API key invalid: sk_test_123..."
Error: "Card number 4242 4242 4242 4242 declined"

✅ DO: Return generic errors
Error: "Payment processing failed. Please try again."
Error: "Card declined. Please check your card details."

Log detailed errors server-side (not returned to user)
```

### 8. **Use HTTPS Everywhere**
```
✅ Required for all payment endpoints
- Stripe require HTTPS for webhooks
- Protects data in transit
- SSL/TLS encryption

Already should have HTTPS in production
```

### 9. **Monitor for Suspicious Activity**
```
✅ Set up alerts for:
- Large transactions (above normal amounts)
- Rapid transactions (many in short time)
- Failed payment spikes (possible attack)
- Unusual patterns (new location, new device)

Use monitoring tools:
- Stripe Dashboard (has fraud detection)
- Your own monitoring (logs, alerts)
```

### 10. **Regular Security Updates**
```
✅ Keep dependencies updated:
npm audit (check for vulnerabilities)
npm update (update packages)
Update Stripe SDKs regularly

✅ Regular security reviews:
- Quarterly security audits
- Annual penetration testing
- Stay updated on security best practices
```

### 11. **Incident Response Plan**
```
✅ Have a plan if security breach happens:
1. Immediately disable affected accounts
2. Review logs to understand scope
3. Notify affected users
4. Contact Stripe support
5. Document incident
6. Implement fixes
7. Learn and improve
```

### 12. **Database Security**
```
✅ Use parameterized queries (already doing this):
✅ Use connection pooling (already implemented)
✅ Encrypt database at rest (database provider)
✅ Limit database access (only application)
✅ Regular backups (encrypted)
```

---

## Common Attack Vectors & How to Prevent

### 1. **Card Skimming / Data Theft**
**Attack**: Hackers try to steal card numbers
**Prevention**: 
- ✅ Never store card numbers (only tokens)
- ✅ Use Stripe (they handle card data securely)
- ✅ HTTPS for all communication

### 2. **Webhook Spoofing**
**Attack**: Fake webhook events to trigger payments
**Prevention**:
- ✅ Always verify webhook signatures
- ✅ Check webhook event IDs (idempotency)
- ✅ Validate webhook payloads

### 3. **API Key Theft**
**Attack**: Steal API keys to make unauthorized payments
**Prevention**:
- ✅ Store API keys in environment variables (not code)
- ✅ Use separate test/live keys
- ✅ Rotate keys periodically
- ✅ Monitor for unusual API usage

### 4. **SQL Injection**
**Attack**: Inject SQL to access/modify database
**Prevention**:
- ✅ Use parameterized queries (already implemented)
- ✅ Use ORM or query builder
- ✅ Validate all input

### 5. **Brute Force Attacks**
**Attack**: Try many payment attempts to guess/break system
**Prevention**:
- ✅ Rate limiting (already implemented)
- ✅ CAPTCHA for suspicious activity (optional)
- ✅ Account lockout after failures

### 6. **Authorization Bypass**
**Attack**: Access other users' payment methods
**Prevention**:
- ✅ Check user ID on all endpoints (authenticate)
- ✅ Verify user owns payment method
- ✅ Verify user is group member before charging

### 7. **Replay Attacks**
**Attack**: Replay old payment requests
**Prevention**:
- ✅ Use idempotency keys (Stripe support)
- ✅ Check transaction IDs (prevent duplicates)
- ✅ Webhook event IDs (prevent duplicate processing)

### 8. **Man-in-the-Middle**
**Attack**: Intercept communication
**Prevention**:
- ✅ HTTPS everywhere (SSL/TLS)
- ✅ Certificate pinning (mobile apps, optional)
- ✅ Verify SSL certificates

---

## Security Checklist Summary (Quick Reference)

**Before Launch:**
- [ ] Never store card details (only tokens)
- [ ] Verify all webhook signatures
- [ ] Store API keys in environment variables
- [ ] Rate limit payment endpoints
- [ ] Validate all input
- [ ] Use HTTPS everywhere
- [ ] Log all payment attempts
- [ ] Don't expose sensitive data in errors
- [ ] **Two-factor verification (password + email OTP) for critical actions**
- [ ] **Security email notifications for all critical actions**
- [ ] **Set up security@groupfund.app email (monitor for fraud reports)**
- [ ] Set up monitoring and alerts
- [ ] Test security measures thoroughly

**Ongoing:**
- [ ] Monitor for suspicious activity
- [ ] Keep dependencies updated
- [ ] Regular security audits
- [ ] Review logs regularly
- [ ] Stay updated on security best practices

---

## Two-Factor Verification (2FA) Flow

### Critical Actions Requiring 2FA (Password + Email OTP)

**Actions that require 2FA:**
1. Add/edit account details (wallet/bank account)
2. Add/edit debit card (payment method)
3. Add/edit withdrawal account
4. Withdraw money
5. Enable auto-pay
6. Disable auto-pay
7. Update payment timing preferences
8. Delete payment method

### 2FA Flow (3 Steps)

```
STEP 1: Password Verification
User → POST /api/{endpoint}/verify-password
Body: { password }
System → Verify password (bcrypt.compare)
If valid → Return temporary token (expires in 5 minutes)
If invalid → Return error

STEP 2: Request OTP
User → POST /api/{endpoint}/request-otp
Headers: { password_verification_token: "temp_token" }
System → Verify token
If valid → Generate 6-digit OTP
         → Send OTP to user's email (sendOTPEmail)
         → Store OTP in database (expires in 10 minutes)
         → Return success message
If invalid → Return error

STEP 3: Execute Action
User → POST /api/{endpoint}
Body: { 
  password_verification_token: "temp_token",
  otp: "123456",
  ...action_data...
}
System → Verify password token (not expired)
       → Verify OTP (correct, not expired, not used)
       → Mark OTP as used
       → Execute the action (add card, withdraw, etc.)
       → Return success
```

### Implementation Details

**OTP Types:**
- Use new OTP type: `'payment-action'` or `'critical-action'`
- Existing types: 'signup', 'forgot-password', 'login'

**Password Verification Token:**
- JWT token with short expiration (5 minutes)
- Contains: { userId, action: "add-payment-method", timestamp }
- Stored in response or session
- Must be included in subsequent requests

**OTP Storage:**
```
otps table:
- user_id
- email
- code (6 digits)
- type ('payment-action')
- expires_at (10 minutes from generation)
- is_used (FALSE initially)
```

**OTP Email:**
- Use existing `sendOTPEmail` function
- Subject: "Security Verification Code - GroupFund"
- Body: Includes 6-digit OTP code
- Expires in 10 minutes

**Rate Limiting:**
- Limit OTP requests: 5 per 15 minutes (use existing otpLimiter)
- Prevent abuse of OTP generation
- Already implemented in codebase

**Error Handling:**
- Invalid password → "Invalid password"
- Expired password token → "Password verification expired. Please verify password again."
- Invalid OTP → "Invalid or expired OTP"
- OTP already used → "OTP already used. Please request a new one."
- OTP expired → "OTP expired. Please request a new one."

### User Experience Flow

```
USER WANTS TO ADD DEBIT CARD:

1. User clicks "Add Debit Card"
   ↓
2. System shows: "Enter your password for security"
   User enters password
   ↓
3. System verifies password → Shows: "Enter verification code sent to your email"
   System sends 6-digit OTP to user's email
   ↓
4. User checks email, enters OTP code
   ↓
5. System verifies OTP → Shows card form
   User enters card details
   ↓
6. System adds card (Stripe handles securely)
   Success!
```

### Security Email Notifications (Critical Actions)

**Actions that trigger security emails:**
1. Add account details (wallet/bank account)
2. Edit account details (wallet/bank account)
3. Add debit card (payment method)
4. Edit debit card (payment method)
5. Delete debit card (payment method)
6. Add withdrawal account
7. Edit withdrawal account
8. Withdraw money
9. Enable auto-pay
10. Disable auto-pay
11. Update payment timing preferences

**Email content for each action:**
- Subject: "Security Alert: [Action] on Your GroupFund Account"
- Body includes:
  - Action performed (e.g., "You've added a debit card")
  - Date and time of action
  - Details (masked card number, account details, amount, etc.)
  - Device/IP information (if available)
  - Security warning: "If you didn't make this change, please contact security@groupfund.app immediately"
  - Link to review account security settings

**Email examples:**

**Withdrawal Request:**
```
Subject: Withdrawal Request Received

Hi [Name],

Your withdrawal request of {amount} {currency_symbol} has been received.

Date: [Date and Time]
Action: Withdrawal requested
Amount: {amount} {currency_symbol}
Bank Account: {bank_name} - ****{last_4_digits}

Funds will be sent to your bank account within 24 hours.

If you didn't make this withdrawal, please contact security@groupfund.app immediately
to secure your account.

Best regards,
The GroupFund Team
```

**Debit Card Added:**
```
Subject: Security Alert: Debit Card Added to Your GroupFund Account

Hi [Name],

We're writing to confirm that a debit card was added to your GroupFund account.

Date: [Date and Time]
Action: Debit card added
Card ending in: **** **** **** 1234

If you didn't make this change, please contact us immediately at security@groupfund.app
to secure your account.

Best regards,
The GroupFund Team
```

**Email contact:**
- **Recommended: `security@groupfund.app`** (professional, clear purpose, industry standard)
- Alternative: `support@groupfund.app` or `fraud@groupfund.app`
- Should be monitored regularly for security issues
- Should have auto-responder acknowledging receipt
- Should forward to security team/contact

**Email template structure:**
```html
Subject: Security Alert: [Action] on Your GroupFund Account

Hi [Name],

We're writing to confirm that [action description] was performed on your GroupFund account.

Date: [Date and Time]
Action: [Action type]
Details: [Masked/partial details]

Examples:
- "Withdrawal request of $50 received. Funds will be sent within 24 hours."
- "Debit card ending in ****1234 was added"
- "Account details were updated (Bank: [Bank Name])"
- "Auto-pay was enabled for group: [Group Name]"

If you didn't make this change, please contact us immediately at security@groupfund.app
to secure your account. We take account security seriously and will investigate any
unauthorized activity.

You can review your account security settings in the app.

Best regards,
The GroupFund Security Team
```

**Implementation notes:**
- Send email immediately after action is completed (async, non-blocking)
- Use existing email service (Resend)
- Create reusable email template function
- Mask sensitive data (card numbers: last 4 digits only)
- Include timestamp and action details
- Include security warning prominently
- Include contact email prominently
- Test email delivery

### Benefits of 2FA

1. **Prevents unauthorized access** - Even if someone has your phone/device
2. **Protects sensitive actions** - Password alone not enough
3. **Email verification** - User must have access to email
4. **Audit trail** - OTP attempts logged for security
5. **Industry standard** - Common practice for financial actions
6. **User trust** - Users feel more secure
7. **Security notifications** - Users alerted to all critical actions
8. **Fraud detection** - Users can report unauthorized changes immediately

### Security Considerations

1. **Password token expiration** - Short expiration (5 minutes) prevents reuse
2. **OTP expiration** - 10 minutes (enough time but not too long)
3. **OTP one-time use** - Mark as used immediately (prevents replay)
4. **Rate limiting** - Prevent OTP spam/abuse
5. **Email delivery** - Ensure OTP emails are delivered (use reliable service)
6. **OTP randomness** - Use cryptographically secure random number generation
7. **Token storage** - Don't store password token in database (stateless JWT)

---

## Next Steps

1. **Review this plan** - Make sure everything aligns with your vision
2. **Set up Stripe account** - Stripe only
3. **Design database migrations** - Create migration files
4. **Start with Phase 1** - Foundation work
5. **Test thoroughly** - Especially fee calculations
6. **Get user feedback** - Make sure fees are acceptable

---

## Requirements Summary

### Wallet Usage Rules (Critical)

**Wallet balance is RECEIVE and WITHDRAW ONLY:**
- ✅ **Can receive money** → Credited when others contribute to you
- ✅ **Can withdraw money** → Transfer to bank account
- ❌ **Cannot pay contributions** → Must use debit card
- ❌ **Cannot use wallet for any payments** → All payments must use debit card

**Why this rule?**
- All contributions must go through payment processors (Stripe)
- Ensures fees are collected properly
- Better security and fraud prevention
- Consistent payment tracking
- Prevents wallet balance from being used as payment method

### User Requirements (Mandatory)

1. **Bank Details Required**
   - Users MUST have bank details to join/create ANY group
   - Enforced at group creation and join time
   - Prevents debit/credit failures
   - Ensures recipient can receive funds

2. **Debit Card Required for Auto-Pay**
   - Users MUST add debit card details if they want to enable auto-pay
   - Not required if user wants manual payment only
   - Stored securely via Stripe (never on your server)

3. **Withdrawal Account**
   - Already covered by bank details requirement
   - Must have bank details to enable withdrawals
   - Same bank details used for receiving funds

### Payment Preferences

1. **Payment Timing Options**
   - **1 day before**: Card debited 1 day before birthday/deadline
   - **Same day**: Card debited on the actual birthday/deadline
   - User sets preference per group or globally (default)
   - Can be changed anytime

2. **Payment Confirmation (Final Decision)**
   - **Auto-debit payments**: Automatic confirmation (status = 'confirmed' immediately)
     - Payment processed by Stripe → Verified by webhook → Auto-confirm
     - No manual confirmation needed (already verified by payment processor)
   - **Manual payments**: Manual confirmation required (status = 'paid' → 'confirmed')
     - User marked as paid manually → Status = 'paid' → Recipient confirms → Status = 'confirmed'
     - Recipient must verify they received the payment
   - **Logic**: If payment_method = 'auto-debit' AND status = 'paid' → Auto-confirm to 'confirmed'
   - **Logic**: If payment_method = 'manual' → Keep status = 'paid' until recipient confirms

## Additional Considerations (To Decide/Plan)

### 1. **Transaction Limits**
- **Minimum contribution amounts?**
  - To cover fees, need minimum amounts
  - Example: Minimum $0.50 (USD), €0.50 (EUR), £0.30 (GBP)
  - Different minimums per currency?
  - Consider: Platform fee + processor fee must be less than contribution

- **Maximum transaction amounts?**
  - Daily limit per user? (prevent fraud)
  - Per transaction limit? (risk management)
  - Example: Maximum $10,000 per transaction, $50,000 per day

- **Withdrawal limits?**
  - Minimum withdrawal amount? (processing costs)
    - **Recommended: $10 (USD), €10 (EUR), £10 (GBP) minimum**
    - Ensures withdrawal is worth the fee
  - Maximum withdrawal amount? (per day/month)
    - Example: Maximum $10,000 per day, $50,000 per month
  - Limits help prevent fraud and manage risk

- **Withdrawal fees?**
  - **GBP withdrawals**: FREE (no fee)
  - **EUR withdrawals**: FREE (no fee)
  - **USD withdrawals**: 1% fee
  - Show fees transparently before withdrawal

### 2. **Chargeback Handling**

**What is a Chargeback?**
- **Chargeback** = Cardholder disputes a payment with their bank/card issuer
- **Not the same as refund** - Refund is you giving money back, chargeback is bank forcing reversal
- **Common reasons**: Fraudulent transaction, card stolen, unauthorized use, goods/services not received
- **Who reverses**: Bank/card issuer reverses the payment (takes money back from you)
- **You're notified**: Stripe notifies you, you can dispute the chargeback
- **Example**: Someone's card was stolen, thief used it on your app, real owner reports fraud → bank reverses payment

**Chargeback Handling Process:**
- **Stripe notifies you** via webhook (e.g., `charge.dispute.created`)
- **Review the transaction** - Check if it's legitimate or fraudulent
- **Submit evidence** - If legitimate, provide proof (payment was authorized, service delivered)
- **Decision**: Bank decides - you win (keep money) or lose (money reversed)
- **If you lose**: Money reversed from your account, plus chargeback fee (~$15-25)

**For GroupFund:**
- **Not common** - Group contributions are usually legitimate (people know each other)
- **Handle via Stripe** - Use their dispute system to respond
- **Document transactions** - Keep records (payment method, user ID, contribution details)
- **Respond promptly** - Usually 7-14 days to respond or you automatically lose
- **Account monitoring** - High chargeback rate = account suspension risk

**Recommendation:**
- **Monitor chargebacks** - Set up alerts for dispute notifications
- **Respond to disputes** - Submit evidence showing transaction was legitimate
- **Keep records** - Document all payments (user consent, contribution details)
- **Accept risk** - Some chargebacks will happen (fraudulent cards), part of doing business

### 3. **Failed Payment Retry Logic (Details)**

**Payment Attempt Strategy (One-Time Payments):**
- **Note**: Contributions are one-time payments (not subscriptions), so Stripe don't automatically retry
- **Our retry strategy**: Simple - try once, if it fails, retry once more (max 2 attempts total)
  - Attempt 1: Initial charge attempt
  - Attempt 2: Retry after initial failure (only for recoverable errors like network issues)
  - If both fail: Disable auto-pay, revert to manual payment
- **Rationale**: It's just a contribution app - if the person doesn't want to pay, it's not a big deal (not buy/sell)
- **No need for many retries**: Keep it simple - 2 attempts max, then disable auto-pay

**After Payment Fails (2 attempts):**
- **Auto-disable auto-pay**: After 2 failed attempts (initial + 1 retry)
  - Set `auto_pay_enabled = false` for the affected group in `user_payment_preferences`
  - Contributions revert to manual payment (user must mark as paid manually)
- **Email notification**: Send email to user immediately
  - Subject: "Auto-Pay Disabled - Payment Failed"
  - Content: "Your automatic payment for [Group Name] failed after 2 attempts. Auto-pay has been disabled and contributions have reverted to manual payment. Please check your payment method and re-enable auto-pay if the issue is resolved."
- **User can re-enable**: User can re-enable auto-pay after fixing the issue (add new card, update card, add funds, etc.)
  - User must manually re-enable auto-pay via the enable endpoint
  - System validates payment method exists before allowing re-enable

- **CRITICAL: Status Check Before ANY Auto-Debit (Prevent Double Payment)**
  - **Before ANY auto-debit attempt (initial OR retry), check if payment status is still 'not_paid'**
  - If status is 'paid' or 'confirmed' → Skip auto-debit (user already paid manually)
  - If status is still 'not_paid' → Proceed with auto-debit
  - This prevents double-charging if user manually pays before scheduled auto-debit time
  - Check contribution status in database before EACH auto-debit attempt (initial and retries)
  - Query: `SELECT status FROM [birthday_contributions|subscription_contributions|general_contributions] WHERE ...`
  - Only proceed if status = 'not_paid' or status = 'not_received'
  - If status = 'paid' or 'confirmed' → Skip auto-debit, log "Already paid manually"

- **Card expiration handling:**
  - Detect expired cards (Stripe notifications)
  - Notify user to update card
  - Disable auto-pay for expired cards
  - Email reminder to update card

- **Card deletion/removal handling:**
  - **Auto-disable auto-pay** when card is deleted/removed
  - Check if card is used for auto-pay before deletion
  - If used: Automatically disable auto-pay for all groups using this card
  - Update: Set `auto_pay_enabled = false` for all affected groups
  - Notification: Send email "Auto-pay disabled: Your debit card was removed. Please add a new card to re-enable auto-pay."
  - Result: Contributions revert to manual payment (user must mark as paid manually)
  - User must re-enable auto-pay after adding new card

### 4. **Currency Handling (DECIDED)**
- ✅ **Same currency per group** - Currency selected at group creation
- ✅ **No currency conversion** - All members must use the group's currency
- ✅ **Admin selects currency** when creating group (EUR, USD, GBP only)
- ✅ **Validation**: Users joining group must use same currency (can check user's currency preference or enforce group currency)
- **Rationale**: Simpler implementation, avoids conversion fees, clearer for users, prevents confusion

### 5. **User Onboarding & Education**
- **Onboarding flow:**
  - Tutorial for auto-pay setup?
  - FAQ/help documentation
  - Video tutorials?
  - In-app tips/guidance

- **User communication:**
  - Welcome email explaining auto-pay
  - Email reminders to set up auto-pay
  - Tips for first-time users

### 6. **Multiple Payment Methods**
- **Multiple cards per user:**
  - Allow users to add multiple cards?
  - Select default card per group?
  - Card selection UI?

- **Payment method management:**
  - Set default payment method
  - Change payment method per group
  - View all payment methods

### 7. **Account & Lifecycle Management**
- **Account deletion/closure:**
  - **Prevent deletion if wallet balance > 0** - User must withdraw all money first
  - **Validation check**: Before allowing account deletion, check wallet balance
  - **Error message**: "Cannot delete account. Please withdraw all funds ({amount} {currency_symbol} remaining) before deleting your account."
  - **Format**: Use user's currency (e.g., "$50 remaining" for USD, "€50 remaining" for EUR, "£30 remaining" for GBP)
  - **User must**: Withdraw all money first, then delete account
  - **Exception**: If balance is exactly 0 (in user's currency), allow deletion
  - **Rationale**: Prevents users from losing their money, avoids orphaned balances

- **Payment method expiration:**
  - Automatic detection of expired cards
  - Email reminders before expiration
  - Disable auto-pay for expired cards
  - Prompt to update card

### 8. **Support & Documentation**
- **User support:**
  - Help documentation for auto-pay
  - FAQ section
  - Support contact (support@groupfund.app)
  - In-app help/chat support?

- **Terms & legal:**
  - Update Terms of Service (auto-pay terms)
  - Update Privacy Policy (payment data handling)
  - Chargeback/dispute policy document
  - User agreement for auto-pay

### 9. **Data Migration & Rollout**
- **Existing users:**
  - How to migrate existing users to auto-pay?
  - Email campaign to encourage auto-pay setup?
  - Incentives for early adopters?

- **Gradual rollout:**
  - Beta testing with select users?
  - Phased rollout (10% → 50% → 100%)?
  - Feature flag for auto-pay?

### 10. **Monitoring & Analytics (Additional)**
- **Additional metrics:**
  - Auto-pay adoption rate
  - Failed payment rate by reason
  - Average time to resolve failed payments
  - User satisfaction/feedback

- **Business metrics:**
  - Revenue from platform fees (contributions only)
  - Transaction volume trends
  - User retention with auto-pay vs. manual
  - Average transaction size
  - Platform fee revenue per transaction

## Questions to Consider

1. **Payment Confirmation? (DECIDED)**
   - ✅ **Auto-debit payments**: Auto-confirm (status = 'confirmed' immediately after webhook verification)
   - ✅ **Manual payments**: Manual confirmation required (status = 'paid' → recipient confirms → 'confirmed')

2. **When to process payments?**
   - ✅ User preference: "1 day before" or "same day" (DECIDED)
   - ✅ **Exact time of day**: 9 AM local time (recommended default, can be adjusted during implementation)
   - Rationale: Business hours timing, better for user experience, aligns with banking hours

3. **Minimum/Maximum transaction amounts?**
   - ✅ **Recommended defaults** (can be adjusted per currency during implementation):
     - **Minimum**: Based on payment processor minimums (typically $0.50 USD, €0.50 EUR, £0.30 GBP)
     - **Maximum**: No strict maximum (let payment processors handle fraud detection)
     - **Rationale**: Minimum covers processor fees, maximum not needed (processors handle limits)
   - Can be configured per currency in settings

4. **Chargeback handling?**
   - ✅ Handle via Stripe dispute system
   - ✅ Monitor and respond to chargebacks
   - ✅ Keep transaction records for evidence

5. **Hold period for withdrawals?**
   - ✅ **DECIDED: 24-hour hold period** (security measure to prevent fraud)
   - **Rationale**: Gives time to detect fraudulent withdrawals before money leaves the system
   - **Email notification**: Send email when withdrawal requested
     - Subject: "Withdrawal Request Received"
     - Content: "Your withdrawal request has been received. Funds will be sent to your bank account within 24 hours. If you didn't make this withdrawal, please contact security@groupfund.app immediately."
   - **Security benefit**: Allows time to detect and prevent fraud before money is transferred

6. **Currency handling?**
   - ✅ **Same currency per group** (DECIDED)
   - ✅ **Currency selected at group creation** - Admin selects currency when creating group
   - ✅ **All members must use same currency** - No currency conversion needed
   - Rationale: Simpler implementation, avoids conversion fees, clearer for users

---

**Last Updated**: [Current Date]
**Status**: Planning Phase
**Owner**: [Your Name]

