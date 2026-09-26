const Incident = require('../models/incident');
const Responder = require('../models/responder');
const DispatchLog = require('../models/dispatchLog');

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function statusFilter(query, allowed) {
  if (query.status === undefined) return {};
  if (typeof query.status !== 'string' || !allowed.includes(query.status)) {
    badRequest(`status must be one of: ${allowed.join(', ')}`);
  }
  return { status: query.status };
}

async function byId(model, label, req, res) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(req.params.id)) {
    badRequest('id must be a valid UUID');
  }
  const row = await model.findById(req.params.id);
  if (!row) return res.status(404).json({ error: `${label} not found` });
  return res.json(row);
}

exports.createIncident = async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Body must be a JSON object');
  const { type, severity, lat, lon } = body;
  if (!['fire', 'medical', 'security', 'other'].includes(type)) {
    badRequest('type must be one of: fire, medical, security, other');
  }
  if (!Number.isInteger(severity) || severity < 1 || severity > 5) badRequest('severity must be an integer from 1 to 5');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) badRequest('lat must be a number from -90 to 90');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) badRequest('lon must be a number from -180 to 180');
  res.status(201).json(await Incident.create({ type, severity, lat, lon }));
};
exports.listIncidents = async (req, res) => {
  res.json(await Incident.findAll(statusFilter(req.query, ['pending', 'assigned', 'resolved'])));
};
exports.listResponders = async (req, res) => {
  res.json(await Responder.findAll(statusFilter(req.query, ['available', 'claimed', 'en_route', 'busy'])));
};
exports.getIncident = (req, res) => byId(Incident, 'Incident', req, res);
exports.getResponder = (req, res) => byId(Responder, 'Responder', req, res);
exports.listLogs = async (req, res) => res.json(await DispatchLog.findAll());
