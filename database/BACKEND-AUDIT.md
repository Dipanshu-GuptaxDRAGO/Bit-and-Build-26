# Remediation verification — 2026-09-26

All four requested audit issues are fixed and regression-tested. The original audit is preserved below as historical context, not the current status of those four findings.

| Finding | Fix | Verification |
| --- | --- | --- |
| Failed timeout re-match loses retry | Persist dispatch_retry_at and excluded_responder_id in the timeout-release transaction; startup/one-second worker retries failures | Injected replacement-log failure rolls back the claim, retains the job, and automatically recovers |
| Restart loses confirmation deadline | Persist confirmation_deadline as TIMESTAMPTZ; scan on startup and during runtime | Real child process assigns and exits; replacement service honors the original 15-second deadline and reassigns |
| Stale confirmation accepts replacement | Fresh assignment_id UUID on every assignment; confirmation must match token and unexpired deadline | Missing token returns 400; expired/stale tokens return 409, even after the original responder is reused; correct token is idempotent |
| Severity bonus cannot prioritize incidents | Single-server 10 ms admission window; descending severity among waiting requests, FIFO ties; re-evaluate between claims | Severity 5 wins over severity 1 in both HTTP arrival orders; equal-severity FIFO and 50-request contention pass |

The additive database migration was applied twice successfully. Tests also verify upgrading a legacy assignment without changing its token/deadline on migration reruns. Existing application data remains: 84 incidents, 20 responders, 0 logs; zero broken assignment links and no leftover test schemas.

Passing commands: db:check, db:test, api:test (74 checks), dispatch:test, dispatch:recovery:test, simulation:test, sanity (7 live endpoint checks). All 27 JavaScript files pass syntax checks. npm audit reports zero known vulnerabilities. The recovery test wait was corrected to observe completed reassignment rather than the valid intermediate pending state, then the suite passed.

**Frontend change:** POST /dispatch/confirm now requires both incident_id and assignment_id. Use the token from the assignment being confirmed. Other dispatch request shapes remain unchanged. See README for the full API.

The priority policy is for one backend server and does not preempt existing assignments. Authentication, general database constraint hardening, and multi-server priority scheduling remain outside this four-fix scope. Passing these tests is evidence for the tested behavior, not a guarantee of perfection.

---

# Original audit — 2026-09-26 (historical findings below)

Verdict: core workflows pass the exercised tests, but the backend is not flawless. No application source was changed during this audit.

## Passed

- `npm run db:check`: real PostgreSQL connection succeeds.
- `npm run db:test`: CRUD, filters, defaults, constraints, atomic claims, status/link changes, and history.
- `npm run api:test`: 74 HTTP checks, including invalid input and database failure handling.
- `npm run dispatch:test`: assignment, confirmation, resolution, contention/retry, transaction rollback, 15-second timeout/reassignment, and exhausted pool.
- `npm run simulation:test`: injected connection failure recovers on next tick.
- `npm run sanity`: 7 live endpoint checks pass after temporarily starting the server. The initial run failed because no server was listening; the temporary server was stopped after testing.
- Syntax checks: all 25 active JavaScript files pass.
- `npm audit --json`: zero known dependency vulnerabilities reported at audit time; not a comprehensive security assessment.
- Additional real-PostgreSQL stress test: 50 concurrent incidents / 8 responders produced 8 unique assignments and 42 no-availability results, with no leaked claims. Completed matching plus resolution in approximately 181 ms locally; this is not a sustained-load benchmark.
- 30 duplicate match calls and 30 repeated resolve calls produced exactly one assignment and one resolution log.
- Public database snapshot: 84 incidents, 20 responders, 0 logs. No invalid assignment links, inconsistent responder links, duplicate active assignments, or orphan logs found. This snapshot had no dispatch history, so isolated tests supplied the lifecycle coverage.

## Confirmed issues and limitations

1. **Timeout re-match failures are not retried.** `src/services/dispatch.js:79` clears the timer before calling `dispatchMatch`. If re-matching fails, the timer callback's identity check at line 59 cannot schedule another attempt. Injecting a failure into the reassigned log write reproduced a pending incident with available responders and no retry timer. The transaction correctly rolled back the replacement claim. Persist/retry pending dispatch work after a transient failure.
2. **Assignments lose confirmation deadlines across restart.** Timer state exists only in the process Map. An isolated child process assigned a responder and exited; a fresh service instance left that responder claimed after more than 15 seconds. Persist the deadline and recover unconfirmed assignments on startup.
3. **Late confirmations can confirm the replacement assignment.** After responder A times out and B is assigned, an old confirmation containing only incident_id changes B to en_route. Reproduced using the real models/state machine. Confirmation should identify the expected responder or assignment version and reject stale confirmations. This requires a frontend/API contract update.
4. **Severity bonus does not implement cross-incident priority.** The added constant changes reported scores but leaves each incident's responder ranking unchanged, and there is no priority admission queue. High-severity requests are not guaranteed preference under contention. This is documented in README.

## Additional hardening gaps found by inspection

- The schema has primary keys and CHECK constraints, but no foreign keys or unique constraint preventing multiple active incident references to one responder. Application transactions enforce the tested workflows; direct SQL or other writers can bypass these invariants.
- Only primary-key indexes exist. Filtered lists and per-incident history may need indexes/pagination as data grows; no large-dataset benchmark was performed.
- The copied mutex retains every key in its Map after completion. Memory usage grows with distinct incident IDs over a long-running process.
- Authentication is absent and CORS permits all origins, as documented for the hackathon backend. It is not ready to expose as a protected production service.

All mutation-based additional probes ran in fresh isolated PostgreSQL schemas that were removed afterward. Existing application data was not used for dispatch probes. No claim of exhaustive testing or perfection is made.
