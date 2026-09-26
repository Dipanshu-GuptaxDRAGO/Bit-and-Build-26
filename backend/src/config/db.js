const { Pool } = require('pg');
const { database } = require('./env');
const pool = new Pool({
  ...database,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
});
pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message || error.code || 'Unknown error');
});
module.exports = pool;
