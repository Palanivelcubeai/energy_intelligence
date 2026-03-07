const router = require("express").Router();
const pool = require("../db");

// GET /api/metrics/summary — overview KPIs
router.get("/summary", async (_req, res) => {
  try {
    // Get latest metrics per machine
    const { rows: machines } = await pool.query(
      `SELECT DISTINCT ON (m.id)
         m.id, m.name, m.status, m.product_type,
         mm.kw AS "kW", mm.kwh AS "kWh", mm.power_factor AS pf,
         mm.voltage_r, mm.voltage_y, mm.voltage_b,
         mm.current_r, mm.current_y, mm.current_b,
         mm.runtime_hours, mm.idle_hours,
         mm.parts_produced, mm.energy_per_part, mm.rejection_count, mm.efficiency_score
       FROM machines m
       LEFT JOIN machine_metrics mm ON mm.machine_id = m.id
       ORDER BY m.id, mm.recorded_at DESC`
    );

    const totalEnergy = machines.reduce((s, m) => s + (parseFloat(m.kWh) || 0), 0);
    const totalParts = machines.reduce((s, m) => s + (m.parts_produced || 0), 0);
    const totalPower = machines.reduce((s, m) => s + (parseFloat(m.kW) || 0), 0);
    const avgEfficiency = machines.length
      ? Math.round(machines.reduce((s, m) => s + (m.efficiency_score || 0), 0) / machines.length)
      : 0;

    res.json({
      totalEnergy: Math.round(totalEnergy * 10) / 10,
      totalParts,
      totalPower: Math.round(totalPower * 10) / 10,
      avgEfficiency,
      machineCount: machines.length,
      machines,
    });
  } catch (err) {
    console.error("GET /metrics/summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/metrics/realtime — all machines current state
router.get("/realtime", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (m.id)
         m.id, m.name, m.status, m.product_type,
         mm.kw AS "kW", mm.kwh AS "kWh", mm.power_factor AS pf,
         mm.voltage_r, mm.voltage_y, mm.voltage_b,
         mm.current_r, mm.current_y, mm.current_b,
         mm.runtime_hours, mm.idle_hours,
         mm.parts_produced, mm.energy_per_part, mm.rejection_count, mm.efficiency_score
       FROM machines m
       LEFT JOIN machine_metrics mm ON mm.machine_id = m.id
       ORDER BY m.id, mm.recorded_at DESC`
    );
    // Shape into frontend's MachineData format
    const shaped = rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      kW: parseFloat(r.kW) || 0,
      kWh: parseFloat(r.kWh) || 0,
      pf: parseFloat(r.pf) || 0,
      voltage: { r: parseFloat(r.voltage_r) || 0, y: parseFloat(r.voltage_y) || 0, b: parseFloat(r.voltage_b) || 0 },
      current: { r: parseFloat(r.current_r) || 0, y: parseFloat(r.current_y) || 0, b: parseFloat(r.current_b) || 0 },
      runtime_hours: parseFloat(r.runtime_hours) || 0,
      idle_hours: parseFloat(r.idle_hours) || 0,
      parts_produced: r.parts_produced || 0,
      energy_per_part: parseFloat(r.energy_per_part) || 0,
      product_type: r.product_type || "",
      rejection_count: r.rejection_count || 0,
      efficiency_score: r.efficiency_score || 0,
    }));
    res.json(shaped);
  } catch (err) {
    console.error("GET /metrics/realtime error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/metrics/load-curve — 24h plant-level load (aggregated from machine_metrics)
router.get("/load-curve", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT TO_CHAR(recorded_at, 'HH24:00') AS time,
              SUM(kw) AS value
       FROM machine_metrics
       WHERE recorded_at >= date_trunc('day', NOW())
       GROUP BY TO_CHAR(recorded_at, 'HH24:00'), date_trunc('hour', recorded_at)
       ORDER BY date_trunc('hour', recorded_at)`
    );
    res.json(rows.map(r => ({ time: r.time, value: parseFloat(r.value) || 0 })));
  } catch (err) {
    console.error("GET /metrics/load-curve error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/metrics/production-trend — hourly production vs energy (aggregated from machine_metrics)
router.get("/production-trend", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT TO_CHAR(recorded_at, 'HH24:00') AS time,
              SUM(parts_produced) AS production,
              SUM(kwh) AS energy
       FROM machine_metrics
       WHERE recorded_at >= date_trunc('day', NOW())
       GROUP BY TO_CHAR(recorded_at, 'HH24:00'), date_trunc('hour', recorded_at)
       ORDER BY date_trunc('hour', recorded_at)`
    );
    res.json(rows.map(r => ({ time: r.time, production: parseInt(r.production) || 0, energy: parseFloat(r.energy) || 0 })));
  } catch (err) {
    console.error("GET /metrics/production-trend error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
