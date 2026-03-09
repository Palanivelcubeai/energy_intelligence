const router = require("express").Router();
const pool = require("../db");

// GET /api/energy-output/by-machine?from=DATE&to=DATE
router.get("/by-machine", async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let where = "";
    if (from && to) {
      where = "WHERE p.record_date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    const { rows } = await pool.query(
      `SELECT
         p.record_date                          AS date,
         p.machine_id                           AS machine,
         m.name                                 AS "machineName",
         ROUND(SUM(p.energy_kwh_used)::numeric, 2)  AS energy,
         SUM(p.parts_produced)                  AS production,
         ROUND(SUM(p.runtime_hours)::numeric, 2) AS runtime_hours,
         ROUND(SUM(p.idle_hours)::numeric, 2)    AS idle_hours,
         CASE WHEN SUM(p.parts_produced) > 0
              THEN ROUND(SUM(p.energy_kwh_used) / SUM(p.parts_produced), 2)
              ELSE 0 END                         AS energy_per_part,
         CASE WHEN SUM(p.parts_produced) > 0
              THEN ROUND(SUM(p.energy_kwh_used) / SUM(p.parts_produced) * sc.tariff_per_kwh, 2)
              ELSE 0 END                         AS cost_per_part,
         ROUND(AVG(p.efficiency_score))          AS efficiency_score,
         m.status
       FROM machine_parts_produced p
       JOIN machines m ON m.id = p.machine_id
       CROSS JOIN system_config sc
       ${where}
       GROUP BY p.record_date, p.machine_id, m.name, m.status, sc.tariff_per_kwh
       ORDER BY p.record_date DESC, p.machine_id`,
      params
    );
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
    let where = "";
    if (from && to) {
      where = "WHERE p.record_date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    const { rows } = await pool.query(
      `SELECT
         p.machine_id                            AS name,
         m.name                                  AS "machineName",
         CASE WHEN SUM(p.parts_produced) > 0
              THEN ROUND(SUM(p.energy_kwh_used) / SUM(p.parts_produced), 2)
              ELSE 0 END                          AS energy_per_part,
         CASE WHEN SUM(p.parts_produced) > 0
              THEN ROUND(SUM(p.energy_kwh_used) / SUM(p.parts_produced) * sc.tariff_per_kwh, 2)
              ELSE 0 END                          AS cost_per_part,
         ROUND(SUM(p.energy_kwh_used)::numeric, 1) AS "totalEnergy",
         SUM(p.parts_produced)                   AS "totalParts",
         ROUND(AVG(p.efficiency_score))           AS "avgEfficiency"
       FROM machine_parts_produced p
       JOIN machines m ON m.id = p.machine_id
       CROSS JOIN system_config sc
       ${where}
       GROUP BY p.machine_id, m.name, sc.tariff_per_kwh
       ORDER BY p.machine_id`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /energy-output/aggregate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

