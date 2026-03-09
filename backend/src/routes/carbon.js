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
    const rp = parseFloat(cfg.renewable_percent);

    const { rows: todayRows } = await pool.query(
      `SELECT COALESCE(SUM(energy_kwh_used), 0) AS total_kwh,
              COALESCE(SUM(parts_produced), 0)  AS total_parts
       FROM machine_parts_produced
       WHERE recorded_at::date = CURRENT_DATE`
    );
    const totalKwh   = parseFloat(todayRows[0].total_kwh);
    const totalParts = parseInt(todayRows[0].total_parts, 10);

    const totalCO2Today = Math.round(totalKwh * ef * 100) / 100;
    const totalCO2Month = Math.round((totalCO2Today * 26) / 1000 * 100) / 100;
    const carbonIntensity = totalParts > 0 ? Math.round((totalCO2Today / totalParts) * 1000) / 1000 : 0;
    const carbonSaved = Math.round(totalKwh * (rp / 100) * ef * 100) / 100;
    const sustainabilityScore = Math.min(100, Math.max(0, Math.round(
      40 + rp * 1.2 + (totalCO2Today > 0 ? (carbonSaved / totalCO2Today) * 20 : 0)
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

    const params = [];
    let where;
    if (from && to) {
      where = "recorded_at::date BETWEEN $1::date AND $2::date";
      params.push(from, to);
    } else {
      where = "recorded_at::date >= CURRENT_DATE - INTERVAL '30 days'";
    }
    const { rows } = await pool.query(
      `SELECT recorded_at::date          AS record_date,
              ROUND(SUM(energy_kwh_used)::numeric, 1) AS kwh,
              SUM(parts_produced)         AS parts
       FROM machine_parts_produced
       WHERE ${where}
       GROUP BY recorded_at::date
       ORDER BY record_date`,
      params
    );

    res.json(rows.map((r) => {
      const kwh  = parseFloat(r.kwh);
      const co2  = Math.round(kwh * ef * 10) / 10;
      const parts = parseInt(r.parts, 10);
      return { date: r.record_date, co2, kwh: Math.round(kwh * 10) / 10,
               intensity: parts > 0 ? Math.round((co2 / parts) * 1000) / 1000 : 0, parts };
    }));
  } catch (err) {
    console.error("GET /carbon/trend error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/carbon/by-machine
router.get("/by-machine", async (_req, res) => {
  try {
    const { rows: configRows } = await pool.query(
      "SELECT grid_emission_factor FROM system_config LIMIT 1"
    );
    const ef = parseFloat(configRows[0]?.grid_emission_factor || 0.82);
    const { rows } = await pool.query(
      `SELECT machine_id                                            AS name,
              ROUND(SUM(energy_kwh_used)::numeric, 1)               AS kwh,
              ROUND((SUM(energy_kwh_used) * $1)::numeric, 2)        AS co2
       FROM machine_parts_produced
       WHERE recorded_at::date = CURRENT_DATE
       GROUP BY machine_id
       ORDER BY machine_id`,
      [ef]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /carbon/by-machine error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/carbon/insights
// Derives actionable insights from today's production data
router.get("/insights", async (_req, res) => {
  try {
    const { rows: configRows } = await pool.query(
      "SELECT grid_emission_factor, tariff_per_kwh FROM system_config LIMIT 1"
    );
    const ef   = parseFloat(configRows[0]?.grid_emission_factor || 0.82);
    const rate = parseFloat(configRows[0]?.tariff_per_kwh || 8.5);

    const { rows } = await pool.query(
      `SELECT machine_id,
              ROUND(AVG(efficiency_score))                     AS avg_eff,
              ROUND(SUM(energy_kwh_used)::numeric, 1)          AS total_kwh,
              SUM(parts_produced)                              AS total_parts,
              SUM(parts_rejected)                              AS total_rejected
       FROM machine_parts_produced
       WHERE recorded_at::date = CURRENT_DATE
       GROUP BY machine_id
       ORDER BY avg_eff ASC`
    );

    const insights = rows.map((r) => {
      const eff    = parseInt(r.avg_eff, 10);
      const kwh    = parseFloat(r.total_kwh);
      const parts  = parseInt(r.total_parts, 10);
      const co2    = Math.round(kwh * ef * 100) / 100;
      const cost   = Math.round(kwh * rate);
      let severity, message, recommendation;

      if (eff < 70) {
        severity = 'high';
        message  = `${r.machine_id} avg efficiency is ${eff}% today — below 70% threshold`;
        recommendation = 'Schedule preventive maintenance and inspect tooling';
      } else if (eff < 85) {
        severity = 'medium';
        message  = `${r.machine_id} efficiency at ${eff}% — moderate optimization possible`;
        recommendation = 'Review cutting parameters and operator settings';
      } else {
        severity = 'low';
        message  = `${r.machine_id} operating efficiently at ${eff}%`;
        recommendation = 'Maintain current operating parameters';
      }

      return {
        severity, message, recommendation,
        carbonReduction: co2,
        financialImpact: cost,
      };
    });

    res.json(insights);
  } catch (err) {
    console.error("GET /carbon/insights error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
