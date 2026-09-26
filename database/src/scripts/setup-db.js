const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../config/db');

async function main() {
  let client;
  try {
    const sql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Database setup complete: incidents, responders, dispatch_logs.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Database setup failed:', error.message || error.code);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main();
