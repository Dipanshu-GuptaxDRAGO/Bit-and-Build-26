const pool = require('../src/config/db');

const names = ['Asha Rao', 'Arjun Kumar', 'Meera Nair', 'Vikram Shah', 'Priya Menon',
  'Rohan Das', 'Kavya Reddy', 'Aditya Shetty', 'Neha Patil', 'Rahul Joshi',
  'Divya Iyer', 'Kiran Gowda', 'Ananya Singh', 'Sanjay Prasad', 'Pooja Hegde',
  'Nikhil Bhat', 'Sneha Kulkarni', 'Varun Pai', 'Deepa Sharma', 'Ajay Naik'];
const types = ['fire', 'medical', 'security', 'other'];

async function main() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialize seed runs and other inserts so the empty-table check is reliable.
    await client.query('LOCK TABLE responders IN SHARE ROW EXCLUSIVE MODE');
    const existing = await client.query('SELECT 1 FROM responders LIMIT 1');
    if (existing.rowCount) {
      console.log('Responders already exist; seed skipped without changing existing data.');
    } else {
      for (const name of names) {
        await client.query(
          'INSERT INTO responders (name, type, lat, lon) VALUES ($1, $2, $3, $4)',
          [name, types[Math.floor(Math.random() * types.length)],
            12.83 + Math.random() * 0.22, 77.45 + Math.random() * 0.30],
        );
      }
      console.log(`Seeded ${names.length} available responders in Bangalore.`);
    }
    await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Seed failed:', error.message || error.code);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main();
