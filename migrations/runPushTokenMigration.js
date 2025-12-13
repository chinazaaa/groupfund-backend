const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runPushTokenMigration() {
  try {
    const migrationPath = path.join(__dirname, 'add_expo_push_token.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Running push token migration...');
    await pool.query(migration);
    console.log('✅ Push token migration completed successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error running push token migration:', error);
    process.exit(1);
  }
}

runPushTokenMigration();

