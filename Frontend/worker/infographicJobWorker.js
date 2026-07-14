require('./env').loadWorkerEnv();

const path = require('path');

console.log('Loading generate-module-infographic (polling)...');
const { pollLoop } = require(path.join(__dirname, 'api/generate-module-infographic'));

pollLoop().catch((e) => {
  console.error('Infographic worker crashed:', e);
  process.exit(1);
});
