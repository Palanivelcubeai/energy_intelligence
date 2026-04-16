const router = require("express").Router();
const pool = require("../db");

async function ensureTargetHistoryTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS production_target_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_id VARCHAR(20) NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      old_target INT NOT NULL,
      new_target INT NOT NULL,
      changed_by VARCHAR(255),
      source VARCHAR(100),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
}

// GET /api/machines — list all machines
router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.name, m.status, m.rated_power_kw, m.production_target, m.product_type, m.heat_threshold_c
       FROM machines m ORDER BY m.id`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /machines error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/machines/target-history?limit=20
router.get("/target-history", async (req, res) => {
  try {
    await ensureTargetHistoryTable();
    const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query?.limit || "20"), 10) || 20));

    const { rows } = await pool.query(
      `SELECT h.id, h.machine_id, h.old_target, h.new_target, h.changed_by, h.source, h.changed_at,
              m.name AS machine_name
       FROM production_target_history h
       JOIN machines m ON m.id = h.machine_id
       ORDER BY h.changed_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /machines/target-history error:", err);
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
  const client = await pool.connect();
  try {
    const { name, rated_power_kw, production_target, status, heat_threshold_c } = req.body;
    const changedBy = String(req.body?.changed_by || req.body?.changedBy || req.body?.updated_by || "system").trim() || "system";
    const source = String(req.body?.source || "admin-config").trim() || "admin-config";

    await ensureTargetHistoryTable();
    await client.query("BEGIN");

    const { rows: beforeRows } = await client.query(
      "SELECT id, production_target FROM machines WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );

    if (beforeRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Machine not found" });
    }

    const oldTarget = Number(beforeRows[0].production_target || 0);

    const { rows } = await client.query(
      `UPDATE machines SET name = COALESCE($1, name), rated_power_kw = COALESCE($2, rated_power_kw),
       production_target = COALESCE($3, production_target), status = COALESCE($4, status),
       heat_threshold_c = COALESCE($5, heat_threshold_c),
       updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name, rated_power_kw, production_target, status, heat_threshold_c, req.params.id]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Machine not found" });
    }

    const updated = rows[0];
    const newTarget = Number(updated.production_target || 0);
    if (Number.isFinite(newTarget) && newTarget !== oldTarget) {
      await client.query(
        `INSERT INTO production_target_history (machine_id, old_target, new_target, changed_by, source)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, oldTarget, newTarget, changedBy, source]
      );
    }

    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("PUT /machines/:id/config error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
