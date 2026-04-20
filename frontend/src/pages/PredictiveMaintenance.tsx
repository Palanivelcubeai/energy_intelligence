import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/services/apiClient";
import { KPICard } from "@/components/KPICard";
import { AlertTriangle, ShieldAlert, Wrench, Activity } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface MaintenanceMachine {
  id: string;
  name: string;
  status: string;
  riskScore: number;
  riskDelta: number;
  riskLevel: "Low" | "Medium" | "High" | "Critical";
  nextMaintenanceDays: number;
  maintenanceWindow: "Immediate" | "Next 3 days" | "This week" | "Normal";
  confidencePct: number;
  alerts: string[];
  recommendedAction: string;
  contributingFactors: string[];
  conditions: {
    heatC: number;
    powerKw: number;
    powerLoadPct: number;
    powerPerPartKwh: number | null;
    healthScore: number;
    vibrationMmS: number;
  };
  signalMeta: {
    sampleMinutes: number;
    lastSampleAgoMinutes: number;
  };
}

interface PredictiveResponse {
  summary: {
    totalMachines: number;
    criticalCount: number;
    highCount: number;
    dueSoonCount: number;
    avgRiskScore: number;
    avgHealth: number;
    avgConfidence: number;
  };
  machines: MaintenanceMachine[];
  generatedAt: string;
}

const tt = {
  contentStyle: {
    backgroundColor: "#ffffff",
    border: "1px solid hsl(215, 20%, 80%)",
    borderRadius: "8px",
    color: "#1a1a2e",
    fontSize: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  },
  itemStyle: { color: "#1a1a2e" },
  labelStyle: { color: "#1a1a2e", fontWeight: 600 },
};

const COLORS = {
  Low: "hsl(152, 60%, 45%)",
  Medium: "hsl(38, 92%, 50%)",
  High: "hsl(25, 95%, 53%)",
  Critical: "hsl(0, 72%, 51%)",
};

const MACHINE_DISPLAY_ORDER = ["CNC-1", "CNC-2", "CNC-3", "CNC-4", "CNC-5"];

function getMachineOrderIndex(machineId: string): number {
  const idx = MACHINE_DISPLAY_ORDER.indexOf(machineId);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

export default function PredictiveMaintenance() {
  const [aiModeEnabled, setAiModeEnabled] = useState<boolean>(() => localStorage.getItem("ai_mode_enabled") === "1");
  const [data, setData] = useState<PredictiveResponse>({
    summary: { totalMachines: 0, criticalCount: 0, highCount: 0, dueSoonCount: 0, avgRiskScore: 0, avgHealth: 0, avgConfidence: 0 },
    machines: [],
    generatedAt: new Date().toISOString(),
  });

  useEffect(() => {
    let active = true;

    const fetchPredictive = () => {
      apiClient
        .get("/maintenance/predictive")
        .then((r) => {
          if (!active) return;
          setData(r.data);
        })
        .catch(() => {});
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible") {
        fetchPredictive();
      }
    };

    fetchPredictive();
    const interval = setInterval(fetchPredictive, 15000);
    window.addEventListener("focus", handleVisibilityRefresh);
    document.addEventListener("visibilitychange", handleVisibilityRefresh);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", handleVisibilityRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
    };
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

  const sortedMachines = useMemo(
    () => [...data.machines].sort((a, b) => getMachineOrderIndex(a.id) - getMachineOrderIndex(b.id)),
    [data.machines]
  );

  const chartData = sortedMachines.map((m) => ({
    name: m.id,
    riskScore: m.riskScore,
    healthScore: m.conditions.healthScore,
    riskLevel: m.riskLevel,
  }));

  const criticalAi = !aiModeEnabled
    ? undefined
    : data.summary.criticalCount > 0
      ? {
          type: "Recommendation" as const,
          text: "Critical machines detected. Prioritize immediate inspection and controlled load operation.",
        }
      : {
          type: "Prediction" as const,
          text: "No critical machine currently. Continue proactive checks to keep risk in low band.",
        };

  const highRiskAi = !aiModeEnabled
    ? undefined
    : data.summary.highCount > 0
      ? {
          type: "Suggestion" as const,
          text: "High-risk machines are present. Verify vibration and thermal drift before next cycle.",
        }
      : {
          type: "Idea" as const,
          text: "Use this low-risk window to tune thresholds and improve model calibration.",
        };

  const avgRiskAi = !aiModeEnabled
    ? undefined
    : data.summary.avgRiskScore >= 60
      ? {
          type: "Prediction" as const,
          text: "Average risk may escalate if current anomaly persistence continues into next shift.",
        }
      : {
          type: "Recommendation" as const,
          text: "Risk baseline is moderate/low. Maintain preventive checks and monitor top factors.",
        };

  const confidenceAi = !aiModeEnabled
    ? undefined
    : data.summary.avgConfidence >= 75
      ? {
          type: "Prediction" as const,
          text: "Model confidence is healthy. AI advisories are reliable for maintenance planning support.",
        }
      : {
          type: "Suggestion" as const,
          text: "Confidence is limited. Cross-check alerts with manual diagnostics before action.",
        };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Predictive Maintenance</h1>
        <p className="text-sm text-muted-foreground">
          Predict machine maintenance risk using live conditions: heat, power, speed, health, and vibration.
        </p>
        <p className="text-xs text-muted-foreground mt-1">Last prediction run: {new Date(data.generatedAt).toLocaleString()}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard
          title="Critical Machines"
          value={data.summary.criticalCount}
          icon={<ShieldAlert className="h-4 w-4" />}
          variant={data.summary.criticalCount > 0 ? "destructive" : "success"}
          aiInsight={criticalAi}
        />
        <KPICard
          title="High Risk Machines"
          value={data.summary.highCount}
          icon={<AlertTriangle className="h-4 w-4" />}
          variant={data.summary.highCount > 0 ? "warning" : "success"}
          aiInsight={highRiskAi}
        />
        <KPICard
          title="Due This Week"
          value={data.summary.dueSoonCount}
          icon={<Wrench className="h-4 w-4" />}
          variant={data.summary.dueSoonCount > 0 ? "warning" : "success"}
        />
        <KPICard
          title="Average Risk"
          value={data.summary.avgRiskScore}
          unit="/100"
          icon={<Activity className="h-4 w-4" />}
          variant={data.summary.avgRiskScore >= 60 ? "warning" : "primary"}
          aiInsight={avgRiskAi}
        />
        <KPICard
          title="Average Health"
          value={data.summary.avgHealth}
          unit="/100"
          icon={<Wrench className="h-4 w-4" />}
          variant={data.summary.avgHealth >= 75 ? "success" : "warning"}
        />
        <KPICard
          title="Model Confidence"
          value={data.summary.avgConfidence}
          unit="%"
          icon={<Activity className="h-4 w-4" />}
          variant={data.summary.avgConfidence >= 75 ? "success" : "warning"}
          aiInsight={confidenceAi}
        />
      </div>

      <div className="chart-container">
        <h3 className="text-sm font-medium text-foreground mb-4">Risk Score by Machine</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
              <XAxis dataKey="name" stroke="hsl(215, 15%, 55%)" fontSize={10} />
              <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} domain={[0, 100]} />
              <Tooltip {...tt} />
              <Bar dataKey="riskScore" name="Risk Score" radius={[4, 4, 0, 0]}>
                {chartData.map((row, i) => (
                  <Cell key={i} fill={COLORS[row.riskLevel]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-3">
        {sortedMachines.map((m) => (
          <div key={m.id} className="kpi-card">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{m.name && m.name !== m.id ? `${m.id} • ${m.name}` : m.id}</h3>
                <p className="text-xs text-muted-foreground">Next maintenance in {m.nextMaintenanceDays} day(s) • {m.maintenanceWindow}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">Risk</span>
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded"
                  style={{ backgroundColor: `${COLORS[m.riskLevel]}1A`, color: COLORS[m.riskLevel] }}
                >
                  {m.riskLevel} • {m.riskScore}/100
                </span>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {m.riskDelta > 0 ? `+${m.riskDelta}` : m.riskDelta}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
              <Metric label="Heat" value={`${m.conditions.heatC} °C`} />
              <Metric label="Power" value={`${m.conditions.powerKw} kW`} sub={`${m.conditions.powerLoadPct}% load`} />
              <Metric
                label="Power/Part"
                value={m.conditions.powerPerPartKwh == null ? "N/A" : `${m.conditions.powerPerPartKwh.toFixed(3)} kWh`}
                sub={m.conditions.powerPerPartKwh == null ? "No parts produced in latest sample" : undefined}
              />
              <Metric label="Health" value={`${m.conditions.healthScore}/100`} />
              <Metric label="Vibration" value={`${m.conditions.vibrationMmS} mm/s`} />
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Top factors:</span> {m.contributingFactors.join(", ")}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              <span className="font-medium text-foreground">Recommended action:</span> {m.recommendedAction}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              <span className="font-medium text-foreground">Data quality:</span> {m.confidencePct}% confidence • latest sample {m.signalMeta.lastSampleAgoMinutes} min ago
            </div>
            {m.alerts.length > 0 && (
              <div className={`mt-2 text-xs ${m.riskLevel === "Low" ? "text-muted-foreground" : "text-warning"}`}>
                <span className="font-medium">{m.riskLevel === "Low" ? "Advisories:" : "Alerts:"}</span> {m.alerts.join(" • ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-secondary/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-mono text-foreground">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
