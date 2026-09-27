import express from '../database/node_modules/express/index.js';
import { start } from 'workflow/api';
import { monitorDispatch } from '../workflows/dispatch';
import unified from '../database/server.js';
process.env.DISPATCH_RUNTIME = 'workflow';
const app = express();
app.use(express.json());
app.post('/api/dispatch/match', async (req, res, next) => {
  const id = req.body?.incident_id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return next();
  try {
    // Enqueue durable monitoring BEFORE claiming. A failed start cannot leave
    // an assigned incident without a monitor. Duplicate monitors are safe.
    await start(monitorDispatch, [id]);
    next();
  } catch (error) { next(error); }
});
app.use('/api', unified.app);
app.use((error, req, res, next) => {
  console.error('API request failed:', error.message);
  res.status(503).json({ error: 'Dispatch service unavailable. Please retry.' });
});
export default app;
