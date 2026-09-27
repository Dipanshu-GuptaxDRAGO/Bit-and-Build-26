'use strict';
// One production backend. Historical Map-based examples remain in demo-server.js.
const unified = require('../../database/database/server');
if (require.main === module) unified.start().catch(async error => {
 console.error('Startup failed:', error.message);
 process.exitCode = 1;
 await require('../../database/database/src/services/dispatch').stopRecovery();
 await require('../../database/database/src/config/db').end();
});
module.exports = unified.app;
