/**
 * setup-db.js
 * -----------
 * Reads schema.sql and executes it against the Postgres database
 * configured in .env.  Run once to bootstrap fresh tables:
 *
 *   node src/scripts/setup-db.js
 */
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const pool = require('../config/db');

const run = async () => {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  console.log('Running schema creation…');

  try {
    await pool.query(sql);
    console.log('✔  Tables created successfully.');
  } catch (err) {
    console.error('✖  Schema creation failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

run();
