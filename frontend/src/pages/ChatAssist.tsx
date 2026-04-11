import { FormEvent, useState } from "react";
import { Bot, Send, User, Lightbulb } from "lucide-react";
import { apiClient } from "@/services/apiClient";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
};

type ChatAssistResponse = {
  answer: string;
  suggestions?: string[];
};

const starterPrompts = [
  "What is CNC-3 production today?",
  "Which machine has highest reject rate?",
  "Give energy details for CNC-2",
  "Which machine is least efficient today?",
];

export default function ChatAssist() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      text: "Ask me about machine production, reject rate, efficiency, energy, or status. I will answer using current plant data.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const sendMessage = async (message: string) => {
    const prompt = message.trim();
    if (!prompt || loading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: prompt,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const { data } = await apiClient.post<ChatAssistResponse>("/chat-assist/ask", { message: prompt });
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: data.answer || "I could not generate a response from current data.",
          suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 4) : [],
        },
      ]);
    } catch (err) {
      const fallback = err instanceof Error ? err.message : "Unable to process this question right now.";
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          text: fallback,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void sendMessage(input);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Bot className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Chat Assist</h1>
          <p className="text-sm text-muted-foreground">Ask practical questions about machine production and performance</p>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/50 p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void sendMessage(prompt)}
              disabled={loading}
              className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs text-foreground hover:bg-secondary transition-colors disabled:opacity-60"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="max-h-[55vh] overflow-y-auto space-y-3 pr-1">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-lg px-3 py-2 ${
                message.role === "user" ? "bg-primary/10 border border-primary/20" : "bg-secondary/30 border border-border/60"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {message.role === "user" ? (
                  <User className="h-4 w-4 text-primary" />
                ) : (
                  <Bot className="h-4 w-4 text-primary" />
                )}
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {message.role === "user" ? "You" : "Assistant"}
                </span>
              </div>
              <p className="text-sm text-foreground leading-relaxed">{message.text}</p>

              {message.role === "assistant" && Array.isArray(message.suggestions) && message.suggestions.length > 0 && (
                <div className="mt-2 space-y-1">
                  {message.suggestions.map((tip, index) => (
                    <div key={`${message.id}-tip-${index}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Lightbulb className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="rounded-lg px-3 py-2 bg-secondary/30 border border-border/60">
              <div className="flex items-center gap-2 mb-1">
                <Bot className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Assistant</span>
              </div>
              <p className="text-sm text-muted-foreground">Analyzing latest machine data...</p>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about production, quality, energy, status..."
            className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="h-10 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
