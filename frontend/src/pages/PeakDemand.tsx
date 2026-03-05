import { useState, useEffect } from "react";
import { apiClient } from "@/services/apiClient";
import { KPICard } from "@/components/KPICard";
import { cn } from "@/lib/utils";
import { TrendingUp, AlertTriangle, Zap, Brain } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

const tt = { contentStyle: { backgroundColor: 'hsl(222, 25%, 11%)', border: '1px solid hsl(222, 20%, 18%)', borderRadius: '8px', color: 'hsl(215, 20%, 85%)', fontSize: '12px' } };

interface DemandPoint { time: string; demand: number; contract: number }
interface PeakEvent { time: string; demand: number; risk_level: string }

export default function PeakDemand() {
  const [data, setData] = useState<DemandPoint[]>([]);
  const [peakEvents, setPeakEvents] = useState<PeakEvent[]>([]);

  useEffect(() => {
    apiClient.get("/demand/trend").then(r => {
      setData(r.data.map((p: { time: string; demand: number; contract: number }) => ({
        time: new Date(p.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        demand: Number(p.demand),
        contract: Number(p.contract),
      })));
    }).catch(() => {});
    apiClient.get("/demand/peak-events").then(r => {
      setPeakEvents(r.data.map((e: { time: string; demand: number; risk_level: string }) => ({
        time: new Date(e.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        demand: Number(e.demand),
        risk_level: e.risk_level,
      })));
    }).catch(() => {});
  }, []);

  const maxDemand = data.length ? Math.max(...data.map(d => d.demand)) : 0;
  const currentDemand = data.length ? data[data.length - 1].demand : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Peak Demand</h1>
        <p className="text-sm text-muted-foreground">Demand monitoring and contract compliance</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Contract Demand" value="85" unit="kVA" icon={<Zap className="h-4 w-4" />} />
        <KPICard title="Current Demand" value={currentDemand.toFixed(1)} unit="kVA" variant={currentDemand > 85 ? 'destructive' : 'primary'} />
        <KPICard title="Max This Month" value={maxDemand.toFixed(1)} unit="kVA" icon={<TrendingUp className="h-4 w-4" />} variant={maxDemand > 85 ? 'warning' : 'success'} />
        <KPICard title="AI Predicted Peak" value="88.3" unit="kVA" icon={<Brain className="h-4 w-4" />} variant="warning" />
      </div>

      <div className="chart-container">
        <h3 className="text-sm font-medium text-foreground mb-4">15-Min Demand Trend</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="demandGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(187, 80%, 50%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(187, 80%, 50%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" />
              <XAxis dataKey="time" stroke="hsl(215, 15%, 55%)" fontSize={9} interval={11} />
              <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" kVA" />
              <Tooltip {...tt} />
              <ReferenceLine y={85} stroke="hsl(0, 72%, 51%)" strokeDasharray="5 5" label={{ value: 'Contract: 85 kVA', fill: 'hsl(0, 72%, 51%)', fontSize: 10 }} />
              <Area type="monotone" dataKey="demand" stroke="hsl(187, 80%, 50%)" fill="url(#demandGrad)" strokeWidth={2} name="Demand (kVA)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-container">
        <h3 className="text-sm font-medium text-foreground mb-4">
          <AlertTriangle className="inline h-4 w-4 text-warning mr-1" />
          Peak Events
        </h3>
        <div className="space-y-3">
          {peakEvents.slice(0, 5).map((p, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-md bg-secondary/30">
              <span className="text-sm font-mono text-foreground">{p.time}</span>
              <span className={cn("text-[10px] px-2 py-0.5 rounded font-mono",
                p.risk_level === 'Critical' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'
              )}>{p.risk_level}</span>
              <span className={cn("text-sm font-mono", p.demand > 85 ? "text-destructive" : "text-foreground")}>{p.demand} kVA</span>
            </div>
          ))}
          {peakEvents.length === 0 && (
            <p className="text-sm text-muted-foreground">No peak events recorded</p>
          )}
        </div>
      </div>
    </div>
  );
}
