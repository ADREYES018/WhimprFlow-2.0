import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { theme } from "./theme";
import { font } from "../tokens/values";

// Shared renderer for every surface that shows a grounded Q&A answer:
// OatmealAskBar, LibraryPane's meeting ask bar, and MeetingsPane's live
// "Ask about this session" box. Kept in one place so the three surfaces
// cannot drift back into rendering answers differently.
//
// react-markdown does not process raw HTML unless the rehype-raw plugin is
// added, so a literal `<script>` or `<img onerror=...>` in model output
// renders as inert text rather than executing. We do not add rehype-raw,
// which is what keeps this safe.
export function AnswerMarkdown({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.65, color: theme.textBody, fontFamily: font.ui }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          ul: ({ children }) => (
            <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ol>
          ),
          li: ({ children }) => <li style={{ marginBottom: 3 }}>{children}</li>,
          h1: ({ children }) => (
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.textStrong, margin: "4px 0 8px" }}>
              {children}
            </div>
          ),
          h2: ({ children }) => (
            <div style={{ fontSize: 14, fontWeight: 700, color: theme.textStrong, margin: "4px 0 8px" }}>
              {children}
            </div>
          ),
          h3: ({ children }) => (
            <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong, margin: "4px 0 6px" }}>
              {children}
            </div>
          ),
          strong: ({ children }) => (
            <strong style={{ color: theme.textStrong, fontWeight: 600 }}>{children}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "0 0 10px",
                padding: "6px 12px",
                borderLeft: `3px solid ${theme.accentSoftBorder}`,
                background: theme.cardBgSubtle,
                color: theme.textMuted,
                borderRadius: "0 6px 6px 0",
              }}
            >
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code
              style={{
                background: theme.cardBgSubtle,
                border: `1px solid ${theme.border}`,
                borderRadius: 4,
                padding: "1px 5px",
                fontFamily: font.mono,
                fontSize: "0.92em",
                color: theme.textStrong,
              }}
            >
              {children}
            </code>
          ),
          hr: () => <hr style={{ border: "none", borderTop: `1px solid ${theme.border}`, margin: "10px 0" }} />,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" style={{ color: theme.accentDeep }}>
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: "auto", marginBottom: 10 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  minWidth: 360,
                  fontSize: 13,
                }}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{ background: theme.cardBgSubtle }}>{children}</thead>
          ),
          th: ({ children }) => (
            <th
              style={{
                textAlign: "left",
                padding: "6px 10px",
                border: `1px solid ${theme.border}`,
                color: theme.textStrong,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                padding: "6px 10px",
                border: `1px solid ${theme.border}`,
                color: theme.textBody,
                verticalAlign: "top",
              }}
            >
              {children}
            </td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
