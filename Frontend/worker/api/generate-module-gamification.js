/*
  Worker-side gamification drill generation for training_modules.

  One-off usage:
    node worker/api/generate-module-gamification.js --module <module_id>

  Continuous polling:
    node worker/api/generate-module-gamification.js --poll
*/

require('../env').loadWorkerEnv();

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_INTERNAL_TOKEN = process.env.AI_GATEWAY_INTERNAL_TOKEN;

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

const POLL_INTERVAL_MS = 60000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[GAMIFICATION WORKER] FATAL: Supabase env vars are missing.');
  process.exit(1);
}

if (API_BASE_URLS.length === 0) {
  console.error('[GAMIFICATION WORKER] FATAL: Set one of INTERNAL_API_BASE_URL, NEXT_PUBLIC_BACKEND_URL, BACKEND_URL.');
  process.exit(1);
}

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
  const candidates = Array.isArray(addon) ? addon : [addon];
  return candidates.some((candidate) => addons.has(normalizeAddonKey(candidate)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchNextPendingModule() {
  // Find a completed training_module that doesn't have a gamification sprint yet
  const { data: modules, error } = await supabase
    .from('training_modules')
    .select('module_id, company_id, uploaded_by, processing_status')
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: true })
    .limit(50); // fetch a batch to check against gamification_sprints

  if (error) {
    console.error('[GAMIFICATION WORKER] Error fetching training modules:', error.message);
    return null;
  }

  if (!modules || modules.length === 0) return null;

  for (const mod of modules) {
    // Check if it already has a sprint
    const { data: sprints, error: sprintError } = await supabase
      .from('gamification_sprints')
      .select('sprint_id')
      .eq('module_id', mod.module_id)
      .limit(1);
    
    if (sprintError) {
      console.error(`[GAMIFICATION WORKER] Error checking sprints for module ${mod.module_id}:`, sprintError.message);
      continue;
    }

    if (!sprints || sprints.length === 0) {
      // Check addon
      const supports = await moduleSupportsAddon(mod.module_id, 'gamification');
      if (supports) {
        return mod;
      }
    }
  }

  return null;
}

async function generateGamificationFromApi(content, companyId, userId, moduleId) {
  for (const baseUrl of API_BASE_URLS) {
    const url = `${baseUrl}/api/gamification/generate`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Internal-Token': WORKER_INTERNAL_TOKEN,
          'X-User-ID': userId,
          'X-Company-ID': companyId,
        },
        body: JSON.stringify({ 
          content,
          company_id: companyId,
          user_id: userId,
          module_id: moduleId
        }),
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

      return payload;
    } catch (error) {
      console.warn(`[GAMIFICATION WORKER] Failed to reach API at ${baseUrl}: ${error.message}`);
    }
  }

  throw new Error('All internal API endpoints failed or were unreachable.');
}

async function processModule(mod) {
  console.log(`[GAMIFICATION WORKER] Processing module: ${mod.module_id}`);

  // Fetch all processed_modules for this module to synthesize
  const { data: processedModules, error: pmError } = await supabase
    .from('processed_modules')
    .select('content')
    .eq('original_module_id', mod.module_id)
    .order('order_index', { ascending: true });

  if (pmError) {
    throw new Error(`Failed to fetch processed_modules: ${pmError.message}`);
  }

  if (!processedModules || processedModules.length === 0) {
    console.log(`[GAMIFICATION WORKER] No processed_modules found for module_id=${mod.module_id}. Skipping.`);
    return { ok: true, skipped: true, reason: 'No processed_modules' };
  }

  // Combine content
  const fullContent = processedModules.map(pm => pm.content).join('\n\n');
  if (fullContent.trim().length === 0) {
    console.log(`[GAMIFICATION WORKER] Combined content is empty for module_id=${mod.module_id}. Skipping.`);
    return { ok: true, skipped: true, reason: 'Empty content' };
  }

  const result = await generateGamificationFromApi(fullContent, mod.company_id, mod.uploaded_by, mod.module_id);
  console.log(`[GAMIFICATION WORKER] Successfully generated drills for module_id=${mod.module_id}`);
  return { ok: true, result };
}

async function generateModuleGamification({ moduleId = null } = {}) {
  if (moduleId) {
    if (!(await moduleSupportsAddon(moduleId, ['gamification', 'lucid_studio_gamification']))) {
      return { ok: true, skipped: true, reason: 'Gamification addon disabled for this module company' };
    }

    const { data: mod, error } = await supabase
      .from('training_modules')
      .select('module_id, company_id, uploaded_by, processing_status')
      .eq('module_id', moduleId)
      .single();

    if (error || !mod) {
      throw new Error(`Module lookup failed: ${error?.message || 'Not found'}`);
    }

    return processModule(mod);
  }

  throw new Error('Missing moduleId');
}

async function fetchCompletedModuleIds() {
  // Fetch recently completed jobs
  const { data, error } = await supabase
    .from('content_jobs')
    .select('module_id')
    .eq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Completed jobs fetch failed: ${error.message}`);
  }
  return [...new Set((data || []).map((row) => row.module_id).filter(Boolean))];
}

async function fetchNextPendingModule() {
  const completedModuleIds = await fetchCompletedModuleIds();
  if (completedModuleIds.length === 0) return null;

  // Find modules that don't have gamification sprints yet
  const { data: existingSprints, error: sprintError } = await supabase
    .from('gamification_sprints')
    .select('module_id')
    .in('module_id', completedModuleIds);

  if (sprintError) throw new Error(`Sprint fetch failed: ${sprintError.message}`);
  
  const modulesWithSprints = new Set((existingSprints || []).map(s => s.module_id));
  
  for (const moduleId of completedModuleIds) {
    if (!modulesWithSprints.has(moduleId)) {
      if (await moduleSupportsAddon(moduleId, ['gamification', 'lucid_studio_gamification'])) {
        return moduleId;
      }
    }
  }
  
  return null;
}

async function pollLoop() {
  console.log('[GAMIFICATION WORKER] Polling for completed modules missing gamification sprints...');
  let idleCount = 0;
  const MIN_POLL_MS = 15000;
  const MAX_POLL_MS = 120000;

  while (true) {
    try {
      const moduleId = await fetchNextPendingModule();

      if (!moduleId) {
        idleCount++;
        console.log('[GAMIFICATION WORKER] No eligible completed modules right now.');
      } else {
        idleCount = 0;
        console.log(`[GAMIFICATION WORKER] Found eligible module: ${moduleId}`);
        await generateModuleGamification({ moduleId });
      }
    } catch (error) {
      console.error('[GAMIFICATION WORKER] Poll loop error:', error.message || error);
    }

    const backoff = Math.min(MIN_POLL_MS * Math.pow(2, idleCount), MAX_POLL_MS);
    await sleep(backoff);
  }
}

module.exports = { generateModuleGamification, pollLoop };

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--poll')) {
    pollLoop().catch((error) => {
      console.error('[GAMIFICATION WORKER] Poll loop crashed:', error);
      process.exit(1);
    });
  } else {
    const idxModule = args.findIndex((arg) => arg === '--module');
    const moduleId = idxModule >= 0 ? args[idxModule + 1] : null;

    if (!moduleId) {
      console.error('Usage: node generate-module-gamification.js --module <module_id>');
      process.exit(1);
    }

    generateModuleGamification({ moduleId })
      .then((result) => {
        console.log('[GAMIFICATION WORKER] done:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('[GAMIFICATION WORKER] failed:', error);
        process.exit(1);
      });
  }
}
