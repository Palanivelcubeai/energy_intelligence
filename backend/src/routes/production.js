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
    const params = [];
    let where = "";
    if (from && to) {
      where = " WHERE record_date BETWEEN $1 AND $2";
      params.push(from, to);
    } else {
      // Default: today only so the chart shows today's per-shift breakdown
      where = " WHERE record_date = CURRENT_DATE";
    }

    const { rows } = await pool.query(
      `SELECT
         CASE shift
           WHEN 'Shift A (06-14)' THEN 'Morning'
           WHEN 'Shift B (14-22)' THEN 'Afternoon'
           ELSE 'Night' END  AS shift,
         machine_id,
         SUM(parts_produced)  AS parts_produced,
         SUM(parts_rejected)  AS parts_rejected,
         ROUND(AVG(efficiency_score)) AS efficiency_pct
       FROM machine_parts_produced${where}
       GROUP BY shift, machine_id
       ORDER BY shift, machine_id`,
      params
    );

    // Reshape to frontend format: [ { shift, CNC-1: n, CNC-2: n, ... } ]
    const shiftMap = {};
    rows.forEach((r) => {
      if (!shiftMap[r.shift]) shiftMap[r.shift] = { shift: r.shift };
      shiftMap[r.shift][r.machine_id] = Number(r.parts_produced);
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
      `SELECT TO_CHAR(record_date, 'Mon') AS month,
              SUM(parts_produced) AS production
       FROM machine_parts_produced
       WHERE record_date >= DATE_TRUNC('year', CURRENT_DATE)
       GROUP BY EXTRACT(MONTH FROM record_date), TO_CHAR(record_date, 'Mon')
       ORDER BY EXTRACT(MONTH FROM record_date)`
    );
    res.json(rows.map(r => ({ month: r.month, production: parseInt(r.production) || 0 })));
  } catch (err) {
    console.error("GET /production/monthly error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/production/weekly?from=DATE&to=DATE
router.get("/weekly", async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let where = "";
    if (from && to) {
      where = " WHERE record_date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    // Use machine_parts_produced (incremental per-shift rows) to get correct daily totals.
    // machine_metrics.parts_produced is cumulative — SUM() on it gives inflated values.
    const { rows } = await pool.query(
      `SELECT
         record_date,
         SUM(parts_produced)  AS production,
         SUM(energy_kwh_used) AS energy
       FROM machine_parts_produced${where}
       GROUP BY record_date
       ORDER BY record_date`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /production/weekly error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
