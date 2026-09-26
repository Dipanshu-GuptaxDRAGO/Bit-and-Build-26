# Web-Shooter Dispatch — Matching Engine, Atomic Claim, Dispatch State Machine

This is the backend service that: scores available responders against an
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

## How to explain the race-condition handling to judges

There are actually **two separate concurrency concerns**, handled at two
different levels — this is the bit worth walking judges through slowly:

### 1. The atomic claim itself (`data/store.js#tryClaimResponder`)

This is a compare-and-swap, written to mirror exactly what the real
Postgres statement will do later:

```sql
UPDATE responders SET status = 'claimed' WHERE id = $1 AND status = 'available';
-- then check rowCount === 1
```

The in-memory version does the same compare-then-set as one synchronous
function body with **no `await` in between the check and the mutation**.
Because Node runs your JS on a single thread, a synchronous function can
never be interrupted mid-execution — so even if two requests call
`tryClaimResponder('r1')` at "the same instant" (e.g. both inside a
`Promise.all`), the event loop still runs them one after another, back to
back, and the second one always sees the status the first one just wrote.
One gets `{ ok: true }`, the other gets `{ ok: false, reason:
'already_claimed' }` — exactly like `rowCount === 1` vs `rowCount === 0`.

**This is the load-bearing guarantee.** It doesn't depend on any lock —
it depends on the fact that the check-and-set has no `await` in it.

### 2. The retry-on-contention workflow (`lib/matching.js#matchAndClaim`)

Losing a claim isn't an error — it's expected under load. When
`tryClaimResponder` returns `{ ok: false }`, `matchAndClaim` excludes that
responder and **re-ranks the remaining pool**, trying the next-best
candidate, looping until something succeeds or the pool is exhausted.
That's the literal "re-run matching excluding that responder" behavior
from the spec.

### 3. The workflow-level mutex (`utils/mutex.js`)

Separately, `matchAndClaim` is wrapped in `withLock('match:' + incidentId,
...)`. This isn't for the claim itself (already safe per #1) — it's so
that if the *same incident* somehow gets matched twice at once (e.g. a
double-submit), the two multi-step matching workflows run one after the
other instead of interleaving their retry loops. Different incidents run
fully in parallel; the same incident is serialized.

### The proof

`test/concurrent-claim.test.js` fires real concurrent `Promise.all()`
calls into `matchAndClaim` across three scenarios (same incident twice,
two incidents racing for one responder, and a 25-vs-25 stress test) and
asserts: exactly one winner per contested responder, zero duplicate
claims, and the loser gets a clean rejection rather than a crash or a
silent double-assign.

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

Everything outside `data/store.js` calls functions like `getIncident(id)`,
`tryClaimResponder(id)`, `updateResponder(id, patch)`, `appendLog(entry)`.
None of them know or care whether that's a `Map` or a `pg` client. To go
live: rewrite the bodies of those functions in `data/store.js` to run real
SQL (the atomic claim becomes the single `UPDATE ... WHERE status =
'available'` statement shown above, checked via `rowCount`), keep the
same function signatures, and nothing in `lib/` or `routes/` changes.

## Tuning the matching weights

Top of `lib/matching.js`:

```js
const WEIGHTS = {
  W1_PROXIMITY: 0.6,
  W2_CAPABILITY_MATCH: 0.35,
  W3_STALENESS_PENALTY: 0.05,
};
```
