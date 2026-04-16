import { useEffect, useRef, useState } from "react";
import { Bot, MessageCircle, Send, Sparkles, User, X } from "lucide-react";
import { API_BASE_URL } from "@/config/api";
import { apiClient } from "@/services/apiClient";

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

const CHAT_HISTORY_STORAGE_KEY = "global-chat-assist-history-v1";
const MAX_CHAT_HISTORY_MESSAGES = 80;

const starterPrompts = [
  "What should I focus on this shift?",
  "Which machine has issues now?",
  "Compare CNC-2 and CNC-3",
  "How can I reduce rejects today?",
];

const defaultMessages: ChatMessage[] = [
  {
    id: "assistant-welcome-global",
    role: "assistant",
    text: "Hi, I am your plant assistant. Ask anything about production, energy, quality, or machine performance.",
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
  if (typeof window === "undefined") return defaultMessages;

  try {
    const raw = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return defaultMessages;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultMessages;

    const normalized = parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const role = item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : null;
        const text = typeof item.text === "string" ? item.text.trim() : "";
        if (!role || !text) return null;

        const suggestions = Array.isArray(item.suggestions)
          ? item.suggestions.filter((s: unknown) => typeof s === "string" && s.trim()).map((s: string) => s.trim()).slice(0, 4)
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

    if (!normalized.length) return defaultMessages;
    return normalized.slice(-MAX_CHAT_HISTORY_MESSAGES);
  } catch {
    return defaultMessages;
  }
}

function persistChatHistory(messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(messages.slice(-MAX_CHAT_HISTORY_MESSAGES)));
  } catch {
    // Ignore quota/storage errors.
  }
}

export function GlobalChatAssist() {
  const [isOpen, setIsOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [isStreamingResponse, setIsStreamingResponse] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => loadChatHistory());
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    persistChatHistory(chatMessages);
  }, [chatMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages, chatLoading, isOpen]);

  const clearChatHistory = () => {
    setChatMessages(defaultMessages);
  };

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

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
        aria-label={isOpen ? "Close chat assist" : "Open chat assist"}
        title={isOpen ? "Close Chat Assist" : "Open Chat Assist"}
      >
        {isOpen ? <X className="mx-auto h-6 w-6" /> : <MessageCircle className="mx-auto h-6 w-6" />}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setIsOpen(false)}>
          <div
            className="absolute bottom-20 left-3 right-3 h-[80vh] rounded-2xl border border-border/60 bg-card/95 p-4 backdrop-blur-md sm:left-auto sm:right-4 sm:w-[36rem] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
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
                {chatLoading && (
                  <div className="rounded-full border border-border bg-background/70 px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {isStreamingResponse ? "Streaming" : "Analyzing"}
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
                      <p className="text-base text-foreground leading-relaxed whitespace-pre-wrap">{message.text}</p>
                      {message.role === "assistant" && Array.isArray(message.suggestions) && message.suggestions.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {message.suggestions.map((tip, index) => (
                            <div key={`${message.id}-tip-${index}`} className="flex items-start gap-2 text-sm text-muted-foreground">
                              <Sparkles className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
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
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChatMessage(chatInput);
                }}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
              >
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask anything about production, energy, quality, or machines..."
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
    </>
  );
}
