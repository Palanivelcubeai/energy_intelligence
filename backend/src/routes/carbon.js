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

    // Run today and month queries in parallel
    const [todayResult, monthResult] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(energy_kwh_used), 0) AS total_kwh,
                COALESCE(SUM(parts_produced), 0)  AS total_parts
         FROM machine_parts_produced
         WHERE recorded_at::date = CURRENT_DATE`
      ),
      pool.query(
        `SELECT COALESCE(SUM(energy_kwh_used), 0) AS total_kwh_month
         FROM machine_parts_produced
         WHERE recorded_at::date >= DATE_TRUNC('month', CURRENT_DATE)`
      ),
    ]);
    const totalKwh      = parseFloat(todayResult.rows[0].total_kwh);
    const totalParts    = parseInt(todayResult.rows[0].total_parts, 10);
    const totalKwhMonth = parseFloat(monthResult.rows[0].total_kwh_month);

    // Calculate actual carbon footprint using the grid emission factor and subtracting renewables
    const effectiveEmissionFactor = ef * (1 - (rp / 100)); // kg CO2 / kWh actually emitted
    
    const totalCO2Today = Math.round(totalKwh * effectiveEmissionFactor * 100) / 100;
    const totalCO2Month = Math.round((totalKwhMonth * effectiveEmissionFactor) / 1000 * 100) / 100; // in tons
    const carbonIntensity = totalParts > 0 ? Math.round((totalCO2Today / totalParts) * 1000) / 1000 : 0;
    
    // Carbon saved is the portion avoided by using renewable energy instead of the grid
    const carbonSaved = Math.round(totalKwh * (rp / 100) * ef * 100) / 100;
    
    // Calculate sustainability score purely based on the grid emission rate and renewables, without mock data
    // A standard grid might have 1.0 kg/kWh. The lower our effective rate, the higher the score (max 100).
    const sustainabilityScore = Math.min(100, Math.max(0, Math.round((1 - (effectiveEmissionFactor / 1.2)) * 100)));

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
      "SELECT grid_emission_factor, renewable_percent FROM system_config LIMIT 1"
    );
    const ef = parseFloat(configRows[0]?.grid_emission_factor || 0.82);
    const rp = parseFloat(configRows[0]?.renewable_percent || 0);
    const effectiveEmissionFactor = ef * (1 - (rp / 100));

    const params = [];
    let where;
    if (from && to) {
      where = "recorded_at::date BETWEEN $1::date AND $2::date";
      params.push(from, to);
    } else {
      where = "recorded_at::date >= CURRENT_DATE - INTERVAL '30 days'";
    }
    const { rows } = await pool.query(
      `SELECT recorded_at::date                                       AS raw_date,
              TO_CHAR(recorded_at::date, 'Mon DD')                    AS record_date,
              ROUND(SUM(energy_kwh_used)::numeric, 1)                 AS kwh,
              SUM(parts_produced)                                     AS parts
       FROM machine_parts_produced
       WHERE ${where}
       GROUP BY recorded_at::date
       ORDER BY raw_date`,
      params
    );

    res.json(rows.map((r) => {
      const kwh   = parseFloat(r.kwh);
      const co2   = Math.round(kwh * effectiveEmissionFactor * 10) / 10;
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
      "SELECT grid_emission_factor, renewable_percent FROM system_config LIMIT 1"
    );
    const ef = parseFloat(configRows[0]?.grid_emission_factor || 0.82);
    const rp = parseFloat(configRows[0]?.renewable_percent || 0);
    const effectiveEmissionFactor = ef * (1 - (rp / 100));

    const { rows } = await pool.query(
      `SELECT machine_id                                            AS name,
              ROUND(SUM(energy_kwh_used)::numeric, 1)               AS kwh,
              ROUND((SUM(energy_kwh_used) * $1)::numeric, 2)        AS co2
       FROM machine_parts_produced
       WHERE recorded_at::date = CURRENT_DATE
       GROUP BY machine_id
       ORDER BY machine_id`,
      [effectiveEmissionFactor]
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
      "SELECT grid_emission_factor, renewable_percent, tariff_per_kwh FROM system_config LIMIT 1"
    );
    const ef   = parseFloat(configRows[0]?.grid_emission_factor || 0.82);
    const rp   = parseFloat(configRows[0]?.renewable_percent || 0);
    const rate = parseFloat(configRows[0]?.tariff_per_kwh || 8.5);
    const effectiveEmissionFactor = ef * (1 - (rp / 100));

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
      const co2    = Math.round(kwh * effectiveEmissionFactor * 100) / 100;
      const cost   = Math.round(kwh * rate);
      let severity, message, recommendation;

      if (eff < 70) {
        severity = 'warning';
        message  = `${r.machine_id} avg efficiency is ${eff}% today — below 70% threshold`;
        recommendation = 'Schedule preventive maintenance and inspect tooling';
      } else if (eff < 85) {
        severity = 'info';
        message  = `${r.machine_id} efficiency at ${eff}% — moderate optimization possible`;
        recommendation = 'Review cutting parameters and operator settings';
      } else {
        severity = 'success';
        message  = `${r.machine_id} operating efficiently at ${eff}%`;
        recommendation = 'Maintain current operating parameters';
      }

      return {
        severity, message, recommendation,
        carbonReduction: `${co2} kg CO₂ emitted today`,
        financialImpact: `₹${cost.toLocaleString()} energy cost today`,
      };
    });

    res.json(insights);
  } catch (err) {
    console.error("GET /carbon/insights error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/carbon/by-machine-interval
router.get("/by-machine-interval", async (req, res) => {
  try {
    const { rows: configRows } = await pool.query(
      "SELECT grid_emission_factor, renewable_percent FROM system_config LIMIT 1"
    );
    const ef = parseFloat(configRows[0]?.grid_emission_factor || 0.82);
    const rp = parseFloat(configRows[0]?.renewable_percent || 0);
    const effectiveEmissionFactor = ef * (1 - (rp / 100));

    const { rows } = await pool.query(
      `SELECT 
        TO_CHAR(DATE_TRUNC('hour', recorded_at) + INTERVAL '15 min' * FLOOR(EXTRACT(minute FROM recorded_at) / 15), 'HH24:MI') as time_val, 
        machine_id, 
        ROUND((AVG(kw) * 0.25)::numeric, 4) as kwh, 
        ROUND((AVG(kw) * 0.25 * $1)::numeric, 4) as co2 
       FROM machine_metrics 
       WHERE recorded_at >= CURRENT_DATE AND recorded_at < CURRENT_DATE + INTERVAL '1 day'
       GROUP BY time_val, machine_id 
       ORDER BY time_val ASC`,
      [effectiveEmissionFactor]
    );

    // Pivot the data to generate a unified timeseries array with machines as keys
    const timeMap = {};
    rows.forEach(r => {
      if (!timeMap[r.time_val]) {
        timeMap[r.time_val] = { time: r.time_val };
      }
      timeMap[r.time_val][r.machine_id + "_co2"] = parseFloat(r.co2);
      timeMap[r.time_val][r.machine_id + "_kwh"] = parseFloat(r.kwh);
    });

    res.json(Object.values(timeMap));
  } catch (err) {
    console.error("GET /carbon/by-machine-interval error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
