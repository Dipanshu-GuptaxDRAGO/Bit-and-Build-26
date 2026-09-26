// Optional final db argument accepts a transaction client; defaults to the shared pool.
/**
 * DispatchLog model - data-access layer for the dispatch_logs table.
 */
const pool = require('../config/db');

const DispatchLog = {
  /**
   * Create a new dispatch log entry.
   * @param {{ incident_id: string, responder_id: string, action: string }} data
   * @returns {Promise<object>} The created log row.
   */
  async create({ incident_id, responder_id, action }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO dispatch_logs (incident_id, responder_id, action)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [incident_id, responder_id, action],
    );
    return rows[0];
  },

  /**
   * Fetch all dispatch logs, optionally filtered by action.
   * @param {{ action?: string }} [filters={}]
   * @returns {Promise<object[]>}
   */
  async findAll(filters = {}, db = pool) {
    if (filters.action !== undefined) {
      const { rows } = await db.query(
        'SELECT * FROM dispatch_logs WHERE action = $1 ORDER BY timestamp DESC',
        [filters.action],
      );
      return rows;
    }
    const { rows } = await db.query(
      'SELECT * FROM dispatch_logs ORDER BY timestamp DESC',
    );
    return rows;
  },

  /**
   * Find a single dispatch log entry by its UUID.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id, db = pool) {
    const { rows } = await db.query(
      'SELECT * FROM dispatch_logs WHERE id = $1',
      [id],
    );
    return rows[0] || null;
  },
};

module.exports = DispatchLog;
