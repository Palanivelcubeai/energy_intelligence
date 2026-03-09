const router = require("express").Router();
const pool = require("../db");

// Shared CTE: computes plant-level kVA demand per tick
const DEMAND_CTE = `
  WITH demand_ticks AS (
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
    CROSS JOIN system_config sc
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
      where = "mm.recorded_at >= NOW() - INTERVAL '24 hours'";
    }
    // Aggregate raw ticks into 15-minute MAX demand buckets
    const sql = DEMAND_CTE.replace("$WHERE$", where) + `
      SELECT
        TO_CHAR(
          DATE_TRUNC('hour', recorded_at) +
          FLOOR(EXTRACT(MINUTE FROM recorded_at) / 15) * INTERVAL '15 minutes',
          'HH24:MI'
        )                                              AS time,
        ROUND(MAX(demand_kva)::numeric, 1)             AS demand,
        MAX(contract_demand_kva)                       AS contract,
        ROUND(MAX(utilization_pct)::numeric, 1)        AS utilization_pct,
        CASE
          WHEN MAX(demand_kva) >= MAX(contract_demand_kva) * 0.95 THEN 'Critical'
          WHEN MAX(demand_kva) >= MAX(contract_demand_kva) * 0.80 THEN 'Warning'
          ELSE 'Normal'
        END                                            AS risk_level
      FROM demand_ticks
      GROUP BY
        DATE_TRUNC('hour', recorded_at) +
        FLOOR(EXTRACT(MINUTE FROM recorded_at) / 15) * INTERVAL '15 minutes'
      ORDER BY 1`;
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
       CROSS JOIN system_config sc
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
