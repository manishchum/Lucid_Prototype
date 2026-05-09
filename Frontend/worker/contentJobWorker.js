require('./env').loadWorkerEnv();

// Node.js worker script for processing content generation jobs
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Import local API functions to avoid Vercel timeouts
console.log('Loading migrate-processed-modules...');
const { migrateProcessedModules } = require(path.join(__dirname, 'api/migrate-processed-modules'));
// console.log('Loading start-content-generation...');
// const { startContentGeneration } = require(path.join(__dirname, 'api/start-content-generation'));
console.log('Loading generate-module-content...');
const { generateModuleContent } = require(path.join(__dirname, 'api/generate-module-content'));
// console.log('Loading generate-module-video...');
// const { generateModuleVideo } = require(path.join(__dirname, 'api/generate-module-video'));
console.log('All modules loaded successfully.');

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
    console.log(`[HISTORY] Storing initial content history for module_id=${moduleId}`);
    
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
      console.log(`[HISTORY] No processed modules found for module_id=${moduleId}`);
      return { success: true, inserted: 0 };
    }

    console.log(`[HISTORY] Found ${processedModules.length} processed modules to store`);

    // Prepare history entries
    const historyEntries = processedModules.map(pm => ({
      processed_module_id: pm.processed_module_id,
      content: pm.content,
      original_module_id:moduleId,
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

    console.log(`[HISTORY] Successfully stored ${insertedData?.length || 0} initial content history entries for module_id=${moduleId}`);
    return { success: true, inserted: insertedData?.length || 0 };
  } catch (err) {
    console.error(`[HISTORY] Unexpected error storing content history for module_id=${moduleId}:`, err);
    return { success: false, error: err };
  }
}

async function processJobs() {
  console.log('Worker started. Polling for jobs every 5 seconds...');
  while (true) {
    console.log('Polling for pending jobs...');
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
      console.log(`[JOB] Found pending job: id=${job.id}, module_id=${job.module_id}`);
      // Mark as in-progress
      const { error: updateError } = await supabase.from('content_jobs').update({ status: 'in-progress', updated_at: new Date() }).eq('id', job.id);
      if (updateError) {
        console.error(`[JOB] Failed to mark job in-progress: id=${job.id}`, updateError);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      try {
        console.log(`[JOB] Running migration for module_id=${job.module_id}`);
        const migrateResult = await migrateProcessedModules({ moduleId: job.module_id });
        console.log(migrateResult)
        console.log(`[JOB] Migration completed:`, migrateResult.message);

        console.log(`[JOB] Running content generation for module_id=${job.module_id}`);
        const genResult = await generateModuleContent({ moduleId: job.module_id });
        console.log(`[JOB] Content generation completed:`, genResult.message);

        // Trigger video generation for any processed_modules rows missing video_url.
        // Non-fatal: keep the content job flow reliable even if video generation fails.
        try {
          console.log(`[JOB] Triggering video generation for module_id=${job.module_id}`);
          const videoResult = await generateModuleVideo({ moduleId: job.module_id });
          console.log('[JOB] Video generation result:', videoResult);
        } catch (videoErr) {
          console.error('[JOB] Video generation failed (non-fatal):', videoErr);
        }
        
        // Store initial content history after successful generation
        console.log(`[JOB] Storing initial content history for module_id=${job.module_id}`);
        const historyResult = await storeInitialContentHistory(job.module_id);
        if (historyResult.success) {
          console.log(`[JOB] Content history stored: ${historyResult.inserted} entries`);
        } else {
          console.error(`[JOB] Failed to store content history, but job will still be marked complete:`, historyResult.error);
        }
        
        await supabase.from('content_jobs').update({ status: 'completed', updated_at: new Date() }).eq('id', job.id);
        console.log(`[JOB] Job completed: id=${job.id}, module_id=${job.module_id}`);
      } catch (err) {
        await supabase.from('content_jobs').update({ status: 'failed', updated_at: new Date() }).eq('id', job.id);
        console.error(`[JOB] Job failed: id=${job.id}, module_id=${job.module_id}`, err);
      }
    } else {
      console.log('No pending jobs found.');
    }
    await new Promise(r => setTimeout(r, 5000)); // Poll every 5 seconds
  }
}

processJobs();
