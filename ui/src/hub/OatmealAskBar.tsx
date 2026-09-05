import { useEffect, useRef, useState } from "react";
import { theme } from "./theme";
import { font, palette } from "../tokens/values";
import { AnswerMarkdown } from "./AnswerMarkdown";
import { formatDate } from "./format";
import { Icon } from "./icons";

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
  fab?: boolean;
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
  fab,
}: OatmealAskBarProps) {
  const isFab = fab ?? false;
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        fabRef.current &&
        !fabRef.current.contains(e.target as Node)
      ) {
        setExpanded(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

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

  const qaCards = items.length > 0 && (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            background: theme.cardBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 14,
            padding: "16px 20px",
            boxShadow: theme.shadowSoft,
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

          <div style={{ marginTop: 10 }}>
            {item.loading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: theme.textMuted, fontSize: 13.5 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: theme.accentDeep }} />
                Thinking...
              </div>
            ) : item.error ? (
              <div style={{ color: palette.error, fontSize: 13.5 }}>{item.error}</div>
            ) : (
              <AnswerMarkdown text={item.answer} />
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
                      fontFamily: font.ui,
                    }}
                  >
                    {s.title} ({formatDate(s.started_at)})
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
  );

  const suggestionChips = (
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
  );

  const inputBar = (
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
          color: "#ffffff",
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
  );

  if (isFab) {
    return (
      <>
        {/* Floating Action Button */}
        <button
          ref={fabRef}
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          title="Ask Oatmeal about this meeting"
          aria-label="Ask Oatmeal about this meeting"
          style={{
            position: "fixed",
            bottom: 24,
            right: 28,
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: theme.accent,
            border: "none",
            boxShadow: theme.shadowHover,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            zIndex: 45,
            transition: "background 120ms ease, transform 120ms ease",
          }}
        >
          <Icon name="search" size={20} style={{ color: "#ffffff" }} />
          {items.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: -2,
                right: -2,
                minWidth: 18,
                height: 18,
                padding: "0 4px",
                borderRadius: 999,
                background: theme.bannerVia,
                color: "#ffffff",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: font.ui,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: theme.shadowSoft,
                border: `2px solid ${theme.cardBg}`,
                boxSizing: "border-box",
              }}
            >
              {items.length}
            </span>
          )}
        </button>

        {/* Expanded Panel */}
        {expanded && (
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              bottom: 84,
              right: 28,
              width: 440,
              maxWidth: "calc(100vw - 56px)",
              maxHeight: "calc(100vh - 120px)",
              display: "flex",
              flexDirection: "column",
              background: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 16,
              boxShadow: theme.shadowHover,
              zIndex: 45,
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: `1px solid ${theme.border}`,
                background: theme.cardBgSubtle,
                flex: "0 0 auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="search" size={16} style={{ color: theme.accentDeep }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: theme.textStrong, fontFamily: font.ui }}>
                  Ask Meeting
                </span>
                {items.length > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: theme.textMuted,
                      background: theme.track,
                      borderRadius: 999,
                      padding: "1px 7px",
                    }}
                  >
                    {items.length}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                title="Close"
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: theme.textMuted,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 4,
                  borderRadius: 6,
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Scrollable Q&A body */}
            <div
              style={{
                padding: "16px 16px 8px",
                overflowY: "auto",
                flex: 1,
                minHeight: 0,
              }}
            >
              {qaCards}
              {suggestionChips}
            </div>

            {/* Bottom input */}
            <div
              style={{
                padding: "8px 16px 14px",
                borderTop: `1px solid ${theme.border}`,
                background: theme.cardBgSubtle,
                flex: "0 0 auto",
              }}
            >
              {inputBar}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
      {qaCards}
      {suggestionChips}
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
        {inputBar}
      </div>
    </div>
  );
}
