const express = require('express');
const cors = require('cors');
const { port } = require('./src/config/env');
const pool = require('./src/config/db');
const healthRoutes = require('./src/routes/healthRoutes');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json());
app.use(healthRoutes);
app.use(require('./src/routes/apiRoutes'));
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use(require('./src/middleware/errorHandler'));

async function start() {
  // Verify the database before accepting HTTP requests.
  await pool.query('SELECT 1');
  await require('./src/services/dispatch').startRecovery();
  console.log('PostgreSQL connected successfully.');
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`Web-Shooter Dispatch listening on port ${port}`);

  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    require('./src/services/dispatch').stopTimeouts();
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(async (error) => {
      try {
        await require('./src/services/dispatch').stopRecovery();
        await pool.end();
        if (error) throw error;
      } catch (shutdownError) {
        console.error('Shutdown failed:', shutdownError.message);
        process.exitCode = 1;
      } finally {
        clearTimeout(timeout);
      }
    });
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  start().catch(async (error) => {
    console.error('Server startup failed:', error.message || error.code || 'Unknown error');
    process.exitCode = 1;
    await require('./src/services/dispatch').stopRecovery();
    await pool.end();
  });
}
module.exports = { app, start };
