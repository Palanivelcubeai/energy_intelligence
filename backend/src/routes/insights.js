const router = require("express").Router();
const pool = require("../db");

const severityRank = { critical: 4, warning: 3, info: 2, success: 1 };

// Small in-memory cache to avoid regenerating AI insights on every page refresh.
const insightsCache = new Map();
const inflightInsights = new Map();
let feedbackTableReady = false;
let insightsTableReady = false;

function getCacheTtlMs() {
  return Math.max(5000, toNum(process.env.INSIGHTS_CACHE_TTL_MS, 45000));
}

function getMaxWaitMs() {
  return Math.max(8000, toNum(process.env.INSIGHTS_MAX_WAIT_MS, 15000));
}

function getHttpTimeoutMs() {
  return Math.max(10000, toNum(process.env.INSIGHTS_HTTP_TIMEOUT_MS, 22000));
}

function toNum(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeFreshnessScore(lastSeenAt) {
  if (!lastSeenAt) return 40;
  const ts = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(ts)) return 40;
  const minutesOld = Math.max(0, (Date.now() - ts) / 60000);
  return clamp(Math.round(100 - minutesOld * 1.5), 40, 99);
}

function computeDataQualityScore(machineNow) {
  if (!machineNow) return 55;

  const checks = [
    machineNow.avg_efficiency,
    machineNow.avg_pf,
    machineNow.avg_heat,
    machineNow.parts_today,
    machineNow.kwh_today,
    machineNow.reject_rate_pct,
  ];

  let valid = 0;
  checks.forEach((v) => {
    if (Number.isFinite(toNum(v, Number.NaN))) valid += 1;
  });

  const completeness = checks.length > 0 ? (valid / checks.length) * 100 : 0;
  const noProductionPenalty = toNum(machineNow.parts_today, 0) <= 0 ? 10 : 0;
  const noEnergyPenalty = toNum(machineNow.kwh_today, 0) <= 0 ? 8 : 0;

  return clamp(Math.round(completeness - noProductionPenalty - noEnergyPenalty), 35, 99);
}

function computeConsistencyScore(insight, machineNow, baseline) {
  let score = 65;
  const causeTag = inferCauseTag(insight?.message || "");

  if (hasNumericEvidence(insight)) score += 8;

  if (!machineNow) return clamp(score, 40, 98);

  const eff = toNum(machineNow.avg_efficiency, 0);
  const pf = toNum(machineNow.avg_pf, 0);
  const rejectRate = toNum(machineNow.reject_rate_pct, 0);
  const heat = toNum(machineNow.avg_heat, 0);
  const heatThreshold = toNum(machineNow.heat_threshold_c, 85);
  const epp = toNum(machineNow.energy_per_part, 0);
  const baselineEpp = toNum(baseline?.baseline_energy_per_part, 0);

  if (causeTag === "reject_rate") {
    if (rejectRate >= 7) score += 18;
    else score -= 10;
  } else if (causeTag === "efficiency") {
    if (eff <= 80) score += 14;
    else score -= 8;
  } else if (causeTag === "power_factor") {
    if (pf < 0.9) score += 14;
    else score -= 8;
  } else if (causeTag === "heat") {
    if (heat >= heatThreshold - 2) score += 14;
    else score -= 8;
  } else if (causeTag === "energy") {
    if (baselineEpp > 0 && epp > baselineEpp * 1.1) score += 14;
    else if (epp > 0.25) score += 8;
    else score -= 6;
  }

  return clamp(Math.round(score), 40, 98);
}

function computeOutcomeScore(feedbackAcceptedRate) {
  if (!Number.isFinite(toNum(feedbackAcceptedRate, Number.NaN))) return 70;
  return clamp(Math.round(toNum(feedbackAcceptedRate, 70)), 45, 98);
}

function calculateInsightConfidence(insight, machineNow, baseline, feedbackAcceptedRate) {
  const dataQuality = computeDataQualityScore(machineNow);
  const freshness = computeFreshnessScore(machineNow?.last_seen_at);
  const consistency = computeConsistencyScore(insight, machineNow, baseline);
  const modelCertainty = clamp(Math.round(toNum(insight?.confidence, 75)), 55, 99);
  const outcome = computeOutcomeScore(feedbackAcceptedRate);

  const weighted = (0.30 * dataQuality)
    + (0.25 * freshness)
    + (0.20 * consistency)
    + (0.15 * modelCertainty)
    + (0.10 * outcome);

  return clamp(Math.round(weighted), 45, 99);
}

async function getFeedbackAcceptedRate30d() {
  try {
    await ensureInsightFeedbackTable();
    const { rows } = await pool.query(
      `SELECT COALESCE(ROUND((SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 1), 0) AS accepted_rate
       FROM insight_feedback
       WHERE created_at >= NOW() - INTERVAL '30 days'`
    );
    return toNum(rows?.[0]?.accepted_rate, 70);
  } catch {
    return 70;
  }
}

async function ensureInsightsTable() {
  if (insightsTableReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS insights (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_id VARCHAR(20),
      severity VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'critical', 'info', 'success')),
      message TEXT NOT NULL,
      financial_impact VARCHAR(255),
      production_impact TEXT,
      confidence_pct INT CHECK (confidence_pct BETWEEN 0 AND 100),
      suggested_action TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_insights_created_at ON insights (created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_insights_severity_time ON insights (severity, created_at DESC)");

  insightsTableReady = true;
}

async function persistInsightsBatch(insights) {
  const items = Array.isArray(insights) ? insights : [];
  if (items.length === 0) return;

  try {
    await ensureInsightsTable();
    await Promise.all(items.map((item) => {
      const machineId = item.machine == null ? null : String(item.machine);
      const severity = ["critical", "warning", "info", "success"].includes(item.severity) ? item.severity : "info";
      const confidence = clamp(Math.round(toNum(item.confidence, 75)), 0, 100);
      return pool.query(
        `INSERT INTO insights (machine_id, severity, message, financial_impact, production_impact, confidence_pct, suggested_action)
         SELECT $1::varchar, $2::varchar, $3::text, $4::varchar, $5::text, $6::int, $7::text
         WHERE NOT EXISTS (
           SELECT 1
           FROM insights
           WHERE machine_id IS NOT DISTINCT FROM $1::varchar
             AND message = $3::text
             AND created_at >= NOW() - INTERVAL '6 hours'
         )`,
        [
          machineId,
          severity,
          String(item.message || '').trim(),
          String(item.financial_impact || '').trim(),
          String(item.production_impact || '').trim(),
          confidence,
          String(item.suggested_action || '').trim(),
        ]
      );
    }));
  } catch (err) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) {
      console.warn("persistInsightsBatch warning:", err.message || err);
    }
  }
}

async function ensureInsightFeedbackTable() {
  if (feedbackTableReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS insight_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      insight_key VARCHAR(255) NOT NULL,
      machine_id VARCHAR(20),
      vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
      user_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (insight_key, user_email)
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_insight_feedback_time ON insight_feedback (created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_insight_feedback_key ON insight_feedback (insight_key)");

  feedbackTableReady = true;
}

function getInsightsNumPredict() {
  return Math.max(90, Math.min(220, Math.round(toNum(process.env.INSIGHTS_NUM_PREDICT, 120))));
}

function getInsightModels() {
  const fallbackModel = process.env.OLLAMA_MODEL || "qwen2.5:7b";
  return {
    fast: process.env.OLLAMA_FAST_MODEL || fallbackModel,
    quality: process.env.OLLAMA_QUALITY_MODEL || fallbackModel,
    runtimeFallback: process.env.OLLAMA_RUNTIME_FALLBACK_MODEL || "qwen2.5:3b",
  };
}

function extractMachineIdFromText(text, knownMachineIds) {
  if (typeof text !== "string") return null;
  const match = text.match(/\bCNC-\d+\b/i);
  if (!match) return null;
  const machineId = match[0].toUpperCase();
  return knownMachineIds.has(machineId) ? machineId : null;
}

function normalizeMessageForDedup(text) {
  if (typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/cnc-\d+/g, "cnc")
    .replace(/[0-9]+(?:\.[0-9]+)?/g, "#")
    .replace(/[^a-z#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDisplayText(text, fallback = "") {
  const raw = String(text || "").trim();
  if (!raw) return fallback;

  const singleLine = raw
    .replace(/```(?:json)?/gi, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (singleLine.startsWith("{") || singleLine.startsWith("[")) {
    const noPunct = singleLine
      .replace(/[{}\[\]"]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (noPunct && !/^(insights?|severity|message|financial_impact|production_impact)$/i.test(noPunct)) {
      return noPunct.slice(0, 180);
    }
  }

  return singleLine.slice(0, 220);
}

function parseMalformedInsightContent(content, knownMachineIds) {
  const text = String(content || "");
  if (!text.trim()) return null;

  const getStringField = (field) => {
    const regex = new RegExp(`"${field}"\\s*:\\s*"([^"\\n\\r]+)`, "i");
    const match = text.match(regex);
    return match?.[1]?.trim() || null;
  };

  const severityRaw = getStringField("severity");
  const messageRaw = getStringField("message");
  const financialRaw = getStringField("financial_impact") || getStringField("financial impact");
  const productionRaw = getStringField("production_impact") || getStringField("production impact");
  const actionRaw = getStringField("suggested_action") || getStringField("action");

  const machine =
    extractMachineIdFromText(messageRaw || "", knownMachineIds) ||
    extractMachineIdFromText(text, knownMachineIds);

  if (!messageRaw && !machine) {
    return null;
  }

  return {
    severity: severityRaw || "warning",
    message: cleanDisplayText(messageRaw || `Potential issue detected${machine ? ` on ${machine}` : ""}.`, "Potential issue detected from AI output."),
    financial_impact: cleanDisplayText(financialRaw || "Potential cost impact requires verification", "Potential cost impact requires verification"),
    production_impact: cleanDisplayText(productionRaw || "Potential production impact requires verification", "Potential production impact requires verification"),
    confidence: 72,
    suggested_action: cleanDisplayText(actionRaw || "Review machine metrics and validate this AI finding", "Review machine metrics and validate this AI finding"),
    machine,
  };
}

function inferCauseTag(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("reject")) return "reject_rate";
  if (t.includes("efficien")) return "efficiency";
  if (t.includes("heat") || t.includes("temperature")) return "heat";
  if (t.includes("power factor") || t.includes("pf")) return "power_factor";
  if (t.includes("energy") || t.includes("kwh") || t.includes("per part")) return "energy";
  if (t.includes("vibration")) return "vibration";
  return "general";
}

function buildPreventiveAction(causeTag, machine) {
  const target = machine || "affected machines";
  if (causeTag === "reject_rate") return `Schedule weekly quality audit for ${target}`;
  if (causeTag === "efficiency") return `Track OEE drift daily on ${target}`;
  if (causeTag === "heat") return `Increase preventive cooling checks for ${target}`;
  if (causeTag === "power_factor") return `Plan monthly PF correction review for ${target}`;
  if (causeTag === "energy") return `Benchmark kWh per part weekly for ${target}`;
  if (causeTag === "vibration") return `Add vibration trend checks each shift for ${target}`;
  return `Review maintenance baseline weekly for ${target}`;
}

function buildImmediateAction(causeTag, machine, current) {
  const target = machine || "target machine";
  const rejectRate = Math.round(toNum(current?.reject_rate_pct, 0) * 10) / 10;
  const efficiency = Math.round(toNum(current?.avg_efficiency, 0));
  const heat = Math.round(toNum(current?.avg_heat, 0) * 10) / 10;
  const heatThreshold = Math.round(toNum(current?.heat_threshold_c, 85) * 10) / 10;
  const pf = Math.round(toNum(current?.avg_pf, 0) * 100) / 100;
  const epp = Math.round(toNum(current?.energy_per_part, 0) * 1000) / 1000;
  const vibration = Math.round(toNum(current?.avg_vibration, 0) * 100) / 100;
  const formatPct = (value) => {
    const rounded = Math.round(toNum(value, 0) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  if (causeTag === "reject_rate") {
    const rejectGate = Math.max(6, Math.round((rejectRate - 2) * 10) / 10);
    return `Run first-piece check on ${target}; change tool if reject stays >${formatPct(rejectGate)}% this shift`;
  }

  if (causeTag === "efficiency") {
    return `Check spindle load/feed override on ${target}; recover efficiency above ${Math.max(72, efficiency + 4)}% today`;
  }

  if (causeTag === "heat") {
    return `Inspect coolant flow/fans on ${target}; reduce heat from ${heat}C to <${heatThreshold}C within 30 min`;
  }

  if (causeTag === "power_factor") {
    return `Check capacitor/PFC on ${target}; raise power factor from ${pf} to >=0.90 this shift`;
  }

  if (causeTag === "energy") {
    return `Audit idle/runtime on ${target}; reduce kWh/part from ${epp} by at least 8% this week`;
  }

  if (causeTag === "vibration") {
    return `Inspect bearing/alignment on ${target}; bring vibration from ${vibration} mm/s to baseline today`;
  }

  return `Run 20-part trial on ${target}; verify defect and cycle-time improvement this shift`;
}

function hasNumericEvidence(insight) {
  const text = [
    insight?.message,
    insight?.financial_impact,
    insight?.production_impact,
  ].join(" ");
  return /\d/.test(String(text || ""));
}

function isCriticalSignalText(text) {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("exceed") ||
    t.includes("threshold") ||
    t.includes("below") ||
    t.includes("reject") ||
    t.includes("efficien")
  );
}

function normalizeInsight(raw, index, knownMachineIds) {
  if (!raw || typeof raw !== "object") return null;

  const machine = typeof raw.machine === "string" && knownMachineIds.has(raw.machine)
    ? raw.machine
    : extractMachineIdFromText(raw.message, knownMachineIds);

  const severityInput = String(raw.severity || "").toLowerCase();
  const severity = ["critical", "warning", "info", "success"].includes(severityInput)
    ? severityInput
    : (severityInput === "high" ? "warning" : (severityInput === "medium" ? "info" : "info"));

  const confidence = Math.max(55, Math.min(99, Math.round(toNum(raw.confidence, 78))));

  const normalizeText = (value, fallback) => {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (value && typeof value === "object") {
      try {
        const compact = JSON.stringify(value);
        if (compact && compact !== "{}") return compact;
      } catch {}
    }
    return fallback;
  };

  const message = cleanDisplayText(normalizeText(raw.message, "No insight message"), "No insight message");
  const financialImpact = cleanDisplayText(normalizeText(raw.financial_impact, "No major financial impact detected"), "No major financial impact detected");
  const productionImpact = cleanDisplayText(normalizeText(raw.production_impact, "Production impact is currently limited"), "Production impact is currently limited");
  const suggestedAction = cleanDisplayText(normalizeText(raw.suggested_action || raw.action, "Continue monitoring current machine behavior."), "Continue monitoring current machine behavior.");

  return {
    id: `ai-${index + 1}-${machine || "all"}`,
    severity,
    message,
    financial_impact: financialImpact,
    production_impact: productionImpact,
    confidence,
    suggested_action: suggestedAction,
    machine,
  };
}

function buildProblemSignals(snapshot, historical) {
  const baselineByMachine = historical?.machine_baselines || {};

  return snapshot.map((m) => {
    const baseline = baselineByMachine[m.id] || {};
    const issues = [];

    const baselineEff = toNum(baseline.baseline_efficiency, 0);
    const baselineReject = toNum(baseline.baseline_reject_rate_pct, 0);
    const baselineEpp = toNum(baseline.baseline_energy_per_part, 0);

    if (m.reject_rate_pct >= 12) {
      issues.push({ code: "high_reject_rate", severity: "critical", value: m.reject_rate_pct, unit: "%" });
    } else if (m.reject_rate_pct >= 7) {
      issues.push({ code: "rising_reject_rate", severity: "warning", value: m.reject_rate_pct, unit: "%" });
    }

    if (m.avg_efficiency <= 72) {
      issues.push({ code: "low_efficiency", severity: "critical", value: m.avg_efficiency, unit: "%" });
    } else if (baselineEff > 0 && m.avg_efficiency < baselineEff - 6) {
      issues.push({ code: "efficiency_drop_vs_baseline", severity: "warning", value: m.avg_efficiency, baseline: baselineEff, unit: "%" });
    }

    if (m.avg_heat >= m.heat_threshold_c) {
      issues.push({ code: "heat_over_threshold", severity: "critical", value: m.avg_heat, threshold: m.heat_threshold_c, unit: "C" });
    }

    if (m.avg_pf < 0.86) {
      issues.push({ code: "low_power_factor", severity: "warning", value: m.avg_pf });
    }

    if (baselineEpp > 0 && m.energy_per_part > baselineEpp * 1.15) {
      issues.push({ code: "energy_per_part_spike", severity: "warning", value: m.energy_per_part, baseline: baselineEpp, unit: "kWh/part" });
    }

    if (baselineReject > 0 && m.reject_rate_pct > baselineReject + 3) {
      issues.push({ code: "reject_rate_above_baseline", severity: "warning", value: m.reject_rate_pct, baseline: baselineReject, unit: "%" });
    }

    return {
      machine: m.id,
      issues,
      issue_count: issues.length,
    };
  });
}

function buildSignalBackfillInsights(problemSignals, snapshotByMachine) {
  const rows = Array.isArray(problemSignals) ? problemSignals : [];
  const backfill = [];

  for (const row of rows) {
    if (!row || !row.machine || !Array.isArray(row.issues) || row.issues.length === 0) continue;
    const topIssue = row.issues[0];
    const machineNow = snapshotByMachine.get(row.machine) || null;

    const metricValue = typeof topIssue.value === "number" ? topIssue.value : toNum(topIssue.value, 0);
    const metric = topIssue.unit ? `${Math.round(metricValue * 10) / 10}${topIssue.unit}` : `${Math.round(metricValue * 100) / 100}`;
    const baseline = typeof topIssue.baseline === "number" ? Math.round(topIssue.baseline * 10) / 10 : null;

    const message = baseline !== null
      ? `${row.machine} ${String(topIssue.code || "issue").replace(/_/g, " ")} ${metric} vs baseline ${baseline}`
      : `${row.machine} ${String(topIssue.code || "issue").replace(/_/g, " ")} at ${metric}`;

    const causeTag = inferCauseTag(message);
    const immediateAction = buildImmediateAction(causeTag, row.machine, machineNow) || `Inspect ${row.machine} process conditions`;
    const preventiveAction = buildPreventiveAction(causeTag, row.machine);

    backfill.push({
      severity: topIssue.severity === "critical" ? "critical" : "warning",
      message,
      financial_impact: "Elevated operational cost risk if unresolved",
      production_impact: "Potential throughput and quality degradation",
      confidence: topIssue.severity === "critical" ? 90 : 82,
      suggested_action: immediateAction,
      suggested_actions: [immediateAction, preventiveAction],
      machine: row.machine,
    });
  }

  return backfill;
}

function buildSnapshotBackfillInsights(snapshot) {
  const rows = Array.isArray(snapshot) ? snapshot.slice() : [];
  if (rows.length === 0) return [];

  const highestEnergy = rows.slice().sort((a, b) => toNum(b.kwh_today, 0) - toNum(a.kwh_today, 0))[0];
  const lowestEfficiency = rows.slice().sort((a, b) => toNum(a.avg_efficiency, 0) - toNum(b.avg_efficiency, 0))[0];
  const highestReject = rows.slice().sort((a, b) => toNum(b.reject_rate_pct, 0) - toNum(a.reject_rate_pct, 0))[0];

  const candidates = [];

  if (highestEnergy?.id) {
    candidates.push({
      severity: "warning",
      message: `${highestEnergy.id} highest energy use at ${Math.round(toNum(highestEnergy.kwh_today, 0) * 100) / 100} kWh today`,
      financial_impact: "Higher energy cost per shift",
      production_impact: "Inefficient load profile may affect output economics",
      confidence: 78,
      suggested_action: buildImmediateAction("energy", highestEnergy.id, highestEnergy) || `Audit idle/load profile on ${highestEnergy.id}`,
      suggested_actions: [
        buildImmediateAction("energy", highestEnergy.id, highestEnergy) || `Audit idle/load profile on ${highestEnergy.id}`,
        buildPreventiveAction("energy", highestEnergy.id),
      ],
      machine: highestEnergy.id,
    });
  }

  if (lowestEfficiency?.id) {
    candidates.push({
      severity: "warning",
      message: `${lowestEfficiency.id} lowest efficiency at ${Math.round(toNum(lowestEfficiency.avg_efficiency, 0) * 10) / 10}% today`,
      financial_impact: "Raised cost per accepted part",
      production_impact: "Lower effective throughput",
      confidence: 80,
      suggested_action: buildImmediateAction("efficiency", lowestEfficiency.id, lowestEfficiency) || `Recover cycle efficiency on ${lowestEfficiency.id}`,
      suggested_actions: [
        buildImmediateAction("efficiency", lowestEfficiency.id, lowestEfficiency) || `Recover cycle efficiency on ${lowestEfficiency.id}`,
        buildPreventiveAction("efficiency", lowestEfficiency.id),
      ],
      machine: lowestEfficiency.id,
    });
  }

  if (highestReject?.id) {
    candidates.push({
      severity: "warning",
      message: `${highestReject.id} reject rate ${Math.round(toNum(highestReject.reject_rate_pct, 0) * 10) / 10}% today`,
      financial_impact: "Scrap and rework costs increase",
      production_impact: "Lower net accepted output",
      confidence: 81,
      suggested_action: buildImmediateAction("reject", highestReject.id, highestReject) || `Reduce reject causes on ${highestReject.id}`,
      suggested_actions: [
        buildImmediateAction("reject", highestReject.id, highestReject) || `Reduce reject causes on ${highestReject.id}`,
        buildPreventiveAction("reject", highestReject.id),
      ],
      machine: highestReject.id,
    });
  }

  return candidates;
}

function topUpInsightsWithSnapshot(baseInsights, snapshot, targetCount) {
  const working = Array.isArray(baseInsights) ? [...baseInsights] : [];
  const needed = Math.max(1, Number.parseInt(targetCount, 10) || 1);
  if (working.length >= needed) return working.slice(0, needed);

  const existingKeys = new Set(
    working.map((x) => `${x.machine || "all"}::${inferCauseTag(x.message || "")}`)
  );

  const snapshotBackfill = buildSnapshotBackfillInsights(snapshot);
  for (const candidate of snapshotBackfill) {
    if (working.length >= needed) break;
    const key = `${candidate.machine || "all"}::${inferCauseTag(candidate.message || "")}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    working.push(candidate);
  }

  return working.slice(0, needed);
}

function extractJsonArray(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();

  function arrayFromParsed(parsedValue) {
    if (Array.isArray(parsedValue)) return parsedValue;

    if (parsedValue && typeof parsedValue === "object") {
      if (Array.isArray(parsedValue.insights)) return parsedValue.insights;
      if (parsedValue.insights && typeof parsedValue.insights === "object") return [parsedValue.insights];
      if (typeof parsedValue.insights === "string") {
        try {
          const reparsedInsights = JSON.parse(parsedValue.insights);
          if (Array.isArray(reparsedInsights)) return reparsedInsights;
          if (reparsedInsights && typeof reparsedInsights === "object") return [reparsedInsights];
        } catch {}
      }

      if (parsedValue.data && Array.isArray(parsedValue.data.insights)) return parsedValue.data.insights;
      if (Array.isArray(parsedValue.recommendations)) return parsedValue.recommendations;
      if (Array.isArray(parsedValue.items)) return parsedValue.items;
      if (Array.isArray(parsedValue.results)) return parsedValue.results;

      const looksLikeInsight =
        typeof parsedValue.message === "string" &&
        (typeof parsedValue.suggested_action === "string" || typeof parsedValue.action === "string");
      if (looksLikeInsight) return [parsedValue];

      for (const value of Object.values(parsedValue)) {
        if (Array.isArray(value)) return value;
      }
    }

    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      try {
        const reparsed = JSON.parse(parsed);
        const arr = arrayFromParsed(reparsed);
        if (arr) return arr;
      } catch {}
    }

    const arr = arrayFromParsed(parsed);
    if (arr) return arr;
  } catch {}

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeFenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(codeFenceMatch[1]);
      if (typeof parsed === "string") {
        try {
          const reparsed = JSON.parse(parsed);
          const arr = arrayFromParsed(reparsed);
          if (arr) return arr;
        } catch {}
      }

      const arr = arrayFromParsed(parsed);
      if (arr) return arr;
    } catch {}
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try {
      const parsed = JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
      const arr = arrayFromParsed(parsed);
      if (arr) return arr;
    } catch {}
  }

  // Last-resort recovery for truncated JSON arrays: extract fully closed objects.
  if (firstBracket >= 0) {
    const tail = trimmed.slice(firstBracket + 1);
    const recovered = [];
    let depth = 0;
    let inString = false;
    let escape = false;
    let objStart = -1;

    for (let i = 0; i < tail.length; i += 1) {
      const ch = tail[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === "\\") {
        escape = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === "{") {
        if (depth === 0) objStart = i;
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0 && objStart >= 0) {
          const candidate = tail.slice(objStart, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object") recovered.push(parsed);
          } catch {}
          objStart = -1;
        }
      }
    }

    if (recovered.length > 0) return recovered;
  }

  return null;
}

async function getPlantSnapshot() {
  const { rows } = await pool.query(
    `SELECT
       m.id,
       m.name,
       m.status,
       COALESCE(m.heat_threshold_c, 85) AS heat_threshold_c,
       COALESCE(ROUND(AVG(mm.efficiency_score))::int, 0) AS avg_efficiency,
       COALESCE(ROUND(AVG(mm.power_factor)::numeric, 2), 0) AS avg_pf,
       COALESCE(ROUND(AVG(mm.machine_heat_c)::numeric, 1), 0) AS avg_heat,
       COALESCE(ROUND(AVG(mm.machine_vibration_mm_s)::numeric, 2), 0) AS avg_vibration,
       COALESCE(MAX(mm.kwh), 0) AS kwh_today,
       COALESCE(MAX(mm.parts_produced), 0) AS parts_today,
       COALESCE(MAX(mm.rejection_count), 0) AS rejects_today,
       MAX(mm.recorded_at) AS last_seen_at
     FROM machines m
     LEFT JOIN machine_metrics mm
       ON mm.machine_id = m.id
      AND mm.recorded_at::date = CURRENT_DATE
     GROUP BY m.id, m.name, m.status, m.heat_threshold_c
     ORDER BY m.id`
  );

  return rows.map((r) => {
    const kwhToday = toNum(r.kwh_today, 0);
    const partsToday = toNum(r.parts_today, 0);
    const rejects = toNum(r.rejects_today, 0);
    const rejectRatePct = partsToday > 0 ? Math.round((rejects / partsToday) * 1000) / 10 : 0;

    return {
      id: r.id,
      name: r.name,
      status: r.status,
      avg_efficiency: toNum(r.avg_efficiency, 0),
      avg_pf: toNum(r.avg_pf, 0),
      avg_heat: toNum(r.avg_heat, 0),
      heat_threshold_c: toNum(r.heat_threshold_c, 85),
      avg_vibration: toNum(r.avg_vibration, 0),
      kwh_today: kwhToday,
      parts_today: partsToday,
      energy_per_part: partsToday > 0 ? Math.round((kwhToday / partsToday) * 1000) / 1000 : 0,
      rejects_today: rejects,
      reject_rate_pct: rejectRatePct,
      last_seen_at: r.last_seen_at,
    };
  });
}

async function getHistoricalContext(lookbackDays = 14) {
  const safeDays = Math.max(3, Math.min(60, Number.parseInt(String(lookbackDays), 10) || 14));

  const [machineBaselineResult, recentDailyResult] = await Promise.all([
    pool.query(
      `SELECT
         mm.machine_id,
         COALESCE(ROUND(AVG(mm.efficiency_score)::numeric, 1), 0) AS baseline_efficiency,
         COALESCE(ROUND(AVG(mm.power_factor)::numeric, 2), 0) AS baseline_pf,
         COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY mm.machine_heat_c)::numeric, 1), 0) AS heat_p95,
         COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY mm.machine_vibration_mm_s)::numeric, 2), 0) AS vibration_p95,
         COALESCE(SUM(mm.kwh), 0) AS total_kwh,
         COALESCE(SUM(mm.parts_produced), 0) AS total_parts,
         COALESCE(SUM(mm.rejection_count), 0) AS total_rejects
       FROM machine_metrics mm
       WHERE mm.recorded_at >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
         AND mm.recorded_at < CURRENT_DATE
       GROUP BY mm.machine_id`,
      [safeDays]
    ),
    pool.query(
      `SELECT
         mm.recorded_at::date AS day,
         COALESCE(ROUND(SUM(mm.kwh)::numeric, 1), 0) AS plant_kwh,
         COALESCE(SUM(mm.parts_produced), 0) AS plant_parts,
         COALESCE(SUM(mm.rejection_count), 0) AS plant_rejects,
         COALESCE(ROUND(AVG(mm.efficiency_score)::numeric, 1), 0) AS avg_efficiency,
         COALESCE(ROUND(AVG(mm.power_factor)::numeric, 2), 0) AS avg_pf
       FROM machine_metrics mm
       WHERE mm.recorded_at >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
       GROUP BY mm.recorded_at::date
       ORDER BY day DESC
       LIMIT 7`,
      [safeDays]
    ),
  ]);

  const machineBaselines = Object.fromEntries(
    machineBaselineResult.rows.map((row) => {
      const parts = toNum(row.total_parts, 0);
      const rejects = toNum(row.total_rejects, 0);
      const kwh = toNum(row.total_kwh, 0);

      return [
        row.machine_id,
        {
          baseline_efficiency: toNum(row.baseline_efficiency, 0),
          baseline_pf: toNum(row.baseline_pf, 0),
          heat_p95: toNum(row.heat_p95, 0),
          vibration_p95: toNum(row.vibration_p95, 0),
          baseline_energy_per_part: parts > 0 ? Math.round((kwh / parts) * 1000) / 1000 : 0,
          baseline_reject_rate_pct: parts > 0 ? Math.round((rejects / parts) * 1000) / 10 : 0,
        },
      ];
    })
  );

  const recentDaily = recentDailyResult.rows.map((row) => {
    const parts = toNum(row.plant_parts, 0);
    const rejects = toNum(row.plant_rejects, 0);
    return {
      day: row.day,
      plant_kwh: toNum(row.plant_kwh, 0),
      plant_parts: parts,
      avg_efficiency: toNum(row.avg_efficiency, 0),
      avg_pf: toNum(row.avg_pf, 0),
      reject_rate_pct: parts > 0 ? Math.round((rejects / parts) * 1000) / 10 : 0,
    };
  });

  return {
    lookback_days: safeDays,
    machine_baselines: machineBaselines,
    recent_daily: recentDaily,
  };
}

async function generateLlamaInsights(limit) {
  return generateLlamaInsightsWithMode(limit, "fast");
}

function calibrateInsights(insights, snapshot, historical) {
  const snapshotByMachine = new Map(snapshot.map((m) => [m.id, m]));
  const machineBaselines = historical?.machine_baselines || {};

  const calibrated = insights.map((item) => {
    const machine = item.machine;
    if (!machine || !snapshotByMachine.has(machine)) {
      return { ...item, _score: severityRank[item.severity] * 20 + item.confidence * 0.4 };
    }

    const now = snapshotByMachine.get(machine);
    const baseline = machineBaselines[machine] || {};
    let signal = 0;

    if (toNum(now.reject_rate_pct, 0) >= 12) signal += 30;
    else if (toNum(now.reject_rate_pct, 0) >= 7) signal += 18;

    if (toNum(now.avg_efficiency, 100) <= 72) signal += 24;
    else if (toNum(now.avg_efficiency, 100) <= 80) signal += 12;

    if (toNum(now.avg_heat, 0) >= toNum(now.heat_threshold_c, 85)) signal += 20;
    else if (toNum(now.avg_heat, 0) >= toNum(now.heat_threshold_c, 85) - 3) signal += 10;

    if (toNum(now.avg_pf, 1) < 0.86) signal += 10;

    const baselineEpp = toNum(baseline.baseline_energy_per_part, 0);
    if (baselineEpp > 0 && toNum(now.energy_per_part, 0) > baselineEpp * 1.15) signal += 14;

    let nextSeverity = item.severity;
    if (signal >= 55) nextSeverity = "critical";
    else if (signal >= 35 && nextSeverity === "info") nextSeverity = "warning";
    else if (signal < 18 && nextSeverity === "critical") nextSeverity = "warning";

    return {
      ...item,
      severity: nextSeverity,
      _score: severityRank[nextSeverity] * 20 + item.confidence * 0.4 + signal,
    };
  });

  return calibrated
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...item }) => item);
}

async function generateLlamaInsightsWithMode(limit, mode = "fast", options = {}) {
  const allowPartial = Boolean(options.allowPartial);
  const lookbackDays = Math.max(3, Math.min(60, Number.parseInt(process.env.INSIGHTS_LOOKBACK_DAYS || "14", 10) || 14));
  const [snapshot, historical] = await Promise.all([
    getPlantSnapshot(),
    getHistoricalContext(lookbackDays),
  ]);

  const knownMachineIds = new Set(snapshot.map((m) => m.id));

  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const models = getInsightModels();
  const modeModel = mode === "quality" ? models.quality : models.fast;
  const modelCandidates = Array.from(new Set([modeModel, models.runtimeFallback].filter(Boolean)));
  const fastTimeout = Math.max(6000, toNum(process.env.INSIGHTS_FAST_TIMEOUT_MS, 12000));
  const ollamaTimeoutMs = fastTimeout;

  const compactSnapshot = snapshot.map((m) => ({
    ...(historical.machine_baselines[m.id] || {}),
    id: m.id,
    status: m.status,
    efficiency: m.avg_efficiency,
    pf: m.avg_pf,
    heat: m.avg_heat,
    heat_threshold: m.heat_threshold_c,
    vibration: m.avg_vibration,
    kwh: m.kwh_today,
    parts: m.parts_today,
    rejects: m.rejects_today,
    reject_rate: m.reject_rate_pct,
    epp: m.energy_per_part,
  }));

  const problemSignals = buildProblemSignals(snapshot, historical)
    .filter((x) => x.issue_count > 0)
    .sort((a, b) => b.issue_count - a.issue_count);

  const configuredMinInsights = Math.max(1, Math.min(4, Number.parseInt(process.env.INSIGHTS_MIN_COUNT || "2", 10) || 2));
  const signalMachineCount = Math.max(1, problemSignals.length);
  const minInsights = Math.max(1, Math.min(configuredMinInsights, signalMachineCount));
  const defaultReturnCount = Math.max(minInsights, Math.min(4, Number.parseInt(process.env.INSIGHTS_MAX_RETURN || "3", 10) || 3));
  const returnCount = Math.max(minInsights, Math.min(limit || defaultReturnCount, 4));
  const candidateTarget = Math.max(returnCount + 2, Math.min(8, Number.parseInt(process.env.INSIGHTS_CANDIDATE_COUNT || "6", 10) || 6));
  const confidenceFloor = Math.max(60, Math.min(95, Number.parseInt(process.env.INSIGHTS_CONFIDENCE_FLOOR || "75", 10) || 75));

  const systemPrompt = [
    "You are an industrial energy optimization analyst for CNC operations.",
    "Return ONLY valid compact JSON object; no markdown.",
    "Schema: {\"insights\":[...]}.",
    "Each insight must include these keys exactly:",
    "severity, message, financial_impact, production_impact, confidence, suggested_action, machine",
    "severity must be one of critical, warning, info, success.",
    "confidence must be an integer between 55 and 99.",
    "machine must be CNC-1..CNC-5 or null.",
    "Use DB problem_signals first; do not invent machine faults not supported by signals.",
    "When possible, cover different machines across insights.",
    "Each message must include at least one numeric metric from snapshot or baseline.",
    "Set severity=critical only for threshold breach or severe reject/efficiency risk.",
    "Keep message and suggested_action very concise (max 8 words each).",
  ].join(" ");

  const responseFormatHint = {
    insights: [
      {
        severity: "warning",
        message: "CNC-3 reject rate 12.4% exceeds baseline 7.1%",
        financial_impact: "Higher scrap and rework energy cost",
        production_impact: "Lower effective output and throughput",
        confidence: 87,
        suggested_action: "Inspect tooling wear and alignment",
        machine: "CNC-3",
      },
    ],
  };

  const userPrompt = [
    `Plant snapshot for today with ${historical.lookback_days}-day baseline fields included per machine:`,
    JSON.stringify(compactSnapshot),
    "DB-derived problem_signals (primary evidence):",
    JSON.stringify(problemSignals),
    "Recent 7-day plant trend summary:",
    JSON.stringify({
      avg_efficiency_7d: historical.recent_daily.length
        ? Math.round((historical.recent_daily.reduce((s, d) => s + toNum(d.avg_efficiency, 0), 0) / historical.recent_daily.length) * 10) / 10
        : 0,
      avg_reject_rate_7d: historical.recent_daily.length
        ? Math.round((historical.recent_daily.reduce((s, d) => s + toNum(d.reject_rate_pct, 0), 0) / historical.recent_daily.length) * 10) / 10
        : 0,
      avg_kwh_7d: historical.recent_daily.length
        ? Math.round((historical.recent_daily.reduce((s, d) => s + toNum(d.plant_kwh, 0), 0) / historical.recent_daily.length) * 10) / 10
        : 0,
    }),
    "Required JSON output example:",
    JSON.stringify(responseFormatHint),
    `Generate ${candidateTarget} insights sorted by priority (highest risk first).`,
  ].join("\n");

  const collected = new Map();

  for (let generationAttempt = 0; generationAttempt < 3 && collected.size < candidateTarget; generationAttempt += 1) {
    let response;
    let selectedModel = modelCandidates[0];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const attemptTimeoutMs = attempt === 0 ? ollamaTimeoutMs : Math.round(ollamaTimeoutMs * 1.5);
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);

      try {
        for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
          selectedModel = modelCandidates[modelIndex];
          response = await fetch(`${ollamaUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: selectedModel,
              stream: false,
              keep_alive: process.env.OLLAMA_KEEP_ALIVE || "30m",
              format: "json",
              options: {
                temperature: 0.2,
                num_predict: getInsightsNumPredict(),
              },
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
            signal: controller.signal,
          });

          if (response.ok) {
            if (modelIndex > 0) {
              console.warn(`Primary model unavailable, using fallback model: ${selectedModel}`);
            }
            break;
          }

          const errorText = (await response.text()).toLowerCase();
          const modelMissing = response.status === 404 || errorText.includes("model") && errorText.includes("not found");
          if (!modelMissing || modelIndex === modelCandidates.length - 1) {
            throw new Error(`Ollama HTTP ${response.status}: ${errorText.slice(0, 180)}`);
          }
        }

        break;
      } catch (err) {
        const isAbort = err && (err.name === "AbortError" || String(err.message || "").toLowerCase().includes("aborted"));
        if (!isAbort || attempt === 1) throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!response || !response.ok) {
      throw new Error(`Ollama HTTP ${response?.status || "unknown"}`);
    }

    const payload = await response.json();
    const content = payload?.message?.content || "";
    const parsed = extractJsonArray(content);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn(`Ollama raw content (model=${selectedModel}, trimmed):`, String(content).slice(0, 500));
      continue;
    }

    const normalized = parsed
      .map((item, i) => normalizeInsight(item, i, knownMachineIds))
      .filter(Boolean);

    for (const insight of normalized) {
      const strictMode = !allowPartial;
      if (strictMode && !hasNumericEvidence(insight)) continue;
      const criticalWithoutSignal = insight.severity === "critical" && !isCriticalSignalText(insight.message);
      if (strictMode && criticalWithoutSignal) continue;
      if (strictMode && insight.confidence < confidenceFloor && insight.severity !== "critical") continue;

      const causeTag = inferCauseTag(insight.message);
      const key = `${insight.machine || "all"}::${causeTag}`;
      if (!collected.has(key)) {
        collected.set(key, insight);
      }
    }
  }

  const mergedInsights = Array.from(collected.values());
  if (mergedInsights.length < minInsights && !allowPartial) {
    throw new Error(`Insufficient AI insights generated (${mergedInsights.length}/${minInsights})`);
  }

  if (mergedInsights.length < returnCount) {
    const snapshotByMachine = new Map(snapshot.map((m) => [m.id, m]));
    const existingKeys = new Set(
      mergedInsights.map((x) => `${x.machine || "all"}::${inferCauseTag(x.message)}`)
    );

    const signalBackfill = buildSignalBackfillInsights(problemSignals, snapshotByMachine);
    const snapshotBackfill = buildSnapshotBackfillInsights(snapshot);

    for (const candidate of [...signalBackfill, ...snapshotBackfill]) {
      if (mergedInsights.length >= returnCount) break;
      const key = `${candidate.machine || "all"}::${inferCauseTag(candidate.message)}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      mergedInsights.push(candidate);
    }
  }

  if (mergedInsights.length === 0) {
    throw new Error("Insufficient AI insights generated (0)");
  }

  const calibrated = calibrateInsights(mergedInsights, snapshot, historical)
    .map((item, index) => ({
      ...item,
      id: `ai-${index + 1}-${item.machine || "all"}`,
    }));

  // Remove near-duplicate insights that differ only by minor wording/values.
  const deduped = [];
  const seenSignatures = new Set();
  for (const item of calibrated) {
    const signature = `${item.machine || "all"}::${inferCauseTag(item.message)}::${normalizeMessageForDedup(item.suggested_action)}`;
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    deduped.push(item);
  }

  // Prioritize one insight per machine first, then append remaining insights.
  const prioritized = [];
  const machineSeen = new Set();
  const leftovers = [];

  for (const item of deduped) {
    if (item.machine && !machineSeen.has(item.machine)) {
      machineSeen.add(item.machine);
      prioritized.push(item);
    } else {
      leftovers.push(item);
    }
  }

  const snapshotByMachine = new Map(snapshot.map((m) => [m.id, m]));
  const feedbackAcceptedRate = await getFeedbackAcceptedRate30d();
  const baselinesByMachine = historical?.machine_baselines || {};

  const finalInsights = [...prioritized, ...leftovers]
    .map((item, index) => {
      const causeTag = inferCauseTag(item.message);
      const machineNow = item.machine ? snapshotByMachine.get(item.machine) : null;
      const baseline = item.machine ? (baselinesByMachine[item.machine] || null) : null;
      const immediateAction = buildImmediateAction(causeTag, item.machine, machineNow) || item.suggested_action;
      const preventiveAction = buildPreventiveAction(causeTag, item.machine);
      const confidence = calculateInsightConfidence(item, machineNow, baseline, feedbackAcceptedRate);
      return {
        ...item,
        id: `ai-${index + 1}-${item.machine || "all"}`,
        confidence,
        suggested_action: immediateAction,
        suggested_actions: [immediateAction, preventiveAction],
      };
    });

  return finalInsights.slice(0, returnCount);
}

async function generateSimpleAiInsights(limit = 2) {
  const snapshot = await getPlantSnapshot();
  const feedbackAcceptedRate = await getFeedbackAcceptedRate30d();
  const knownMachineIds = new Set(snapshot.map((m) => m.id));
  const models = getInsightModels();
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const modelCandidates = Array.from(new Set([models.fast, models.runtimeFallback].filter(Boolean)));
  const targetCount = Math.max(1, Math.min(limit || 2, 3));

  const systemPrompt = [
    "You are an industrial analyst.",
    "Return ONLY valid JSON object with schema: {\"insights\":[...]}.",
    "Each insight keys: severity,message,financial_impact,production_impact,confidence,suggested_action,machine.",
    "Use machine values from the provided snapshot.",
    "Keep responses concise and metric-based.",
  ].join(" ");

  const userPrompt = [
    `Snapshot: ${JSON.stringify(snapshot)}`,
    `Generate ${targetCount} actionable insights sorted by risk.`,
  ].join("\n");

  const timeoutMs = Math.max(8000, toNum(process.env.INSIGHTS_FAST_TIMEOUT_MS, 12000));

  for (const model of modelCandidates) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;

      try {
        response = await fetch(`${ollamaUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            format: "json",
            options: {
              temperature: 0.2,
              num_predict: getInsightsNumPredict(),
            },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
          signal: controller.signal,
        });
      } catch (err) {
        const isAbort = err && (err.name === "AbortError" || String(err.message || "").toLowerCase().includes("aborted"));
        if (isAbort) {
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      const content = String(payload?.message?.content || "").trim();
      const parsed = extractJsonArray(content);

      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed
          .map((item, index) => normalizeInsight(item, index, knownMachineIds))
          .filter(Boolean)
          .map((item, index) => ({
            ...item,
            id: `ai-${index + 1}-${item.machine || "all"}`,
          }));

        const toppedUp = topUpInsightsWithSnapshot(normalized, snapshot, targetCount)
          .map((item, index) => ({
            ...item,
            id: `ai-${index + 1}-${item.machine || "all"}`,
          }))
          .map((item) => {
            const machineNow = item.machine ? snapshot.find((m) => m.id === item.machine) : null;
            return {
              ...item,
              confidence: calculateInsightConfidence(item, machineNow, null, feedbackAcceptedRate),
            };
          });

        if (toppedUp.length > 0) return toppedUp;
      }

      // If model responded with text but invalid JSON, convert text into one AI insight.
      if (content) {
        const recoveredRaw = parseMalformedInsightContent(content, knownMachineIds);
        const recovered = recoveredRaw
          ? normalizeInsight(recoveredRaw, 0, knownMachineIds)
          : null;

        const inferredMachine = extractMachineIdFromText(content, knownMachineIds);
        const single = recovered
          ? [recovered]
          : [
              {
                id: `ai-1-${inferredMachine || "all"}`,
                severity: "warning",
                message: cleanDisplayText(content, "Potential issue detected from AI output."),
                financial_impact: "Potential cost impact requires verification",
                production_impact: "Potential production impact requires verification",
                confidence: 72,
                suggested_action: "Review machine metrics and validate this AI finding",
                machine: inferredMachine,
              },
            ];
        return topUpInsightsWithSnapshot(single, snapshot, targetCount)
          .map((item, index) => ({
            ...item,
            id: `ai-${index + 1}-${item.machine || "all"}`,
          }))
          .map((item) => {
            const machineNow = item.machine ? snapshot.find((m) => m.id === item.machine) : null;
            return {
              ...item,
              confidence: calculateInsightConfidence(item, machineNow, null, feedbackAcceptedRate),
            };
          });
      }
  }

  throw new Error("No AI insights parsed from simple fallback");
}

function refreshAiCache(cacheKey, limit, mode = "quality", options = {}) {
  const allowPartial = Boolean(options.allowPartial);
  const inflightKey = `${cacheKey}::${mode}::${allowPartial ? "partial" : "strict"}`;

  const existing = inflightInsights.get(inflightKey);
  if (existing) return existing;

  const refreshPromise = (async () => {
    const ai = await generateLlamaInsightsWithMode(limit, mode, options);
    await persistInsightsBatch(ai);
    insightsCache.set(cacheKey, { data: ai, createdAt: Date.now() });
    return ai;
  })().finally(() => {
    inflightInsights.delete(inflightKey);
  });

  inflightInsights.set(inflightKey, refreshPromise);
  return refreshPromise;
}

function startAiPrewarmLoop() {
  const runPrewarm = () => {
    refreshAiCache("all", undefined, "fast", { allowPartial: true })
      .then((allFast) => {
        insightsCache.set("4", { data: allFast.slice(0, 4), createdAt: Date.now() });
      })
      .catch((err) => {
        console.warn("AI prewarm all failed:", err.message || err);
      });
  };

  const initialDelayMs = Math.max(15000, toNum(process.env.INSIGHTS_INITIAL_PREWARM_DELAY_MS, 20000));
  setTimeout(runPrewarm, initialDelayMs);
  const intervalMs = Math.max(getCacheTtlMs(), toNum(process.env.INSIGHTS_REFRESH_MS, 60000));
  const handle = setInterval(runPrewarm, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
}

startAiPrewarmLoop();

// Rule-based fallback if local model is unavailable.
async function generateRuleBasedInsights(limit) {
  const insights = [];

  // Check for low-efficiency machines (today)
  const { rows: lowEff } = await pool.query(
    `SELECT m.id AS machine_id, m.name, ROUND(AVG(mm.efficiency_score)) AS avg_eff
     FROM machine_metrics mm JOIN machines m ON mm.machine_id = m.id
     WHERE mm.recorded_at::date = CURRENT_DATE
     GROUP BY m.id, m.name HAVING AVG(mm.efficiency_score) < 70
     ORDER BY AVG(mm.efficiency_score)`
  );
  lowEff.forEach((r) =>
    insights.push({
      id: `eff-${r.machine_id}`,
      severity: "high",
      message: `${r.name} avg efficiency is ${r.avg_eff}% today — below 70% threshold`,
      financial_impact: "Potential energy waste from inefficient operation",
      production_impact: "Reduced output and higher per-part cost",
      confidence: 85,
      suggested_action: `Inspect ${r.name} for mechanical issues or recalibrate`,
      machine: r.machine_id,
    })
  );

  // Check for high rejection rate
  const { rows: highRej } = await pool.query(
    `SELECT m.id AS machine_id, m.name, SUM(mm.rejection_count) AS total_rej, SUM(mm.parts_produced) AS total_parts
     FROM machine_metrics mm JOIN machines m ON mm.machine_id = m.id
     WHERE mm.recorded_at::date = CURRENT_DATE AND mm.parts_produced > 0
     GROUP BY m.id, m.name
     HAVING SUM(mm.rejection_count)::float / NULLIF(SUM(mm.parts_produced), 0) > 0.05`
  );
  highRej.forEach((r) => {
    const rejRate = ((r.total_rej / r.total_parts) * 100).toFixed(1);
    insights.push({
      id: `rej-${r.machine_id}`,
      severity: "medium",
      message: `${r.name} rejection rate is ${rejRate}% today`,
      financial_impact: "Wasted material and energy on rejected parts",
      production_impact: "Lower effective output",
      confidence: 80,
      suggested_action: `Check tooling condition and material quality on ${r.name}`,
      machine: r.machine_id,
    });
  });

  // Check for high energy usage machines
  const { rows: highEnergy } = await pool.query(
    `SELECT m.id AS machine_id, m.name, ROUND(SUM(mm.kwh)::numeric, 1) AS total_kwh
     FROM machine_metrics mm JOIN machines m ON mm.machine_id = m.id
     WHERE mm.recorded_at::date = CURRENT_DATE
     GROUP BY m.id, m.name
     ORDER BY SUM(mm.kwh) DESC LIMIT 1`
  );
  if (highEnergy.length > 0) {
    const r = highEnergy[0];
    insights.push({
      id: `energy-${r.machine_id}`,
      severity: "info",
      message: `${r.name} is the highest energy consumer today at ${r.total_kwh} kWh`,
      financial_impact: "Largest share of energy cost",
      production_impact: "Normal — monitor for upward trend",
      confidence: 90,
      suggested_action: "Review load profile and consider off-peak scheduling",
      machine: r.machine_id,
    });
  }

  // Check for low power factor
  const { rows: lowPF } = await pool.query(
    `SELECT m.id AS machine_id, m.name, ROUND(AVG(mm.power_factor)::numeric, 2) AS avg_pf
     FROM machine_metrics mm JOIN machines m ON mm.machine_id = m.id
     WHERE mm.recorded_at::date = CURRENT_DATE
     GROUP BY m.id, m.name HAVING AVG(mm.power_factor) < 0.85`
  );
  lowPF.forEach((r) =>
    insights.push({
      id: `pf-${r.machine_id}`,
      severity: "medium",
      message: `${r.name} avg power factor is ${r.avg_pf} — below 0.85`,
      financial_impact: "May incur utility power factor penalties",
      production_impact: "Increased apparent power demand",
      confidence: 88,
      suggested_action: "Consider capacitor bank or PFC correction",
      machine: r.machine_id,
    })
  );

  return limit ? insights.slice(0, limit) : insights;
}

async function generateInsights(limit) {
  const cacheTtlMs = getCacheTtlMs();
  const cacheKey = String(limit || "all");
  const now = Date.now();
  const maxWaitMs = getMaxWaitMs();

  const cached = insightsCache.get(cacheKey);
  if (cached && now - cached.createdAt < cacheTtlMs) {
    return cached.data;
  }

  if (cacheKey === "4") {
    const allCached = insightsCache.get("all");
    if (allCached && now - allCached.createdAt < cacheTtlMs) {
      const sliced = (allCached.data || []).slice(0, 4);
      insightsCache.set("4", { data: sliced, createdAt: allCached.createdAt });
      return sliced;
    }
  }

  // Serve stale cached AI results immediately and refresh in background.
  if (cached && now - cached.createdAt >= cacheTtlMs) {
    refreshAiCache(cacheKey, limit, "fast", { allowPartial: true }).catch((err) => {
      console.warn("AI stale refresh failed:", err.message || err);
    });

    return cached.data;
  }

  try {
    const fast = await Promise.race([
      refreshAiCache(cacheKey, limit, "fast", { allowPartial: true }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Fast AI timeout after ${maxWaitMs}ms`)), maxWaitMs);
      }),
    ]);

    return fast;
  } catch (fastErr) {
    if (cached?.data?.length) return cached.data;

    // Cold start bootstrap: do one longer AI attempt so first request can still succeed.
    const bootstrapWaitMs = Math.max(25000, toNum(process.env.INSIGHTS_COLD_START_TIMEOUT_MS, 40000));
    try {
      const bootstrap = await Promise.race([
        generateLlamaInsightsWithMode(limit, "fast"),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Cold-start AI timeout after ${bootstrapWaitMs}ms`)), bootstrapWaitMs);
        }),
      ]);

      await persistInsightsBatch(bootstrap);
      insightsCache.set(cacheKey, { data: bootstrap, createdAt: Date.now() });
      return bootstrap;
    } catch (bootstrapErr) {
      try {
        const partial = await generateLlamaInsightsWithMode(limit, "fast", { allowPartial: true });
        await persistInsightsBatch(partial);
        insightsCache.set(cacheKey, { data: partial, createdAt: Date.now() });
        return partial;
      } catch (partialErr) {
        const simpleAi = await generateSimpleAiInsights(limit || 2);
        await persistInsightsBatch(simpleAi);
        insightsCache.set(cacheKey, { data: simpleAi, createdAt: Date.now() });
        return simpleAi;
      }
    }
  }
}

async function generateInsightsFastEndpoint(limit) {
  const cacheKey = String(limit || "all");
  const cacheTtlMs = getCacheTtlMs();
  const now = Date.now();
  const cached = insightsCache.get(cacheKey);
  const configuredReturnCount = Math.max(1, Math.min(4, Math.round(toNum(process.env.INSIGHTS_MAX_RETURN, 3))));
  const targetCount = Math.max(1, Math.min(limit || configuredReturnCount, 4));

  if (cached && now - cached.createdAt < cacheTtlMs) {
    return cached.data;
  }

  const fastTimeoutMs = Math.max(10000, toNum(process.env.INSIGHTS_ENDPOINT_TIMEOUT_MS, 15000));
  try {
    const quickAi = await Promise.race([
      generateSimpleAiInsights(targetCount),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Endpoint AI timeout after ${fastTimeoutMs}ms`)), fastTimeoutMs);
      }),
    ]);

    await persistInsightsBatch(quickAi);
    insightsCache.set(cacheKey, { data: quickAi, createdAt: Date.now() });
    return quickAi;
  } catch (err) {
    if (cacheKey === "4") {
      const allCached = insightsCache.get("all");
      if (allCached?.data?.length) {
        const sliced = allCached.data.slice(0, 4);
        insightsCache.set("4", { data: sliced, createdAt: allCached.createdAt });
        return sliced;
      }
    }

    if (cached?.data?.length) return cached.data;
    throw err;
  }
}

async function runWithTimeout(taskPromise, timeoutMs, label) {
  return Promise.race([
    taskPromise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

// GET /api/insights/all
router.get("/all", async (_req, res) => {
  const fastMs = Math.max(5000, toNum(process.env.INSIGHTS_ROUTE_FAST_TIMEOUT_MS, 9000));
  const retryMs = Math.max(7000, toNum(process.env.INSIGHTS_ROUTE_RETRY_TIMEOUT_MS, 12000));
  const simpleMs = Math.max(5000, toNum(process.env.INSIGHTS_ROUTE_SIMPLE_TIMEOUT_MS, 9000));

  try {
    const insights = await runWithTimeout(generateInsightsFastEndpoint(), fastMs, "insights fast");
    res.json(insights);
  } catch (err) {
    try {
      const retryInsights = await runWithTimeout(generateInsights(), retryMs, "insights retry");
      return res.json(retryInsights);
    } catch (retryErr) {
      try {
        const simple = await runWithTimeout(generateSimpleAiInsights(4), simpleMs, "insights simple");
        await persistInsightsBatch(simple);
        return res.json(simple);
      } catch (simpleErr) {
        try {
          const ruleBased = await generateRuleBasedInsights(4);
          await persistInsightsBatch(ruleBased);
          return res.json(ruleBased);
        } catch (ruleErr) {
          console.warn("GET /insights/all fallback failed:", ruleErr?.message || simpleErr?.message || retryErr?.message || retryErr);
          return res.json([]);
        }
      }
    }
  }
});

// GET /api/insights/top — top 4 most recent
router.get("/top", async (_req, res) => {
  const fastMs = Math.max(5000, toNum(process.env.INSIGHTS_ROUTE_FAST_TIMEOUT_MS, 9000));
  const retryMs = Math.max(7000, toNum(process.env.INSIGHTS_ROUTE_RETRY_TIMEOUT_MS, 12000));
  const simpleMs = Math.max(5000, toNum(process.env.INSIGHTS_ROUTE_SIMPLE_TIMEOUT_MS, 9000));

  try {
    const insights = await runWithTimeout(generateInsightsFastEndpoint(4), fastMs, "insights top fast");
    res.json(insights);
  } catch (err) {
    try {
      const retryInsights = await runWithTimeout(generateInsights(4), retryMs, "insights top retry");
      return res.json(retryInsights);
    } catch (retryErr) {
      try {
        const simple = await runWithTimeout(generateSimpleAiInsights(4), simpleMs, "insights top simple");
        await persistInsightsBatch(simple);
        return res.json(simple);
      } catch (simpleErr) {
        try {
          const ruleBased = await generateRuleBasedInsights(4);
          await persistInsightsBatch(ruleBased);
          return res.json(ruleBased);
        } catch (ruleErr) {
          console.warn("GET /insights/top fallback failed:", ruleErr?.message || simpleErr?.message || retryErr?.message || retryErr);
          return res.json([]);
        }
      }
    }
  }
});

// POST /api/insights/feedback
router.post("/feedback", async (req, res) => {
  try {
    await ensureInsightFeedbackTable();

    const insightKey = String(req.body?.insightKey || req.body?.insight_id || "").trim();
    const machineId = req.body?.machine ? String(req.body.machine).trim() : null;
    const userEmail = req.body?.user_email ? String(req.body.user_email).trim().toLowerCase() : null;
    const voteRaw = Number.parseInt(String(req.body?.vote), 10);
    const vote = voteRaw >= 1 ? 1 : voteRaw <= -1 ? -1 : 0;

    if (!insightKey) {
      return res.status(400).json({ error: "insightKey is required" });
    }
    if (![1, -1].includes(vote)) {
      return res.status(400).json({ error: "vote must be 1 or -1" });
    }

    if (userEmail) {
      await pool.query(
        `INSERT INTO insight_feedback (insight_key, machine_id, vote, user_email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (insight_key, user_email)
         DO UPDATE SET vote = EXCLUDED.vote, machine_id = EXCLUDED.machine_id, created_at = NOW()`,
        [insightKey, machineId, vote, userEmail]
      );
    } else {
      await pool.query(
        `INSERT INTO insight_feedback (insight_key, machine_id, vote, user_email)
         VALUES ($1, $2, $3, NULL)`,
        [insightKey, machineId, vote]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("POST /insights/feedback error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/insights/feedback/summary
router.get("/feedback/summary", async (_req, res) => {
  try {
    await ensureInsightFeedbackTable();

    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_feedback,
         COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0)::int AS accepted_feedback,
         COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0)::int AS rejected_feedback,
         COALESCE(ROUND((SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 1), 0) AS accepted_rate
       FROM insight_feedback
       WHERE created_at >= NOW() - INTERVAL '30 days'`
    );

    res.json(rows[0] || {
      total_feedback: 0,
      accepted_feedback: 0,
      rejected_feedback: 0,
      accepted_rate: 0,
    });
  } catch (err) {
    console.error("GET /insights/feedback/summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
