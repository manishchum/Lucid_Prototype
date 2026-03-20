require('./env').loadWorkerEnv();

const path = require('path');

console.log('Loading generate-module-mindmap (polling)...');
const { pollLoop } = require(path.join(__dirname, 'api/generate-module-mindmap'));

pollLoop().catch((e) => {
  console.error('Mindmap worker crashed:', e);
  process.exit(1);
});
