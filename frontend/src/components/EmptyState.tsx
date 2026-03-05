import { SearchX } from "lucide-react";

interface EmptyStateProps {
  message?: string;
}

export function EmptyState({ message = "No data available for the selected date range." }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <SearchX className="h-10 w-10 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
