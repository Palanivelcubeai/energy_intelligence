const router = require("express").Router();
const pool = require("../db");

// GET /api/machines — list all machines
router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.name, m.status, m.rated_power_kw, m.production_target, m.product_type
       FROM machines m ORDER BY m.id`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /machines error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/machines/:id — single machine detail
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM machines WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Machine not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /machines/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/machines/:id/metrics — latest metrics for a machine
router.get("/:id/metrics", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM machine_metrics
       WHERE machine_id = $1
       ORDER BY recorded_at DESC LIMIT 1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.json(null);
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /machines/:id/metrics error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/machines/:id/trend — 24h trend for a machine (hourly IST buckets)
router.get("/:id/trend", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         -- Convert to IST hour bucket, return as UTC-aware timestamp so frontend toLocaleTimeString works
         (DATE_TRUNC('hour', recorded_at AT TIME ZONE 'Asia/Kolkata')
            AT TIME ZONE 'Asia/Kolkata') AS time,
         ROUND(AVG(kw)::numeric, 2) AS value
       FROM machine_metrics
       WHERE machine_id = $1 AND recorded_at >= NOW() - INTERVAL '24 hours'
       GROUP BY DATE_TRUNC('hour', recorded_at AT TIME ZONE 'Asia/Kolkata')
       ORDER BY DATE_TRUNC('hour', recorded_at AT TIME ZONE 'Asia/Kolkata')`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /machines/:id/trend error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/machines/:id/config — update machine config
router.put("/:id/config", async (req, res) => {
  try {
    const { name, rated_power_kw, production_target, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE machines SET name = COALESCE($1, name), rated_power_kw = COALESCE($2, rated_power_kw),
       production_target = COALESCE($3, production_target), status = COALESCE($4, status)
       WHERE id = $5 RETURNING *`,
      [name, rated_power_kw, production_target, status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Machine not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /machines/:id/config error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
