import { cn } from "@/lib/utils";
import { MachineData } from "@/types";
import { AreaChart, Area, ResponsiveContainer } from "recharts";

interface MachineCardProps {
  machine: MachineData;
  onClick?: () => void;
}

const statusConfig = {
  running: { label: 'Running', className: 'status-running' },
  idle: { label: 'Idle', className: 'status-idle' },
  maintenance: { label: 'Maintenance', className: 'status-maintenance' },
};

const statusGlow = {
  running: 'border-success/30',
  idle: 'border-warning/30',
  maintenance: 'border-destructive/30',
};

export function MachineCard({ machine, onClick }: MachineCardProps) {
  const status = statusConfig[machine.status];
  const trendData = machine.trend || [];

  return (
    <div
      className={cn(
        "kpi-card cursor-pointer group",
        statusGlow[machine.status],
        "hover:scale-[1.02] transition-all"
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{machine.id}</h3>
          <p className="text-[10px] text-muted-foreground">{machine.name.split('(')[1]?.replace(')', '') || ''}</p>
        </div>
        <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-mono", status.className)}>
          {status.label}
        </span>
      </div>

      <div className="h-12 mb-3 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id={`grad-${machine.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--primary))"
              fill={`url(#grad-${machine.id})`}
              strokeWidth={1.5}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Metric label="Power" value={`${machine.kW}`} unit="kW" />
        <Metric label="Energy" value={`${machine.kWh}`} unit="kWh" />
        <Metric label="Parts" value={`${machine.parts_produced}`} />
        <Metric label="kWh/Part" value={`${machine.energy_per_part}`} />
        <Metric label="Runtime" value={`${machine.runtime_hours}`} unit="hrs" />
        <Metric label="Idle" value={`${machine.idle_hours}`} unit="hrs" />
      </div>

      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground uppercase">Efficiency</span>
          <span className="text-xs font-mono text-foreground">{machine.efficiency_score}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-secondary overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              machine.efficiency_score >= 85 ? "bg-success" :
              machine.efficiency_score >= 70 ? "bg-warning" : "bg-destructive"
            )}
            style={{ width: `${machine.efficiency_score}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-0.5">
        <span className="text-xs font-mono font-medium text-foreground">{value}</span>
        {unit && <span className="text-[9px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}
