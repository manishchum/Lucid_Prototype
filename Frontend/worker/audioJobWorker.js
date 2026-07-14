require('./env').loadWorkerEnv();

const path = require('path');

// console.log('Loading generate-module-audio (polling)...');
const { pollLoop } = require(path.join(__dirname, 'api/generate-module-audio'));

pollLoop().catch((e) => {
  console.error('Audio worker crashed:', e);
  process.exit(1);
});
