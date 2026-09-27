'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { database } = require('../config/env');
const pool = require('../config/db');
// All application connections use a fresh schema: no existing responder can be claimed.
const schema = `dispatch_test_${randomUUID().replaceAll('-', '')}`;
pool.options.options = `-c search_path=${schema}`;
const admin = new Pool(database);
const Incident = require('../models/incident');
const Responder = require('../models/responder');
const Log = require('../models/dispatchLog');
const matching = require('../services/matching');
const dispatch = require('../services/dispatch');
const { app } = require('../../server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  let server;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function post(action, id, status = 200, assignment_id) {
      const response = await fetch(`${base}/dispatch/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ incident_id: id, assignment_id }) });
      const body = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      return body;
    }
    const incident = () => Incident.create({ type: 'fire', severity: 5, lat: 12.94, lon: 77.61 });
    const responders = [];
    for (let n = 0; n < 3; n++) responders.push(await Responder.create({ name: `Dispatch test ${n}`, type: 'fire', lat: 12.94 + n * 0.01, lon: 77.61 }));
    const sample = { ...responders[0], last_updated_at: new Date(Date.now() + 60000) };
    assert.equal(matching.scoreResponder({ ...sample, severity: 3 }, sample).score, 0.95);
    assert.ok(Math.abs(matching.scoreResponder({ ...sample, severity: 5 }, sample).score - 1.15) < 1e-12);
    assert.deepEqual((await matching.getRankedCandidates({ ...sample, severity: 5 })).map(x => x.responder.id), responders.map(x => x.id));
    const first = await incident();
    const match = await dispatch.dispatchMatch(first.id);
    assert.equal(match.ok, true);
    assert.equal((await Responder.findAll({ status: 'claimed' })).length, 1);
    assert.equal(match.responder.current_incident_id, first.id);
    await post('confirm', first.id, 200, match.incident.assignment_id);
    assert.equal((await Responder.findById(match.responder.id)).status, 'en_route');
    await dispatch.handleTimeout(first.id);
    assert.equal((await Incident.findById(first.id)).status, 'assigned');
    await post('resolve', first.id);
    assert.equal((await Responder.findById(match.responder.id)).status, 'available');
    assert.equal((await Responder.findById(match.responder.id)).current_incident_id, null);
    const history = await (await fetch(`${base}/dispatch/logs/${first.id}`)).json();
    assert.deepEqual(history.map(x => x.action), ['assigned', 'resolved']);
    console.log('PASS: scoring, real assignment, confirmation, resolution, and history.');

    // Simulate an external SQL claimant winning the first candidate before us.
    // The admission queue serializes this server's assignments; the conditional
    // SQL update still protects against independent database writers.
    const originalClaim = Responder.claimResponder;
    let stolenId, lostClaims = 0;
    Responder.claimResponder = async (id, db) => {
      if (!stolenId) { stolenId = id; assert.equal(await originalClaim(id), true); }
      const result = await originalClaim(id, db);
      if (!result) lostClaims++;
      return result;
    };
    const competing = await Promise.all([incident(), incident()]);
    let pair;
    try { pair = await Promise.all(competing.map(row => post('match', row.id))); }
    finally { Responder.claimResponder = originalClaim; if (stolenId) await Responder.updateStatus(stolenId, 'available'); }
    assert.ok(pair.every(x => x.ok));
    assert.notEqual(pair[0].responder.id, pair[1].responder.id);
    assert.equal(lostClaims, 1);
    await Promise.all(competing.map(row => dispatch.dispatchResolve(row.id)));
    const same = await incident();
    const duplicate = await Promise.all([post('match', same.id), post('match', same.id)]);
    assert.equal(duplicate.filter(x => x.ok).length, 1);
    assert.equal((await Log.findByIncident(same.id)).length, 1);
    await dispatch.dispatchResolve(same.id);
    console.log('PASS: concurrent HTTP matches lose/retry an atomic claim; duplicate incident matches assign once.');

    for (const r of responders.slice(1)) await Responder.updateStatus(r.id, 'busy');
    const singlePool = await Promise.all([incident(), incident()]);
    const singleResults = await Promise.all(singlePool.map(i => post('match', i.id)));
    assert.equal(singleResults.filter(x => x.ok).length, 1);
    assert.equal((await Responder.findAll({ status: 'claimed' })).length, 1);
    for (let n = 0; n < 2; n++) if (singleResults[n].ok) await dispatch.dispatchResolve(singlePool[n].id);
    for (const r of responders.slice(1)) await Responder.updateStatus(r.id, 'available');

    const broken = await incident();
    const originalAppend = Log.append;
    try {
      Log.append = async () => { throw new Error('Injected log failure'); };
      await assert.rejects(dispatch.dispatchMatch(broken.id), /Injected log failure/);
    } finally { Log.append = originalAppend; }
    assert.equal((await Incident.findById(broken.id)).status, 'pending');
    assert.equal((await Responder.findAll({ status: 'available' })).length, 3);
    assert.equal((await Log.findByIncident(broken.id)).length, 0);
    console.log('PASS: single-responder contention and transaction rollback without leaked claims.');

    const timed = await incident();
    const before = await dispatch.dispatchMatch(timed.id);
    const deadline = Date.now() + dispatch.CONFIRM_TIMEOUT_MS + 5000;
    let after;
    do {
      await sleep(100);
      after = await Incident.findById(timed.id);
      if (after.assigned_responder_id && after.assigned_responder_id !== before.responder.id) break;
    } while (Date.now() < deadline);
    assert.equal(after.status, 'assigned');
    assert.notEqual(after.assigned_responder_id, before.responder.id);
    assert.equal((await Responder.findById(before.responder.id)).status, 'available');
    assert.deepEqual((await Log.findByIncident(timed.id)).map(x => x.action), ['assigned', 'timeout', 'reassigned']);
    await dispatch.dispatchConfirm(timed.id, after.assignment_id);
    await dispatch.dispatchResolve(timed.id);
    // Resolving an old incident again cannot release a reused responder.
    const next = await incident();
    const nextMatch = await dispatch.dispatchMatch(next.id);
    await dispatch.dispatchResolve(first.id);
    assert.equal((await Responder.findById(nextMatch.responder.id)).status, 'claimed');
    await dispatch.dispatchResolve(next.id);
    for (const r of responders.slice(1)) await Responder.updateStatus(r.id, 'busy');
    const lonely = await incident();
    await dispatch.dispatchMatch(lonely.id);
    await pool.query("UPDATE incidents SET confirmation_deadline = clock_timestamp() - INTERVAL '1 second' WHERE id = $1", [lonely.id]);
    const exhausted = await dispatch.handleTimeout(lonely.id);
    assert.equal(exhausted.reason, 'no_responder_available');
    assert.equal((await Incident.findById(lonely.id)).status, 'pending');
    assert.equal((await Incident.findById(lonely.id)).assigned_responder_id, null);
    assert.equal((await Responder.findById(responders[0].id)).status, 'available');
    assert.deepEqual((await Log.findByIncident(lonely.id)).map(x => x.action), ['assigned', 'timeout']);
    await post('match', 'invalid', 400);
    await post('confirm', randomUUID(), 404, randomUUID());
    await post('resolve', broken.id, 409);
    console.log('PASS: actual 15-second timeout, automatic reassignment, repeat resolve safety, and route validation.');
  } finally {
    dispatch.stopTimeouts();
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await admin.end(); }
  }
  console.log('PASS: isolated PostgreSQL test schema removed; existing application data preserved.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
