const router = require("express").Router();
const pool = require("../db");

// GET /api/production/by-machine?from=DATE&to=DATE
router.get("/by-machine", async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `SELECT machine_id, SUM(parts_produced) AS total_parts, SUM(kwh) AS total_energy,
                   AVG(efficiency_score) AS avg_efficiency
                 FROM machine_metrics`;
    const params = [];
    if (from && to) {
      query += " WHERE recorded_at::date BETWEEN $1 AND $2";
      params.push(from, to);
    }
    query += " GROUP BY machine_id ORDER BY machine_id";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /production/by-machine error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/production/by-shift?from=DATE&to=DATE
router.get("/by-shift", async (req, res) => {
  try {
    const { from, to, scope } = req.query;
    const params = [];
    let where = "";
    const scopeValue = typeof scope === "string" ? scope.toLowerCase() : "elapsed";
    if (from && to) {
      where = " WHERE logical_date BETWEEN $1::date AND $2::date";
      params.push(from, to);
    } else {
      // Default: completed + current shift only (local plant time).
      if (scopeValue === "day") {
        where = " WHERE logical_date = current_local_date";
      } else if (scopeValue === "current") {
        where = " WHERE shift = current_shift AND logical_date = current_shift_logical_date";
      } else {
        where = " WHERE logical_date = current_shift_logical_date AND shift_order <= current_shift_order";
      }
    }

    const { rows } = await pool.query(
      `WITH current_ctx AS (
         SELECT
           (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS current_local_date,
           CASE
             WHEN EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) >= 6
              AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) < 14 THEN 'Morning'
             WHEN EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) >= 14
              AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) < 22 THEN 'Afternoon'
             ELSE 'Night'
           END AS current_shift,
           CASE
             WHEN EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) >= 6
              AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) < 14 THEN 1
             WHEN EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) >= 14
              AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) < 22 THEN 2
             ELSE 3
           END AS current_shift_order,
           CASE
             WHEN EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) < 6
             THEN ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')::date
             ELSE (NOW() AT TIME ZONE 'Asia/Kolkata')::date
           END AS current_shift_logical_date
       ),
       normalized AS (
         SELECT
           (recorded_at AT TIME ZONE 'Asia/Kolkata') AS local_ts,
           CASE
             WHEN shift = 'Shift C (22-06)' AND EXTRACT(HOUR FROM (recorded_at AT TIME ZONE 'Asia/Kolkata')) < 6
             THEN ((recorded_at AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')::date
             ELSE (recorded_at AT TIME ZONE 'Asia/Kolkata')::date
           END AS logical_date,
           CASE shift
             WHEN 'Shift A (06-14)' THEN 'Morning'
             WHEN 'Shift B (14-22)' THEN 'Afternoon'
             ELSE 'Night'
           END AS shift,
           CASE shift
             WHEN 'Shift A (06-14)' THEN 1
             WHEN 'Shift B (14-22)' THEN 2
             ELSE 3
           END AS shift_order,
           machine_id,
           parts_produced,
           parts_rejected,
           efficiency_score
         FROM machine_parts_produced
       )
       SELECT
         shift,
         machine_id,
         SUM(parts_produced) AS parts_produced,
         SUM(parts_rejected) AS parts_rejected,
         ROUND(AVG(efficiency_score)) AS efficiency_pct,
         MIN(shift_order) AS shift_order
       FROM normalized
       CROSS JOIN current_ctx
       ${where}
       GROUP BY shift, machine_id
       ORDER BY MIN(shift_order), machine_id`,
      params
    );

    // Reshape to frontend format: [ { shift, CNC-1: n, CNC-2: n, ... } ]
    const shiftMap = {};
    rows.forEach((r) => {
      if (!shiftMap[r.shift]) shiftMap[r.shift] = { shift: r.shift };
      shiftMap[r.shift][r.machine_id] = Number(r.parts_produced);
    });
    res.json(Object.values(shiftMap));
  } catch (err) {
    console.error("GET /production/by-shift error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/production/monthly
router.get("/monthly", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT TO_CHAR(recorded_at, 'Mon') AS month,
              SUM(parts_produced) AS production
       FROM machine_parts_produced
       WHERE recorded_at::date >= DATE_TRUNC('year', CURRENT_DATE)
       GROUP BY EXTRACT(MONTH FROM recorded_at), TO_CHAR(recorded_at, 'Mon')
       ORDER BY EXTRACT(MONTH FROM recorded_at)`
    );
    res.json(rows.map(r => ({ month: r.month, production: parseInt(r.production) || 0 })));
  } catch (err) {
    console.error("GET /production/monthly error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/production/weekly?from=DATE&to=DATE
router.get("/weekly", async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let where = "";
    if (from && to) {
      where = " WHERE logical_date BETWEEN $1::date AND $2::date";
      params.push(from, to);
    }
    // Use machine_parts_produced (incremental per-shift rows) to get correct daily totals.
    // machine_metrics.parts_produced is cumulative — SUM() on it gives inflated values.
    const { rows } = await pool.query(
      `WITH normalized AS (
         SELECT
           CASE
             WHEN shift = 'Shift C (22-06)' AND EXTRACT(HOUR FROM recorded_at) < 6
             THEN (recorded_at::date - INTERVAL '1 day')::date
             ELSE recorded_at::date
           END AS logical_date,
           machine_id,
           parts_produced,
           energy_kwh_used,
           production_target
         FROM machine_parts_produced
       ),
       current_ctx AS (
         SELECT
           CASE
             WHEN EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) < 6
             THEN ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')::date
             ELSE (NOW() AT TIME ZONE 'Asia/Kolkata')::date
           END AS current_logical_date
       ),
       current_target AS (
         SELECT COALESCE(SUM(m.production_target), 0) AS target
         FROM machines m
       ),
       daily_target AS (
         -- production_target is expected to be per-machine daily target snapshot;
         -- take max per machine/day then sum across machines to avoid shift-wise double counting.
         SELECT
           logical_date,
           COALESCE(SUM(machine_target), 0) AS target
         FROM (
           SELECT
             logical_date,
             machine_id,
             MAX(COALESCE(production_target, 0)) AS machine_target
           FROM normalized
           GROUP BY logical_date, machine_id
         ) t
         GROUP BY logical_date
       )
       SELECT
         n.logical_date AS record_date,
         SUM(n.parts_produced) AS production,
         SUM(n.energy_kwh_used) AS energy,
         CASE
           WHEN n.logical_date = (SELECT current_logical_date FROM current_ctx)
           THEN (SELECT target FROM current_target)
           ELSE COALESCE(MAX(dt.target), 0)
         END AS target
       FROM normalized n
       LEFT JOIN daily_target dt ON dt.logical_date = n.logical_date
       ${where ? where.replace("logical_date", "n.logical_date") : ""}
       GROUP BY n.logical_date
       ORDER BY n.logical_date`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /production/weekly error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
