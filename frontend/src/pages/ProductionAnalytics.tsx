import { useState, useEffect } from "react";
import { apiClient } from "@/services/apiClient";
import type { MachineData } from "@/data/mockData";
import { KPICard } from "@/components/KPICard";
import { Package, Target } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line
} from "recharts";

const tt = { contentStyle: { backgroundColor: 'hsl(222, 25%, 11%)', border: '1px solid hsl(222, 20%, 18%)', borderRadius: '8px', color: 'hsl(215, 20%, 85%)', fontSize: '12px' } };

export default function ProductionAnalytics() {
  const [machines, setMachines] = useState<MachineData[]>([]);
  const [shiftProduction, setShiftProduction] = useState<Record<string, unknown>[]>([]);
  const [weeklyData, setWeeklyData] = useState<{ day: string; production: number; target: number }[]>([]);

  useEffect(() => {
    apiClient.get("/metrics/realtime").then(r => setMachines(r.data)).catch(() => {});
    apiClient.get("/production/by-shift").then(r => setShiftProduction(r.data)).catch(() => {});
    apiClient.get("/production/weekly").then(r => {
      const data = r.data.map((row: { record_date: string; production: number }) => ({
        day: new Date(row.record_date).toLocaleDateString('en-IN', { weekday: 'short' }),
        production: Number(row.production),
        target: 550,
      }));
      setWeeklyData(data.slice(-7));
    }).catch(() => {});
  }, []);

  const machineProduction = machines.map(m => ({
    name: m.id,
    produced: m.parts_produced,
    rejected: m.rejection_count,
    target: Math.round(m.parts_produced * 1.1),
  }));

  const totalParts = machines.reduce((s, m) => s + m.parts_produced, 0);
  const totalRejected = machines.reduce((s, m) => s + m.rejection_count, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Production Analytics</h1>
        <p className="text-sm text-muted-foreground">Shift-wise and machine-wise production analysis</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Total Parts Today" value={totalParts} icon={<Package className="h-4 w-4" />} variant="primary" />
        <KPICard title="Rejected Parts" value={totalRejected} variant="destructive" />
        <KPICard title="Rejection Rate" value={((totalRejected / totalParts) * 100).toFixed(1)} unit="%" />
        <KPICard title="Target Achievement" value="91" unit="%" icon={<Target className="h-4 w-4" />} variant="success" />
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
              <ComposedChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="day" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <Tooltip {...tt} />
                <Legend />
                <Bar dataKey="production" fill="hsl(187, 80%, 50%)" name="Production" radius={[2, 2, 0, 0]} />
                <Line type="monotone" dataKey="target" stroke="hsl(0, 72%, 51%)" name="Target" strokeDasharray="5 5" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
