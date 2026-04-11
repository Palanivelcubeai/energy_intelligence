import { useState, useEffect } from "react";
import { apiClient } from "@/services/apiClient";
import { KPICard } from "@/components/KPICard";
import { IndianRupee, AlertTriangle, TrendingDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend
} from "recharts";

const tt = { contentStyle: { backgroundColor: '#ffffff', border: '1px solid hsl(215, 20%, 80%)', borderRadius: '8px', color: '#1a1a2e', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }, itemStyle: { color: '#1a1a2e' }, labelStyle: { color: '#1a1a2e', fontWeight: 600 } };
const COLORS = ['hsl(187, 80%, 50%)', 'hsl(152, 60%, 45%)', 'hsl(38, 92%, 50%)', 'hsl(217, 80%, 55%)', 'hsl(270, 60%, 55%)'];

interface CostMachine { id: string; energyCost: number; idleCost: number; costPerPart: number }
interface MonthlyIdleMachine { id: string; monthlyIdleCost: number }
interface CostBreakdown {
  energyRate: number;
  demandCharge: number;
  contractDemand: number;
  machines: CostMachine[];
  monthlyIdleByMachine?: MonthlyIdleMachine[];
  actualMonthlyCost?: number;
  actualMonthlyIdleCost?: number;
  peakDemandKVA?: number;
  actualDemandCharge?: number;
  billingPeakDemandKVA?: number;
  billingDemandCharge?: number;
}

export default function CostAnalysis() {
  const [costData, setCostData] = useState<CostBreakdown>({ energyRate: 8.5, demandCharge: 350, contractDemand: 85, machines: [] });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const fetchCostBreakdown = () => {
      apiClient.get("/cost/breakdown").then(r => {
        setCostData(r.data);
        setLastUpdated(new Date());
      }).catch(() => {});
    };
    fetchCostBreakdown();
    const interval = setInterval(fetchCostBreakdown, 15000);
    return () => clearInterval(interval);
  }, []);

  const totalDailyCostRaw = costData.machines.reduce((s, m) => s + m.energyCost, 0);
  const totalIdleCostRaw = costData.machines.reduce((s, m) => s + m.idleCost, 0);
  const totalDailyCost = Math.round(totalDailyCostRaw);
  const totalIdleCost = Math.round(totalIdleCostRaw);

  // Use actual monthly cost from backend if available, otherwise estimate
  const monthlyEstimate = Math.round(costData.actualMonthlyCost || (totalDailyCost * 26));
  
  // Prefer billing demand charge (month-to-date peak), then fallback to live/today excess model
  const demandCharge = Math.round(costData.actualDemandCharge !== undefined 
    ? (costData.billingDemandCharge !== undefined ? costData.billingDemandCharge : costData.actualDemandCharge)
    : (Number(costData.contractDemand) * Number(costData.demandCharge)));

  // Compute idle waste banner dynamically from real API data
  const monthlyIdleWaste = costData.actualMonthlyIdleCost !== undefined 
    ? Math.round(costData.actualMonthlyIdleCost)
    : Math.round(totalIdleCost * 26);
  const idleSource = (costData.monthlyIdleByMachine && costData.monthlyIdleByMachine.length > 0)
    ? costData.monthlyIdleByMachine.map((m) => ({ id: m.id, idleCost: m.monthlyIdleCost }))
    : costData.machines.map((m) => ({ id: m.id, idleCost: m.idleCost }));
  const sortedByIdle = [...idleSource].sort((a, b) => b.idleCost - a.idleCost);
  const top2 = sortedByIdle.slice(0, 2);
  const top2IdleSum = top2.reduce((s, m) => s + m.idleCost, 0);
  const idleTotalForPct = sortedByIdle.reduce((s, m) => s + m.idleCost, 0);
  const top2Pct = idleTotalForPct > 0
    ? Math.min(100, Math.max(0, Math.round((top2IdleSum / idleTotalForPct) * 100)))
    : 0;
  const top2Names = top2.map(m => m.id).join(' and ');

  const costPerMachine = costData.machines.map(c => ({
    name: c.id,
    energyCost: c.energyCost,
    idleCost: c.idleCost,
    costPerPart: c.costPerPart,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cost Analysis</h1>
        <p className="text-sm text-muted-foreground">Energy cost breakdown and waste identification</p>
        {lastUpdated && (
          <p className="text-xs text-muted-foreground mt-1">Last updated: {lastUpdated.toLocaleTimeString()}</p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Today's Energy Cost" value={`₹${totalDailyCost.toLocaleString()}`} icon={<IndianRupee className="h-4 w-4" />} variant="primary" />     
        <KPICard 
          title="Monthly Actual" 
          value={`₹${monthlyEstimate.toLocaleString()}`}
          subtitle={costData.actualMonthlyCost ? "Month-to-date" : "Est. (26 days)"}
        />
        <KPICard 
          title="Demand Charge" 
          value={`₹${demandCharge.toLocaleString()}`}
          subtitle={costData.billingPeakDemandKVA
            ? `Billing peak (MTD): ${costData.billingPeakDemandKVA} kVA`
            : (costData.peakDemandKVA ? `Peak: ${costData.peakDemandKVA} kVA` : `Contract: ${costData.contractDemand} kVA`)}
        />
        <KPICard
          title="Idle Waste Cost"
          value={`₹${totalIdleCost.toLocaleString()}`}
          subtitle="Today"
          icon={<TrendingDown className="h-4 w-4" />}
          variant="destructive"
        />
      </div>

      {/* Wasted Energy Banner — computed from real API data */}
      <div className="insight-card border-l-warning bg-warning/5">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Wasted Energy Cost Due to Idle Running</p>
            <p className="text-2xl font-bold font-mono text-warning mt-1">₹{monthlyIdleWaste.toLocaleString()}/month</p>
            {top2Names && top2Pct > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {top2Names} account for {top2Pct}% of {costData.monthlyIdleByMachine?.length ? "month-to-date" : "today's"} idle energy waste
              </p>
            )}
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
