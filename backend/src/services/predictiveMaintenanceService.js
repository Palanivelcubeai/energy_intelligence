function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(v, fallback = 0) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function safePercent(numerator, denominator) {
  if (!denominator || denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function median(values) {
  const nums = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 0) return (nums[mid - 1] + nums[mid]) / 2;
  return nums[mid];
}

function computeRiskFromSignals(signals) {
  const heatRisk = clamp(((signals.heatC - 55) / 35) * 100, 0, 100);
  const powerRisk = clamp(((signals.powerLoadPct - 80) / 35) * 100, 0, 100);
  const powerPerPartRisk = clamp(((signals.powerPerPartKwh - 0.32) / 0.28) * 100, 0, 100);
  const healthRisk = clamp(100 - signals.healthScore, 0, 100);
  const vibrationRisk = clamp(((signals.vibrationMmS - 2.2) / 4.2) * 100, 0, 100);

  const riskScore = Math.round(
    (heatRisk * 0.25) +
    (powerRisk * 0.22) +
    (powerPerPartRisk * 0.20) +
    (healthRisk * 0.20) +
    (vibrationRisk * 0.13)
  );

  return {
    riskScore,
    factors: [
      { key: "heat", label: "heat", value: Math.round(heatRisk) },
      { key: "power", label: "power", value: Math.round(powerRisk) },
      { key: "powerPerPart", label: "power/part", value: Math.round(powerPerPartRisk) },
      { key: "health", label: "health", value: Math.round(healthRisk) },
      { key: "vibration", label: "vibration", value: Math.round(vibrationRisk) },
    ].sort((a, b) => b.value - a.value),
  };
}

function classifyRiskLevel(riskScore) {
  if (riskScore >= 75) return "Critical";
  if (riskScore >= 55) return "High";
  if (riskScore >= 35) return "Medium";
  return "Low";
}

function isoUtcSeconds(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function getPredictiveMaintenancePayload(pool) {
  const configResult = await pool.query(
    "SELECT COALESCE(heat_threshold_c, 85)::numeric AS heat_threshold_c FROM system_config LIMIT 1"
  );
  const heatThresholdC = toNumber(configResult.rows?.[0]?.heat_threshold_c, 85);

  const { rows } = await pool.query(
    `SELECT
       m.id,
       m.name,
       m.status,
       m.rated_power_kw,
       m.heat_threshold_c,
       COALESCE(mm.kw, 0) AS kw,
       COALESCE(mm.kwh, 0) AS kwh,
       COALESCE(mm.pf, 0) AS pf,
       COALESCE(mm.runtime_hours, 0) AS runtime_hours,
       COALESCE(mm.idle_hours, 0) AS idle_hours,
       COALESCE(mm.parts_produced, 0) AS parts_produced,
       COALESCE(mm.rejection_count, 0) AS rejection_count,
       COALESCE(mm.efficiency_score, 70) AS health_score,
       COALESCE(mm.current_r, 0) AS current_r,
       COALESCE(mm.current_y, 0) AS current_y,
       COALESCE(mm.current_b, 0) AS current_b,
       mm.machine_heat_c AS machine_heat_c,
       mm.machine_vibration_mm_s AS machine_vibration_mm_s,
       mm.recorded_at AS recorded_at,
       COALESCE(pm.kw, 0) AS prev_kw,
       COALESCE(pm.runtime_hours, 0) AS prev_runtime_hours,
       COALESCE(pm.efficiency_score, 70) AS prev_health_score,
       pm.recorded_at AS prev_recorded_at
     FROM machines m
     LEFT JOIN LATERAL (
       SELECT
         x.kw,
         x.kwh,
         x.power_factor AS pf,
         x.runtime_hours,
         x.idle_hours,
         x.parts_produced,
         x.rejection_count,
         x.efficiency_score,
         x.current_r,
         x.current_y,
         x.current_b,
         x.machine_heat_c,
         x.machine_vibration_mm_s,
         x.recorded_at
       FROM machine_metrics x
       WHERE x.machine_id = m.id
       ORDER BY x.recorded_at DESC
       LIMIT 1
     ) mm ON true
     LEFT JOIN LATERAL (
       SELECT
         y.kw,
         y.runtime_hours,
         y.efficiency_score,
         y.recorded_at
       FROM machine_metrics y
       WHERE y.machine_id = m.id
       ORDER BY y.recorded_at DESC
       OFFSET 1
       LIMIT 1
     ) pm ON true
     ORDER BY m.id`
  );

  const measuredPowerPerPartSamples = rows
    .map((r) => {
      const produced = toNumber(r.parts_produced, 0);
      if (produced <= 0) return null;
      return toNumber(r.kwh, 0) / produced;
    })
    .filter((v) => Number.isFinite(v) && v > 0);
  const fleetPowerPerPartBaseline = median(measuredPowerPerPartSamples);
  const highPowerPerPartThreshold = Math.max(0.55, fleetPowerPerPartBaseline * 1.25);

  const machinePredictions = rows.map((r) => {
    const ratedPowerKw = toNumber(r.rated_power_kw, 1);
    const machineHeatThresholdC = toNumber(r.heat_threshold_c, heatThresholdC);
    const powerKw = toNumber(r.kw, 0);
    const prevPowerKw = toNumber(r.prev_kw, powerKw);
    const runtimeHours = toNumber(r.runtime_hours, 0);
    const prevRuntimeHours = toNumber(r.prev_runtime_hours, runtimeHours);
    const partsProduced = toNumber(r.parts_produced, 0);
    const rejectionCount = toNumber(r.rejection_count, 0);
    const pf = toNumber(r.pf, 0.9);
    const healthScore = clamp(Math.round(toNumber(r.health_score, 70)), 0, 100);
    const prevHealthScore = clamp(Math.round(toNumber(r.prev_health_score, healthScore)), 0, 100);

    const currentR = toNumber(r.current_r, 0);
    const currentY = toNumber(r.current_y, 0);
    const currentB = toNumber(r.current_b, 0);
    const avgCurrent = (currentR + currentY + currentB) / 3;
    const maxCurrentDev = Math.max(
      Math.abs(currentR - avgCurrent),
      Math.abs(currentY - avgCurrent),
      Math.abs(currentB - avgCurrent)
    );
    const currentImbalancePct = clamp(safePercent(maxCurrentDev, Math.max(1, avgCurrent)), 0, 100);

    const powerLoadPct = clamp((powerKw / Math.max(0.1, ratedPowerKw)) * 100, 0, 140);
    const hasPartsData = partsProduced > 0;
    const measuredPowerPerPartKwh = hasPartsData
      ? Math.round((toNumber(r.kwh, 0) / partsProduced) * 1000) / 1000
      : null;
    // Use a neutral baseline when no parts were produced to avoid artificial risk spikes.
    const powerPerPartForRisk = hasPartsData ? measuredPowerPerPartKwh : 0.32;

    const recordedAtMs = r.recorded_at ? new Date(r.recorded_at).getTime() : Date.now();
    const prevRecordedAtMs = r.prev_recorded_at ? new Date(r.prev_recorded_at).getTime() : recordedAtMs;
    const sampleMinutes = Math.max(1, (recordedAtMs - prevRecordedAtMs) / 60000);

    const derivedHeatC = Math.round(
      clamp(
        34 + (powerLoadPct * 0.32) + (avgCurrent * 0.45) + (currentImbalancePct * 0.6) + (runtimeHours * 0.25),
        30,
        125
      )
    );
    const derivedVibrationMmS = Math.round(
      clamp(
        0.8 + (currentImbalancePct * 0.06) + ((1 - pf) * 4.5) + (safePercent(rejectionCount, Math.max(1, partsProduced)) * 0.08),
        0.5,
        15
      ) * 100
    ) / 100;

    const heatC = toNumber(r.machine_heat_c, derivedHeatC);
    const vibrationMmS = toNumber(r.machine_vibration_mm_s, derivedVibrationMmS);

    const currentSignals = {
      heatC,
      powerLoadPct,
      powerPerPartKwh: powerPerPartForRisk,
      healthScore,
      vibrationMmS,
    };
    const prevSignals = {
      heatC: Math.round(clamp(34 + (clamp((prevPowerKw / Math.max(0.1, ratedPowerKw)) * 100, 0, 140) * 0.32) + (avgCurrent * 0.35) + (prevRuntimeHours * 0.2), 30, 125)),
      powerLoadPct: clamp((prevPowerKw / Math.max(0.1, ratedPowerKw)) * 100, 0, 140),
      powerPerPartKwh: powerPerPartForRisk,
      healthScore: prevHealthScore,
      vibrationMmS,
    };

    const currentRisk = computeRiskFromSignals(currentSignals);
    const previousRisk = computeRiskFromSignals(prevSignals);
    const riskScore = currentRisk.riskScore;
    const riskDelta = riskScore - previousRisk.riskScore;
    const riskLevel = classifyRiskLevel(riskScore);

    const nextMaintenanceDays = Math.max(1, Math.round(35 - (riskScore * 0.35)));
    let maintenanceWindow = "Normal";
    if (nextMaintenanceDays <= 1) maintenanceWindow = "Immediate";
    else if (nextMaintenanceDays <= 3) maintenanceWindow = "Next 3 days";
    else if (nextMaintenanceDays <= 7) maintenanceWindow = "This week";

    const contributors = currentRisk.factors;

    const minutesSinceLastSample = Math.max(0, Math.round((Date.now() - recordedAtMs) / 60000));
    const confidencePct = clamp(
      Math.round(
        92 - (minutesSinceLastSample * 1.2) - (sampleMinutes > 30 ? 12 : 0) - (powerKw <= 0 ? 10 : 0)
      ),
      45,
      99
    );

    let recommendedAction = "Continue normal monitoring.";
    if (contributors[0].key === "heat") {
      recommendedAction = "Inspect cooling system and lubrication immediately.";
    } else if (contributors[0].key === "vibration") {
      recommendedAction = "Check spindle/bearing alignment and mounting.";
    } else if (contributors[0].key === "power") {
      recommendedAction = "Audit electrical load, tool wear, and cycle profile.";
    } else if (contributors[0].key === "powerPerPart") {
      recommendedAction = "Optimize cycle time and tooling; power consumed per part is too high.";
    } else if (contributors[0].key === "health") {
      recommendedAction = "Plan preventive service; machine health is degrading.";
    }

    const alerts = [];
    if (heatC >= machineHeatThresholdC) alerts.push("High machine heat detected");
    if (powerLoadPct >= 110) alerts.push("Power draw exceeding rated load");
    if (hasPartsData && measuredPowerPerPartKwh >= highPowerPerPartThreshold) alerts.push("Power consumed per part is high");
    if (vibrationMmS >= 4.5) alerts.push("Vibration above safe threshold");
    if (healthScore <= 65) alerts.push("Machine health score is low");
    if (riskDelta >= 12 && riskScore >= 35) alerts.push("Risk trend rising rapidly");

    return {
      id: r.id,
      name: r.name,
      status: r.status,
      riskScore,
      riskDelta,
      riskLevel,
      nextMaintenanceDays,
      maintenanceWindow,
      confidencePct,
      alerts,
      recommendedAction,
      contributingFactors: contributors.slice(0, 2).map((c) => c.label),
      conditions: {
        heatC,
        powerKw: Math.round(powerKw * 100) / 100,
        powerLoadPct: Math.round(powerLoadPct),
        powerPerPartKwh: measuredPowerPerPartKwh,
        healthScore,
        vibrationMmS: Math.round(vibrationMmS * 100) / 100,
      },
      signalMeta: {
        sampleMinutes: Math.round(sampleMinutes * 10) / 10,
        lastSampleAgoMinutes: minutesSinceLastSample,
      },
    };
  });

  const summary = {
    totalMachines: machinePredictions.length,
    criticalCount: machinePredictions.filter((m) => m.riskLevel === "Critical").length,
    highCount: machinePredictions.filter((m) => m.riskLevel === "High").length,
    dueSoonCount: machinePredictions.filter((m) => m.nextMaintenanceDays <= 7).length,
    avgRiskScore: machinePredictions.length
      ? Math.round(machinePredictions.reduce((s, m) => s + m.riskScore, 0) / machinePredictions.length)
      : 0,
    avgHealth: machinePredictions.length
      ? Math.round(machinePredictions.reduce((s, m) => s + m.conditions.healthScore, 0) / machinePredictions.length)
      : 0,
    avgConfidence: machinePredictions.length
      ? Math.round(machinePredictions.reduce((s, m) => s + m.confidencePct, 0) / machinePredictions.length)
      : 0,
  };

  return { summary, machines: machinePredictions, generatedAt: isoUtcSeconds() };
}

module.exports = {
  getPredictiveMaintenancePayload,
};
