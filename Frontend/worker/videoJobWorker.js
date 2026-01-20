require('./env').loadWorkerEnv();

const path = require('path');

console.log('Loading generate-module-video (polling)...');
const { pollLoop } = require(path.join(__dirname, 'api/generate-module-video'));

pollLoop().catch((e) => {
  console.error('Video worker crashed:', e);
  process.exit(1);
});
