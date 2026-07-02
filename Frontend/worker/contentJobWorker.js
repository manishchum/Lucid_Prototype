require('./env').loadWorkerEnv();

// Node.js worker script for processing content generation jobs
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Import local API functions to avoid Vercel timeouts
// console.log('Loading migrate-processed-modules...');
const { migrateProcessedModules } = require(path.join(__dirname, 'api/migrate-processed-modules'));
// console.log('Loading start-content-generation...');
// const { startContentGeneration } = require(path.join(__dirname, 'api/start-content-generation'));
// console.log('Loading generate-module-content...');
const { generateModuleContent } = require(path.join(__dirname, 'api/generate-module-content'));
// console.log('Loading generate-module-audio...');
const { generateModuleAudio } = require(path.join(__dirname, 'api/generate-module-audio'));
// console.log('Loading generate-module-video...');
const { generateModuleVideo } = require(path.join(__dirname, 'api/generate-module-video'));
// console.log('Loading generate-module-mindmap...');
const { generateModuleMindmap } = require(path.join(__dirname, 'api/generate-module-mindmap'));
// console.log('Loading generate-module-infographic...');
const { generateModuleInfographic } = require(path.join(__dirname, 'api/generate-module-infographic'));
// console.log('Loading generate-module-flashcards...');
const { generateModuleFlashcards } = require(path.join(__dirname, 'api/generate-module-flashcards'));
// console.log('All modules loaded successfully.');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE_URL = process.env.INTERNAL_API_BASE_URL;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Store initial content generation history for a completed module
 * @param {string} moduleId - The original module ID
 */
async function storeInitialContentHistory(moduleId) {
  try {
    // console.log(`[HISTORY] Storing initial content history for module_id=${moduleId}`);

    // Fetch all processed_modules for this original module
    const { data: processedModules, error: fetchError } = await supabase
      .from('processed_modules')
      .select('processed_module_id, content')
      .eq('original_module_id', moduleId);

    if (fetchError) {
      console.error(`[HISTORY] Failed to fetch processed modules for module_id=${moduleId}:`, fetchError);
      return { success: false, error: fetchError };
    }

    if (!processedModules || processedModules.length === 0) {
      // console.log(`[HISTORY] No processed modules found for module_id=${moduleId}`);
      return { success: true, inserted: 0 };
    }

    // console.log(`[HISTORY] Found ${processedModules.length} processed modules to store`);

    // Prepare history entries
    const historyEntries = processedModules.map(pm => ({
      processed_module_id: pm.processed_module_id,
      content: pm.content,
      original_module_id: moduleId,
      status: 'initial'
    }));

    // Insert all history entries in batch
    const { data: insertedData, error: insertError } = await supabase
      .from('content_generation_history')
      .insert(historyEntries)
      .select('content_generation_history_id');

    if (insertError) {
      console.error(`[HISTORY] Failed to insert content history for module_id=${moduleId}:`, insertError);
      return { success: false, error: insertError };
    }

    // console.log(`[HISTORY] Successfully stored ${insertedData?.length || 0} initial content history entries for module_id=${moduleId}`);
    return { success: true, inserted: insertedData?.length || 0 };
  } catch (err) {
    console.error(`[HISTORY] Unexpected error storing content history for module_id=${moduleId}:`, err);
    return { success: false, error: err };
  }
}

async function getCompanySubscriptionAddonsForModule(moduleId) {
  const { data: trainingModule, error: trainingModuleError } = await supabase
    .from('training_modules')
    .select('company_id')
    .eq('module_id', moduleId)
    .single();

  if (trainingModuleError || !trainingModule?.company_id) {
    throw new Error(`Failed to resolve company for module_id=${moduleId}: ${trainingModuleError?.message || 'no training module or company_id found'}`);
  }

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('subscription_addons')
    .eq('company_id', trainingModule.company_id)
    .single();

  if (companyError) {
    throw new Error(`Failed to fetch company addons for company_id=${trainingModule.company_id}: ${companyError.message}`);
  }

  const rawAddons = Array.isArray(company?.subscription_addons) ? company.subscription_addons : [];
  return Array.from(new Set(rawAddons
    .map((addon) => String(addon || '').trim().toLowerCase().replace(/[-\s]+/g, '_'))
    .filter(Boolean)
  ));
}

async function runModuleGenerators(moduleId, enabledAddonSet) {
  const tasks = [
    { name: 'podcast', generator: generateModuleAudio, addon: 'lucid_studio_podcast' },
    { name: 'video', generator: generateModuleVideo, addon: 'lucid_studio_video' },
    { name: 'mindmap', generator: generateModuleMindmap, addon: 'lucid_studio_mindmap' },
    { name: 'infographic', generator: generateModuleInfographic, addon: 'lucid_studio_infographic' },
    { name: 'flashcards', generator: generateModuleFlashcards, addon: 'lucid_studio_flashcards' },
  ];

  const enabledTasks = tasks.filter((task) => enabledAddonSet.has(task.addon));

  if (enabledTasks.length === 0) {
    console.log(`[JOB] No enabled Lucid Studio derived generation tasks for module_id=${moduleId}. Skipping derived asset generation.`);
    return { ok: true, skipped: true, reason: 'No enabled lucid studio addons' };
  }

  const failures = [];

  for (const task of enabledTasks) {
    try {
      console.log(`[JOB] Running ${task.name} generation for module_id=${moduleId}`);
      const result = await task.generator({ moduleId });
      console.log(`[JOB] ${task.name} generation completed for module_id=${moduleId}:`, result);
    } catch (error) {
      failures.push({ name: task.name, error });
      console.error(`[JOB] ${task.name} generation failed for module_id=${moduleId}:`, error);
    }
  }

  if (failures.length > 0) {
    const failureSummary = failures.map(({ name, error }) => `${name}: ${error?.message || error}`).join(' | ');
    throw new Error(`One or more media generators failed for module_id=${moduleId}: ${failureSummary}`);
  }
}

async function processJobs() {
  // console.log('Worker started. Polling for jobs every 5 seconds...');
  while (true) {
    // console.log('Polling for pending jobs...');
    const { data: jobs, error } = await supabase
      .from('content_jobs')
      .select('id, module_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('Supabase job fetch error:', error);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    if (jobs && jobs.length > 0) {
      const job = jobs[0];
      // console.log(`[JOB] Found pending job: id=${job.id}, module_id=${job.module_id}`);
      // Mark as in-progress
      const { error: updateError } = await supabase.from('content_jobs').update({ status: 'in-progress', updated_at: new Date() }).eq('id', job.id);
      if (updateError) {
        console.error(`[JOB] Failed to mark job in-progress: id=${job.id}`, updateError);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      try {
        const companyAddons = await getCompanySubscriptionAddonsForModule(job.module_id);
        const enabledAddonSet = new Set(companyAddons);

        // If the company has no Lucid Studio related addons enabled, skip the job entirely.
        const lucidStudioAddonKeys = [
          'lucid_studio_textual',
          'lucid_studio_podcast',
          'lucid_studio_video',
          'lucid_studio_mindmap',
          'lucid_studio_infographic',
          'lucid_studio_flashcards',
        ];

        const hasLucidStudioAccess = lucidStudioAddonKeys.some((addon) => enabledAddonSet.has(addon));

        if (!hasLucidStudioAccess) {
          console.log(`[JOB] Company for module_id=${job.module_id} has no enabled Lucid Studio addons. Skipping entire job.`);
          await supabase.from('content_jobs').update({ status: 'completed', updated_at: new Date() }).eq('id', job.id);
          continue;
        }

        console.log(`[JOB] Running migration for module_id=${job.module_id}`);
        const migrateResult = await migrateProcessedModules({ moduleId: job.module_id });
        console.log(migrateResult);
        console.log(`[JOB] Migration completed:`, migrateResult.message);

        // console.log(`[JOB] Running content generation for module_id=${job.module_id}`);
        const genResult = await generateModuleContent({ moduleId: job.module_id });
        // console.log(`[JOB] Content generation completed:`, genResult.message);

        // Store initial content history after successful text generation
        // console.log(`[JOB] Storing initial content history for module_id=${job.module_id}`);
        const historyResult = await storeInitialContentHistory(job.module_id);
        if (historyResult.success) {
          // console.log(`[JOB] Content history stored: ${historyResult.inserted} entries`);
        } else {
          console.error(`[JOB] Failed to store content history, but job will continue:`, historyResult.error);
        }

        // Generate all derived assets for this specific module before completing the job.
        try{
          await runModuleGenerators(job.module_id);
        }catch(e){
          // console.log(e)
        }
        await supabase.from('content_jobs').update({ status: 'completed', updated_at: new Date() }).eq('id', job.id);
        // console.log(`[JOB] Job completed: id=${job.id}, module_id=${job.module_id}`);
      } catch (err) {
        await supabase.from('content_jobs').update({ status: 'failed', updated_at: new Date() }).eq('id', job.id);
        console.error(`[JOB] Job failed: id=${job.id}, module_id=${job.module_id}`, err);
      }
    } else {
      // console.log('No pending jobs found.');
    }
    await new Promise(r => setTimeout(r, 5000)); // Poll every 5 seconds
  }
}

processJobs();