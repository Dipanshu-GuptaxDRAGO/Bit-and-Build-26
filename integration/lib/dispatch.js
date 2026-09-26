/**
 * lib/dispatch.js
 * ------------------------------------------------------------------
 * Dispatch state machine, layered on top of the atomic claim in
 * lib/matching.js.
 *
 * States (incident.status):  pending -> assigned -> resolved
 *                                  ^          |
 *                                  +--timeout-+
 *
 * States (responder.status): available -> claimed -> (confirmed: stays
 *                             claimed/en_route until resolve) -> available
 *                             (timeout: claimed -> available)
 * ------------------------------------------------------------------
 */

'use strict';

const store = require('../data/store');
const { matchAndClaim } = require('./matching');

const CONFIRM_TIMEOUT_MS = 15 * 1000; // 15s per spec; tune for demo pacing

// incident_id -> Node Timeout handle, so /confirm can cancel it.
const pendingTimeouts = new Map();

function clearPendingTimeout(incidentId) {
  const handle = pendingTimeouts.get(incidentId);
  if (handle) {
    clearTimeout(handle);
    pendingTimeouts.delete(incidentId);
  }
}

/**
 * Run the matcher for an incident and, on success, transition it into
 * "assigned" state and arm the confirmation timeout. On failure,
 * returns the failure reason untouched (incident stays "pending").
 */
async function dispatchMatch(incidentId, options = {}) {
  // `excludeIds` is used for immediate re-matching after a timeout so the
  // same non-responsive responder is not selected again right away.
  const excludeIds = options.excludeIds || new Set();
  const logAction = options.logAction || 'assigned';

  const result = await matchAndClaim(incidentId, excludeIds);
  if (!result.ok) {
    return result; // { ok:false, reason: ... }
  }

  const { responder, incident, score, scoring } = result;

  // --- STATE TRANSITION: pending -> assigned ---
  store.updateIncident(incident.id, {
    status: 'assigned',
    assigned_responder_id: responder.id,
  });
  store.updateResponder(responder.id, {
    current_incident_id: incident.id,
  });
  store.appendLog({
    incident_id: incident.id,
    responder_id: responder.id,
    action: logAction,
  });

  armConfirmationTimeout(incident.id);

  return {
    ok: true,
    incident: store.getIncident(incident.id),
    responder: store.getResponder(responder.id),
    score,
    scoring,
  };
}

/**
 * Arms (or re-arms) the confirmation timer for an incident. If /confirm
 * isn't called within CONFIRM_TIMEOUT_MS, the responder is released
 * back to "available", the incident reverts to "pending", a "timeout"
 * log entry is written, and matching is automatically re-run.
 */
function armConfirmationTimeout(incidentId, ms = CONFIRM_TIMEOUT_MS) {
  clearPendingTimeout(incidentId);

  const handle = setTimeout(async () => {
    await handleTimeout(incidentId);
  }, ms);

  // Don't let this timer keep the demo process alive on its own.
  if (typeof handle.unref === 'function') handle.unref();

  pendingTimeouts.set(incidentId, handle);
}

async function handleTimeout(incidentId) {
  pendingTimeouts.delete(incidentId);

  const incident = store.getIncident(incidentId);
  // If it was already confirmed/resolved/moved on, there's nothing to revert.
  if (!incident || incident.status !== 'assigned') return;

  const responderId = incident.assigned_responder_id;
  const responder = responderId ? store.getResponder(responderId) : null;

  // --- STATE TRANSITION: assigned -> pending (revert), claimed -> available ---
  store.updateIncident(incident.id, {
    status: 'pending',
    assigned_responder_id: null,
  });
  if (responder) {
    store.updateResponder(responder.id, {
      status: 'available',
      current_incident_id: null,
    });
  }
  store.appendLog({
    incident_id: incident.id,
    responder_id: responderId,
    action: 'timeout',
  });

  // Auto re-run matching, but do NOT immediately pick the responder that
  // just timed out. They are available again for future incidents, but a
  // responder who failed to confirm should get one chance to be bypassed
  // while this incident tries another available responder.
  //
  // If no other responder exists, the incident remains pending and the
  // timed-out responder stays available for a future match.
  const retry = await dispatchMatch(incident.id, {
    excludeIds: new Set([responderId]),
    logAction: 'reassigned',
  });

  return retry;
}

/**
 * POST /dispatch/confirm — responder confirms; cancels the timeout.
 */
function dispatchConfirm(incidentId) {
  const incident = store.getIncident(incidentId);
  if (!incident) return { ok: false, reason: 'incident_not_found' };
  if (incident.status !== 'assigned') {
    return { ok: false, reason: 'incident_not_assigned', incident };
  }

  clearPendingTimeout(incidentId);

  if (incident.assigned_responder_id) {
    store.updateResponder(incident.assigned_responder_id, { status: 'en_route' });
  }

  return { ok: true, incident: store.getIncident(incidentId) };
}

/**
 * POST /dispatch/resolve — marks incident resolved, frees the responder.
 */
function dispatchResolve(incidentId) {
  const incident = store.getIncident(incidentId);
  if (!incident) return { ok: false, reason: 'incident_not_found' };

  clearPendingTimeout(incidentId);

  const responderId = incident.assigned_responder_id;

  store.updateIncident(incident.id, {
    status: 'resolved',
  });
  if (responderId) {
    store.updateResponder(responderId, {
      status: 'available',
      current_incident_id: null,
    });
  }
  store.appendLog({
    incident_id: incident.id,
    responder_id: responderId,
    action: 'resolved',
  });

  return {
    ok: true,
    incident: store.getIncident(incident.id),
    responder: responderId ? store.getResponder(responderId) : null,
  };
}

module.exports = {
  CONFIRM_TIMEOUT_MS,
  dispatchMatch,
  dispatchConfirm,
  dispatchResolve,
  handleTimeout, // exported for tests
  armConfirmationTimeout, // exported for tests (shorter timeouts)
};
