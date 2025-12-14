# GroupFund Backend API

Node.js and PostgreSQL backend for the GroupFund mobile application.

## Features

- **Authentication**: Signup, login, OTP verification, password reset
- **User Management**: Profile management, wallet management
- **Groups**: Create groups, join groups, manage group settings
- **Members**: Member management, approval system
- **Birthdays**: Track birthdays, upcoming birthdays, calendar view
- **Transactions**: Add money, transfer out, transaction history
- **Contributions**: Birthday contribution system

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a `.env` file** in the backend directory:
   ```env
   PORT=3000
   NODE_ENV=development
   
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=groupfund
   DB_USER=postgres
   DB_PASSWORD=your_password_here
   
   JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
   JWT_EXPIRES_IN=10000d
   
   RESEND_API_KEY=your_resend_api_key_here
   EMAIL_FROM=GroupFund <onboarding@resend.dev>
   
   FRONTEND_URL=
   ```

3. **Create PostgreSQL database:**
   ```bash
   createdb groupfund
   ```

4. **Run migrations:**
   ```bash
   npm run migrate
   # Also run the admin migration
   psql -d groupfund -f migrations/add_admin_field.sql
   ```

5. **Set up an admin user:**
   ```bash
   node scripts/setAdmin.js <user_email>
   ```

6. **Start the server:**
   ```bash
   # Development mode (with nodemon)
   npm run dev
   
   # Production mode
   npm start
   ```

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create new user account
- `POST /api/auth/verify-otp` - Verify OTP code
- `POST /api/auth/resend-otp` - Resend OTP
- `POST /api/auth/login` - Login user
- `POST /api/auth/forgot-password` - Request password reset OTP
- `POST /api/auth/reset-password` - Reset password with OTP
- `POST /api/auth/change-password` - Change password (authenticated)

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile
- `GET /api/users/wallet` - Get wallet balance

### Groups
- `POST /api/groups/create` - Create a new group
- `POST /api/groups/join` - Join a group by invite code
- `GET /api/groups/my-groups` - Get user's groups
- `GET /api/groups/:groupId` - Get group details
- `PUT /api/groups/:groupId` - Update group settings (admin only)

### Members
- `GET /api/members/group/:groupId` - Get group members
- `POST /api/members/:memberId/approve` - Approve/reject member (admin only)
- `DELETE /api/members/:memberId` - Remove member (admin only)
- `POST /api/members/leave` - Leave a group

### Birthdays
- `GET /api/birthdays/upcoming` - Get upcoming birthdays
- `GET /api/birthdays/:userId` - Get birthday details
- `GET /api/birthdays/calendar/:year/:month` - Get calendar view
- `POST /api/birthdays/contribute` - Contribute to a birthday

### Transactions
- `GET /api/transactions/history` - Get transaction history
- `GET /api/transactions/received` - Get received contributions
- `POST /api/transactions/add-money` - Add money to wallet
- `POST /api/transactions/transfer-out` - Transfer money out

### Admin (Admin only - requires admin authentication)
- `GET /api/admin/users` - Get all users (with pagination, search, filters)
- `GET /api/admin/users/:userId` - Get user details by ID
- `PUT /api/admin/users/:userId` - Update user (verify, set admin status)
- `DELETE /api/admin/users/:userId` - Delete user
- `GET /api/admin/groups` - Get all groups (with pagination, search)
- `GET /api/admin/transactions` - Get all transactions (with filters)
- `GET /api/admin/contributions` - Get all contributions (with filters)
- `GET /api/admin/notifications` - Get all notifications (with filters)
- `GET /api/admin/stats` - Get system statistics

## Database Schema

The database includes the following tables:
- `users` - User accounts
- `otps` - OTP codes for verification
- `groups` - Birthday groups
- `group_members` - Group membership
- `wallets` - User wallets
- `transactions` - Transaction history
- `birthday_contributions` - Birthday contributions

## Authentication

Most endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

Admin endpoints require both authentication and admin privileges. Users must have `is_admin = true` in the database.

## Error Handling

All errors are returned in the following format:
```json
{
  "error": "Error message"
}
```

Validation errors:
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

## Development

- Use `npm run dev` for development with auto-reload
- Use `npm run migrate` to run database migrations
- Check logs in the console for debugging

## Push Notifications Setup

This backend uses Expo push notifications. To enable push notifications, especially for Android devices (which require FCM):

### For Development
- Push notifications work out of the box for iOS and Android in development mode
- No additional configuration needed

### For Production (Android/FCM)
1. **Enable Firebase Cloud Messaging API (Legacy):**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Make sure your Firebase project is selected
   - Go to "APIs & Services" → "Library"
   - Search for "Firebase Cloud Messaging API"
   - Click on it and click "Enable"
   - Also search for "Firebase Cloud Messaging API (Legacy)" and enable it if available

2. **Get your FCM Server Key:**
   - Go back to [Firebase Console](https://console.firebase.google.com/)
   - Select your project
   - Go to Project Settings (gear icon) → Cloud Messaging tab
   - Under "Cloud Messaging API (Legacy)" section, you should now see the "Server key"
   - Copy the "Server key" (not the Sender ID)

3. **Configure FCM in Expo:**
   - Go to [Expo Dashboard](https://expo.dev)
   - Navigate to your project
   - Go to Credentials → Android
   - Add your FCM Server Key
   - Alternatively, you can use the Expo CLI:
     ```bash
     expo push:android:upload --api-key YOUR_FCM_SERVER_KEY
     ```

3. **Optional: Add Expo Access Token (Recommended):**
   - Go to [Expo Account Settings](https://expo.dev/accounts/[your-account]/settings/access-tokens)
   - Create a new access token
   - Add it to your `.env` file as `EXPO_ACCESS_TOKEN`

**Note:** The FCM server key must be configured in your Expo project dashboard, not in the backend code. The backend only needs the `EXPO_ACCESS_TOKEN` (optional but recommended for production).

## Production Considerations

- Use environment variables for all sensitive data
- Set up proper CORS configuration
- Use HTTPS
- Set up proper email service (currently using Resend)
- Set up SMS service for OTP (currently placeholder)
- Implement rate limiting
- Add request validation and sanitization
- Set up proper logging
- Use connection pooling for database
- Implement proper error tracking
- Configure FCM server key in Expo dashboard for Android push notifications
