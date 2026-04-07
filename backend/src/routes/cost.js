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

    // Get per-machine costs with actual rated power for idle calculation
    const { rows: machineRows } = await pool.query(
      `SELECT m.id, m.name, m.status, m.rated_power_kw,
              COALESCE(SUM(mp.energy_kwh_used), 0) AS energy_kwh,
              COALESCE(SUM(mp.parts_produced), 0)  AS production,
              COALESCE(SUM(mp.idle_hours), 0)       AS idle_hours
       FROM machines m
       LEFT JOIN machine_parts_produced mp
              ON mp.machine_id = m.id AND mp.recorded_at::date = CURRENT_DATE
       GROUP BY m.id, m.name, m.status, m.rated_power_kw
       ORDER BY m.id`
    );

    // Calculate actual monthly cost and actual monthly idle cost from this month's data
    const { rows: monthlyRows } = await pool.query(
      `SELECT 
         COALESCE(SUM(mp.energy_kwh_used), 0) AS monthly_kwh,
         COALESCE(SUM(mp.idle_hours * (m.rated_power_kw * 0.2)), 0) AS monthly_idle_kwh
       FROM machine_parts_produced mp
       JOIN machines m ON m.id = mp.machine_id
       WHERE mp.recorded_at::date >= DATE_TRUNC('month', CURRENT_DATE)`
    );
    const monthlyKwh = parseFloat(monthlyRows[0].monthly_kwh) || 0;
    const monthlyIdleKwh = parseFloat(monthlyRows[0].monthly_idle_kwh) || 0;
    const actualMonthlyCost = Math.round(monthlyKwh * parseFloat(config.energyRate) * 100) / 100;
    const actualMonthlyIdleCost = Math.round(monthlyIdleKwh * parseFloat(config.energyRate) * 100) / 100;

    // Calculate actual peak demand (max kVA) for today
    const { rows: demandRows } = await pool.query(
      `SELECT ROUND(MAX(total_kva)::numeric, 1) AS peak_demand_kva
       FROM (
         SELECT recorded_at, SUM(kw / NULLIF(power_factor, 0)) AS total_kva
         FROM machine_metrics
         WHERE recorded_at >= DATE_TRUNC('day', NOW())
         GROUP BY recorded_at
       ) t`
    );
    const peakDemandKVA = parseFloat(demandRows[0]?.peak_demand_kva) || 0;

    // Billing peak demand is month-to-date max demand (closer to utility billing practice)
    const { rows: billingDemandRows } = await pool.query(
      `SELECT ROUND(MAX(total_kva)::numeric, 1) AS billing_peak_kva
       FROM (
         SELECT recorded_at, SUM(kw / NULLIF(power_factor, 0)) AS total_kva
         FROM machine_metrics
         WHERE recorded_at >= DATE_TRUNC('month', NOW())
         GROUP BY recorded_at
       ) t`
    );
    const billingPeakDemandKVA = parseFloat(billingDemandRows[0]?.billing_peak_kva) || 0;
    
    // Calculate demand charge based on actual peak vs contract
    // If peak exceeds contract, charge penalty on excess
    const contractKVA = parseFloat(config.contractDemand);
    const penaltyRate = parseFloat(config.demandCharge);
    const excessKVA = Math.max(0, peakDemandKVA - contractKVA);
    const actualDemandCharge = Math.round(excessKVA * penaltyRate * 100) / 100;
    const billingExcessKVA = Math.max(0, billingPeakDemandKVA - contractKVA);
    const billingDemandCharge = Math.round(billingExcessKVA * penaltyRate * 100) / 100;

    const rate = parseFloat(config.energyRate);
    const machines = machineRows.map((m) => {
      // Use machine-specific rated power for idle cost (assume 20% of rated power when idle)
      const idlePowerKW = parseFloat(m.rated_power_kw) * 0.2;
      return {
        id: m.id,
        energyCost: Math.round(parseFloat(m.energy_kwh) * rate * 100) / 100,
        costPerPart: m.production > 0 ? Math.round((parseFloat(m.energy_kwh) * rate / m.production) * 100) / 100 : 0,
        idleCost: Math.round(parseFloat(m.idle_hours) * idlePowerKW * rate * 100) / 100,
      };
    });

    res.json({ 
      ...config, 
      machines,
      actualMonthlyCost,
      actualMonthlyIdleCost,
      peakDemandKVA,
      actualDemandCharge,
      billingPeakDemandKVA,
      billingDemandCharge,
    });
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
