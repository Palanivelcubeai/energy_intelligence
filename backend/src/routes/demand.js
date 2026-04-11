const router = require("express").Router();
const pool = require("../db");

function toNum(value, fallback = 0) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonObject(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(trimmed.slice(first, last + 1));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }

  return null;
}

function calculateFallbackPeakPrediction(points, contractDemand) {
  const safePoints = Array.isArray(points) ? points : [];
  const currentDemand = safePoints.length ? toNum(safePoints[safePoints.length - 1].demand, 0) : 0;
  const maxDemand = safePoints.length ? Math.max(...safePoints.map((p) => toNum(p.demand, 0))) : 0;
  const recent = safePoints.slice(-4);
  const upward = recent.length >= 2
    ? Math.max(0, toNum(recent[recent.length - 1].demand, 0) - toNum(recent[0].demand, 0))
    : 0;
  const momentumBoost = upward * 0.6;
  const operationalBuffer = Math.max(maxDemand * 0.02, 0.8);

  const predicted = Math.max(currentDemand, maxDemand) + momentumBoost + operationalBuffer;
  const rounded = Math.round(predicted * 10) / 10;
  const risk = rounded >= contractDemand * 0.95
    ? "Critical"
    : (rounded >= contractDemand * 0.8 ? "Warning" : "Normal");

  return {
    predicted_kva: rounded,
    confidence: 76,
    risk_level: risk,
    reasoning: `Trend-based fallback using current ${currentDemand.toFixed(1)} kVA, max ${maxDemand.toFixed(1)} kVA, and short-term momentum.`,
    source: "fallback",
  };
}

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

// GET /api/demand/ai-prediction
router.get("/ai-prediction", async (_req, res) => {
  try {
    const aiOnly = String(_req.query?.aiOnly || "false").toLowerCase() === "true";
    const trendSql = DEMAND_CTE.replace("$WHERE$", "mm.recorded_at >= NOW() - INTERVAL '7 days' AND mm.recorded_at <= NOW()") + `
      , bucketed AS (
        SELECT
          DATE_TRUNC('hour', recorded_at) + FLOOR(EXTRACT(MINUTE FROM recorded_at) / 15) * INTERVAL '15 minutes' AS bucket_ts,
          MAX(demand_kva) AS demand,
          MAX(contract_demand_kva) AS contract
        FROM demand_ticks
        GROUP BY DATE_TRUNC('hour', recorded_at) + FLOOR(EXTRACT(MINUTE FROM recorded_at) / 15) * INTERVAL '15 minutes'
      )
      SELECT
        TO_CHAR(bucket_ts::date, 'YYYY-MM-DD') AS day,
        TO_CHAR(bucket_ts, 'HH24:MI') AS time,
        (bucket_ts::date = CURRENT_DATE) AS is_today,
        ROUND(demand::numeric, 1) AS demand,
        contract
      FROM bucketed
      ORDER BY bucket_ts`;

    const { rows } = await pool.query(trendSql);
    const points = rows.map((r) => ({
      day: r.day,
      time: r.time,
      is_today: Boolean(r.is_today),
      demand: toNum(r.demand, 0),
      contract: toNum(r.contract, 85),
    }));

    const todayPoints = points.filter((p) => p.is_today);
    const baselinePoints = todayPoints.length ? todayPoints : points.slice(-96);

    const dailyPeakMap = new Map();
    for (const p of points) {
      const prev = dailyPeakMap.get(p.day);
      if (prev === undefined || p.demand > prev) {
        dailyPeakMap.set(p.day, p.demand);
      }
    }
    const dailyPeaks = Array.from(dailyPeakMap.entries())
      .map(([day, peak_kva]) => ({ day, peak_kva: Math.round(toNum(peak_kva, 0) * 10) / 10 }))
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));

    const contractDemand = points.length ? toNum(points[0].contract, 85) : 85;
    const fallback = calculateFallbackPeakPrediction(baselinePoints, contractDemand);

    const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    const model = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:7b";
    const runtimeFallbackModel = process.env.OLLAMA_RUNTIME_FALLBACK_MODEL || "qwen2.5:3b";
    const modelCandidates = Array.from(new Set([model, runtimeFallbackModel].filter(Boolean)));
    const timeoutMs = Math.max(8000, Number.parseInt(process.env.DEMAND_AI_TIMEOUT_MS || "18000", 10) || 18000);

    const systemPrompt = [
      "You are an industrial demand forecasting assistant.",
      "Use only provided demand data.",
      "Return ONLY valid JSON.",
      "Schema: {\"predicted_kva\":number,\"confidence\":number,\"risk_level\":\"Normal|Warning|Critical\",\"reasoning\":string}",
      "Keep reasoning under 20 words.",
    ].join(" ");

    const latestSlice = baselinePoints.slice(-16);
    const userPrompt = [
      `Contract demand: ${contractDemand} kVA`,
      `Past 7 days daily peak summary: ${JSON.stringify(dailyPeaks)}`,
      `Latest 15-min demand points for current day: ${JSON.stringify(latestSlice)}`,
      `Deterministic baseline prediction: ${fallback.predicted_kva} kVA`,
      "Predict today's likely peak demand kVA using both one-week trend and today's progression.",
    ].join("\n");

    try {
      let parsed = null;

      for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
        for (let i = 0; i < modelCandidates.length && !parsed; i += 1) {
          const selectedModel = modelCandidates[i];
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs + (attempt * 6000));

          try {
            const response = await fetch(`${ollamaUrl}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: selectedModel,
                stream: false,
                keep_alive: process.env.OLLAMA_KEEP_ALIVE || "30m",
                format: "json",
                options: {
                  temperature: 0.2,
                  num_predict: 120,
                },
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPrompt },
                ],
              }),
              signal: controller.signal,
            });

            if (!response.ok) {
              continue;
            }

            const payload = await response.json();
            const content = payload?.message?.content || "";
            const candidate = parseJsonObject(content);
            if (candidate) {
              parsed = candidate;
            }
          } catch {
            // try next candidate/attempt
          } finally {
            clearTimeout(timeout);
          }
        }
      }

      if (!parsed) {
        if (aiOnly) {
          return res.status(503).json({ error: "AI prediction unavailable" });
        }
        return res.json(fallback);
      }

      const rawPredicted = toNum(parsed.predicted_kva, fallback.predicted_kva);
      const boundedPredicted = Math.max(0, Math.min(rawPredicted, Math.max(contractDemand * 1.8, fallback.predicted_kva * 1.5)));
      const predicted = Math.round(boundedPredicted * 10) / 10;
      const confidence = Math.max(55, Math.min(98, Math.round(toNum(parsed.confidence, 80))));
      const riskLevel = ["Normal", "Warning", "Critical"].includes(parsed.risk_level)
        ? parsed.risk_level
        : (predicted >= contractDemand * 0.95 ? "Critical" : (predicted >= contractDemand * 0.8 ? "Warning" : "Normal"));
      const reasoning = typeof parsed.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning.trim().slice(0, 180)
        : fallback.reasoning;

      return res.json({
        predicted_kva: predicted,
        confidence,
        risk_level: riskLevel,
        reasoning,
        source: "ai",
        window_days: 7,
      });
    } catch {
      if (aiOnly) {
        return res.status(503).json({ error: "AI prediction unavailable" });
      }
      return res.json({ ...fallback, window_days: 7 });
    }
  } catch (err) {
    console.error("GET /demand/ai-prediction error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
