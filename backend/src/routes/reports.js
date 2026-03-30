const router = require("express").Router();
const pool = require("../db");

const DEFAULT_REPORTS = [
  {
    key: "daily_cnc_energy",
    name: "Daily CNC Energy Report",
    description: "Daily machine-level energy, runtime, idle and status summary",
    lastGenerated: null,
  },
  {
    key: "production",
    name: "Production Report",
    description: "Shift-wise production, rejection and efficiency details",
    lastGenerated: null,
  },
  {
    key: "energy_per_part",
    name: "Energy per Part Report",
    description: "Machine ranking by energy and cost per part",
    lastGenerated: null,
  },
  {
    key: "monthly_efficiency",
    name: "Monthly Efficiency Report",
    description: "Month-wise production energy efficiency and carbon intensity",
    lastGenerated: null,
  },
  {
    key: "peak_demand",
    name: "Peak Demand Report",
    description: "Peak demand usage, contract utilization and risk levels",
    lastGenerated: null,
  },
  {
    key: "cost_optimization",
    name: "Cost Optimization Report",
    description: "Machine-wise energy cost, idle cost and potential savings",
    lastGenerated: null,
  },
];

// GET /api/reports/list
router.get("/list", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT report_key AS key, report_name AS name, description,
              last_generated AS "lastGenerated"
       FROM reports ORDER BY created_at`
    );
    if (!rows || rows.length === 0) {
      return res.json(DEFAULT_REPORTS);
    }
    res.json(rows);
  } catch (err) {
    // If reports table does not exist in the current DB setup, serve default metadata.
    if (err && (err.code === "42P01" || err.code === "42703")) {
      return res.json(DEFAULT_REPORTS);
    }
    console.error("GET /reports/list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/:key/data
router.get("/:key/data", async (req, res) => {
  try {
    const key = req.params.key;

    // Update last_generated where reports metadata table exists.
    try {
      await pool.query(
        "UPDATE reports SET last_generated = NOW(), updated_at = NOW() WHERE report_key = $1",
        [key]
      );
    } catch (e) {
      if (!(e && e.code === "42P01")) {
        throw e;
      }
    }

    let data;
    switch (key) {
      case "daily_cnc_energy":
        data = await getDailyCNCEnergyReport();
        break;
      case "production":
        data = await getProductionReport();
        break;
      case "energy_per_part":
        data = await getEnergyPerPartReport();
        break;
      case "monthly_efficiency":
        data = await getMonthlyEfficiencyReport();
        break;
      case "peak_demand":
        data = await getPeakDemandReport();
        break;
      case "cost_optimization":
        data = await getCostOptimizationReport();
        break;
      default:
        return res.status(404).json({ error: "Report not found" });
    }
    res.json(data);
  } catch (err) {
    // In this project, report source tables vary across setup scripts.
    // Return empty report data instead of 500 when optional tables/columns are missing.
    if (err && (err.code === "42P01" || err.code === "42703")) {
      return res.json([]);
    }
    console.error(`GET /reports/${req.params.key}/data error:`, err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function getDailyCNCEnergyReport() {
  const { rows } = await pool.query(
    `SELECT e.record_date AS date, m.name AS machine, e.energy_kwh,
            e.runtime_hours AS runtime_hrs, e.idle_hours AS idle_hrs,
            e.energy_per_part, e.status
     FROM energy_output_daily e JOIN machines m ON m.id = e.machine_id
     WHERE e.record_date >= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY e.record_date DESC, m.id`
  );
  return rows;
}

async function getProductionReport() {
  const { rows } = await pool.query(
    `SELECT sp.record_date AS date, m.name AS machine, sp.shift,
            sp.parts_produced, sp.parts_rejected AS rejected_parts,
            sp.production_target, sp.efficiency_pct AS efficiency
     FROM shift_production sp JOIN machines m ON m.id = sp.machine_id
     WHERE sp.record_date >= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY sp.record_date DESC, sp.shift, m.id`
  );
  return rows;
}

async function getEnergyPerPartReport() {
  const { rows } = await pool.query(
    `SELECT m.name AS machine,
            ROUND(SUM(e.energy_kwh)::numeric, 1) AS total_energy,
            SUM(e.production) AS total_parts,
            CASE WHEN SUM(e.production) > 0
                 THEN ROUND((SUM(e.energy_kwh) / SUM(e.production))::numeric, 2) ELSE 0 END AS energy_per_part,
            CASE WHEN SUM(e.production) > 0
                 THEN ROUND((SUM(e.energy_kwh) / SUM(e.production) * sc.tariff_per_kwh)::numeric, 2) ELSE 0 END AS cost_per_part,
            ROW_NUMBER() OVER (ORDER BY CASE WHEN SUM(e.production) > 0
                 THEN SUM(e.energy_kwh) / SUM(e.production) ELSE 999 END) AS efficiency_rank
     FROM energy_output_daily e
     JOIN machines m ON m.id = e.machine_id
     CROSS JOIN system_config sc
     WHERE e.production > 0
     GROUP BY m.name, sc.tariff_per_kwh
     ORDER BY efficiency_rank`
  );
  return rows;
}

async function getMonthlyEfficiencyReport() {
  const { rows } = await pool.query(
    `SELECT mp.month, mp.total_energy_kwh AS total_energy,
            mp.total_production, mp.avg_energy_per_part,
            mp.efficiency_score, mp.carbon_intensity
     FROM monthly_production mp
     ORDER BY mp.year,
       CASE mp.month WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
       WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
       WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
       WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12 END`
  );
  return rows;
}

async function getPeakDemandReport() {
  const { rows } = await pool.query(
    `SELECT recorded_at::date AS date,
            TO_CHAR(recorded_at, 'HH24:MI') AS time_block,
            demand_kva, contract_demand_kva AS contract_demand,
            utilization_pct AS utilization, risk_level
     FROM demand_records
     WHERE recorded_at >= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY recorded_at DESC`
  );
  return rows;
}

async function getCostOptimizationReport() {
  const { rows } = await pool.query(
    `SELECT m.name AS machine,
            ROUND(COALESCE(e.energy_kwh, 0) * sc.tariff_per_kwh) AS energy_cost,
            ROUND(COALESCE(e.idle_hours, 0) * CASE WHEN m.status != 'maintenance' THEN 3.2 ELSE 0 END * sc.tariff_per_kwh) AS idle_cost,
            ROUND(COALESCE(e.idle_hours, 0) * CASE WHEN m.status != 'maintenance' THEN 3.2 ELSE 0 END * sc.tariff_per_kwh * 0.7
              + COALESCE(e.energy_kwh, 0) * sc.tariff_per_kwh * 0.08) AS potential_savings
     FROM machines m
     LEFT JOIN energy_output_daily e ON e.machine_id = m.id AND e.record_date = CURRENT_DATE
     CROSS JOIN system_config sc
     ORDER BY m.id`
  );
  return rows;
}

module.exports = router;
