import { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartContainerProps {
  title: string;
  loading?: boolean;
  children: ReactNode;
  className?: string;
}

export function ChartContainer({ title, loading, children, className }: ChartContainerProps) {
  return (
    <div className={`chart-container ${className ?? ""}`}>
      <h3 className="text-sm font-medium text-foreground mb-4">{title}</h3>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
