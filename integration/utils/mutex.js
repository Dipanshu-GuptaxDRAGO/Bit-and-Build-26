/**
 * utils/mutex.js
 * ------------------------------------------------------------------
 * A tiny per-key async mutex.
 *
 * The atomic claim itself (data/store.js#tryClaimResponder) is already
 * safe on its own -- it's a synchronous compare-and-swap, and Node's
 * single-threaded event loop guarantees no interleaving inside it.
 *
 * But the *matching workflow* around it (score candidates -> pick best
 * -> attempt claim -> retry on miss) is an async, multi-step process.
 * If two requests come in for the SAME incident_id at once (e.g. a
 * double-submit from the frontend), we don't want two matching runs
 * interleaving and racing each other. This mutex serializes matching
 * runs per incident_id so each one finishes cleanly before the next
 * one starts.
 *
 * Implementation: a simple promise chain (queue) per key.
 * ------------------------------------------------------------------
 */

'use strict';

const tails = new Map(); // key -> Promise (tail of the queue for that key)

/**
 * Run `fn` exclusively for the given `key`. Calls for different keys
 * run fully in parallel; calls for the same key run one at a time, in
 * the order they arrived, regardless of how long each `fn()` takes.
 */
function withLock(key, fn) {
  const tail = tails.get(key) || Promise.resolve();

  // Chain our work onto the tail. Using the two-arg form of .then()
  // means a rejected previous run doesn't block the one queued behind it.
  const run = tail.then(fn, fn);

  // Keep the chain itself always-resolved so future .then()s never see
  // a poisoned (permanently rejected) promise.
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  );

  return run;
}

module.exports = { withLock };
