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
  predictiveConfidence: number;
  dataFreshness: number;
  demandBacktest: number;
  demandHitRate: number;
  demandMape: number;
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

export default function IntelligenceReportDocument({ data }: { data: IntelligenceReportDocumentData }) {
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
          Generated: {new Date(data.generatedAt).toLocaleString()} | Model: {data.modelUsed}
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
          <div>Insight confidence: {data.aiAccuracy.insightConfidence}%</div>
          <div>Predictive confidence: {data.aiAccuracy.predictiveConfidence}%</div>
          <div>Data freshness: {data.aiAccuracy.dataFreshness}%</div>
          <div>Demand backtest: {data.aiAccuracy.demandBacktest}%</div>
          <div>Demand hit-rate: {data.aiAccuracy.demandHitRate}%</div>
          <div>Demand MAPE: {data.aiAccuracy.demandMape}%</div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border/60 bg-background/40 p-4">
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

        <div className="rounded-lg border border-border/60 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Demand Prediction Backtest</h4>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.demandAccuracyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="predicted" fill="hsl(217, 80%, 55%)" name="Predicted Peak" />
                <Bar dataKey="actual" fill="hsl(187, 80%, 50%)" name="Actual Peak" />
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
