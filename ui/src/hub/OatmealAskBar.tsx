import { useState } from "react";
import { theme } from "./theme";
import { font, palette } from "../tokens/values";

export interface QAItem {
  id: string;
  question: string;
  answer: string;
  loading?: boolean;
  error?: string;
  sources?: { id: string; title: string; started_at: string }[];
}

interface OatmealAskBarProps {
  items: QAItem[];
  onAsk: (question: string) => Promise<void>;
  onDismiss: (id: string) => void;
  onSelectSource?: (sourceId: string) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
  stickyBottom?: boolean;
}

export function OatmealAskBar({
  items,
  onAsk,
  onDismiss,
  onSelectSource,
  suggestions = ["Key decisions", "Action items", "Main topics", "Next steps", "Pillars / Takeaways"],
  placeholder = "Ask anything about this meeting...",
  disabled = false,
  stickyBottom = true,
}: OatmealAskBarProps) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleSubmit = async (text: string) => {
    const q = text.trim();
    if (!q || submitting || disabled) return;
    setInput("");
    setSubmitting(true);
    try {
      await onAsk(q);
    } catch (err) {
      // onAsk implementations are expected to catch their own errors and
      // surface them via QAItem.error. This catch is only a fallback for
      // when a caller does not follow that contract, so the failure does
      // not become a silent unhandled rejection.
      console.error("OatmealAskBar: onAsk rejected without handling its own error", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
      },
      (err) => {
        console.error("OatmealAskBar: clipboard write failed", err);
      }
    );
  };

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
      {/* Q&A Cards List */}
      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                background: theme.cardBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 14,
                padding: "16px 20px",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
                  <span style={{ color: theme.accentDeep, fontSize: 16 }}>›</span>
                  <span>{item.question}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onDismiss(item.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: theme.textFaint,
                    fontSize: 16,
                    padding: 2,
                    lineHeight: 1,
                  }}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>

              <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.65, color: theme.textBody, whiteSpace: "pre-wrap" }}>
                {item.loading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: theme.textMuted }}>
                    <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: theme.accentDeep }} />
                    Thinking...
                  </div>
                ) : item.error ? (
                  <div style={{ color: palette.error }}>{item.error}</div>
                ) : (
                  item.answer
                )}
              </div>

              {/* Sources section if present */}
              {item.sources && item.sources.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${theme.border}` }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: theme.textMuted, marginBottom: 6 }}>
                    Referenced Meetings:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {item.sources.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onSelectSource && onSelectSource(s.id)}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 6,
                          border: `1px solid ${theme.border}`,
                          background: theme.cardBgSubtle,
                          fontSize: 11.5,
                          color: theme.accentDeep,
                          cursor: "pointer",
                        }}
                      >
                        {s.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!item.loading && !item.error && item.answer && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => handleCopy(item.id, item.answer)}
                    style={{
                      background: "transparent",
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      padding: "3px 9px",
                      fontSize: 11.5,
                      color: theme.textMuted,
                      cursor: "pointer",
                    }}
                  >
                    {copiedId === item.id ? "Copied!" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Suggestion Chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void handleSubmit(s)}
            disabled={submitting || disabled}
            style={{
              background: theme.cardBgSubtle,
              border: `1px solid ${theme.border}`,
              borderRadius: 18,
              padding: "5px 12px",
              fontSize: 12,
              color: theme.textMuted,
              cursor: "pointer",
              fontFamily: font.ui,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Ask Input Bar */}
      <div
        style={{
          position: stickyBottom ? "sticky" : "relative",
          bottom: stickyBottom ? 0 : undefined,
          background: theme.pageBg,
          padding: "8px 0 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: theme.cardBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 22,
            padding: "4px 8px 4px 16px",
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSubmit(input);
              }
            }}
            placeholder={placeholder}
            disabled={submitting || disabled}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: 13.5,
              color: theme.textStrong,
              fontFamily: font.ui,
            }}
          />
          <button
            type="button"
            onClick={() => void handleSubmit(input)}
            disabled={submitting || disabled || !input.trim()}
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: "none",
              background: input.trim() ? theme.accent : theme.border,
              color: "#fff",
              cursor: input.trim() ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Ask"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
