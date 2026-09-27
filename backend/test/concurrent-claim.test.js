/**
 * test/concurrent-claim.test.js
 * ------------------------------------------------------------------
 * PROVES: firing two simultaneous match requests that compete for the
 * same responder pool results in exactly one responder being claimed
 * per incident, with no double-dispatch, no matter how the async
 * operations interleave.
 *
 * Run with: npm run test:race   (or: node test/concurrent-claim.test.js)
 * No external dependencies -- pure Node + assert.
 * ------------------------------------------------------------------
 */

'use strict';

const assert = require('assert');
const store = require('../data/store');
const { matchAndClaim, scoreResponder, waitingBonus } = require('../lib/matching');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

async function scenario1_sameIncidentTwice() {
  // Two callers accidentally double-submit a match request for the SAME
  // incident at the same time. Only one should get a responder; the
  // other should either get "no responder available" (pool of 1) or,
  // if it re-enters after the first already transitioned the incident
  // to "assigned", a not-pending rejection. Either way: no double-claim.
  store._resetAll();
  const responder = store.seedResponder({ name: 'Med Unit 1', type: 'medical', lat: 10, lon: 10 });
  const incident = store.seedIncident({ type: 'medical', severity: 3, lat: 10.001, lon: 10.001 });

  const [resultA, resultB] = await Promise.all([
    matchAndClaim(incident.id),
    matchAndClaim(incident.id),
  ]);

  const successes = [resultA, resultB].filter((r) => r.ok);
  assert.strictEqual(successes.length, 1, 'exactly one of the two simultaneous requests should succeed');
  assert.strictEqual(successes[0].responder.id, responder.id);

  const finalResponder = store.getResponder(responder.id);
  assert.strictEqual(finalResponder.status, 'claimed', 'responder should end up claimed exactly once');

  console.log('  [ok] scenario1_sameIncidentTwice: exactly one success, responder claimed once');
}

async function scenario2_twoIncidentsOneResponder() {
  // Two DIFFERENT incidents both need a "fire" responder, but there's
  // only ONE fire responder available. Both incidents fire matchAndClaim
  // at the same instant. Exactly one incident should win the responder;
  // the other should get "no_responder_available".
  store._resetAll();
  const responder = store.seedResponder({ name: 'Engine 7', type: 'fire', lat: 0, lon: 0 });
  const incidentA = store.seedIncident({ type: 'fire', severity: 5, lat: 0.001, lon: 0.001 });
  const incidentB = store.seedIncident({ type: 'fire', severity: 4, lat: 0.002, lon: 0.002 });

  const [resultA, resultB] = await Promise.all([
    matchAndClaim(incidentA.id),
    matchAndClaim(incidentB.id),
  ]);

  const successes = [resultA, resultB].filter((r) => r.ok);
  assert.strictEqual(successes.length, 1, 'exactly one incident should win the single available responder');

  const loser = successes[0].incident.id === incidentA.id ? resultB : resultA;
  assert.strictEqual(loser.ok, false);
  assert.strictEqual(loser.reason, 'no_responder_available');

  const finalResponder = store.getResponder(responder.id);
  assert.strictEqual(finalResponder.status, 'claimed');

  console.log('  [ok] scenario2_twoIncidentsOneResponder: exactly one winner, loser correctly rejected');
}

async function scenario3_highConcurrencyStress() {
  // N incidents, N responders (of matching type), fired all at once.
  // Every incident should get a DIFFERENT responder -- no duplicates.
  store._resetAll();
  const N = 25;
  const responders = [];
  const incidents = [];

  for (let i = 0; i < N; i++) {
    responders.push(store.seedResponder({ name: `Unit ${i}`, type: 'security', lat: i * 0.01, lon: i * 0.01 }));
  }
  for (let i = 0; i < N; i++) {
    incidents.push(store.seedIncident({ type: 'security', severity: 2, lat: i * 0.01, lon: i * 0.01 }));
  }

  const results = await Promise.all(incidents.map((inc) => matchAndClaim(inc.id)));

  const successes = results.filter((r) => r.ok);
  assert.strictEqual(successes.length, N, `all ${N} incidents should each get a responder (equal supply/demand)`);

  const claimedIds = successes.map((r) => r.responder.id);
  const uniqueIds = new Set(claimedIds);
  assert.strictEqual(uniqueIds.size, claimedIds.length, 'no responder should be claimed by more than one incident');

  const stillAvailable = store.listAvailableResponders();
  assert.strictEqual(stillAvailable.length, 0, 'every responder should now be claimed');

  console.log(`  [ok] scenario3_highConcurrencyStress: ${N} concurrent matches, ${uniqueIds.size} unique responders, zero double-dispatch`);
}

async function scenario4_severityWinsEitherArrivalOrder() {
  for (const lowFirst of [true, false]) {
    store._resetAll();
    const responder = store.seedResponder({ name: 'Only medic', type: 'medical', lat: 0, lon: 0 });
    const low = store.seedIncident({ type: 'medical', severity: 1, lat: 0, lon: 0 });
    const high = store.seedIncident({ type: 'medical', severity: 5, lat: 0, lon: 0 });
    assert.strictEqual(scoreResponder(high, responder).severity_boost, 0.2);
    assert.strictEqual(scoreResponder(low, responder).severity_boost, 0);
    assert(Math.abs(scoreResponder(high, responder).score - scoreResponder(low, responder).score - 0.2) < 0.000001);
    const order = lowFirst ? [low, high] : [high, low];
    const results = await Promise.all(order.map((incident) => matchAndClaim(incident.id)));
    const winner = results.find((result) => result.ok);
    assert.strictEqual(results.filter((result) => result.ok).length, 1);
    assert.strictEqual(winner.incident.id, high.id, 'severity must win even when low severity submits first');
    assert.strictEqual(winner.responder.id, responder.id);
    assert.strictEqual(results.find((result) => !result.ok).reason, 'no_responder_available');
  }
  console.log('  [ok] severity wins single-responder race in both arrival orders');
}

async function scenario5_optionalAgingPreventsStarvation() {
  const now = Date.now();
  const old = { status: 'pending', reported_at: new Date(now - 30 * 60000).toISOString() };
  assert.strictEqual(waitingBonus(old, now), 0.3);
  assert.strictEqual(waitingBonus({ ...old, status: 'assigned' }, now), 0);
  assert.strictEqual(waitingBonus({ ...old, reported_at: 'invalid' }, now), 0);
  assert.strictEqual(waitingBonus({ ...old, reported_at: new Date(now + 60000).toISOString() }, now), 0);
  assert.strictEqual(waitingBonus({ ...old, pending_since: new Date(now).toISOString() }, now), 0);
  for (const enableAging of [false, true]) {
    store._resetAll();
    store.seedResponder({ name: 'Only engine', type: 'fire', lat: 0, lon: 0 });
    const low = store.seedIncident({ type: 'fire', severity: 1, lat: 0, lon: 0 });
    store.updateIncident(low.id, { reported_at: old.reported_at });
    const high = store.seedIncident({ type: 'fire', severity: 5, lat: 0, lon: 0 });
    const options = enableAging ? { waitingBonusFn: waitingBonus } : {};
    const results = await Promise.all([high, low].map((incident) => matchAndClaim(incident.id, new Set(), options)));
    const winners = results.filter((result) => result.ok);
    assert.strictEqual(winners.length, 1);
    assert.strictEqual(winners[0].incident.id, enableAging ? low.id : high.id);
    assert.strictEqual(results.find((result) => !result.ok).reason, 'no_responder_available');
    if (enableAging) assert(winners[0].scoring.waiting_bonus >= 0.3);
    else assert.strictEqual(winners[0].scoring.waiting_bonus, 0);
  }
  console.log('  [ok] optional aging lets an old pending incident outrank fresh urgent work');
}

async function main() {
  console.log('Running concurrent-claim race condition tests...\n');
  try {
    await scenario1_sameIncidentTwice();
    await scenario2_twoIncidentsOneResponder();
    await scenario3_highConcurrencyStress();
    await scenario4_severityWinsEitherArrivalOrder();
    await scenario5_optionalAgingPreventsStarvation();
    console.log('\nALL RACE-CONDITION TESTS PASSED.');
  } catch (err) {
    fail(err.message);
    console.error(err);
  }
}

main();
