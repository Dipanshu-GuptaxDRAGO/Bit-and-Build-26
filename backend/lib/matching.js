/**
 * lib/matching.js
 * ------------------------------------------------------------------
 * Scores available responders against an incident and attempts to
 * claim the best one, atomically, with retry-on-contention.
 * ------------------------------------------------------------------
 */

'use strict';

const store = require('../data/store');
const { haversineKm } = require('./geo');
const { withLock } = require('../utils/mutex');

// ---------------------------------------------------------------------
// TUNABLE WEIGHTS -- adjust freely, everything downstream just works.
// ---------------------------------------------------------------------
const WEIGHTS = {
  W1_PROXIMITY: 0.6,
  W2_CAPABILITY_MATCH: 0.35,
  W3_STALENESS_PENALTY: 0.05,
};

const CAPABILITY_MATCH_SCORE = 1.0;
const CAPABILITY_MISMATCH_SCORE = 0.3; // still eligible, heavily penalized

// Staleness penalty grows with minutes since last_updated_at, capped so
// one extremely stale responder can't produce a huge negative score.
const STALENESS_HALFLIFE_MINUTES = 5;
const STALENESS_PENALTY_CAP = 1.0;

function minutesSince(isoTimestamp) {
  return (Date.now() - new Date(isoTimestamp).getTime()) / 60000;
}

function stalenessPenalty(lastUpdatedAt) {
  const minutes = Math.max(0, minutesSince(lastUpdatedAt));
  // Approaches STALENESS_PENALTY_CAP asymptotically; a responder updated
  // "just now" contributes ~0, one stale for a long time approaches the cap.
  const penalty = STALENESS_PENALTY_CAP * (1 - Math.exp(-minutes / STALENESS_HALFLIFE_MINUTES));
  return penalty;
}

function proximityScore(incident, responder) {
  const distanceKm = haversineKm(incident.lat, incident.lon, responder.lat, responder.lon);
  return 1 / (1 + distanceKm);
}

function capabilityMatchScore(incident, responder) {
  return responder.type === incident.type ? CAPABILITY_MATCH_SCORE : CAPABILITY_MISMATCH_SCORE;
}

function scoreResponder(incident, responder) {
  const proximity = proximityScore(incident, responder);
  const capability = capabilityMatchScore(incident, responder);
  const staleness = stalenessPenalty(responder.last_updated_at);

  const score =
    WEIGHTS.W1_PROXIMITY * proximity +
    WEIGHTS.W2_CAPABILITY_MATCH * capability -
    WEIGHTS.W3_STALENESS_PENALTY * staleness;

  return { score, proximity, capability, staleness };
}

/**
 * Build a ranked candidate list for an incident, excluding any responder
 * ids in `excludeIds` (used when a top pick loses a claim race and we
 * need to fall back to the next-best candidate).
 *
 * Filtering rule: only "available" responders are eligible at all.
 * Among those, if at least one same-type responder is available, we
 * drop mismatched-type responders entirely (per spec: mismatches are
 * only used "as a last resort"). If NO same-type responder is
 * available, mismatched-type responders stay in the pool (heavily
 * penalized by capabilityMatchScore, but still usable).
 */
function getRankedCandidates(incident, excludeIds = new Set()) {
  const available = store
    .listAvailableResponders()
    .filter((r) => !excludeIds.has(r.id));

  const sameType = available.filter((r) => r.type === incident.type);
  const pool = sameType.length > 0 ? sameType : available;

  return pool
    .map((r) => ({ responder: r, ...scoreResponder(incident, r) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * THE CORE RACE-CONDITION-SAFE WORKFLOW.
 *
 * 1. Rank all eligible candidates for this incident, best score first.
 * 2. Try to atomically claim the top candidate via
 *    store.tryClaimResponder() -- the compare-and-swap described in
 *    data/store.js.
 * 3. If the claim succeeds (exactly one "row" flipped from available
 *    to claimed), we're done -- that responder is ours.
 * 4. If the claim FAILS (0 rows affected -- someone else's concurrent
 *    match request claimed this exact responder microseconds earlier),
 *    we do NOT error out. We exclude that responder id and re-run
 *    matching over the remaining pool, trying the next-best candidate.
 *    This repeats until a claim succeeds or the pool is exhausted.
 *
 * This is exactly the pattern the spec calls for: "if 0 rows affected,
 * someone else claimed them first -- re-run matching excluding that
 * responder."
 *
 * The whole function is wrapped in a per-incident mutex (withLock) so
 * that two overlapping match requests for the SAME incident don't
 * interleave their retry loops and produce confusing double-work --
 * that's a workflow-level concern, separate from (and in addition to)
 * the row-level atomicity of tryClaimResponder itself.
 */
async function matchAndClaim(incidentId, initialExcludeIds = new Set()) {
  return withLock(`match:${incidentId}`, async () => {
    const incident = store.getIncident(incidentId);
    if (!incident) {
      return { ok: false, reason: 'incident_not_found' };
    }
    if (incident.status !== 'pending') {
      return { ok: false, reason: 'incident_not_pending', incident };
    }

    // Copy the caller's exclusions so retries can add contenders that lose
    // an atomic claim race without mutating the caller's Set.
    const excludeIds = new Set(initialExcludeIds);

    // Loop instead of recursion so an unbounded contention storm can't
    // blow the call stack; each iteration re-ranks the shrinking pool.
    // (Functionally identical to "re-run matching excluding that responder".)
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ranked = getRankedCandidates(incident, excludeIds);

      if (ranked.length === 0) {
        return { ok: false, reason: 'no_responder_available' };
      }

      const top = ranked[0];

      // --- THE ATOMIC STEP ---
      const claimResult = store.tryClaimResponder(top.responder.id);

      if (claimResult.ok) {
        return {
          ok: true,
          responder: claimResult.responder,
          score: top.score,
          scoring: {
            proximity: top.proximity,
            capability: top.capability,
            staleness: top.staleness,
          },
          incident,
        };
      }

      // Someone else claimed this exact responder a beat before us.
      // Exclude them and loop -- try the next-best candidate.
      excludeIds.add(top.responder.id);
    }
  });
}

module.exports = {
  WEIGHTS,
  scoreResponder,
  getRankedCandidates,
  matchAndClaim,
};
