const router = require("express").Router();
const pool = require("../db");

// GET /api/production/by-machine?from=DATE&to=DATE
router.get("/by-machine", async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `SELECT machine_id, SUM(production) AS total_parts, SUM(energy_kwh) AS total_energy,
                   AVG(efficiency_score) AS avg_efficiency
                 FROM energy_output_daily`;
    const params = [];
    if (from && to) {
      query += " WHERE record_date BETWEEN $1 AND $2";
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
    let query = `SELECT shift, machine_id, SUM(parts_produced) AS parts_produced,
                   SUM(parts_rejected) AS parts_rejected, SUM(production_target) AS production_target,
                   ROUND(AVG(efficiency_pct)) AS efficiency_pct
                 FROM shift_production`;
    const params = [];
    if (from && to) {
      query += " WHERE record_date BETWEEN $1 AND $2";
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
      `SELECT month, total_production AS production, total_energy_kwh AS energy
       FROM monthly_production ORDER BY year, 
       CASE month WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
       WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
       WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
       WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12 END`
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
    let query = `SELECT record_date, SUM(production) AS production, SUM(energy_kwh) AS energy
                 FROM energy_output_daily`;
    const params = [];
    if (from && to) {
      query += " WHERE record_date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    query += " GROUP BY record_date ORDER BY record_date";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /production/weekly error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
