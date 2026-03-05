const router = require("express").Router();
const pool = require("../db");

// Helper: generate insights from machine_metrics data
async function generateInsights(limit) {
  const insights = [];

  // Check for low-efficiency machines (today)
  const { rows: lowEff } = await pool.query(
    `SELECT m.id AS machine_id, m.name, ROUND(AVG(mm.efficiency_score)) AS avg_eff
     FROM machine_metrics mm JOIN machines m ON mm.machine_id = m.id
     WHERE mm.recorded_at::date = CURRENT_DATE
     GROUP BY m.id, m.name HAVING AVG(mm.efficiency_score) < 70
     ORDER BY AVG(mm.efficiency_score)`
  );
  lowEff.forEach((r) =>
    insights.push({
      id: `eff-${r.machine_id}`,
      severity: "high",
      message: `${r.name} avg efficiency is ${r.avg_eff}% today — below 70% threshold`,
      financial_impact: "Potential energy waste from inefficient operation",
      production_impact: "Reduced output and higher per-part cost",
      confidence: 85,
      suggested_action: `Inspect ${r.name} for mechanical issues or recalibrate`,
      machine: r.machine_id,
    })
  );

  // Check for high rejection rate
  const { rows: highRej } = await pool.query(
    `SELECT m.id AS machine_id, m.name, SUM(mm.rejection_count) AS total_rej, SUM(mm.parts_produced) AS total_parts
     FROM machine_metrics mm JOIN machines m ON mm.machine_id = m.id
     WHERE mm.recorded_at::date = CURRENT_DATE AND mm.parts_produced > 0
     GROUP BY m.id, m.name
     HAVING SUM(mm.rejection_count)::float / NULLIF(SUM(mm.parts_produced), 0) > 0.05`
  );
  highRej.forEach((r) => {
    const rejRate = ((r.total_rej / r.total_parts) * 100).toFixed(1);
    insights.push({
      id: `rej-${r.machine_id}`,
      severity: "medium",
      message: `${r.name} rejection rate is ${rejRate}% today`,
      financial_impact: "Wasted material and energy on rejected parts",
      production_impact: "Lower effective output",
      confidence: 80,
      suggested_action: `Check tooling condition and material quality on ${r.name}`,
      machine: r.machine_id,
    });
  });

  // Check for high energy usage machines
  const { rows: highEnergy } = await pool.query(
    `SELECT m.id AS machine_id, m.name, ROUND(SUM(mm.kwh)::numeric, 1) AS total_kwh
     FROM machine_metrics mm JOIN machines m ON mm.machine_id = m.id
     WHERE mm.recorded_at::date = CURRENT_DATE
     GROUP BY m.id, m.name
     ORDER BY SUM(mm.kwh) DESC LIMIT 1`
  );
  if (highEnergy.length > 0) {
    const r = highEnergy[0];
    insights.push({
      id: `energy-${r.machine_id}`,
      severity: "info",
      message: `${r.name} is the highest energy consumer today at ${r.total_kwh} kWh`,
      financial_impact: "Largest share of energy cost",
      production_impact: "Normal — monitor for upward trend",
      confidence: 90,
      suggested_action: "Review load profile and consider off-peak scheduling",
      machine: r.machine_id,
    });
  }

  // Check for low power factor
  const { rows: lowPF } = await pool.query(
    `SELECT m.id AS machine_id, m.name, ROUND(AVG(mm.power_factor)::numeric, 2) AS avg_pf
     FROM machine_metrics mm JOIN machines m ON mm.machine_id = m.id
     WHERE mm.recorded_at::date = CURRENT_DATE
     GROUP BY m.id, m.name HAVING AVG(mm.power_factor) < 0.85`
  );
  lowPF.forEach((r) =>
    insights.push({
      id: `pf-${r.machine_id}`,
      severity: "medium",
      message: `${r.name} avg power factor is ${r.avg_pf} — below 0.85`,
      financial_impact: "May incur utility power factor penalties",
      production_impact: "Increased apparent power demand",
      confidence: 88,
      suggested_action: "Consider capacitor bank or PFC correction",
      machine: r.machine_id,
    })
  );

  return limit ? insights.slice(0, limit) : insights;
}

// GET /api/insights/all
router.get("/all", async (_req, res) => {
  try {
    const insights = await generateInsights();
    res.json(insights);
  } catch (err) {
    console.error("GET /insights/all error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/insights/top — top 4 most recent
router.get("/top", async (_req, res) => {
  try {
    const insights = await generateInsights(4);
    res.json(insights);
  } catch (err) {
    console.error("GET /insights/top error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
