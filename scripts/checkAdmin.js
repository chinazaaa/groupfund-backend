const pool = require('../config/database');
require('dotenv').config();

async function checkAdmin() {
  try {
    const email = process.argv[2] || 'nazaalistic@gmail.com';
    
    const result = await pool.query(
      'SELECT email, is_admin, is_verified FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      console.log(`❌ User ${email} not found`);
      process.exit(1);
    }

    const user = result.rows[0];
    console.log(`User: ${user.email}`);
    console.log(`Admin: ${user.is_admin ? '✅ YES' : '❌ NO'}`);
    console.log(`Verified: ${user.is_verified ? '✅ YES' : '❌ NO'}`);
    
    if (!user.is_admin) {
      console.log('\n⚠️  User is not an admin. Run: node scripts/setAdmin.js ' + email);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkAdmin();

