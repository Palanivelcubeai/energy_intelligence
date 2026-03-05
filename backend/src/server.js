require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
const PORT = parseInt(process.env.PORT || "8000", 10);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/machines", require("./routes/machines"));
app.use("/api/metrics", require("./routes/metrics"));
app.use("/api/production", require("./routes/production"));
app.use("/api/energy-output", require("./routes/energyOutput"));
app.use("/api/power-quality", require("./routes/powerQuality"));
app.use("/api/demand", require("./routes/demand"));
app.use("/api/cost", require("./routes/cost"));
app.use("/api/insights", require("./routes/insights"));
app.use("/api/carbon", require("./routes/carbon"));
app.use("/api/config", require("./routes/config"));
app.use("/api/users", require("./routes/users"));
app.use("/api/reports", require("./routes/reports"));

// Health check
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", database: "disconnected" });
  }
});

app.listen(PORT, () => {
  console.log(`Energy Intelligence API running on http://localhost:${PORT}`);
});
