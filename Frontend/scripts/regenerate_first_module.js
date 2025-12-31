// Regenerate content for modules with NULL content
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etwmvrnlqemqtbkqepnb.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0d212cm5scWVtcXRia3FlcG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzAxMDI4MjIsImV4cCI6MjA0NTY3ODgyMn0.S5xVHzUb5H_zS7I1rVj8i8JKQZr8hc3GqLCVxKW7Bt0';

const supabase = createClient(supabaseUrl, supabaseKey);

async function findAndRegenerateNullModules() {
  try {
    // console.log('Finding modules with NULL content...');
    
    // Find modules with NULL content
    const { data: nullModules, error } = await supabase
      .from('processed_modules')
      .select('processed_module_id, title, original_module_id, content')
      .is('content', null)
      .limit(10);
    
    if (error) {
      console.error('Error fetching modules:', error);
      return;
    }
    
    if (!nullModules || nullModules.length === 0) {
      // console.log('✓ No modules with NULL content found!');
      
      // Check for empty string content too
      const { data: emptyModules } = await supabase
        .from('processed_modules')
        .select('processed_module_id, title, original_module_id, content')
        .eq('content', '')
        .limit(10);
      
      if (emptyModules && emptyModules.length > 0) {
        // console.log(`Found ${emptyModules.length} modules with empty content:`, emptyModules.map(m => m.title));
      }
      
      return;
    }
    
    // console.log(`Found ${nullModules.length} modules with NULL content:`);
    nullModules.forEach(m => {
      // console.log(`  - ${m.title} (ID: ${m.processed_module_id}, Original: ${m.original_module_id})`);
    });
    
    // console.log('\nRegenerating content via API...');
    
    const response = await fetch('http://localhost:3000/api/generate-module-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceRegenerate: false }) // Only regenerate NULL/empty
    });
    
    const data = await response.json();
    // console.log('\nResponse status:', response.status);
    // console.log('Response data:', JSON.stringify(data, null, 2));
    
    if (!response.ok) {
      console.error('❌ Error:', data);
    } else {
      // console.log('✓ Content regeneration complete!');
      
      // Verify the first module now has content
      // console.log('\nVerifying first module...');
      const { data: firstModule } = await supabase
        .from('processed_modules')
        .select('processed_module_id, title, content')
        .eq('processed_module_id', nullModules[0].processed_module_id)
        .single();
      
      if (firstModule && firstModule.content) {
        // console.log('✓ First module now has content! Length:', firstModule.content.length);
      } else {
        // console.log('❌ First module still has no content');
      }
    }
  } catch (error) {
    console.error('Failed:', error.message);
  }
}

findAndRegenerateNullModules();
