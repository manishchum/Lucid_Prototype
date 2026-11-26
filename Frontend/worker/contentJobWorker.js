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
const { generateModuleGamification } = require(path.join(__dirname, 'api/generate-module-gamification'));
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

async function runModuleGenerators(moduleId, enabledAddonSet, maxMultimodalModules = null) {
  const tasks = [
    { name: 'podcast', generator: generateModuleAudio, addon: 'lucid_studio_podcast' },
    { name: 'video', generator: generateModuleVideo, addon: 'lucid_studio_video' },
    { name: 'mindmap', generator: generateModuleMindmap, addon: 'lucid_studio_mindmap' },
    { name: 'infographic', generator: generateModuleInfographic, addon: 'lucid_studio_infographic' },
    { name: 'flashcards', generator: generateModuleFlashcards, addon: 'lucid_studio_flashcard' },
    { name: 'gamification', generator: generateModuleGamification, addon: 'gamification' },
  ];

  const enabledTasks = tasks.filter((task) =>
    enabledAddonSet.has(task.addon) ||
    (task.addon === 'lucid_studio_flashcard' && enabledAddonSet.has('lucid_studio_flashcards'))
  );

  if (enabledTasks.length === 0) {
    console.log(`[JOB] No enabled Lucid Studio derived generation tasks for module_id=${moduleId}. Skipping derived asset generation.`);
    return { ok: true, skipped: true, reason: 'No enabled lucid studio addons' };
  }

  const failures = [];

  for (const task of enabledTasks) {
    try {
      console.log(`[JOB] Running ${task.name} generation for module_id=${moduleId}${maxMultimodalModules ? ` (capped at ${maxMultimodalModules} modules)` : ''}`);
      const result = await task.generator({ moduleId, maxModules: maxMultimodalModules });
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

const MIN_POLL_MS = Number(process.env.CONTENT_WORKER_MIN_POLL_MS || 5000);
const MAX_POLL_MS = Number(process.env.CONTENT_WORKER_MAX_POLL_MS || 120000);

async function processJobs() {
  console.log(`[WORKER] 🚀 contentJobWorker started. Connected to Supabase. Polling for pending jobs with exponential backoff (${MIN_POLL_MS / 1000}s to ${MAX_POLL_MS / 1000}s)...`);
  let idlePollCount = 0;

  while (true) {
    const { data: jobs, error } = await supabase
      .from('content_jobs')
      .select('id, module_id, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('[WORKER] ❌ Supabase job fetch error:', error);
      idlePollCount++;
      const backoff = Math.min(MIN_POLL_MS * Math.pow(2, idlePollCount), MAX_POLL_MS);
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }

    if (jobs && jobs.length > 0) {
      idlePollCount = 0;
      const job = jobs[0];
      console.log(`\n============================================================`);
      console.log(`[WORKER] 📥 Found pending job: id=${job.id}, module_id=${job.module_id} (created at ${job.created_at})`);
      
      // Mark as in-progress
      const { error: updateError } = await supabase
        .from('content_jobs')
        .update({ status: 'in-progress', updated_at: new Date() })
        .eq('id', job.id);

      if (updateError) {
        console.error(`[WORKER] ❌ Failed to mark job in-progress: id=${job.id}`, updateError);
        await new Promise(r => setTimeout(r, MIN_POLL_MS));
        continue;
      }
      console.log(`[WORKER] ⏳ Successfully marked job id=${job.id} as 'in-progress' in DB`);

      try {
        console.log(`[WORKER] 🔄 [1/4] Running migrateProcessedModules for module_id=${job.module_id}...`);
        const migrateResult = await migrateProcessedModules({ moduleId: job.module_id });
        console.log(`[WORKER] ✅ [1/4] Migration result:`, migrateResult);

        let companyAddons = [];
        let addonFetchAttempts = 0;
        while (addonFetchAttempts < 3) {
          try {
            companyAddons = await getCompanySubscriptionAddonsForModule(job.module_id);
            break;
          } catch (addonErr) {
            addonFetchAttempts++;
            console.warn(`[WORKER] ⚠️ Attempt ${addonFetchAttempts}/3 to resolve company subscription addons failed:`, addonErr.message);
            if (addonFetchAttempts < 3) await new Promise(r => setTimeout(r, 1000));
          }
        }
        const enabledAddonSet = new Set(companyAddons);
        const isDemoCapped = enabledAddonSet.has('demo_multimodal_cap_2');
        const maxMultimodal = isDemoCapped ? 2 : null;

        if (isDemoCapped) {
          console.log(`[JOB] Demo cap (demo_multimodal_cap_2) detected for module_id=${job.module_id}. Limiting multimodal assets to first 2 modules.`);
        }

        // If the company has no Lucid Studio related addons enabled, skip derived generation.
        const lucidStudioAddonKeys = [
          'lucid_studio_textual',
          'lucid_studio_podcast',
          'lucid_studio_video',
          'lucid_studio_mindmap',
          'lucid_studio_infographic',
          'lucid_studio_flashcard',
          'lucid_studio_flashcards',
        ];

        const hasLucidStudioAccess = lucidStudioAddonKeys.some((addon) => enabledAddonSet.has(addon));

        if (!hasLucidStudioAccess) {
          console.log(`[WORKER] ℹ️ Company for module_id=${job.module_id} has no enabled Lucid Studio addons. Completed processed_modules migration and skipping derived studio media.`);
          await supabase.from('content_jobs').update({ status: 'completed', updated_at: new Date() }).eq('id', job.id);
          console.log(`[WORKER] ✅ Job id=${job.id} marked as 'completed'.`);
          continue;
        }

        console.log(`[WORKER] 📝 [2/4] Running textual content generation for module_id=${job.module_id}...`);
        const genResult = await generateModuleContent({ moduleId: job.module_id });
        console.log(`[WORKER] ✅ [2/4] Content generation completed:`, genResult?.message || genResult);

        // Store initial content history after successful text generation
        console.log(`[WORKER] 📚 [3/4] Storing initial content history for module_id=${job.module_id}...`);
        const historyResult = await storeInitialContentHistory(job.module_id);
        if (historyResult.success) {
          console.log(`[WORKER] ✅ [3/4] Content history stored: ${historyResult.inserted} entries`);
        } else {
          console.error(`[WORKER] ⚠️ Failed to store content history, but job will continue:`, historyResult.error);
        }

        // Generate all derived assets for this specific module before completing the job.
        console.log(`[WORKER] 🎨 [4/4] Running derived media generators for module_id=${job.module_id}...`);
        try {
          await runModuleGenerators(job.module_id, enabledAddonSet, maxMultimodal);
          console.log(`[WORKER] ✅ [4/4] Derived media generation completed.`);
        } catch (mediaErr) {
          console.error(`[WORKER] ⚠️ Media generator error (continuing):`, mediaErr.message || mediaErr);
        }

        await supabase.from('content_jobs').update({ status: 'completed', updated_at: new Date() }).eq('id', job.id);
        console.log(`[WORKER] 🎉 Successfully finished entire pipeline for job id=${job.id}, module_id=${job.module_id}`);
        console.log(`============================================================\n`);
      } catch (err) {
        await supabase.from('content_jobs').update({ status: 'failed', updated_at: new Date() }).eq('id', job.id);
        console.error(`[WORKER] ❌ Job failed: id=${job.id}, module_id=${job.module_id}`, err);
        console.log(`============================================================\n`);
      }
    } else {
      idlePollCount++;
      const nextDelaySec = Math.round(Math.min(MIN_POLL_MS * Math.pow(2, idlePollCount), MAX_POLL_MS) / 1000);
      console.log(`[WORKER] 💤 Polling content_jobs... (0 pending jobs right now, next check in ${nextDelaySec}s)`);
    }

    const backoff = Math.min(MIN_POLL_MS * Math.pow(2, idlePollCount), MAX_POLL_MS);
    await new Promise(r => setTimeout(r, backoff));
  }
}

processJobs();