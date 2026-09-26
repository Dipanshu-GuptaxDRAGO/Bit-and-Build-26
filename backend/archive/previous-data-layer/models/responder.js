/**
 * Responder model — data-access layer for the responders table.
 */
const pool = require('../config/db');

const Responder = {
  /**
   * Create a new responder.
   * @param {{ name: string, type: string, lat: number, lon: number }} data
   * @returns {Promise<object>} The created responder row.
   */
  async create({ name, type, lat, lon }) {
    const { rows } = await pool.query(
      `INSERT INTO responders (name, type, lat, lon)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, type, lat, lon],
    );
    return rows[0];
  },

  /**
   * Fetch all responders, optionally filtered by status.
   * @param {{ status?: string }} [filters={}]
   * @returns {Promise<object[]>}
   */
  async findAll(filters = {}) {
    if (filters.status) {
      const { rows } = await pool.query(
        'SELECT * FROM responders WHERE status = $1 ORDER BY last_updated_at DESC',
        [filters.status],
      );
      return rows;
    }
    const { rows } = await pool.query(
      'SELECT * FROM responders ORDER BY last_updated_at DESC',
    );
    return rows;
  },

  /**
   * Find a single responder by their UUID.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    const { rows } = await pool.query(
      'SELECT * FROM responders WHERE id = $1',
      [id],
    );
    return rows[0] || null;
  },
};

module.exports = Responder;
