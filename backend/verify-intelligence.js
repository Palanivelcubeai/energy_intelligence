const pool = require('./src/db');

function toNum(v, fb = 0) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fb;
}

(async () => {
  const reportResp = await fetch('http://localhost:8000/api/reports/intelligence-summary/document-fast');
  const doc = await reportResp.json();

  const machineStatusRes = await pool.query(`SELECT
      COUNT(*)::int AS total_machines,
      COALESCE(SUM((status = 'running')::int), 0)::int AS running_machines,
      COALESCE(SUM((status = 'idle')::int), 0)::int AS idle_machines,
      COALESCE(SUM((status = 'maintenance')::int), 0)::int AS maintenance_machines
    FROM machines`);
  const status = machineStatusRes.rows[0] || {};

  const latestMetricsRes = await pool.query(`SELECT DISTINCT ON (machine_id)
      machine_id,
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
    ORDER BY machine_id, recorded_at DESC`);

  const latest = latestMetricsRes.rows || [];
  const totalParts = latest.reduce((s, r) => s + toNum(r.parts_produced, 0), 0);
  const totalRejects = latest.reduce((s, r) => s + toNum(r.rejection_count, 0), 0);
  const totalEnergy = latest.reduce((s, r) => s + toNum(r.kwh, 0), 0);
  const avgEfficiencyRaw = latest.length ? latest.reduce((s, r) => s + toNum(r.efficiency_score, 0), 0) / latest.length : 0;
  const rejectRateRaw = totalParts > 0 ? (totalRejects / totalParts) * 100 : 0;
  const runtimeTotal = latest.reduce((s, r) => s + toNum(r.runtime_hours, 0), 0);
  const idleTotal = latest.reduce((s, r) => s + toNum(r.idle_hours, 0), 0);
  const utilizationRaw = (runtimeTotal + idleTotal) > 0 ? (runtimeTotal / (runtimeTotal + idleTotal)) * 100 : 0;

  const expected = {
    totalMachines: Number(status.total_machines || 0),
    runningMachines: Number(status.running_machines || 0),
    idleMachines: Number(status.idle_machines || 0),
    maintenanceMachines: Number(status.maintenance_machines || 0),
    totalProduction: totalParts,
    totalEnergy: Math.round(totalEnergy * 10) / 10,
    avgEfficiency: Math.round(avgEfficiencyRaw),
    rejectRatePct: Math.round(rejectRateRaw * 10) / 10,
    utilizationPct: Math.round(utilizationRaw),
  };

  const actual = doc?.kpis || {};
  const compare = {};
  for (const k of Object.keys(expected)) {
    compare[k] = { expected: expected[k], actual: actual[k], match: expected[k] === actual[k] };
  }

  console.log(JSON.stringify({
    endpointOk: reportResp.ok,
    modelUsed: doc?.modelUsed,
    overall: doc?.aiAccuracy?.overall,
    forecastReliable: doc?.aiAccuracy?.forecastReliable,
    compare,
    topIssues: doc?.topIssues || [],
    demandStatus: doc?.aiAccuracy?.demandStatus,
    demandBacktestReady: doc?.aiAccuracy?.demandBacktestReady,
  }, null, 2));

  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
