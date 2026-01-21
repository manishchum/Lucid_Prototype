const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadWorkerEnv() {
  // worker/* lives under Frontend/worker
  const frontendRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(frontendRoot, '..');

  const candidates = [
    path.join(frontendRoot, '.env.local'),
    path.join(frontendRoot, '.env'),
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p });
        if (!global.__workerEnvLoaded) {
          console.log('[WORKER ENV] Loaded', p);
          global.__workerEnvLoaded = true;
        }
        return p;
      }
    } catch (e) {
      // ignore
    }
  }

  // Fall back to default dotenv behavior (CWD) if nothing found.
  dotenv.config();
  if (!global.__workerEnvLoaded) {
    console.log('[WORKER ENV] Loaded from default dotenv search (no explicit file found)');
    global.__workerEnvLoaded = true;
  }
  return null;
}

module.exports = { loadWorkerEnv };
