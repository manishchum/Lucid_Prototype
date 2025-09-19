// Standalone version of migrate-processed-modules for VM worker
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function migrateProcessedModules() {
  const { data: modules, error } = await supabase
    .from('training_modules')
    .select('id, ai_modules');
  if (error) {
    throw new Error(error.message);
  }
  let inserted = 0;
  for (const mod of modules || []) {
    if (!mod.ai_modules) continue;
    let aiModulesArr;
    try {
      aiModulesArr = Array.isArray(mod.ai_modules)
        ? mod.ai_modules
        : JSON.parse(mod.ai_modules);
    } catch (e) {
      continue;
    }
    for (let i = 0; i < aiModulesArr.length; i++) {
      const aiMod = aiModulesArr[i];
      const { title, content, section_type } = aiMod;
      const learningStyles = ['CS', 'CR', 'AS', 'AR'];
      for (const style of learningStyles) {
        const { error: insertError } = await supabase
          .from('processed_modules')
          .insert({
            original_module_id: mod.id,
            title: title || `Module ${i + 1}`,
            content: content || '',
            section_type: section_type || null,
            order_index: i,
            learning_style: style,
          });
        if (!insertError) inserted++;
      }
    }
  }
  return { message: `Inserted ${inserted} processed modules.` };
}

module.exports = { migrateProcessedModules };
