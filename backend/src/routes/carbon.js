const router = require("express").Router();
const pool = require("../db");

// GET /api/carbon/metrics
router.get("/metrics", async (_req, res) => {
  try {
    const { rows: configRows } = await pool.query(
      "SELECT grid_emission_factor, renewable_percent FROM system_config LIMIT 1"
    );
    const cfg = configRows[0] || { grid_emission_factor: 0.82, renewable_percent: 22 };
    const ef = parseFloat(cfg.grid_emission_factor);
    const rp = cfg.renewable_percent;

    const { rows: todayRows } = await pool.query(
      `SELECT COALESCE(SUM(energy_kwh), 0) AS total_kwh, COALESCE(SUM(production), 0) AS total_parts
       FROM energy_output_daily WHERE record_date = CURRENT_DATE`
    );
    const totalKwh = parseFloat(todayRows[0].total_kwh);
    const totalParts = parseInt(todayRows[0].total_parts, 10);

    const totalCO2Today = Math.round(totalKwh * ef * 100) / 100;
    const totalCO2Month = Math.round((totalCO2Today * 26) / 1000 * 100) / 100;
    const carbonIntensity = totalParts > 0 ? Math.round((totalCO2Today / totalParts) * 1000) / 1000 : 0;
    const carbonSaved = Math.round(totalKwh * (rp / 100) * ef * 100) / 100;
    const sustainabilityScore = Math.min(100, Math.max(0, Math.round(
      40 + rp * 1.2 + (100 - carbonIntensity * 80) + (totalCO2Today > 0 ? (carbonSaved / totalCO2Today) * 20 : 0)
    )));

    res.json({ totalCO2Today, totalCO2Month, carbonIntensity, renewablePercent: rp, carbonSaved, sustainabilityScore });
  } catch (err) {
    console.error("GET /carbon/metrics error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/carbon/trend?from=DATE&to=DATE
router.get("/trend", async (req, res) => {
  try {
    const { from, to } = req.query;
    const { rows: configRows } = await pool.query(
      "SELECT grid_emission_factor FROM system_config LIMIT 1"
    );
    const ef = parseFloat(configRows[0]?.grid_emission_factor || 0.82);

    let query = `SELECT record_date, SUM(energy_kwh) AS kwh, SUM(production) AS parts
                 FROM energy_output_daily`;
    const params = [];
    if (from && to) {
      query += " WHERE record_date BETWEEN $1 AND $2";
      params.push(from, to);
    } else {
      query += " WHERE record_date >= CURRENT_DATE - INTERVAL '30 days'";
    }
    query += " GROUP BY record_date ORDER BY record_date";
    const { rows } = await pool.query(query, params);

    const trend = rows.map((r) => {
      const kwh = parseFloat(r.kwh);
      const co2 = Math.round(kwh * ef * 10) / 10;
      const parts = parseInt(r.parts, 10);
      return {
        date: r.record_date,
        co2,
        kwh: Math.round(kwh * 10) / 10,
        intensity: parts > 0 ? Math.round((co2 / parts) * 1000) / 1000 : 0,
        parts,
      };
    });
    res.json(trend);
  } catch (err) {
    console.error("GET /carbon/trend error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/carbon/by-machine
router.get("/by-machine", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id AS name, energy_kwh AS kwh, co2_kg AS co2 FROM v_carbon_by_machine`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /carbon/by-machine error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/carbon/insights
router.get("/insights", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT severity, message, carbon_reduction AS "carbonReduction",
              financial_impact AS "financialImpact", recommendation
       FROM carbon_insights ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /carbon/insights error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
