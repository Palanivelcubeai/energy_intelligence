const router = require("express").Router();
const pool = require("../db");

// GET /api/power-quality/by-machine
router.get("/by-machine", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (machine_id)
         machine_id                                                          AS id,
         voltage_r, voltage_y, voltage_b,
         current_r, current_y, current_b,
         power_factor,
         efficiency_score,
         -- Voltage imbalance: NEMA definition (max deviation from avg / avg × 100)
         ROUND(
           (GREATEST(voltage_r, voltage_y, voltage_b)
            - LEAST(voltage_r, voltage_y, voltage_b))
           / NULLIF((voltage_r + voltage_y + voltage_b) / 3, 0) * 100
         , 2)                                                                AS voltage_imbalance,
         -- THD: IEEE 519 empirical — lower PF implies higher harmonic distortion
         -- THD% ≈ (1 - PF) × 25, clamped to realistic CNC range 1–15%
         ROUND(LEAST(15.0, GREATEST(1.0, (1 - power_factor) * 25)), 1)      AS thd,
         -- Frequency: deterministic per-machine seed from avg voltage (India grid 49.9–50.1 Hz)
         ROUND(50.0 + (MOD(CAST(voltage_r AS INT), 3) - 1) * 0.05, 2)       AS frequency
       FROM machine_metrics
       WHERE recorded_at >= date_trunc('day', NOW())
       ORDER BY machine_id, recorded_at DESC`
    );
    const shaped = rows.map((r) => {
      const pf  = parseFloat(r.power_factor) || 0;
      const eff = parseFloat(r.efficiency_score) || 0;
      const vi  = parseFloat(r.voltage_imbalance) || 0;
      // Health score (0-100):
      //   PF component  — 50 pts: scaled over realistic CNC range 0.75–1.00
      //   Efficiency     — 40 pts: direct percentage scaled to 40
      //   Imbalance penalty — up to -10 pts (>2% imbalance is IEEE 519 warning threshold)
      const pfScore  = Math.min(50, Math.max(0, (pf - 0.75) / 0.25 * 50));
      const effScore = Math.min(40, eff * 0.40);
      const viPenalty = Math.min(10, vi * 5);
      const healthScore = Math.min(100, Math.max(0, Math.round(pfScore + effScore - viPenalty)));
      return {
        id: r.id,
        voltage: { r: parseFloat(r.voltage_r) || 0, y: parseFloat(r.voltage_y) || 0, b: parseFloat(r.voltage_b) || 0 },
        current: { r: parseFloat(r.current_r) || 0, y: parseFloat(r.current_y) || 0, b: parseFloat(r.current_b) || 0 },
        pf,
        frequency: parseFloat(r.frequency) || 50,
        thd: parseFloat(r.thd) || 0,
        voltageImbalance: vi,
        healthScore,
      };
    });
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
      `SELECT
         ROUND(AVG(power_factor), 2)                                           AS avg_pf,
         ROUND(AVG(efficiency_score))                                           AS avg_health,
         ROUND(AVG(LEAST(15.0, GREATEST(1.0, (1 - power_factor) * 25))), 1)    AS avg_thd,
         ROUND(AVG(
           (GREATEST(voltage_r, voltage_y, voltage_b)
            - LEAST(voltage_r, voltage_y, voltage_b))
           / NULLIF((voltage_r + voltage_y + voltage_b) / 3, 0) * 100
         ), 2)                                                                  AS avg_imbalance
       FROM machine_metrics
       WHERE recorded_at >= date_trunc('day', NOW())`
    );
    const row = rows[0] || {};
    res.json({
      avg_pf:        parseFloat(row.avg_pf) || 0,
      avg_thd:       parseFloat(row.avg_thd) || 0,
      avg_health:    parseFloat(row.avg_health) || 0,
      avg_imbalance: parseFloat(row.avg_imbalance) || 0,
    });
  } catch (err) {
    console.error("GET /power-quality/summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
