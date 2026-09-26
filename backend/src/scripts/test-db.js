const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const pool = require('../config/db');
const Incident = require('../models/incident');
const Responder = require('../models/responder');
const DispatchLog = require('../models/dispatchLog');

async function main() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const incident = await Incident.create({ type: 'fire', severity: 4, lat: 12.94, lon: 77.61 }, client);
    const responder = await Responder.create({ name: 'Layer 2 test responder', type: 'fire', lat: 12.95, lon: 77.62 }, client);
    const log = await DispatchLog.create({ incident_id: incident.id, responder_id: responder.id, action: 'assigned' }, client);
    assert.equal(incident.status, 'pending');
    assert.equal(incident.assigned_responder_id, null);
    assert.equal(responder.status, 'available');
    assert.equal(responder.current_incident_id, null);
    for (const [row, field] of [[incident, 'reported_at'], [responder, 'last_updated_at'], [log, 'timestamp']]) {
      assert.match(row.id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
      assert.ok(row[field] instanceof Date && !Number.isNaN(row[field].getTime()));
    }
    const specifications = [
      [Incident, incident, { status: 'pending' }, { status: 'resolved' }, 'reported_at'],
      [Responder, responder, { status: 'available' }, { status: 'busy' }, 'last_updated_at'],
      [DispatchLog, log, { action: 'assigned' }, { action: 'timeout' }, 'timestamp'],
    ];
    for (const [model, row, matching, other, time] of specifications) {
      assert.deepEqual(await model.findById(row.id, client), row);
      assert.equal(await model.findById(randomUUID(), client), null);
      assert.ok((await model.findAll(matching, client)).some(item => item.id === row.id));
      assert.ok(!(await model.findAll(other, client)).some(item => item.id === row.id));
      const all = await model.findAll({}, client);
      assert.ok(all.some(item => item.id === row.id));
      for (let i = 1; i < all.length; i++) assert.ok(all[i - 1][time] >= all[i][time]);
    }
    console.log('PASS: create, findAll, filters, findById, UUID/timestamp defaults, and nullable links.');

    async function rejects(sql, values, code) {
      await client.query('SAVEPOINT invalid_input');
      try {
        await assert.rejects(client.query(sql, values), error => error.code === code);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT invalid_input');
        await client.query('RELEASE SAVEPOINT invalid_input');
      }
    }
    for (const severity of [0, 6]) {
      await rejects('UPDATE incidents SET severity = $1 WHERE id = $2', [severity, incident.id], '23514');
    }
    await rejects('UPDATE incidents SET severity = $1 WHERE id = $2', ['1.5', incident.id], '22P02');
    for (const [table, row, field] of [
      ['incidents', incident, 'type'], ['incidents', incident, 'status'],
      ['responders', responder, 'type'], ['responders', responder, 'status'],
      ['dispatch_logs', log, 'action'],
    ]) {
      // Table/column identifiers are constants above, never user input.
      await rejects(`UPDATE ${table} SET ${field} = $1 WHERE id = $2`, ['invalid', row.id], '23514');
      await rejects(`UPDATE ${table} SET ${field} = NULL WHERE id = $1`, [row.id], '23502');
    }
    await rejects('INSERT INTO incidents (id, type, severity, lat, lon) VALUES ($1, $2, 1, 0, 0)', [incident.id, 'fire'], '23505');
    console.log('PASS: enum, severity, required-field, and primary-key constraints.');
    console.log('Inserted and queried test incident:', JSON.stringify(incident));
  } finally {
    if (client) {
      try { await client.query('ROLLBACK'); }
      finally { client.release(); }
    }
    await pool.end();
  }
  console.log('PASS: all test rows rolled back; existing data preserved.');
}

main().catch(error => {
  console.error('Database test failed:', error.message || error.code);
  process.exitCode = 1;
});
