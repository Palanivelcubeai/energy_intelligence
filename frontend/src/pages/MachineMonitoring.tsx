import { useState, useEffect } from "react";
import { apiClient } from "@/services/apiClient";
import type { MachineData } from "@/types";
import { MachineCard } from "@/components/MachineCard";
import { KPICard } from "@/components/KPICard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Zap, Package, Clock, Gauge } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from "recharts";

const tt = { contentStyle: { backgroundColor: '#ffffff', border: '1px solid hsl(215, 20%, 80%)', borderRadius: '8px', color: '#1a1a2e', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }, itemStyle: { color: '#1a1a2e' }, labelStyle: { color: '#1a1a2e', fontWeight: 600 } };

export default function MachineMonitoring() {
  const [machines, setMachines] = useState<MachineData[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [trend, setTrend] = useState<{ time: string; value: number }[]>([]);
  const [prodData, setProdData] = useState<{ time: string; parts: number; energy_per_part: string }[]>([]);

  // Auto-poll machines every 10 seconds for live updates
  useEffect(() => {
    const fetchMachines = () =>
      apiClient.get("/metrics/realtime").then(r => setMachines(r.data)).catch(() => {});
    fetchMachines();
    const interval = setInterval(fetchMachines, 10000);
    return () => clearInterval(interval);
  }, []);

  // Auto-poll trend data every 30 seconds when a machine is selected (hourly buckets)
  useEffect(() => {
    if (!selected) return;
    const fetchTrend = () =>
      apiClient.get(`/machines/${selected}/trend`).then(r => {
        const data = r.data.map((p: { time: string; value: number }) => ({
          time: new Date(p.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
          value: Number(p.value),
        }));
        setTrend(data);
      }).catch(() => {});
    fetchTrend();
    const interval = setInterval(fetchTrend, 30000);
    return () => clearInterval(interval);
  }, [selected]);

  // Fetch hourly production data — poll every 30s (no need for 3s here)
  useEffect(() => {
    if (!selected) return;
    const fetchProd = () =>
      apiClient.get(`/metrics/production-trend?machine_id=${selected}`).then(r => {
        const data = r.data.map((p: { time: string; production: number; energy: number }) => ({
          time: p.time,
          parts: p.production,
          energy_per_part: p.production > 0 ? (p.energy / p.production).toFixed(2) : '0.00',
        }));
        setProdData(data);
      }).catch(() => {});
    fetchProd();
    const interval = setInterval(fetchProd, 30000);
    return () => clearInterval(interval);
  }, [selected]);

  const machine = machines.find(m => m.id === selected);

  if (machine) {
    const runtimeData = [
      { name: 'Runtime', value: machine.runtime_hours },
      { name: 'Idle', value: machine.idle_hours },
    ];

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{machine.name}</h1>
            <p className="text-sm text-muted-foreground">Detailed machine analytics</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KPICard title="Current Power" value={machine.kW} unit="kW" icon={<Zap className="h-4 w-4" />} variant="primary" />
          <KPICard title="Energy Today" value={machine.kWh} unit="kWh" />
          <KPICard title="Parts Today" value={machine.parts_produced} icon={<Package className="h-4 w-4" />} />
          <KPICard title="Runtime" value={machine.runtime_hours} unit="hrs" icon={<Clock className="h-4 w-4" />} />
          <KPICard title="Efficiency" value={machine.efficiency_score} unit="/100" icon={<Gauge className="h-4 w-4" />} variant={machine.efficiency_score >= 85 ? 'success' : 'warning'} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="chart-container">
            <h3 className="text-sm font-medium text-foreground mb-4">Power Trend (24h)</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="drillGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(187, 80%, 50%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(187, 80%, 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                  <XAxis dataKey="time" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                  <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" kW" />
                  <Tooltip {...tt} />
                  <Area type="monotone" dataKey="value" stroke="hsl(187, 80%, 50%)" fill="url(#drillGrad)" strokeWidth={2} name="Power (kW)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-container">
            <h3 className="text-sm font-medium text-foreground mb-4">Production & Energy/Part</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={prodData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                  <XAxis dataKey="time" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                  <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} />
                  <Tooltip {...tt} />
                  <Bar dataKey="parts" fill="hsl(152, 60%, 45%)" name="Parts" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-container">
            <h3 className="text-sm font-medium text-foreground mb-4">Runtime vs Idle</h3>
            <div className="h-56 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={runtimeData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}h`} fontSize={11}>
                    <Cell fill="hsl(152, 60%, 45%)" />
                    <Cell fill="hsl(38, 92%, 50%)" />
                  </Pie>
                  <Tooltip {...tt} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-container">
            <h3 className="text-sm font-medium text-foreground mb-4">Machine Details</h3>
            <div className="space-y-3">
              <Detail label="Product Type" value={machine.product_type} />
              <Detail label="Power Factor" value={machine.pf.toString()} />
              <Detail label="Avg Voltage" value={`${((machine.voltage.r + machine.voltage.y + machine.voltage.b) / 3).toFixed(1)} V`} />
              <Detail label="Voltage (R/Y/B)" value={`${machine.voltage.r}/${machine.voltage.y}/${machine.voltage.b} V`} />
              <Detail label="Avg Current" value={`${((machine.current.r + machine.current.y + machine.current.b) / 3).toFixed(1)} A`} />
              <Detail label="Current (R/Y/B)" value={`${machine.current.r}/${machine.current.y}/${machine.current.b} A`} />
              <Detail label="Rejections" value={machine.rejection_count.toString()} />
              <Detail label="Energy/Part" value={`${machine.energy_per_part} kWh`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">CNC Machine Monitoring</h1>
        <p className="text-sm text-muted-foreground">Real-time status of all CNC machines</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {machines.map(m => (
          <MachineCard key={m.id} machine={m} onClick={() => setSelected(m.id)} />
        ))}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-mono text-foreground">{value}</span>
    </div>
  );
}
