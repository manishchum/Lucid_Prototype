require('../env').loadWorkerEnv();

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:8000';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[CHAT WORKER] FATAL: Supabase environment variables are missing.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Triggers Q&A chunking & vector embedding for a processed module or sprint module ID.
 */
async function generateModuleChat({ moduleId = null, processedModuleId = null } = {}) {
  if (!moduleId && !processedModuleId) {
    throw new Error('[CHAT WORKER] Missing required parameter: moduleId or processedModuleId');
  }

  const payload = {};
  if (processedModuleId) {
    payload.processed_module_id = processedModuleId;
  } else if (moduleId) {
    payload.module_id = moduleId;
  }

  console.log(`[CHAT WORKER] Triggering vector ingestion via Backend API (${BACKEND_URL})...`, payload);

  const res = await fetch(`${BACKEND_URL}/api/ingest-processed-module`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 300000,
  });

  const resData = await res.json();

  if (!res.ok || !resData.success) {
    const errorMsg = resData?.error || resData?.message || `HTTP ${res.status}`;
    throw new Error(`[CHAT WORKER] Ingestion failed: ${errorMsg}`);
  }

  console.log(`[CHAT WORKER] Ingestion completed:`, resData);
  return resData;
}

const WORKER_START_TIME = new Date().toISOString();

/**
 * Polls Supabase for newly completed content jobs (after worker start) whose processed modules lack vector chunks.
 */
async function fetchNextPendingJob() {
  const { data: completedJobs, error: jobsError } = await supabase
    .from('content_jobs')
    .select('id, module_id, updated_at')
    .eq('status', 'completed')
    .gte('updated_at', WORKER_START_TIME)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (jobsError) {
    throw new Error(`Completed jobs query failed: ${jobsError.message}`);
  }

  if (!completedJobs || completedJobs.length === 0) {
    return null;
  }

  for (const job of completedJobs) {
    const moduleId = job.module_id;
    if (!moduleId) continue;

    const { count, error: countError } = await supabase
      .from('vectordb_processed_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('original_module_id', moduleId);

    if (countError) {
      console.error(`[CHAT WORKER] Error checking vector chunks for module_id=${moduleId}:`, countError.message);
      continue;
    }

    if (!count || count === 0) {
      return job;
    }
  }

  return null;
}

/**
 * Continuous poll loop.
 */
async function pollLoop() {
  console.log('[CHAT WORKER] Polling for completed modules requiring vector ingestion...');
  let idleCount = 0;
  const MIN_POLL_MS = 10000;
  const MAX_POLL_MS = 60000;

  while (true) {
    try {
      const job = await fetchNextPendingJob();

      if (!job) {
        idleCount++;
      } else {
        idleCount = 0;
        console.log(`[CHAT WORKER] Found completed module requiring vector ingestion: module_id=${job.module_id}`);
        await generateModuleChat({ moduleId: job.module_id });
      }
    } catch (error) {
      console.error('[CHAT WORKER] Poll loop error:', error.message || error);
    }

    const backoff = Math.min(MIN_POLL_MS * Math.pow(1.5, idleCount), MAX_POLL_MS);
    await sleep(backoff);
  }
}

module.exports = { generateModuleChat, pollLoop };

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--poll')) {
    pollLoop().catch((error) => {
      console.error('[CHAT WORKER] Poll loop crashed:', error);
      process.exit(1);
    });
  } else {
    const idxProcessed = args.findIndex((arg) => arg === '--processed');
    const idxModule = args.findIndex((arg) => arg === '--module');

    const processedModuleId = idxProcessed >= 0 ? args[idxProcessed + 1] : null;
    const moduleId = idxModule >= 0 ? args[idxModule + 1] : null;

    generateModuleChat({ moduleId, processedModuleId })
      .then((result) => {
        console.log('[CHAT WORKER] Done:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('[CHAT WORKER] Failed:', error);
        process.exit(1);
      });
  }
}
