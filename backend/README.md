# Web-Shooter Dispatch — Matching Engine, Atomic Claim, Dispatch State Machine

This folder is the in-memory reference/backup, not the final Postgres service. It: scores available responders against an
incident, atomically claims the best one (no double-dispatch, even under
concurrency), and runs the assign → confirm/timeout → resolve state machine.

It does **not** include incident ingestion (teammate's job) or the frontend
(third teammate's job) — just the REST endpoints they call.

## Run it

```bash
npm install       # needs network access — only `express` is a dependency
npm start          # starts the server on :3000

npm run test:race       # proves no double-dispatch under concurrency
npm run test:lifecycle  # proves match -> confirm -> resolve and match -> timeout -> re-match
```

The two `npm run test:*` scripts have **zero external dependencies** — they
exercise `data/store.js`, `lib/matching.js`, and `lib/dispatch.js` directly
with plain Node + `assert`, so you can run them right now even before
`express` is installed.

## Project layout

```
data/store.js       <- the ONLY module that touches "the database".
                        In-memory mock today; swap in real SQL later by
                        changing just this file. Contains the atomic
                        claim primitive (tryClaimResponder).
lib/geo.js           <- Haversine distance
lib/matching.js      <- weighted scoring + claim-with-retry-on-contention
lib/dispatch.js       <- state machine: assign, timeout, confirm, resolve
routes/dispatch.js    <- thin Express routes -> lib/dispatch.js
utils/mutex.js        <- per-incident async lock around the matching workflow
server.js             <- Express app + a few /debug/* seed endpoints
test/*.test.js        <- concurrency proof + lifecycle proof
```

## How to explain this to judges (one-page demo guide)

### Atomic claim
Two incidents may both choose the same responder, but only one can reserve them.
The reservation checks that the responder is still available and changes their status in one indivisible step.
Our reference does this synchronously in memory; Postgres must use a conditional `UPDATE ... WHERE status = 'available'` and check that exactly one row changed.
The database operation protects claims across servers; the local per-incident mutex only coordinates work inside one process.

### Retry on contention
If another incident reserves our first choice, that is an expected outcome under load.
We exclude that responder, score the remaining available responders again, and try the next best choice.
Every failed attempt removes one candidate, so the loop finishes with a reservation or a clear no-responder result.
An unmatched incident stays pending for a later attempt.

### Severity weighting
We score responders using distance, capability, and freshness of their location.
Severity 4 adds 0.1 and severity 5 adds 0.2, while severities 1 through 3 add nothing.
Because that boost is identical for every responder to one incident, we also prioritize incident requests collected in the same scheduling batch before making claims, with arrival order breaking ties.
This lets the urgent incident win a shared responder even when the less urgent request arrives first in the batch; it does not take responders away from claims already underway.

### Starvation prevention
An optional waiting bonus adds 0.01 per minute that an incident has been pending.
A severity-1 incident waiting 30 minutes therefore gains 0.3 and can outrank a newly reported severity-5 incident with its 0.2 boost.
The bonus is uncapped so waiting can eventually overcome the bounded severity boost, and the merge can enable it or supply a different policy.
This needs pending incidents to be retried and responders to become available: aging alone cannot create capacity or guarantee a deadline.

## Priority policy and integration notes

`severityBoost`, `waitingBonus`, and `incidentPriority` are DB-agnostic helpers.
`scoreResponder(incident, responder, options)` includes `severity_boost` and
`waiting_bonus` in its breakdown. Aging is **off by default**; enable it consistently
for all competing requests:

```js
const { waitingBonus } = require('./lib/matching');
await dispatchMatch(incidentId, { waitingBonusFn: waitingBonus });
// Or: matchAndClaim(incidentId, new Set(), { waitingBonusFn: waitingBonus });
```

The hook receives `(incident, nowMilliseconds)` and returns a nonnegative score
bonus. Helpers accept an explicit `now` for deterministic evaluation; the scheduler
uses one clock snapshot per batch. Missing/invalid/future timestamps add zero.
Aging uses `pending_since` when provided, otherwise `reported_at`; timeout resets
`pending_since` in this reference. A SQL port can provide that value in its incident
object without adopting a new column. The built-in timeout retry uses default
options; a service-wide aging policy must also be supplied on automatic retries.

The reference batches calls until `setImmediate`, orders by severity plus optional
aging, and awaits each claim workflow. This is local admission ordering, not a
cross-server priority guarantee; a multi-worker SQL service needs a shared ordered
scheduler to preserve global priority. It does not automatically poll pending
incidents. The race suite tests both arrival orders for urgency, optional aging,
and the original duplicate-request and 25-incident scenarios.

## API

- `POST /dispatch/match { incident_id }` → runs matching + atomic claim.
  Returns the assigned responder + score breakdown, or
  `{ ok: false, message: "no responder available" }`.
- `POST /dispatch/confirm { incident_id }` → responder confirms; cancels
  the 15s auto-timeout; responder moves to `en_route`.
- `POST /dispatch/resolve { incident_id }` → resolves the incident,
  frees the responder, logs `resolved`.

## Debug/demo-only endpoints (delete once real data layer lands)

- `POST /debug/seed-responder { name, type, lat, lon, status? }`
- `POST /debug/seed-incident { type, severity, lat, lon, status? }`
- `GET /debug/state` — list all responders
- `GET /debug/incident/:id` — incident + its DispatchLog trail

## Swapping in the real database later

The final service lives in the teammate's Postgres backend. Port the pure scoring
and scheduling policy from this reference, and retain SQL transactions and atomic
conditional claims. The store API here is synchronous: real async SQL requires
awaiting reads, claims, updates, and logs, and protecting the complete assignment
transaction. Replacing store function bodies alone is not sufficient.

## Tuning the matching weights

Top of `lib/matching.js`:

```js
const WEIGHTS = {
  W1_PROXIMITY: 0.6,
  W2_CAPABILITY_MATCH: 0.35,
  W3_STALENESS_PENALTY: 0.05,
};
```

