const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runActiveStatusMigration() {
  try {
    const migrationPath = path.join(__dirname, 'add_user_active_status.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Running user active status migration...');
    await pool.query(migration);
    console.log('✅ User active status migration completed successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error running migration:', error.message);
    process.exit(1);
  }
}

runActiveStatusMigration();

