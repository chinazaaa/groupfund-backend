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
  'add_multi_currency_wallet_balances.sql',
  'add_expo_push_token.sql',
  'add_international_payment_fields.sql',
  'add_notification_preferences.sql',
  'add_user_active_status.sql',
  'update_contribution_status.sql',
  'update_rejected_to_not_received.sql',
  'add_birthday_email_log.sql',
  'add_group_status.sql',
  'add_accepting_requests.sql',
  'add_wishlist.sql',
  'add_currency_to_wishlist.sql',
  'add_fulfilled_to_wishlist_claims.sql',
  'add_link_and_notes_to_wishlist.sql',
  'make_phone_nullable.sql',
  'add_group_types.sql',
  'add_subscription_contributions.sql',
  'add_general_contributions.sql',
  'allow_null_group_id_in_contributions.sql',
  'add_is_public_to_groups.sql',
  'add_notes_to_groups.sql',
  'add_reports.sql',
  'fix_reports_constraint.sql',
  'add_closed_reason_to_groups.sql',
  'add_chat_enabled_to_groups.sql',
  'add_group_messages.sql',
  'add_chat_notification_preferences.sql',
  'add_wishlist_enabled_to_groups.sql',
  'add_co_admin_role.sql',
  'add_payment_automation.sql',
  'fix_password_verification_token_length.sql',
  'add_user_payment_methods.sql',
  'add_currency_to_payment_methods.sql',
  'update_payment_methods_unique_constraint.sql',
  'add_currency_bank_accounts.sql',
  'add_email_preferences.sql',
  'add_inapp_push_notification_preferences.sql',
  'add_two_factor_authentication.sql'
];

async function runAllMigrations() {
  try {
    console.log('🚀 Starting database migrations...\n');
    
    for (const migration of migrations) {
      const migrationPath = path.join(__dirname, migration);
      
      if (!fs.existsSync(migrationPath)) {
        console.log(`⚠️  Skipping ${migration} (file not found)`);
        continue;
      }
      
      console.log(`📄 Running ${migration}...`);
      const sql = fs.readFileSync(migrationPath, 'utf8');
      
      try {
        await pool.query(sql);
        console.log(`✅ ${migration} completed successfully\n`);
      } catch (error) {
        // If it's a "already exists" error, that's okay for IF NOT EXISTS statements
        if (error.message.includes('already exists') || 
            error.message.includes('duplicate') ||
            error.code === '42P07' || // duplicate_table
            error.code === '42710') { // duplicate_object
          console.log(`ℹ️  ${migration} skipped (already applied)\n`);
        } else {
          throw error;
        }
      }
    }
    
    console.log('✅ All database migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error running migrations:', error);
    process.exit(1);
  }
}

runAllMigrations();
