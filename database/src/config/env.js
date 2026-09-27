const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
function port(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return Number(value);
}
module.exports = {
  port: port('PORT', '3000'),
  database: process.env.DATABASE_URL ? {
    connectionString: process.env.DATABASE_URL,
    ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  } : {
    host: required('DB_HOST'),
    port: port('DB_PORT', '5432'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
  },
};
