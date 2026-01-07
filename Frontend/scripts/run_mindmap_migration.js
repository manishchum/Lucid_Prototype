#!/usr/bin/env node

/**
 * Migration Script: Add mindmap_data column to processed_modules table
 * 
 * Usage: node scripts/run_mindmap_migration.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('🚀 Starting migration: Add mindmap_data column to processed_modules');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '../migrations/add_mindmap_data_to_processed_modules.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📝 SQL to execute:');
    console.log(migrationSQL);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Execute the migration
    const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      // If exec_sql function doesn't exist, we need to run it manually
      console.log('ℹ️  Direct SQL execution not available via Supabase client');
      console.log('');
      console.log('📋 Please run the migration manually:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      console.log('Option 1: Using Supabase Dashboard');
      console.log('  1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/editor');
      console.log('  2. Click on "SQL Editor" in the left sidebar');
      console.log('  3. Click "New Query"');
      console.log('  4. Copy and paste the SQL from:');
      console.log(`     ${migrationPath}`);
      console.log('  5. Click "Run" button');
      console.log('');
      console.log('Option 2: Using psql command line');
      console.log('  Run: psql YOUR_DATABASE_URL -f migrations/add_mindmap_data_to_processed_modules.sql');
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      return;
    }

    console.log('✅ Migration completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('Changes made:');
    console.log('  ✓ Added mindmap_data JSONB column to processed_modules table');
    console.log('  ✓ Created GIN index on mindmap_data for faster queries');
    console.log('  ✓ Added column documentation');
    console.log('');
    console.log('The mindmap data will now be cached in the database! 🎉');

  } catch (err) {
    console.error('❌ Error running migration:', err);
    console.log('');
    console.log('Please run the migration manually using Supabase Dashboard:');
    console.log('1. Go to SQL Editor in your Supabase dashboard');
    console.log('2. Copy the contents of: migrations/add_mindmap_data_to_processed_modules.sql');
    console.log('3. Paste and execute');
    process.exit(1);
  }
}

// Run the migration
runMigration();
