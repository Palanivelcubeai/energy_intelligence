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

export default function Overview() {
  const [machines, setMachines] = useState<MachineData[]>([]);
  const [loadCurve, setLoadCurve] = useState<{ time: string; value: number }[]>([]);
  const [prodTrend, setProdTrend] = useState<{ time: string; production: number; energy: number }[]>([]);
  const [carbonIntervals, setCarbonIntervals] = useState<any[]>([]);
  const [monthlyProduction, setMonthlyProduction] = useState<{ month: string; production: number }[]>([]);
  const [topInsights, setTopInsights] = useState<InsightData[]>([]);
  const [kpis, setKpis] = useState({ maxDemand: 0, monthlyProduction: 0, avgEfficiency: 0 });
  const [dailyComparison, setDailyComparison] = useState<{
    energy: { percentChange: number };
    parts: { percentChange: number };
    cost: { percentChange: number };
    energyPerPart: { percentChange: number };
  } | null>(null);

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
      apiClient.get("/insights/top").then(r => setTopInsights(r.data)).catch(() => {});
      apiClient.get("/metrics/kpis").then(r => setKpis(r.data)).catch(() => {});
      apiClient.get("/metrics/daily-comparison").then(r => setDailyComparison(r.data)).catch(() => {});
    };

    fetchKpis();
    const interval = setInterval(fetchKpis, 30000);
    return () => clearInterval(interval);
  }, []);

  const totalEnergy = machines.reduce((s, m) => s + m.kWh, 0);
  const totalParts = machines.reduce((s, m) => s + m.parts_produced, 0);
  const totalLoad = machines.reduce((s, m) => s + m.kW, 0);
  const pieData = machines.map(m => ({ name: m.id, value: m.kWh }));

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
        />
        <KPICard 
          title="Parts Produced" 
          value={totalParts} 
          icon={<Package className="h-4 w-4" />} 
          trend={dailyComparison ? { value: dailyComparison.parts.percentChange, label: 'vs yesterday' } : undefined} 
        />
        <KPICard 
          title="Avg Energy/Part" 
          value={(totalEnergy / totalParts).toFixed(2)} 
          unit="kWh" 
          icon={<Gauge className="h-4 w-4" />} 
          trend={dailyComparison ? { value: dailyComparison.energyPerPart.percentChange, label: 'improvement' } : undefined} 
        />
        <KPICard title="Current Load" value={totalLoad.toFixed(1)} unit="kW" icon={<Activity className="h-4 w-4" />} variant="primary" />
        <KPICard title="Max Demand" value={kpis.maxDemand.toFixed(1)} unit="kVA" icon={<TrendingUp className="h-4 w-4" />} variant="warning" />
        <KPICard title="Monthly Production" value={kpis.monthlyProduction.toLocaleString()} icon={<Factory className="h-4 w-4" />} />
        <KPICard 
          title="Energy Cost Today"
          value={`₹${(totalEnergy * 8.5).toFixed(0)}`}
          icon={<IndianRupee className="h-4 w-4" />}
          trend={dailyComparison ? { value: dailyComparison.cost.percentChange, label: 'vs yesterday' } : undefined}
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
            {topInsights.map(i => (
              <InsightCard key={i.id} insight={i} compact />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
