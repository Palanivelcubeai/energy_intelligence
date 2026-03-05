import { demandData } from "@/data/mockData";
import { KPICard } from "@/components/KPICard";
import { cn } from "@/lib/utils";
import { TrendingUp, AlertTriangle, Zap, Brain } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

const tt = { contentStyle: { backgroundColor: 'hsl(222, 25%, 11%)', border: '1px solid hsl(222, 20%, 18%)', borderRadius: '8px', color: 'hsl(215, 20%, 85%)', fontSize: '12px' } };
const data = demandData();
const maxDemand = Math.max(...data.map(d => d.demand));
const currentDemand = data[data.length - 1]?.demand || 0;

const peakMachines = [
  { time: '14:30', machines: ['CNC-1', 'CNC-2', 'CNC-3', 'CNC-4'], demand: 87.2 },
  { time: '15:00', machines: ['CNC-1', 'CNC-2', 'CNC-4'], demand: 82.1 },
  { time: '10:15', machines: ['CNC-1', 'CNC-2', 'CNC-3', 'CNC-4'], demand: 84.5 },
];

export default function PeakDemand() {
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
          Peak Events — Active Machines
        </h3>
        <div className="space-y-3">
          {peakMachines.map((p, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-md bg-secondary/30">
              <span className="text-sm font-mono text-foreground">{p.time}</span>
              <div className="flex gap-1">
                {p.machines.map(m => (
                  <span key={m} className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">{m}</span>
                ))}
              </div>
              <span className={cn("text-sm font-mono", p.demand > 85 ? "text-destructive" : "text-foreground")}>{p.demand} kVA</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
