const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { app } = require('../../server');
const pool = require('../config/db');
const Incident = require('../models/incident');
const Responder = require('../models/responder');
const DispatchLog = require('../models/dispatchLog');

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const incidents = [];
  let responder, log;
  let checks = 0;
  async function request(path, status, options) {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    assert.equal(response.status, status, `${path}: ${JSON.stringify(body)}`);
    if (status >= 400) {
      assert.equal(typeof body.error, 'string');
      assert.equal(body.stack, undefined);
    }
    checks++;
    return body;
  }
  const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const valid = { type: 'fire', severity: 4, lat: 12.94, lon: 77.61 };
    const created = await request('/incidents', 201, post({ ...valid, status: 'resolved' }));
    incidents.push(created.id);
    assert.equal(created.status, 'pending');
    assert.equal(created.assigned_responder_id, null);
    assert.deepEqual(await request(`/incidents/${created.id}`, 200), created);
    responder = await Responder.create({ name: 'API test only', type: 'fire', lat: 12.95, lon: 77.62 });
    log = await DispatchLog.create({ incident_id: created.id, responder_id: responder.id, action: 'assigned' });
    assert.equal((await request(`/responders/${responder.id}`, 200)).name, responder.name);
    for (const [path, id, timestamp] of [
      ['/incidents', created.id, 'reported_at'], ['/responders', responder.id, 'last_updated_at'], ['/dispatch/logs', log.id, 'timestamp'],
    ]) {
      const rows = await request(path, 200);
      assert.ok(rows.some(row => row.id === id));
      for (let i = 1; i < rows.length; i++) assert.ok(Date.parse(rows[i - 1][timestamp]) >= Date.parse(rows[i][timestamp]));
    }
    for (const [path, statuses] of [['/incidents', ['pending', 'assigned', 'resolved']], ['/responders', ['available', 'claimed', 'en_route', 'busy']]]) {
      for (const status of statuses) assert.ok((await request(`${path}?status=${status}`, 200)).every(row => row.status === status));
      for (const query of ['status=invalid', 'status=', 'status=a&status=b', 'status[x]=pending']) await request(`${path}?${query}`, 400);
      await request(`${path}/${randomUUID()}`, 404);
      await request(`${path}/invalid-id`, 400);
    }
    for (const field of Object.keys(valid)) {
      const missing = { ...valid }; delete missing[field];
      await request('/incidents', 400, post(missing));
      for (const value of [null, true, {}, []]) await request('/incidents', 400, post({ ...valid, [field]: value }));
    }
    for (const patch of [{type:'invalid'}, {severity:0}, {severity:6}, {severity:1.5}, {severity:'4'}, {lat:'12.94'}, {lat:91}, {lat:-91}, {lon:181}, {lon:-181}, {lon:'77.61'}]) {
      await request('/incidents', 400, post({ ...valid, ...patch }));
    }
    for (const body of [[], null, 'text', 42]) await request('/incidents', 400, post(body));
    await request('/incidents', 400, { method:'POST' });
    await request('/incidents', 400, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{"type":' });
    await request('/incidents', 413, post({ ...valid, padding: 'x'.repeat(110000) }));
    await request('/missing-route', 404);
    for (const origin of ['http://localhost:3000', 'http://localhost:5173']) {
      const response = await fetch(base + '/incidents', {
        method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      assert.match(response.headers.get('access-control-allow-methods'), /POST/);
      assert.match(response.headers.get('access-control-allow-headers'), /content-type/i);
      checks++;
    }
    for (const [model, method, path, options] of [
      [Incident, 'create', '/incidents', post(valid)],
      [Incident, 'findById', `/incidents/${created.id}`],
      [Responder, 'findAll', '/responders'],
      [Responder, 'findById', `/responders/${responder.id}`],
      [DispatchLog, 'findAll', '/dispatch/logs'],
    ]) {
      const saved = model[method];
      try {
        model[method] = async () => { throw new Error('Simulated database failure'); };
        assert.deepEqual(await request(path, 500, options), { error: 'Internal server error' });
      } finally { model[method] = saved; }
    }
    // Fault injection applies only inside this temporary test server process.
    const original = Incident.findAll;
    try {
      Incident.findAll = async () => { throw new Error('Simulated database failure'); };
      assert.deepEqual(await request('/incidents', 500), { error:'Internal server error' });
    } finally { Incident.findAll = original; }
    await request('/incidents', 200);
    assert.deepEqual(await request('/health', 200), {status:'ok'});
    console.log(`PASS: ${checks} HTTP checks including all endpoints, validation, malformed JSON, 404s, and recovery after a simulated DB failure.`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    try {
      if (log) await pool.query('DELETE FROM dispatch_logs WHERE id = $1', [log.id]);
      if (responder) await pool.query('DELETE FROM responders WHERE id = $1', [responder.id]);
      if (incidents.length) await pool.query('DELETE FROM incidents WHERE id = ANY($1::uuid[])', [incidents]);
    } finally { await pool.end(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
