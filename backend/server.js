require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authRouter = require("./routes/auth");

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:5174"],
    credentials: true,
  })
);
app.use(express.json());

// Routes
app.use("/api/auth", authRouter);

// Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Energy Intelligence API running on http://localhost:${PORT}`);
});
