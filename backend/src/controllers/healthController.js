/**
 * Health check controller
 * Confirms that the Express server is up and responsive.
 */
const getHealth = (req, res) => {
  res.status(200).json({ status: "ok" });
};

module.exports = {
  getHealth,
};
