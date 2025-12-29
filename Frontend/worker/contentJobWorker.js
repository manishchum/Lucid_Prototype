
// require('dotenv').config();

// // Node.js worker script for processing content generation jobs
// const fetch = require('node-fetch');
// const { createClient } = require('@supabase/supabase-js');
// const path = require('path');

// // Import local API functions to avoid Vercel timeouts
// console.log('Loading migrate-processed-modules...');
// const { migrateProcessedModules } = require(path.join(__dirname, 'api/migrate-processed-modules'));
// console.log('Loading start-content-generation...');
// const { startContentGeneration } = require(path.join(__dirname, 'api/start-content-generation'));
// console.log('Loading generate-module-content...');
// const { generateModuleContent } = require(path.join(__dirname, 'api/generate-module-content'));
// console.log('All modules loaded successfully.');

// const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// const API_BASE_URL = process.env.INTERNAL_API_BASE_URL;

// const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


// async function processJobs() {
//   console.log('Worker started. Polling for jobs every 5 seconds...');
//   while (true) {
//     console.log('Polling for pending jobs...');
//     const { data: jobs, error } = await supabase
//       .from('content_jobs')
//       .select('*')
//       .eq('status', 'pending')
//       .order('created_at', { ascending: true })
//       .limit(1);

//     if (error) {
//       console.error('Supabase job fetch error:', error);
//       await new Promise(r => setTimeout(r, 5000));
//       continue;
//     }

//     if (jobs && jobs.length > 0) {
//       const job = jobs[0];
//       console.log(`[JOB] Found pending job: id=${job.id}, module_id=${job.module_id}`);
//       // Mark as in-progress
//       const { error: updateError } = await supabase.from('content_jobs').update({ status: 'in-progress', updated_at: new Date() }).eq('id', job.id);
//       if (updateError) {
//         console.error(`[JOB] Failed to mark job in-progress: id=${job.id}`, updateError);
//         await new Promise(r => setTimeout(r, 5000));
//         continue;
//       }
//       try {
//         console.log(`[JOB] Running migration for module_id=${job.module_id}`);
//         const migrateResult = await migrateProcessedModules();
//         console.log(`[JOB] Migration completed:`, migrateResult.message);
        
//         console.log(`[JOB] Running content generation for module_id=${job.module_id}`);
//         const genResult = await generateModuleContent();
//         console.log(`[JOB] Content generation completed:`, genResult.message);
        
//         await supabase.from('content_jobs').update({ status: 'completed', updated_at: new Date() }).eq('id', job.id);
//         console.log(`[JOB] Job completed: id=${job.id}, module_id=${job.module_id}`);
//       } catch (err) {
//         await supabase.from('content_jobs').update({ status: 'failed', updated_at: new Date() }).eq('id', job.id);
//         console.error(`[JOB] Job failed: id=${job.id}, module_id=${job.module_id}`, err);
//       }
//     } else {
//       console.log('No pending jobs found.');
//     }
//     await new Promise(r => setTimeout(r, 5000)); // Poll every 5 seconds
//   }
// }

// processJobs();
