const env = import.meta.env || {};
export const API_MODE = env.VITE_API_MODE === 'mock' ? 'mock' : 'live';
const BASE = (env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();
const types = ['fire', 'medical', 'security', 'other'];
let incidents = [
  { id: 'INC-1042', type: 'fire', severity: 5, lat: 12.982, lon: 77.605, status: 'pending', reported_at: iso(-42000), assigned_responder_id: null },
  { id: 'INC-1041', type: 'medical', severity: 4, lat: 12.961, lon: 77.586, status: 'pending', reported_at: iso(-75000), assigned_responder_id: null },
  { id: 'INC-1040', type: 'security', severity: 3, lat: 12.991, lon: 77.576, status: 'assigned', reported_at: iso(-120000), assigned_responder_id: 'UNIT-03' },
  { id: 'INC-1039', type: 'other', severity: 2, lat: 12.948, lon: 77.618, status: 'pending', reported_at: iso(-30000), assigned_responder_id: null },
];
let responders = Array.from({ length: 12 }, (_, i) => ({ id: `UNIT-${String(i + 1).padStart(2, '0')}`, name: ['Engine', 'Medic', 'Patrol', 'Support'][i % 4] + ` ${String(i + 1).padStart(2, '0')}`, type: types[i % 4], lat: 12.9716 + Math.sin(i * 2.1) * .033, lon: 77.5946 + Math.cos(i * 1.7) * .045, status: i === 2 ? 'en_route' : i === 7 ? 'busy' : 'available', last_updated_at: iso(), current_incident_id: i === 2 ? 'INC-1040' : null }));
let logs = [{ id: 'LOG-1', incident_id: 'INC-1040', responder_id: 'UNIT-03', action: 'assigned', timestamp: iso(-95000) }];
let sequence = 1042;
let lastSpawn = Date.now();
let lastMove = Date.now();
const clone = data => JSON.parse(JSON.stringify(data));
function simulate() {
  const now = Date.now();
  if (now - lastMove > 2200) {
    responders = responders.map((r, i) => r.status === 'busy' ? r : { ...r, lat: r.lat + Math.sin(now / 20000 + i) * .00018, lon: r.lon + Math.cos(now / 20000 + i) * .00018, last_updated_at: iso() });
    lastMove = now;
  }
  if (now - lastSpawn > 22000 && incidents.filter(i => i.status === 'pending').length < 10) {
    sequence++;
    incidents.push({ id: `INC-${sequence}`, type: types[sequence % 4], severity: sequence % 5 + 1, lat: 12.9716 + Math.sin(sequence * 2.3) * .03, lon: 77.5946 + Math.cos(sequence * 1.6) * .04, status: 'pending', reported_at: iso(), assigned_responder_id: null });
    lastSpawn = now;
  }
}
function record(incident, responder, action) { logs.push({ id: `LOG-${logs.length + 1}`, incident_id: incident.id, responder_id: responder?.id ?? null, action, timestamp: iso() }); }
const unavailable = () => new Error('No responder available — nearest units are all engaged.');
async function mock(path, body) {
  await new Promise(resolve => setTimeout(resolve, body ? 550 : 120));
  simulate();
  const [route, query] = path.split('?');
  const status = new URLSearchParams(query).get('status');
  if (!body) return clone(route === '/incidents' ? incidents.filter(i => !status || i.status === status) : route === '/responders' ? responders.filter(r => !status || r.status === status) : logs);
  if (route === '/incidents') {
    const item = { ...body, id: `INC-${++sequence}`, status: 'pending', reported_at: iso(), assigned_responder_id: null };
    incidents.push(item); return clone(item);
  }
  const incident = incidents.find(i => i.id === body.incident_id);
  if (!incident) throw new Error('Incident no longer exists. Refresh and try again.');
  if (route === '/dispatch/match') {
    if (incident.status !== 'pending') throw new Error('This incident is already assigned or resolved.');
    // Scripted fixture response only. Production owns matching and claim decisions.
    const unit = responders.find(r => r.status === 'available');
    if (!unit) throw unavailable();
    incident.status = 'assigned'; incident.assigned_responder_id = unit.id;
    incident.assignment_id = crypto.randomUUID(); incident.confirmation_deadline = iso(15000);
    unit.status = 'claimed'; unit.current_incident_id = incident.id; unit.last_updated_at = iso();
    record(incident, unit, 'assigned');
  } else if (route === '/dispatch/confirm') {
    if (!body.assignment_id || body.assignment_id !== incident.assignment_id) throw new Error('Stale assignment. Refresh before confirming.');
    incident.confirmation_deadline = null;
    const unit = responders.find(r => r.id === incident.assigned_responder_id);
    if (unit) { unit.status = 'en_route'; unit.last_updated_at = iso(); }
  } else if (route === '/dispatch/resolve') {
    if (incident.status !== 'assigned') throw new Error('Only assigned incidents can be resolved.');
    const unit = responders.find(r => r.id === incident.assigned_responder_id);
    incident.status = 'resolved';
    if (unit) { unit.status = 'available'; unit.current_incident_id = null; unit.last_updated_at = iso(); }
    record(incident, unit, 'resolved');
  }
  return clone(incident);
}
export async function request(path, body, { mode = API_MODE, fetcher = fetch } = {}) {
  if (mode === 'mock') return mock(path, body);
  const response = await fetcher(`${BASE}${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok || data?.ok === false || data?.success === false || data?.error || data?.status === 'no_responder_available' || (path === '/dispatch/match' && data === null && response.status !== 204)) {
    throw new Error(data?.message || data?.reason || (typeof data?.error === 'string' ? data.error : null) || (response.status === 404 || response.status === 409 ? unavailable().message : `Request failed (${response.status}). Please retry.`));
  }
  return data;
}
const list = async (path, key) => { const data = await request(path); const items = Array.isArray(data) ? data : data?.[key] ?? data?.data; if (!Array.isArray(items)) throw new Error(`Invalid ${key} response from API.`); return items; };
export const getIncidents = status => list(`/incidents${status ? `?status=${encodeURIComponent(status)}` : ''}`, 'incidents');
export const getResponders = status => list(`/responders${status ? `?status=${encodeURIComponent(status)}` : ''}`, 'responders');
export const getDispatchLogs = () => list('/dispatch/logs', 'logs');
export const createIncident = input => request('/incidents', input);
export const matchIncident = incident_id => request('/dispatch/match', { incident_id });
export const confirmDispatch = (incident_id, assignment_id) => request('/dispatch/confirm', { incident_id, assignment_id });
export const resolveIncident = incident_id => request('/dispatch/resolve', { incident_id });
