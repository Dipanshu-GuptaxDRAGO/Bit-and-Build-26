/**
 * test-insert.js
 * ---------------
 * Quick smoke test: inserts one incident, one responder, one dispatch log,
 * then queries them back.  Run after setup-db.js:
 *
 *   node src/scripts/test-insert.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const Incident    = require('../models/incident');
const Responder   = require('../models/responder');
const DispatchLog = require('../models/dispatchLog');
const pool        = require('../config/db');

const run = async () => {
  try {
    // 1. Create a test incident
    const incident = await Incident.create({
      type: 'fire',
      severity: 4,
      lat: 40.7128,
      lon: -74.0060,
    });
    console.log('✔  Incident created:', incident);

    // 2. Create a test responder
    const responder = await Responder.create({
      name: 'Spider-Man',
      type: 'fire',
      lat: 40.7580,
      lon: -73.9855,
    });
    console.log('✔  Responder created:', responder);

    // 3. Create a dispatch log entry
    const log = await DispatchLog.create({
      incident_id: incident.id,
      responder_id: responder.id,
      action: 'assigned',
    });
    console.log('✔  DispatchLog created:', log);

    // 4. Query back
    const fetchedIncident = await Incident.findById(incident.id);
    console.log('\n--- findById (Incident) ---');
    console.log(fetchedIncident);

    const allIncidents = await Incident.findAll({ status: 'pending' });
    console.log(`\n--- findAll pending incidents: ${allIncidents.length} row(s) ---`);

    const allResponders = await Responder.findAll({ status: 'available' });
    console.log(`--- findAll available responders: ${allResponders.length} row(s) ---`);

    const allLogs = await DispatchLog.findAll();
    console.log(`--- findAll dispatch logs: ${allLogs.length} row(s) ---`);

    console.log('\n✔  All smoke tests passed!');
  } catch (err) {
    console.error('✖  Test failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

run();
