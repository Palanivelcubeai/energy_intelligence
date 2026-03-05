import { machines, costData } from "@/data/mockData";
import { KPICard } from "@/components/KPICard";
import { DollarSign, AlertTriangle, TrendingDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend
} from "recharts";

const tt = { contentStyle: { backgroundColor: 'hsl(222, 25%, 11%)', border: '1px solid hsl(222, 20%, 18%)', borderRadius: '8px', color: 'hsl(215, 20%, 85%)', fontSize: '12px' } };

const totalEnergy = machines.reduce((s, m) => s + m.kWh, 0);
const totalDailyCost = Math.round(totalEnergy * 8.5);
const totalIdleCost = costData.machines.reduce((s, m) => s + m.idleCost, 0);
const COLORS = ['hsl(187, 80%, 50%)', 'hsl(152, 60%, 45%)', 'hsl(38, 92%, 50%)', 'hsl(217, 80%, 55%)', 'hsl(270, 60%, 55%)'];

const costPerMachine = costData.machines.map((c, i) => ({
  name: c.id,
  energyCost: c.energyCost,
  idleCost: c.idleCost,
  costPerPart: c.costPerPart,
}));

export default function CostAnalysis() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cost Analysis</h1>
        <p className="text-sm text-muted-foreground">Energy cost breakdown and waste identification</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Daily Energy Cost" value={`₹${totalDailyCost.toLocaleString()}`} icon={<DollarSign className="h-4 w-4" />} variant="primary" />
        <KPICard title="Monthly Est." value={`₹${(totalDailyCost * 26).toLocaleString()}`} />
        <KPICard title="Demand Charge" value={`₹${(85 * 350).toLocaleString()}`} />
        <KPICard title="Idle Waste Cost" value={`₹${totalIdleCost}`} icon={<TrendingDown className="h-4 w-4" />} variant="destructive" />
      </div>

      {/* Wasted Energy Banner */}
      <div className="insight-card border-l-warning bg-warning/5">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Wasted Energy Cost Due to Idle Running</p>
            <p className="text-2xl font-bold font-mono text-warning mt-1">₹18,500/month</p>
            <p className="text-xs text-muted-foreground mt-1">CNC-3 and CNC-2 account for 72% of idle energy waste</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Energy Cost per CNC (₹)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costPerMachine}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="name" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" ₹" />
                <Tooltip {...tt} />
                <Legend />
                <Bar dataKey="energyCost" fill="hsl(187, 80%, 50%)" name="Energy Cost" radius={[2, 2, 0, 0]} />
                <Bar dataKey="idleCost" fill="hsl(38, 92%, 50%)" name="Idle Cost" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-container">
          <h3 className="text-sm font-medium text-foreground mb-4">Cost per Part (₹)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costPerMachine}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
                <XAxis dataKey="name" stroke="hsl(215, 15%, 55%)" fontSize={10} />
                <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" ₹" />
                <Tooltip {...tt} />
                <Bar dataKey="costPerPart" name="₹/Part" radius={[4, 4, 0, 0]}>
                  {costPerMachine.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
