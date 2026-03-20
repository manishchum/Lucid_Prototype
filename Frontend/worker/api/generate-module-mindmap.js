/*
  Worker-side mindmap generation for processed_modules.

  One-off usage:
    node worker/api/generate-module-mindmap.js --processed <processed_module_id>
    node worker/api/generate-module-mindmap.js --module <original_module_id>

  Continuous polling:
    node worker/api/generate-module-mindmap.js --poll
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
  process.env.MINDMAP_WORKER_API_BASE_URL,
  process.env.AUDIO_WORKER_API_BASE_URL,
  process.env.NEXT_PUBLIC_BACKEND_URL,
  process.env.BACKEND_URL,
  process.env.INTERNAL_API_BASE_URL,
]);

const POLL_INTERVAL_MS = Number(process.env.MINDMAP_WORKER_POLL_INTERVAL_MS || 15000);
const MIN_CONTENT_LENGTH = Number(process.env.MINDMAP_WORKER_MIN_CONTENT_LENGTH || 1);
const MAX_CONTENT_CHARS = Number(process.env.MINDMAP_WORKER_MAX_CONTENT_CHARS || 18000);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[MINDMAP WORKER] FATAL: Supabase env vars are missing.');
  process.exit(1);
}

if (API_BASE_URLS.length === 0) {
  console.error('[MINDMAP WORKER] FATAL: Set one of MINDMAP_WORKER_API_BASE_URL, NEXT_PUBLIC_BACKEND_URL, BACKEND_URL, INTERNAL_API_BASE_URL.');
  process.exit(1);
}

console.log('[MINDMAP WORKER] API base URL candidates:', API_BASE_URLS.join(' | '));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasMindmapData(value) {
  if (!value) return false;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '{}' || trimmed === '[]') return false;
    try {
      const parsed = JSON.parse(trimmed);
      return hasMindmapData(parsed);
    } catch (e) {
      return false;
    }
  }

  if (Array.isArray(value)) return value.length > 0;

  if (typeof value === 'object') {
    const nodes = Array.isArray(value.nodes) ? value.nodes : [];
    const edges = Array.isArray(value.edges) ? value.edges : [];
    return nodes.length > 0 && edges.length > 0;
  }

  return false;
}

function isEligible(row) {
  const content = typeof row.content === 'string' ? row.content.trim() : '';
  return content.length >= MIN_CONTENT_LENGTH && !hasMindmapData(row.mindmap_data);
}

function safeContentForModel(content) {
  if (!content) return '';
  return content.length > MAX_CONTENT_CHARS ? content.slice(0, MAX_CONTENT_CHARS) : content;
}

function isValidMindmap(payload) {
  return !!payload && Array.isArray(payload.nodes) && payload.nodes.length > 0 && Array.isArray(payload.edges);
}

async function generateMindmapFromApi(content, title = '') {
  let lastError = null;

  for (const baseUrl of API_BASE_URLS) {
    const url = `${baseUrl}/api/generate-mindmap`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, title }),
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

      if (!isValidMindmap(payload)) {
        throw new Error('Mindmap API returned empty/invalid payload.');
      }

      return payload;
    } catch (error) {
      lastError = error;
      console.warn(`[MINDMAP WORKER] request failed via ${baseUrl}: ${error.message || error}`);
    }
  }

  throw new Error(`Mindmap generation failed on all base URLs: ${lastError?.message || lastError || 'Unknown error'}`);
}

async function processProcessedModuleRow(row) {
  const processedModuleId = row.processed_module_id;
  const title = row.title || processedModuleId;

  if (!isEligible(row)) {
    console.log(`[MINDMAP WORKER] Skipping ${processedModuleId}; mindmap_data already present or content too short.`);
    return { ok: true, processedModuleId, skipped: true };
  }

  console.log(`[MINDMAP WORKER] Generating mindmap for ${processedModuleId} (${title})`);

  const content = safeContentForModel(row.content || '');
  const mindmap = await generateMindmapFromApi(content, row.title || '');

  const { error: updateError } = await supabase
    .from('processed_modules')
    .update({ mindmap_data: mindmap })
    .eq('processed_module_id', processedModuleId);

  if (updateError) {
    throw new Error(`Failed to save mindmap: ${updateError.message}`);
  }

  console.log(
    `[MINDMAP WORKER] Mindmap saved for ${processedModuleId}. nodes=${mindmap.nodes.length}, edges=${mindmap.edges.length}`
  );
  return { ok: true, processedModuleId, nodes: mindmap.nodes.length, edges: mindmap.edges.length };
}

async function fetchRowByProcessedId(processedModuleId) {
  const { data, error } = await supabase
    .from('processed_modules')
    .select('processed_module_id, original_module_id, title, content, mindmap_data, created_at')
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
    .select('processed_module_id, original_module_id, title, content, mindmap_data, created_at')
    .not('content', 'is', null)
    .neq('content', '')
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    throw new Error(`Pending row fetch failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  const next = rows.find(isEligible) || null;

  if (!next && rows.length > 0) {
    console.log(`[MINDMAP WORKER] Pending rows fetched=${rows.length}, but none passed local eligibility.`);
  }

  return next;
}

async function generateModuleMindmap({ moduleId = null, processedModuleId = null } = {}) {
  if (processedModuleId) {
    const row = await fetchRowByProcessedId(processedModuleId);
    if (!isEligible(row)) {
      return { ok: true, skipped: true, reason: 'No missing mindmap or content too short for this processed_module_id' };
    }
    return processProcessedModuleRow(row);
  }

  if (moduleId) {
    const { data, error } = await supabase
      .from('processed_modules')
      .select('processed_module_id, original_module_id, title, content, mindmap_data, created_at')
      .eq('original_module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Module lookup failed: ${error.message}`);
    }

    const rows = (data || []).filter(isEligible);
    if (rows.length === 0) {
      return { ok: true, skipped: true, reason: 'No processed modules require mindmap generation for this module_id' };
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
  console.log('[MINDMAP WORKER] Polling for processed_modules missing mindmap_data with non-empty content...');

  while (true) {
    try {
      const row = await fetchNextPendingRow();

      if (!row) {
        console.log('[MINDMAP WORKER] No eligible modules right now.');
      } else {
        await processProcessedModuleRow(row);
      }
    } catch (error) {
      console.error('[MINDMAP WORKER] Poll loop error:', error.message || error);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

module.exports = { generateModuleMindmap, pollLoop };

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--poll')) {
    pollLoop().catch((error) => {
      console.error('[MINDMAP WORKER] Poll loop crashed:', error);
      process.exit(1);
    });
  } else {
    const idxProcessed = args.findIndex((arg) => arg === '--processed');
    const idxModule = args.findIndex((arg) => arg === '--module');

    const processedModuleId = idxProcessed >= 0 ? args[idxProcessed + 1] : null;
    const moduleId = idxModule >= 0 ? args[idxModule + 1] : null;

    generateModuleMindmap({ moduleId, processedModuleId })
      .then((result) => {
        console.log('[MINDMAP WORKER] done:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('[MINDMAP WORKER] failed:', error);
        process.exit(1);
      });
  }
}
