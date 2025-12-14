# GroupFund API Endpoints

Base URL: `http://localhost:3000`

## Health Check
- **GET** `/health` - Check if API is running
  - No authentication required
  - Returns: `{ status: 'OK', message: 'GroupFund API is running' }`

---

## Authentication Endpoints (`/api/auth`)

### Signup
- **POST** `/api/auth/signup`
  - No authentication required
  - Body: `{ name, email, phone, password }`
  - Returns: `{ message, userId }`
  - Sends OTP via email/SMS

### Verify OTP
- **POST** `/api/auth/verify-otp`
  - No authentication required
  - Body: `{ userId, otp, type? }` (type: 'signup', 'forgot-password', 'login')
  - Returns: `{ message }`
  - Verifies OTP and activates account (for signup)

### Resend OTP
- **POST** `/api/auth/resend-otp`
  - No authentication required
  - Body: `{ userId, type? }`
  - Returns: `{ message }`
  - Sends new OTP code

### Login
- **POST** `/api/auth/login`
  - No authentication required
  - Body: `{ email, password }`
  - Returns: `{ token, user: { id, name, email, phone, wallet } }`
  - Returns JWT token for authenticated requests

### Forgot Password
- **POST** `/api/auth/forgot-password`
  - No authentication required
  - Body: `{ email }`
  - Returns: `{ message, userId }`
  - Sends OTP for password reset

### Reset Password
- **POST** `/api/auth/reset-password`
  - No authentication required
  - Body: `{ userId, otp, newPassword }`
  - Returns: `{ message }`
  - Resets password after OTP verification

### Change Password
- **POST** `/api/auth/change-password`
  - **Requires authentication** (Bearer token)
  - Body: `{ currentPassword, newPassword }`
  - Returns: `{ message }`

---

## User Endpoints (`/api/users`)

### Get Profile
- **GET** `/api/users/profile`
  - **Requires authentication**
  - Returns: `{ user: { id, name, email, phone, birthday, is_verified, created_at }, wallet }`

### Update Profile
- **PUT** `/api/users/profile`
  - **Requires authentication**
  - Body: `{ name?, birthday? }` (optional fields)
  - Returns: `{ user }`

### Get Wallet
- **GET** `/api/users/wallet`
  - **Requires authentication**
  - Returns: `{ balance, account_number, bank_name, account_name }`

---

## Group Endpoints (`/api/groups`)

### Create Group
- **POST** `/api/groups/create`
  - **Requires authentication**
  - Body: `{ name, contributionAmount, maxMembers }`
  - Returns: `{ message, group }`
  - Creates group with unique invite code, user becomes admin

### Join Group
- **POST** `/api/groups/join`
  - **Requires authentication**
  - Body: `{ inviteCode }`
  - Returns: `{ message, group }`
  - Joins group by invite code (pending approval if not admin)

### Get My Groups
- **GET** `/api/groups/my-groups`
  - **Requires authentication**
  - Query params: None
  - Returns: `{ groups: [{ id, name, invite_code, contribution_amount, max_members, role, status, active_members, admin_name }] }`

### Get Group Details
- **GET** `/api/groups/:groupId`
  - **Requires authentication**
  - Returns: `{ group }` (includes userRole and userStatus)
  - Must be a member of the group

### Update Group Settings
- **PUT** `/api/groups/:groupId`
  - **Requires authentication** (Admin only)
  - Body: `{ name?, contributionAmount?, maxMembers?, acceptingRequests? }` (optional fields)
  - Returns: `{ group }`
  - `acceptingRequests`: Boolean to pause/resume accepting new join requests (temporary pause)

### Close Group
- **PUT** `/api/groups/:groupId/close`
  - **Requires authentication** (Group creator or system admin only)
  - Returns: `{ message, group }`
  - **Freezes all group activity**: No new members, no contributions, no confirmations/rejections
  - Members can still view data (read-only mode)
  - More permanent than `acceptingRequests=false`

### Reopen Group
- **PUT** `/api/groups/:groupId/reopen`
  - **Requires authentication** (Group creator or system admin only)
  - Returns: `{ message, group }`
  - Reopens a closed group, restoring full functionality

**Note: Difference between Closing and Accepting Requests**
- **`acceptingRequests = false`**: Temporarily pauses new member requests only. Existing members can still contribute, confirm payments, etc.
- **`status = 'closed'`**: Freezes ALL group activity. No new members, no contributions, no confirmations/rejections. Use when group is permanently inactive or needs to be frozen.

---

## Member Endpoints (`/api/members`)

### Get Group Members
- **GET** `/api/members/group/:groupId`
  - **Requires authentication**
  - Returns: `{ members: [{ id, name, email, phone, birthday, role, status, joined_at }] }`
  - Must be a member of the group

### Approve/Reject Member
- **POST** `/api/members/:memberId/approve`
  - **Requires authentication** (Admin only)
  - Body: `{ groupId, action }` (action: 'approve' or 'reject')
  - Returns: `{ message }`

### Remove Member
- **DELETE** `/api/members/:memberId`
  - **Requires authentication** (Admin only)
  - Body: `{ groupId }`
  - Returns: `{ message }`
  - Cannot remove admin members

### Leave Group
- **POST** `/api/members/leave`
  - **Requires authentication**
  - Body: `{ groupId }`
  - Returns: `{ message }`
  - Admin cannot leave if they're the only admin

### Get Member Summary
- **GET** `/api/members/summary/:userId`
  - **Requires authentication**
  - Returns: `{ user: {...}, metrics: {...}, summary: {...} }`
  - Shows member reliability metrics including:
    - Total groups joined
    - Total contributions made
    - Total overdue contributions
    - On-time payment rate
    - Reliability score (0-100)
    - Summary text (e.g., "Excellent - No overdue contributions")
  - Useful for viewing before accepting join requests

---

## Birthday Endpoints (`/api/birthdays`)

### Get Upcoming Birthdays
- **GET** `/api/birthdays/upcoming`
  - **Requires authentication**
  - Query params: `groupId?` (optional), `days?` (default: 30)
  - Returns: `{ birthdays: [{ id, name, email, phone, birthday, days_until_birthday, group_id?, group_name? }] }`
  - If groupId provided, returns birthdays for that group only
  - Otherwise returns birthdays across all user's groups

### Get Birthday Details
- **GET** `/api/birthdays/:userId`
  - **Requires authentication**
  - Returns: `{ user, sharedGroups, contributions }`
  - Shows user's birthday info, shared groups, and contribution history

### Get Calendar View
- **GET** `/api/birthdays/calendar/:year/:month`
  - **Requires authentication**
  - Returns: `{ birthdays: [{ id, name, birthday, day, group_id, group_name }] }`
  - Returns all birthdays for a specific month/year across user's groups

### Contribute to Birthday
- **POST** `/api/birthdays/contribute`
  - **Requires authentication**
  - Body: `{ groupId, birthdayUserId, amount? }` (amount optional, uses group default if not provided)
  - Returns: `{ message }`
  - Transfers money from contributor to birthday user
  - Both users must be active members of the group

---

## Transaction Endpoints (`/api/transactions`)

### Get Transaction History
- **GET** `/api/transactions/history`
  - **Requires authentication**
  - Query params: `type?` (credit/debit/contribution/birthday_gift), `groupId?`, `limit?` (default: 50), `offset?` (default: 0)
  - Returns: `{ transactions: [{ id, type, amount, description, status, created_at, group_id, group_name }], total, limit, offset }`

### Get Received History
- **GET** `/api/transactions/received`
  - **Requires authentication**
  - Query params: `limit?` (default: 50), `offset?` (default: 0)
  - Returns: `{ contributions: [{ id, amount, contribution_date, status, created_at, group_id, group_name, contributor_id, contributor_name }], total, limit, offset }`
  - Shows all birthday contributions received by the user

### Add Money to Wallet
- **POST** `/api/transactions/add-money`
  - **Requires authentication**
  - Body: `{ amount, reference? }`
  - Returns: `{ message, balance }`
  - Simulates bank transfer (in production, verify transfer first)

### Transfer Out
- **POST** `/api/transactions/transfer-out`
  - **Requires authentication**
  - Body: `{ amount, bankAccount, bankName?, accountName }`
  - Returns: `{ message, balance }`
  - Withdraws money from wallet (status: pending until processed)

---

## Admin Endpoints (`/api/admin`)

**All admin endpoints require admin authentication (user must have `is_admin = true`)**

### Get All Users
- **GET** `/api/admin/users`
  - **Requires admin authentication**
  - Query params: `page?` (default: 1), `limit?` (default: 50), `search?`, `is_verified?`, `is_admin?`
  - Returns: `{ users: [{ id, name, email, phone, birthday, is_verified, is_admin, created_at, wallet_balance, group_count }], pagination }`
  - Supports search by name, email, or phone
  - Supports filtering by verification status and admin status

### Get User by ID
- **GET** `/api/admin/users/:userId`
  - **Requires admin authentication**
  - Returns: `{ user: { id, name, email, phone, birthday, is_verified, is_admin, created_at, wallet_balance, ... }, groups: [...], transaction_count }`
  - Returns detailed user information including groups and transaction count

### Update User
- **PUT** `/api/admin/users/:userId`
  - **Requires admin authentication**
  - Body: `{ is_verified?, is_admin? }` (optional fields)
  - Returns: `{ message, user }`
  - Can verify users, set/remove admin status
  - Cannot remove own admin status

### Delete User
- **DELETE** `/api/admin/users/:userId`
  - **Requires admin authentication**
  - Returns: `{ message }`
  - Deletes user and all related records (cascade)
  - Cannot delete own account

### Get All Groups
- **GET** `/api/admin/groups`
  - **Requires admin authentication**
  - Query params: `page?` (default: 1), `limit?` (default: 50), `search?`
  - Returns: `{ groups: [{ id, name, invite_code, contribution_amount, max_members, currency, admin_name, admin_email, active_members, pending_members, created_at }], pagination }`
  - Supports search by group name, invite code, or admin name

### Get All Transactions
- **GET** `/api/admin/transactions`
  - **Requires admin authentication**
  - Query params: `page?` (default: 1), `limit?` (default: 50), `type?`, `status?`, `userId?`, `groupId?`
  - Returns: `{ transactions: [{ id, type, amount, description, status, reference, created_at, user_id, user_name, user_email, group_id, group_name }], pagination }`
  - Supports filtering by type, status, user, or group

### Get All Contributions
- **GET** `/api/admin/contributions`
  - **Requires admin authentication**
  - Query params: `page?` (default: 1), `limit?` (default: 50), `status?`, `groupId?`, `userId?`
  - Returns: `{ contributions: [{ id, amount, contribution_date, status, note, created_at, group_id, group_name, birthday_user_id, birthday_user_name, contributor_id, contributor_name }], pagination }`
  - Supports filtering by status, group, or user (birthday user or contributor)

### Get System Statistics
- **GET** `/api/admin/stats`
  - **Requires admin authentication**
  - Returns: `{ users: { total, verified, admins, recent_30_days }, groups: { total, active, recent_30_days }, transactions: { total, amounts: { total_credits, total_debits, total_contributions, total_birthday_gifts } }, contributions: { total, pending }, wallets: { total_balance } }`
  - Returns comprehensive system-wide statistics

### Get All Notifications
- **GET** `/api/admin/notifications`
  - **Requires admin authentication**
  - Query params: `page?` (default: 1), `limit?` (default: 50), `type?`, `is_read?`, `userId?`
  - Returns: `{ notifications: [{ id, type, title, message, is_read, created_at, user_id, user_name, user_email, group_id, group_name, related_user_id, related_user_name }], pagination }`
  - Supports filtering by type, read status, or user

---

## Authentication Header

For authenticated endpoints, include the JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

---

## Response Formats

### Success Response
```json
{
  "data": {...}
}
```

### Error Response
```json
{
  "error": "Error message"
}
```

### Validation Error Response
```json
{
  "errors": [
    {
      "msg": "Error message",
      "param": "field_name"
    }
  ]
}
```

---

## Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error
