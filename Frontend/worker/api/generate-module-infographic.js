/*
  Worker-side infographic generation for processed_modules.

  One-off usage:
    node worker/api/generate-module-infographic.js --processed <processed_module_id>
    node worker/api/generate-module-infographic.js --module <original_module_id>

  Continuous polling:
    node worker/api/generate-module-infographic.js --poll
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
  process.env.INFOGRAPHIC_WORKER_API_BASE_URL,
  process.env.AUDIO_WORKER_API_BASE_URL,
  process.env.NEXT_PUBLIC_BACKEND_URL,
  process.env.BACKEND_URL,
  process.env.INTERNAL_API_BASE_URL,
]);

const POLL_INTERVAL_MS = Number(process.env.INFOGRAPHIC_WORKER_POLL_INTERVAL_MS || 15000);
const MIN_CONTENT_LENGTH = Number(process.env.INFOGRAPHIC_WORKER_MIN_CONTENT_LENGTH || 1);
const MAX_CONTENT_CHARS = Number(process.env.INFOGRAPHIC_WORKER_MAX_CONTENT_CHARS || 18000);
const SCAN_BATCH_SIZE = Math.max(1, Number(process.env.INFOGRAPHIC_WORKER_SCAN_BATCH_SIZE || 100));
const MAX_SCAN_ROWS = Math.max(SCAN_BATCH_SIZE, Number(process.env.INFOGRAPHIC_WORKER_MAX_SCAN_ROWS || 5000));

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[INFOGRAPHIC WORKER] FATAL: Supabase env vars are missing.');
  process.exit(1);
}

if (API_BASE_URLS.length === 0) {
  console.error('[INFOGRAPHIC WORKER] FATAL: Set one of INFOGRAPHIC_WORKER_API_BASE_URL, NEXT_PUBLIC_BACKEND_URL, BACKEND_URL, INTERNAL_API_BASE_URL.');
  process.exit(1);
}

console.log('[INFOGRAPHIC WORKER] API base URL candidates:', API_BASE_URLS.join(' | '));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasInfographicData(value) {
  if (!value) return false;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '{}' || trimmed === '[]') return false;
    try {
      const parsed = JSON.parse(trimmed);
      return hasInfographicData(parsed);
    } catch (e) {
      return false;
    }
  }

  if (Array.isArray(value)) return value.length > 0;

  if (typeof value === 'object') {
    const hasSections = Array.isArray(value.sections) && value.sections.length > 0;
    const hasTitle = typeof value.title === 'string' && value.title.trim().length > 0;
    return hasSections || hasTitle || Object.keys(value).length > 0;
  }

  return false;
}

function isEligible(row) {
  const content = typeof row.content === 'string' ? row.content.trim() : '';
  return content.length >= MIN_CONTENT_LENGTH && !hasInfographicData(row.infographic_data);
}

function safeContentForModel(content) {
  if (!content) return '';
  return content.length > MAX_CONTENT_CHARS ? content.slice(0, MAX_CONTENT_CHARS) : content;
}

function isValidInfographic(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (Array.isArray(payload)) return payload.length > 0;
  const hasSections = Array.isArray(payload.sections) && payload.sections.length > 0;
  const hasTitle = typeof payload.title === 'string' && payload.title.trim().length > 0;
  const hasFlags = payload.criticalFlags && typeof payload.criticalFlags === 'object';
  return hasSections || hasTitle || hasFlags;
}

async function generateInfographicFromApi({ content, title, processedModuleId }) {
  let lastError = null;

  for (const baseUrl of API_BASE_URLS) {
    const url = `${baseUrl}/api/generate-infographic`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, title, processed_module_id: processedModuleId }),
      });

      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (e) {
        payload = { raw: text };
      }

      if (!response.ok) {
        const message = payload?.error || payload?.detail || payload?.raw || `HTTP ${response.status}`;
        throw new Error(`HTTP ${response.status}: ${message}`);
      }

      if (!isValidInfographic(payload)) {
        throw new Error('Infographic API returned empty/invalid payload.');
      }

      return payload;
    } catch (error) {
      lastError = error;
      console.warn(`[INFOGRAPHIC WORKER] request failed via ${baseUrl}: ${error.message || error}`);
    }
  }

  throw new Error(`Infographic generation failed on all base URLs: ${lastError?.message || lastError || 'Unknown error'}`);
}

async function processProcessedModuleRow(row) {
  const processedModuleId = row.processed_module_id;
  const title = row.title || processedModuleId;

  if (!isEligible(row)) {
    console.log(`[INFOGRAPHIC WORKER] Skipping ${processedModuleId}; infographic_data already present or content too short.`);
    return { ok: true, processedModuleId, skipped: true };
  }

  console.log(`[INFOGRAPHIC WORKER] Generating infographic for ${processedModuleId} (${title})`);

  const content = safeContentForModel(row.content || '');
  const infographic = await generateInfographicFromApi({
    content,
    title: row.title || 'Untitled Module',
    processedModuleId,
  });

  const { error: updateError } = await supabase
    .from('processed_modules')
    .update({ infographic_data: infographic })
    .eq('processed_module_id', processedModuleId);

  if (updateError) {
    throw new Error(`Failed to save infographic: ${updateError.message}`);
  }

  const sectionCount = Array.isArray(infographic.sections) ? infographic.sections.length : 0;
  console.log(`[INFOGRAPHIC WORKER] Infographic saved for ${processedModuleId}. sections=${sectionCount}`);
  return { ok: true, processedModuleId, sections: sectionCount };
}

async function fetchRowByProcessedId(processedModuleId) {
  const { data, error } = await supabase
    .from('processed_modules')
    .select('processed_module_id, original_module_id, title, content, infographic_data, created_at')
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
  let offset = 0;
  let scanned = 0;

  while (scanned < MAX_SCAN_ROWS) {
    const end = offset + SCAN_BATCH_SIZE - 1;

    const { data, error } = await supabase
      .from('processed_modules')
      .select('processed_module_id, original_module_id, title, content, infographic_data, created_at')
      .not('content', 'is', null)
      .neq('content', '')
      .order('created_at', { ascending: true })
      .range(offset, end);

    if (error) {
      throw new Error(`Pending row fetch failed: ${error.message}`);
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) break;

    const next = rows.find(isEligible);
    if (next) {
      if (offset > 0) {
        console.log(
          `[INFOGRAPHIC WORKER] Found eligible row after scanning offset=${offset}, scanned=${scanned + rows.length}`
        );
      }
      return next;
    }

    scanned += rows.length;
    offset += rows.length;

    if (rows.length < SCAN_BATCH_SIZE) break;
  }

  console.log(
    `[INFOGRAPHIC WORKER] No eligible rows found after scanning up to ${Math.min(scanned, MAX_SCAN_ROWS)} rows.`
  );
  return null;
}

async function generateModuleInfographic({ moduleId = null, processedModuleId = null } = {}) {
  if (processedModuleId) {
    const row = await fetchRowByProcessedId(processedModuleId);
    if (!isEligible(row)) {
      return { ok: true, skipped: true, reason: 'No missing infographic or content too short for this processed_module_id' };
    }
    return processProcessedModuleRow(row);
  }

  if (moduleId) {
    const { data, error } = await supabase
      .from('processed_modules')
      .select('processed_module_id, original_module_id, title, content, infographic_data, created_at')
      .eq('original_module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Module lookup failed: ${error.message}`);
    }

    const rows = (data || []).filter(isEligible);
    if (rows.length === 0) {
      return { ok: true, skipped: true, reason: 'No processed modules require infographic generation for this module_id' };
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
  console.log('[INFOGRAPHIC WORKER] Polling for processed_modules missing infographic_data with non-empty content...');

  while (true) {
    try {
      const row = await fetchNextPendingRow();

      if (!row) {
        console.log('[INFOGRAPHIC WORKER] No eligible modules right now.');
      } else {
        await processProcessedModuleRow(row);
      }
    } catch (error) {
      console.error('[INFOGRAPHIC WORKER] Poll loop error:', error.message || error);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

module.exports = { generateModuleInfographic, pollLoop };

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--poll')) {
    pollLoop().catch((error) => {
      console.error('[INFOGRAPHIC WORKER] Poll loop crashed:', error);
      process.exit(1);
    });
  } else {
    const idxProcessed = args.findIndex((arg) => arg === '--processed');
    const idxModule = args.findIndex((arg) => arg === '--module');

    const processedModuleId = idxProcessed >= 0 ? args[idxProcessed + 1] : null;
    const moduleId = idxModule >= 0 ? args[idxModule + 1] : null;

    generateModuleInfographic({ moduleId, processedModuleId })
      .then((result) => {
        console.log('[INFOGRAPHIC WORKER] done:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('[INFOGRAPHIC WORKER] failed:', error);
        process.exit(1);
      });
  }
}
