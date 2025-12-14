# Setting Up Database on Render

This guide will help you set up your PostgreSQL database on Render and run all necessary migrations.

## Step 1: Create a PostgreSQL Database on Render

1. Log in to your [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** button
3. Select **"PostgreSQL"**
4. Configure your database:
   - **Name**: `groupfund-db` (or any name you prefer)
   - **Database**: `groupfund` (or your preferred database name)
   - **User**: Will be auto-generated (or you can specify)
   - **Region**: Choose the region closest to your backend service
   - **PostgreSQL Version**: Use the latest stable version
   - **Plan**: Choose based on your needs (Free tier available for testing)

5. Click **"Create Database"**

## Step 2: Get Your Database Connection Details

Once your database is created:

1. Go to your database dashboard on Render
2. Find the **"Connections"** section
3. You'll see:
   - **Internal Database URL** (for services in the same region)
   - **External Database URL** (for connections outside Render)
   - Individual connection details:
     - `Host`
     - `Port`
     - `Database`
     - `User`
     - `Password`

## Step 3: Update Environment Variables in Your Backend Service

1. Go to your backend service on Render
2. Navigate to **"Environment"** tab
3. Add or update these environment variables:

```env
# Database Configuration (use the values from Step 2)
DB_HOST=<your-database-host>
DB_PORT=5432
DB_NAME=groupfund
DB_USER=<your-database-user>
DB_PASSWORD=<your-database-password>

# Or use the full connection string (alternative method)
# DATABASE_URL=<your-external-database-url>

# Server Configuration
PORT=3000
NODE_ENV=production

# JWT Configuration
JWT_SECRET=<your-super-secret-jwt-key-change-this>
JWT_EXPIRES_IN=10000d

# OTP Configuration
OTP_EXPIRY_MINUTES=10

# Resend Email Configuration
RESEND_API_KEY=<your-resend-api-key>
EMAIL_FROM=GroupFund <onboarding@resend.dev>

# Frontend URL (for CORS)
FRONTEND_URL=<your-frontend-url>

# Optional: Expo Push Notifications
# EXPO_ACCESS_TOKEN=<your-expo-access-token>

# Optional: Migration Secret Token (for API-based migrations)
# MIGRATION_SECRET_TOKEN=<generate-a-secure-token>
```

**Important Notes:**
- Use the **External Database URL** if your backend is on a different platform
- Use the **Internal Database URL** if your backend is also on Render (more secure and faster)
- If using `DATABASE_URL`, you may need to update `config/database.js` to parse it
- Make sure `JWT_SECRET` is a strong, random string
- Update `FRONTEND_URL` to your production frontend URL

## Step 4: Run Database Migrations

**Note:** If you're on Render's free tier, Shell access is not available. Use one of the options below.

### Option A: Using Build Command (Recommended for Free Tier)

Add migrations to your build command so they run automatically on each deploy:

1. Go to your backend service settings on Render
2. Find **"Build Command"** field
3. Set it to:
   ```bash
   npm install && npm run migrate:all
   ```
4. Click **"Save Changes"**
5. Trigger a new deploy (push a commit or manually redeploy)
6. Migrations will run automatically during the build (safe due to `IF NOT EXISTS` clauses)

### Option B: Using Migration API Endpoint (For Free Tier)

Run migrations via an API call:

1. **First, set a migration secret token** in your Render environment variables:
   ```env
   MIGRATION_SECRET_TOKEN=your-secret-token-here
   ```
   Generate a secure token:
   ```bash
   openssl rand -base64 32
   ```

2. **Deploy your code** (the migration endpoint is now available)

3. **Call the migration endpoint** using curl or Postman:
   ```bash
   curl -X POST https://groupfund-backend.onrender.com/api/migrations/run \
     -H "Content-Type: application/json" \
     -H "x-migration-token: your-secret-token-here" \
     -d '{}'
   ```

4. **Check migration status**:
   ```bash
   curl https://groupfund-backend.onrender.com/api/migrations/status
   ```

**Security Note:** After running migrations, you can remove the migration endpoint or keep it secured with the token for future use.

### Option C: Run from Local Machine (For Free Tier)

Connect to your Render database from your local machine:

1. **Get your External Database URL** from Render database dashboard
2. **Set it locally** (temporarily in your `.env`):
   ```env
   DATABASE_URL=<your-external-database-url>
   ```
3. **Run migrations locally**:
   ```bash
   npm run migrate:all
   ```
4. **Remove the DATABASE_URL** from local `.env` after migrations complete

### Option D: Using Render Shell (Paid Plans Only)

If you upgrade to a paid plan with Shell access:

1. Go to your backend service on Render
2. Click on **"Shell"** tab
3. Run the migration command:
   ```bash
   npm run migrate:all
   ```

## Step 5: Verify Database Setup

1. In Render Shell, you can verify tables were created:
   ```bash
   # If you have psql installed in the shell
   psql $DATABASE_URL -c "\dt"
   ```

2. Or check your application logs to see if the connection is successful

## Step 6: Set Up Admin User (Optional)

Once your database is set up, you can create an admin user:

1. Use Render Shell or connect to your database
2. Run:
   ```bash
   node scripts/setAdmin.js <admin-email>
   ```

## Troubleshooting

### Connection Issues

- **"Connection refused"**: Make sure you're using the correct host and port
- **"Authentication failed"**: Double-check your username and password
- **"Database does not exist"**: Verify the database name matches what you created

### Migration Issues

- **"relation already exists"**: This is normal if migrations were already run. The script handles this gracefully.
- **"permission denied"**: Make sure your database user has CREATE privileges

### Using Internal vs External URL

- **Internal URL**: Faster, more secure, only works if both services are on Render
- **External URL**: Works from anywhere, but requires SSL and may be slower

If using the internal URL, your connection string format is:
```
postgresql://user:password@hostname:5432/database_name
```

## Security Best Practices

1. ✅ Never commit `.env` files to git
2. ✅ Use strong, unique passwords for your database
3. ✅ Use environment variables for all sensitive data
4. ✅ Enable SSL connections (Render does this by default)
5. ✅ Regularly rotate your JWT_SECRET
6. ✅ Use the internal database URL when possible (if both services are on Render)

## Next Steps

After setting up your database:

1. ✅ Test your API endpoints
2. ✅ Verify authentication is working
3. ✅ Test database operations (create user, create group, etc.)
4. ✅ Set up monitoring and logging
5. ✅ Configure backups (Render provides automatic backups on paid plans)

## Need Help?

- Check Render's [PostgreSQL documentation](https://render.com/docs/databases)
- Review your application logs in Render dashboard
- Verify all environment variables are set correctly
