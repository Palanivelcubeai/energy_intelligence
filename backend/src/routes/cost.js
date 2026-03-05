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
              COALESCE(e.energy_kwh, 0) AS energy_kwh,
              COALESCE(e.production, 0) AS production,
              COALESCE(e.idle_hours, 0) AS idle_hours
       FROM machines m
       LEFT JOIN energy_output_daily e ON e.machine_id = m.id AND e.record_date = CURRENT_DATE
       ORDER BY m.id`
    );

    const rate = parseFloat(config.energyRate);
    const machines = machineRows.map((m) => ({
      id: m.id,
      energyCost: Math.round(parseFloat(m.energy_kwh) * rate),
      costPerPart: m.production > 0 ? Math.round((parseFloat(m.energy_kwh) * rate / m.production) * 100) / 100 : 0,
      idleCost: Math.round(parseFloat(m.idle_hours) * (m.status !== "maintenance" ? 3.2 : 0) * rate),
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
    const { rows } = await pool.query("SELECT * FROM v_machine_cost");
    res.json(rows);
  } catch (err) {
    console.error("GET /cost/by-machine error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
