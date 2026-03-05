const router = require("express").Router();
const pool = require("../db");

// GET /api/insights/all
router.get("/all", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, severity, message, financial_impact, production_impact,
              confidence_pct AS confidence, suggested_action, machine_id AS machine
       FROM insights ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /insights/all error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/insights/top — top 4 most recent
router.get("/top", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, severity, message, financial_impact, production_impact,
              confidence_pct AS confidence, suggested_action, machine_id AS machine
       FROM insights ORDER BY created_at DESC LIMIT 4`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /insights/top error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
