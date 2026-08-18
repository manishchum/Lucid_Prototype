/*
  Worker-side video generation for processed_modules.

  One-off usage:
    node worker/api/generate-module-video.js --processed <processed_module_id>
    node worker/api/generate-module-video.js --module <original_module_id>

  Continuous polling:
    node worker/api/generate-module-video.js --poll
*/

require('../env').loadWorkerEnv();

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function normalizeBaseUrl(value) {
  return (value || '').trim().replace(/\/$/, '');
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const out = [];

  for (const value of values) {
    const normalized = normalizeBaseUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

const API_BASE_URLS = uniqueNonEmpty([
  process.env.NEXT_PUBLIC_BACKEND_URL,
]);

const POLL_INTERVAL_MS = Number(process.env.VIDEO_WORKER_POLL_INTERVAL_MS || 120000);
const MIN_CONTENT_LENGTH = Number(process.env.VIDEO_WORKER_MIN_CONTENT_LENGTH || 1);
const VIDEO_RECOVERY_WAIT_MS = Number(process.env.VIDEO_WORKER_RECOVERY_WAIT_MS || 1800000);
const VIDEO_RECOVERY_POLL_MS = Number(process.env.VIDEO_WORKER_RECOVERY_POLL_MS || 15000);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[VIDEO WORKER] FATAL: Supabase env vars are missing.');
  process.exit(1);
}

if (API_BASE_URLS.length === 0) {
  console.error('[VIDEO WORKER] FATAL: Set one of VIDEO_WORKER_API_BASE_URL, NEXT_PUBLIC_BACKEND_URL, BACKEND_URL, INTERNAL_API_BASE_URL.');
  process.exit(1);
}

console.log('[VIDEO WORKER] API base URL candidates:', API_BASE_URLS.join(' | '));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const ACTIVE_JOB_STATUSES = ['pending', 'in-progress'];

const moduleAddonCache = new Map();

function normalizeAddonKey(addon) {
  return String(addon || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

async function getCompanySubscriptionAddonsForModule(moduleId) {
  if (!moduleId) return new Set();
  if (moduleAddonCache.has(moduleId)) {
    return moduleAddonCache.get(moduleId);
  }

  const { data: trainingModule, error: trainingError } = await supabase
    .from('training_modules')
    .select('company_id')
    .eq('module_id', moduleId)
    .single();

  if (trainingError || !trainingModule?.company_id) {
    moduleAddonCache.set(moduleId, new Set());
    return new Set();
  }

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('subscription_addons')
    .eq('company_id', trainingModule.company_id)
    .single();

  const addons = new Set(
    (Array.isArray(company?.subscription_addons) ? company.subscription_addons : [])
      .map(normalizeAddonKey)
      .filter(Boolean)
  );

  moduleAddonCache.set(moduleId, addons);
  return addons;
}

async function moduleSupportsAddon(moduleId, addon) {
  const addons = await getCompanySubscriptionAddonsForModule(moduleId);
  return addons.has(normalizeAddonKey(addon));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function needsVideo(row) {
  return !hasNonEmptyString(row.video_url);
}

function isEligible(row) {
  const content = typeof row.content === 'string' ? row.content.trim() : '';
  return content.length >= MIN_CONTENT_LENGTH && needsVideo(row);
}

async function fetchVideoUrlFromDb(processedModuleId) {
  const { data, error } = await supabase
    .from('processed_modules')
    .select('video_url')
    .eq('processed_module_id', processedModuleId)
    .single();

  if (error || !data) return null;
  return hasNonEmptyString(data.video_url) ? data.video_url : null;
}

async function waitForVideoUrlInDb(processedModuleId, waitMs = VIDEO_RECOVERY_WAIT_MS, pollMs = VIDEO_RECOVERY_POLL_MS) {
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    await sleep(pollMs);
    const videoUrl = await fetchVideoUrlFromDb(processedModuleId);
    if (videoUrl) return videoUrl;
  }
  return null;
}

async function callVideoGeneration(processedModuleId) {
  console.log(`[VIDEO WORKER] Requesting video generation for ${processedModuleId}`);

  let lastError = null;

  for (const baseUrl of API_BASE_URLS) {
    const url = `${baseUrl}/api/gpt-video`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processed_module_id: processedModuleId }),
      });

      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (e) {
        payload = { raw: text };
      }

      if (!response.ok) {
        if ([502, 503, 504].includes(response.status)) {
          //   console.log(`[VIDEO WORKER] HTTP ${response.status} from ${baseUrl}. Waiting for DB video_url update...`);
          console.log(`[VIDEO WORKER] Video generation running in background. Waiting for DB video_url update...`);
          const recoveredUrl = await waitForVideoUrlInDb(processedModuleId);
          if (recoveredUrl) {
            console.log(`[VIDEO WORKER] video found in DB for ${processedModuleId}`);
            return { ok: true, recovered: true, videoUrl: recoveredUrl };
          }
          throw new Error(`HTTP ${response.status}: DB video_url was not updated within recovery window.`);
        }

        const message = payload?.error || payload?.raw || `HTTP ${response.status}`;
        throw new Error(`HTTP ${response.status}: ${message}`);
      }

      const responseVideoUrl = payload?.videoUrl || payload?.video_url || null;
      if (hasNonEmptyString(responseVideoUrl)) {
        console.log(`[VIDEO WORKER] Video done for ${processedModuleId} via ${baseUrl}`);
        return { ok: true, videoUrl: responseVideoUrl };
      }

      const dbVideoUrl = await waitForVideoUrlInDb(processedModuleId, 120000, 5000);
      if (dbVideoUrl) {
        console.log(`[VIDEO WORKER] Video confirmed in DB for ${processedModuleId} via ${baseUrl}`);
        return { ok: true, videoUrl: dbVideoUrl };
      }

      throw new Error('API returned success but no videoUrl in response or DB.');
    } catch (error) {
      lastError = error;
      console.warn(`[VIDEO WORKER] request failed via ${baseUrl}: ${error.message || error}`);
    }
  }

  throw new Error(
    `Video generation failed for ${processedModuleId} on all base URLs: ${lastError?.message || lastError || 'Unknown error'}`
  );
}

async function processProcessedModuleRow(row) {
  const processedModuleId = row.processed_module_id;

  if (!needsVideo(row)) {
    console.log(`[VIDEO WORKER] Skipping ${processedModuleId}; video_url already present.`);
    return { ok: true, processedModuleId, skipped: true };
  }

  const result = await callVideoGeneration(processedModuleId);
  return { ok: true, processedModuleId, ...result };
}

async function fetchRowByProcessedId(processedModuleId) {
  const { data, error } = await supabase
    .from('processed_modules')
    .select('processed_module_id, original_module_id, content, video_url')
    .eq('processed_module_id', processedModuleId)
    .maybeSingle();

  if (error) {
    throw new Error(`Processed module lookup failed: ${error.message}`);
  }

  if (!data) {
    throw new Error(`processed_module_id not found: ${processedModuleId}`);
  }

  return data;
}

async function fetchActiveModuleIds() {
  const { data, error } = await supabase
    .from('content_jobs')
    .select('module_id')
    .in('status', ACTIVE_JOB_STATUSES)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    throw new Error(`Active module fetch failed: ${error.message}`);
  }

  const moduleIds = [...new Set((data || []).map((row) => row.module_id).filter(Boolean))];
  return moduleIds;
}

async function fetchNextPendingRow() {
  const activeModuleIds = await fetchActiveModuleIds();
  if (activeModuleIds.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from('processed_modules')
    .select('processed_module_id, original_module_id, content, video_url')
    .in('original_module_id', activeModuleIds)
    .not('content', 'is', null)
    .neq('content', '')
    .or('video_url.is.null,video_url.eq.""')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Pending row fetch failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];

  for (const row of rows) {
    if (!isEligible(row) || !row.original_module_id) continue;
    if (!(await moduleSupportsAddon(row.original_module_id, 'lucid_studio_video'))) continue;
    return row;
  }

  if (rows.length > 0) {
    console.log(`[VIDEO WORKER] Pending rows fetched=${rows.length}, but none were eligible or had video addon enabled.`);
  }

  return null;
}

async function generateModuleVideo({ moduleId = null, processedModuleId = null } = {}) {
  if (processedModuleId) {
    const row = await fetchRowByProcessedId(processedModuleId);
    if (!isEligible(row)) {
      return { ok: true, skipped: true, reason: 'No missing video or content too short for this processed_module_id' };
    }

    if (row.original_module_id && !(await moduleSupportsAddon(row.original_module_id, 'lucid_studio_video'))) {
      return { ok: true, skipped: true, reason: 'Video addon disabled for this module company' };
    }

    return processProcessedModuleRow(row);
  }

  if (moduleId) {
    if (!(await moduleSupportsAddon(moduleId, 'lucid_studio_video'))) {
      return { ok: true, skipped: true, reason: 'Video addon disabled for this module company' };
    }

    const { data, error } = await supabase
      .from('processed_modules')
      .select('processed_module_id, content, video_url')
      .eq('original_module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Module lookup failed: ${error.message}`);
    }

    const rows = (data || []).filter(isEligible);
    if (rows.length === 0) {
      return { ok: true, skipped: true, reason: 'No processed modules require video generation for this module_id' };
    }

    const results = [];
    for (const row of rows) {
      results.push(await processProcessedModuleRow(row));
    }

    return { ok: true, processedCount: rows.length, results };
  }

  throw new Error('Missing moduleId or processedModuleId');
}

async function pollLoop() {
  console.log('[VIDEO WORKER] Polling for processed_modules missing video_url with non-empty content...');
  let idleCount = 0;
  const MIN_POLL_MS = 15000;
  const MAX_POLL_MS = 120000;

  while (true) {
    try {
      const row = await fetchNextPendingRow();

      if (!row) {
        idleCount++;
      } else {
        idleCount = 0;
        await processProcessedModuleRow(row);
      }
    } catch (error) {
      console.error('[VIDEO WORKER] Poll loop error:', error.message || error);
    }

    const backoff = Math.min(MIN_POLL_MS * Math.pow(2, idleCount), MAX_POLL_MS);
    await sleep(backoff);
  }
}

module.exports = { generateModuleVideo, pollLoop };

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--poll')) {
    pollLoop().catch((error) => {
      console.error('[VIDEO WORKER] Poll loop crashed:', error);
      process.exit(1);
    });
  } else {
    const idxProcessed = args.findIndex((arg) => arg === '--processed');
    const idxModule = args.findIndex((arg) => arg === '--module');

    const processedModuleId = idxProcessed >= 0 ? args[idxProcessed + 1] : null;
    const moduleId = idxModule >= 0 ? args[idxModule + 1] : null;

    generateModuleVideo({ moduleId, processedModuleId })
      .then((result) => {
        console.log('[VIDEO WORKER] done:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('[VIDEO WORKER] failed:', error);
        process.exit(1);
      });
  }
}
