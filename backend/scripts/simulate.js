const pool = require('../src/config/db');
const Incident = require('../src/models/incident');
const types = ['fire', 'medical', 'security', 'other'];
const intervalMs = 5000;

async function tick(db = pool, random = Math.random, log = console.log) {
  if (random() < 0.20) {
    const incident = await Incident.create({
      type: types[Math.floor(random() * types.length)],
      severity: 1 + Math.floor(random() * 5),
      lat: 12.83 + random() * 0.22,
      lon: 77.45 + random() * 0.30,
    }, db);
    log(`Created new ${incident.type} incident at ${incident.lat.toFixed(5)}, ${incident.lon.toFixed(5)} (${incident.id})`);
  } else {
    log('No new incident this tick.');
  }

  // Lock only currently available rows. SKIP LOCKED avoids competing with a
  // teammate's matcher. Selection and position update form one atomic statement.
  const result = await db.query(`
    WITH selected AS (
      SELECT id FROM responders WHERE status = 'available'
      ORDER BY random() LIMIT $1 FOR UPDATE SKIP LOCKED
    )
    UPDATE responders AS r SET
      lat = GREATEST(12.83, LEAST(13.05, r.lat + (random() * 0.004 - 0.002))),
      lon = GREATEST(77.45, LEAST(77.75, r.lon + (random() * 0.004 - 0.002))),
      last_updated_at = clock_timestamp()
    FROM selected WHERE r.id = selected.id AND r.status = 'available'
    RETURNING r.id, r.name, r.lat, r.lon
  `, [2 + Math.floor(random() * 2)]);
  for (const responder of result.rows) {
    log(`Updated position for responder ${responder.name}: ${responder.lat.toFixed(5)}, ${responder.lon.toFixed(5)}`);
  }
  if (!result.rowCount) log('No available responders to move.');
}

async function main({ runTick = tick, delayMs = intervalMs } = {}) {
  let stopping = false;
  let timer;
  let wake;
  const stop = () => {
    stopping = true;
    clearTimeout(timer);
    if (wake) wake();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('Simulation started: 5-second interval, 20% incident chance per tick. Ctrl+C to stop.');
  try {
    while (!stopping) {
      try { await runTick(); }
      catch (error) { console.error('Simulation tick failed; retrying next tick:', error.message || error.code); }
      if (!stopping) await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, delayMs); });
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await pool.end();
    console.log('Simulation stopped.');
  }
}

if (require.main === module) main().catch(error => {
  console.error('Simulation failed:', error.message || error.code);
  process.exitCode = 1;
});
module.exports = { tick, main };
