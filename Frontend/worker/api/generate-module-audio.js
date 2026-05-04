/*
  Worker-side audio generation for processed_modules.

  One-off usage:
    node worker/api/generate-module-audio.js --processed <processed_module_id>
    node worker/api/generate-module-audio.js --processed <processed_module_id> --language en
    node worker/api/generate-module-audio.js --module <original_module_id>

  Continuous polling:
    node worker/api/generate-module-audio.js --poll
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
  process.env.AUDIO_WORKER_API_BASE_URL,
  process.env.NEXT_PUBLIC_BACKEND_URL,
  process.env.BACKEND_URL,
]);

const POLL_INTERVAL_MS = Number(process.env.AUDIO_WORKER_POLL_INTERVAL_MS || 120000);
const MIN_CONTENT_LENGTH = Number(process.env.AUDIO_WORKER_MIN_CONTENT_LENGTH || 1);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[AUDIO WORKER] FATAL: Supabase env vars are missing.');
  process.exit(1);
}

if (API_BASE_URLS.length === 0) {
  console.error('[AUDIO WORKER] FATAL: Set one of AUDIO_WORKER_API_BASE_URL, NEXT_PUBLIC_BACKEND_URL, BACKEND_URL, INTERNAL_API_BASE_URL.');
  process.exit(1);
}

console.log('[AUDIO WORKER] API base URL candidates:', API_BASE_URLS.join(' | '));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeLanguage(language) {
  return language === 'hinglish' ? 'hinglish' : 'en';
}

function needsEnglish(row) {
  return !hasNonEmptyString(row.audio_url);
}

function needsHinglish(row) {
  return !hasNonEmptyString(row.audio_url_hinglish);
}

function isEligible(row) {
  const content = typeof row.content === 'string' ? row.content.trim() : '';
  const missingAnyAudio = needsEnglish(row) || needsHinglish(row);
  return content.length >= MIN_CONTENT_LENGTH && missingAnyAudio;
}

async function callTtsForLanguage(processedModuleId, language) {
  const normalizedLanguage = normalizeLanguage(language);
  console.log(`[AUDIO WORKER] Requesting ${normalizedLanguage} audio for ${processedModuleId}`);

  let lastError = null;

  for (const baseUrl of API_BASE_URLS) {
    const url = `${baseUrl}/api/tts`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processed_module_id: processedModuleId, language: normalizedLanguage })
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
          console.log(`[AUDIO WORKER] HTTP ${response.status} from ${baseUrl}. Nginx disconnected but Backend is likely still generating ${normalizedLanguage} audio! Entering wait-and-poll loop...`);
          const maxWaitMs = 15 * 60 * 1000; // wait up to 15 minutes
          const startMs = Date.now();
          const col = normalizedLanguage === 'hinglish' ? 'audio_url_hinglish' : 'audio_url';

          while (Date.now() - startMs < maxWaitMs) {
            await sleep(15000);
            const { data, error } = await supabase
              .from('processed_modules')
              .select(col)
              .eq('processed_module_id', processedModuleId)
              .single();

            if (!error && data && data[col]) {
              console.log(`[AUDIO WORKER] Recovered from HTTP ${response.status}! ${normalizedLanguage} audio successfully found in DB for ${processedModuleId}`);
              return { success: true, recovered: true, url: data[col] };
            }
          }
          throw new Error(`HTTP ${response.status}: Polled DB for 15 minutes but ${col} was never updated.`);
        }

        const message = payload?.error || payload?.raw || `HTTP ${response.status}`;
        throw new Error(`HTTP ${response.status}: ${message}`);
      }

      console.log(`[AUDIO WORKER] ${normalizedLanguage} audio done for ${processedModuleId} via ${baseUrl}`);
      return payload;
    } catch (error) {
      lastError = error;
      console.warn(`[AUDIO WORKER] ${normalizedLanguage} request failed via ${baseUrl}: ${error.message || error}`);
    }
  }

  throw new Error(
    `TTS failed (${normalizedLanguage}) for ${processedModuleId} on all base URLs: ${lastError?.message || lastError || 'Unknown error'}`
  );
}

async function processProcessedModuleRow(row, forceLanguage = null) {
  const processedModuleId = row.processed_module_id;
  const normalizedForceLanguage = forceLanguage ? normalizeLanguage(forceLanguage) : null;

  if (normalizedForceLanguage) {
    await callTtsForLanguage(processedModuleId, normalizedForceLanguage);
    return { ok: true, processedModuleId, generated: [normalizedForceLanguage] };
  }

  const generated = [];

  if (needsEnglish(row)) {
    await callTtsForLanguage(processedModuleId, 'en');
    generated.push('en');
  }

  if (needsHinglish(row)) {
    await callTtsForLanguage(processedModuleId, 'hinglish');
    generated.push('hinglish');
  }

  if (generated.length === 0) {
    console.log(`[AUDIO WORKER] Skipping ${processedModuleId}; both audio URLs are already present.`);
  }

  return { ok: true, processedModuleId, generated };
}

async function fetchRowByProcessedId(processedModuleId) {
  const { data, error } = await supabase
    .from('processed_modules')
    .select('processed_module_id, content, audio_url, audio_url_hinglish, created_at')
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

async function fetchNextPendingRow() {
  const { data, error } = await supabase
    .from('processed_modules')
    .select('processed_module_id, content, audio_url, audio_url_hinglish, created_at')
    .not('content', 'is', null)
    .neq('content', '')
    .or('audio_url.is.null,audio_url.eq."",audio_url_hinglish.is.null,audio_url_hinglish.eq.""')
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    throw new Error(`Pending row fetch failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  const next = rows.find(isEligible) || null;

  if (!next && rows.length > 0) {
    console.log(`[AUDIO WORKER] Pending rows fetched=${rows.length}, but none passed local eligibility (min content length=${MIN_CONTENT_LENGTH}).`);
  }

  return next;
}

async function generateModuleAudio({ moduleId = null, processedModuleId = null, language = null } = {}) {
  if (processedModuleId) {
    const row = await fetchRowByProcessedId(processedModuleId);
    if (!isEligible(row) && !language) {
      return { ok: true, skipped: true, reason: 'No missing audio or content too short for this processed_module_id' };
    }
    return processProcessedModuleRow(row, language);
  }

  if (moduleId) {
    const { data, error } = await supabase
      .from('processed_modules')
      .select('processed_module_id, content, audio_url, audio_url_hinglish')
      .eq('original_module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Module lookup failed: ${error.message}`);
    }

    const rows = (data || []).filter((row) => isEligible(row) || language);
    if (rows.length === 0) {
      return { ok: true, skipped: true, reason: 'No processed modules require audio generation for this module_id' };
    }

    const results = [];
    for (const row of rows) {
      results.push(await processProcessedModuleRow(row, language));
    }

    return { ok: true, processedCount: rows.length, results };
  }

  throw new Error('Missing moduleId or processedModuleId');
}

async function pollLoop() {
  console.log('[AUDIO WORKER] Polling for processed_modules missing English/Hinglish audio...');
  let idleCount = 0;
  const MIN_POLL_MS = 15000;
  const MAX_POLL_MS = 120000;

  while (true) {
    try {
      const row = await fetchNextPendingRow();

      if (!row) {
        idleCount++;
        console.log('[AUDIO WORKER] No eligible modules right now.');
      } else {
        idleCount = 0;
        await processProcessedModuleRow(row);
      }
    } catch (error) {
      console.error('[AUDIO WORKER] Poll loop error:', error.message || error);
    }

    const backoff = Math.min(MIN_POLL_MS * Math.pow(2, idleCount), MAX_POLL_MS);
    await sleep(backoff);
  }
}

module.exports = { generateModuleAudio, pollLoop };

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--poll')) {
    pollLoop().catch((error) => {
      console.error('[AUDIO WORKER] Poll loop crashed:', error);
      process.exit(1);
    });
  } else {
    const idxProcessed = args.findIndex((arg) => arg === '--processed');
    const idxModule = args.findIndex((arg) => arg === '--module');
    const idxLanguage = args.findIndex((arg) => arg === '--language');

    const processedModuleId = idxProcessed >= 0 ? args[idxProcessed + 1] : null;
    const moduleId = idxModule >= 0 ? args[idxModule + 1] : null;
    const language = idxLanguage >= 0 ? args[idxLanguage + 1] : null;

    generateModuleAudio({ moduleId, processedModuleId, language })
      .then((result) => {
        console.log('[AUDIO WORKER] done:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('[AUDIO WORKER] failed:', error);
        process.exit(1);
      });
  }
}
