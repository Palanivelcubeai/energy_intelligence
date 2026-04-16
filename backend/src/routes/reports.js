const router = require("express").Router();
const pool = require("../db");

function toNum(value, fallback = 0) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

const DEFAULT_REPORTS = [
  {
    key: "daily_cnc_energy",
    name: "Daily CNC Energy Report",
    description: "Daily machine-level energy, runtime, idle and status summary",
    lastGenerated: null,
  },
  {
    key: "production",
    name: "Production Report",
    description: "Shift-wise production, rejection and efficiency details",
    lastGenerated: null,
  },
  {
    key: "energy_per_part",
    name: "Energy per Part Report",
    description: "Machine ranking by energy and cost per part",
    lastGenerated: null,
  },
  {
    key: "monthly_efficiency",
    name: "Monthly Efficiency Report",
    description: "Month-wise production energy efficiency and carbon intensity",
    lastGenerated: null,
  },
  {
    key: "peak_demand",
    name: "Peak Demand Report",
    description: "Peak demand usage, contract utilization and risk levels",
    lastGenerated: null,
  },
  {
    key: "cost_optimization",
    name: "Cost Optimization Report",
    description: "Machine-wise energy cost, idle cost and potential savings",
    lastGenerated: null,
  },
  {
    key: "intelligence_summary",
    name: "Intelligence Summary Report",
    description: "AI usage, machine performance, prediction health and overall intelligence accuracy",
    lastGenerated: null,
  },
];

const intelligenceDocCache = {
  value: null,
  generatedAtMs: 0,
};

const INTELLIGENCE_DOC_CACHE_TTL_MS = Math.max(
  10000,
  toNum(process.env.INTELLIGENCE_REPORT_CACHE_TTL_MS, 120000)
);

// GET /api/reports/list
router.get("/list", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT report_key AS key, report_name AS name, description,
              last_generated AS "lastGenerated"
       FROM reports ORDER BY created_at`
    );
    if (!rows || rows.length === 0) {
      return res.json(DEFAULT_REPORTS);
    }

    // Merge DB metadata with defaults so newly added reports are visible
    // even when the metadata table is not yet backfilled.
    const byKey = new Map((rows || []).map((r) => [r.key, r]));
    for (const r of DEFAULT_REPORTS) {
      if (!byKey.has(r.key)) byKey.set(r.key, r);
    }

    const merged = Array.from(byKey.values());
    const ordered = [
      ...DEFAULT_REPORTS.map((r) => merged.find((m) => m.key === r.key)).filter(Boolean),
      ...merged.filter((m) => !DEFAULT_REPORTS.some((r) => r.key === m.key)),
    ];

    res.json(ordered);
  } catch (err) {
    // If reports table does not exist in the current DB setup, serve default metadata.
    if (err && (err.code === "42P01" || err.code === "42703")) {
      return res.json(DEFAULT_REPORTS);
    }
    console.error("GET /reports/list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/intelligence-summary/document
router.get("/intelligence-summary/document", async (_req, res) => {
  try {
    const now = Date.now();
    if (intelligenceDocCache.value && (now - intelligenceDocCache.generatedAtMs) < INTELLIGENCE_DOC_CACHE_TTL_MS) {
      return res.json(intelligenceDocCache.value);
    }

    const document = await getIntelligenceSummaryDocument();
    intelligenceDocCache.value = document;
    intelligenceDocCache.generatedAtMs = now;
    return res.json(document);
  } catch (err) {
    if (err && (err.code === "42P01" || err.code === "42703")) {
      return res.json({
        title: "Intelligence Summary Report",
        generatedAt: new Date().toISOString(),
        modelUsed: process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:7b",
        executiveSummary: "Intelligence report data is currently limited because required source tables are not fully available.",
        sectionSummaries: [],
        recommendations: ["Complete source data setup and run at least 7 days of metrics for full intelligence reporting."],
        kpis: [],
        aiAccuracy: {
          overall: 0,
          insightConfidence: 0,
          predictiveConfidence: 0,
          dataFreshness: 0,
          demandBacktest: 0,
        },
        charts: {
          productionEnergyTrend: [],
          demandAccuracyTrend: [],
        },
        machines: [],
      });
    }
    console.error("GET /reports/intelligence-summary/document error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/:key/data
router.get("/:key/data", async (req, res) => {
  try {
    const key = req.params.key;

    // Update last_generated where reports metadata table exists.
    try {
      await pool.query(
        "UPDATE reports SET last_generated = NOW(), updated_at = NOW() WHERE report_key = $1",
        [key]
      );
    } catch (e) {
      if (!(e && e.code === "42P01")) {
        throw e;
      }
    }

    let data;
    switch (key) {
      case "daily_cnc_energy":
        data = await getDailyCNCEnergyReport();
        break;
      case "production":
        data = await getProductionReport();
        break;
      case "energy_per_part":
        data = await getEnergyPerPartReport();
        break;
      case "monthly_efficiency":
        data = await getMonthlyEfficiencyReport();
        break;
      case "peak_demand":
        data = await getPeakDemandReport();
        break;
      case "cost_optimization":
        data = await getCostOptimizationReport();
        break;
      case "intelligence_summary":
        data = await getIntelligenceSummaryReport();
        break;
      default:
        return res.status(404).json({ error: "Report not found" });
    }
    res.json(data);
  } catch (err) {
    // In this project, report source tables vary across setup scripts.
    // Return empty report data instead of 500 when optional tables/columns are missing.
    if (err && (err.code === "42P01" || err.code === "42703")) {
      return res.json([]);
    }
    console.error(`GET /reports/${req.params.key}/data error:`, err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function getDailyCNCEnergyReport() {
  const { rows } = await pool.query(
    `SELECT e.record_date AS date, m.name AS machine, e.energy_kwh,
            e.runtime_hours AS runtime_hrs, e.idle_hours AS idle_hrs,
            e.energy_per_part, e.status
     FROM energy_output_daily e JOIN machines m ON m.id = e.machine_id
     WHERE e.record_date >= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY e.record_date DESC, m.id`
  );
  return rows;
}

async function getProductionReport() {
  const { rows } = await pool.query(
    `SELECT sp.record_date AS date, m.name AS machine, sp.shift,
            sp.parts_produced, sp.parts_rejected AS rejected_parts,
            sp.production_target, sp.efficiency_pct AS efficiency
     FROM shift_production sp JOIN machines m ON m.id = sp.machine_id
     WHERE sp.record_date >= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY sp.record_date DESC, sp.shift, m.id`
  );
  return rows;
}

async function getEnergyPerPartReport() {
  const { rows } = await pool.query(
    `SELECT m.name AS machine,
            ROUND(SUM(e.energy_kwh)::numeric, 1) AS total_energy,
            SUM(e.production) AS total_parts,
            CASE WHEN SUM(e.production) > 0
                 THEN ROUND((SUM(e.energy_kwh) / SUM(e.production))::numeric, 2) ELSE 0 END AS energy_per_part,
            CASE WHEN SUM(e.production) > 0
                 THEN ROUND((SUM(e.energy_kwh) / SUM(e.production) * sc.tariff_per_kwh)::numeric, 2) ELSE 0 END AS cost_per_part,
            ROW_NUMBER() OVER (ORDER BY CASE WHEN SUM(e.production) > 0
                 THEN SUM(e.energy_kwh) / SUM(e.production) ELSE 999 END) AS efficiency_rank
     FROM energy_output_daily e
     JOIN machines m ON m.id = e.machine_id
     CROSS JOIN system_config sc
     WHERE e.production > 0
     GROUP BY m.name, sc.tariff_per_kwh
     ORDER BY efficiency_rank`
  );
  return rows;
}

async function getMonthlyEfficiencyReport() {
  const { rows } = await pool.query(
    `SELECT mp.month, mp.total_energy_kwh AS total_energy,
            mp.total_production, mp.avg_energy_per_part,
            mp.efficiency_score, mp.carbon_intensity
     FROM monthly_production mp
     ORDER BY mp.year,
       CASE mp.month WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
       WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
       WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
       WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12 END`
  );
  return rows;
}

async function getPeakDemandReport() {
  const { rows } = await pool.query(
    `SELECT recorded_at::date AS date,
            TO_CHAR(recorded_at, 'HH24:MI') AS time_block,
            demand_kva, contract_demand_kva AS contract_demand,
            utilization_pct AS utilization, risk_level
     FROM demand_records
     WHERE recorded_at >= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY recorded_at DESC`
  );
  return rows;
}

async function getCostOptimizationReport() {
  const { rows } = await pool.query(
    `SELECT m.name AS machine,
            ROUND(COALESCE(e.energy_kwh, 0) * sc.tariff_per_kwh) AS energy_cost,
            ROUND(COALESCE(e.idle_hours, 0) * CASE WHEN m.status != 'maintenance' THEN 3.2 ELSE 0 END * sc.tariff_per_kwh) AS idle_cost,
            ROUND(COALESCE(e.idle_hours, 0) * CASE WHEN m.status != 'maintenance' THEN 3.2 ELSE 0 END * sc.tariff_per_kwh * 0.7
              + COALESCE(e.energy_kwh, 0) * sc.tariff_per_kwh * 0.08) AS potential_savings
     FROM machines m
     LEFT JOIN energy_output_daily e ON e.machine_id = m.id AND e.record_date = CURRENT_DATE
     CROSS JOIN system_config sc
     ORDER BY m.id`
  );
  return rows;
}

async function getIntelligenceSummaryReport() {
  const rows = [];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const pctDelta = (current, previous) => {
    const c = Number(current || 0);
    const p = Number(previous || 0);
    if (!Number.isFinite(c) || !Number.isFinite(p)) return 0;
    if (p === 0) return c === 0 ? 0 : 100;
    return ((c - p) / p) * 100;
  };

  const machineStatusRes = await pool.query(
    `SELECT
       COUNT(*)::int AS total_machines,
       COALESCE(SUM((status = 'running')::int), 0)::int AS running_machines,
       COALESCE(SUM((status = 'idle')::int), 0)::int AS idle_machines,
       COALESCE(SUM((status = 'maintenance')::int), 0)::int AS maintenance_machines
     FROM machines`
  );
  const status = machineStatusRes.rows?.[0] || {
    total_machines: 0,
    running_machines: 0,
    idle_machines: 0,
    maintenance_machines: 0,
  };

  const latestMetricsRes = await pool.query(
    `SELECT DISTINCT ON (machine_id)
       machine_id,
       COALESCE(kw, 0) AS kw,
       COALESCE(kwh, 0) AS kwh,
       COALESCE(parts_produced, 0) AS parts_produced,
       COALESCE(rejection_count, 0) AS rejection_count,
       COALESCE(efficiency_score, 0) AS efficiency_score,
       COALESCE(runtime_hours, 0) AS runtime_hours,
       COALESCE(idle_hours, 0) AS idle_hours,
       COALESCE(power_factor, 0) AS power_factor,
       recorded_at
     FROM machine_metrics
     WHERE recorded_at >= NOW() - INTERVAL '24 hours'
     ORDER BY machine_id, recorded_at DESC`
  );

  const latestMetrics = latestMetricsRes.rows || [];
  const totalParts = latestMetrics.reduce((s, r) => s + Number(r.parts_produced || 0), 0);
  const totalRejects = latestMetrics.reduce((s, r) => s + Number(r.rejection_count || 0), 0);
  const totalEnergy = latestMetrics.reduce((s, r) => s + Number(r.kwh || 0), 0);
  const avgEfficiency = latestMetrics.length
    ? latestMetrics.reduce((s, r) => s + Number(r.efficiency_score || 0), 0) / latestMetrics.length
    : 0;
  const avgPowerFactor = latestMetrics.length
    ? latestMetrics.reduce((s, r) => s + Number(r.power_factor || 0), 0) / latestMetrics.length
    : 0;
  const rejectRate = totalParts > 0 ? (totalRejects / totalParts) * 100 : 0;

  const runtimeTotal = latestMetrics.reduce((s, r) => s + Number(r.runtime_hours || 0), 0);
  const idleTotal = latestMetrics.reduce((s, r) => s + Number(r.idle_hours || 0), 0);
  const utilizationPct = (runtimeTotal + idleTotal) > 0
    ? (runtimeTotal / (runtimeTotal + idleTotal)) * 100
    : 0;

  const freshnessMinutes = latestMetrics.length
    ? latestMetrics.reduce((s, r) => {
        const ts = r.recorded_at ? new Date(r.recorded_at).getTime() : Date.now();
        return s + Math.max(0, (Date.now() - ts) / 60000);
      }, 0) / latestMetrics.length
    : 999;
  const dataFreshnessScore = clamp(Math.round(100 - (freshnessMinutes * 1.5)), 40, 99);

  const predictiveHighRisk = latestMetrics.filter((r) => {
    let flags = 0;
    if (Number(r.rejection_count || 0) > 0 && Number(r.parts_produced || 0) > 0 && ((Number(r.rejection_count || 0) / Number(r.parts_produced || 1)) * 100) >= 5) flags += 1;
    if (Number(r.efficiency_score || 0) < 75) flags += 1;
    if (Number(r.power_factor || 1) < 0.9) flags += 1;
    return flags >= 2;
  }).length;
  const predictiveCoveragePct = status.total_machines > 0
    ? (latestMetrics.length / Number(status.total_machines)) * 100
    : 0;
  const predictiveConfidence = clamp(Math.round(92 - (freshnessMinutes * 1.2)), 45, 99);

  let insight24h = 0;
  let avgInsightConfidence = 0;
  try {
    const insightStats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS insights_24h,
         COALESCE(AVG(confidence_pct), 0)::numeric AS avg_confidence
       FROM insights
       WHERE created_at >= NOW() - INTERVAL '7 days'`
    );
    insight24h = Number(insightStats.rows?.[0]?.insights_24h || 0);
    avgInsightConfidence = Number(insightStats.rows?.[0]?.avg_confidence || 0);
  } catch (_e) {
    // insights table can be optional in some setup states.
  }

  const confidenceValues = [avgInsightConfidence, predictiveConfidence, dataFreshnessScore].filter((v) => Number.isFinite(v) && v > 0);
  const overallAccuracy = confidenceValues.length
    ? Math.round(confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length)
    : 0;

  let todayProduction = 0;
  let yesterdayProduction = 0;
  let last7Production = 0;
  let prev7Production = 0;
  let todayEnergy = 0;
  let yesterdayEnergy = 0;
  let last7Energy = 0;
  let prev7Energy = 0;
  try {
    const trendRes = await pool.query(
      `SELECT
         SUM(CASE WHEN record_date = CURRENT_DATE THEN COALESCE(production, 0) ELSE 0 END)::numeric AS today_production,
         SUM(CASE WHEN record_date = CURRENT_DATE - INTERVAL '1 day' THEN COALESCE(production, 0) ELSE 0 END)::numeric AS yesterday_production,
         SUM(CASE WHEN record_date BETWEEN CURRENT_DATE - INTERVAL '6 days' AND CURRENT_DATE THEN COALESCE(production, 0) ELSE 0 END)::numeric AS last7_production,
         SUM(CASE WHEN record_date BETWEEN CURRENT_DATE - INTERVAL '13 days' AND CURRENT_DATE - INTERVAL '7 days' THEN COALESCE(production, 0) ELSE 0 END)::numeric AS prev7_production,

         SUM(CASE WHEN record_date = CURRENT_DATE THEN COALESCE(energy_kwh, 0) ELSE 0 END)::numeric AS today_energy,
         SUM(CASE WHEN record_date = CURRENT_DATE - INTERVAL '1 day' THEN COALESCE(energy_kwh, 0) ELSE 0 END)::numeric AS yesterday_energy,
         SUM(CASE WHEN record_date BETWEEN CURRENT_DATE - INTERVAL '6 days' AND CURRENT_DATE THEN COALESCE(energy_kwh, 0) ELSE 0 END)::numeric AS last7_energy,
         SUM(CASE WHEN record_date BETWEEN CURRENT_DATE - INTERVAL '13 days' AND CURRENT_DATE - INTERVAL '7 days' THEN COALESCE(energy_kwh, 0) ELSE 0 END)::numeric AS prev7_energy
       FROM energy_output_daily
       WHERE record_date BETWEEN CURRENT_DATE - INTERVAL '13 days' AND CURRENT_DATE`
    );

    const tr = trendRes.rows?.[0] || {};
    todayProduction = Number(tr.today_production || 0);
    yesterdayProduction = Number(tr.yesterday_production || 0);
    last7Production = Number(tr.last7_production || 0);
    prev7Production = Number(tr.prev7_production || 0);
    todayEnergy = Number(tr.today_energy || 0);
    yesterdayEnergy = Number(tr.yesterday_energy || 0);
    last7Energy = Number(tr.last7_energy || 0);
    prev7Energy = Number(tr.prev7_energy || 0);
  } catch (_e) {
    // Optional source table in some setup states.
  }

  let demandBacktestSamples = 0;
  let demandHitRatePct = 0;
  let demandMapePct = 0;
  let demandAccuracyScore = 0;
  try {
    const demandRes = await pool.query(
      `SELECT recorded_at::date AS day, MAX(demand_kva)::numeric AS actual_peak
       FROM demand_records
       WHERE recorded_at::date >= CURRENT_DATE - INTERVAL '15 days'
       GROUP BY recorded_at::date
       ORDER BY day`
    );

    const peaks = (demandRes.rows || [])
      .map((r) => ({ day: String(r.day), actual: Number(r.actual_peak || 0) }))
      .filter((r) => r.actual > 0);

    const scored = [];
    for (let i = 3; i < peaks.length; i += 1) {
      const prev = peaks.slice(i - 3, i);
      const predicted = prev.reduce((s, x) => s + x.actual, 0) / Math.max(1, prev.length);
      const actual = peaks[i].actual;
      const errPct = actual > 0 ? Math.abs(predicted - actual) / actual * 100 : 100;
      const hit = errPct <= 10;
      scored.push({ errPct, hit });
    }

    const recent = scored.slice(-7);
    demandBacktestSamples = recent.length;
    if (recent.length > 0) {
      demandMapePct = recent.reduce((s, x) => s + x.errPct, 0) / recent.length;
      demandHitRatePct = recent.filter((x) => x.hit).length / recent.length * 100;
      demandAccuracyScore = clamp(Math.round(100 - demandMapePct), 0, 100);
    }
  } catch (_e) {
    // Optional source table in some setup states.
  }

  const prodDayDelta = pctDelta(todayProduction, yesterdayProduction);
  const prodWeekDelta = pctDelta(last7Production, prev7Production);
  const energyDayDelta = pctDelta(todayEnergy, yesterdayEnergy);
  const energyWeekDelta = pctDelta(last7Energy, prev7Energy);

  const executiveSummary = [
    `AI operations are ${overallAccuracy >= 80 ? 'strong' : overallAccuracy >= 65 ? 'stable' : 'under watch'} with estimated intelligence accuracy at ${overallAccuracy}%.`,
    `Plant now runs ${status.running_machines}/${status.total_machines} machines with avg efficiency ${Math.round(avgEfficiency)}% and reject rate ${Math.round(rejectRate * 10) / 10}%.`,
    `Production trend: ${Math.round(prodDayDelta)}% vs yesterday and ${Math.round(prodWeekDelta)}% vs previous week; energy trend: ${Math.round(energyDayDelta)}% day-over-day and ${Math.round(energyWeekDelta)}% week-over-week.`,
    demandBacktestSamples > 0
      ? `Demand forecast backtest over ${demandBacktestSamples} recent days shows ${Math.round(demandHitRatePct)}% hit rate and ${Math.round(demandAccuracyScore)}% accuracy score.`
      : 'Demand forecast backtest is not yet available due to limited historical demand records.',
  ].join(' ');

  rows.push(
    { section: 'Executive Summary', metric: 'Plant intelligence overview', value: executiveSummary, status: 'Auto-generated' },

    { section: 'AI Adoption', metric: 'AI stack in use', value: 'Ollama + rule-backed intelligence services', status: 'Active' },
    { section: 'AI Adoption', metric: 'Natural chat assist', value: 'Enabled (realtime evidence + streaming response)', status: 'Running' },
    { section: 'AI Adoption', metric: 'AI insights generated (24h)', value: String(insight24h), status: insight24h > 0 ? 'Healthy' : 'Low activity' },

    { section: 'Machine Performance', metric: 'Machine status split', value: `Running ${status.running_machines}, Idle ${status.idle_machines}, Maintenance ${status.maintenance_machines}`, status: 'Live' },
    { section: 'Machine Performance', metric: 'Total production (latest snapshot)', value: `${totalParts} parts`, status: 'Live' },
    { section: 'Machine Performance', metric: 'Total energy (latest snapshot)', value: `${Math.round(totalEnergy * 100) / 100} kWh`, status: 'Live' },
    { section: 'Machine Performance', metric: 'Plant efficiency and reject trend', value: `Avg efficiency ${Math.round(avgEfficiency)}%, Reject rate ${Math.round(rejectRate * 10) / 10}%`, status: 'Monitored' },
    { section: 'Machine Performance', metric: 'Runtime utilization', value: `${Math.round(utilizationPct)}% runtime utilization`, status: utilizationPct >= 70 ? 'Good' : 'Needs improvement' },
    { section: 'Machine Performance', metric: 'Production trend (DoD / WoW)', value: `${Math.round(prodDayDelta)}% day-over-day, ${Math.round(prodWeekDelta)}% week-over-week`, status: prodDayDelta >= 0 ? 'Improving' : 'Declining' },
    { section: 'Machine Performance', metric: 'Energy trend (DoD / WoW)', value: `${Math.round(energyDayDelta)}% day-over-day, ${Math.round(energyWeekDelta)}% week-over-week`, status: energyDayDelta <= 0 ? 'Efficient' : 'Rising energy use' },

    { section: 'Prediction Health', metric: 'Predictive coverage', value: `${Math.round(predictiveCoveragePct)}% of machines with fresh predictive signals`, status: predictiveCoveragePct >= 80 ? 'Good' : 'Partial' },
    { section: 'Prediction Health', metric: 'High-risk machine predictions', value: `${predictiveHighRisk} machine(s) flagged high risk`, status: predictiveHighRisk > 0 ? 'Action needed' : 'Stable' },
    { section: 'Prediction Health', metric: 'Predictive confidence', value: `${predictiveConfidence}%`, status: predictiveConfidence >= 75 ? 'Reliable' : 'Low confidence' },
    { section: 'Prediction Health', metric: 'Demand forecast backtest hit rate', value: `${Math.round(demandHitRatePct)}% (within 10% error band)`, status: demandHitRatePct >= 70 ? 'Reliable' : demandBacktestSamples > 0 ? 'Needs tuning' : 'Insufficient data' },
    { section: 'Prediction Health', metric: 'Demand forecast MAPE', value: demandBacktestSamples > 0 ? `${Math.round(demandMapePct * 10) / 10}% over ${demandBacktestSamples} days` : 'Not enough history', status: demandMapePct <= 15 ? 'Good' : demandBacktestSamples > 0 ? 'High error' : 'Pending' },

    { section: 'Overall Intelligence Accuracy', metric: 'Overall intelligence accuracy (estimated)', value: `${overallAccuracy}%`, status: overallAccuracy >= 80 ? 'Strong' : overallAccuracy >= 65 ? 'Moderate' : 'Needs calibration' },
    { section: 'Overall Intelligence Accuracy', metric: 'Supporting confidence signals', value: `Insights ${Math.round(avgInsightConfidence)}%, Predictive ${predictiveConfidence}%, Data freshness ${dataFreshnessScore}%, Demand backtest ${Math.round(demandAccuracyScore)}%`, status: 'Composite' },
    { section: 'Overall Intelligence Accuracy', metric: 'Average power quality confidence marker', value: `Avg PF ${Math.round(avgPowerFactor * 100) / 100}`, status: avgPowerFactor >= 0.9 ? 'Within target' : 'Below target' }
  );

  return rows;
}

async function buildNarrativeWithQwen(payload) {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:7b";
  const controller = new AbortController();
  const timeoutMs = Math.max(3000, toNum(process.env.INTELLIGENCE_REPORT_AI_TIMEOUT_MS, 9000));
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const fallback = {
    executiveSummary:
      `AI monitoring is ${payload.aiAccuracy.overall >= 80 ? "strong" : "active"} with estimated overall intelligence accuracy at ${payload.aiAccuracy.overall}%. ` +
      `Plant is running ${payload.kpis.runningMachines}/${payload.kpis.totalMachines} machines, with average efficiency ${payload.kpis.avgEfficiency}% and reject rate ${payload.kpis.rejectRatePct}%. ` +
      `Recent trend shows production ${payload.kpis.productionTrendLabel} and energy ${payload.kpis.energyTrendLabel}.`,
    sectionSummaries: [
      { heading: "AI Usage", summary: "The platform uses Qwen via Ollama for natural language insights and recommendations grounded on realtime plant evidence." },
      { heading: "Machine Operations", summary: "Machine KPIs are continuously summarized from latest metrics to track efficiency, rejects, utilization, and power quality." },
      { heading: "Prediction Quality", summary: "Prediction health combines confidence, freshness, and recent backtest behavior to estimate reliability." },
    ],
    recommendations: [
      "Prioritize highest reject-rate machine for immediate process stabilization.",
      "Review lowest-efficiency machine setup and cycle parameters.",
      "Track prediction backtest metrics daily and recalibrate thresholds when hit rate declines.",
    ],
  };

  const systemPrompt = [
    "You are a manufacturing intelligence reporting assistant.",
    "Use only the provided JSON evidence and do not invent values.",
    "Return ONLY valid JSON.",
    "Schema: {\"executiveSummary\":string,\"sectionSummaries\":[{\"heading\":string,\"summary\":string}],\"recommendations\":string[]}",
    "Keep executiveSummary concise (4-6 sentences).",
    "Section summaries must be short and professional.",
  ].join(" ");

  const userPrompt = `Evidence JSON:\n${JSON.stringify(payload)}`;

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: {
          temperature: 0.2,
          num_predict: 280,
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return fallback;

    const payloadRes = await response.json();
    const content = payloadRes?.message?.content || "";
    const parsed = parseJsonObject(content);
    if (!parsed) return fallback;

    const executiveSummary = typeof parsed.executiveSummary === "string" && parsed.executiveSummary.trim()
      ? parsed.executiveSummary.trim()
      : fallback.executiveSummary;

    const sectionSummaries = Array.isArray(parsed.sectionSummaries)
      ? parsed.sectionSummaries
          .filter((s) => s && typeof s.heading === "string" && typeof s.summary === "string")
          .slice(0, 5)
      : fallback.sectionSummaries;

    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((r) => typeof r === "string" && r.trim()).slice(0, 5)
      : fallback.recommendations;

    return {
      executiveSummary,
      sectionSummaries: sectionSummaries.length ? sectionSummaries : fallback.sectionSummaries,
      recommendations: recommendations.length ? recommendations : fallback.recommendations,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function getIntelligenceSummaryDocument() {
  const nowIso = new Date().toISOString();

  const machineStatusRes = await pool.query(
    `SELECT
       COUNT(*)::int AS total_machines,
       COALESCE(SUM((status = 'running')::int), 0)::int AS running_machines,
       COALESCE(SUM((status = 'idle')::int), 0)::int AS idle_machines,
       COALESCE(SUM((status = 'maintenance')::int), 0)::int AS maintenance_machines
     FROM machines`
  );
  const status = machineStatusRes.rows?.[0] || {
    total_machines: 0,
    running_machines: 0,
    idle_machines: 0,
    maintenance_machines: 0,
  };

  const latestMetricsRes = await pool.query(
    `SELECT DISTINCT ON (machine_id)
       machine_id,
       COALESCE(kw, 0) AS kw,
       COALESCE(kwh, 0) AS kwh,
       COALESCE(parts_produced, 0) AS parts_produced,
       COALESCE(rejection_count, 0) AS rejection_count,
       COALESCE(efficiency_score, 0) AS efficiency_score,
       COALESCE(runtime_hours, 0) AS runtime_hours,
       COALESCE(idle_hours, 0) AS idle_hours,
       COALESCE(power_factor, 0) AS power_factor,
       recorded_at
     FROM machine_metrics
     WHERE recorded_at >= NOW() - INTERVAL '24 hours'
     ORDER BY machine_id, recorded_at DESC`
  );
  const latestMetrics = latestMetricsRes.rows || [];

  const totalParts = latestMetrics.reduce((s, r) => s + toNum(r.parts_produced, 0), 0);
  const totalRejects = latestMetrics.reduce((s, r) => s + toNum(r.rejection_count, 0), 0);
  const totalEnergy = latestMetrics.reduce((s, r) => s + toNum(r.kwh, 0), 0);
  const avgEfficiencyRaw = latestMetrics.length
    ? latestMetrics.reduce((s, r) => s + toNum(r.efficiency_score, 0), 0) / latestMetrics.length
    : 0;
  const avgPowerFactorRaw = latestMetrics.length
    ? latestMetrics.reduce((s, r) => s + toNum(r.power_factor, 0), 0) / latestMetrics.length
    : 0;
  const rejectRateRaw = totalParts > 0 ? (totalRejects / totalParts) * 100 : 0;

  const runtimeTotal = latestMetrics.reduce((s, r) => s + toNum(r.runtime_hours, 0), 0);
  const idleTotal = latestMetrics.reduce((s, r) => s + toNum(r.idle_hours, 0), 0);
  const utilizationRaw = (runtimeTotal + idleTotal) > 0 ? (runtimeTotal / (runtimeTotal + idleTotal)) * 100 : 0;

  const freshnessMinutes = latestMetrics.length
    ? latestMetrics.reduce((s, r) => {
        const ts = r.recorded_at ? new Date(r.recorded_at).getTime() : Date.now();
        return s + Math.max(0, (Date.now() - ts) / 60000);
      }, 0) / latestMetrics.length
    : 999;
  const dataFreshnessScore = clamp(Math.round(100 - freshnessMinutes * 1.5), 40, 99);

  let insight24h = 0;
  let avgInsightConfidence = 0;
  try {
    const insightStats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS insights_24h,
         COALESCE(AVG(confidence_pct), 0)::numeric AS avg_confidence
       FROM insights
       WHERE created_at >= NOW() - INTERVAL '7 days'`
    );
    insight24h = toNum(insightStats.rows?.[0]?.insights_24h, 0);
    avgInsightConfidence = toNum(insightStats.rows?.[0]?.avg_confidence, 0);
  } catch {}

  const predictiveConfidence = clamp(Math.round(92 - freshnessMinutes * 1.2), 45, 99);

  const prodEnergyTrendRes = await pool.query(
    `SELECT
       TO_CHAR(record_date, 'MM-DD') AS day,
       ROUND(SUM(COALESCE(production, 0))::numeric, 0) AS production,
       ROUND(SUM(COALESCE(energy_kwh, 0))::numeric, 1) AS energy,
       ROUND(AVG(COALESCE(efficiency_score, 0))::numeric, 1) AS efficiency
     FROM energy_output_daily
     WHERE record_date BETWEEN CURRENT_DATE - INTERVAL '6 days' AND CURRENT_DATE
     GROUP BY record_date
     ORDER BY record_date`
  );
  const productionEnergyTrend = (prodEnergyTrendRes.rows || []).map((r) => ({
    day: r.day,
    production: toNum(r.production, 0),
    energy: toNum(r.energy, 0),
    efficiency: toNum(r.efficiency, 0),
  }));

  if (productionEnergyTrend.length === 0) {
    try {
      const monthlyFallback = await pool.query(
        `SELECT month AS day,
                COALESCE(total_production, 0) AS production,
                COALESCE(total_energy_kwh, 0) AS energy,
                COALESCE(efficiency_score, 0) AS efficiency
         FROM monthly_production
         ORDER BY year DESC,
           CASE month WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
           WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
           WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
           WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12 END DESC
         LIMIT 7`
      );

      productionEnergyTrend.push(
        ...((monthlyFallback.rows || []).reverse().map((r) => ({
          day: String(r.day),
          production: toNum(r.production, 0),
          energy: toNum(r.energy, 0),
          efficiency: toNum(r.efficiency, 0),
        })))
      );
    } catch {}
  }

  let demandAccuracyTrend = [];
  let demandHitRatePct = 0;
  let demandMapePct = 0;
  let demandAccuracyScore = 0;
  try {
    const demandRes = await pool.query(
      `SELECT recorded_at::date AS day, MAX(demand_kva)::numeric AS actual_peak
       FROM demand_records
       WHERE recorded_at::date >= CURRENT_DATE - INTERVAL '15 days'
       GROUP BY recorded_at::date
       ORDER BY day`
    );

    const peaks = (demandRes.rows || [])
      .map((r) => ({ day: String(r.day), actual: toNum(r.actual_peak, 0) }))
      .filter((r) => r.actual > 0);

    const scored = [];
    for (let i = 3; i < peaks.length; i += 1) {
      const prev = peaks.slice(i - 3, i);
      const predicted = prev.reduce((s, x) => s + x.actual, 0) / Math.max(1, prev.length);
      const actual = peaks[i].actual;
      const errPct = actual > 0 ? Math.abs(predicted - actual) / actual * 100 : 100;
      const hit = errPct <= 10;
      scored.push({
        day: peaks[i].day.slice(5),
        predicted: Math.round(predicted * 10) / 10,
        actual: Math.round(actual * 10) / 10,
        errorPct: Math.round(errPct * 10) / 10,
        hit,
      });
    }

    demandAccuracyTrend = scored.slice(-7);
    if (demandAccuracyTrend.length > 0) {
      demandMapePct = demandAccuracyTrend.reduce((s, x) => s + x.errorPct, 0) / demandAccuracyTrend.length;
      demandHitRatePct = demandAccuracyTrend.filter((x) => x.hit).length / demandAccuracyTrend.length * 100;
      demandAccuracyScore = clamp(Math.round(100 - demandMapePct), 0, 100);
    }
  } catch {}

  const confidenceValues = [avgInsightConfidence, predictiveConfidence, dataFreshnessScore, demandAccuracyScore]
    .filter((v) => Number.isFinite(v) && v > 0);
  const overallAccuracy = confidenceValues.length
    ? Math.round(confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length)
    : 0;

  const machineSnapshots = latestMetrics
    .map((m) => {
      const parts = toNum(m.parts_produced, 0);
      const rejects = toNum(m.rejection_count, 0);
      const rejectRate = parts > 0 ? (rejects / parts) * 100 : 0;
      const efficiency = toNum(m.efficiency_score, 0);
      const pf = toNum(m.power_factor, 0);

      let risk = "Low";
      if (rejectRate >= 8 || efficiency < 65 || pf < 0.85) risk = "High";
      else if (rejectRate >= 5 || efficiency < 75 || pf < 0.9) risk = "Medium";

      return {
        machine: m.machine_id,
        parts,
        rejects,
        rejectRate: Math.round(rejectRate * 10) / 10,
        efficiency: Math.round(efficiency),
        powerFactor: Math.round(pf * 100) / 100,
        energy: Math.round(toNum(m.kwh, 0) * 10) / 10,
        risk,
      };
    })
    .sort((a, b) => {
      const rank = { High: 3, Medium: 2, Low: 1 };
      if (rank[b.risk] !== rank[a.risk]) return rank[b.risk] - rank[a.risk];
      return b.rejectRate - a.rejectRate;
    });

  const dayDelta = productionEnergyTrend.length >= 2
    ? ((productionEnergyTrend[productionEnergyTrend.length - 1].production - productionEnergyTrend[productionEnergyTrend.length - 2].production) /
        Math.max(1, productionEnergyTrend[productionEnergyTrend.length - 2].production)) * 100
    : 0;
  const energyDayDelta = productionEnergyTrend.length >= 2
    ? ((productionEnergyTrend[productionEnergyTrend.length - 1].energy - productionEnergyTrend[productionEnergyTrend.length - 2].energy) /
        Math.max(1, productionEnergyTrend[productionEnergyTrend.length - 2].energy)) * 100
    : 0;

  const kpiPayload = {
    totalMachines: Number(status.total_machines || 0),
    runningMachines: Number(status.running_machines || 0),
    avgEfficiency: Math.round(avgEfficiencyRaw),
    rejectRatePct: Math.round(rejectRateRaw * 10) / 10,
    productionTrendLabel: `${Math.round(dayDelta)}% vs previous day`,
    energyTrendLabel: `${Math.round(energyDayDelta)}% vs previous day`,
    overallAccuracy,
  };

  const qwenInput = {
    kpis: kpiPayload,
    aiAccuracy: {
      overall: overallAccuracy,
      insightConfidence: Math.round(avgInsightConfidence),
      predictiveConfidence,
      dataFreshness: dataFreshnessScore,
      demandBacktest: Math.round(demandAccuracyScore),
      demandHitRate: Math.round(demandHitRatePct),
      demandMape: Math.round(demandMapePct * 10) / 10,
    },
    topRiskMachines: machineSnapshots.slice(0, 3),
    trendSummary: productionEnergyTrend,
  };

  const narrative = await buildNarrativeWithQwen(qwenInput);

  return {
    title: "Intelligence Summary Report",
    generatedAt: nowIso,
    modelUsed: process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:7b",
    executiveSummary: narrative.executiveSummary,
    sectionSummaries: narrative.sectionSummaries,
    recommendations: narrative.recommendations,
    kpis: {
      totalMachines: Number(status.total_machines || 0),
      runningMachines: Number(status.running_machines || 0),
      idleMachines: Number(status.idle_machines || 0),
      maintenanceMachines: Number(status.maintenance_machines || 0),
      totalProduction: totalParts,
      totalEnergy: Math.round(totalEnergy * 10) / 10,
      avgEfficiency: Math.round(avgEfficiencyRaw),
      rejectRatePct: Math.round(rejectRateRaw * 10) / 10,
      utilizationPct: Math.round(utilizationRaw),
      aiInsights24h: insight24h,
    },
    aiAccuracy: {
      overall: overallAccuracy,
      insightConfidence: Math.round(avgInsightConfidence),
      predictiveConfidence,
      dataFreshness: dataFreshnessScore,
      demandBacktest: Math.round(demandAccuracyScore),
      demandHitRate: Math.round(demandHitRatePct),
      demandMape: Math.round(demandMapePct * 10) / 10,
    },
    charts: {
      productionEnergyTrend,
      demandAccuracyTrend,
    },
    machines: machineSnapshots,
  };
}

module.exports = router;
