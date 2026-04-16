import { useState, useEffect } from "react";
import { apiClient } from "@/services/apiClient";
import { KPICard } from "@/components/KPICard";
import { cn } from "@/lib/utils";
import { TrendingUp, AlertTriangle, Zap, Brain } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

const tt = { contentStyle: { backgroundColor: '#ffffff', border: '1px solid hsl(215, 20%, 80%)', borderRadius: '8px', color: '#1a1a2e', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }, itemStyle: { color: '#1a1a2e' }, labelStyle: { color: '#1a1a2e', fontWeight: 600 } };

interface DemandPoint { time: string; demand: number; contract: number }
interface PeakEvent { time: string; demand: number; risk_level: string }
interface AIPrediction {
  predicted_kva: number;
  confidence: number;
  risk_level: "Normal" | "Warning" | "Critical";
  reasoning: string;
  source: "ai" | "fallback";
}

export default function PeakDemand() {
  const [data, setData] = useState<DemandPoint[]>([]);
  const [peakEvents, setPeakEvents] = useState<PeakEvent[]>([]);
  const [contractDemand, setContractDemand] = useState<number>(85);
  const [aiPrediction, setAiPrediction] = useState<AIPrediction | null>(null);
  const [aiFetchError, setAiFetchError] = useState<boolean>(false);

  useEffect(() => {
    const fetchDemand = () => {
      apiClient.get("/demand/trend").then(r => {
        const mapped = r.data.map((p: { time: string; demand: number; contract: number }) => ({
          time: p.time,
          demand: Number(p.demand),
          contract: Number(p.contract),
        }));
        setData(mapped);
        if (mapped.length > 0 && mapped[0].contract) setContractDemand(mapped[0].contract);
      }).catch(() => {});
      apiClient.get("/demand/peak-events").then(r => {
        setPeakEvents(r.data.map((e: { time: string; demand: number; risk_level: string }) => ({
          time: e.time,
          demand: Number(e.demand),
          risk_level: e.risk_level,
        })));
      }).catch(() => {});

      apiClient.get("/demand/ai-prediction?aiOnly=true").then(r => {
        const p = r.data || {};
        const source = String(p.source || "").toLowerCase();
        if (source !== "ai") {
          setAiFetchError(true);
          return;
        }

        setAiFetchError(false);
        setAiPrediction({
          predicted_kva: Number(p.predicted_kva) || 0,
          confidence: Number(p.confidence) || 70,
          risk_level: ["Normal", "Warning", "Critical"].includes(String(p.risk_level)) ? p.risk_level : "Normal",
          reasoning: String(p.reasoning || "Demand forecast generated from current trend data."),
          source: "ai",
        });
      }).catch(() => {
        setAiFetchError(true);
      });
    };

    fetchDemand();
    const interval = setInterval(fetchDemand, 15000);
    return () => clearInterval(interval);
  }, []);

  const maxDemand = data.length ? Math.max(...data.map(d => d.demand)) : 0;
  const currentDemand = data.length ? data[data.length - 1].demand : 0;
  const predictedPeak = aiPrediction?.predicted_kva ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Peak Demand</h1>
        <p className="text-sm text-muted-foreground">Demand monitoring and contract compliance</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Contract Demand" value={contractDemand.toString()} unit="kVA" icon={<Zap className="h-4 w-4" />} />
        <KPICard title="Current Demand" value={currentDemand.toFixed(1)} unit="kVA" variant={currentDemand > contractDemand ? 'destructive' : 'primary'} />
        <KPICard title="Max This Month" value={maxDemand.toFixed(1)} unit="kVA" icon={<TrendingUp className="h-4 w-4" />} variant={maxDemand > contractDemand ? 'warning' : 'success'} />
        <KPICard
          title="AI Predicted Peak"
          value={aiPrediction ? predictedPeak.toFixed(1) : "--"}
          unit="kVA"
          subtitle={aiPrediction
            ? (aiFetchError ? `AI • ${aiPrediction.confidence}% confidence (last known)` : `AI • ${aiPrediction.confidence}% confidence`)
            : "AI prediction unavailable"}
          icon={<Brain className="h-4 w-4" />}
          variant={aiPrediction ? (predictedPeak > contractDemand ? 'warning' : 'success') : 'default'}
        />
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
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 18%)" vertical={false} />
              <XAxis dataKey="time" stroke="hsl(215, 15%, 55%)" fontSize={10} interval={3} />
              <YAxis stroke="hsl(215, 15%, 55%)" fontSize={10} unit=" kVA" />
              <Tooltip {...tt} />
              <ReferenceLine y={contractDemand} stroke="hsl(0, 72%, 51%)" strokeDasharray="5 5" label={{ value: `Contract: ${contractDemand} kVA`, fill: 'hsl(0, 72%, 51%)', fontSize: 10 }} />
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
