# New Features: Multiple Group Types

## Overview
GroupFund now supports **three types of groups** instead of just birthdays:
1. **Birthday Groups** - Original functionality (unchanged)
2. **Subscription Groups** - For managing shared subscriptions (Netflix, Spotify, etc.)
3. **General Groups** - For any purpose (weddings, baby showers, events, etc.)

---

## 1. Birthday Groups

### Features
- ✅ All existing birthday functionality remains the same
- ✅ Birthday reminders (7 days, 1 day, same day)
- ✅ Wishlist functionality
- ✅ Birthday contributions
- ✅ Overdue reminders

### Requirements
- **Creating a birthday group**: User must have their birthday set in their profile
- **Joining a birthday group**: User must have their birthday set in their profile

### API Endpoints
- `POST /api/birthdays/contribute` - Mark birthday contribution as paid
- `GET /api/birthdays/upcoming` - Get upcoming birthdays
- `GET /api/birthdays/overdue` - Get overdue birthday contributions
- All existing birthday endpoints work as before

---

## 2. Subscription Groups

### Features
- ✅ Create groups for shared subscriptions (Netflix, Spotify, etc.)
- ✅ Choose frequency: **Monthly** or **Annual**
- ✅ Set subscription platform name (e.g., "Netflix", "Spotify")
- ✅ Set deadline:
  - **Monthly**: Day of month (e.g., every 12th of the month)
  - **Annual**: Day and month (e.g., every 12th of March)
- ✅ Set price and currency
- ✅ Upcoming subscription reminders
- ✅ Overdue reminders
- ✅ Admin account details displayed (group creator's account)
- ✅ No birthday requirement
- ✅ No wishlist functionality

### Creating a Subscription Group
**Request Body:**
```json
{
  "name": "Netflix Subscription",
  "contributionAmount": 5000,
  "currency": "NGN",
  "maxMembers": 5,
  "groupType": "subscription",
  "subscriptionFrequency": "monthly",  // or "annual"
  "subscriptionPlatform": "Netflix",
  "subscriptionDeadlineDay": 12,       // Day of month (1-31)
  "subscriptionDeadlineMonth": 3       // Required only for annual (1-12)
}
```

### API Endpoints
- `POST /api/subscriptions/contribute` - Mark subscription contribution as paid
- `POST /api/subscriptions/contribute/:contributionId/confirm` - Admin confirms payment
- `POST /api/subscriptions/contribute/:contributionId/reject` - Admin rejects payment
- `GET /api/subscriptions/upcoming?groupId=&days=30` - Get upcoming subscription deadlines

### Response Example (Upcoming Subscriptions)
```json
{
  "subscriptions": [
    {
      "group_id": "uuid",
      "group_name": "Netflix Subscription",
      "currency": "NGN",
      "contribution_amount": 5000,
      "subscription_frequency": "monthly",
      "subscription_platform": "Netflix",
      "subscription_deadline_day": 12,
      "admin_id": "uuid",
      "admin_name": "John Doe",
      "account_number": "1234567890",
      "bank_name": "Access Bank",
      "account_name": "John Doe",
      "next_deadline": "2024-03-12",
      "days_until_deadline": 5,
      "has_paid": false
    }
  ]
}
```

---

## 3. General Groups

### Features
- ✅ Create groups for any purpose (weddings, baby showers, events, etc.)
- ✅ Set contribution amount and currency
- ✅ Set optional deadline date
- ✅ Upcoming deadline reminders
- ✅ Overdue reminders (if deadline passed)
- ✅ Admin account details displayed (group creator's account)
- ✅ No birthday requirement
- ✅ No wishlist functionality

### Creating a General Group
**Request Body:**
```json
{
  "name": "Wedding Fund",
  "contributionAmount": 10000,
  "currency": "NGN",
  "maxMembers": 20,
  "groupType": "general",
  "deadline": "2024-06-15"  // Optional
}
```

### API Endpoints
- `POST /api/general/contribute` - Mark general contribution as paid
- `POST /api/general/contribute/:contributionId/confirm` - Admin confirms payment
- `POST /api/general/contribute/:contributionId/reject` - Admin rejects payment
- `GET /api/general/upcoming?groupId=&days=30` - Get upcoming group deadlines
- `GET /api/general/overdue?groupId=` - Get overdue general contributions

### Response Example (Upcoming General Groups)
```json
{
  "groups": [
    {
      "group_id": "uuid",
      "group_name": "Wedding Fund",
      "currency": "NGN",
      "contribution_amount": 10000,
      "deadline": "2024-06-15",
      "admin_id": "uuid",
      "admin_name": "Jane Doe",
      "account_number": "9876543210",
      "bank_name": "GTBank",
      "account_name": "Jane Doe",
      "days_until_deadline": 45,
      "has_paid": false
    }
  ]
}
```

---

## Updated Group Creation Endpoint

### Endpoint
`POST /api/groups/create`

### Request Body (All Types)
```json
{
  "name": "Group Name",
  "contributionAmount": 5000,
  "currency": "NGN",  // Optional, defaults to NGN
  "maxMembers": 10,
  "groupType": "birthday" | "subscription" | "general"  // Optional, defaults to "birthday"
}
```

### Additional Fields for Subscription Groups
```json
{
  "subscriptionFrequency": "monthly" | "annual",
  "subscriptionPlatform": "Netflix",
  "subscriptionDeadlineDay": 12,  // 1-31
  "subscriptionDeadlineMonth": 3  // 1-12, required only for annual
}
```

### Additional Fields for General Groups
```json
{
  "deadline": "2024-06-15"  // ISO date string, optional
}
```

### Response
Returns the created group with all fields including `group_type`, subscription fields (if applicable), and deadline (if applicable).

---

## Updated Group Details

All group endpoints now return the `group_type` field:

```json
{
  "group": {
    "id": "uuid",
    "name": "Group Name",
    "group_type": "birthday" | "subscription" | "general",
    "contribution_amount": 5000,
    "currency": "NGN",
    "max_members": 10,
    // Subscription-specific fields (if subscription group):
    "subscription_frequency": "monthly",
    "subscription_platform": "Netflix",
    "subscription_deadline_day": 12,
    "subscription_deadline_month": null,
    // General-specific fields (if general group):
    "deadline": "2024-06-15"
  }
}
```

---

## Contribution Flow (All Types)

All three group types follow the same contribution flow:

1. **Member marks as paid**: `POST /api/{type}/contribute`
   - Status: `paid` (awaiting confirmation)
   - Admin receives notification

2. **Admin confirms**: `POST /api/{type}/contribute/:contributionId/confirm`
   - Status: `confirmed`
   - Member receives notification

3. **Admin rejects**: `POST /api/{type}/contribute/:contributionId/reject`
   - Status: `not_received`
   - Member receives notification

### Contribution Status Values
- `not_paid` - Not yet marked as paid
- `paid` - Marked as paid, awaiting admin confirmation
- `confirmed` - Admin confirmed payment received
- `not_received` - Admin marked as not received

---

## Account Details Display

### Birthday Groups
- Shows birthday celebrant's account details (as before)

### Subscription Groups
- Shows **admin's (group creator's) account details**
- Admin is responsible for paying the subscription

### General Groups
- Shows **admin's (group creator's) account details**
- Admin is responsible for managing the funds

---

## Reminder System

### Birthday Groups
- ✅ 7 days before birthday
- ✅ 1 day before birthday
- ✅ Same day reminder
- ✅ Overdue reminders (1, 3, 7, 14 days after)

### Subscription Groups
- ✅ Upcoming subscription reminders (before deadline)
- ✅ Overdue reminders (after deadline passed)
- Message: "You have an upcoming subscription [Group Name]"

### General Groups
- ✅ Upcoming deadline reminders (before deadline)
- ✅ Overdue reminders (after deadline passed)

---

## Validation Rules

### Birthday Groups
- ✅ User must have birthday set to create
- ✅ User must have birthday set to join
- ✅ All birthday-specific features work

### Subscription Groups
- ✅ No birthday required
- ✅ `subscriptionFrequency` required (monthly/annual)
- ✅ `subscriptionPlatform` required
- ✅ `subscriptionDeadlineDay` required (1-31)
- ✅ `subscriptionDeadlineMonth` required for annual (1-12)

### General Groups
- ✅ No birthday required
- ✅ `deadline` optional (if provided, must be future date)

---

## Breaking Changes

### None! 
- All existing groups are automatically set to `birthday` type
- All existing endpoints continue to work
- Backward compatible

---

## Migration Required

Before deploying, run these database migrations:
1. `add_group_types.sql` - Adds group_type column and fields
2. `add_subscription_contributions.sql` - Creates subscription_contributions table
3. `add_general_contributions.sql` - Creates general_contributions table

Or use the migration endpoint: `POST /api/migrations/run`

---

## Summary of New Endpoints

### Subscription Endpoints
- `POST /api/subscriptions/contribute`
- `POST /api/subscriptions/contribute/:contributionId/confirm`
- `POST /api/subscriptions/contribute/:contributionId/reject`
- `GET /api/subscriptions/upcoming`

### General Endpoints
- `POST /api/general/contribute`
- `POST /api/general/contribute/:contributionId/confirm`
- `POST /api/general/contribute/:contributionId/reject`
- `GET /api/general/upcoming`
- `GET /api/general/overdue`

### Updated Endpoints
- `POST /api/groups/create` - Now accepts `groupType` and type-specific fields
- `GET /api/groups/:groupId` - Now returns `group_type` and type-specific fields
- `GET /api/groups/my-groups` - Now returns `group_type` for each group
- `POST /api/groups/join` - Now validates birthday requirement for birthday groups

---

## UI/UX Recommendations

1. **Group Creation Screen**
   - Add group type selector (Birthday / Subscription / General)
   - Show/hide fields based on selected type
   - For subscription: Show frequency selector, platform input, deadline day/month
   - For general: Show optional deadline date picker

2. **Group List/Details**
   - Display group type badge/icon
   - Show subscription platform name for subscription groups
   - Show deadline countdown for general groups

3. **Contribution Screens**
   - Show admin account details for subscription/general groups
   - Show celebrant account details for birthday groups

4. **Upcoming/Reminders**
   - Separate sections or filters for each type
   - Different messaging for each type

---

## Testing Checklist

- [ ] Create birthday group (with birthday set)
- [ ] Create birthday group (without birthday - should fail)
- [ ] Create subscription group (monthly)
- [ ] Create subscription group (annual)
- [ ] Create general group (with deadline)
- [ ] Create general group (without deadline)
- [ ] Join birthday group (with birthday)
- [ ] Join birthday group (without birthday - should fail)
- [ ] Join subscription group (no birthday required)
- [ ] Mark contribution as paid for each type
- [ ] Admin confirms contribution for each type
- [ ] Admin rejects contribution for each type
- [ ] Get upcoming for each type
- [ ] Get overdue for each type
- [ ] Verify account details shown correctly for each type

