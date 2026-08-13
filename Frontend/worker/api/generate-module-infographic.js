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
  process.env.NEXT_PUBLIC_BACKEND_URL,
]);

const POLL_INTERVAL_MS = Number(process.env.INFOGRAPHIC_WORKER_POLL_INTERVAL_MS || 120000);
const MIN_CONTENT_LENGTH = Number(process.env.INFOGRAPHIC_WORKER_MIN_CONTENT_LENGTH || 1);
const MAX_CONTENT_CHARS = Number(process.env.INFOGRAPHIC_WORKER_MAX_CONTENT_CHARS || 18000);
const ACTIVE_JOB_STATUSES = ['pending', 'in-progress'];

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
    .select('company_id, uploaded_by')
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

async function getModuleContext(moduleId) {
  if (!moduleId) return null;

  const { data, error } = await supabase
    .from('training_modules')
    .select('company_id, uploaded_by')
    .eq('module_id', moduleId)
    .single();

  if (error) {
    throw new Error(
      `Failed to resolve training module context for ${moduleId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return {
    companyId: data.company_id || null,
    userId: data.uploaded_by || null,
  };
}

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

async function generateInfographicFromApi({ content, title, processedModuleId, companyId, userId, }) {
  let lastError = null;

  for (const baseUrl of API_BASE_URLS) {
    const url = `${baseUrl}/api/generate-infographic`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, title, processed_module_id: processedModuleId, company_id: companyId, user_id: userId, }),
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

  console.log(
    `[INFOGRAPHIC WORKER] Generating infographic for ${processedModuleId} (${title})`
  );

  const content = safeContentForModel(row.content || '');

  const moduleContext = await getModuleContext(
    row.original_module_id
  );

  if (!moduleContext?.companyId) {
    throw new Error(
      `Could not resolve company_id for module ${row.original_module_id}`
    );
  }

  if (!moduleContext?.userId) {
    throw new Error(
      `Could not resolve uploaded_by user_id for module ${row.original_module_id}`
    );
  }

  console.log(
    `[INFOGRAPHIC WORKER] Resolved context: company=${moduleContext.companyId}, uploaded_by=${moduleContext.userId}`
  );

  const infographic = await generateInfographicFromApi({
    content,
    title: row.title || 'Untitled Module',
    processedModuleId,
    companyId: moduleContext.companyId,
    userId: moduleContext.userId,
  });

  const sectionCount = Array.isArray(infographic.sections) ? infographic.sections.length : 0;
  console.log(`[INFOGRAPHIC WORKER] Infographic saved for ${processedModuleId}. sections=${sectionCount}`);
  return { ok: true, processedModuleId, sections: sectionCount };
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
    .select('processed_module_id, original_module_id, title, content, infographic_data')
    .in('original_module_id', activeModuleIds)
    .not('content', 'is', null)
    .neq('content', '')
    .or('infographic_data.is.null,infographic_data.eq."{}"')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Pending row fetch failed: ${error.message}`);
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row || !isEligible(row) || !row.original_module_id) {
    return null;
  }

  if (!(await moduleSupportsAddon(row.original_module_id, 'lucid_studio_infographic'))) {
    return null;
  }

  return row;
}

async function fetchRowByProcessedId(processedModuleId) {
  const { data, error } = await supabase
    .from('processed_modules')
    .select('processed_module_id, original_module_id, title, content, infographic_data')
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

async function generateModuleInfographic({ moduleId = null, processedModuleId = null } = {}) {
  if (processedModuleId) {
    const row = await fetchRowByProcessedId(processedModuleId);
    if (!isEligible(row)) {
      return { ok: true, skipped: true, reason: 'No missing infographic or content too short for this processed_module_id' };
    }

    if (row.original_module_id && !(await moduleSupportsAddon(row.original_module_id, 'lucid_studio_infographic'))) {
      return { ok: true, skipped: true, reason: 'Infographic addon disabled for this module company' };
    }

    return processProcessedModuleRow(row);
  }

  if (moduleId) {
    if (!(await moduleSupportsAddon(moduleId, 'lucid_studio_infographic'))) {
      return { ok: true, skipped: true, reason: 'Infographic addon disabled for this module company' };
    }

    const { data, error } = await supabase
      .from('processed_modules')
      .select('processed_module_id, title, content, infographic_data')
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
      console.error('[INFOGRAPHIC WORKER] Poll loop error:', error.message || error);
    }

    const backoff = Math.min(MIN_POLL_MS * Math.pow(2, idleCount), MAX_POLL_MS);
    await sleep(backoff);
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