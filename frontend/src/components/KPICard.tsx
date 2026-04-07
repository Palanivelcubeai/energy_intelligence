import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KPICardProps {
  title: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  icon?: ReactNode;
  trend?: { value: number; label: string };
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

export function KPICard({ title, value, unit, subtitle, icon, trend, variant = 'default', className }: KPICardProps) {
  return (
    <div className={cn("kpi-card", variantStyles[variant], className)}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{title}</span>
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
          <span className={cn("text-xs font-mono", trend.value >= 0 ? "text-success" : "text-destructive")}>
            {trend.value >= 0 ? '▲' : '▼'} {Math.abs(trend.value)}%
          </span>
          <span className="text-xs text-muted-foreground">{trend.label}</span>
        </div>
      )}
    </div>
  );
}
