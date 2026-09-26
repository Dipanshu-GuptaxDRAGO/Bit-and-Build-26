const assert = require('node:assert/strict');
const { port } = require('../src/config/env');
const base = `http://localhost:${port}`;
const missing = '00000000-0000-0000-0000-000000000000';
let failures = 0;

async function check(path, expected = 200, options = {}) {
  try {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(1500) });
    assert.equal(response.status, expected);
    const body = await response.json();
    if (expected >= 400) assert.equal(typeof body.error, 'string');
    else if (path === '/health') assert.deepEqual(body, {status:'ok'});
    else assert.ok(Array.isArray(body) || (body && typeof body.id === 'string'));
    console.log(`PASS ${options.method || 'GET'} ${path} (${expected})`);
    return body;
  } catch (error) {
    failures++;
    console.error(`FAIL ${options.method || 'GET'} ${path}: ${error.message}`);
  }
}

async function main() {
  const [, incidents, responders] = await Promise.all([
    check('/health'), check('/incidents?status=pending'), check('/responders?status=available'),
    check('/dispatch/logs'),
    // Non-mutating intake check; api:test covers successful creation and cleanup.
    check('/incidents', 400, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),
  ]);
  await Promise.all([
    check(`/incidents/${incidents?.[0]?.id || missing}`, incidents?.length ? 200 : 404),
    check(`/responders/${responders?.[0]?.id || missing}`, responders?.length ? 200 : 404),
  ]);
  console.log(failures ? `${failures} sanity checks failed.` : 'All 7 endpoint sanity checks passed (no data written).');
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
