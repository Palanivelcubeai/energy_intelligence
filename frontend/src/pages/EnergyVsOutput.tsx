import { useState, useMemo, useEffect } from "react";
import { subDays, startOfDay, endOfDay, format } from "date-fns";
import { KPICard } from "@/components/KPICard";
import { DateFilterBar } from "@/components/DateFilterBar";
import { ChartContainer } from "@/components/ChartContainer";
import { EmptyState } from "@/components/EmptyState";
import { Award, TrendingDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { apiClient } from "@/services/apiClient";

const tt = { contentStyle: { backgroundColor: '#ffffff', border: '1px solid hsl(215, 20%, 80%)', borderRadius: '8px', color: '#1a1a2e', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }, itemStyle: { color: '#1a1a2e' }, labelStyle: { color: '#1a1a2e', fontWeight: 600 } };
const COLORS = ['hsl(187, 80%, 50%)', 'hsl(152, 60%, 45%)', 'hsl(38, 92%, 50%)', 'hsl(217, 80%, 55%)', 'hsl(270, 60%, 55%)'];

interface AggRow {
  name: string;
  machineName: string;
  energy_per_part: number;
  cost_per_part: number;
  totalEnergy: number;
  totalParts: number;
  avgEfficiency: number;
}

export default function EnergyVsOutput() {
  const [aiModeEnabled, setAiModeEnabled] = useState<boolean>(() => localStorage.getItem("ai_mode_enabled") === "1");
  const [from, setFrom] = useState(() => startOfDay(subDays(new Date(), 6)));
  const [to, setTo] = useState(() => endOfDay(new Date()));
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AggRow[]>([]);

  const fetchData = (f: Date, t: Date) => {
    setLoading(true);
    apiClient.get("/energy-output/aggregate", {
      params: { from: format(f, 'yyyy-MM-dd'), to: format(t, 'yyyy-MM-dd') }
    }).then(r => {
      setData(r.data.map((row: AggRow) => ({
        ...row,
        energy_per_part: Number(row.energy_per_part),
        cost_per_part: Number(row.cost_per_part),
      })));
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData(from, to);
    const interval = setInterval(() => fetchData(from, to), 30000);
    return () => clearInterval(interval);
  }, [from, to]);

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

  const handleDateChange = (f: Date, t: Date) => {
    setFrom(f);
    setTo(t);
  };

  const isEmpty = data.length === 0;

  const best = data.length ? data.reduce((a, b) => a.energy_per_part < b.energy_per_part ? a : b) : null;
  const worst = data.length ? data.reduce((a, b) => a.energy_per_part > b.energy_per_part ? a : b) : null;

  const ranking = [...data].sort((a, b) => a.energy_per_part - b.energy_per_part);

  const bestAi = !aiModeEnabled || !best
    ? undefined
    : {
        type: "Recommendation" as const,
        text: `${best.name} is currently best performer. Use it as benchmark for parameter replication across lower-ranked machines.`,
      };

  const bestMetricAi = !aiModeEnabled || !best
    ? undefined
    : {
        type: "Prediction" as const,
        text: "If quality yield remains stable, best kWh/part can be sustained through this reporting window.",
      };

  const worstAi = !aiModeEnabled || !worst
    ? undefined
    : {
        type: "Suggestion" as const,
        text: `${worst.name} needs focused review for cycle-time and idle-load inefficiencies to reduce energy intensity.`,
      };

  const worstMetricAi = !aiModeEnabled || !worst
    ? undefined
    : {
        type: "Idea" as const,
        text: "Run side-by-side comparison of best vs worst machine setup to isolate avoidable energy losses.",
      };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Energy vs Output</h1>
        <p className="text-sm text-muted-foreground">Energy efficiency comparison across CNC machines</p>
      </div>

      <DateFilterBar from={from} to={to} onChange={handleDateChange} />

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard title="Best Machine" value={best!.name} icon={<Award className="h-4 w-4" />} variant="success" aiInsight={bestAi} />
            <KPICard title="Best kWh/Part" value={best!.energy_per_part} unit="kWh" variant="success" aiInsight={bestMetricAi} />
            <KPICard title="Worst Machine" value={worst!.name} icon={<TrendingDown className="h-4 w-4" />} variant="warning" aiInsight={worstAi} />
            <KPICard title="Worst kWh/Part" value={worst!.energy_per_part} unit="kWh" variant="warning" aiInsight={worstMetricAi} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartContainer title="Energy per Part (Machine-wise)" loading={loading}>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                    <XAxis dataKey="name" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                    <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" kWh" />
                    <Tooltip {...tt} />
                    <Bar dataKey="energy_per_part" name="kWh/Part" radius={[4, 4, 0, 0]}>
                      {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartContainer>

            <ChartContainer title="Cost per Part (₹)" loading={loading}>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                    <XAxis dataKey="name" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                    <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" ₹" />
                    <Tooltip {...tt} />
                    <Bar dataKey="cost_per_part" name="₹/Part" radius={[4, 4, 0, 0]}>
                      {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartContainer>
          </div>

          {/* Efficiency Ranking */}
          <ChartContainer title="⚡ Efficiency Ranking" loading={loading}>
            <div className="space-y-2">
              {ranking.map((m, i) => (
                <div key={m.name} className="flex items-center gap-3 p-3 rounded-md bg-secondary/30">
                  <span className="text-lg font-bold font-mono text-primary w-6">#{i + 1}</span>
                  <span className="text-sm font-medium text-foreground flex-1">{m.machineName}</span>
                  <span className="text-sm font-mono text-foreground">{m.energy_per_part} kWh/part</span>
                  <span className="text-xs font-mono text-muted-foreground">₹{m.cost_per_part}/part</span>
                </div>
              ))}
            </div>
          </ChartContainer>
        </>
      )}
    </div>
  );
}
