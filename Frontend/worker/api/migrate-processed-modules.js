// Standalone version of migrate-processed-modules for VM worker
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function migrateProcessedModules({ moduleId = null, forceRemigrate = false } = {}) {
  // Fetch training modules (optionally limited)
  let tmQuery = supabase.from('training_modules').select('id, ai_modules');
  if (moduleId) tmQuery = tmQuery.eq('id', moduleId);
  const { data: modules, error: tmError } = await tmQuery;
  if (tmError) throw new Error(tmError.message);
  if (!modules || modules.length === 0) return { message: 'No training modules found', inserted: 0, skipped: 0 };

  // Optional hard reset for a single module
  if (forceRemigrate && moduleId) {
    await supabase.from('processed_modules').delete().eq('original_module_id', moduleId);
  }

  let inserted = 0;
  let skipped = 0;
  for (const mod of modules) {
    if (!mod.ai_modules) continue;
    let aiModulesArr = [];
    try {
      aiModulesArr = Array.isArray(mod.ai_modules) ? mod.ai_modules : JSON.parse(mod.ai_modules);
    } catch { continue; }

    // Preload existing rows for this original module id
    const { data: existingRows } = await supabase
      .from('processed_modules')
      .select('order_index, learning_style')
      .eq('original_module_id', mod.id);
    const existingSet = new Set((existingRows || []).map(r => `${r.order_index}|${r.learning_style}`));

    for (let i = 0; i < aiModulesArr.length; i++) {
      const aiMod = aiModulesArr[i] || {};
      const { title, content, section_type } = aiMod;
      for (const style of ['CS', 'CR', 'AS', 'AR']) {
        const key = `${i}|${style}`;
        if (existingSet.has(key) && !forceRemigrate) { skipped++; continue; }
        const { error: insertError } = await supabase.from('processed_modules').insert({
          original_module_id: mod.id,
          title: title || `Module ${i + 1}`,
          content: content || '',
          section_type: section_type || null,
          order_index: i,
          learning_style: style,
        });
        if (!insertError) { inserted++; existingSet.add(key); }
      }
    }
  }
  return { message: `Migration done: inserted=${inserted}, skipped=${skipped}`, inserted, skipped };
}

module.exports = { migrateProcessedModules };
