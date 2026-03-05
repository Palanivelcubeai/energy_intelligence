const router = require("express").Router();
const pool = require("../db");

// GET /api/demand/trend?from=DATE&to=DATE
router.get("/trend", async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `SELECT recorded_at AS time, demand_kva AS demand, contract_demand_kva AS contract
                 FROM demand_records`;
    const params = [];
    if (from && to) {
      query += " WHERE recorded_at BETWEEN $1 AND $2";
      params.push(from, to);
    } else {
      query += " WHERE recorded_at >= NOW() - INTERVAL '24 hours'";
    }
    query += " ORDER BY recorded_at";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /demand/trend error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/demand/current
router.get("/current", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT demand_kva AS demand, contract_demand_kva AS contract, utilization_pct, risk_level
       FROM demand_records ORDER BY recorded_at DESC LIMIT 1`
    );
    res.json(rows[0] || {});
  } catch (err) {
    console.error("GET /demand/current error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/demand/peak-events
router.get("/peak-events", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT recorded_at AS time, demand_kva AS demand, contract_demand_kva AS contract,
              utilization_pct, risk_level
       FROM demand_records
       WHERE risk_level IN ('Warning', 'Critical')
       ORDER BY recorded_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /demand/peak-events error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
