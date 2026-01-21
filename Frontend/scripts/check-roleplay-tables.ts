import { supabase } from '../lib/supabase';

async function checkRoleplayTables() {
  console.log('🔍 Checking roleplay tables...\n');

  try {
    // Check roleplay_sessions
    const { data: sessions, error: sessionsError } = await supabase
      .from('roleplay_sessions')
      .select('count')
      .limit(1);

    if (sessionsError) {
      console.log('❌ roleplay_sessions table does NOT exist');
      console.log('   Error:', sessionsError.message);
    } else {
      console.log('✅ roleplay_sessions table EXISTS');
      
      const { count } = await supabase
        .from('roleplay_sessions')
        .select('*', { count: 'exact', head: true });
      console.log(`   Records: ${count || 0}`);
    }

    // Check roleplay_assessments
    const { data: assessments, error: assessmentsError } = await supabase
      .from('roleplay_assessments')
      .select('count')
      .limit(1);

    if (assessmentsError) {
      console.log('\n❌ roleplay_assessments table does NOT exist');
      console.log('   Error:', assessmentsError.message);
    } else {
      console.log('\n✅ roleplay_assessments table EXISTS');
      
      const { count } = await supabase
        .from('roleplay_assessments')
        .select('*', { count: 'exact', head: true });
      console.log(`   Records: ${count || 0}`);
    }

    if (sessionsError || assessmentsError) {
      console.log('\n📋 TO FIX:');
      console.log('Run this SQL in Supabase Dashboard > SQL Editor:');
      console.log('File: /Frontend/migrations/20260115_add_roleplay_sessions.sql');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkRoleplayTables();
