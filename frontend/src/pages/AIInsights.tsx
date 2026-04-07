import { useState, useEffect } from "react";
import { apiClient } from "@/services/apiClient";
import type { InsightData } from "@/types";
import { InsightCard } from "@/components/InsightCard";
import { Brain } from "lucide-react";

export default function AIInsights() {
  const [insights, setInsights] = useState<InsightData[]>([]);

  useEffect(() => {
    apiClient.get("/insights/all").then(r => setInsights(r.data)).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Brain className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Insights</h1>
          <p className="text-sm text-muted-foreground">Machine learning-powered optimization recommendations</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {insights.map(i => (
          <InsightCard key={i.id} insight={i} />
        ))}
      </div>
    </div>
  );
}
