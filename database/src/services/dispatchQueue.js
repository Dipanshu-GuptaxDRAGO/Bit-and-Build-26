'use strict';
const pool = require('../config/db');
const ADMISSION_WINDOW_MS = 10;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// PostgreSQL coordinates all Vercel instances, not just one process. A short
// admission window allows concurrently queued requests to compete by severity.
async function admit(id, options, execute) {
  const { rows: incidents } = await pool.query('SELECT id FROM incidents WHERE id = $1', [id]);
  if (!incidents.length) return { ok: false, reason: 'incident_not_found' };
  const { rows: jobs } = await pool.query('INSERT INTO dispatch_requests (incident_id, options) VALUES ($1, $2) RETURNING id', [id, JSON.stringify(options)]);
  const jobId = jobs[0].id;
  await delay(ADMISSION_WINDOW_MS);
  while (true) {
    const { rows } = await pool.query('SELECT result, error, completed_at FROM dispatch_requests WHERE id = $1', [jobId]);
    if (rows[0].completed_at) {
      if (rows[0].error) throw new Error(rows[0].error);
      return rows[0].result;
    }
    await processNext(execute);
    await delay(5);
  }
}
async function processNext(execute) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Never hold all pooled clients waiting for this lock: the winner needs a
    // second client for the existing assignment transaction.
    const { rows: lock } = await db.query('SELECT pg_try_advisory_xact_lock(hashtext(current_schema()), 73151) AS acquired');
    if (!lock[0].acquired) { await db.query('ROLLBACK'); return; }
    const { rows } = await db.query(`SELECT q.* FROM dispatch_requests q JOIN incidents i ON i.id = q.incident_id
      WHERE q.completed_at IS NULL ORDER BY i.severity DESC, q.requested_at ASC, q.id ASC LIMIT 1 FOR UPDATE OF q`);
    if (rows.length) {
      const job = rows[0];
      try {
        const result = await execute(job.incident_id, { ...job.options, requestId: job.id });
        await db.query('UPDATE dispatch_requests SET result = $2, completed_at = clock_timestamp() WHERE id = $1', [job.id, JSON.stringify(result)]);
      } catch (error) {
        await db.query('UPDATE dispatch_requests SET error = $2, completed_at = clock_timestamp() WHERE id = $1', [job.id, error.message]);
      }
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
  finally { db.release(); }
}
module.exports = { admit, processNext, ADMISSION_WINDOW_MS };
