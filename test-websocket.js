// // Simple WebSocket test script
// const WebSocket = require('ws');

// const ws = new WebSocket('ws://localhost:3001/api/module-chat');

// ws.on('open', function open() {
//   console.log('WebSocket connected successfully!');

//   // Send a test audio chunk (just some dummy data)
//   const testData = Buffer.from('test audio data');
//   ws.send(testData);
//   console.log('Sent test audio data');
// });

// ws.on('message', function message(data) {
//   console.log('Received:', data.toString());
// });

// ws.on('error', function error(err) {
//   console.error('WebSocket error:', err);
// });

// ws.on('close', function close() {
//   console.log('WebSocket connection closed');
// });

// // Close after 5 seconds
// setTimeout(() => {
//   ws.close();
//   console.log('Test completed');
// }, 5000);