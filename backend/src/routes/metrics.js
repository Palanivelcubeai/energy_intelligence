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

    // Authoritative today's parts per machine from incremental table
    const { rows: todayParts } = await pool.query(
      `SELECT machine_id, SUM(parts_produced) AS parts, SUM(parts_rejected) AS rejected
       FROM machine_parts_produced
       WHERE record_date = CURRENT_DATE
       GROUP BY machine_id`
    );
    const todayPartsMap = {};
    todayParts.forEach(r => { todayPartsMap[r.machine_id] = parseInt(r.parts) || 0; });

    const totalEnergy = machines.reduce((s, m) => s + (parseFloat(m.kWh) || 0), 0);
    const totalParts = Object.values(todayPartsMap).reduce((s, v) => s + v, 0) ||
      machines.reduce((s, m) => s + (m.parts_produced || 0), 0);
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
         m.id, m.name, m.status, m.product_type, m.production_target,
         mm.kw AS "kW", mm.kwh AS "kWh", mm.power_factor AS pf,
         mm.voltage_r, mm.voltage_y, mm.voltage_b,
         mm.current_r, mm.current_y, mm.current_b,
         mm.runtime_hours, mm.idle_hours,
         mm.parts_produced, mm.energy_per_part, mm.rejection_count, mm.efficiency_score
       FROM machines m
       LEFT JOIN machine_metrics mm ON mm.machine_id = m.id
       ORDER BY m.id, mm.recorded_at DESC`
    );

    // Today's authoritative per-machine totals from the incremental shift table
    const { rows: todayRows } = await pool.query(
      `SELECT machine_id,
              SUM(parts_produced) AS parts,
              SUM(parts_rejected) AS rejected
       FROM machine_parts_produced
       WHERE record_date = CURRENT_DATE
       GROUP BY machine_id`
    );
    const todayMap = {};
    todayRows.forEach(r => {
      todayMap[r.machine_id] = { parts: parseInt(r.parts) || 0, rejected: parseInt(r.rejected) || 0 };
    });

    // Shape into frontend's MachineData format
    const shaped = rows.map((r) => {
      const today = todayMap[r.id] || {};
      return {
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
        // Use today's sum from machine_parts_produced; fall back to machine_metrics if no row yet
        parts_produced: today.parts ?? (r.parts_produced || 0),
        energy_per_part: parseFloat(r.energy_per_part) || 0,
        product_type: r.product_type || "",
        rejection_count: today.rejected ?? (r.rejection_count || 0),
        efficiency_score: r.efficiency_score || 0,
        production_target: r.production_target || 0,
      };
    });
    res.json(shaped);
  } catch (err) {
    console.error("GET /metrics/realtime error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/metrics/kpis — max demand, monthly production, plant efficiency
router.get("/kpis", async (_req, res) => {
  try {
    // Max Demand (kVA) = max of sum of kW/PF across all machines at the same recorded_at
    const { rows: demandRows } = await pool.query(
      `SELECT ROUND(MAX(total_kva)::numeric, 1) AS max_demand
       FROM (
         SELECT recorded_at, SUM(kw / NULLIF(power_factor, 0)) AS total_kva
         FROM machine_metrics
         WHERE recorded_at >= date_trunc('day', NOW())
         GROUP BY recorded_at
       ) t`
    );

    // Monthly production — sum incremental parts from machine_parts_produced
    const { rows: monthlyRows } = await pool.query(
      `SELECT SUM(parts_produced) AS monthly_production
       FROM machine_parts_produced
       WHERE record_date >= DATE_TRUNC('month', CURRENT_DATE)`
    );

    // Plant efficiency — average of latest efficiency_score per machine
    const { rows: effRows } = await pool.query(
      `SELECT ROUND(AVG(efficiency_score)) AS avg_efficiency
       FROM (
         SELECT DISTINCT ON (machine_id) efficiency_score
         FROM machine_metrics
         ORDER BY machine_id, recorded_at DESC
       ) t`
    );

    res.json({
      maxDemand: parseFloat(demandRows[0]?.max_demand) || 0,
      monthlyProduction: parseInt(monthlyRows[0]?.monthly_production) || 0,
      avgEfficiency: parseInt(effRows[0]?.avg_efficiency) || 0,
    });
  } catch (err) {
    console.error("GET /metrics/kpis error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/metrics/load-curve — 24h plant-level load (aggregated from machine_metrics)
router.get("/load-curve", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      // Step 1: sum kW across all machines per tick → plant load at that instant
      // Step 2: average those plant-load snapshots per hour → representative hourly load
      `SELECT TO_CHAR(recorded_at, 'HH24:00') AS time,
              ROUND(AVG(plant_kw)::numeric, 1) AS value
       FROM (
         SELECT recorded_at, SUM(kw) AS plant_kw
         FROM machine_metrics
         WHERE recorded_at >= date_trunc('day', NOW())
         GROUP BY recorded_at
       ) t
       GROUP BY TO_CHAR(recorded_at, 'HH24:00'), date_trunc('hour', recorded_at)
       ORDER BY date_trunc('hour', recorded_at)`
    );
    res.json(rows.map(r => ({ time: r.time, value: parseFloat(r.value) || 0 })));
  } catch (err) {
    console.error("GET /metrics/load-curve error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/metrics/production-trend?machine_id=CNC-1 — hourly incremental production vs energy
router.get("/production-trend", async (req, res) => {
  try {
    const { machine_id } = req.query;
    const params = [];
    const machineFilter = machine_id ? `AND machine_id = $1` : '';
    if (machine_id) params.push(machine_id);

    const { rows } = await pool.query(
      // machine_metrics stores CUMULATIVE parts/kwh per machine per day.
      // To get incremental per hour, compute MAX per machine per IST-hour bucket,
      // then take the delta vs the previous bucket with LAG().
      `WITH per_machine_hour AS (
         SELECT
           machine_id,
           DATE_TRUNC('hour', recorded_at AT TIME ZONE 'Asia/Kolkata') AS bucket_ist,
           MAX(parts_produced)                                          AS max_parts,
           MAX(kwh)                                                     AS max_kwh
         FROM machine_metrics
         WHERE recorded_at >= (
           DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata')
             AT TIME ZONE 'Asia/Kolkata'
         ) ${machineFilter}
         GROUP BY machine_id, DATE_TRUNC('hour', recorded_at AT TIME ZONE 'Asia/Kolkata')
       ),
       with_delta AS (
         SELECT
           bucket_ist,
           GREATEST(0,
             max_parts - LAG(max_parts, 1, 0) OVER (PARTITION BY machine_id ORDER BY bucket_ist)
           ) AS hour_parts,
           GREATEST(0,
             max_kwh - LAG(max_kwh, 1, 0.0) OVER (PARTITION BY machine_id ORDER BY bucket_ist)
           ) AS hour_kwh
         FROM per_machine_hour
       )
       SELECT
         TO_CHAR(bucket_ist, 'HH24:00') AS time,
         SUM(hour_parts)                AS production,
         ROUND(SUM(hour_kwh)::numeric, 2) AS energy
       FROM with_delta
       GROUP BY bucket_ist
       ORDER BY bucket_ist`,
      params
    );
    res.json(rows.map(r => ({ time: r.time, production: parseInt(r.production) || 0, energy: parseFloat(r.energy) || 0 })));
  } catch (err) {
    console.error("GET /metrics/production-trend error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
