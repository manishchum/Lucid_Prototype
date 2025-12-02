const fs = require('fs');
const path = require('path');

const FRONTEND = path.resolve(__dirname, '..');

function readEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const out = {};
    for (const l of lines) {
      const m = l.match(/^\s*([A-Z0-9_]+)=(.*)$/);
      if (m) {
        out[m[1]] = m[2].trim();
      }
    }
    return out;
  } catch (e) {
    return {};
  }
}

function getGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const candidates = [path.join(FRONTEND, '.env.local'), path.join(FRONTEND, '.env')];
  for (const c of candidates) {
    const parsed = readEnvFile(c);
    if (parsed.GEMINI_API_KEY) return parsed.GEMINI_API_KEY;
  }
  return null;
}

async function probe() {
  const key = getGeminiKey();
  if (!key) {
    console.error('No GEMINI_API_KEY found in process.env or Frontend/.env(.local)');
    process.exit(2);
  }

  // Try listing available models for this key (may return 403/404 if not permitted)
  try {
    console.log('\n--- listing available models (may require permission) ---');
    const listUrl = `https://generativelanguage.googleapis.com/v1/models?key=${key}`;
    const listResp = await fetch(listUrl, { method: 'GET' });
    const listText = await listResp.text();
    console.log('models list status', listResp.status);
    try { console.log('models list body', JSON.stringify(JSON.parse(listText), null, 2)); } catch (e) { console.log('models list raw:', listText.slice(0,2000)); }
  } catch (e) {
    console.warn('models list error', e && e.message ? e.message : e);
  }

  // Probe only the preferred model to reduce noise and speed up checks
  const models = [
    'gemini-2.5-flash-lite'
  ];

  // Hardcode the probe URL to the preferred model
  const probeModel = 'gemini-2.5-flash-lite'
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1/models/${probeModel}:generateContent?key=${key}`;
    const body = {
      prompt: { text: 'Please reply with a short friendly sentence: Hello from Gemini model ' + model },
      temperature: 0.2,
      maxOutputTokens: 128,
      candidateCount: 1
    };
    console.log('\n--- probing model', model, '---');
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await resp.text();
      console.log('status', resp.status);
      try {
        console.log('body', JSON.stringify(JSON.parse(text), null, 2));
      } catch (e) {
        console.log('body (raw):', text.slice(0, 2000));
      }
    } catch (err) {
      console.error('network error', err && err.message ? err.message : err);
    }
  }
}

probe();
