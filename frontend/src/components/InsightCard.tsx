import { cn } from "@/lib/utils";
import { InsightData } from "@/data/mockData";
import { AlertTriangle, Info, CheckCircle, XCircle } from "lucide-react";

const severityConfig = {
  warning: { icon: AlertTriangle, borderColor: 'border-l-warning', iconColor: 'text-warning' },
  critical: { icon: XCircle, borderColor: 'border-l-destructive', iconColor: 'text-destructive' },
  info: { icon: Info, borderColor: 'border-l-info', iconColor: 'text-info' },
  success: { icon: CheckCircle, borderColor: 'border-l-success', iconColor: 'text-success' },
};

export function InsightCard({ insight, compact = false }: { insight: InsightData; compact?: boolean }) {
  const config = severityConfig[insight.severity];
  const Icon = config.icon;

  if (compact) {
    return (
      <div className={cn("insight-card", config.borderColor, "py-3")}>
        <div className="flex items-start gap-2">
          <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", config.iconColor)} />
          <p className="text-sm text-foreground">{insight.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("insight-card", config.borderColor)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", config.iconColor)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{insight.message}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-muted-foreground uppercase">Financial Impact</span>
              <p className="text-xs font-mono text-foreground">{insight.financial_impact}</p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground uppercase">Production Impact</span>
              <p className="text-xs font-mono text-foreground">{insight.production_impact}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">Confidence:</span>
              <span className="text-xs font-mono text-primary">{insight.confidence}%</span>
            </div>
            {insight.machine && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono">
                {insight.machine}
              </span>
            )}
          </div>
          <div className="mt-2 p-2 rounded bg-secondary/50">
            <span className="text-[10px] text-muted-foreground uppercase">Suggested Action</span>
            <p className="text-xs text-foreground">{insight.suggested_action}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
