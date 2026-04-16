import { FormEvent, useState, useEffect, useRef } from "react";
import { API_BASE_URL } from "@/config/api";
import { apiClient } from "@/services/apiClient";
import type { InsightData } from "@/types";
import { InsightCard } from "@/components/InsightCard";
import { EmptyState } from "@/components/EmptyState";
import { Brain, Lightbulb, Target, Bot, User, Send, MessageCircle, X } from "lucide-react";

type ChatAssistResponse = {
  answer: string;
  suggestions?: string[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  createdAt: number;
};

type DataQualityStatus = {
  last_ingestion: string | null;
  missing_machines: string[];
  stale_machines: string[];
  invalid_rate_pct: number;
  status: "healthy" | "warning";
};

const CHAT_HISTORY_STORAGE_KEY = "ai-insights-chat-history-v1";
const MAX_CHAT_HISTORY_MESSAGES = 80;
const INSIGHTS_CACHE_STORAGE_KEY = "ai-insights-cache-v1";

const starterPrompts = [
  "What is total production today?",
  "What is total energy consumption today?",
  "What are total rejects today?",
  "Which machine has issues right now?",
  "Give energy details for CNC-2",
  "Which machine is least efficient today?",
];

const defaultChatMessages: ChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    text: "Ask me about production, reject rate, energy, efficiency, or machine status using live plant data.",
    createdAt: Date.now(),
  },
];

function formatChatTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
}

function loadChatHistory(): ChatMessage[] {
  if (typeof window === "undefined") return defaultChatMessages;

  try {
    const raw = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return defaultChatMessages;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultChatMessages;

    const normalized = parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const role = item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : null;
        const text = typeof item.text === "string" ? item.text.trim() : "";
        if (!role || !text) return null;
        const suggestions = Array.isArray(item.suggestions)
          ? item.suggestions.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()).slice(0, 4)
          : [];

        return {
          id: typeof item.id === "string" && item.id ? item.id : `${role}-${Date.now()}`,
          role,
          text,
          suggestions,
          createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
        } as ChatMessage;
      })
      .filter((item): item is ChatMessage => Boolean(item));

    if (!normalized.length) return defaultChatMessages;
    return normalized.slice(-MAX_CHAT_HISTORY_MESSAGES);
  } catch {
    return defaultChatMessages;
  }
}

function persistChatHistory(messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = messages.slice(-MAX_CHAT_HISTORY_MESSAGES);
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota errors and continue with in-memory chat.
  }
}

function parseInsightsResponse(data: unknown): InsightData[] {
  if (Array.isArray(data)) return data as InsightData[];
  if (data && typeof data === "object") {
    const typed = data as { insights?: unknown; value?: unknown };
    if (Array.isArray(typed.insights)) return typed.insights as InsightData[];
    if (Array.isArray(typed.value)) return typed.value as InsightData[];
  }
  return [];
}

function loadCachedInsights(): InsightData[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.sessionStorage.getItem(INSIGHTS_CACHE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistCachedInsights(insights: InsightData[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(INSIGHTS_CACHE_STORAGE_KEY, JSON.stringify(insights.slice(0, 8)));
  } catch {
    // Ignore session storage errors.
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function buildEmergencyInsightsFromRealtime(rows: any[]): InsightData[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const sortedByReject = [...rows].sort((a, b) => Number(b?.rejection_count || 0) - Number(a?.rejection_count || 0));
  const sortedByEfficiency = [...rows].sort((a, b) => Number(a?.efficiency_score || 0) - Number(b?.efficiency_score || 0));
  const sortedByEnergy = [...rows].sort((a, b) => Number(b?.kWh || 0) - Number(a?.kWh || 0));

  const topReject = sortedByReject[0];
  const lowEfficiency = sortedByEfficiency[0];
  const highEnergy = sortedByEnergy[0];

  const fallback: InsightData[] = [];

  if (topReject && Number(topReject.rejection_count || 0) > 0) {
    fallback.push({
      id: `emg-reject-${topReject.id}`,
      severity: "warning",
      message: `${topReject.id} has highest rejects (${Number(topReject.rejection_count || 0)}) today`,
      financial_impact: "Higher scrap and rework cost",
      production_impact: "Reduced net good output",
      confidence: 74,
      suggested_action: `Run first-piece quality check and tool inspection on ${topReject.id}`,
      machine: topReject.id || null,
    });
  }

  if (lowEfficiency) {
    fallback.push({
      id: `emg-eff-${lowEfficiency.id}`,
      severity: Number(lowEfficiency.efficiency_score || 0) < 70 ? "critical" : "warning",
      message: `${lowEfficiency.id} has lowest efficiency (${Number(lowEfficiency.efficiency_score || 0)}%)`,
      financial_impact: "Higher cost per accepted part",
      production_impact: "Lower throughput vs target",
      confidence: 76,
      suggested_action: `Review feed/speed and setup conditions on ${lowEfficiency.id}`,
      machine: lowEfficiency.id || null,
    });
  }

  if (highEnergy) {
    fallback.push({
      id: `emg-energy-${highEnergy.id}`,
      severity: "info",
      message: `${highEnergy.id} is highest energy consumer (${Number(highEnergy.kWh || 0).toFixed(1)} kWh)`,
      financial_impact: "Largest contributor to today's energy bill",
      production_impact: "Energy intensity may impact cost competitiveness",
      confidence: 72,
      suggested_action: `Audit idle/runtime energy profile on ${highEnergy.id}`,
      machine: highEnergy.id || null,
    });
  }

  return fallback.slice(0, 4);
}

export default function AIInsights() {
  const [insights, setInsights] = useState<InsightData[]>(() => loadCachedInsights());
  const [loading, setLoading] = useState(() => loadCachedInsights().length === 0);
  const [error, setError] = useState<string | null>(null);
  const [staleWarning, setStaleWarning] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [isStreamingResponse, setIsStreamingResponse] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => loadChatHistory());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dataQuality, setDataQuality] = useState<DataQualityStatus | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const hasInsightsRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    hasInsightsRef.current = insights.length > 0;
    if (insights.length > 0) {
      persistCachedInsights(insights);
    }
  }, [insights]);

  const suggestions = Array.from(
    new Set(
      insights
        .flatMap((i) => [
          i.suggested_action?.trim(),
          ...(Array.isArray(i.suggested_actions) ? i.suggested_actions.map((s) => s?.trim()) : []),
        ])
        .filter((value): value is string => Boolean(value))
    )
  ).slice(0, 6);

  useEffect(() => {
    let active = true;
    const hasInitialCache = insights.length > 0;

    const fetchEmergencyInsights = async () => {
      try {
        const rt = await withTimeout(apiClient.get("/metrics/realtime", { timeout: 7000 }), 8000, "metrics realtime");
        if (!active) return false;
        const emergency = buildEmergencyInsightsFromRealtime(Array.isArray(rt.data) ? rt.data : []);
        if (emergency.length > 0) {
          setInsights(emergency);
          setError(null);
          setStaleWarning("AI insights are warming up. Showing realtime-derived recommendations.");
          return true;
        }
      } catch {}
      return false;
    };

    const fetchInsights = async (isInitial = false) => {
      if (isInitial) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }

      if (isInitial) {
        // First paint fallback: show realtime-derived insights immediately.
        await fetchEmergencyInsights();

        try {
          const rTop = await withTimeout(apiClient.get("/insights/top", { timeout: 7000 }), 8000, "insights top");
          if (!active) return;
          const topInsights = parseInsightsResponse(rTop.data);
          if (topInsights.length > 0) {
            setInsights(topInsights);
            setError(null);
            setStaleWarning("Showing top AI insights while full analysis is loading.");
          }
        } catch {
          // Ignore and continue to /all request.
        } finally {
          if (active) setLoading(false);
        }
      }

      try {
        const r = await withTimeout(apiClient.get("/insights/all", { timeout: 12000 }), 13000, "insights all");
        if (!active) return;
        const allInsights = parseInsightsResponse(r.data);
        if (allInsights.length > 0) {
          setInsights(allInsights);
          setStaleWarning(null);
        } else {
          const usedEmergency = await fetchEmergencyInsights();
          if (!usedEmergency && !hasInsightsRef.current) {
            setStaleWarning("AI returned no items. Retrying automatically.");
          }
        }
        setError(null);
      } catch (errAll) {
        if (!active) return;

        const status = errAll?.response?.status;
        const message = status === 503
          ? "AI is warming up. Showing last available insights."
          : "AI refresh delayed. Retrying automatically.";

        if (hasInsightsRef.current || insights.length > 0) {
          if (status === 503) {
            setStaleWarning(message);
          } else {
            // Keep existing cards without noisy warning for transient refresh failures.
            setStaleWarning(null);
          }
          setError(null);
          return;
        }

        try {
          const rTop = await withTimeout(apiClient.get("/insights/top", { timeout: 7000 }), 8000, "insights top fallback");
          if (!active) return;
          const fallbackInsights = parseInsightsResponse(rTop.data);
          if (fallbackInsights.length > 0) {
            setInsights(fallbackInsights);
            setError(null);
            setStaleWarning("Showing top AI insights while full analysis is still loading.");
            return;
          }
        } catch {}

        const usedEmergency = await fetchEmergencyInsights();
        if (usedEmergency) return;

        setInsights([]);
        setError(errAll?.message || "Unable to load AI insights");
      } finally {
        if (active) {
          if (isInitial) setLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible") {
        fetchInsights();
      }
    };

    fetchInsights(!hasInitialCache);
    const interval = setInterval(() => fetchInsights(), 10000);
    window.addEventListener("focus", handleVisibilityRefresh);
    document.addEventListener("visibilitychange", handleVisibilityRefresh);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", handleVisibilityRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadSignals = async () => {
      try {
        const qualityRes = await withTimeout(apiClient.get("/metrics/data-quality", { timeout: 7000 }), 8000, "data quality");
        if (!active) return;

        setDataQuality({
          last_ingestion: qualityRes.data?.last_ingestion || null,
          missing_machines: Array.isArray(qualityRes.data?.missing_machines) ? qualityRes.data.missing_machines : [],
          stale_machines: Array.isArray(qualityRes.data?.stale_machines) ? qualityRes.data.stale_machines : [],
          invalid_rate_pct: Number(qualityRes.data?.invalid_rate_pct || 0),
          status: qualityRes.data?.status === "healthy" ? "healthy" : "warning",
        });
      } catch {
        // Keep previous values if signal endpoints are transiently unavailable.
      }
    };

    loadSignals();
    const interval = setInterval(loadSignals, 20000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const sendChatMessage = async (message: string) => {
    const prompt = message.trim();
    if (!prompt || chatLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: prompt,
      createdAt: Date.now(),
    };
    const assistantMessageId = `assistant-stream-${Date.now()}`;
    setChatMessages((prev) => [
      ...prev.slice(-(MAX_CHAT_HISTORY_MESSAGES - 2)),
      userMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        text: "",
        createdAt: Date.now(),
      },
    ]);
    setChatInput("");
    setChatLoading(true);
    setIsStreamingResponse(true);

    const historyPayload = [...chatMessages, userMessage]
      .slice(-12)
      .map((m) => ({ role: m.role, text: m.text }));

    try {
      const response = await fetch(`${API_BASE_URL}/chat-assist/ask-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: prompt,
          history: historyPayload,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Streaming endpoint unavailable");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let hasStreamedToken = false;

      const applyToken = (token: string) => {
        if (!token) return;
        hasStreamedToken = true;
        setChatMessages((prev) => prev.map((m) => (
          m.id === assistantMessageId ? { ...m, text: `${m.text || ""}${token}` } : m
        )));
      };

      const applyDone = (payload: ChatAssistResponse) => {
        const finalText = typeof payload?.answer === "string" && payload.answer.trim()
          ? payload.answer.trim()
          : "I could not generate a response from current data.";
        setChatMessages((prev) => prev.map((m) => (
          m.id === assistantMessageId
            ? {
                ...m,
                text: hasStreamedToken ? (m.text || finalText) : finalText,
                suggestions: Array.isArray(payload?.suggestions) ? payload.suggestions.slice(0, 4) : [],
              }
            : m
        )));
      };

      const processSseChunk = (chunk: string) => {
        const lines = chunk.split("\n");
        let eventName = "message";
        let dataLine = "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLine += line.slice(5).trim();
          }
        }

        if (!dataLine) return;
        let parsed: any;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          return;
        }

        if (eventName === "token") {
          applyToken(String(parsed?.token || ""));
        } else if (eventName === "done") {
          applyDone(parsed as ChatAssistResponse);
        } else if (eventName === "error") {
          throw new Error(String(parsed?.message || "Unable to stream response"));
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          processSseChunk(chunk);
        }
      }

      if (buffer.trim()) {
        processSseChunk(buffer);
      }
    } catch {
      try {
        const { data } = await apiClient.post<ChatAssistResponse>("/chat-assist/ask", {
        message: prompt,
        history: historyPayload,
      });
        setChatMessages((prev) => prev.map((m) => (
          m.id === assistantMessageId
            ? {
                ...m,
                text: data.answer || "I could not generate a response from current data.",
                suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 4) : [],
              }
            : m
        )));
      } catch (err) {
        const fallback = err instanceof Error ? err.message : "Unable to process this question right now.";
        setChatMessages((prev) => prev.map((m) => (
          m.id === assistantMessageId
            ? { ...m, text: fallback }
            : m
        )));
      }
    } finally {
      setChatLoading(false);
      setIsStreamingResponse(false);
    }
  };

  const handleChatSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void sendChatMessage(chatInput);
  };

  useEffect(() => {
    persistChatHistory(chatMessages);
  }, [chatMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages, chatLoading]);

  const clearChatHistory = () => {
    setChatMessages(defaultChatMessages);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Brain className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Insights</h1>
          <p className="text-sm text-muted-foreground">Smart recommendations and insights for your plant operations</p>
        </div>
      </div>

      {loading && <EmptyState message="Loading AI insights..." />}

      {!loading && error && (
        <EmptyState message="Unable to load AI insights. Please check backend and Ollama status." />
      )}

      {!loading && !error && insights.length === 0 && (
        <EmptyState message="No AI insights available yet. Generate more machine data and refresh." />
      )}

      {!loading && !error && insights.length > 0 && (
        <>
          <div className="rounded-xl border border-border/60 bg-card/50 p-4">
            <p className="text-[10px] uppercase text-muted-foreground">Data Quality Monitor</p>
            <p className={`mt-1 text-sm font-medium ${dataQuality?.status === "healthy" ? "text-success" : "text-warning"}`}>
              {dataQuality?.status === "healthy" ? "Healthy" : "Warning"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Last ingestion: {dataQuality?.last_ingestion ? new Date(dataQuality.last_ingestion).toLocaleString() : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground">
              Missing machines: {dataQuality ? dataQuality.missing_machines.length : "--"} | Stale machines: {dataQuality ? dataQuality.stale_machines.length : "--"}
            </p>
            <p className="text-xs text-muted-foreground">
              Invalid/null rate (24h): {dataQuality ? `${dataQuality.invalid_rate_pct}%` : "--"}
            </p>
          </div>

          {staleWarning && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              {staleWarning}
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsChatOpen((v) => !v)}
            className="fixed bottom-4 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
            aria-label={isChatOpen ? "Close chat assist" : "Open chat assist"}
            title={isChatOpen ? "Close Chat Assist" : "Open Chat Assist"}
          >
            {isChatOpen ? <X className="mx-auto h-6 w-6" /> : <MessageCircle className="mx-auto h-6 w-6" />}
          </button>

          {isChatOpen && (
            <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setIsChatOpen(false)}>
              <div
                className="absolute bottom-20 left-3 right-3 h-[80vh] rounded-2xl border border-border/60 bg-card/95 p-4 backdrop-blur-md sm:left-auto sm:right-4 sm:w-[36rem] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">Chat Assist</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={clearChatHistory}
                      className="rounded-full border border-border bg-background px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      Clear Chat
                    </button>
                    {(chatLoading || isRefreshing) && (
                      <div className="rounded-full border border-border bg-background/70 px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {chatLoading ? "Analyzing" : "Syncing Data"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendChatMessage(prompt)}
                      disabled={chatLoading}
                      className="rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs text-foreground hover:bg-secondary transition-colors disabled:opacity-60"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                <div className="flex-1 min-h-0 rounded-xl border border-border/60 bg-gradient-to-b from-background/30 to-secondary/20 p-2">
                  <div className="h-full overflow-y-auto space-y-2 pr-1">
                    {chatMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[96%] rounded-2xl border px-3.5 py-2.5 shadow-sm ${
                            message.role === "user"
                              ? "border-primary/30 bg-primary/15"
                              : "border-border/60 bg-card/70"
                          }`}
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {message.role === "user" ? (
                                <User className="h-3.5 w-3.5 text-primary" />
                              ) : (
                                <Bot className="h-3.5 w-3.5 text-primary" />
                              )}
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                                {message.role === "user" ? "You" : "Assistant"}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground">{formatChatTime(message.createdAt)}</span>
                          </div>
                          <p className="text-base text-foreground leading-relaxed">{message.text}</p>
                          {message.role === "assistant" && Array.isArray(message.suggestions) && message.suggestions.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              {message.suggestions.map((tip, index) => (
                                <div key={`${message.id}-tip-${index}`} className="flex items-start gap-2 text-sm text-muted-foreground">
                                  <Lightbulb className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                                  <span>{tip}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    {chatLoading && !isStreamingResponse && (
                      <div className="flex justify-start">
                        <div className="max-w-[96%] rounded-2xl border border-border/60 bg-card/70 px-3.5 py-2.5 shadow-sm">
                          <div className="mb-1 flex items-center gap-2">
                            <Bot className="h-3.5 w-3.5 text-primary" />
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Assistant</span>
                          </div>
                          <p className="text-base text-muted-foreground">Analyzing latest machine data...</p>
                        </div>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-border/60 bg-background/70 p-2">
                  <form onSubmit={handleChatSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask about production, reject, energy, efficiency, status..."
                      className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      type="submit"
                      disabled={chatLoading || !chatInput.trim()}
                      className="h-10 rounded-lg bg-primary px-3 text-primary-foreground disabled:opacity-60 sm:w-auto w-full"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">AI Suggestions</h2>
            </div>

            {suggestions.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {suggestions.map((tip, index) => (
                  <div key={`${index}-${tip}`} className="rounded-lg bg-secondary/40 px-3 py-2 text-sm text-foreground flex items-start gap-2">
                    <Target className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No suggestions available from current AI response.</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {insights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
