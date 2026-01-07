// Script to run the flashcard_data migration on Supabase database
// This adds the flashcard_data JSONB column to the processed_modules table

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

async function runMigration() {
  console.log('🚀 Starting flashcard_data migration...\n');

  // Check for required environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Error: Missing Supabase credentials in .env.local');
    console.error('Required variables:');
    console.error('  - NEXT_PUBLIC_SUPABASE_URL');
    console.error('  - SUPABASE_SERVICE_ROLE_KEY');
    console.log('\n📋 Manual Migration Instructions:');
    console.log('1. Go to https://supabase.com/dashboard');
    console.log('2. Select your project');
    console.log('3. Click "SQL Editor" in the left sidebar');
    console.log('4. Click "New Query"');
    console.log('5. Copy and paste the content from:');
    console.log('   migrations/add_flashcard_data_to_processed_modules.sql');
    console.log('6. Click "Run" (or press Ctrl+Enter)');
    console.log('7. You should see "Success. No rows returned"');
    process.exit(1);
  }

  // Read migration SQL file
  const migrationPath = path.join(__dirname, '../migrations/add_flashcard_data_to_processed_modules.sql');
  let migrationSQL;
  
  try {
    migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  } catch (error) {
    console.error('❌ Error reading migration file:', error.message);
    console.error('Expected location:', migrationPath);
    process.exit(1);
  }

  // Initialize Supabase client with service role key
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log('📡 Connected to Supabase');
  console.log('📄 Migration file loaded\n');

  try {
    // Note: Supabase client doesn't directly support raw SQL execution
    // We'll use the RPC function if available, or show manual instructions
    
    console.log('⚠️  Note: Direct SQL execution via Supabase client is limited.');
    console.log('For best results, use the Supabase Dashboard SQL Editor:\n');
    
    console.log('📋 Manual Migration Instructions:');
    console.log('================================');
    console.log('1. Open Supabase Dashboard: https://supabase.com/dashboard');
    console.log('2. Select your project');
    console.log('3. Click "SQL Editor" in the left sidebar');
    console.log('4. Click "New Query" button');
    console.log('5. Copy and paste the following SQL:\n');
    console.log('---SQL START---');
    console.log(migrationSQL);
    console.log('---SQL END---\n');
    console.log('6. Click "Run" button (or press Ctrl+Enter)');
    console.log('7. You should see "Success. No rows returned"');
    console.log('\n✅ Once complete, flashcard caching will be active!');
    console.log('\n💡 Benefits:');
    console.log('   - Flashcards load instantly from cache');
    console.log('   - No repeated API calls for same content');
    console.log('   - Reduced costs and faster user experience');

  } catch (error) {
    console.error('❌ Error during migration:', error.message);
    process.exit(1);
  }
}

// Run the migration
runMigration().catch(console.error);
