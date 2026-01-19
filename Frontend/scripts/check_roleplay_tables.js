// Script to check if roleplay tables exist in Supabase
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in environment variables');
  console.log('Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkTables() {
  console.log('🔍 Checking if roleplay tables exist...\n');

  try {
    // Try to query roleplay_sessions table
    const { data: sessions, error: sessionsError } = await supabase
      .from('roleplay_sessions')
      .select('count')
      .limit(1);

    if (sessionsError) {
      if (sessionsError.code === '42P01') {
        console.log('❌ Table "roleplay_sessions" does NOT exist');
        console.log('   Run the migration in Supabase SQL Editor:');
        console.log('   /Frontend/migrations/20260115_add_roleplay_sessions.sql\n');
      } else {
        console.log('⚠️ Error checking roleplay_sessions:', sessionsError.message);
      }
    } else {
      console.log('✅ Table "roleplay_sessions" EXISTS');
    }

    // Try to query roleplay_assessments table
    const { data: assessments, error: assessmentsError } = await supabase
      .from('roleplay_assessments')
      .select('count')
      .limit(1);

    if (assessmentsError) {
      if (assessmentsError.code === '42P01') {
        console.log('❌ Table "roleplay_assessments" does NOT exist');
        console.log('   Run the migration in Supabase SQL Editor:');
        console.log('   /Frontend/migrations/20260115_add_roleplay_sessions.sql\n');
      } else {
        console.log('⚠️ Error checking roleplay_assessments:', assessmentsError.message);
      }
    } else {
      console.log('✅ Table "roleplay_assessments" EXISTS');
    }

    // If both tables exist, count records
    if (!sessionsError && !assessmentsError) {
      const { count: sessionCount } = await supabase
        .from('roleplay_sessions')
        .select('*', { count: 'exact', head: true });

      const { count: assessmentCount } = await supabase
        .from('roleplay_assessments')
        .select('*', { count: 'exact', head: true });

      console.log(`\n📊 Database Status:`);
      console.log(`   - Sessions: ${sessionCount || 0}`);
      console.log(`   - Assessments: ${assessmentCount || 0}`);
    }

    console.log('\n✨ Check complete!');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkTables();
