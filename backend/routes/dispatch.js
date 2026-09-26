/**
 * routes/dispatch.js
 * Thin HTTP layer -- all logic lives in lib/dispatch.js and lib/matching.js.
 */

'use strict';

const express = require('express');
const { dispatchMatch, dispatchConfirm, dispatchResolve } = require('../lib/dispatch');

const router = express.Router();

// POST /dispatch/match { incident_id }
router.post('/match', async (req, res) => {
  const { incident_id } = req.body || {};
  if (!incident_id) {
    return res.status(400).json({ ok: false, error: 'incident_id is required' });
  }

  const result = await dispatchMatch(incident_id);

  if (!result.ok) {
    const status = result.reason === 'incident_not_found' ? 404 : 200;
    return res.status(status).json({
      ok: false,
      message:
        result.reason === 'no_responder_available'
          ? 'no responder available'
          : result.reason,
    });
  }

  return res.status(200).json({
    ok: true,
    incident: result.incident,
    responder: result.responder,
    match: { score: result.score, ...result.scoring },
  });
});

// POST /dispatch/confirm { incident_id }
router.post('/confirm', (req, res) => {
  const { incident_id } = req.body || {};
  if (!incident_id) {
    return res.status(400).json({ ok: false, error: 'incident_id is required' });
  }

  const result = dispatchConfirm(incident_id);
  const status = result.ok ? 200 : result.reason === 'incident_not_found' ? 404 : 409;
  return res.status(status).json(result);
});

// POST /dispatch/resolve { incident_id }
router.post('/resolve', (req, res) => {
  const { incident_id } = req.body || {};
  if (!incident_id) {
    return res.status(400).json({ ok: false, error: 'incident_id is required' });
  }

  const result = dispatchResolve(incident_id);
  const status = result.ok ? 200 : 404;
  return res.status(status).json(result);
});

module.exports = router;
