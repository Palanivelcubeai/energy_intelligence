const router = require("express").Router();
const pool = require("../db");

// GET /api/config
router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM system_config LIMIT 1");
    if (rows.length === 0) return res.json({});
    const c = rows[0];
    res.json({
      plantName: c.plant_name,
      location: c.location,
      industryType: c.industry_type,
      machineCount: c.machine_count,
      tariffPerKwh: parseFloat(c.tariff_per_kwh),
      contractDemand: parseFloat(c.contract_demand_kva),
      gridEmissionFactor: parseFloat(c.grid_emission_factor),
      demandPenaltyRate: parseFloat(c.demand_penalty_rate),
      renewablePercent: c.renewable_percent,
      pfMinimum: parseFloat(c.pf_minimum),
      thdMaximum: parseFloat(c.thd_maximum),
      idleTimeThreshold: parseFloat(c.idle_time_threshold_hrs),
      heatThreshold: parseFloat(c.heat_threshold_c),
      demandWarningPercent: c.demand_warning_percent,
      energyPerPartDeviation: c.energy_per_part_deviation,
    });
  } catch (err) {
    console.error("GET /config error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/config
router.put("/", async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await pool.query(
      `UPDATE system_config SET
         plant_name = COALESCE($1, plant_name),
         location = COALESCE($2, location),
         industry_type = COALESCE($3, industry_type),
         machine_count = COALESCE($4, machine_count),
         tariff_per_kwh = COALESCE($5, tariff_per_kwh),
         contract_demand_kva = COALESCE($6, contract_demand_kva),
         grid_emission_factor = COALESCE($7, grid_emission_factor),
         demand_penalty_rate = COALESCE($8, demand_penalty_rate),
         renewable_percent = COALESCE($9, renewable_percent),
         pf_minimum = COALESCE($10, pf_minimum),
         thd_maximum = COALESCE($11, thd_maximum),
         idle_time_threshold_hrs = COALESCE($12, idle_time_threshold_hrs),
         heat_threshold_c = COALESCE($13, heat_threshold_c),
         demand_warning_percent = COALESCE($14, demand_warning_percent),
         energy_per_part_deviation = COALESCE($15, energy_per_part_deviation),
         updated_at = NOW()
       RETURNING *`,
      [
        b.plantName, b.location, b.industryType, b.machineCount,
        b.tariffPerKwh, b.contractDemand, b.gridEmissionFactor, b.demandPenaltyRate,
        b.renewablePercent, b.pfMinimum, b.thdMaximum, b.idleTimeThreshold,
        b.heatThreshold, b.demandWarningPercent, b.energyPerPartDeviation,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /config error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
