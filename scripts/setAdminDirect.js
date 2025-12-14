const { Pool } = require('pg');

// Script to set a user as admin using a direct database connection
// Usage: node scripts/setAdminDirect.js <database_url> <user_email>

async function setAdmin() {
  try {
    const databaseUrl = process.argv[2];
    const email = process.argv[3];

    if (!databaseUrl || !email) {
      console.error('❌ Please provide both database URL and user email');
      console.log('Usage: node scripts/setAdminDirect.js <database_url> <user_email>');
      process.exit(1);
    }

    // Create connection pool
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    });

    // First, ensure is_admin field exists
    console.log('Checking if is_admin field exists...');
    try {
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin)');
      console.log('✅ Admin field migration completed');
    } catch (error) {
      if (error.code !== '42P16') { // Column already exists
        throw error;
      }
    }

    // Check if user exists
    const userResult = await pool.query('SELECT id, name, email, is_admin FROM users WHERE email = $1', [email]);

    if (userResult.rows.length === 0) {
      console.error(`❌ User with email ${email} not found`);
      await pool.end();
      process.exit(1);
    }

    const user = userResult.rows[0];

    if (user.is_admin) {
      console.log(`ℹ️  User ${user.name} (${user.email}) is already an admin`);
      await pool.end();
      process.exit(0);
    }

    // Set user as admin
    await pool.query('UPDATE users SET is_admin = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    console.log(`✅ Successfully set ${user.name} (${user.email}) as admin`);
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting admin:', error.message);
    process.exit(1);
  }
}

setAdmin();
