const router = require("express").Router();
const pool = require("../db");

// GET /api/power-quality/by-machine
router.get("/by-machine", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (pq.machine_id)
         pq.machine_id AS id,
         pq.voltage_r, pq.voltage_y, pq.voltage_b,
         pq.current_r, pq.current_y, pq.current_b,
         pq.power_factor AS pf, pq.frequency_hz AS frequency,
         pq.thd_percent AS thd, pq.voltage_imbalance_pct AS "voltageImbalance",
         pq.health_score AS "healthScore"
       FROM power_quality pq
       ORDER BY pq.machine_id, pq.recorded_at DESC`
    );
    const shaped = rows.map((r) => ({
      id: r.id,
      voltage: { r: r.voltage_r || 0, y: r.voltage_y || 0, b: r.voltage_b || 0 },
      current: { r: parseFloat(r.current_r) || 0, y: parseFloat(r.current_y) || 0, b: parseFloat(r.current_b) || 0 },
      pf: parseFloat(r.pf) || 0,
      frequency: parseFloat(r.frequency) || 50,
      thd: parseFloat(r.thd) || 0,
      voltageImbalance: parseFloat(r.voltageImbalance) || 0,
      healthScore: r.healthScore || 0,
    }));
    res.json(shaped);
  } catch (err) {
    console.error("GET /power-quality/by-machine error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/power-quality/summary
router.get("/summary", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ROUND(AVG(power_factor), 2) AS avg_pf,
              ROUND(AVG(thd_percent), 2) AS avg_thd,
              ROUND(AVG(health_score)) AS avg_health,
              ROUND(AVG(voltage_imbalance_pct), 2) AS avg_imbalance
       FROM power_quality
       WHERE recorded_at >= NOW() - INTERVAL '1 day'`
    );
    res.json(rows[0] || {});
  } catch (err) {
    console.error("GET /power-quality/summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
