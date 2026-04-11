import { useState, useEffect } from "react";
import { apiClient } from "@/services/apiClient";
import type { MachineData } from "@/types";
import { KPICard } from "@/components/KPICard";
import { Package, Target } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line
} from "recharts";

const tt = { contentStyle: { backgroundColor: '#ffffff', border: '1px solid hsl(215, 20%, 80%)', borderRadius: '8px', color: '#1a1a2e', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }, itemStyle: { color: '#1a1a2e' }, labelStyle: { color: '#1a1a2e', fontWeight: 600 } };

export default function ProductionAnalytics() {
  const [machines, setMachines] = useState<MachineData[]>([]);
  const [shiftProduction, setShiftProduction] = useState<Record<string, unknown>[]>([]);
  const [weeklyData, setWeeklyData] = useState<{ record_date?: string; day?: string; production: number }[]>([]);

  useEffect(() => {
    const fetchProduction = () => {
      apiClient.get("/metrics/realtime").then(r => setMachines(r.data)).catch(() => {});
      apiClient.get("/production/by-shift?scope=elapsed").then(r => setShiftProduction(r.data)).catch(() => {});
      apiClient.get("/production/weekly").then(r => setWeeklyData(r.data)).catch(() => {});
    };
    fetchProduction();
    const interval = setInterval(fetchProduction, 5000);
    return () => clearInterval(interval);
  }, []);

  // Recompute weekly chart data whenever machines (targets) or raw weekly data changes
  const dailyTarget = machines.length > 0
    ? machines.reduce((s, m) => s + (m.production_target || 0), 0)
    : 1159;

  const getIstDateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  const normalizedWeekly = (weeklyData as { record_date?: string; day?: string; production: number; target?: number }[])
    .map((row) => {
      const d = new Date(row.record_date ?? row.day!);
      return {
        key: getIstDateKey(d),
        date: d,
        production: Number(row.production) || 0,
        target: Number(row.target ?? 0) || 0,
      };
    });

  const weeklyByDate = new Map<string, { production: number; target: number }>();
  normalizedWeekly.forEach((r) => {
    weeklyByDate.set(r.key, { production: r.production, target: r.target });
  });

  const recentTarget = [...normalizedWeekly]
    .reverse()
    .find((r) => r.target > 0)?.target || dailyTarget;

  const now = new Date();
  const weeklyChartData = Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - idx));
    const key = getIstDateKey(d);
    const row = weeklyByDate.get(key);
    const weekday = d.toLocaleDateString('en-IN', { weekday: 'short' });
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    return {
      day: `${weekday} ${dateStr}`,
      production: row?.production ?? 0,
      target: row?.target && row.target > 0 ? row.target : recentTarget,
    };
  });

  const machineProduction = machines.map(m => ({
    name: m.id,
    produced: m.parts_produced,
    rejected: m.rejection_count,
    target: m.production_target || Math.round(m.parts_produced * 1.15),
  }));

  const totalParts = machines.reduce((s, m) => s + m.parts_produced, 0);
  const totalRejected = machines.reduce((s, m) => s + m.rejection_count, 0);
  const totalTarget = machines.reduce((s, m) => s + (m.production_target || 0), 0);
  const targetAchievement = totalTarget > 0 ? ((totalParts / totalTarget) * 100).toFixed(1) : "--";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Production Analytics</h1>
        <p className="text-sm text-muted-foreground">Shift-wise and machine-wise production analysis</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Total Parts Today" value={totalParts} icon={<Package className="h-4 w-4" />} variant="primary" />
        <KPICard title="Rejected Parts" value={totalRejected} variant="destructive" />
        <KPICard title="Rejection Rate" value={totalParts > 0 ? ((totalRejected / totalParts) * 100).toFixed(1) : "0.0"} unit="%" />
        <KPICard title="Target Achievement" value={targetAchievement} unit="%" icon={<Target className="h-4 w-4" />} variant="success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Parts per CNC (Target vs Actual)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={machineProduction}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="name" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <Tooltip {...tt} />
                <Legend />
                <Bar dataKey="produced" fill="hsl(187, 80%, 50%)" name="Produced" radius={[2, 2, 0, 0]} />
                <Bar dataKey="target" fill="hsl(222, 20%, 25%)" name="Target" radius={[2, 2, 0, 0]} />
                <Bar dataKey="rejected" fill="hsl(0, 72%, 51%)" name="Rejected" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Shift-wise Production</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={shiftProduction}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="shift" stroke="hsl(215, 15%, 55%)" fontSize={9} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <Tooltip {...tt} />
                <Legend />
                <Bar dataKey="CNC-1" fill="hsl(187, 80%, 50%)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="CNC-2" fill="hsl(152, 60%, 45%)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="CNC-3" fill="hsl(38, 92%, 50%)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="CNC-4" fill="hsl(217, 80%, 55%)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="CNC-5" fill="hsl(270, 60%, 55%)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-container lg:col-span-2">
          <h3 className="text-sm font-medium text-foreground mb-4">Weekly Production Trend</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weeklyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="day" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <Tooltip {...tt} />
                <Legend />
                <Bar dataKey="production" fill="hsl(187, 80%, 50%)" name="Production" radius={[2, 2, 0, 0]} />
                <Line type="linear" dataKey="target" stroke="hsl(0, 72%, 51%)" name="Target" strokeDasharray="5 5" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
