const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runAcceptingRequestsMigration() {
  try {
    const migrationPath = path.join(__dirname, 'add_accepting_requests.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Running accepting_requests migration...');
    await pool.query(migration);
    console.log('✅ Accepting requests migration completed successfully!');
    
    // Verify the migration
    const result = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'groups' AND column_name = 'accepting_requests'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Verified: accepting_requests column exists in groups table');
      console.log(`   Type: ${result.rows[0].data_type}, Default: ${result.rows[0].column_default}`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error running migration:', error.message);
    process.exit(1);
  }
}

runAcceptingRequestsMigration();

