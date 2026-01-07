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

  try {
    console.log('\n--- listing available models ---');
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const listResp = await fetch(listUrl, { method: 'GET' });
    const listData = await listResp.json();
    if (listData.models) {
      listData.models.forEach(m => {
        console.log(`Model: ${m.name}, Methods: ${m.supportedGenerationMethods}`);
      });
    } else {
      console.log('No models found in response:', JSON.stringify(listData, null, 2));
    }
  } catch (e) {
    console.warn('models list error', e && e.message ? e.message : e);
  }

}

probe();
