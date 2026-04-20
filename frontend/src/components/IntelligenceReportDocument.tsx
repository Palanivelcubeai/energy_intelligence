import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Legend,
} from 'recharts';

type SectionSummary = {
  heading: string;
  summary: string;
};

type Recommendation = string;

type KpiBlock = {
  totalMachines: number;
  runningMachines: number;
  idleMachines: number;
  maintenanceMachines: number;
  totalProduction: number;
  totalEnergy: number;
  avgEfficiency: number;
  rejectRatePct: number;
  utilizationPct: number;
  aiInsights24h: number;
};

type AiAccuracy = {
  overall: number;
  insightConfidence: number;
  insightConfidenceEstimated?: boolean;
  predictiveConfidence: number;
  dataFreshness: number;
  dataCompletenessPct?: number;
  missingIntervalsCount?: number;
  forecastQualityWarning?: string;
  forecastReliable?: boolean;
  forecastReliabilityLabel?: 'Reliable' | 'Use with caution';
  reliabilityGateReason?: string;
  confidenceBreakdown?: {
    dataFreshness: { value: number; weightPct: number };
    dataCompleteness: { value: number; weightPct: number };
    modelConsistency: { value: number; weightPct: number };
    backtestStability: { value: number; weightPct: number };
  };
  demandBacktest: number;
  demandBacktestReady?: boolean;
  demandBacktestSamples?: number;
  demandBacktestMinSamples?: number;
  demandHitRate: number;
  demandHitRateDelta?: number;
  demandHitRate10?: number;
  demandHitRate30?: number;
  demandMape: number;
  demandMapeRaw?: number;
  demandMape30?: number;
  demandMapeDelta?: number;
  demandOutlierDays?: number;
  demandBacktestSamples30?: number;
  demandMetricNote?: string;
  demandStatus?: 'Stable' | 'Watch' | 'Action Needed' | 'Calibrating';
  demandStatusReason?: string;
  metricProvenance?: Partial<Record<
    | 'insightConfidence'
    | 'predictiveConfidence'
    | 'dataFreshness'
    | 'dataCompletenessPct'
    | 'demandBacktest'
    | 'demandHitRate'
    | 'demandMape'
    | 'demandHitRate30'
    | 'demandMape30'
    | 'demandHitRateDelta'
    | 'demandMapeDelta'
    | 'demandOutlierDays'
    | 'modelConsistency'
    | 'demandStatus'
    | 'forecastReliable',
    'Measured' | 'Derived' | 'Estimated'
  >>;
};

type ProductionEnergyPoint = {
  day: string;
  production: number;
  energy: number;
  efficiency: number;
};

type DemandAccuracyPoint = {
  day: string;
  predicted: number;
  actual: number;
  errorPct: number;
  hit: boolean;
  hit10?: boolean;
};

type MachineSnapshot = {
  machine: string;
  parts: number;
  rejects: number;
  rejectRate: number;
  efficiency: number;
  powerFactor: number;
  energy: number;
  risk: 'Low' | 'Medium' | 'High';
};

export type IntelligenceReportDocumentData = {
  title: string;
  generatedAt: string;
  lastIngestionAt?: string | null;
  cacheTtlSeconds?: number;
  modelUsed: string;
  executiveSummary: string;
  sectionSummaries: SectionSummary[];
  recommendations: Recommendation[];
  kpis: KpiBlock;
  aiAccuracy: AiAccuracy;
  charts: {
    productionEnergyTrend: ProductionEnergyPoint[];
    demandAccuracyTrend: DemandAccuracyPoint[];
  };
  machines: MachineSnapshot[];
  outlierDetails?: Array<{
    day: string;
    predicted: number;
    actual: number;
    errorPct: number;
    probableCause: string;
  }>;
  timeContext?: {
    primaryWindow: string;
    baselineWindow: string;
    lastUpdatedAt: string;
  };
  escalationRule?: {
    rule: string;
    isTriggered: boolean;
  };
};

function accuracyBadgeClass(score: number) {
  if (score >= 80) return 'text-success';
  if (score >= 65) return 'text-warning';
  return 'text-destructive';
}

function riskClass(risk: MachineSnapshot['risk']) {
  if (risk === 'High') return 'text-destructive';
  if (risk === 'Medium') return 'text-warning';
  return 'text-success';
}

function demandStatusClass(status?: string) {
  if (status === 'Action Needed') return 'text-destructive';
  if (status === 'Watch' || status === 'Calibrating') return 'text-warning';
  return 'text-success';
}

function formatModelName(modelUsed: string) {
  const raw = String(modelUsed || '').trim().toLowerCase();
  if (!raw) return 'Unknown';
  if (raw.includes('gemma-4')) return 'Gemma 4';
  if (raw.includes('qwen2.5')) return 'Qwen 2.5';
  if (raw.includes('deepseek')) return 'DeepSeek';

  const withoutProvider = raw.includes('/') ? raw.split('/').pop() || raw : raw;
  return withoutProvider
    .replace(/:free$/i, '')
    .replace(/-it$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

function deltaLabel(delta: number | undefined, lowerIsBetter = false) {
  const d = Number(delta || 0);
  if (Math.abs(d) < 0.05) return '→ 0.0';
  const arrow = d > 0 ? '↑' : '↓';
  const sign = d > 0 ? '+' : '';
  const polarity = lowerIsBetter
    ? (d > 0 ? 'worse' : 'better')
    : (d > 0 ? 'better' : 'worse');
  return `${arrow} ${sign}${Math.round(d * 10) / 10} (${polarity})`;
}

function parseDayLabelToDate(dayLabel: string, yearHint: number): Date | null {
  if (!dayLabel || typeof dayLabel !== 'string') return null;
  const parts = dayLabel.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const day = Number.parseInt(parts[0], 10);
  const monthShort = parts[1].slice(0, 3).toLowerCase();
  const monthMap: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  if (!Number.isFinite(day) || !(monthShort in monthMap)) return null;

  const date = new Date(yearHint, monthMap[monthShort], day);
  return Number.isFinite(date.getTime()) ? date : null;
}

function DemandBacktestTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: DemandAccuracyPoint }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  const delta = Math.round((point.predicted - point.actual) * 10) / 10;
  const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`;

  return (
    <div className="rounded-md border border-border/70 bg-background/95 px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-muted-foreground mt-1">Predicted: <span className="text-foreground">{point.predicted}</span> kVA</p>
      <p className="text-muted-foreground">Actual: <span className="text-foreground">{point.actual}</span> kVA</p>
      <p className="text-muted-foreground">Gap (Pred-Actual): <span className="text-foreground">{deltaLabel}</span> kVA</p>
      <p className="text-muted-foreground">Absolute error: <span className="text-foreground">{point.errorPct}%</span></p>
      <p className="mt-1 text-foreground/90">
        20% band: {point.hit ? 'Hit' : 'Miss'} | 10% band: {point.hit10 ? 'Hit' : 'Miss'}
      </p>
    </div>
  );
}

export default function IntelligenceReportDocument({ data }: { data: IntelligenceReportDocumentData }) {
  const displayModelName = useMemo(() => formatModelName(data.modelUsed), [data.modelUsed]);

  const demandChartData = useMemo(() => {
    const source = Array.isArray(data.charts.demandAccuracyTrend) ? data.charts.demandAccuracyTrend : [];
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const parsed = source
      .map((point) => ({
        ...point,
        _date: parseDayLabelToDate(point.day, currentYear),
      }))
      .filter((point) => point._date instanceof Date)
      .sort((a, b) => (a._date!.getTime() - b._date!.getTime()));

    const currentMonthOnly = parsed.filter((point) => point._date!.getMonth() === currentMonth);
    const selected = currentMonthOnly.length > 0 ? currentMonthOnly : parsed;

    return selected.map(({ _date, ...rest }) => rest);
  }, [data.charts.demandAccuracyTrend]);

  const insightConfidenceLabel = data.aiAccuracy.insightConfidence == null
    ? 'N/A'
    : `${data.aiAccuracy.insightConfidence}%${data.aiAccuracy.insightConfidenceEstimated ? ' (estimated)' : ''}`;

  const demandBacktestLabel = data.aiAccuracy.demandBacktestReady
    ? `${data.aiAccuracy.demandBacktest}%`
    : `Pending (${data.aiAccuracy.demandBacktestSamples ?? 0}/${data.aiAccuracy.demandBacktestMinSamples ?? 7} days)`;

  const kpiCards = [
    { label: 'AI Accuracy', value: `${data.aiAccuracy.overall}%` },
    { label: 'Machines Running', value: `${data.kpis.runningMachines}/${data.kpis.totalMachines}` },
    { label: 'Avg Efficiency', value: `${data.kpis.avgEfficiency}%` },
    { label: 'Reject Rate', value: `${data.kpis.rejectRatePct}%` },
    { label: 'Total Production', value: `${data.kpis.totalProduction}` },
    { label: 'Total Energy', value: `${data.kpis.totalEnergy} kWh` },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border/60 bg-background/50 p-4">
        <h3 className="text-lg font-semibold text-foreground">{data.title}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Generated: {new Date(data.generatedAt).toLocaleString()} | Model: {displayModelName}
        </p>
        <p className="text-sm text-foreground/90 mt-3 leading-relaxed">{data.executiveSummary}</p>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
            <p className="text-lg font-semibold text-foreground mt-1">{kpi.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-border/60 bg-background/40 p-4">
        <h4 className="text-sm font-semibold text-foreground">AI Accuracy Breakdown</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
          <div>Overall: <span className={accuracyBadgeClass(data.aiAccuracy.overall)}>{data.aiAccuracy.overall}%</span></div>
          <div>Insight confidence: {insightConfidenceLabel}</div>
          <div>Predictive confidence: {data.aiAccuracy.predictiveConfidence}%</div>
          <div>Data freshness: {data.aiAccuracy.dataFreshness}%</div>
          <div>Demand backtest: {demandBacktestLabel}</div>
          <div>Hit-rate (20%): {data.aiAccuracy.demandHitRate}% | Target &gt;= 75% | {deltaLabel(data.aiAccuracy.demandHitRateDelta, false)}</div>
          <div>Demand hit-rate (10% band): {data.aiAccuracy.demandHitRate10 ?? 0}%</div>
          <div>Demand hit-rate (30d baseline): {data.aiAccuracy.demandHitRate30 ?? data.aiAccuracy.demandHitRate}%</div>
          <div>MAPE: {data.aiAccuracy.demandMape}% | Target &lt;= 15% | {deltaLabel(data.aiAccuracy.demandMapeDelta, true)}</div>
          <div>Demand MAPE (raw): {data.aiAccuracy.demandMapeRaw ?? data.aiAccuracy.demandMape}%</div>
          <div>Demand MAPE (30d baseline): {data.aiAccuracy.demandMape30 ?? data.aiAccuracy.demandMape}%</div>
          <div>Outlier days (&gt;30% error): {data.aiAccuracy.demandOutlierDays ?? 0}</div>
          <div>
            Demand status: <span className={demandStatusClass(data.aiAccuracy.demandStatus)}>{data.aiAccuracy.demandStatus ?? 'Calibrating'}</span>
          </div>
        </div>
        {data.aiAccuracy.forecastQualityWarning && (
          <p className="text-xs text-warning mt-3">{data.aiAccuracy.forecastQualityWarning}</p>
        )}
        <p className={`text-xs mt-1 ${data.aiAccuracy.forecastReliable === false ? 'text-warning' : 'text-muted-foreground'}`}>
          Forecast reliability: {data.aiAccuracy.forecastReliabilityLabel ?? (data.aiAccuracy.forecastReliable === false ? 'Use with caution' : 'Reliable')}
          {data.aiAccuracy.reliabilityGateReason ? ` - ${data.aiAccuracy.reliabilityGateReason}` : ''}
        </p>
      </section>

      {data.aiAccuracy.confidenceBreakdown && (
        <section className="rounded-lg border border-border/60 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Confidence Breakdown</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>Data freshness score: {data.aiAccuracy.confidenceBreakdown.dataFreshness.value}% | Weight: {data.aiAccuracy.confidenceBreakdown.dataFreshness.weightPct}%</div>
            <div>Data completeness score: {data.aiAccuracy.confidenceBreakdown.dataCompleteness.value}% | Weight: {data.aiAccuracy.confidenceBreakdown.dataCompleteness.weightPct}%</div>
            <div>Model consistency score: {data.aiAccuracy.confidenceBreakdown.modelConsistency.value}% | Weight: {data.aiAccuracy.confidenceBreakdown.modelConsistency.weightPct}%</div>
            <div>Backtest stability score: {data.aiAccuracy.confidenceBreakdown.backtestStability.value}% | Weight: {data.aiAccuracy.confidenceBreakdown.backtestStability.weightPct}%</div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Data completeness: {data.aiAccuracy.dataCompletenessPct ?? 0}% | Missing intervals: {data.aiAccuracy.missingIntervalsCount ?? 0}
          </p>
        </section>
      )}

      {data.aiAccuracy.metricProvenance && (
        <section className="rounded-lg border border-border/60 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-foreground mb-2">Metric Provenance (Audit Mode)</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div>Insight confidence: {data.aiAccuracy.metricProvenance.insightConfidence ?? 'N/A'}</div>
            <div>Predictive confidence: {data.aiAccuracy.metricProvenance.predictiveConfidence ?? 'N/A'}</div>
            <div>Data freshness: {data.aiAccuracy.metricProvenance.dataFreshness ?? 'N/A'}</div>
            <div>Data completeness: {data.aiAccuracy.metricProvenance.dataCompletenessPct ?? 'N/A'}</div>
            <div>Demand backtest: {data.aiAccuracy.metricProvenance.demandBacktest ?? 'N/A'}</div>
            <div>Demand hit-rate (20%): {data.aiAccuracy.metricProvenance.demandHitRate ?? 'N/A'}</div>
            <div>Demand MAPE: {data.aiAccuracy.metricProvenance.demandMape ?? 'N/A'}</div>
            <div>Model consistency: {data.aiAccuracy.metricProvenance.modelConsistency ?? 'N/A'}</div>
            <div>Demand status: {data.aiAccuracy.metricProvenance.demandStatus ?? 'N/A'}</div>
            <div>Forecast reliability: {data.aiAccuracy.metricProvenance.forecastReliable ?? 'N/A'}</div>
          </div>
        </section>
      )}

      {Array.isArray(data.outlierDetails) && data.outlierDetails.length > 0 && (
        <section className="rounded-lg border border-border/60 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Top Outlier Days (Error)</h4>
          <div className="space-y-2">
            {data.outlierDetails.map((o, idx) => (
              <div key={`${o.day}-${idx}`} className="rounded-md border border-border/50 bg-background/40 p-3 text-sm">
                <p className="font-medium text-foreground">{idx + 1}. {o.day} • Error {o.errorPct}%</p>
                <p className="text-muted-foreground">Predicted: {o.predicted} | Actual: {o.actual} | Probable cause: {o.probableCause}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.escalationRule && (
        <section className="rounded-lg border border-border/60 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-foreground mb-2">Escalation Rule</h4>
          <p className="text-sm text-foreground/90">{data.escalationRule.rule}</p>
          <p className={`text-xs mt-2 ${data.escalationRule.isTriggered ? 'text-destructive' : 'text-success'}`}>
            {data.escalationRule.isTriggered ? 'Escalation currently triggered' : 'Escalation not triggered'}
          </p>
        </section>
      )}

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div id="intel-chart-production" className="rounded-lg border border-border/60 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Production, Energy and Efficiency Trend</h4>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.charts.productionEnergyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis yAxisId="left" fontSize={11} />
                <YAxis yAxisId="right" orientation="right" fontSize={11} />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="production" stroke="hsl(187, 80%, 50%)" strokeWidth={2} name="Production" />
                <Line yAxisId="left" type="monotone" dataKey="energy" stroke="hsl(38, 92%, 50%)" strokeWidth={2} name="Energy (kWh)" />
                <Line yAxisId="right" type="monotone" dataKey="efficiency" stroke="hsl(152, 60%, 45%)" strokeWidth={2} name="Efficiency %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div id="intel-chart-demand" className="rounded-lg border border-border/60 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Demand Prediction Backtest</h4>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={demandChartData}
                margin={{ top: 8, right: 12, left: 4, bottom: 8 }}
                barCategoryGap="22%"
                barGap={3}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="day"
                  fontSize={10}
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  interval={0}
                  minTickGap={0}
                  tickMargin={8}
                  angle={-20}
                  textAnchor="end"
                  height={52}
                />
                <YAxis
                  fontSize={11}
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  width={34}
                />
                <Tooltip content={<DemandBacktestTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar dataKey="predicted" fill="hsl(217, 80%, 55%)" name="Predicted Peak" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" fill="hsl(187, 80%, 50%)" name="Actual Peak" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-background/40 p-4">
        <h4 className="text-sm font-semibold text-foreground mb-3">Machine Intelligence Snapshot</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Machine</th>
                <th className="py-2">Parts</th>
                <th className="py-2">Reject %</th>
                <th className="py-2">Efficiency %</th>
                <th className="py-2">PF</th>
                <th className="py-2">Energy</th>
                <th className="py-2">Risk</th>
              </tr>
            </thead>
            <tbody>
              {data.machines.map((m) => (
                <tr key={m.machine} className="border-t border-border/50">
                  <td className="py-2 font-medium">{m.machine}</td>
                  <td className="py-2">{m.parts}</td>
                  <td className="py-2">{m.rejectRate}%</td>
                  <td className="py-2">{m.efficiency}%</td>
                  <td className="py-2">{m.powerFactor}</td>
                  <td className="py-2">{m.energy} kWh</td>
                  <td className={`py-2 font-medium ${riskClass(m.risk)}`}>{m.risk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.sectionSummaries.length > 0 && (
        <section className="rounded-lg border border-border/60 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Section Summaries</h4>
          <div className="space-y-3">
            {data.sectionSummaries.map((s, idx) => (
              <div key={`${s.heading}-${idx}`}>
                <h5 className="text-sm font-medium text-foreground">{s.heading}</h5>
                <p className="text-sm text-muted-foreground mt-1">{s.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.recommendations.length > 0 && (
        <section className="rounded-lg border border-border/60 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Action Recommendations</h4>
          <ul className="space-y-2">
            {data.recommendations.map((r, idx) => (
              <li key={`${idx}-${r}`} className="text-sm text-foreground/90">{idx + 1}. {r}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
