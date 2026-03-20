require('./env').loadWorkerEnv();

const path = require('path');

console.log('Loading generate-module-flashcards (polling)...');
const { pollLoop } = require(path.join(__dirname, 'api/generate-module-flashcards'));

pollLoop().catch((e) => {
  console.error('Flashcard worker crashed:', e);
  process.exit(1);
});
