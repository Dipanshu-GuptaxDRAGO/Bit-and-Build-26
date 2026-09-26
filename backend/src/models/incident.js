// Optional final db argument accepts a transaction client; defaults to the shared pool.
/**
 * Incident model - data-access layer for the incidents table.
 */
const pool = require('../config/db');

const Incident = {
  /**
   * Create a new incident.
   * @param {{ type: string, severity: number, lat: number, lon: number }} data
   * @returns {Promise<object>} The created incident row.
   */
  async create({ type, severity, lat, lon }, db = pool) {
    const { rows } = await db.query(
      `INSERT INTO incidents (type, severity, lat, lon)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [type, severity, lat, lon],
    );
    return rows[0];
  },

  /**
   * Fetch all incidents, optionally filtered by status.
   * @param {{ status?: string }} [filters={}]
   * @returns {Promise<object[]>}
   */
  async findAll(filters = {}, db = pool) {
    if (filters.status !== undefined) {
      const { rows } = await db.query(
        'SELECT * FROM incidents WHERE status = $1 ORDER BY reported_at DESC',
        [filters.status],
      );
      return rows;
    }
    const { rows } = await db.query(
      'SELECT * FROM incidents ORDER BY reported_at DESC',
    );
    return rows;
  },

  /**
   * Find a single incident by its UUID.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id, db = pool) {
    const { rows } = await db.query(
      'SELECT * FROM incidents WHERE id = $1',
      [id],
    );
    return rows[0] || null;
  },
};

module.exports = Incident;
