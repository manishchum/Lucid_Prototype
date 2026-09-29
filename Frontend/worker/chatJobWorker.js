require('./env').loadWorkerEnv();

const path = require('path');

console.log('Loading generate-module-chat (polling)...');
const { pollLoop } = require(path.join(__dirname, 'api/generate-module-chat'));

pollLoop().catch((e) => {
  console.error('Chat RAG worker crashed:', e);
  process.exit(1);
});
