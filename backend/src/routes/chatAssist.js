const router = require("express").Router();
const pool = require("../db");

function toNum(value, fallback = 0) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractMachineId(text) {
  const match = String(text || "").toUpperCase().match(/\bCNC[-\s]?(\d+)\b/);
  return match ? `CNC-${match[1]}` : null;
}

function hasAny(text, words) {
  return words.some((w) => text.includes(w));
}

function detectIntent(message) {
  const q = String(message || "").toLowerCase();
  const machineId = extractMachineId(message);

  const asksTop = hasAny(q, ["highest", "top", "most", "max"]);
  const asksLow = hasAny(q, ["lowest", "least", "minimum", "min", "worst"]);
  const asksAverage = hasAny(q, ["average", "avg", "mean"]);
  const asksTotal = hasAny(q, ["total", "overall", "sum", "consumption"]);

  const aboutProduction = hasAny(q, ["parts", "production", "output", "throughput"]);
  const aboutEnergy = hasAny(q, ["energy", "kwh", "power"]);
  const aboutReject = hasAny(q, ["reject", "scrap", "quality"]);
  const aboutEfficiency = hasAny(q, ["efficiency", "oee", "performance"]);
  const aboutPf = hasAny(q, ["power factor", "pf"]);
  const aboutStatus = hasAny(q, ["status", "running", "idle", "maintenance"]);
  const asksIssue = /issue|issues|problem|fault|alert|anomaly|what\s+wrong/.test(q);
  const asksHelp = hasAny(q, ["help", "what can i ask", "example", "examples"]);

  if (asksHelp) {
    return "help";
  }
  if (asksIssue && machineId) {
    return "machine_issues";
  }
  if (asksIssue) {
    return "plant_issues";
  }
  if (asksTotal && aboutProduction) {
    return "production_total";
  }
  if (asksTotal && aboutEnergy) {
    return "energy_total";
  }
  if (asksTotal && aboutReject) {
    return "reject_total";
  }
  if (asksAverage && aboutEfficiency) {
    return "efficiency_average";
  }
  if (asksAverage && aboutPf) {
    return "pf_average";
  }
  if (asksTop && aboutProduction) {
    return "top_production_machine";
  }
  if (asksTop && aboutEnergy) {
    return "top_energy_machine";
  }
  if (asksTop && aboutReject) {
    return "top_reject_machine";
  }
  if (asksLow && aboutEfficiency) {
    return "low_efficiency_machine";
  }
  if (machineId && (aboutProduction || aboutEnergy || aboutReject || aboutEfficiency || aboutPf || aboutStatus)) {
    return "machine_summary";
  }
  if (aboutStatus) {
    return "status_overview";
  }

  if (aboutReject) {
    return "reject_analysis";
  }
  if (aboutProduction) {
    return "production_details";
  }
  if (aboutEnergy) {
    return "energy_details";
  }
  if (aboutEfficiency) {
    return "efficiency_details";
  }
  return "plant_summary";
}

function collectMachineIssues(machine) {
  const issues = [];
  if (!machine) return issues;

  if (toNum(machine.reject_rate_pct, 0) >= 5) {
    issues.push({ code: "reject", text: `high reject rate ${formatPct(machine.reject_rate_pct)}%`, weight: 3 });
  }
  if (toNum(machine.avg_efficiency, 100) < 75) {
    issues.push({ code: "efficiency", text: `low efficiency ${machine.avg_efficiency}%`, weight: 3 });
  }
  if (toNum(machine.avg_pf, 1) < 0.9) {
    issues.push({ code: "pf", text: `low power factor ${machine.avg_pf}`, weight: 2 });
  }
  if (toNum(machine.avg_heat, 0) >= 80) {
    issues.push({ code: "heat", text: `high heat ${machine.avg_heat}C`, weight: 2 });
  }

  return issues;
}

function parseJsonObject(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) {
    try {
      const parsed = JSON.parse(fence[1]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }

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

function formatPct(value) {
  const rounded = Math.round(toNum(value, 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

async function getMachineTodaySnapshot(machineId) {
  const sql = `SELECT
      m.id,
      m.name,
      m.status,
      COALESCE(MAX(mm.parts_produced), 0) AS parts_today,
      COALESCE(MAX(mm.rejection_count), 0) AS rejects_today,
      COALESCE(MAX(mm.kwh), 0) AS kwh_today,
      COALESCE(ROUND(AVG(mm.efficiency_score))::int, 0) AS avg_efficiency,
      COALESCE(ROUND(AVG(mm.power_factor)::numeric, 2), 0) AS avg_pf,
      COALESCE(ROUND(AVG(mm.machine_heat_c)::numeric, 1), 0) AS avg_heat
    FROM machines m
    LEFT JOIN machine_metrics mm
      ON mm.machine_id = m.id
      AND mm.recorded_at::date = CURRENT_DATE
    WHERE ($1::text IS NULL OR m.id = $1)
    GROUP BY m.id, m.name, m.status
    ORDER BY m.id`;

  const { rows } = await pool.query(sql, [machineId || null]);
  return rows.map((row) => {
    const parts = toNum(row.parts_today, 0);
    const rejects = toNum(row.rejects_today, 0);
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      parts_today: parts,
      rejects_today: rejects,
      reject_rate_pct: parts > 0 ? Math.round(((rejects / parts) * 100) * 10) / 10 : 0,
      kwh_today: toNum(row.kwh_today, 0),
      avg_efficiency: toNum(row.avg_efficiency, 0),
      avg_pf: toNum(row.avg_pf, 0),
      avg_heat: toNum(row.avg_heat, 0),
    };
  });
}

function buildDeterministicAnswer(question, intent, evidence, machineId) {
  const lines = [];

  if (machineId && evidence.machine) {
    lines.push(
      `${machineId} today: ${evidence.machine.parts_today} parts, ${formatPct(evidence.machine.reject_rate_pct)}% reject rate, ${evidence.machine.kwh_today} kWh, ${evidence.machine.avg_efficiency}% efficiency.`
    );
  }

  if (intent === "production_total" && evidence.totals) {
    lines.push(
      `Total plant production today is ${evidence.totals.parts_today_total} parts (rejects ${evidence.totals.rejects_total}, reject rate ${formatPct(evidence.totals.reject_rate_pct)}%).`
    );
  }

  if (intent === "energy_total" && evidence.totals) {
    lines.push(
      `Total plant energy consumption today is ${evidence.totals.kwh_today_total} kWh (highest consumer: ${evidence.topEnergy?.id || "N/A"} at ${evidence.topEnergy?.kwh_today || 0} kWh).`
    );
  }

  if (intent === "reject_total" && evidence.totals) {
    lines.push(
      `Total rejects today are ${evidence.totals.rejects_total} parts with overall reject rate ${formatPct(evidence.totals.reject_rate_pct)}%.`
    );
  }

  if (intent === "efficiency_average" && evidence.totals) {
    lines.push(`Average plant efficiency today is ${formatPct(evidence.totals.avg_efficiency_plant)}%.`);
  }

  if (intent === "pf_average" && evidence.totals) {
    lines.push(`Average plant power factor today is ${evidence.totals.avg_pf_plant}.`);
  }

  if (intent === "top_production_machine" && evidence.topProduction) {
    lines.push(`Highest production machine is ${evidence.topProduction.id} with ${evidence.topProduction.parts_today} parts today.`);
  }

  if (intent === "top_energy_machine" && evidence.topEnergy) {
    lines.push(`Highest energy machine today is ${evidence.topEnergy.id} at ${evidence.topEnergy.kwh_today} kWh.`);
  }

  if (intent === "top_reject_machine" && evidence.topReject) {
    lines.push(`Highest reject machine today is ${evidence.topReject.id} at ${formatPct(evidence.topReject.reject_rate_pct)}% reject rate.`);
  }

  if (intent === "low_efficiency_machine" && evidence.lowEfficiency) {
    lines.push(`Lowest efficiency machine today is ${evidence.lowEfficiency.id} at ${evidence.lowEfficiency.avg_efficiency}% efficiency.`);
  }

  if (intent === "production_details" && evidence.topProduction) {
    lines.push(`Top producer is ${evidence.topProduction.id} with ${evidence.topProduction.parts_today} parts today.`);
  }

  if (intent === "reject_analysis" && evidence.topReject) {
    lines.push(`Highest reject risk is ${evidence.topReject.id} at ${formatPct(evidence.topReject.reject_rate_pct)}% today.`);
  }

  if (intent === "energy_details" && evidence.topEnergy) {
    lines.push(`Highest energy use is ${evidence.topEnergy.id} at ${evidence.topEnergy.kwh_today} kWh today.`);
  }

  if (intent === "efficiency_details" && evidence.lowEfficiency) {
    lines.push(`Lowest efficiency is ${evidence.lowEfficiency.id} at ${evidence.lowEfficiency.avg_efficiency}% today.`);
  }

  if (intent === "status_overview" && evidence.statusCounts) {
    lines.push(
      `Machine status: running ${evidence.statusCounts.running}, idle ${evidence.statusCounts.idle}, maintenance ${evidence.statusCounts.maintenance}.`
    );
  }

  if (intent === "machine_summary" && evidence.machine) {
    lines.push(`${evidence.machine.id} status is ${String(evidence.machine.status || "unknown").toLowerCase()} with PF ${evidence.machine.avg_pf} and heat ${evidence.machine.avg_heat}C.`);
  }

  if (intent === "machine_issues" && evidence.machine) {
    const issues = collectMachineIssues(evidence.machine).map((x) => x.text);

    if (issues.length > 0) {
      lines.push(`${evidence.machine.id} key issues today: ${issues.join(", ")}.`);
    } else {
      lines.push(`${evidence.machine.id} has no major issue flags today from current metrics.`);
    }
  }

  if (intent === "plant_issues" && evidence.issueMachine) {
    const issues = collectMachineIssues(evidence.issueMachine).map((x) => x.text);
    if (issues.length > 0) {
      lines.push(`Highest issue risk right now is ${evidence.issueMachine.id}: ${issues.join(", ")}.`);
    } else {
      lines.push(`No machine has major issue flags right now from current metrics.`);
    }
  }

  if (lines.length === 0) {
    if (intent === "help") {
      lines.push("You can ask: total production today, total energy consumption today, total rejects today, highest energy machine, lowest efficiency machine, machine issues in CNC-2, or current status.");
    } else {
      lines.push("I found current plant metrics, but your question is broad. Ask for production, reject, energy, efficiency, PF, or status by machine.");
    }
  }

  if (intent === "plant_summary" && evidence.totals) {
    lines.push(
      `Plant today: ${evidence.totals.parts_today_total} parts, ${evidence.totals.kwh_today_total} kWh, ${evidence.totals.rejects_total} rejects, avg efficiency ${formatPct(evidence.totals.avg_efficiency_plant)}%.`
    );
  }

  return lines.join(" ");
}

async function polishWithOllama(question, intent, evidence, fallbackAnswer, fallbackSuggestions) {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:7b";

  const systemPrompt = [
    "You are a concise industrial assistant.",
    "Use only the provided evidence. Do not invent numbers.",
    "Return ONLY valid JSON object.",
    "Schema: {\"answer\":string,\"suggestions\":string[]}",
    "Answer in max 3 short sentences.",
    "Suggestions must be practical and action-oriented.",
  ].join(" ");

  const userPrompt = [
    `Question: ${question}`,
    `Intent: ${intent}`,
    `Evidence: ${JSON.stringify(evidence)}`,
    `Fallback answer: ${fallbackAnswer}`,
    `Fallback suggestions: ${JSON.stringify(fallbackSuggestions)}`,
  ].join("\n");

  const controller = new AbortController();
  const timeoutMs = Math.max(5000, toNum(process.env.CHAT_ASSIST_TIMEOUT_MS, 12000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
          num_predict: 180,
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { answer: fallbackAnswer, suggestions: fallbackSuggestions };
    }

    const payload = await response.json();
    const content = payload?.message?.content || "";
    const parsed = parseJsonObject(content);
    if (!parsed) return { answer: fallbackAnswer, suggestions: fallbackSuggestions };

    const answer = typeof parsed.answer === "string" && parsed.answer.trim()
      ? parsed.answer.trim()
      : fallbackAnswer;
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()).slice(0, 4)
      : fallbackSuggestions;

    return {
      answer,
      suggestions: suggestions.length ? suggestions : fallbackSuggestions,
    };
  } catch {
    return { answer: fallbackAnswer, suggestions: fallbackSuggestions };
  } finally {
    clearTimeout(timeout);
  }
}

router.post("/ask", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const machineId = extractMachineId(message);
    const baseIntent = detectIntent(message);
    const asksIssue = /issue|issues|problem|fault|alert|anomaly|what\s+wrong/.test(message.toLowerCase());
    const intent = asksIssue && machineId
      ? "machine_issues"
      : (machineId && baseIntent === "plant_summary" ? "machine_issues" : baseIntent);
    const snapshot = await getMachineTodaySnapshot(machineId);
    const allSnapshot = machineId ? await getMachineTodaySnapshot(null) : snapshot;

    const topProduction = [...allSnapshot].sort((a, b) => b.parts_today - a.parts_today)[0] || null;
    const topReject = [...allSnapshot].sort((a, b) => b.reject_rate_pct - a.reject_rate_pct)[0] || null;
    const topEnergy = [...allSnapshot].sort((a, b) => b.kwh_today - a.kwh_today)[0] || null;
    const lowEfficiency = [...allSnapshot].sort((a, b) => a.avg_efficiency - b.avg_efficiency)[0] || null;

    const statusCounts = allSnapshot.reduce(
      (acc, row) => {
        const key = String(row.status || "").toLowerCase();
        if (key === "running") acc.running += 1;
        else if (key === "idle") acc.idle += 1;
        else acc.maintenance += 1;
        return acc;
      },
      { running: 0, idle: 0, maintenance: 0 }
    );

    const selectedMachine = machineId ? snapshot[0] || null : null;
    const issueMachine = allSnapshot
      .map((m) => ({
        ...m,
        _issueScore: collectMachineIssues(m).reduce((s, x) => s + x.weight, 0),
      }))
      .sort((a, b) => {
        if (b._issueScore !== a._issueScore) return b._issueScore - a._issueScore;
        return toNum(b.reject_rate_pct, 0) - toNum(a.reject_rate_pct, 0);
      })[0] || null;

    const totals = allSnapshot.reduce(
      (acc, row) => {
        acc.parts_today_total += toNum(row.parts_today, 0);
        acc.rejects_total += toNum(row.rejects_today, 0);
        acc.kwh_today_total += toNum(row.kwh_today, 0);
        acc.eff_sum += toNum(row.avg_efficiency, 0);
        acc.pf_sum += toNum(row.avg_pf, 0);
        acc.machine_count += 1;
        return acc;
      },
      { parts_today_total: 0, rejects_total: 0, kwh_today_total: 0, eff_sum: 0, pf_sum: 0, machine_count: 0 }
    );
    totals.kwh_today_total = Math.round(totals.kwh_today_total * 100) / 100;
    totals.reject_rate_pct = totals.parts_today_total > 0
      ? Math.round((totals.rejects_total / totals.parts_today_total) * 1000) / 10
      : 0;
    totals.avg_efficiency_plant = totals.machine_count > 0
      ? Math.round((totals.eff_sum / totals.machine_count) * 10) / 10
      : 0;
    totals.avg_pf_plant = totals.machine_count > 0
      ? Math.round((totals.pf_sum / totals.machine_count) * 100) / 100
      : 0;

    const evidence = {
      machine: selectedMachine,
      issueMachine,
      totals,
      topProduction,
      topReject,
      topEnergy,
      lowEfficiency,
      statusCounts,
      date: new Date().toISOString().slice(0, 10),
    };

    const fallbackSuggestions = intent === "production_total"
      ? [
          topProduction ? `Top producer ${topProduction.id} can share best settings across lines.` : "Review top producer setup and cycle profile.",
          lowEfficiency ? `Improve output by tuning ${lowEfficiency.id} efficiency this shift.` : "Tune low-performing machines to raise total output.",
          topReject ? `Reduce total loss by fixing rejects on ${topReject.id} first.` : "Track reject trend to protect total throughput.",
        ].filter(Boolean)
      : intent === "energy_total"
        ? [
            topEnergy ? `Reduce idle energy first on ${topEnergy.id} this shift.` : "Audit top energy consumer machine first.",
            `Compare kWh/part by machine and optimize worst performer.`,
            `Schedule non-critical loads to off-peak periods where possible.`,
          ]
      : intent === "reject_total"
        ? [
            topReject ? `Prioritize reject reduction on ${topReject.id} immediately.` : "Investigate top reject contributor first.",
            `Run first-piece validation on all active lines this shift.`,
            `Tighten process parameter checks for high-variance machines.`,
          ]
      : intent === "efficiency_average" || intent === "low_efficiency_machine"
        ? [
            lowEfficiency ? `Run setup and cycle-time recovery actions on ${lowEfficiency.id}.` : "Investigate lowest efficiency machine first.",
            `Track shift-wise efficiency drift and enforce setup checklist.`,
            `Review downtime causes and micro-stoppages this shift.`,
          ]
      : intent === "pf_average"
        ? [
            `Check machines below PF 0.9 and prioritize correction.`,
            `Inspect capacitor bank and load balancing for low-PF lines.`,
            `Monitor PF trend hourly to avoid demand penalties.`,
          ]
      : intent === "top_production_machine"
        ? [
            topProduction ? `Replicate ${topProduction.id} best parameters across comparable lines.` : "Capture best-performing machine settings for reuse.",
            `Use top producer settings as first-piece baseline.`,
            `Protect top producer uptime with preventive checks.`,
          ]
      : intent === "top_energy_machine"
        ? [
            topEnergy ? `Audit idle/load consumption pattern on ${topEnergy.id}.` : "Audit highest energy machine first.",
            `Optimize warm-up and standby windows on high-load machine.`,
            `Compare energy per part across machines and close the gap.`,
          ]
      : intent === "top_reject_machine"
        ? [
            topReject ? `Start root-cause review on ${topReject.id} reject sources.` : "Start reject root-cause review on top contributor.",
            `Tighten first-off approval and in-process quality checks.`,
            `Inspect tooling wear and alignment on reject-heavy operation.`,
          ]
      : intent === "status_overview"
        ? [
            `Move prolonged idle machines to planned tasks or shutdown.`,
            `Prioritize maintenance clearance for blocked machines.`,
            `Rebalance workload from constrained lines to running lines.`,
          ]
      : intent === "machine_issues" && selectedMachine
        ? [
            `Prioritize ${selectedMachine.id} corrective checks this shift.`,
            `Inspect tool wear, feed settings, and quality checks on ${selectedMachine.id}.`,
            `Monitor ${selectedMachine.id} efficiency, reject rate, and PF every hour today.`,
          ]
      : intent === "plant_issues" && issueMachine
        ? [
            `Prioritize ${issueMachine.id} corrective checks this shift.`,
            `Start root-cause validation on ${issueMachine.id} before next run batch.`,
            `Track ${issueMachine.id} reject, PF, and efficiency each hour today.`,
          ]
      : intent === "machine_summary" && selectedMachine
        ? [
            `Track ${selectedMachine.id} reject rate and efficiency every hour.`,
            `Verify ${selectedMachine.id} setup, tool condition, and feed/speed consistency.`,
            `Reduce idle and standby windows on ${selectedMachine.id}.`,
          ]
      : intent === "help"
        ? [
            `Try: total production today`,
            `Try: total energy consumption today`,
            `Try: issues in CNC-2`,
          ]
      : [
          topReject ? `Prioritize reject reduction on ${topReject.id} this shift.` : "Review quality metrics for top reject machine.",
          topEnergy ? `Audit idle power and cycle energy on ${topEnergy.id}.` : "Review machine energy distribution.",
          lowEfficiency ? `Run quick setup check on ${lowEfficiency.id} to recover efficiency.` : "Check efficiency trend vs baseline.",
        ].filter(Boolean);

    const fallbackAnswer = buildDeterministicAnswer(message, intent, evidence, machineId);
    const aiEnabled = String(process.env.CHAT_ASSIST_AI_ENABLED || "true").toLowerCase() !== "false";

    const forceDeterministic = [
      "help",
      "production_total",
      "energy_total",
      "reject_total",
      "efficiency_average",
      "pf_average",
      "top_production_machine",
      "top_energy_machine",
      "top_reject_machine",
      "low_efficiency_machine",
      "production_details",
      "reject_analysis",
      "energy_details",
      "efficiency_details",
      "status_overview",
      "machine_issues",
      "plant_issues",
      "machine_summary",
      "plant_summary",
    ].includes(intent);
    const finalResponse = (aiEnabled && !forceDeterministic)
      ? await polishWithOllama(message, intent, evidence, fallbackAnswer, fallbackSuggestions)
      : { answer: fallbackAnswer, suggestions: fallbackSuggestions };

    const includeEvidence =
      req.body?.includeEvidence === true ||
      String(req.query?.includeEvidence || "false").toLowerCase() === "true";

    const payload = {
      answer: finalResponse.answer,
      suggestions: finalResponse.suggestions,
      intent,
    };

    if (includeEvidence) {
      payload.evidence = evidence;
    }

    return res.json(payload);
  } catch (err) {
    console.error("POST /chat-assist/ask error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
