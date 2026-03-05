import { useState, useMemo } from "react";
import { KPICard } from "@/components/KPICard";
import { Leaf, Factory, Gauge, Sun, Recycle, Award, AlertTriangle, CheckCircle, Info } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, ScatterChart, Scatter, ZAxis, Legend,
} from "recharts";
import { getCarbonMetrics, generate30DayCO2, getCO2ByMachine, getCarbonInsights, defaultConfig } from "@/data/carbonData";

const COLORS = [
  'hsl(187, 80%, 50%)', 'hsl(152, 60%, 45%)', 'hsl(38, 92%, 50%)',
  'hsl(217, 80%, 55%)', 'hsl(270, 60%, 55%)'
];

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: 'hsl(222, 25%, 11%)',
    border: '1px solid hsl(222, 20%, 18%)',
    borderRadius: '8px',
    color: 'hsl(215, 20%, 85%)',
    fontSize: '12px',
  },
};

export default function CarbonSustainability() {
  const [emissionFactor] = useState(defaultConfig.gridEmissionFactor);
  const [renewablePercent] = useState(defaultConfig.renewablePercent);

  const metrics = useMemo(() => getCarbonMetrics(emissionFactor, renewablePercent), [emissionFactor, renewablePercent]);
  const co2Trend = useMemo(() => generate30DayCO2(emissionFactor), [emissionFactor]);
  const co2ByMachine = useMemo(() => getCO2ByMachine(emissionFactor), [emissionFactor]);
  const carbonInsights = useMemo(() => getCarbonInsights(emissionFactor, renewablePercent), [emissionFactor, renewablePercent]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
          <Leaf className="h-6 w-6 text-success" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Carbon & Sustainability</h1>
          <p className="text-sm text-muted-foreground">Emission tracking and environmental impact analysis</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard title="CO₂ Today" value={metrics.totalCO2Today.toFixed(1)} unit="kg" icon={<Factory className="h-4 w-4" />} trend={{ value: -2.8, label: 'vs yesterday' }} />
        <KPICard title="CO₂ This Month" value={metrics.totalCO2Month.toFixed(2)} unit="tons" icon={<Leaf className="h-4 w-4" />} />
        <KPICard title="Carbon Intensity" value={metrics.carbonIntensity.toFixed(3)} unit="kg/part" icon={<Gauge className="h-4 w-4" />} trend={{ value: -1.2, label: 'improving' }} />
        <KPICard title="Renewable %" value={metrics.renewablePercent} unit="%" icon={<Sun className="h-4 w-4" />} variant="success" />
        <KPICard title="Carbon Saved" value={metrics.carbonSaved.toFixed(1)} unit="kg" icon={<Recycle className="h-4 w-4" />} variant="success" />
        <KPICard title="Sustainability" value={metrics.sustainabilityScore} unit="/100" icon={<Award className="h-4 w-4" />} variant={metrics.sustainabilityScore >= 70 ? 'success' : 'warning'} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 30-day CO₂ Trend */}
        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">CO₂ Emissions Trend (30 Days)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={co2Trend}>
                <defs>
                  <linearGradient id="co2Grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(152, 60%, 45%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(152, 60%, 45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="date" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" kg" />
                <Tooltip {...chartTooltipStyle} />
                <Area type="monotone" dataKey="co2" stroke="hsl(152, 60%, 45%)" fill="url(#co2Grad)" strokeWidth={2} name="CO₂ (kg)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Scope 2 Breakdown Pie */}
        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Scope 2 Emissions by CNC</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={co2ByMachine} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="co2" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {co2ByMachine.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip {...chartTooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Carbon Intensity Trend */}
        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Carbon Intensity Trend</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={co2Trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="date" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" kg/part" />
                <Tooltip {...chartTooltipStyle} />
                <Line type="monotone" dataKey="intensity" stroke="hsl(38, 92%, 50%)" strokeWidth={2} dot={false} name="kg CO₂/part" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Energy vs CO₂ Scatter */}
        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Energy vs CO₂ Correlation</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="kwh" name="Energy" unit=" kWh" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis dataKey="co2" name="CO₂" unit=" kg" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <ZAxis dataKey="parts" range={[40, 400]} name="Parts" />
                <Tooltip {...chartTooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
                <Legend />
                <Scatter name="Daily Data" data={co2Trend} fill="hsl(187, 80%, 50%)" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Sustainability Insights */}
      <div className="chart-container">
        <h3 className="text-sm font-medium text-foreground mb-4">🌿 Sustainability Insights</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {carbonInsights.map((insight, i) => {
            const Icon = insight.severity === 'warning' ? AlertTriangle : insight.severity === 'success' ? CheckCircle : Info;
            const borderColor = insight.severity === 'warning' ? 'border-l-warning' : insight.severity === 'success' ? 'border-l-success' : 'border-l-primary';
            return (
              <div key={i} className={`insight-card ${borderColor}`}>
                <div className="flex items-start gap-2 mb-2">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${
                    insight.severity === 'warning' ? 'text-warning' : insight.severity === 'success' ? 'text-success' : 'text-primary'
                  }`} />
                  <p className="text-sm text-foreground font-medium">{insight.message}</p>
                </div>
                <div className="ml-6 space-y-1 text-xs text-muted-foreground">
                  <p>🌱 Carbon: {insight.carbonReduction}</p>
                  <p>💰 Impact: {insight.financialImpact}</p>
                  <p>💡 {insight.recommendation}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
