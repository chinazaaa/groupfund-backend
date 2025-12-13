const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runAdminMigration() {
  try {
    const migrationPath = path.join(__dirname, 'add_admin_field.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Running admin field migration...');
    await pool.query(migration);
    console.log('✅ Admin field migration completed successfully!');
    
    // Verify the migration
    const result = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'is_admin'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Verified: is_admin column exists in users table');
      console.log(`   Type: ${result.rows[0].data_type}, Default: ${result.rows[0].column_default}`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error running migration:', error.message);
    process.exit(1);
  }
}

runAdminMigration();

