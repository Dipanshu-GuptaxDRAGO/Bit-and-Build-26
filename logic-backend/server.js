'use strict';

const express = require('express');
const store = require('./data/store');
const dispatchRoutes = require('./routes/dispatch');

const app = express();
app.use(express.json());

app.use('/dispatch', dispatchRoutes);

// --------------------------------------------------------------------
// Debug/demo-only endpoints. These are NOT part of the required API --
// they exist purely so you (or a judge) can seed state and inspect it
// without touching your teammates' incident-feed or frontend work.
// Feel free to delete this block once real data-layer wiring lands.
// --------------------------------------------------------------------
app.post('/debug/seed-responder', (req, res) => {
  res.json(store.seedResponder(req.body));
});

app.post('/debug/seed-incident', (req, res) => {
  res.json(store.seedIncident(req.body));
});

app.get('/debug/state', (req, res) => {
  res.json({
    responders: store.listAllResponders(),
  });
});

app.get('/debug/incident/:id', (req, res) => {
  const incident = store.getIncident(req.params.id);
  if (!incident) return res.status(404).json({ error: 'not found' });
  res.json({
    incident,
    logs: store.listLogsForIncident(req.params.id),
  });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Web-Shooter Dispatch listening on :${PORT}`);
  });
}

module.exports = app;
