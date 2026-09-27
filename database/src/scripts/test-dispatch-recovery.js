'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { database } = require('../config/env');
const pool = require('../config/db');
const schema = `recovery_test_${randomUUID().replaceAll('-', '')}`;
pool.options.options = `-c search_path=${schema}`;
const admin = new Pool(database);
const Incident = require('../models/incident');
const Responder = require('../models/responder');
const Log = require('../models/dispatchLog');
const dispatch = require('../services/dispatch');
const { app } = require('../../server');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 5000) {
  const end = Date.now() + timeout;
  do { if (await check()) return; await delay(50); } while (Date.now() < end);
  assert.fail('Timed out waiting for recovery');
}
const create = (severity = 5) => Incident.create({ type: 'fire', severity, lat: 12.94, lon: 77.61 });
const expire = id => pool.query("UPDATE incidents SET confirmation_deadline = clock_timestamp() - INTERVAL '1 second' WHERE id = $1", [id]);

async function main() {
  let server;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(sql); // migration is rerunnable
    const responders = [];
    for (let n = 0; n < 3; n++) responders.push(await Responder.create({ name: `Recovery ${n}`, type: 'fire', lat: 12.94 + n * .01, lon: 77.61 }));
    // Upgrade a pre-migration assignment and verify reruns don't extend deadlines.
    const legacy = await create();
    await Responder.claimResponder(responders[0].id);
    await Responder.updateStatus(responders[0].id, 'claimed', { current_incident_id: legacy.id });
    await Incident.updateStatus(legacy.id, 'assigned', { assigned_responder_id: responders[0].id });
    await pool.query(sql);
    const upgraded = await Incident.findById(legacy.id);
    assert.ok(upgraded.assignment_id); assert.ok(upgraded.confirmation_deadline);
    await pool.query(sql);
    const rerun = await Incident.findById(legacy.id);
    assert.equal(rerun.assignment_id, upgraded.assignment_id);
    assert.equal(rerun.confirmation_deadline.getTime(), upgraded.confirmation_deadline.getTime());
    await dispatch.dispatchResolve(legacy.id);
    console.log('PASS: legacy assignment migration preserves data and deadlines across reruns.');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function post(action, data, status = 200) {
      const response = await fetch(`${base}/dispatch/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      return body;
    }
    // One-responder contention: severity wins in either request arrival order.
    for (const r of responders.slice(1)) await Responder.updateStatus(r.id, 'busy');
    for (const reverse of [false, true]) {
      const low = await create(1), high = await create(5);
      const ids = reverse ? [high.id, low.id] : [low.id, high.id];
      const results = await Promise.all(ids.map(incident_id => post('match', { incident_id })));
      assert.equal(results.find(r => r.ok).incident.id, high.id);
      assert.equal(results.filter(r => r.ok).length, 1);
      await dispatch.dispatchResolve(high.id);
    }
    // Equal severity retains request order within the admission batch.
    const equal = await Promise.all([create(4), create(4)]);
    const equalResults = await Promise.all(equal.map(i => dispatch.dispatchMatch(i.id)));
    assert.equal(equalResults[0].ok, true); assert.equal(equalResults[1].ok, false);
    await dispatch.dispatchResolve(equal[0].id);
    for (const r of responders.slice(1)) await Responder.updateStatus(r.id, 'available');
    console.log('PASS: HTTP severity priority in both arrival orders; FIFO ties.');

    const stale = await create();
    const old = await dispatch.dispatchMatch(stale.id);
    await post('confirm', { incident_id: stale.id }, 400);
    await expire(stale.id);
    const expired = await post('confirm', { incident_id: stale.id, assignment_id: old.incident.assignment_id }, 409);
    assert.equal(expired.reason, 'confirmation_expired');
    const replacement = await dispatch.handleTimeout(stale.id, old.incident.assignment_id);
    assert.notEqual(old.responder.id, replacement.responder.id);
    const rejected = await post('confirm', { incident_id: stale.id, assignment_id: old.incident.assignment_id }, 409);
    assert.equal(rejected.reason, 'stale_assignment');
    assert.equal((await Responder.findById(replacement.responder.id)).status, 'claimed');
    // Return to the original responder: the old token must still be invalid.
    await expire(stale.id);
    const third = await dispatch.handleTimeout(stale.id, replacement.incident.assignment_id);
    assert.equal(third.responder.id, old.responder.id);
    await post('confirm', { incident_id: stale.id, assignment_id: old.incident.assignment_id }, 409);
    await post('confirm', { incident_id: stale.id.toUpperCase(), assignment_id: third.incident.assignment_id.toUpperCase() });
    await post('confirm', { incident_id: stale.id, assignment_id: third.incident.assignment_id });
    await dispatch.handleTimeout(stale.id, third.incident.assignment_id);
    assert.equal((await Responder.findById(third.responder.id)).status, 'en_route');
    await dispatch.dispatchResolve(stale.id);
    console.log('PASS: missing/expired/stale confirmations rejected, including responder reuse; current token confirms idempotently.');

    const retry = await create();
    const initial = await dispatch.dispatchMatch(retry.id);
    await expire(retry.id);
    const append = Log.append;
    try {
      Log.append = async (data, ...args) => {
        if (data.action === 'reassigned') throw new Error('Injected retry failure');
        return append(data, ...args);
      };
      await assert.rejects(dispatch.handleTimeout(retry.id, initial.incident.assignment_id), /Injected retry failure/);
    } finally { Log.append = append; }
    const pending = await Incident.findById(retry.id);
    assert.equal(pending.status, 'pending');
    assert.ok(pending.dispatch_retry_at);
    assert.equal(pending.excluded_responder_id, initial.responder.id);
    assert.equal((await Responder.findAll({ status: 'available' })).length, 3);
    // Startup immediately resumes a persisted failed re-match.
    await dispatch.startRecovery();
    const recovered = await Incident.findById(retry.id);
    assert.equal(recovered.status, 'assigned');
    assert.notEqual(recovered.assigned_responder_id, initial.responder.id);
    assert.equal(recovered.dispatch_retry_at, null);
    await dispatch.dispatchResolve(retry.id);
    console.log('PASS: failed re-match persists across recovery and excludes the timed-out responder.');

    // Failure during the periodic worker is retried without a restart or request.
    const polling = await create(); const pollingMatch = await dispatch.dispatchMatch(polling.id);
    let failures = 0;
    try {
      Log.append = async (data, ...args) => {
        if (data.incident_id === polling.id && data.action === 'reassigned' && failures++ === 0) throw new Error('Injected one-time worker failure');
        return append(data, ...args);
      };
      await expire(polling.id);
      await until(async () => {
        const row = await Incident.findById(polling.id);
        return row.status === 'assigned' && row.assignment_id !== pollingMatch.incident.assignment_id;
      });
      assert.ok(failures >= 2);
    } finally { Log.append = append; }
    await dispatch.dispatchResolve(polling.id);
    await dispatch.stopRecovery();
    console.log('PASS: background retry recovers automatically after transient re-match failure.');

    // A real separate process creates a claim and exits without running its timer.
    const restart = await create();
    const childSource = `
      const pool = require('./src/config/db');
      pool.options.options = '-c search_path=' + process.env.DISPATCH_TEST_SCHEMA;
      const d = require('./src/services/dispatch');
      d.dispatchMatch(process.env.DISPATCH_TEST_INCIDENT).then(result => {
        if (!result.ok) throw new Error('Child assignment failed');
        process.exit(0);
      }).catch(error => { console.error(error); process.exit(1); });
    `;
    const child = spawnSync(process.execPath, ['-e', childSource], {
      cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 10000,
      env: { ...process.env, DISPATCH_TEST_SCHEMA: schema, DISPATCH_TEST_INCIDENT: restart.id },
    });
    assert.equal(child.status, 0, child.stderr);
    const abandoned = await Incident.findById(restart.id);
    assert.ok(abandoned.confirmation_deadline);
    // Start recovery BEFORE expiry; it must retain the original persisted deadline.
    await dispatch.startRecovery();
    assert.equal((await Incident.findById(restart.id)).assignment_id, abandoned.assignment_id);
    await until(async () => {
      const row = await Incident.findById(restart.id);
      return row.status === 'assigned' && row.assignment_id !== abandoned.assignment_id;
    }, 18000);
    const restarted = await Incident.findById(restart.id);
    assert.equal(restarted.status, 'assigned');
    assert.notEqual(restarted.assigned_responder_id, abandoned.assigned_responder_id);
    const logs = await Log.findByIncident(restart.id);
    assert.deepEqual(logs.map(l => l.action), ['assigned', 'timeout', 'reassigned']);
    await dispatch.dispatchResolve(restart.id);
    console.log('PASS: actual process exit and restart recovery honors the persisted 15-second deadline.');

    // Recover an overdue claim immediately, then repeated/concurrent scans are safe.
    await dispatch.stopRecovery();
    const overdue = await create(); const overdueMatch = await dispatch.dispatchMatch(overdue.id);
    await expire(overdue.id);
    await dispatch.startRecovery();
    await Promise.all([dispatch.recoverDispatches(), dispatch.recoverDispatches()]);
    const after = await Incident.findById(overdue.id);
    assert.notEqual(after.assignment_id, overdueMatch.incident.assignment_id);
    assert.equal((await Log.findByIncident(overdue.id)).filter(l => l.action === 'timeout').length, 1);
    await dispatch.dispatchResolve(overdue.id);
    console.log('PASS: overdue startup recovery and duplicate scans do not duplicate timeout/assignment work.');
    const stress = await Promise.all(Array.from({ length: 50 }, () => create()));
    const results = await Promise.all(stress.map(i => dispatch.dispatchMatch(i.id)));
    const wins = results.filter(r => r.ok);
    assert.equal(wins.length, 3);
    assert.equal(new Set(wins.map(r => r.responder.id)).size, 3);
    assert.equal(results.filter(r => r.reason === 'no_responder_available').length, 47);
    await Promise.all(wins.map(r => dispatch.dispatchResolve(r.incident.id)));
    assert.equal((await Responder.findAll({ status: 'available' })).length, 3);
    console.log('PASS: 50 concurrent requests retain unique claims with priority scheduling.');
  } finally {
    await dispatch.stopRecovery();
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await admin.end(); }
  }
  console.log('PASS: all four audit regressions; isolated test schema removed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
