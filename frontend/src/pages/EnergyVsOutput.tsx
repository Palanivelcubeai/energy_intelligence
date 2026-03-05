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

const tt = { contentStyle: { backgroundColor: 'hsl(222, 25%, 11%)', border: '1px solid hsl(222, 20%, 18%)', borderRadius: '8px', color: 'hsl(215, 20%, 85%)', fontSize: '12px' } };
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

  useEffect(() => { fetchData(from, to); }, []);

  const handleDateChange = (f: Date, t: Date) => {
    setFrom(f);
    setTo(t);
    fetchData(f, t);
  };

  const isEmpty = data.length === 0;

  const best = data.length ? data.reduce((a, b) => a.energy_per_part < b.energy_per_part ? a : b) : null;
  const worst = data.length ? data.reduce((a, b) => a.energy_per_part > b.energy_per_part ? a : b) : null;

  const ranking = [...data].sort((a, b) => a.energy_per_part - b.energy_per_part);

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
            <KPICard title="Best Machine" value={best!.name} icon={<Award className="h-4 w-4" />} variant="success" />
            <KPICard title="Best kWh/Part" value={best!.energy_per_part} unit="kWh" variant="success" />
            <KPICard title="Worst Machine" value={worst!.name} icon={<TrendingDown className="h-4 w-4" />} variant="warning" />
            <KPICard title="Worst kWh/Part" value={worst!.energy_per_part} unit="kWh" variant="warning" />
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
