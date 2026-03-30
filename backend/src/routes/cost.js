const router = require("express").Router();
const pool = require("../db");

// GET /api/cost/breakdown
router.get("/breakdown", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sc.tariff_per_kwh AS "energyRate",
              sc.demand_penalty_rate AS "demandCharge",
              sc.contract_demand_kva AS "contractDemand"
       FROM system_config sc LIMIT 1`
    );
    const config = rows[0] || { energyRate: 8.5, demandCharge: 350, contractDemand: 85 };

    const { rows: machineRows } = await pool.query(
      `SELECT m.id, m.name, m.status,
              COALESCE(SUM(mp.energy_kwh_used), 0) AS energy_kwh,
              COALESCE(SUM(mp.parts_produced), 0)  AS production,
              COALESCE(SUM(mp.idle_hours), 0)       AS idle_hours
       FROM machines m
       LEFT JOIN machine_parts_produced mp
              ON mp.machine_id = m.id AND mp.recorded_at::date = CURRENT_DATE
       GROUP BY m.id, m.name, m.status
       ORDER BY m.id`
    );

    const rate = parseFloat(config.energyRate);
    const machines = machineRows.map((m) => ({
      id: m.id,
      energyCost: Math.round(parseFloat(m.energy_kwh) * rate),
      costPerPart: m.production > 0 ? Math.round((parseFloat(m.energy_kwh) * rate / m.production) * 100) / 100 : 0,
      idleCost: Math.round(parseFloat(m.idle_hours) * 3.2 * rate),
    }));

    res.json({ ...config, machines });
  } catch (err) {
    console.error("GET /cost/breakdown error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/cost/by-machine
router.get("/by-machine", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mp.machine_id                                          AS id,
              ROUND(SUM(mp.energy_kwh_used)::numeric, 1)             AS energy_kwh,
              ROUND((SUM(mp.energy_kwh_used) * sc.tariff_per_kwh)::numeric, 0) AS total_cost,
              SUM(mp.parts_produced)                                 AS parts_produced,
              CASE WHEN SUM(mp.parts_produced) > 0
                   THEN ROUND((SUM(mp.energy_kwh_used) * sc.tariff_per_kwh / SUM(mp.parts_produced))::numeric, 2)
                   ELSE 0 END                                        AS cost_per_part,
              ROUND(SUM(mp.idle_hours)::numeric, 2)                  AS idle_hours
       FROM machine_parts_produced mp
       CROSS JOIN (
         SELECT COALESCE(
           (SELECT tariff_per_kwh FROM system_config ORDER BY created_at DESC LIMIT 1),
           8.5
         ) AS tariff_per_kwh
       ) sc
       WHERE mp.recorded_at::date = CURRENT_DATE
       GROUP BY mp.machine_id, sc.tariff_per_kwh
       ORDER BY mp.machine_id`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /cost/by-machine error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
