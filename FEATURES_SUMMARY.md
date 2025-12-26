# GroupFund New Features - Quick Summary

## 🎉 Three Group Types Now Available

### 1. **Birthday Groups** (Original)
- Same as before
- Requires birthday to create/join
- Has wishlist functionality

### 2. **Subscription Groups** (NEW)
- For shared subscriptions (Netflix, Spotify, etc.)
- Monthly or Annual frequency
- Set deadline day/month
- Shows admin's account details
- No birthday required

### 3. **General Groups** (NEW)
- For any purpose (weddings, events, etc.)
- Optional deadline date
- Shows admin's account details
- No birthday required

---

## 📝 Key Changes

### Group Creation
- New field: `groupType` ("birthday" | "subscription" | "general")
- Subscription groups need: `subscriptionFrequency`, `subscriptionPlatform`, `subscriptionDeadlineDay`
- General groups can have: `deadline` (optional)

### New Endpoints
- `/api/subscriptions/*` - Subscription group endpoints
- `/api/general/*` - General group endpoints
- All existing `/api/birthdays/*` endpoints unchanged

### Contribution Flow (Same for All Types)
1. Member marks as paid → Status: `paid`
2. Admin confirms → Status: `confirmed`
3. Admin rejects → Status: `not_received`

### Upcoming/Reminders
- `/api/birthdays/upcoming` - Upcoming birthdays
- `/api/subscriptions/upcoming` - Upcoming subscription deadlines
- `/api/general/upcoming` - Upcoming general group deadlines

---

## 🔧 Technical Details

### Database Migrations Required
1. `add_group_types.sql`
2. `add_subscription_contributions.sql`
3. `add_general_contributions.sql`

### Backward Compatibility
✅ All existing groups automatically set to "birthday" type
✅ No breaking changes
✅ All existing endpoints work as before

---

## 📱 UI Recommendations

1. **Group Type Selector** in create group screen
2. **Conditional Fields** based on selected type
3. **Group Type Badge** in group list/details
4. **Account Details** - Show admin's for subscription/general, celebrant's for birthday
5. **Separate Sections** for upcoming/reminders by type

---

## 🧪 Quick Test

```bash
# Create subscription group
POST /api/groups/create
{
  "name": "Netflix",
  "contributionAmount": 5000,
  "maxMembers": 5,
  "groupType": "subscription",
  "subscriptionFrequency": "monthly",
  "subscriptionPlatform": "Netflix",
  "subscriptionDeadlineDay": 12
}

# Create general group
POST /api/groups/create
{
  "name": "Wedding Fund",
  "contributionAmount": 10000,
  "maxMembers": 20,
  "groupType": "general",
  "deadline": "2024-06-15"
}
```

---

**Full documentation:** See `NEW_FEATURES.md` for complete API details

