/**
 * test/dispatch-lifecycle.test.js
 * Exercises the full state machine: match -> confirm -> resolve, and
 * separately match -> timeout -> auto re-match.
 * Run with: npm run test:lifecycle
 */

'use strict';

const assert = require('assert');
const store = require('../data/store');
const {
  dispatchMatch,
  dispatchConfirm,
  dispatchResolve,
  handleTimeout,
} = require('../lib/dispatch');

async function scenario_matchConfirmResolve() {
  store._resetAll();
  const responder = store.seedResponder({ name: 'Medic 1', type: 'medical', lat: 5, lon: 5 });
  const incident = store.seedIncident({ type: 'medical', severity: 3, lat: 5.001, lon: 5.001 });

  const matchResult = await dispatchMatch(incident.id);
  assert.strictEqual(matchResult.ok, true);
  assert.strictEqual(matchResult.incident.status, 'assigned');
  assert.strictEqual(matchResult.responder.status, 'claimed');

  const confirmResult = dispatchConfirm(incident.id);
  assert.strictEqual(confirmResult.ok, true);
  assert.strictEqual(store.getResponder(responder.id).status, 'en_route');

  const resolveResult = dispatchResolve(incident.id);
  assert.strictEqual(resolveResult.ok, true);
  assert.strictEqual(store.getIncident(incident.id).status, 'resolved');
  assert.strictEqual(store.getResponder(responder.id).status, 'available');
  assert.strictEqual(store.getResponder(responder.id).current_incident_id, null);

  const logs = store.listLogsForIncident(incident.id).map((l) => l.action);
  assert.deepStrictEqual(logs, ['assigned', 'resolved']);

  console.log('  [ok] match -> confirm -> resolve: full lifecycle + log trail correct');
}

async function scenario_timeoutAutoRevertAndRematch() {
  store._resetAll();
  const responderA = store.seedResponder({ name: 'Unit A', type: 'security', lat: 0, lon: 0 });
  const responderB = store.seedResponder({ name: 'Unit B', type: 'security', lat: 0.5, lon: 0.5 });
  const incident = store.seedIncident({ type: 'security', severity: 2, lat: 0, lon: 0 });

  const matchResult = await dispatchMatch(incident.id);
  assert.strictEqual(matchResult.ok, true);
  const firstResponderId = matchResult.responder.id;
  assert.strictEqual(firstResponderId, responderA.id, 'closer responder A should win the first match');
  assert.strictEqual(store.getIncident(incident.id).status, 'assigned');

  // Simulate the 15s confirm window expiring without a /confirm call by
  // invoking the same handler the real setTimeout would call. The timed-out
  // responder is released to "available", but is excluded from THIS
  // immediate retry so the incident gets a chance to reach another unit.
  await handleTimeout(incident.id);

  const finalIncident = store.getIncident(incident.id);
  assert.strictEqual(finalIncident.status, 'assigned', 'incident should be auto-reassigned after timeout');
  assert.strictEqual(
    finalIncident.assigned_responder_id,
    responderB.id,
    'the timed-out responder A must be excluded from the immediate retry'
  );
  assert.strictEqual(store.getResponder(responderA.id).status, 'available');
  assert.strictEqual(store.getResponder(responderA.id).current_incident_id, null);
  assert.strictEqual(store.getResponder(responderB.id).status, 'claimed');
  assert.strictEqual(store.getResponder(responderB.id).current_incident_id, incident.id);

  const logs = store.listLogsForIncident(incident.id).map((l) => l.action);
  assert.deepStrictEqual(logs, ['assigned', 'timeout', 'reassigned']);

  console.log('  [ok] match -> timeout -> auto re-match: timed-out responder bypassed, next responder assigned, log trail correct');
}

async function main() {
  console.log('Running dispatch lifecycle tests...\n');
  try {
    await scenario_matchConfirmResolve();
    await scenario_timeoutAutoRevertAndRematch();
    console.log('\nALL LIFECYCLE TESTS PASSED.');
  } catch (err) {
    console.error('FAIL:', err.message);
    console.error(err);
    process.exitCode = 1;
  }
}

main();
