import { powerQualityData, machines } from "@/data/mockData";
import { KPICard } from "@/components/KPICard";
import { Gauge, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const avgPF = machines.filter(m => m.status !== 'maintenance').reduce((s, m) => s + m.pf, 0) / machines.filter(m => m.status !== 'maintenance').length;
const avgHealth = powerQualityData.reduce((s, d) => s + d.healthScore, 0) / powerQualityData.length;

export default function PowerQuality() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Power Quality</h1>
        <p className="text-sm text-muted-foreground">Voltage, current, power factor, and harmonic analysis</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Avg Power Factor" value={avgPF.toFixed(2)} icon={<Gauge className="h-4 w-4" />} variant={avgPF >= 0.9 ? 'success' : 'warning'} />
        <KPICard title="PQ Health Score" value={Math.round(avgHealth)} unit="/100" variant="primary" />
        <KPICard title="Frequency" value="49.98" unit="Hz" variant="success" />
        <KPICard title="PQ Alerts" value="2" icon={<AlertTriangle className="h-4 w-4" />} variant="warning" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {powerQualityData.map((pq) => {
          const machine = machines.find(m => m.id === pq.id);
          if (!machine) return null;
          return (
            <div key={pq.id} className="kpi-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">{pq.id}</h3>
                <span className={cn(
                  "text-xs font-mono px-2 py-0.5 rounded-full",
                  pq.healthScore >= 85 ? "bg-success/10 text-success" :
                  pq.healthScore >= 70 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
                )}>
                  Score: {pq.healthScore}
                </span>
              </div>

              <div className="space-y-2">
                <Row label="Voltage (R/Y/B)" value={`${pq.voltage.r} / ${pq.voltage.y} / ${pq.voltage.b} V`} />
                <Row label="Current (R/Y/B)" value={`${pq.current.r} / ${pq.current.y} / ${pq.current.b} A`} />
                <Row label="Power Factor" value={pq.pf.toFixed(2)} warn={pq.pf < 0.9} />
                <Row label="Frequency" value={`${pq.frequency.toFixed(2)} Hz`} />
                <Row label="THD" value={`${pq.thd.toFixed(1)}%`} warn={pq.thd > 5} />
                <Row label="V Imbalance" value={`${pq.voltageImbalance.toFixed(2)}%`} warn={pq.voltageImbalance > 1.5} />
              </div>

              <div className="mt-3 pt-3 border-t border-border">
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      pq.healthScore >= 85 ? "bg-success" :
                      pq.healthScore >= 70 ? "bg-warning" : "bg-destructive"
                    )}
                    style={{ width: `${pq.healthScore}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-mono", warn ? "text-warning" : "text-foreground")}>{value}</span>
    </div>
  );
}
