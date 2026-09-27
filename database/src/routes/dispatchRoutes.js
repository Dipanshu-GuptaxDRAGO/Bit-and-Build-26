const router = require('express').Router();
const dispatch = require('../services/dispatch');
const DispatchLog = require('../models/dispatchLog');
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const handle = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
function validId(id, field = 'incident_id') {
  if (typeof id !== 'string' || !uuid.test(id)) {
    const error = new Error(`${field} must be a valid UUID`);
    error.status = 400;
    throw error;
  }
  return id;
}
for (const [action, method] of [['match', 'dispatchMatch'], ['confirm', 'dispatchConfirm'], ['resolve', 'dispatchResolve']]) {
  router.post(`/${action}`, handle(async (req, res) => {
    const incidentId = validId(req.body?.incident_id);
    const assignmentId = action === 'confirm' ? validId(req.body?.assignment_id, 'assignment_id') : undefined;
    const result = await dispatch[method](incidentId, assignmentId);
    if (action === 'match') {
      if (!result.ok) return res.status(result.reason === 'incident_not_found' ? 404 : 200).json({
        ok: false, message: result.reason === 'no_responder_available' ? 'no responder available' : result.reason,
      });
      return res.json({ ok: true, incident: result.incident, responder: result.responder, match: { score: result.score, ...result.scoring } });
    }
    return res.status(result.ok ? 200 : result.reason === 'incident_not_found' ? 404 : 409).json(result);
  }));
}
router.get('/logs/:incident_id', handle(async (req, res) => {
  res.json(await DispatchLog.findByIncident(validId(req.params.incident_id)));
}));
module.exports = router;
