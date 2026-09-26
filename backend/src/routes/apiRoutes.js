const router = require('express').Router();
const controller = require('../controllers/apiController');

// Express 4 needs rejected promises explicitly forwarded to error middleware.
const handle = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
router.post('/incidents', handle(controller.createIncident));
router.get('/incidents', handle(controller.listIncidents));
router.get('/incidents/:id', handle(controller.getIncident));
router.get('/responders', handle(controller.listResponders));
router.get('/responders/:id', handle(controller.getResponder));
router.get('/dispatch/logs', handle(controller.listLogs));
module.exports = router;
