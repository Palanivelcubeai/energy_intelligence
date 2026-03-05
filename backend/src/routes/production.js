const router = require("express").Router();
const pool = require("../db");

// GET /api/production/by-machine?from=DATE&to=DATE
router.get("/by-machine", async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `SELECT machine_id, SUM(parts_produced) AS total_parts, SUM(kwh) AS total_energy,
                   AVG(efficiency_score) AS avg_efficiency
                 FROM machine_metrics`;
    const params = [];
    if (from && to) {
      query += " WHERE recorded_at::date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    query += " GROUP BY machine_id ORDER BY machine_id";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /production/by-machine error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/production/by-shift?from=DATE&to=DATE
router.get("/by-shift", async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `SELECT
                   CASE WHEN EXTRACT(HOUR FROM recorded_at) BETWEEN 6 AND 13 THEN 'Morning'
                        WHEN EXTRACT(HOUR FROM recorded_at) BETWEEN 14 AND 21 THEN 'Afternoon'
                        ELSE 'Night' END AS shift,
                   machine_id, SUM(parts_produced) AS parts_produced,
                   SUM(rejection_count) AS parts_rejected,
                   ROUND(AVG(efficiency_score)) AS efficiency_pct
                 FROM machine_metrics`;
    const params = [];
    if (from && to) {
      query += " WHERE recorded_at::date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    query += " GROUP BY shift, machine_id ORDER BY shift, machine_id";
    const { rows } = await pool.query(query, params);

    // Reshape to frontend format: [ { shift, CNC-1: n, CNC-2: n, ... } ]
    const shiftMap = {};
    rows.forEach((r) => {
      if (!shiftMap[r.shift]) shiftMap[r.shift] = { shift: r.shift };
      shiftMap[r.shift][r.machine_id] = r.parts_produced;
    });
    res.json(Object.values(shiftMap));
  } catch (err) {
    console.error("GET /production/by-shift error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/production/monthly
router.get("/monthly", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT TO_CHAR(recorded_at, 'Mon') AS month,
              SUM(parts_produced) AS production, SUM(kwh) AS energy
       FROM machine_metrics
       WHERE recorded_at >= DATE_TRUNC('year', NOW())
       GROUP BY EXTRACT(MONTH FROM recorded_at), TO_CHAR(recorded_at, 'Mon')
       ORDER BY EXTRACT(MONTH FROM recorded_at)`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /production/monthly error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/production/weekly?from=DATE&to=DATE
router.get("/weekly", async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `SELECT recorded_at::date AS record_date, SUM(parts_produced) AS production, SUM(kwh) AS energy
                 FROM machine_metrics`;
    const params = [];
    if (from && to) {
      query += " WHERE recorded_at::date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    query += " GROUP BY recorded_at::date ORDER BY recorded_at::date";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /production/weekly error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
