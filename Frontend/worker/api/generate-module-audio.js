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
const WORKER_INTERNAL_TOKEN = process.env.AI_GATEWAY_INTERNAL_TOKEN || '';

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
const ACTIVE_JOB_STATUSES = ['pending', 'in-progress'];

const moduleAddonCache = new Map();

function normalizeAddonKey(addon) {
  return String(addon || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

const LANGUAGE_ALIAS_TO_CODE = {
  english: 'en',
  en: 'en',
  hindi: 'hinglish',
  hi: 'hinglish',
  hinglish: 'hinglish',
  german: 'de',
  de: 'de',
  russian: 'ru',
  ru: 'ru',
  french: 'fr',
  fr: 'fr',
  italian: 'it',
  it: 'it',
  spanish: 'es',
  es: 'es',
  polish: 'pl',
  pl: 'pl',
  ukrainian: 'uk',
  uk: 'uk',
  romanian: 'ro',
  ro: 'ro',
  dutch: 'nl',
  nl: 'nl',
  bengali: 'bn',
  bn: 'bn',
  tamil: 'ta',
  ta: 'ta',
  telugu: 'te',
  te: 'te',
  marathi: 'mr',
  mr: 'mr',
  kannada: 'kn',
  kn: 'kn',
  punjabi: 'pa',
  pa: 'pa',
  gujarati: 'gu',
  gu: 'gu',
  urdu: 'ur',
  ur: 'ur',
  odia: 'or',
  or: 'or',
};

const LANGUAGE_CODE_TO_SUFFIX = {
  en: '',
  hinglish: 'hinglish',
  de: 'german',
  ru: 'russian',
  fr: 'french',
  it: 'italian',
  es: 'spanish',
  pl: 'polish',
  uk: 'ukrainian',
  ro: 'romanian',
  nl: 'dutch',
  bn: 'bengali',
  ta: 'tamil',
  te: 'telugu',
  mr: 'marathi',
  kn: 'kannada',
  pa: 'punjabi',
  gu: 'gujarati',
  ur: 'urdu',
  or: 'odia',
};

const SUPPORTED_PODCAST_LANGUAGE_CODES = new Set(Object.keys(LANGUAGE_CODE_TO_SUFFIX));

function normalizeLanguage(language) {
  if (!language) return 'en';
  const normalized = String(language).trim().toLowerCase().replace(/[-\s]+/g, '_');
  return LANGUAGE_ALIAS_TO_CODE[normalized] || 'en';
}

function getLocalizedFieldName(language, kind) {
  const normalized = normalizeLanguage(language);
  const suffix = LANGUAGE_CODE_TO_SUFFIX[normalized] || '';
  if (kind === 'audio') {
    return suffix ? `audio_url_${suffix}` : 'audio_url';
  }
  if (kind === 'transcript') {
    return suffix ? `podcast_transcript_${suffix}` : 'podcast_transcript';
  }
  return suffix ? `podcast_timeline_${suffix}` : 'podcast_timeline';
}

function getCompanyAllowedLanguageCodes(addons) {
  if (!Array.isArray(addons) || addons.length === 0) {
    return new Set(['en', 'hinglish']);
  }
  const normalized = new Set();
  for (const raw of addons) {
    if (!raw) continue;
    const addonKey = String(raw).trim().toLowerCase().replace(/[-\s]+/g, '_');
    if (!LANGUAGE_ALIAS_TO_CODE[addonKey]) continue;
    const code = LANGUAGE_ALIAS_TO_CODE[addonKey];
    if (SUPPORTED_PODCAST_LANGUAGE_CODES.has(code)) {
      normalized.add(code);
    }
  }
  return normalized.size > 0 ? normalized : new Set(['en', 'hinglish']);
}

function needsAudioForLanguage(row, language) {
  if (!row || !language) return false;
  const field = getLocalizedFieldName(language, 'audio');
  return !hasNonEmptyString(row[field]);
}

function hasAnyMissingAudio(row, allowedLanguages) {
  if (!row || !Array.isArray(allowedLanguages)) return false;
  return allowedLanguages.some((lang) => needsAudioForLanguage(row, lang));
}

function getAudioColumnsForLanguages(languages) {
  const columns = new Set(['processed_module_id', 'original_module_id', 'content', 'audio_url', 'audio_url_hinglish']);
  for (const language of languages) {
    const normalized = normalizeLanguage(language);
    if (normalized === 'en' || normalized === 'hinglish') continue;
    const column = getLocalizedFieldName(normalized, 'audio');
    columns.add(column);
  }
  return Array.from(columns);
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

async function getModuleContext(moduleId) {
  if (!moduleId) return { companyId: null, userId: null };

  const { data, error } = await supabase
    .from('training_modules')
    .select('company_id, uploaded_by')
    .eq('module_id', moduleId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to resolve training module context for ${moduleId}: ${error?.message || 'not found'}`);
  }

  return {
    companyId: data.company_id || null,
    userId: data.uploaded_by || null,
  };
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


function isEligible(row, allowedLanguages) {
  const content = typeof row.content === 'string' ? row.content.trim() : '';
  if (content.length < MIN_CONTENT_LENGTH) return false;
  return hasAnyMissingAudio(row, Array.from(allowedLanguages));
}

async function callTtsForLanguage(processedModuleId, language, companyId, userId) {
  const normalizedLanguage = normalizeLanguage(language);
  console.log(`[AUDIO WORKER] Requesting ${normalizedLanguage} audio for ${processedModuleId}`);

  let lastError = null;

  for (const baseUrl of API_BASE_URLS) {
    const url = `${baseUrl}/api/tts`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Internal-Token': WORKER_INTERNAL_TOKEN,
          'X-User-ID': userId,
          'X-Company-ID': companyId,
        },
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
          const col = getLocalizedFieldName(normalizedLanguage, 'audio');

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
  const companyAddons = await getCompanySubscriptionAddonsForModule(row.original_module_id || row.original_module_id);
  const allowedLanguages = getCompanyAllowedLanguageCodes(Array.from(companyAddons));
  const moduleContext = await getModuleContext(row.original_module_id);

  if (normalizedForceLanguage) {
    await callTtsForLanguage(processedModuleId, normalizedForceLanguage, moduleContext.companyId, moduleContext.userId);
    return { ok: true, processedModuleId, generated: [normalizedForceLanguage] };
  }

  const generated = [];
  for (const language of allowedLanguages) {
    if (needsAudioForLanguage(row, language)) {
      await callTtsForLanguage(processedModuleId, language, moduleContext.companyId, moduleContext.userId);
      generated.push(language);
    }
  }

  if (generated.length === 0) {
    console.log(`[AUDIO WORKER] Skipping ${processedModuleId}; all enabled language audio already present.`);
  }

  return { ok: true, processedModuleId, generated };
}

async function fetchRowByProcessedId(processedModuleId) {
  const { data: pmData, error: pmError } = await supabase
    .from('processed_modules')
    .select('processed_module_id, original_module_id')
    .eq('processed_module_id', processedModuleId)
    .maybeSingle();

  if (pmError) {
    throw new Error(`Processed module lookup failed: ${pmError.message}`);
  }

  if (!pmData) {
    throw new Error(`processed_module_id not found: ${processedModuleId}`);
  }

  const { data, error } = await supabase
    .from('processed_modules')
    .select('*')
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
    .select('processed_module_id, original_module_id, content, audio_url, audio_url_hinglish')
    .in('original_module_id', activeModuleIds)
    .not('content', 'is', null)
    .neq('content', '')
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    throw new Error(`Pending row fetch failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];

  for (const row of rows) {
    if (!row.original_module_id) continue;
    if (!(await moduleSupportsAddon(row.original_module_id, 'lucid_studio_podcast'))) continue;

    const allowedLanguages = getCompanyAllowedLanguageCodes(Array.from(await getCompanySubscriptionAddonsForModule(row.original_module_id)));
    const candidateRow = await fetchRowByProcessedId(row.processed_module_id);
    if (!isEligible(candidateRow, Array.from(allowedLanguages))) continue;

    return candidateRow;
  }

  if (rows.length > 0) {
    console.log(`[AUDIO WORKER] Pending rows fetched=${rows.length}, but none were eligible or had podcast addon enabled.`);
  }

  return null;
}

async function generateModuleAudio({ moduleId = null, processedModuleId = null, language = null } = {}) {
  if (processedModuleId) {
    const row = await fetchRowByProcessedId(processedModuleId);
    const allowedLanguages = getCompanyAllowedLanguageCodes(Array.from(await getCompanySubscriptionAddonsForModule(row.original_module_id)));
    if (!isEligible(row, Array.from(allowedLanguages)) && !language) {
      return { ok: true, skipped: true, reason: 'No missing audio or content too short for this processed_module_id' };
    }

    if (row.original_module_id && !(await moduleSupportsAddon(row.original_module_id, 'lucid_studio_podcast'))) {
      return { ok: true, skipped: true, reason: 'Podcast addon disabled for this module company' };
    }

    return processProcessedModuleRow(row, language);
  }

  if (moduleId) {
    if (!(await moduleSupportsAddon(moduleId, 'lucid_studio_podcast'))) {
      return { ok: true, skipped: true, reason: 'Podcast addon disabled for this module company' };
    }

    const { data, error } = await supabase
      .from('processed_modules')
      .select('processed_module_id, original_module_id, content, audio_url, audio_url_hinglish')
      .eq('original_module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Module lookup failed: ${error.message}`);
    }

    const rows = [];
    for (const row of (data || [])) {
      const allowedLanguages = getCompanyAllowedLanguageCodes(Array.from(await getCompanySubscriptionAddonsForModule(row.original_module_id)));
      if (isEligible(row, Array.from(allowedLanguages)) || language) {
        rows.push(row);
      }
    }

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