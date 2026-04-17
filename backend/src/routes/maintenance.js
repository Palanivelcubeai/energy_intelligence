const router = require("express").Router();
const pool = require("../db");
const { getPredictiveMaintenancePayload } = require("../services/predictiveMaintenanceService");

router.get("/predictive", async (_req, res) => {
  try {
    const payload = await getPredictiveMaintenancePayload(pool);
    res.json(payload);
  } catch (err) {
    console.error("GET /maintenance/predictive error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
