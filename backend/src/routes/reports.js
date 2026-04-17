const router = require("express").Router();
const pool = require("../db");
const { getPredictiveMaintenancePayload } = require("../services/predictiveMaintenanceService");

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

function median(values) {
  const nums = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 0) return (nums[mid - 1] + nums[mid]) / 2;
  return nums[mid];
}

function dayOfWeekUtc(dayValue) {
  const d = new Date(dayValue);
  if (!Number.isFinite(d.getTime())) return null;
  return d.getUTCDay();
}

function formatDayLabel(dayValue) {
  const d = new Date(dayValue);
  if (!Number.isFinite(d.getTime())) return String(dayValue || "");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const monthShort = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${dd} ${monthShort}`;
}
function isoUtcSeconds(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toIsoSecondsIfTimestampString(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return value;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return value;
  return isoUtcSeconds(parsed);
}

function normalizeTimestamps(value) {
  if (value == null) return value;
  if (value instanceof Date) return isoUtcSeconds(value);
  if (Array.isArray(value)) return value.map((item) => normalizeTimestamps(item));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeTimestamps(v);
    }
    return out;
  }
  return toIsoSecondsIfTimestampString(value);
}

function winsorizedMean(values, lowerQuantile = 0.1, upperQuantile = 0.9) {
  const nums = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  if (nums.length < 4) return nums.reduce((s, v) => s + v, 0) / nums.length;

  const loIndex = Math.floor((nums.length - 1) * lowerQuantile);
  const hiIndex = Math.ceil((nums.length - 1) * upperQuantile);
  const lo = nums[Math.max(0, loIndex)];
  const hi = nums[Math.min(nums.length - 1, hiIndex)];

  const bounded = nums.map((v) => clamp(v, lo, hi));
  return bounded.reduce((s, v) => s + v, 0) / bounded.length;
}

function forecastRecentWeighted(peaks, index) {
  const history = peaks.slice(Math.max(0, index - 3), index).map((x) => toNum(x.actual, 0)).filter((x) => x > 0);
  if (history.length === 0) return 0;
  if (history.length < 3) return history.reduce((s, v) => s + v, 0) / history.length;
  return (history[0] * 0.2) + (history[1] * 0.3) + (history[2] * 0.5);
}

function forecastWeekdayMedian(peaks, index) {
  const history = peaks.slice(Math.max(0, index - 14), index).map((x) => toNum(x.actual, 0)).filter((x) => x > 0);
  if (history.length === 0) return 0;

  const targetDow = dayOfWeekUtc(peaks[index].day);
  const weekdayHistory = peaks
    .slice(0, index)
    .filter((x) => dayOfWeekUtc(x.day) === targetDow)
    .map((x) => toNum(x.actual, 0))
    .filter((x) => x > 0);

  const weekdayCenter = weekdayHistory.length ? median(weekdayHistory) : median(history);
  const historyCenter = median(history);
  return (weekdayCenter * 0.7) + (historyCenter * 0.3);
}

function boundedForecast(value, history) {
  const nums = (history || []).filter((v) => Number.isFinite(v) && v > 0);
  if (nums.length === 0) return Math.max(0, value);
  const lo = Math.min(...nums) * 0.8;
  const hi = Math.max(...nums) * 1.2;
  return clamp(Math.max(0, value), lo, hi);
}

function forecastSameDayLastWeek(peaks, index) {
  if (index - 7 >= 0) {
    return toNum(peaks[index - 7]?.actual, 0);
  }

  const history = peaks
    .slice(Math.max(0, index - 7), index)
    .map((x) => toNum(x.actual, 0))
    .filter((x) => x > 0);
  if (history.length === 0) return 0;
  return median(history);
}

function evaluateModelError(peaks, endIndex, modelFn) {
  const start = Math.max(3, endIndex - 5);
  const errs = [];
  for (let j = start; j < endIndex; j += 1) {
    const history = peaks.slice(Math.max(0, j - 14), j).map((x) => toNum(x.actual, 0)).filter((x) => x > 0);
    if (history.length === 0) continue;
    const pred = boundedForecast(modelFn(peaks, j), history);
    const actual = toNum(peaks[j].actual, 0);
    if (actual <= 0) continue;
    errs.push(Math.abs(pred - actual) / actual * 100);
  }
  if (errs.length === 0) return Number.POSITIVE_INFINITY;
  return errs.reduce((s, v) => s + v, 0) / errs.length;
}

function forecastDemandPeak(peaks, index) {
  const history = peaks.slice(Math.max(0, index - 14), index).map((x) => toNum(x.actual, 0)).filter((x) => x > 0);
  if (history.length === 0) return 0;

  const recentModel = (arr, i) => forecastRecentWeighted(arr, i);
  const weekdayModel = (arr, i) => forecastWeekdayMedian(arr, i);
  const weeklyModel = (arr, i) => forecastSameDayLastWeek(arr, i);

  const recentErr = evaluateModelError(peaks, index, recentModel);
  const weekdayErr = evaluateModelError(peaks, index, weekdayModel);
  const weeklyErr = evaluateModelError(peaks, index, weeklyModel);

  const recentPred = recentModel(peaks, index);
  const weekdayPred = weekdayModel(peaks, index);
  const weeklyPred = weeklyModel(peaks, index);

  const rw = 1 / (1 + recentErr);
  const ww = 1 / (1 + weekdayErr);
  const sw = 1 / (1 + weeklyErr);
  const totalWeight = rw + ww + sw;

  let blended = totalWeight > 0
    ? ((recentPred * rw) + (weekdayPred * ww) + (weeklyPred * sw)) / totalWeight
    : recentPred;

  const trendLookback = history.slice(-6);
  const trendDeltas = [];
  for (let i = 1; i < trendLookback.length; i += 1) {
    const prev = trendLookback[i - 1];
    const curr = trendLookback[i];
    if (prev > 0 && curr > 0) {
      trendDeltas.push((curr - prev) / prev);
    }
  }
  if (trendDeltas.length > 0) {
    const trendSignal = winsorizedMean(trendDeltas, 0.1, 0.9);
    const trendFactor = clamp(trendSignal, -0.08, 0.08);
    blended = blended * (1 + trendFactor * 0.5);
  }

  return boundedForecast(blended, history);
}

function forecastDemandPeakBiasCorrected(peaks, index) {
  const history = peaks.slice(Math.max(0, index - 14), index).map((x) => toNum(x.actual, 0)).filter((x) => x > 0);
  if (history.length === 0) return 0;

  const base = forecastDemandPeak(peaks, index);
  const ratioResiduals = [];
  const backStart = Math.max(3, index - 5);
  for (let j = backStart; j < index; j += 1) {
    const jHistory = peaks.slice(Math.max(0, j - 14), j).map((x) => toNum(x.actual, 0)).filter((x) => x > 0);
    if (jHistory.length === 0) continue;
    const jPred = forecastDemandPeak(peaks, j);
    const jActual = toNum(peaks[j].actual, 0);
    if (jActual <= 0 || jPred <= 0) continue;
    ratioResiduals.push(jActual / jPred);
  }

  const biasRatio = ratioResiduals.length > 0
    ? clamp(winsorizedMean(ratioResiduals, 0.2, 0.8), 0.9, 1.1)
    : 1;
  const corrected = base * (1 + ((biasRatio - 1) * 0.7));
  return boundedForecast(corrected, history);
}

function computeDemandBacktestMetrics(peaks, includeTrend = false, windowDays = 7) {
  const scored = [];
  for (let i = 3; i < peaks.length; i += 1) {
    const predicted = forecastDemandPeakBiasCorrected(peaks, i);
    const actual = toNum(peaks[i].actual, 0);
    const errPct = actual > 0 ? Math.abs(predicted - actual) / actual * 100 : 100;
    const hit10 = errPct <= 10;
    const hit20 = errPct <= 20;

    scored.push({
      day: formatDayLabel(peaks[i].day),
      predicted: Math.round(predicted * 10) / 10,
      actual: Math.round(actual * 10) / 10,
      errorPct: Math.round(errPct * 10) / 10,
      hit: hit20,
      hit10,
    });
  }

  const recent = scored.slice(-Math.max(1, windowDays));
  const samples = recent.length;
  if (samples === 0) {
    return {
      samples: 0,
      ready: false,
      hit20: 0,
      hit10: 0,
      mape: 0,
      rawMape: 0,
      score: 0,
      trend: includeTrend ? [] : undefined,
    };
  }

  const errorPcts = recent.map((x) => x.errorPct);
  const rawMape = errorPcts.reduce((s, v) => s + v, 0) / errorPcts.length;
  const mape = winsorizedMean(errorPcts, 0.1, 0.9);
  const hit20 = recent.filter((x) => x.hit).length / samples * 100;
  const hit10 = recent.filter((x) => x.hit10).length / samples * 100;
  const outlierDays = recent.filter((x) => x.errorPct > 30).length;
  const ready = samples >= MIN_DEMAND_BACKTEST_SAMPLES;

  const mapeScore = clamp(Math.round(100 - mape), 0, 100);
  const score = ready ? clamp(Math.round((mapeScore * 0.7) + (hit20 * 0.3)), 0, 100) : 0;

  return {
    samples,
    ready,
    hit20,
    hit10,
    outlierDays,
    mape,
    rawMape,
    score,
    trend: includeTrend ? recent : undefined,
  };
}

function buildDemandMetricNote(shortWindow, longWindow) {
  if (!shortWindow || shortWindow.samples === 0) return "Awaiting enough demand backtest points.";

  const notes = [];
  if ((shortWindow.outlierDays || 0) > 0) {
    notes.push(`${shortWindow.outlierDays} outlier day(s) (>30% error) affected the recent window.`);
  }
  if (longWindow && longWindow.samples >= 14) {
    const mapeDelta = shortWindow.mape - longWindow.mape;
    if (Math.abs(mapeDelta) >= 2) {
      const text = Math.abs(Math.round(mapeDelta * 10) / 10);
      notes.push(
        mapeDelta > 0
          ? `Recent 14-day MAPE is ${text} points higher than the 30-day baseline.`
          : `Recent 14-day MAPE is ${text} points lower than the 30-day baseline.`
      );
    }

    const hitDelta = shortWindow.hit20 - longWindow.hit20;
    if (Math.abs(hitDelta) >= 5) {
      const text = Math.abs(Math.round(hitDelta));
      notes.push(
        hitDelta > 0
          ? `Recent 20% hit-rate improved by ${text} points vs 30-day baseline.`
          : `Recent 20% hit-rate dropped by ${text} points vs 30-day baseline.`
      );
    }
  }

  return notes.length === 0
    ? "Recent demand accuracy is stable against the 30-day baseline."
    : notes.join(" ");
}

function computeDemandOperationalStatus(shortWindow, longWindow, ready) {
  if (!ready || !shortWindow || shortWindow.samples < MIN_DEMAND_BACKTEST_SAMPLES) {
    return {
      status: "Calibrating",
      reason: `Needs at least ${MIN_DEMAND_BACKTEST_SAMPLES} recent backtest samples for reliable status.`,
    };
  }

  const mapeRecent = toNum(shortWindow.mape, 100);
  const hit20Recent = toNum(shortWindow.hit20, 0);
  const outliers = toNum(shortWindow.outlierDays, 0);
  const mape30 = longWindow && longWindow.samples >= 14 ? toNum(longWindow.mape, mapeRecent) : mapeRecent;
  const hit2030 = longWindow && longWindow.samples >= 14 ? toNum(longWindow.hit20, hit20Recent) : hit20Recent;
  const severeDrift = (hit20Recent - hit2030) <= -15 || (mapeRecent - mape30) >= 5;

  if (mapeRecent >= 20 || hit20Recent < 60 || outliers >= 3 || severeDrift) {
    return {
      status: "Action Needed",
      reason: "High recent forecast error or low practical hit-rate requires model/data review.",
    };
  }

  if (mapeRecent >= 15 || hit20Recent < 75 || (mapeRecent - mape30) >= 3 || outliers >= 2) {
    return {
      status: "Watch",
      reason: "Performance is acceptable but has short-term drift or outlier impact.",
    };
  }

  return {
    status: "Stable",
    reason: "Recent demand forecast stays within practical operating thresholds.",
  };
}

async function getDemandPeaks(daysLookback = 21) {
  const { rows } = await pool.query(
    `SELECT recorded_at::date AS day, MAX(demand_kva)::numeric AS actual_peak
     FROM demand_records
     WHERE recorded_at::date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
     GROUP BY recorded_at::date
     ORDER BY day`,
    [Math.max(7, Number.parseInt(String(daysLookback), 10) || 21)]
  );

  return (rows || [])
    .map((r) => ({ day: r.day, actual: toNum(r.actual_peak, 0) }))
    .filter((r) => r.actual > 0);
}

const MIN_DEMAND_BACKTEST_SAMPLES = 7;
const DEMAND_RECENT_WINDOW_DAYS = 14;
const DEMAND_BASELINE_WINDOW_DAYS = 30;
const INTELLIGENCE_DOC_CACHE_TTL_MS = Math.max(1000, toNum(process.env.INTELLIGENCE_DOC_CACHE_TTL_MS, 30000));

let intelligenceDocCache = {
  key: null,
  expiresAt: 0,
  value: null,
};

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
    name: "Intelligence Summary",
    description: "AI-generated plant intelligence with confidence and demand forecast reliability",
    lastGenerated: null,
  },
];

router.get("/list", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT report_key AS key, report_name AS name, description,
              last_generated AS "lastGenerated"
       FROM reports ORDER BY created_at`
    );
    if (!rows || rows.length === 0) {
      return res.json(normalizeTimestamps(DEFAULT_REPORTS));
    }

    // Preserve DB-defined rows while ensuring built-in report cards are always available.
    const merged = [...rows];
    const existingKeys = new Set(rows.map((r) => String(r?.key || "")));
    for (const fallback of DEFAULT_REPORTS) {
      if (!existingKeys.has(fallback.key)) {
        merged.push(fallback);
      }
    }

    res.json(normalizeTimestamps(merged));
  } catch (err) {
    if (err && (err.code === "42P01" || err.code === "42703")) {
      return res.json(normalizeTimestamps(DEFAULT_REPORTS));
    }
    console.error("GET /reports/list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/intelligence-summary/document", async (_req, res) => {
  try {
    const cacheKey = "doc:full";
    if (intelligenceDocCache.key === cacheKey && intelligenceDocCache.expiresAt > Date.now() && intelligenceDocCache.value) {
      return res.json(normalizeTimestamps(intelligenceDocCache.value));
    }

    const document = await getIntelligenceSummaryDocument();
    intelligenceDocCache = {
      key: cacheKey,
      value: document,
      expiresAt: Date.now() + INTELLIGENCE_DOC_CACHE_TTL_MS,
    };
    return res.json(normalizeTimestamps(document));
  } catch (err) {
    console.error("GET /reports/intelligence-summary/document error:", err);
    return res.status(500).json({ error: "Failed to generate intelligence summary document" });
  }
});

router.get("/intelligence-summary/document-fast", async (_req, res) => {
  try {
    const cacheKey = "doc:fast";
    if (intelligenceDocCache.key === cacheKey && intelligenceDocCache.expiresAt > Date.now() && intelligenceDocCache.value) {
      return res.json(normalizeTimestamps(intelligenceDocCache.value));
    }

    const document = await getIntelligenceSummaryDocument({ skipAiNarrative: true });
    intelligenceDocCache = {
      key: cacheKey,
      value: document,
      expiresAt: Date.now() + INTELLIGENCE_DOC_CACHE_TTL_MS,
    };
    return res.json(normalizeTimestamps(document));
  } catch (err) {
    console.error("GET /reports/intelligence-summary/document-fast error:", err);
    return res.status(500).json({ error: "Failed to generate intelligence summary document" });
  }
});

router.get("/:key/data", async (req, res) => {
  try {
    const key = req.params.key;

    try {
      await pool.query(
        "UPDATE reports SET last_generated = date_trunc('second', NOW()), updated_at = date_trunc('second', NOW()) WHERE report_key = $1",
        [key]
      );
    } catch (e) {
      if (!(e && e.code === "42P01")) throw e;
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

    return res.json(normalizeTimestamps(data));
  } catch (err) {
    if (err && (err.code === "42P01" || err.code === "42703")) {
      return res.json([]);
    }
    console.error(`GET /reports/${req.params.key}/data error:`, err);
    return res.status(500).json({ error: "Internal server error" });
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

  // Build appendix rows from the intelligence document payload so /reports/intelligence_summary/data
  // always returns a table-friendly array for the frontend ReportTable.
  const doc = await getIntelligenceSummaryDocument();
  const ai = doc?.aiAccuracy || {};
  const kpis = doc?.kpis || {};
  const hitDelta = toNum(ai.demandHitRateDelta, toNum(ai.demandHitRate, 0) - toNum(ai.demandHitRate30, 0));
  const mapeDelta = toNum(ai.demandMapeDelta, toNum(ai.demandMape, 0) - toNum(ai.demandMape30, 0));
  const deltaLabel = (delta, lowerIsBetter = false) => {
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.05) return "(→ 0.0 vs baseline)";
    const arrow = delta > 0 ? "↑" : "↓";
    const sign = delta > 0 ? "+" : "";
    const polarityNote = lowerIsBetter
      ? (delta > 0 ? "worse" : "better")
      : (delta > 0 ? "better" : "worse");
    return `(${arrow} ${sign}${Math.round(delta * 10) / 10} vs baseline, ${polarityNote})`;
  };

  const buildAction = (metric) => {
    if (metric.includes("Demand hit-rate")) return "Monitor 24h and recalibrate demand model if trend remains below target";
    if (metric.includes("Demand MAPE")) return "Investigate outlier day drivers and recalibrate demand model";
    if (metric.includes("Outlier days")) return "Review top outlier days for production anomaly or load-shift events";
    if (metric.includes("Demand status")) return "Follow escalation rule block and assign owner for corrective action";
    if (metric.includes("Data freshness")) return "Check sensor/data gap and restore ingestion cadence";
    if (metric.includes("Data completeness")) return "Check sensor/data gap and backfill missing intervals";
    if (metric.includes("Missing intervals")) return "Validate ingestion pipeline and network connectivity";
    if (metric.includes("Predictive confidence")) return "Track reliability daily; recalibrate if confidence remains low";
    if (metric.includes("Insight confidence")) return "Monitor 24h and validate low-confidence recommendations manually";
    if (metric.includes("Reject rate")) return "Prioritize process stabilization on high-risk machines this shift";
    if (metric.includes("Avg efficiency")) return "Tune cycle parameters and reduce idle losses this week";
    return "Monitor 24h";
  };

  const add = (section, metric, value, status) => {
    rows.push({
      section,
      metric,
      value,
      status,
      recommended_action: buildAction(metric),
    });
  };

  add('Overall Intelligence', 'Overall intelligence accuracy', `${toNum(ai.overall, 0)}%`, toNum(ai.overall, 0) >= 80 ? 'Strong' : 'Watch');
  add('Overall Intelligence', 'Insight confidence', `${toNum(ai.insightConfidence, 0)}%${ai.insightConfidenceEstimated ? ' (estimated)' : ''}`, ai.insightConfidenceEstimated ? 'Estimated' : 'Measured');
  add('Overall Intelligence', 'Predictive confidence', `${toNum(ai.predictiveConfidence, 0)}%`, toNum(ai.predictiveConfidence, 0) >= 75 ? 'Reliable' : 'Watch');
  add('Overall Intelligence', 'Data completeness', `${toNum(ai.dataCompletenessPct, 0)}%`, toNum(ai.dataCompletenessPct, 0) >= 85 ? 'Good' : 'Limited');
  add('Overall Intelligence', 'Missing intervals (24h)', `${toNum(ai.missingIntervalsCount, 0)}`, toNum(ai.missingIntervalsCount, 0) > 0 ? 'Watch' : 'Stable');

  add('Demand Forecast', 'Demand backtest score', `${toNum(ai.demandBacktest, 0)}%`, ai.demandBacktestReady ? 'Ready' : 'Calibrating');
  add('Demand Forecast', 'Demand hit-rate (20% band)', `${toNum(ai.demandHitRate, 0)}% ${deltaLabel(hitDelta)}`, toNum(ai.demandHitRate, 0) >= 75 ? 'Good' : 'Watch');
  add('Demand Forecast', 'Demand hit-rate (10% band)', `${toNum(ai.demandHitRate10, 0)}%`, toNum(ai.demandHitRate10, 0) >= 60 ? 'Good' : 'Watch');
  add('Demand Forecast', 'Demand hit-rate (30d baseline)', `${toNum(ai.demandHitRate30, 0)}%`, 'Baseline');
  add('Demand Forecast', 'Demand MAPE (winsorized)', `${toNum(ai.demandMape, 0)}% ${deltaLabel(mapeDelta, true)}`, toNum(ai.demandMape, 0) <= 15 ? 'Good' : 'High error');
  add('Demand Forecast', 'Demand MAPE (raw)', `${toNum(ai.demandMapeRaw, toNum(ai.demandMape, 0))}%`, 'Observed');
  add('Demand Forecast', 'Demand MAPE (30d baseline)', `${toNum(ai.demandMape30, toNum(ai.demandMape, 0))}%`, 'Baseline');
  add('Demand Forecast', 'Outlier days (>30% error)', String(toNum(ai.demandOutlierDays, 0)), toNum(ai.demandOutlierDays, 0) > 0 ? 'Watch' : 'Stable');
  add('Demand Forecast', 'Demand status', String(ai.demandStatus || 'Calibrating'), String(ai.demandStatus || 'Calibrating'));
  add('Demand Forecast', 'Demand status reason', String(ai.demandStatusReason || 'Waiting for enough samples.'), 'Info');
  add('Demand Forecast', 'Why score changed', String(ai.demandMetricNote || 'No major change from baseline.'), 'Info');

  add('Plant KPIs', 'Machines running', `${toNum(kpis.runningMachines, 0)}/${toNum(kpis.totalMachines, 0)}`, 'Live');
  add('Plant KPIs', 'Avg efficiency', `${toNum(kpis.avgEfficiency, 0)}%`, toNum(kpis.avgEfficiency, 0) >= 75 ? 'Good' : 'Watch');
  add('Plant KPIs', 'Reject rate', `${toNum(kpis.rejectRatePct, 0)}%`, toNum(kpis.rejectRatePct, 0) <= 5 ? 'Good' : 'Watch');
  add('Plant KPIs', 'Data freshness', `${toNum(ai.dataFreshness, 0)}%`, toNum(ai.dataFreshness, 0) >= 80 ? 'Fresh' : 'Stale');

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

function buildFallbackNarrative(payload) {
  return {
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
}

async function getIntelligenceSummaryDocument(options = {}) {
  const skipAiNarrative = Boolean(options.skipAiNarrative);
  const nowIso = isoUtcSeconds();

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
  const dataFreshnessScore = clamp(Math.round(100 - (freshnessMinutes * 1.5)), 40, 99);

  const metricsVolumeRes = await pool.query(
    `SELECT COUNT(*)::int AS sample_count
     FROM machine_metrics
     WHERE recorded_at >= NOW() - INTERVAL '24 hours'`
  );
  const lastIngestionRes = await pool.query(
    `SELECT MAX(recorded_at) AS last_ingestion
     FROM machine_metrics`
  );
  const totalSamples24h = toNum(metricsVolumeRes.rows?.[0]?.sample_count, 0);
  const lastIngestionRaw = lastIngestionRes.rows?.[0]?.last_ingestion || null;
  const lastIngestionAt = lastIngestionRaw ? isoUtcSeconds(new Date(lastIngestionRaw)) : null;
  const expectedIntervalSec = Math.max(20, toNum(process.env.MACHINE_METRIC_EXPECTED_INTERVAL_SEC, 40));
  const machineCount = Math.max(1, toNum(status.total_machines, 1));
  const expectedSamples24h = Math.max(1, Math.round((24 * 60 * 60 / expectedIntervalSec) * machineCount));
  const missingIntervalsCount = Math.max(0, expectedSamples24h - totalSamples24h);
  const dataCompletenessPct = clamp(Math.round((totalSamples24h / expectedSamples24h) * 100), 0, 100);
  const forecastQualityWarning = dataCompletenessPct < 85
    ? "Forecast quality limited by input gaps"
    : "";

  let insight24h = 0;
  let avgInsightConfidence = 0;
  let insightConfidenceSamples7d = 0;
  try {
    const insightStats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS insights_24h,
         COALESCE(AVG(confidence_pct), 0)::numeric AS avg_confidence,
         COUNT(confidence_pct)::int AS confidence_samples
       FROM insights
       WHERE created_at >= NOW() - INTERVAL '7 days'`
    );
    insight24h = toNum(insightStats.rows?.[0]?.insights_24h, 0);
    avgInsightConfidence = toNum(insightStats.rows?.[0]?.avg_confidence, 0);
    insightConfidenceSamples7d = toNum(insightStats.rows?.[0]?.confidence_samples, 0);
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
  let demandHitRateStrictPct = 0;
  let demandMapePct = 0;
  let demandMapeRawPct = 0;
  let demandHitRate30Pct = 0;
  let demandMape30Pct = 0;
  let demandBacktestSamples = 0;
  let demandBacktestSamples30 = 0;
  let demandOutlierDays = 0;
  let demandMetricNote = "Awaiting enough demand backtest points.";
  let demandStatus = "Calibrating";
  let demandStatusReason = `Needs at least ${MIN_DEMAND_BACKTEST_SAMPLES} recent backtest samples for reliable status.`;
  let demandAccuracyScore = 0;
  let demandBacktestReady = false;
  try {
    const peaks = await getDemandPeaks(45);
    const demandMetrics = computeDemandBacktestMetrics(peaks, true, DEMAND_RECENT_WINDOW_DAYS);
    const demandMetrics30 = computeDemandBacktestMetrics(peaks, false, DEMAND_BASELINE_WINDOW_DAYS);
    demandBacktestSamples = demandMetrics.samples;
    demandAccuracyTrend = demandMetrics.trend || [];
    demandHitRatePct = demandMetrics.hit20;
    demandHitRateStrictPct = demandMetrics.hit10;
    demandMapePct = demandMetrics.mape;
    demandMapeRawPct = demandMetrics.rawMape;
    demandHitRate30Pct = demandMetrics30.hit20;
    demandMape30Pct = demandMetrics30.mape;
    demandBacktestSamples30 = demandMetrics30.samples;
    demandOutlierDays = demandMetrics.outlierDays || 0;
    demandMetricNote = buildDemandMetricNote(demandMetrics, demandMetrics30);
    const demandStatusInfo = computeDemandOperationalStatus(demandMetrics, demandMetrics30, demandMetrics.ready);
    demandStatus = demandStatusInfo.status;
    demandStatusReason = demandStatusInfo.reason;
    demandAccuracyScore = demandMetrics.score;
    demandBacktestReady = demandMetrics.ready;
  } catch (_e) {
    // Optional source table in some setup states.
  }

  const insightConfidenceDisplay = clamp(Math.round(avgInsightConfidence), 0, 100);
  const demandHitRateDelta = Math.round((demandHitRatePct - demandHitRate30Pct) * 10) / 10;
  const demandMapeDelta = Math.round((demandMapePct - demandMape30Pct) * 10) / 10;
  const hitRateDeltaPenalty = Math.max(0, Math.abs(demandHitRateDelta) - 3) * 0.8;
  const mapeDeltaPenalty = Math.max(0, Math.abs(demandMapeDelta) - 1.5) * 1.2;
  const outlierPenalty = demandOutlierDays * 2.2;
  const hitRateQualityBonus = clamp((demandHitRatePct - 60) * 0.2, 0, 8);
  const mapeQualityBonus = clamp((16.5 - demandMapePct) * 1.0, 0, 8);
  const readinessBonus = demandBacktestReady ? 7 : 0;
  const modelConsistencyScore = clamp(
    Math.round(
      93 -
      hitRateDeltaPenalty -
      mapeDeltaPenalty -
      outlierPenalty +
      hitRateQualityBonus +
      mapeQualityBonus +
      readinessBonus
    ),
    48,
    99
  );
  const backtestStabilityScore = clamp(
    Math.round(100 - (demandOutlierDays * 12) - Math.max(0, demandMapePct - 10) * 2),
    35,
    99
  );
  const confidenceBreakdown = {
    dataFreshness: { value: dataFreshnessScore, weightPct: 30 },
    dataCompleteness: { value: dataCompletenessPct, weightPct: 25 },
    modelConsistency: { value: modelConsistencyScore, weightPct: 25 },
    backtestStability: { value: backtestStabilityScore, weightPct: 20 },
  };

  const fallbackInsightConfidence = clamp(
    Math.round((predictiveConfidence + dataFreshnessScore + (demandAccuracyScore > 0 ? demandAccuracyScore : predictiveConfidence)) / 3),
    45,
    98
  );
  const insightConfidenceEstimated = insightConfidenceSamples7d <= 0;
  const insightConfidenceValue = insightConfidenceEstimated
    ? fallbackInsightConfidence
    : Math.round(avgInsightConfidence);

  const confidenceValues = [insightConfidenceValue, predictiveConfidence, dataFreshnessScore, demandAccuracyScore]
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
      insightConfidence: insightConfidenceValue,
      predictiveConfidence,
      dataFreshness: dataFreshnessScore,
      demandBacktest: Math.round(demandAccuracyScore),
      demandBacktestReady,
      demandBacktestSamples: demandAccuracyTrend.length,
      demandBacktestMinSamples: MIN_DEMAND_BACKTEST_SAMPLES,
      demandHitRate: Math.round(demandHitRatePct),
      demandHitRate10: Math.round(demandHitRateStrictPct),
      demandHitRate30: Math.round(demandHitRate30Pct),
      demandMape: Math.round(demandMapePct * 10) / 10,
      demandMapeRaw: Math.round(demandMapeRawPct * 10) / 10,
      demandMape30: Math.round(demandMape30Pct * 10) / 10,
      demandOutlierDays,
      demandBacktestSamples30,
      demandMetricNote,
      demandStatus,
      demandStatusReason,
    },
    topRiskMachines: machineSnapshots.slice(0, 3),
    trendSummary: productionEnergyTrend,
  };

  const highRiskCount = machineSnapshots.filter((m) => m.risk === "High").length;
  const mediumRiskCount = machineSnapshots.filter((m) => m.risk === "Medium").length;
  const operationalStatus = highRiskCount > 0 || rejectRateRaw > 6
    ? "Action Needed"
    : (mediumRiskCount > 0 || rejectRateRaw > 4 || Math.round(avgEfficiencyRaw) < 75 ? "Watch" : "Stable");

  const topIssues = [];
  if (highRiskCount > 0) topIssues.push(`High-risk machines detected: ${highRiskCount}`);
  if (rejectRateRaw > 4) topIssues.push(`Reject rate elevated at ${Math.round(rejectRateRaw * 10) / 10}%`);
  if (Math.round(avgEfficiencyRaw) < 75) topIssues.push(`Average efficiency below target at ${Math.round(avgEfficiencyRaw)}%`);
  if ((demandStatus || "") === "Action Needed" || (demandStatus || "") === "Watch") {
    topIssues.push(`Demand forecast status: ${demandStatus}`);
  }

  const reliabilityWindow = (demandAccuracyTrend || []).slice(-4);
  const reliabilityStableDays = reliabilityWindow.filter((d) => toNum(d.errorPct, 100) <= 15).length;
  const sustainedReliability = reliabilityWindow.length >= 3 && reliabilityStableDays >= 3;

  const forecastReliable = Boolean(
    demandBacktestReady &&
    modelConsistencyScore >= 72 &&
    demandStatus !== "Action Needed" &&
    (demandStatus === "Stable" || sustainedReliability)
  );
  const forecastReliabilityLabel = forecastReliable ? "Reliable" : "Use with caution";
  const reliabilityReasons = [];
  if (!demandBacktestReady) {
    reliabilityReasons.push(`Demand backtest is still calibrating (${demandBacktestSamples}/${MIN_DEMAND_BACKTEST_SAMPLES} samples).`);
  }
  if (modelConsistencyScore < 72) {
    reliabilityReasons.push(`Model consistency is below reliability threshold (${modelConsistencyScore}% < 72%).`);
  }
  if (!sustainedReliability && demandStatus === "Watch") {
    reliabilityReasons.push(`Recent reliability needs at least 3 stable days in the last 4 (${reliabilityStableDays}/${reliabilityWindow.length || 4}).`);
  }
  if (demandStatus === "Action Needed" && demandStatusReason) {
    reliabilityReasons.push(demandStatusReason);
  }
  const reliabilityGateReason = reliabilityReasons.join(" ");
  const combinedForecastWarning = [forecastQualityWarning, reliabilityGateReason]
    .filter((x) => Boolean(x && String(x).trim()))
    .join(" ");

  const narrative = skipAiNarrative
    ? buildFallbackNarrative(qwenInput)
    : await buildNarrativeWithQwen(qwenInput);

  return {
    title: "Intelligence Summary Report",
    generatedAt: nowIso,
    lastIngestionAt,
    cacheTtlSeconds: Math.round(INTELLIGENCE_DOC_CACHE_TTL_MS / 1000),
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
      insightConfidence: insightConfidenceValue,
      insightConfidenceEstimated,
      predictiveConfidence,
      dataFreshness: dataFreshnessScore,
      dataCompletenessPct,
      missingIntervalsCount,
      forecastQualityWarning: combinedForecastWarning,
      forecastReliable,
      forecastReliabilityLabel,
      forecastReliabilityStableDays: reliabilityStableDays,
      forecastReliabilityWindowDays: reliabilityWindow.length,
      reliabilityGateReason,
      confidenceBreakdown,
      demandBacktest: Math.round(demandAccuracyScore),
      demandBacktestReady,
      demandBacktestSamples: demandAccuracyTrend.length,
      demandBacktestMinSamples: MIN_DEMAND_BACKTEST_SAMPLES,
      demandHitRate: Math.round(demandHitRatePct),
      demandHitRate10: Math.round(demandHitRateStrictPct),
      demandHitRateDelta,
      demandMape: Math.round(demandMapePct * 10) / 10,
      demandMapeRaw: Math.round(demandMapeRawPct * 10) / 10,
      demandHitRate30: Math.round(demandHitRate30Pct),
      demandMape30: Math.round(demandMape30Pct * 10) / 10,
      demandMapeDelta,
      demandOutlierDays,
      demandBacktestSamples30,
      demandMetricNote,
      demandStatus,
      demandStatusReason,
      metricProvenance: {
        insightConfidence: insightConfidenceEstimated ? "Estimated" : "Measured",
        predictiveConfidence: "Derived",
        dataFreshness: "Derived",
        dataCompletenessPct: "Derived",
        demandBacktest: "Derived",
        demandHitRate: "Derived",
        demandMape: "Derived",
        demandHitRate30: "Derived",
        demandMape30: "Derived",
        demandHitRateDelta: "Derived",
        demandMapeDelta: "Derived",
        demandOutlierDays: "Derived",
        modelConsistency: "Derived",
        demandStatus: "Derived",
        forecastReliable: "Derived",
      },
    },
    charts: {
      productionEnergyTrend,
      demandAccuracyTrend,
    },
    machines: machineSnapshots,
  };
}

module.exports = router;



