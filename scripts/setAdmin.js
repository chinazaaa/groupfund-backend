const pool = require('../config/database');
require('dotenv').config();

// Script to set a user as admin
// Usage: node scripts/setAdmin.js <user_email>

async function setAdmin() {
  try {
    const email = process.argv[2];

    if (!email) {
      console.error('❌ Please provide a user email');
      console.log('Usage: node scripts/setAdmin.js <user_email>');
      process.exit(1);
    }

    // First, run the migration to add is_admin field if it doesn't exist
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
      process.exit(1);
    }

    const user = userResult.rows[0];

    if (user.is_admin) {
      console.log(`ℹ️  User ${user.name} (${user.email}) is already an admin`);
      process.exit(0);
    }

    // Set user as admin
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [user.id]);

    console.log(`✅ Successfully set ${user.name} (${user.email}) as admin`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting admin:', error);
    process.exit(1);
  }
}

setAdmin();

