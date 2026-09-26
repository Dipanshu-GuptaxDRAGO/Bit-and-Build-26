const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const { main } = require('./simulate');

let attempts = 0;
const original = pool.query.bind(pool);
pool.query = async (...args) => {
  if (++attempts === 1) throw Object.assign(new Error('Simulated connection drop'), {code:'ECONNRESET'});
  return original(...args);
};

main({ delayMs: 1, runTick: async () => {
  await pool.query('SELECT 1');
  process.emit('SIGTERM');
} }).then(() => {
  assert.equal(attempts, 2);
  console.log('PASS: failed DB call was caught; next tick queried real PostgreSQL successfully; clean shutdown.');
}).catch(error => { console.error(error); process.exitCode = 1; });
