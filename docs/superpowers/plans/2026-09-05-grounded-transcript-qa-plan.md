# Grounded Transcript Q&A and Dictation Self-Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dual-scope Oatmeal Ask Bar and Feed (single-meeting transcript memory and global library memory) with structured outputs, alongside dictation spoken self-correction resolution.

**Architecture:** A unified Oatmeal-style ask bar and conversational Q&A card component in React 18 (`ui/src/hub/`) operating in two contexts: (1) sticky bottom within any meeting detail view querying that single transcript (`ask_meeting`), and (2) at the top of the library querying the whole archive (`ask_library`). The backend prompt contract in `whimpr-notes` is updated to enforce structured Markdown tables, bullet lists, and verbatim quotes. Spoken self-correction test suites in `whimpr-core` are verified and fortified.

**Tech Stack:** React 18, TypeScript, Tauri v2, Rust (`whimpr-notes`, `whimpr-core`, `whimpr-cleanup`).

## Global Constraints

- Never regress existing shipping features: dictation, transforms, snippets, scratchpad, or meeting recordings.
- Match existing UI design conventions from `ui.tsx`, `theme.ts`, and `tokens/values.ts`. No ad-hoc colors.
- Every Tauri command invocation goes through `api.ts` wrappers. Panes never call Tauri `invoke` directly.
- All mutations and async actions handle errors through `useAction` without silently swallowing failures.
- No em-dashes allowed anywhere in code or user-facing copy.
- Run `ui/node_modules/.bin/tsc --noEmit` after every frontend change.
- Run `cargo test` after every Rust change.

---

### Task 1: Backend Grounding and Structured Output Prompts in `whimpr-notes`

**Files:**
- Modify: `crates/whimpr-notes/src/chat.rs:180-205`
- Test: `crates/whimpr-notes/src/chat.rs` (in-file unit tests)

**Interfaces:**
- Consumes: `recap()`, `ask_meeting()`, `complete_streaming()`
- Produces: Structured Markdown output containing Direct Summary, Structured Data (Table or Bullets), and Verbatim Quotes.

- [ ] **Step 1: Write failing unit test for structured grounded output**

Add a test in `crates/whimpr-notes/src/chat.rs`:
```rust
#[test]
fn test_recap_structured_output_format_instructions() {
    assert!(RECAP_SYSTEM.contains("Direct Summary"));
    assert!(RECAP_SYSTEM.contains("Markdown table"));
    assert!(RECAP_SYSTEM.contains("Exact Quotes"));
    assert!(!RECAP_SYSTEM.contains("—"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p whimpr-notes test_recap_structured_output_format_instructions`  
Expected: FAIL due to missing instruction keywords in `RECAP_SYSTEM`.

- [ ] **Step 3: Update `RECAP_SYSTEM` with structured output contract**

Update `RECAP_SYSTEM` in `crates/whimpr-notes/src/chat.rs`:
```rust
pub const RECAP_SYSTEM: &str = "\
You answer questions about a meeting or lecture using exclusively the provided transcript text. \
The transcript comes from automatic speech recognition, so expect minor errors and no speaker labels.

Structure your response into these parts:
1. Direct Summary: One to two sentences directly answering the question.
2. Structured Breakdown: Grouped bullet points or a Markdown table for any comparisons, lists, numbers, or key pillars.
3. Exact Quotes: Verbatim quote block from the transcript supporting each claim.

Every claim must be traceable to the transcript text. If the transcript does not contain the answer, \
say 'That was not discussed in this recording' and stop; never guess or introduce external facts.";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-notes test_recap_structured_output_format_instructions`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/whimpr-notes/src/chat.rs
git commit -m "feat(notes): enforce structured grounded format in recap system prompt"
```

---

### Task 2: Reusable Oatmeal Ask Bar and Q&A Feed Component

**Files:**
- Create: `ui/src/hub/OatmealAskBar.tsx`
- Modify: `ui/src/hub/api.ts` (export types if needed)
- Test: `ui/node_modules/.bin/tsc --noEmit`

**Interfaces:**
- Consumes: `theme.ts`, `tokens/values.ts`, `Icon` from `icons.tsx`
- Produces: `<OatmealAskBar />` component with suggestion chips, input, send button, and conversational QA card list.

- [ ] **Step 1: Define QA item interface and OatmealAskBar component**

Create `ui/src/hub/OatmealAskBar.tsx`:
```tsx
import React, { useState } from "react";
import { theme } from "./theme";
import { font } from "../tokens/values";
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
}

export function OatmealAskBar({
  items,
  onAsk,
  onDismiss,
  onSelectSource,
  suggestions = ["Key decisions", "Action items", "Main topics", "Next steps"],
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
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
      {/* Q&A Cards List */}
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
                <div style={{ color: theme.red }}>{item.error}</div>
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
          background: theme.bg,
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
            <Icon name="arrowRight" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ui && ./node_modules/.bin/tsc --noEmit`  
Expected: Clean compilation with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/hub/OatmealAskBar.tsx
git commit -m "feat(ui): create reusable OatmealAskBar and QA card stream component"
```

---

### Task 3: Embed Single-Meeting Grounded Ask Bar in Meeting Detail

**Files:**
- Modify: `ui/src/hub/LibraryPane.tsx:90-110, 1280-1340`
- Test: `ui/node_modules/.bin/tsc --noEmit`

**Interfaces:**
- Consumes: `<OatmealAskBar />`, `askMeeting` from `api.ts`
- Produces: Persistent grounded ask bar across meeting views, with single transcript context.

- [ ] **Step 1: Add per-meeting QA state to `LibraryPane.tsx`**

Add state in `LibraryPane.tsx`:
```tsx
const [meetingQAHistory, setMeetingQAHistory] = useState<Record<string, QAItem[]>>({});
```

- [ ] **Step 2: Implement `handleMeetingAsk` handler**

```tsx
const handleMeetingAsk = async (question: string) => {
  if (!selectedMeeting) return;
  const meetingId = selectedMeeting.id;
  const tempId = `qa-${Date.now()}`;
  const newItem: QAItem = { id: tempId, question, answer: "", loading: true };

  setMeetingQAHistory((prev) => ({
    ...prev,
    [meetingId]: [...(prev[meetingId] ?? []), newItem],
  }));

  try {
    const answer = await askMeeting(meetingId, question);
    setMeetingQAHistory((prev) => ({
      ...prev,
      [meetingId]: (prev[meetingId] ?? []).map((q) =>
        q.id === tempId ? { ...q, answer, loading: false } : q
      ),
    }));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    setMeetingQAHistory((prev) => ({
      ...prev,
      [meetingId]: (prev[meetingId] ?? []).map((q) =>
        q.id === tempId ? { ...q, error: errorMsg, loading: false } : q
      ),
    }));
  }
};
```

- [ ] **Step 3: Render `<OatmealAskBar />` sticky inside meeting detail**

Place `<OatmealAskBar />` at the bottom of the meeting container so it is available regardless of which detail tab (Transcript, Notes, Study) is selected.

- [ ] **Step 4: Typecheck**

Run: `cd ui && ./node_modules/.bin/tsc --noEmit`  
Expected: Clean compilation with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/hub/LibraryPane.tsx
git commit -m "feat(ui): wire OatmealAskBar into meeting detail view with single transcript grounding"
```

---

### Task 4: Embed Global Collection Ask Bar in Library Dashboard

**Files:**
- Modify: `ui/src/hub/LibraryPane.tsx:540-620`
- Test: `ui/node_modules/.bin/tsc --noEmit`

**Interfaces:**
- Consumes: `<OatmealAskBar />`, `askLibrary` from `api.ts`
- Produces: Library-wide query bar synthesizing across all transcripts with clickable meeting source tags.

- [ ] **Step 1: Add global QA history state to `LibraryPane.tsx`**

Add state in `LibraryPane.tsx`:
```tsx
const [libraryQAItems, setLibraryQAItems] = useState<QAItem[]>([]);
```

- [ ] **Step 2: Implement `handleGlobalLibraryAsk` handler**

```tsx
const handleGlobalLibraryAsk = async (question: string) => {
  const tempId = `global-qa-${Date.now()}`;
  const newItem: QAItem = { id: tempId, question, answer: "", loading: true };

  setLibraryQAItems((prev) => [...prev, newItem]);

  try {
    const res = await askLibrary(question);
    setLibraryQAItems((prev) =>
      prev.map((q) =>
        q.id === tempId
          ? { ...q, answer: res.answer, sources: res.sources, loading: false }
          : q
      )
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    setLibraryQAItems((prev) =>
      prev.map((q) =>
        q.id === tempId ? { ...q, error: errorMsg, loading: false } : q
      )
    );
  }
};
```

- [ ] **Step 3: Replace old ask-library box with `<OatmealAskBar />`**

Embed `<OatmealAskBar />` at the top of the Library meeting list with:
- `placeholder="Ask across all your meetings (e.g. 'what did we decide about pricing?')"`
- `suggestions={["Decisions across all meetings", "Key action items pending", "Latest roadmap updates"]}`
- `onSelectSource={(sourceId) => setSelectedMeetingId(sourceId)}`
- `stickyBottom={false}`

- [ ] **Step 4: Typecheck**

Run: `cd ui && ./node_modules/.bin/tsc --noEmit`  
Expected: Clean compilation with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/hub/LibraryPane.tsx
git commit -m "feat(ui): add global collection Oatmeal ask bar and source navigation to library dashboard"
```

---

### Task 5: Dictation Spoken Self-Correction Verification in `whimpr-cleanup`

**Files:**
- Modify/Verify: `crates/whimpr-core/src/cleanup/prompts.rs`
- Test: `crates/whimpr-core/src/cleanup/tests.rs` (or equivalent test module)

**Interfaces:**
- Consumes: Dictation raw transcript with spoken retractions
- Produces: Cleaned string with abandoned clauses dropped and final decision preserved.

- [ ] **Step 1: Write test cases for mid-speech self-corrections**

Add unit tests in `crates/whimpr-core/src/cleanup/`:
```rust
#[test]
fn test_self_correction_retraction_cues() {
    let cases = [
        ("meet at two wait no scratch that make it four PM", "Meet at 4:00 PM."),
        ("send the file to Mark actually send it to Rachel", "Send the file to Rachel."),
        ("we are canceling the launch no wait pause the launch", "Pause the launch."),
    ];
    for (input, expected) in cases {
        assert_eq!(clean_dictation(input), expected);
    }
}
```

- [ ] **Step 2: Run test suite**

Run: `cargo test -p whimpr-core`  
Expected: PASS verifying prompt instructions accurately handle retractions.

- [ ] **Step 3: Commit**

```bash
git add crates/whimpr-core/
git commit -m "test(cleanup): verify dictation spoken self-correction behavior and cues"
```
