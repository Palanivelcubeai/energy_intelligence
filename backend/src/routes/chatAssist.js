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

function extractMachineIds(text) {
  const matches = String(text || "").toUpperCase().match(/\bCNC[-\s]?(\d+)\b/g) || [];
  const normalized = matches.map((token) => {
    const m = token.match(/(\d+)/);
    return m ? `CNC-${m[1]}` : token.replace(/\s+/, "-");
  });
  return [...new Set(normalized)];
}

function hasAny(text, words) {
  return words.some((w) => text.includes(w));
}

function detectIntent(message) {
  return "natural_chat";
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

  if (intent === "worst_machine") {
    if (evidence.issueMachine) {
      const issues = collectMachineIssues(evidence.issueMachine).map((x) => x.text);
      if (issues.length > 0) {
        lines.push(`Right now the worst performing machine is ${evidence.issueMachine.id} based on current risk signals: ${issues.join(", ")}.`);
      } else if (evidence.lowEfficiency) {
        lines.push(`No major alarms are active, but lowest efficiency right now is ${evidence.lowEfficiency.id} at ${evidence.lowEfficiency.avg_efficiency}% efficiency.`);
      }
    } else if (evidence.lowEfficiency) {
      lines.push(`Current lowest efficiency machine is ${evidence.lowEfficiency.id} at ${evidence.lowEfficiency.avg_efficiency}%.`);
    }
  }

  if (intent === "compare_machines") {
    const a = evidence.compareMachines?.a;
    const b = evidence.compareMachines?.b;
    if (a && b) {
      lines.push(
        `Comparison ${a.id} vs ${b.id}: production ${a.parts_today} vs ${b.parts_today} parts, energy ${a.kwh_today} vs ${b.kwh_today} kWh, rejects ${formatPct(a.reject_rate_pct)}% vs ${formatPct(b.reject_rate_pct)}%, efficiency ${a.avg_efficiency}% vs ${b.avg_efficiency}%.`
      );
      const better = a.avg_efficiency >= b.avg_efficiency ? a.id : b.id;
      const riskier = a.reject_rate_pct >= b.reject_rate_pct ? a.id : b.id;
      lines.push(`${better} is stronger on efficiency, while ${riskier} has higher quality risk right now.`);
    } else {
      lines.push("I can compare machines directly if you mention both IDs, for example: compare CNC-2 and CNC-3.");
    }
  }

  if (intent === "why_machine_bad") {
    const machine = evidence.machine;
    if (machine) {
      const issues = collectMachineIssues(machine).map((x) => x.text);
      if (issues.length > 0) {
        lines.push(`${machine.id} is underperforming mainly due to ${issues.join(", ")}.`);
      } else {
        lines.push(`${machine.id} has no major alarm flags right now, but it may still be relatively weaker than peers on current shift performance.`);
      }
    }
  }

  if (intent === "shift_priority_action") {
    if (evidence.issueMachine) {
      lines.push(`First priority this shift: stabilize ${evidence.issueMachine.id}, because it currently carries the highest operational risk.`);
      const issues = collectMachineIssues(evidence.issueMachine).map((x) => x.text);
      if (issues.length > 0) {
        lines.push(`Immediate focus areas: ${issues.join(", ")}.`);
      }
    } else if (evidence.lowEfficiency) {
      lines.push(`First priority this shift: recover efficiency on ${evidence.lowEfficiency.id}, currently lowest at ${evidence.lowEfficiency.avg_efficiency}%.`);
    }
  }

  if (lines.length === 0) {
    if (intent === "greeting") {
      lines.push("Hi. I can help with live plant metrics. Ask about production, energy, rejects, efficiency, PF, machine status, or machine issues.");
    } else if (intent === "smalltalk_status") {
      lines.push("I am doing well and ready to help with live plant data. You can ask anything about production, energy, rejects, efficiency, or machine health.");
    } else if (intent === "smalltalk_thanks") {
      lines.push("You're welcome. I can continue with any realtime production or energy question you have.");
    } else if (intent === "smalltalk_bye") {
      lines.push("Got it. I will be here whenever you want another realtime plant update.");
    } else if (intent === "help") {
      lines.push("You can ask: total production today, total energy consumption today, total rejects today, highest energy machine, lowest efficiency machine, machine issues in CNC-2, or current status.");
    } else {
      lines.push("I have live plant data and can answer naturally. If you want, ask about worst machine, machine issues, totals, efficiency, energy, rejects, or status and I will break it down clearly.");
    }
  }

  if (intent === "plant_summary" && evidence.totals) {
    lines.push(
      `Plant today: ${evidence.totals.parts_today_total} parts, ${evidence.totals.kwh_today_total} kWh, ${evidence.totals.rejects_total} rejects, avg efficiency ${formatPct(evidence.totals.avg_efficiency_plant)}%.`
    );
  }

  return lines.join(" ");
}

function buildNaturalFallbackAnswer(question, evidence, machineId) {
  const q = String(question || "").toLowerCase();

  if (/\b(how are you|how r you|how're you|how you doing|how is it going)\b/.test(q)) {
    const focusMachine = evidence.issueMachine?.id || evidence.lowEfficiency?.id || "the current bottleneck machine";
    return `I am doing well and ready with your live plant data. Right now, focus first on ${focusMachine}; plant today is ${evidence.totals?.parts_today_total || 0} parts, ${evidence.totals?.kwh_today_total || 0} kWh, ${evidence.totals?.rejects_total || 0} rejects.`;
  }

  if (/\b(thanks|thank you|thx)\b/.test(q)) {
    return "You're welcome. I am ready to continue with realtime production, energy, quality, or machine performance questions.";
  }

  if (machineId && evidence.machine) {
    return `${machineId} right now: ${evidence.machine.parts_today} parts, ${formatPct(evidence.machine.reject_rate_pct)}% reject rate, ${evidence.machine.kwh_today} kWh, ${evidence.machine.avg_efficiency}% efficiency, status ${String(evidence.machine.status || "unknown").toLowerCase()}.`;
  }

  const worst = evidence.issueMachine?.id || evidence.lowEfficiency?.id || "N/A";
  const topEnergy = evidence.topEnergy?.id || "N/A";
  return `From live data right now: ${evidence.totals?.parts_today_total || 0} parts produced, ${evidence.totals?.kwh_today_total || 0} kWh consumed, ${evidence.totals?.rejects_total || 0} rejects, average efficiency ${formatPct(evidence.totals?.avg_efficiency_plant || 0)}%. Current highest-risk machine is ${worst}; highest energy consumer is ${topEnergy}.`;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((item) => {
      const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : null;
      const content = typeof item?.text === "string" ? item.text.trim() : "";
      if (!role || !content) return null;
      return { role, content };
    })
    .filter(Boolean)
    .slice(-12);
}

async function polishWithOllama(question, evidence, fallbackAnswer, fallbackSuggestions, history = []) {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:7b";

  const systemPrompt = [
    "You are a realtime industrial copilot for CNC operations.",
    "Respond naturally like a modern chat assistant.",
    "Use only the provided evidence. Do not invent numbers.",
    "Return ONLY valid JSON object.",
    "Schema: {\"answer\":string,\"suggestions\":string[]}",
    "Answer in natural conversational tone and include useful context from evidence.",
    "Do not ask user to rephrase into short/specific format.",
    "Suggestions must be practical and action-oriented and concise.",
  ].join(" ");

  const userPrompt = [
    `Current user message: ${question}`,
    `Evidence: ${JSON.stringify(evidence)}`,
    `Fallback answer: ${fallbackAnswer}`,
    `Fallback suggestions: ${JSON.stringify(fallbackSuggestions)}`,
    "Use chat history context when relevant, but prioritize latest user message.",
  ].join("\n");

  const normalizedHistory = normalizeHistory(history);
  const messages = [
    { role: "system", content: systemPrompt },
    ...normalizedHistory,
    { role: "user", content: userPrompt },
  ];

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
          temperature: 0.4,
          num_predict: 260,
        },
        messages,
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

async function streamAnswerWithOllama(question, evidence, fallbackAnswer, history = [], onToken) {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:7b";

  const systemPrompt = [
    "You are a realtime industrial copilot for CNC operations.",
    "Respond naturally like a modern chat assistant.",
    "Use only the provided evidence. Do not invent numbers.",
    "Answer in natural conversational tone and include useful context from evidence.",
    "Do not ask user to rephrase into short/specific format.",
  ].join(" ");

  const userPrompt = [
    `Current user message: ${question}`,
    `Evidence: ${JSON.stringify(evidence)}`,
    `Fallback answer: ${fallbackAnswer}`,
    "Use chat history context when relevant, but prioritize latest user message.",
  ].join("\n");

  const normalizedHistory = normalizeHistory(history);
  const messages = [
    { role: "system", content: systemPrompt },
    ...normalizedHistory,
    { role: "user", content: userPrompt },
  ];

  const controller = new AbortController();
  const timeoutMs = Math.max(5000, toNum(process.env.CHAT_ASSIST_TIMEOUT_MS, 12000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        options: {
          temperature: 0.4,
          num_predict: 260,
        },
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      return fallbackAnswer;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        const token = parsed?.message?.content || "";
        if (token) {
          full += token;
          onToken(token);
        }
      }
    }

    const finalAnswer = full.trim();
    return finalAnswer || fallbackAnswer;
  } catch {
    return fallbackAnswer;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildChatContext(message) {
  const machineId = extractMachineId(message);
  const machineIds = extractMachineIds(message);
  const intent = "natural_chat";
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
  const compareMachines = machineIds.length >= 2
    ? {
        a: allSnapshot.find((m) => m.id === machineIds[0]) || null,
        b: allSnapshot.find((m) => m.id === machineIds[1]) || null,
      }
    : null;
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
    compareMachines,
    issueMachine,
    totals,
    topProduction,
    topReject,
    topEnergy,
    lowEfficiency,
    statusCounts,
    date: new Date().toISOString().slice(0, 10),
  };

  const fallbackSuggestions = [
    topReject ? `Prioritize reject reduction on ${topReject.id} this shift.` : "Review quality risk by machine this shift.",
    topEnergy ? `Audit idle and cycle energy on ${topEnergy.id}.` : "Review machine-wise energy distribution.",
    lowEfficiency ? `Run setup recovery actions on ${lowEfficiency.id}.` : "Track efficiency drift by machine every hour.",
    "Ask me to compare any two machines for a direct side-by-side view.",
  ].filter(Boolean).slice(0, 4);

  const fallbackAnswer = buildNaturalFallbackAnswer(message, evidence, machineId);

  return {
    intent,
    evidence,
    fallbackSuggestions,
    fallbackAnswer,
  };
}

router.post("/ask", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const machineId = extractMachineId(message);
    const machineIds = extractMachineIds(message);
    const history = req.body?.history;
    const intent = "natural_chat";
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
    const compareMachines = machineIds.length >= 2
      ? {
          a: allSnapshot.find((m) => m.id === machineIds[0]) || null,
          b: allSnapshot.find((m) => m.id === machineIds[1]) || null,
        }
      : null;
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
      compareMachines,
      issueMachine,
      totals,
      topProduction,
      topReject,
      topEnergy,
      lowEfficiency,
      statusCounts,
      date: new Date().toISOString().slice(0, 10),
    };

    const fallbackSuggestions = [
      topReject ? `Prioritize reject reduction on ${topReject.id} this shift.` : "Review quality risk by machine this shift.",
      topEnergy ? `Audit idle and cycle energy on ${topEnergy.id}.` : "Review machine-wise energy distribution.",
      lowEfficiency ? `Run setup recovery actions on ${lowEfficiency.id}.` : "Track efficiency drift by machine every hour.",
      "Ask me to compare any two machines for a direct side-by-side view.",
    ].filter(Boolean).slice(0, 4);

    const fallbackAnswer = buildNaturalFallbackAnswer(message, evidence, machineId);
    const aiEnabled = String(process.env.CHAT_ASSIST_AI_ENABLED || "true").toLowerCase() !== "false";

    const finalResponse = aiEnabled
      ? await polishWithOllama(message, evidence, fallbackAnswer, fallbackSuggestions, history)
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

router.post("/ask-stream", async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const history = req.body?.history;
    const { intent, evidence, fallbackSuggestions, fallbackAnswer } = await buildChatContext(message);
    const aiEnabled = String(process.env.CHAT_ASSIST_AI_ENABLED || "true").toLowerCase() !== "false";

    let answer = fallbackAnswer;
    if (aiEnabled) {
      answer = await streamAnswerWithOllama(message, evidence, fallbackAnswer, history, (token) => {
        sendEvent("token", { token });
      });
    } else {
      sendEvent("token", { token: fallbackAnswer });
    }

    sendEvent("done", {
      answer,
      suggestions: fallbackSuggestions,
      intent,
    });
    return res.end();
  } catch (err) {
    console.error("POST /chat-assist/ask-stream error:", err);
    sendEvent("error", { message: "Unable to stream chat response." });
    return res.end();
  }
});

module.exports = router;
