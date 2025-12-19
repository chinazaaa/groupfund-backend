const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');

// List of migrations in order
const migrations = [
  'schema.sql',
  'add_admin_field.sql',
  'add_contact_submissions.sql',
  'add_waitlist.sql',
  'add_beta_email_sent_to_waitlist.sql',
  'add_currency_to_groups.sql',
  'add_expo_push_token.sql',
  'add_international_payment_fields.sql',
  'add_notification_preferences.sql',
  'add_user_active_status.sql',
  'update_contribution_status.sql',
  'update_rejected_to_not_received.sql',
  'add_birthday_email_log.sql',
  'add_group_status.sql',
  'add_accepting_requests.sql',
  'add_wishlist.sql'
];

// Migration endpoint - SECURE THIS IN PRODUCTION!
// Add authentication or a secret token
router.post('/run', async (req, res) => {
  try {
    // SECURITY: Add a secret token check (recommended)
    const secretToken = req.headers['x-migration-token'] || req.body.token;
    const expectedToken = process.env.MIGRATION_SECRET_TOKEN;
    
    if (expectedToken && secretToken !== expectedToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const results = [];
    console.log('🚀 Starting database migrations via API...\n');
    
    for (const migration of migrations) {
      const migrationPath = path.join(__dirname, '..', 'migrations', migration);
      
      if (!fs.existsSync(migrationPath)) {
        results.push({ migration, status: 'skipped', message: 'File not found' });
        continue;
      }
      
      console.log(`📄 Running ${migration}...`);
      const sql = fs.readFileSync(migrationPath, 'utf8');
      
      try {
        await pool.query(sql);
        results.push({ migration, status: 'success' });
        console.log(`✅ ${migration} completed successfully\n`);
      } catch (error) {
        // If it's a "already exists" error, that's okay for IF NOT EXISTS statements
        if (error.message.includes('already exists') || 
            error.message.includes('duplicate') ||
            error.code === '42P07' || // duplicate_table
            error.code === '42710') { // duplicate_object
          results.push({ migration, status: 'skipped', message: 'Already applied' });
          console.log(`ℹ️  ${migration} skipped (already applied)\n`);
        } else {
          results.push({ migration, status: 'error', error: error.message });
          console.error(`❌ ${migration} failed:`, error.message);
        }
      }
    }
    
    const successCount = results.filter(r => r.status === 'success').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    res.json({
      message: 'Migrations completed',
      summary: {
        total: results.length,
        success: successCount,
        skipped: skippedCount,
        errors: errorCount
      },
      results
    });
  } catch (error) {
    console.error('❌ Error running migrations:', error);
    res.status(500).json({ error: 'Server error during migrations', message: error.message });
  }
});

// Health check for migrations
router.get('/status', async (req, res) => {
  try {
    // Check if key tables exist
    const tables = ['users', 'groups', 'wallets', 'transactions'];
    const status = {};
    
    for (const table of tables) {
      try {
        const result = await pool.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )`,
          [table]
        );
        status[table] = result.rows[0].exists;
      } catch (error) {
        status[table] = false;
      }
    }
    
    res.json({
      database_connected: true,
      tables: status,
      all_tables_exist: Object.values(status).every(exists => exists === true)
    });
  } catch (error) {
    res.status(500).json({
      database_connected: false,
      error: error.message
    });
  }
});

module.exports = router;
