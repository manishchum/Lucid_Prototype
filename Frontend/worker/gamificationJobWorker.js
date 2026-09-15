require('./env').loadWorkerEnv();

const path = require('path');

console.log('Loading generate-module-gamification (polling)...');
const { pollLoop } = require(path.join(__dirname, 'api/generate-module-gamification'));

pollLoop().catch((e) => {
  console.error('Gamification worker crashed:', e);
  process.exit(1);
});
