import { useState, useEffect } from "react";
import { KPICard } from "@/components/KPICard";
import { InsightCard } from "@/components/InsightCard";
import { apiClient } from "@/services/apiClient";
import type { MachineData, InsightData } from "@/types";
import { Zap, Package, Gauge, TrendingUp, IndianRupee, Factory, BarChart3, Activity } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend, ComposedChart, Line
} from "recharts";

const COLORS = [
  'hsl(187, 80%, 50%)', 'hsl(152, 60%, 45%)', 'hsl(38, 92%, 50%)',
  'hsl(217, 80%, 55%)', 'hsl(270, 60%, 55%)'
];

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: '#ffffff',
    border: '1px solid hsl(215, 20%, 80%)',
    borderRadius: '8px',
    color: '#1a1a2e',
    fontSize: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
  itemStyle: {
    color: '#1a1a2e',
  },
  labelStyle: {
    color: '#1a1a2e',
    fontWeight: 600,
  },
  cursor: { fill: 'rgba(100,160,255,0.08)' },
};

const OVERVIEW_INSIGHTS_CACHE_KEY = "overview_top_insights_v1";
const AI_INSIGHTS_SHARED_CACHE_KEY = "ai-insights-cache-v1";

function readOverviewInsightsCache(): InsightData[] {
  try {
    const raw = sessionStorage.getItem(OVERVIEW_INSIGHTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeOverviewInsightsCache(items: InsightData[]) {
  try {
    sessionStorage.setItem(OVERVIEW_INSIGHTS_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage errors and keep runtime state only.
  }
}

function readSharedAiInsightsCache(): InsightData[] {
  try {
    const raw = sessionStorage.getItem(AI_INSIGHTS_SHARED_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function buildEmergencyInsightsFromRealtime(rows: MachineData[]): InsightData[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const sortedByReject = [...rows].sort((a, b) => Number(b?.rejection_count || 0) - Number(a?.rejection_count || 0));
  const sortedByEfficiency = [...rows].sort((a, b) => Number(a?.efficiency_score || 0) - Number(b?.efficiency_score || 0));
  const sortedByEnergy = [...rows].sort((a, b) => Number(b?.kWh || 0) - Number(a?.kWh || 0));

  const topReject = sortedByReject[0];
  const lowEfficiency = sortedByEfficiency[0];
  const highEnergy = sortedByEnergy[0];

  const fallback: InsightData[] = [];

  if (topReject && Number(topReject.rejection_count || 0) > 0) {
    fallback.push({
      id: `ovw-reject-${topReject.id}`,
      severity: "warning",
      message: `${topReject.id} has highest rejects (${Number(topReject.rejection_count || 0)}) today`,
      financial_impact: "Higher scrap and rework cost",
      production_impact: "Reduced net good output",
      confidence: 74,
      suggested_action: `Run first-piece quality check and tool inspection on ${topReject.id}`,
      machine: topReject.id,
    });
  }

  if (lowEfficiency) {
    fallback.push({
      id: `ovw-eff-${lowEfficiency.id}`,
      severity: Number(lowEfficiency.efficiency_score || 0) < 70 ? "critical" : "warning",
      message: `${lowEfficiency.id} has lowest efficiency (${Number(lowEfficiency.efficiency_score || 0)}%)`,
      financial_impact: "Higher cost per accepted part",
      production_impact: "Lower throughput vs target",
      confidence: 76,
      suggested_action: `Review feed/speed and setup conditions on ${lowEfficiency.id}`,
      machine: lowEfficiency.id,
    });
  }

  if (highEnergy) {
    fallback.push({
      id: `ovw-energy-${highEnergy.id}`,
      severity: "info",
      message: `${highEnergy.id} is highest energy consumer (${Number(highEnergy.kWh || 0).toFixed(1)} kWh)`,
      financial_impact: "Largest contributor to today's energy bill",
      production_impact: "Energy intensity may impact cost competitiveness",
      confidence: 72,
      suggested_action: `Audit idle/runtime energy profile on ${highEnergy.id}`,
      machine: highEnergy.id,
    });
  }

  return fallback.slice(0, 4);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export default function Overview() {
  const cachedInsights = readOverviewInsightsCache();
  const [aiModeEnabled, setAiModeEnabled] = useState<boolean>(() => localStorage.getItem("ai_mode_enabled") === "1");
  const [machines, setMachines] = useState<MachineData[]>([]);
  const [loadCurve, setLoadCurve] = useState<{ time: string; value: number }[]>([]);
  const [prodTrend, setProdTrend] = useState<{ time: string; production: number; energy: number }[]>([]);
  const [carbonIntervals, setCarbonIntervals] = useState<any[]>([]);
  const [monthlyProduction, setMonthlyProduction] = useState<{ month: string; production: number }[]>([]);
  const [topInsights, setTopInsights] = useState<InsightData[]>(cachedInsights);
  const [insightsLoading, setInsightsLoading] = useState(cachedInsights.length === 0);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [kpis, setKpis] = useState({ maxDemand: 0, monthlyProduction: 0, avgEfficiency: 0 });
  const [dailyComparison, setDailyComparison] = useState<{
    energy: { percentChange: number };
    parts: { percentChange: number };
    cost: { percentChange: number };
    energyPerPart: { percentChange: number };
  } | null>(null);

  const loadFallbackInsights = async () => {
    const sharedAi = readSharedAiInsightsCache();
    if (sharedAi.length > 0) {
      setTopInsights(sharedAi.slice(0, 4));
      writeOverviewInsightsCache(sharedAi.slice(0, 4));
      setInsightsError(null);
      return;
    }

    try {
      const realtime = await withTimeout(apiClient.get("/metrics/realtime", { timeout: 10000 }), 11000, "overview realtime");
      const rows = Array.isArray(realtime.data) ? realtime.data : [];
      const fallback = buildEmergencyInsightsFromRealtime(rows);
      setTopInsights(fallback);
      if (fallback.length > 0) writeOverviewInsightsCache(fallback);
      setInsightsError(fallback.length > 0 ? null : "AI insights are currently unavailable.");
    } catch {
      setTopInsights([]);
      setInsightsError("AI insights are currently unavailable.");
    }
  };

  // Poll realtime machine state every 10 seconds
  useEffect(() => {
    const fetchRealtime = () =>
      apiClient.get("/metrics/realtime").then(r => setMachines(r.data)).catch(() => {});
    fetchRealtime();
    const interval = setInterval(fetchRealtime, 10000);
    return () => clearInterval(interval);
  }, []);

  // Poll load-curve and production-trend every 30 seconds (hourly buckets — no need for faster)
  useEffect(() => {
    const fetchCharts = () => {
      apiClient.get("/metrics/load-curve").then(r => setLoadCurve(r.data)).catch(() => {});
      apiClient.get("/metrics/production-trend").then(r => setProdTrend(r.data)).catch(() => {});
      apiClient.get("/carbon/by-machine-interval").then(r => setCarbonIntervals(r.data)).catch(() => {});
    };
    fetchCharts();
    const interval = setInterval(fetchCharts, 30000);
    return () => clearInterval(interval);
  }, []);

  // Refresh non-realtime KPIs periodically
  useEffect(() => {
    const fetchKpis = () => {
      apiClient.get("/production/monthly").then(r => setMonthlyProduction(r.data)).catch(() => {});
      withTimeout(apiClient.get("/insights/top", { timeout: 12000 }), 13000, "overview insights")
        .then((r) => {
          const data = Array.isArray(r.data) ? r.data : [];
          if (data.length > 0) {
            setTopInsights(data);
            writeOverviewInsightsCache(data);
            setInsightsError(null);
            return;
          }

          loadFallbackInsights();
        })
        .catch(() => {
          loadFallbackInsights();
        })
        .finally(() => {
          setInsightsLoading(false);
        });
      apiClient.get("/metrics/kpis").then(r => setKpis(r.data)).catch(() => {});
      apiClient.get("/metrics/daily-comparison").then(r => setDailyComparison(r.data)).catch(() => {});
    };

    fetchKpis();
    const interval = setInterval(fetchKpis, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const syncAiMode = () => setAiModeEnabled(localStorage.getItem("ai_mode_enabled") === "1");
    const onCustomChange = (event: Event) => {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      if (typeof custom.detail?.enabled === "boolean") {
        setAiModeEnabled(custom.detail.enabled);
        return;
      }
      syncAiMode();
    };

    window.addEventListener("storage", syncAiMode);
    window.addEventListener("ai-mode-changed", onCustomChange as EventListener);

    return () => {
      window.removeEventListener("storage", syncAiMode);
      window.removeEventListener("ai-mode-changed", onCustomChange as EventListener);
    };
  }, []);

  const totalEnergy = machines.reduce((s, m) => s + m.kWh, 0);
  const totalParts = machines.reduce((s, m) => s + m.parts_produced, 0);
  const totalLoad = machines.reduce((s, m) => s + m.kW, 0);
  const avgEnergyPerPart = totalParts > 0 && Number.isFinite(totalEnergy / totalParts)
    ? (totalEnergy / totalParts)
    : 0;
  const pieData = machines.map(m => ({ name: m.id, value: m.kWh }));

  const energyDelta = dailyComparison?.energy.percentChange ?? 0;
  const partsDelta = dailyComparison?.parts.percentChange ?? 0;
  const energyPerPartDelta = dailyComparison?.energyPerPart.percentChange ?? 0;
  const costDelta = dailyComparison?.cost.percentChange ?? 0;

  const energyAiInsight = !aiModeEnabled
    ? undefined
    : energyDelta < 0
      ? {
          type: "Prediction" as const,
          text: "Energy is trending down vs yesterday. If this pattern holds for next shift, daily cost is likely to reduce further.",
        }
      : {
          type: "Suggestion" as const,
          text: "Energy is up vs yesterday. Prioritize idle-time reduction and high-load machine checks to contain energy drift.",
        };

  const partsAiInsight = !aiModeEnabled
    ? undefined
    : partsDelta >= 0
      ? {
          type: "Recommendation" as const,
          text: "Production trend is positive. Maintain current setup discipline and monitor reject spikes to protect throughput gains.",
        }
      : {
          type: "Suggestion" as const,
          text: "Parts output is lower vs yesterday. Focus on bottleneck machine cycle-time and downtime causes in current shift.",
        };

  const energyPerPartAiInsight = !aiModeEnabled
    ? undefined
    : energyPerPartDelta < 0
      ? {
          type: "Prediction" as const,
          text: "Energy per part is improving. Sustained reject control can further improve energy intensity this cycle.",
        }
      : {
          type: "Recommendation" as const,
          text: "Energy per part is worsening. Review power-per-part on low-yield machines and optimize feed/speed profile.",
        };

  const costAiInsight = !aiModeEnabled
    ? undefined
    : costDelta < 0
      ? {
          type: "Idea" as const,
          text: "Cost trend is favorable. Capture this window as a benchmark and replicate best-performing machine settings.",
        }
      : {
          type: "Recommendation" as const,
          text: "Cost is trending up. Apply tariff-window aware scheduling and cut idle-loss contributors first.",
        };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Plant Overview</h1>
        <p className="text-sm text-muted-foreground">Real-time CNC energy & production intelligence</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard 
          title="Total Energy Today" 
          value={totalEnergy.toFixed(1)} 
          unit="kWh" 
          icon={<Zap className="h-4 w-4" />} 
          variant="primary" 
          trend={dailyComparison ? { value: dailyComparison.energy.percentChange, label: 'vs yesterday' } : undefined}
          aiInsight={energyAiInsight}
        />
        <KPICard 
          title="Parts Produced" 
          value={totalParts} 
          icon={<Package className="h-4 w-4" />} 
          trend={dailyComparison ? { value: dailyComparison.parts.percentChange, label: 'vs yesterday' } : undefined}
          aiInsight={partsAiInsight}
        />
        <KPICard 
          title="Avg Energy/Part" 
          value={avgEnergyPerPart.toFixed(2)} 
          unit="kWh" 
          icon={<Gauge className="h-4 w-4" />} 
          trend={dailyComparison ? { value: dailyComparison.energyPerPart.percentChange, label: 'improvement' } : undefined}
          aiInsight={energyPerPartAiInsight}
        />
        <KPICard title="Current Load" value={totalLoad.toFixed(1)} unit="kW" icon={<Activity className="h-4 w-4" />} variant="primary" />
        <KPICard title="Max Demand" value={kpis.maxDemand.toFixed(1)} unit="kVA" icon={<TrendingUp className="h-4 w-4" />} variant="warning" />
        <KPICard title="Monthly Production" value={kpis.monthlyProduction.toLocaleString()} icon={<Factory className="h-4 w-4" />} />
        <KPICard 
          title="Energy Cost Today"
          value={`₹${(totalEnergy * 8.5).toFixed(0)}`}
          icon={<IndianRupee className="h-4 w-4" />}
          trend={dailyComparison ? { value: dailyComparison.cost.percentChange, label: 'vs yesterday' } : undefined}
          aiInsight={costAiInsight}
        />
        <KPICard title="Plant Efficiency" value={kpis.avgEfficiency} unit="/100" icon={<BarChart3 className="h-4 w-4" />} variant="success" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Load Curve */}
        <div className="chart-container lg:col-span-2">
          <h3 className="text-sm font-medium text-foreground mb-4">24-Hour Load Curve</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={loadCurve}>
                <defs>
                  <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(187, 80%, 50%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(187, 80%, 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="time" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" kW" />
                <Tooltip {...chartTooltipStyle} />
                <Area type="monotone" dataKey="value" stroke="hsl(187, 80%, 50%)" fill="url(#loadGrad)" strokeWidth={2} name="Load (kW)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart */}
        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Energy Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip {...chartTooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Carbon 1hr Interval Chart */}
      <div className="chart-container">
        <h3 className="text-sm font-medium text-foreground mb-4">Carbon Emission (CO₂) by Machine - 1hr Intervals</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={carbonIntervals} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                {['CNC-1', 'CNC-2', 'CNC-3', 'CNC-4', 'CNC-5'].map((machine, idx) => (
                  <linearGradient key={`color${machine}`} id={`color${machine}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS[idx % COLORS.length]} stopOpacity={0.8}/>
                    <stop offset="95%" stopColor={COLORS[idx % COLORS.length]} stopOpacity={0.1}/>
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" vertical={false} />
              <XAxis dataKey="time" stroke="hsl(215, 15%, 55%)" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" kg" tickLine={false} axisLine={false} />
              <Tooltip 
                {...chartTooltipStyle} 
                formatter={(value: any, name: string) => [`${Number(value).toFixed(2)} kg`, name]} 
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
              {['CNC-1', 'CNC-2', 'CNC-3', 'CNC-4', 'CNC-5'].map((machine, idx) => (
                <Area
                  key={machine}
                  type="monotone"
                  dataKey={`${machine}_co2`}
                  name={machine}
                  stackId="1"
                  stroke={COLORS[idx % COLORS.length]}
                  strokeWidth={2}
                  fill={`url(#color${machine})`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Production vs Energy + Monthly + Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Production vs Energy (Today)</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={prodTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="time" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <Tooltip {...chartTooltipStyle} />
                <Bar dataKey="production" fill="hsl(187, 80%, 50%)" name="Parts" radius={[2, 2, 0, 0]} />
                <Line type="monotone" dataKey="energy" stroke="hsl(38, 92%, 50%)" name="Energy (kWh)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Monthly Production Trend</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyProduction}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="month" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <Tooltip {...chartTooltipStyle} />
                <Bar dataKey="production" fill="hsl(152, 60%, 45%)" name="Production" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AI Insights Panel */}
        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">🧠 AI Insights</h3>
          <div className="space-y-2 max-h-56 overflow-auto">
            {insightsLoading ? (
              <p className="text-xs text-muted-foreground">Loading insights...</p>
            ) : insightsError ? (
              <p className="text-xs text-muted-foreground">{insightsError}</p>
            ) : topInsights.length === 0 ? (
              <p className="text-xs text-muted-foreground">No insights available right now.</p>
            ) : (
              topInsights.map(i => (
                <InsightCard key={i.id} insight={i} compact />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
