/**
 * data/store.js
 * ------------------------------------------------------------------
 * THE ONLY MODULE THAT KNOWS ABOUT "WHERE THE DATA LIVES".
 *
 * Everything in lib/ and routes/ talks to the functions exported here,
 * never to raw arrays/objects and never to a `db.query(...)` call directly.
 * That means when an teammate's Postgres tables are ready, this is the
 * ONLY file that needs to change — swap the array-based implementation
 * below for real SQL and every route/lib file keeps working unmodified.
 *
 * Schema mirrors the shared entities exactly:
 *   Incident   { id, type, severity, lat, lon, status, reported_at, assigned_responder_id }
 *   Responder  { id, name, type, lat, lon, status, last_updated_at, current_incident_id }
 *   DispatchLog{ id, incident_id, responder_id, action, timestamp }
 * ------------------------------------------------------------------
 */

'use strict';

// ---------------------------------------------------------------------
// In-memory "tables". Replace with real DB calls later; keep the
// function signatures below identical so nothing upstream has to change.
// ---------------------------------------------------------------------
const incidents = new Map();   // id -> Incident
const responders = new Map();  // id -> Responder
const dispatchLog = [];        // append-only array of DispatchLog rows

let _incidentSeq = 1;
let _responderSeq = 1;
let _logSeq = 1;

// ---------------------------------------------------------------------
// Seed helpers (used by the demo/test scripts to populate the mock).
// A real DB would just already have rows; these exist only for the mock.
// ---------------------------------------------------------------------
function seedResponder({ name, type, lat, lon, status = 'available' }) {
  const id = `r${_responderSeq++}`;
  responders.set(id, {
    id,
    name,
    type,
    lat,
    lon,
    status, // "available" | "claimed" | "en_route" | "busy"
    last_updated_at: new Date().toISOString(),
    current_incident_id: null,
  });
  return responders.get(id);
}

function seedIncident({ type, severity, lat, lon, status = 'pending' }) {
  const id = `i${_incidentSeq++}`;
  incidents.set(id, {
    id,
    type,
    severity,
    lat,
    lon,
    status, // "pending" | "assigned" | "resolved"
    reported_at: new Date().toISOString(),
    assigned_responder_id: null,
  });
  return incidents.get(id);
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------
function getIncident(id) {
  return incidents.get(id) || null;
}

function getResponder(id) {
  return responders.get(id) || null;
}

function listAvailableResponders() {
  return Array.from(responders.values()).filter((r) => r.status === 'available');
}

function listAllResponders() {
  return Array.from(responders.values());
}

function listLogsForIncident(incidentId) {
  return dispatchLog.filter((l) => l.incident_id === incidentId);
}

// ---------------------------------------------------------------------
// THE ATOMIC CLAIM PRIMITIVE
// ---------------------------------------------------------------------
// Real-DB equivalent (Postgres):
//
//   UPDATE responders
//      SET status = 'claimed'
//    WHERE id = $1 AND status = 'available'
//
//   -> check `rowCount === 1`. If rowCount is 0, someone else's
//      transaction already flipped that row first; treat it as a miss.
//
// In-memory equivalent: a "compare-and-swap" on the status field.
//
// WHY THIS FUNCTION IS SAFE WITHOUT AN EXPLICIT LOCK:
// Node.js runs your JS on a single thread. As long as a function body
// contains no `await` between the "compare" step and the "swap" step,
// nothing else can run in the middle of it — the whole function executes
// as one uninterruptible tick of the event loop, exactly like a database
// row lock held for the duration of a single UPDATE statement. That is
// what makes this a fair, one-file simulation of the SQL statement above.
//
// We still layer an explicit async mutex (utils/mutex.js) around the
// higher-level *matching* workflow in lib/matching.js, because that
// workflow legitimately does `await` (e.g. scoring, future async DB
// reads). The mutex protects the multi-step workflow; this function
// protects the single-row mutation at its core. Two different jobs.
// ---------------------------------------------------------------------
function tryClaimResponder(responderId) {
  const r = responders.get(responderId);
  if (!r) return { ok: false, reason: 'not_found' };

  // --- COMPARE ---
  if (r.status !== 'available') {
    // Zero "rows" affected — equivalent to rowCount === 0 in SQL.
    return { ok: false, reason: 'already_claimed' };
  }

  // --- SWAP --- (no await between compare and swap: this is the atomic step)
  r.status = 'claimed';
  r.last_updated_at = new Date().toISOString();

  return { ok: true, responder: r };
}

// ---------------------------------------------------------------------
// Writes used by the dispatch state machine
// ---------------------------------------------------------------------
function updateIncident(id, patch) {
  const inc = incidents.get(id);
  if (!inc) return null;
  Object.assign(inc, patch);
  return inc;
}

function updateResponder(id, patch) {
  const r = responders.get(id);
  if (!r) return null;
  Object.assign(r, patch);
  return r;
}

function appendLog({ incident_id, responder_id, action }) {
  const entry = {
    id: `log${_logSeq++}`,
    incident_id,
    responder_id,
    action, // "assigned" | "timeout" | "reassigned" | "resolved"
    timestamp: new Date().toISOString(),
  };
  dispatchLog.push(entry);
  return entry;
}

// ---------------------------------------------------------------------
// Test/demo utility: full reset between test runs.
// ---------------------------------------------------------------------
function _resetAll() {
  incidents.clear();
  responders.clear();
  dispatchLog.length = 0;
  _incidentSeq = 1;
  _responderSeq = 1;
  _logSeq = 1;
}

module.exports = {
  // seed (mock-only helpers)
  seedResponder,
  seedIncident,
  // reads
  getIncident,
  getResponder,
  listAvailableResponders,
  listAllResponders,
  listLogsForIncident,
  // the atomic primitive
  tryClaimResponder,
  // writes
  updateIncident,
  updateResponder,
  appendLog,
  // test utility
  _resetAll,
};
