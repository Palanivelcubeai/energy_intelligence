import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  icon?: ReactNode;
  trend?: { value: number; label: string };
  trendGoodDirection?: 'up' | 'down';
  aiInsight?: {
    type: 'Suggestion' | 'Prediction' | 'Recommendation' | 'Idea';
    text: string;
  };
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'destructive';
  className?: string;
}

const variantStyles = {
  default: 'border-border',
  primary: 'border-primary/30 glow-cyan',
  success: 'border-success/30 glow-success',
  warning: 'border-warning/30 glow-warning',
  destructive: 'border-destructive/30 glow-destructive',
};

export function KPICard({
  title,
  value,
  unit,
  subtitle,
  icon,
  trend,
  trendGoodDirection = 'up',
  aiInsight,
  variant = 'default',
  className,
}: KPICardProps) {
  const isTrendUp = (trend?.value ?? 0) >= 0;
  const isGoodTrend = trendGoodDirection === 'up' ? isTrendUp : !isTrendUp;

  return (
    <div className={cn("kpi-card group relative", variantStyles[variant], className)}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-muted-foreground uppercase tracking-wider truncate">{title}</span>
          {aiInsight && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide bg-primary/15 text-primary border border-primary/30">
              <Sparkles className="h-3 w-3" />
              AI
            </span>
          )}
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold font-mono text-foreground">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {subtitle && (
        <div className="mt-1">
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
      )}
      {trend && (
        <div className="mt-2 flex items-center gap-1">
          <span className={cn("text-xs font-mono", isGoodTrend ? "text-success" : "text-destructive")}>
            {isTrendUp ? '▲' : '▼'} {Math.abs(trend.value)}%
          </span>
          <span className="text-xs text-muted-foreground">{trend.label}</span>
        </div>
      )}
      {aiInsight && (
        <div className="pointer-events-none absolute left-3 right-3 top-12 z-20 rounded-md border border-border bg-card/95 backdrop-blur-sm p-3 shadow-lg opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
              AI {aiInsight.type}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-foreground/90">{aiInsight.text}</p>
        </div>
      )}
    </div>
  );
}
