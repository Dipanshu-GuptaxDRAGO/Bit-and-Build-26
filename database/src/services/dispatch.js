'use strict';
const pool = require('../config/db');
const Responder = require('../models/responder');
const Incident = require('../models/incident');
const DispatchLog = require('../models/dispatchLog');
const { matchAndClaim, scoreResponder } = require('./matching');
const { admit, processNext } = require('./dispatchQueue');

const CONFIRM_TIMEOUT_MS = 15000;
const RECOVERY_INTERVAL_MS = 1000;
const pendingTimeouts = new Map();
const timeoutWork = new Set();
let recoveryTimer;
let recoveryRun;
let stopping = false;
const canonical = id => id.toLowerCase();

function clearPendingTimeout(id) {
  id = canonical(id);
  clearTimeout(pendingTimeouts.get(id));
  pendingTimeouts.delete(id);
}
async function transition(id, fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM incidents WHERE id = $1 FOR UPDATE', [id]);
    const result = rows[0] ? await fn(rows[0], db) : { ok: false, reason: 'incident_not_found' };
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function assign(incidentId, options) {
  const result = await transition(incidentId, async (incident, db) => {
    // A process can exit after assignment commits but before its queue result
    // commits. Recover that same assignment instead of claiming another unit.
    if (options.requestId && incident.dispatch_request_id === options.requestId && incident.status !== 'pending') {
      const responder = await Responder.findById(incident.assigned_responder_id, db);
      const scoring = scoreResponder(incident, responder);
      return { ok: true, incident, responder, score: scoring.score, scoring };
    }
    // A stale recovery scan cannot re-dispatch work which was already completed.
    if (options.recovery && !incident.dispatch_retry_at) return { ok: false, reason: 'retry_not_pending' };
    const excludes = new Set(options.excludeIds || []);
    if (options.recovery && incident.excluded_responder_id) excludes.add(incident.excluded_responder_id);
    const matched = await matchAndClaim(incident.id, excludes, db);
    if (!matched.ok) {
      if (options.recovery && matched.reason === 'no_responder_available') {
        await db.query("UPDATE incidents SET dispatch_retry_at = clock_timestamp() + INTERVAL '1 second' WHERE id = $1", [incident.id]);
      }
      return matched;
    }
    const responder = await Responder.updateStatus(matched.responder.id, 'claimed', { current_incident_id: incident.id }, db);
    const { rows } = await db.query(`UPDATE incidents SET status = 'assigned', assigned_responder_id = $2,
      assignment_id = gen_random_uuid(), confirmation_deadline = clock_timestamp() + INTERVAL '15 seconds',
      dispatch_retry_at = NULL, excluded_responder_id = NULL, dispatch_request_id = $3 WHERE id = $1 RETURNING *`, [incident.id, responder.id, options.requestId || null]);
    await DispatchLog.append({ incident_id: incident.id, responder_id: responder.id,
      action: incident.dispatch_retry_at || options.logAction === 'reassigned' ? 'reassigned' : 'assigned' }, db);
    return { ...matched, incident: rows[0], responder };
  });
  if (result.ok && result.incident.confirmation_deadline) armConfirmationTimeout(incidentId, Math.max(0, result.incident.confirmation_deadline.getTime() - Date.now()), result.incident.assignment_id);
  return result;
}
function dispatchMatch(incidentId, options = {}) {
  return admit(canonical(incidentId), { ...options, excludeIds: [...(options.excludeIds || [])] }, assign);
}

function armConfirmationTimeout(incidentId, ms = CONFIRM_TIMEOUT_MS, assignmentId) {
  incidentId = canonical(incidentId);
  clearPendingTimeout(incidentId);
  if (stopping || process.env.DISPATCH_RUNTIME === 'workflow') return;
  const handle = setTimeout(async () => {
    if (pendingTimeouts.get(incidentId) !== handle) return;
    pendingTimeouts.delete(incidentId);
    const work = handleTimeout(incidentId, assignmentId);
    timeoutWork.add(work);
    try { await work; }
    catch (error) {
      // Durable deadline/retry rows remain intact. Polling also survives restart.
      console.error('Dispatch confirmation timeout failed:', error.message);
      if (!stopping) armConfirmationTimeout(incidentId, RECOVERY_INTERVAL_MS, assignmentId);
    } finally { timeoutWork.delete(work); }
  }, ms);
  handle.unref();
  pendingTimeouts.set(incidentId, handle);
}

async function handleTimeout(incidentId, assignmentId) {
  const released = await transition(incidentId, async (incident, db) => {
    if (incident.status !== 'assigned' || !incident.confirmation_deadline) return false;
    if (assignmentId && incident.assignment_id !== assignmentId) return false;
    const { rows } = await db.query('SELECT $1::timestamptz <= clock_timestamp() AS due', [incident.confirmation_deadline]);
    if (!rows[0].due) return false;
    const responder = await Responder.findById(incident.assigned_responder_id, db);
    if (!responder || responder.status !== 'claimed' || responder.current_incident_id !== incident.id) return false;
    await Responder.updateStatus(responder.id, 'available', { current_incident_id: null }, db);
    // Persist the re-match job in the SAME transaction as releasing the claim.
    await db.query(`UPDATE incidents SET status = 'pending', assigned_responder_id = NULL,
      assignment_id = NULL, confirmation_deadline = NULL, dispatch_retry_at = clock_timestamp(),
      excluded_responder_id = $2 WHERE id = $1`, [incident.id, responder.id]);
    await DispatchLog.append({ incident_id: incident.id, responder_id: responder.id, action: 'timeout' }, db);
    return true;
  });
  if (released) return dispatchMatch(incidentId, { recovery: true });
}

async function dispatchConfirm(incidentId, assignmentId) {
  const result = await transition(incidentId, async (incident, db) => {
    if (incident.status !== 'assigned') return { ok: false, reason: 'incident_not_assigned', incident };
    if (!assignmentId || canonical(assignmentId) !== incident.assignment_id) return { ok: false, reason: 'stale_assignment', incident };
    if (incident.confirmation_deadline) {
      const { rows } = await db.query('SELECT $1::timestamptz <= clock_timestamp() AS expired', [incident.confirmation_deadline]);
      if (rows[0].expired) return { ok: false, reason: 'confirmation_expired', incident };
    }
    await Responder.updateStatus(incident.assigned_responder_id, 'en_route', {}, db);
    const { rows } = await db.query('UPDATE incidents SET confirmation_deadline = NULL WHERE id = $1 RETURNING *', [incident.id]);
    return { ok: true, incident: rows[0] };
  });
  if (result.ok) clearPendingTimeout(incidentId);
  return result;
}
async function dispatchResolve(incidentId) {
  const result = await transition(incidentId, async (incident, db) => {
    if (incident.status === 'resolved') return { ok: true, incident, responder: null };
    if (incident.status !== 'assigned') return { ok: false, reason: 'incident_not_assigned', incident };
    const responder = await Responder.updateStatus(incident.assigned_responder_id, 'available', { current_incident_id: null }, db);
    await Incident.updateStatus(incident.id, 'resolved', {}, db);
    const { rows } = await db.query(`UPDATE incidents SET confirmation_deadline = NULL,
      dispatch_retry_at = NULL, excluded_responder_id = NULL WHERE id = $1 RETURNING *`, [incident.id]);
    await DispatchLog.append({ incident_id: incident.id, responder_id: responder.id, action: 'resolved' }, db);
    return { ok: true, incident: rows[0], responder };
  });
  if (result.ok) clearPendingTimeout(incidentId);
  return result;
}

function recoverDispatches() {
  if (recoveryRun) return recoveryRun;
  recoveryRun = (async () => {
    const { rows } = await pool.query(`SELECT id, status, assignment_id FROM incidents
      WHERE (status = 'assigned' AND confirmation_deadline <= clock_timestamp())
         OR (status = 'pending' AND dispatch_retry_at <= clock_timestamp())
      ORDER BY severity DESC, reported_at ASC`);
    // Enqueue a whole batch together, so recovery uses the same priority policy.
    const results = await Promise.allSettled(rows.map(row => row.status === 'assigned'
      ? handleTimeout(row.id, row.assignment_id) : dispatchMatch(row.id, { recovery: true })));
    for (const result of results) if (result.status === 'rejected') console.error('Dispatch recovery will retry:', result.reason.message);
  })().finally(() => { recoveryRun = undefined; });
  return recoveryRun;
}
async function startRecovery() {
  stopping = false;
  clearInterval(recoveryTimer);
  await recoverDispatches();
  recoveryTimer = setInterval(async () => {
    try { await recoverDispatches(); }
    catch (error) { console.error('Dispatch recovery will retry:', error.message); }
  }, RECOVERY_INTERVAL_MS);
  recoveryTimer.unref();
}
function stopTimeouts() {
  stopping = true;
  clearInterval(recoveryTimer);
  recoveryTimer = undefined;
  for (const id of pendingTimeouts.keys()) clearPendingTimeout(id);
}
async function stopRecovery() {
  stopTimeouts();
  await Promise.allSettled([...timeoutWork, ...(recoveryRun ? [recoveryRun] : [])]);
}
module.exports = { processQueuedDispatches: () => processNext(assign), CONFIRM_TIMEOUT_MS, RECOVERY_INTERVAL_MS, dispatchMatch, dispatchConfirm, dispatchResolve,
  handleTimeout, armConfirmationTimeout, recoverDispatches, startRecovery, stopRecovery, stopTimeouts };
