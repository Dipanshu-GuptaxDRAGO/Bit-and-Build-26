const pool = require('../config/db');
async function main() {
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connection successful.');
  } catch (error) {
    console.error('PostgreSQL connection failed:', error.message || error.code || 'Unknown error');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main();
