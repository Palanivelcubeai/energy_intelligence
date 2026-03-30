const router = require("express").Router();
const pool = require("../db");

// Shared CTE: computes plant-level kVA demand per tick.
// Uses COALESCE so the query works even when system_config has no rows.
const DEMAND_CTE = `
  WITH sc_cfg AS (
    SELECT COALESCE(
      (SELECT contract_demand_kva FROM system_config ORDER BY created_at DESC LIMIT 1),
      85
    ) AS contract_demand_kva
  ),
  demand_ticks AS (
    SELECT
      mm.recorded_at,
      ROUND(SUM(mm.kw / NULLIF(mm.power_factor, 0))::numeric, 1)          AS demand_kva,
      sc.contract_demand_kva,
      ROUND(
        SUM(mm.kw / NULLIF(mm.power_factor, 0)) / sc.contract_demand_kva * 100
      , 1)                                                                  AS utilization_pct,
      CASE
        WHEN SUM(mm.kw / NULLIF(mm.power_factor, 0)) >= sc.contract_demand_kva * 0.95 THEN 'Critical'
        WHEN SUM(mm.kw / NULLIF(mm.power_factor, 0)) >= sc.contract_demand_kva * 0.80 THEN 'Warning'
        ELSE 'Normal'
      END                                                                   AS risk_level
    FROM machine_metrics mm
    CROSS JOIN sc_cfg sc
    WHERE $WHERE$
    GROUP BY mm.recorded_at, sc.contract_demand_kva
  )
`;

// GET /api/demand/trend?from=DATE&to=DATE
router.get("/trend", async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let where;
    if (from && to) {
      where = "mm.recorded_at::date BETWEEN $1::date AND $2::date";
      params.push(from, to);
    } else {
      // Default to today's progression only; avoids mixing two dates under the same HH:MM label.
      where = "mm.recorded_at >= date_trunc('day', NOW()) AND mm.recorded_at <= NOW()";
    }
    // Aggregate raw ticks into 15-minute MAX demand buckets
    const sql = DEMAND_CTE.replace("$WHERE$", where) + `
      , bucketed AS (
        SELECT
          DATE_TRUNC('hour', recorded_at) +
          FLOOR(EXTRACT(MINUTE FROM recorded_at) / 15) * INTERVAL '15 minutes' AS bucket_ts,
          MAX(demand_kva) AS demand,
          MAX(contract_demand_kva) AS contract,
          MAX(utilization_pct) AS utilization_pct
        FROM demand_ticks
        GROUP BY
          DATE_TRUNC('hour', recorded_at) +
          FLOOR(EXTRACT(MINUTE FROM recorded_at) / 15) * INTERVAL '15 minutes'
      )
      SELECT
        TO_CHAR(bucket_ts, 'HH24:MI')                  AS time,
        ROUND(demand::numeric, 1)                      AS demand,
        contract                                        AS contract,
        ROUND(utilization_pct::numeric, 1)             AS utilization_pct,
        CASE
          WHEN demand >= contract * 0.95 THEN 'Critical'
          WHEN demand >= contract * 0.80 THEN 'Warning'
          ELSE 'Normal'
        END                                            AS risk_level
      FROM bucketed
      ORDER BY bucket_ts`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /demand/trend error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/demand/current
router.get("/current", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         ROUND(SUM(mm.kw / NULLIF(mm.power_factor, 0))::numeric, 1)   AS demand,
         sc.contract_demand_kva                                         AS contract,
         ROUND(SUM(mm.kw / NULLIF(mm.power_factor, 0)) / sc.contract_demand_kva * 100, 1) AS utilization_pct,
         CASE
           WHEN SUM(mm.kw / NULLIF(mm.power_factor, 0)) >= sc.contract_demand_kva * 0.95 THEN 'Critical'
           WHEN SUM(mm.kw / NULLIF(mm.power_factor, 0)) >= sc.contract_demand_kva * 0.80 THEN 'Warning'
           ELSE 'Normal'
         END AS risk_level
       FROM machine_metrics mm
       CROSS JOIN (
         SELECT COALESCE(
           (SELECT contract_demand_kva FROM system_config ORDER BY created_at DESC LIMIT 1),
           85
         ) AS contract_demand_kva
       ) sc
       WHERE mm.recorded_at = (SELECT MAX(recorded_at) FROM machine_metrics)
       GROUP BY sc.contract_demand_kva`
    );
    res.json(rows[0] || {});
  } catch (err) {
    console.error("GET /demand/current error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/demand/peak-events
router.get("/peak-events", async (_req, res) => {
  try {
    const sql = DEMAND_CTE.replace("$WHERE$", "mm.recorded_at >= date_trunc('day', NOW())") +
      `SELECT TO_CHAR(recorded_at, 'HH24:MI') AS time,
              demand_kva AS demand, contract_demand_kva AS contract,
              utilization_pct, risk_level
       FROM demand_ticks
       WHERE risk_level IN ('Warning', 'Critical')
       ORDER BY recorded_at DESC LIMIT 50`;
    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    console.error("GET /demand/peak-events error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
