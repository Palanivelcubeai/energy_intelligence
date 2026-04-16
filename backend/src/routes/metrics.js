const router = require("express").Router();
const pool = require("../db");

// GET /api/metrics/summary — overview KPIs
router.get("/summary", async (_req, res) => {
  try {
    // Get latest metrics per machine — restrict to last 24 h so planner can use the
    // (machine_id, recorded_at DESC) index efficiently instead of scanning the whole table
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
         AND mm.recorded_at >= NOW() - INTERVAL '24 hours'
       ORDER BY m.id, mm.recorded_at DESC`
    );

    // Authoritative today's parts per machine from incremental table
    const { rows: todayParts } = await pool.query(
      `SELECT machine_id, SUM(parts_produced) AS parts, SUM(parts_rejected) AS rejected
       FROM machine_parts_produced
       WHERE recorded_at::date = CURRENT_DATE
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
    // Restrict to last 24 h so the (machine_id, recorded_at DESC) index is used efficiently
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
         AND mm.recorded_at >= NOW() - INTERVAL '24 hours'
       ORDER BY m.id, mm.recorded_at DESC`
    );

    // Today's authoritative per-machine totals from the incremental shift table
    const { rows: todayRows } = await pool.query(
      `SELECT machine_id,
              SUM(parts_produced) AS parts,
              SUM(parts_rejected) AS rejected,
              ROUND(SUM(runtime_hours)::numeric, 2) AS runtime_hours,
              ROUND(SUM(idle_hours)::numeric, 2) AS idle_hours
       FROM machine_parts_produced
       WHERE recorded_at::date = CURRENT_DATE
       GROUP BY machine_id`
    );
    const todayMap = {};
    todayRows.forEach(r => {
      todayMap[r.machine_id] = {
        parts: parseInt(r.parts) || 0,
        rejected: parseInt(r.rejected) || 0,
        runtime_hours: parseFloat(r.runtime_hours) || 0,
        idle_hours: parseFloat(r.idle_hours) || 0,
      };
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
        runtime_hours: today.runtime_hours ?? (parseFloat(r.runtime_hours) || 0),
        idle_hours: today.idle_hours ?? (parseFloat(r.idle_hours) || 0),
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
    // Run all three independent queries in parallel to avoid serial round-trips
    const [demandResult, monthlyResult, effResult] = await Promise.all([
      // Max Demand (kVA) = max of sum of kW/PF across all machines at the same recorded_at
      pool.query(
        `SELECT ROUND(MAX(total_kva)::numeric, 1) AS max_demand
         FROM (
           SELECT recorded_at, SUM(kw / NULLIF(power_factor, 0)) AS total_kva
           FROM machine_metrics
           WHERE recorded_at >= date_trunc('day', NOW())
           GROUP BY recorded_at
         ) t`
      ),
      // Monthly production — sum incremental parts from machine_parts_produced
      pool.query(
        `SELECT SUM(parts_produced) AS monthly_production
         FROM machine_parts_produced
         WHERE recorded_at::date >= DATE_TRUNC('month', CURRENT_DATE)`
      ),
      // Plant efficiency — average of latest efficiency_score per machine
      pool.query(
        `SELECT ROUND(AVG(efficiency_score)) AS avg_efficiency
         FROM (
           SELECT DISTINCT ON (machine_id) efficiency_score
           FROM machine_metrics
           WHERE recorded_at >= NOW() - INTERVAL '24 hours'
           ORDER BY machine_id, recorded_at DESC
         ) t`
      ),
    ]);
    const demandRows  = demandResult.rows;
    const monthlyRows = monthlyResult.rows;
    const effRows     = effResult.rows;

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
      `WITH hours AS (
         SELECT generate_series(
           date_trunc('day', NOW()), 
           date_trunc('day', NOW()) + interval '23 hours', 
           interval '1 hour'
         ) AS hour_bucket
       ),
       plant_snapshots AS (
         SELECT recorded_at, SUM(kw) AS plant_kw
         FROM machine_metrics
         WHERE recorded_at >= date_trunc('day', NOW())
         GROUP BY recorded_at
       )
       SELECT TO_CHAR(h.hour_bucket, 'HH24:00') AS time,
              COALESCE(ROUND(AVG(p.plant_kw)::numeric, 1), 0) AS value
       FROM hours h
       LEFT JOIN plant_snapshots p ON date_trunc('hour', p.recorded_at) = h.hour_bucket
       GROUP BY h.hour_bucket
       ORDER BY h.hour_bucket`
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
      `WITH hours AS (
         SELECT generate_series(
           DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata'),
           DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') + interval '23 hours',
           interval '1 hour'
         ) AS hour_bucket
       ),
       per_machine_hour AS (
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
             CASE
               WHEN max_parts < COALESCE(LAG(max_parts, 1, 0) OVER (PARTITION BY machine_id ORDER BY bucket_ist), 0)
               THEN max_parts
               ELSE max_parts - COALESCE(LAG(max_parts, 1, 0) OVER (PARTITION BY machine_id ORDER BY bucket_ist), 0)
             END AS hour_parts,
             CASE
               WHEN max_kwh < COALESCE(LAG(max_kwh, 1, 0) OVER (PARTITION BY machine_id ORDER BY bucket_ist), 0)
               THEN max_kwh
               ELSE max_kwh - COALESCE(LAG(max_kwh, 1, 0) OVER (PARTITION BY machine_id ORDER BY bucket_ist), 0)
             END AS hour_kwh
           FROM per_machine_hour
         ),
         aggregated_delta AS (
         SELECT
           bucket_ist,
           SUM(hour_parts) AS production,
           SUM(hour_kwh) AS energy
         FROM with_delta
         GROUP BY bucket_ist
       )
       SELECT
         TO_CHAR(h.hour_bucket, 'HH24:00') AS time,
         COALESCE(SUM(a.production), 0)    AS production,
         COALESCE(ROUND(SUM(a.energy)::numeric, 2), 0) AS energy
       FROM hours h
       LEFT JOIN aggregated_delta a ON a.bucket_ist = h.hour_bucket
       GROUP BY h.hour_bucket
       ORDER BY h.hour_bucket`,
      params
    );
    res.json(rows.map(r => ({ time: r.time, production: parseInt(r.production) || 0, energy: parseFloat(r.energy) || 0 })));
  } catch (err) {
    console.error("GET /metrics/production-trend error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/metrics/daily-comparison — day-over-day percentage changes for KPIs
router.get("/daily-comparison", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH today_data AS (
         SELECT 
           COALESCE(SUM(energy_kwh_used), 0) AS total_energy,
           COALESCE(SUM(parts_produced), 0) AS total_parts
         FROM machine_parts_produced
         WHERE recorded_at::date = CURRENT_DATE
       ),
       yesterday_data AS (
         SELECT 
           COALESCE(SUM(energy_kwh_used), 0) AS total_energy,
           COALESCE(SUM(parts_produced), 0) AS total_parts
         FROM machine_parts_produced
         WHERE recorded_at::date = CURRENT_DATE - INTERVAL '1 day'
       ),
       config AS (
         SELECT tariff_per_kwh FROM system_config LIMIT 1
       )
       SELECT
         t.total_energy AS today_energy,
         y.total_energy AS yesterday_energy,
         CASE 
           WHEN y.total_energy > 0 THEN
             ROUND(((t.total_energy - y.total_energy) / y.total_energy * 100)::numeric, 1)
           ELSE 0
         END AS energy_percent_change,
         t.total_parts AS today_parts,
         y.total_parts AS yesterday_parts,
         CASE 
           WHEN y.total_parts > 0 THEN
             ROUND(((t.total_parts - y.total_parts)::numeric / y.total_parts * 100)::numeric, 1)
           ELSE 0
         END AS parts_percent_change,
         ROUND((t.total_energy * c.tariff_per_kwh)::numeric, 0) AS today_cost,
         ROUND((y.total_energy * c.tariff_per_kwh)::numeric, 0) AS yesterday_cost,
         CASE 
           WHEN y.total_energy > 0 THEN
             ROUND(((t.total_energy - y.total_energy) / y.total_energy * 100)::numeric, 1)
           ELSE 0
         END AS cost_percent_change,
         CASE 
           WHEN t.total_parts > 0 THEN
             ROUND((t.total_energy / t.total_parts)::numeric, 2)
           ELSE 0
         END AS today_energy_per_part,
         CASE 
           WHEN y.total_parts > 0 THEN
             ROUND((y.total_energy / y.total_parts)::numeric, 2)
           ELSE 0
         END AS yesterday_energy_per_part
       FROM today_data t, yesterday_data y, config c`
    );

    const data = rows[0] || {};
    
    // Calculate energy per part percentage change
    const energyPerPartChange = data.yesterday_energy_per_part > 0
      ? parseFloat((((data.today_energy_per_part - data.yesterday_energy_per_part) / data.yesterday_energy_per_part) * 100).toFixed(1))
      : 0;

    res.json({
      energy: {
        today: parseFloat(data.today_energy) || 0,
        yesterday: parseFloat(data.yesterday_energy) || 0,
        percentChange: parseFloat(data.energy_percent_change) || 0,
      },
      parts: {
        today: parseInt(data.today_parts) || 0,
        yesterday: parseInt(data.yesterday_parts) || 0,
        percentChange: parseFloat(data.parts_percent_change) || 0,
      },
      cost: {
        today: parseFloat(data.today_cost) || 0,
        yesterday: parseFloat(data.yesterday_cost) || 0,
        percentChange: parseFloat(data.cost_percent_change) || 0,
      },
      energyPerPart: {
        today: parseFloat(data.today_energy_per_part) || 0,
        yesterday: parseFloat(data.yesterday_energy_per_part) || 0,
        percentChange: energyPerPartChange,
      },
    });
  } catch (err) {
    console.error("GET /metrics/daily-comparison error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/metrics/data-quality — ingestion freshness and completeness health
router.get("/data-quality", async (_req, res) => {
  try {
    const [lastIngestResult, missingResult, totalsResult, staleResult] = await Promise.all([
      pool.query(
        `SELECT MAX(recorded_at) AS last_ingestion
         FROM machine_metrics`
      ),
      pool.query(
        `SELECT m.id
         FROM machines m
         LEFT JOIN (
           SELECT machine_id, MAX(recorded_at) AS last_seen
           FROM machine_metrics
           WHERE recorded_at >= NOW() - INTERVAL '10 minutes'
           GROUP BY machine_id
         ) mm ON mm.machine_id = m.id
         WHERE mm.last_seen IS NULL
         ORDER BY m.id`
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_rows,
           COALESCE(SUM(CASE WHEN kw IS NULL OR kwh IS NULL OR parts_produced IS NULL OR efficiency_score IS NULL THEN 1 ELSE 0 END), 0)::int AS invalid_rows
         FROM machine_metrics
         WHERE recorded_at >= NOW() - INTERVAL '24 hours'`
      ),
      pool.query(
        `SELECT machine_id, MAX(recorded_at) AS last_seen
         FROM machine_metrics
         GROUP BY machine_id`
      ),
    ]);

    const lastIngestion = lastIngestResult.rows[0]?.last_ingestion || null;
    const totalRows = Number.parseInt(totalsResult.rows[0]?.total_rows, 10) || 0;
    const invalidRows = Number.parseInt(totalsResult.rows[0]?.invalid_rows, 10) || 0;
    const invalidRatePct = totalRows > 0 ? Math.round((invalidRows / totalRows) * 1000) / 10 : 0;

    const staleMachines = staleResult.rows
      .filter((r) => {
        if (!r.last_seen) return true;
        const delta = Date.now() - new Date(r.last_seen).getTime();
        return Number.isFinite(delta) ? delta > 10 * 60 * 1000 : true;
      })
      .map((r) => r.machine_id);

    res.json({
      last_ingestion: lastIngestion,
      missing_machines: missingResult.rows.map((r) => r.id),
      stale_machines: staleMachines,
      invalid_rate_pct: invalidRatePct,
      total_rows_24h: totalRows,
      invalid_rows_24h: invalidRows,
      status: !lastIngestion || staleMachines.length > 0 || invalidRatePct > 10 ? "warning" : "healthy",
    });
  } catch (err) {
    console.error("GET /metrics/data-quality error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
