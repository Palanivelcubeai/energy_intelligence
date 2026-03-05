const router = require("express").Router();
const pool = require("../db");

// GET /api/energy-output/by-machine?from=DATE&to=DATE
router.get("/by-machine", async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `SELECT e.record_date AS date, e.machine_id AS machine, m.name AS "machineName",
                   e.energy_kwh AS energy, e.production, e.runtime_hours, e.idle_hours,
                   e.energy_per_part, e.cost_per_part, e.efficiency_score, e.status
                 FROM energy_output_daily e
                 JOIN machines m ON m.id = e.machine_id`;
    const params = [];
    if (from && to) {
      query += " WHERE e.record_date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    query += " ORDER BY e.record_date DESC, e.machine_id";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /energy-output/by-machine error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/energy-output/aggregate?from=DATE&to=DATE
router.get("/aggregate", async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let whereClause = "";
    if (from && to) {
      whereClause = "WHERE e.record_date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    const { rows } = await pool.query(
      `SELECT e.machine_id AS name, m.name AS "machineName",
         CASE WHEN SUM(e.production) > 0
              THEN ROUND(SUM(e.energy_kwh) / SUM(e.production), 2) ELSE 0 END AS energy_per_part,
         CASE WHEN SUM(e.production) > 0
              THEN ROUND(SUM(e.energy_kwh) / SUM(e.production) * sc.tariff_per_kwh, 2) ELSE 0 END AS cost_per_part,
         ROUND(SUM(e.energy_kwh)::numeric, 1) AS "totalEnergy",
         SUM(e.production) AS "totalParts",
         ROUND(AVG(e.efficiency_score)) AS "avgEfficiency"
       FROM energy_output_daily e
       JOIN machines m ON m.id = e.machine_id
       CROSS JOIN system_config sc
       ${whereClause}
       GROUP BY e.machine_id, m.name, sc.tariff_per_kwh
       ORDER BY e.machine_id`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /energy-output/aggregate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
