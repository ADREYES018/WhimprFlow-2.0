# Grounded Transcript Q&A and Dictation Self-Correction Design

**Date:** 2026-09-05  
**Status:** Approved  
**Target:** WhimprFlow Hub UI & Dictation Engine  

---

## 1. Overview and Goals

This feature enhances WhimprFlow's notetaker and dictation system in two complementary areas:

1. **Grounded Transcript Search & Q&A**:
   * Introduces an Oatmeal-style interactive inquiry bar pinned to the bottom of the meeting view.
   * Isolates context exclusively to the active meeting transcript ("transcript memory").
   * Returns structured, easy-to-read answers (concise summary, Markdown tables or bullet lists, and exact verbatim quotes).
   * Refuses unmentioned topics cleanly with zero hallucination.
   * Supports local execution by default via `whimpr-llm-worker`, with an optional OpenAI API key toggle for cloud processing.

2. **Dictation Spoken Self-Correction (Auto-Edit)**:
   * Recognizes spoken retractions and mid-thought changes during live voice dictation (e.g. "meet at 2 PM, wait no, scratch that, make it 4 PM").
   * Resolves the correction in real time, emitting exclusively the final intended decision at the cursor.

---

## 2. Architecture and Subsystems

### A. Grounded Transcript Q&A Engine

```
+----------------------------------------------------------------+
|                       Meeting Detail View                      |
|                                                                |
|  [ Transcript Tab ]  [ Enhanced Notes Tab ]  [ Study Hub Tab ] |
|                                                                |
|  +----------------------------------------------------------+  |
|  | Q&A Stream: Answer Cards (Tables, Bullets, Quotes)       |  |
|  +----------------------------------------------------------+  |
|                                                                |
|  +----------------------------------------------------------+  |
|  | Sticky Ask Bar: [Pills] [Rounded Input] [Send Button]    |  |
|  +----------------------------------------------------------+  |
+----------------------------------------------------------------+
                                |
                                v
               `ask_meeting(id, question, provider)`
                                |
               +----------------+----------------+
               |                                 |
               v                                 v
      Local LLM Worker                  OpenAI API Client
      (Qwen 2.5 3B via llama.cpp)       (BYOK via Settings)
```

#### Grounding Constraints
* **Context Boundary**: The prompt contains exclusively the text of the selected meeting transcript. Cross-transcript data and outside web knowledge are excluded.
* **Keyword Pre-filter**: If non-stopword query terms are completely missing from the transcript, the backend returns `"That was not discussed in this recording"` immediately without executing the model.
* **Deterministic Generation**: Temperature is locked to `0.0` to ensure repeatable, factual answers.
* **Refusal Behavior**: If the topic cannot be substantiated by verbatim sentences in the transcript, the model explicitly states it was not discussed.

#### Structured Output Contract
Every grounded response adheres to a three-tier structure:
1. **Direct Answer**: One to two plain sentences summarizing the finding.
2. **Structured Details**: A Markdown table (for comparisons, metrics, status tables, or multi-attribute items) or grouped bullet points.
3. **Transcript Evidence**: Verbatim blockquote citations showing the exact phrases spoken in the recording.

---

### B. Oatmeal UI Layout Specifications

The UI mirrors the clean editorial layout of Oatmeal's `#viewNote` surface:

* **Container Geometry**: Centered content column (`max-width: 720px`), responsive side padding (24px to 32px).
* **Sticky Bottom Ask Bar**:
  * Pinned to the viewport bottom with subtle top gradient backdrop blur.
  * **Quick Pill Suggestions**: Horizontal scrollable chips above the input:
    * `Key decisions`
    * `Action items`
    * `Main topics`
    * `Next steps`
    * `Pillars / Takeaways`
  * **Rounded Input**: 22px border radius, background matching card surface, subtle focus ring. Placeholder: `"Ask anything about this meeting..."`.
  * **Submit Control**: 32px circular action button with forward arrow icon, active only when text is present.

* **Conversational Q&A Stream**:
  * Renders in flow above the ask bar.
  * **Question Row**: Prefixed with chevron `›`, bold query title, and top-right dismiss button (`×`).
  * **Answer Card**: Styled prose container supporting tables, monospace tokens, and quote bars.
  * **Copy Button**: Compact action button on each card with temporary `"Copied!"` indicator.
  * **Loading Indicator**: Animated pulsing status dot matching Oatmeal's emerald recording cluster.

---

### C. Dictation Spoken Self-Correction (Auto-Edit)

During live cursor dictation:
* **Trigger Phrases**: Spoken retractions including `"scratch that"`, `"wait no"`, `"no wait"`, `"actually"`, `"make that"`, `"I meant"`, `"rather"`, `"delete that"`, `"never mind"`.
* **Execution Rule**: When a trigger phrase is detected:
  1. Identify the abandoned clause (reparandum) preceding the trigger.
  2. Identify the repair phrase following the trigger.
  3. Discard the abandoned clause and output only the final decision.
* **Intensifier Guard**: When `"actually"` is spoken without a retraction (e.g. `"I actually enjoyed the presentation"`), the word is preserved as valid dictation.

---

## 3. Data Flow and State Management

### Frontend State (`LibraryPane.tsx`)
* `qaItems`: Array of meeting queries:
  ```ts
  interface MeetingQAItem {
    id: string;
    question: string;
    answer: string;
    timestamp: number;
    loading: boolean;
    error?: string;
  }
  ```
* `activeProvider`: `"local" | "openai"`. Defaults to `"local"`. Toggled via settings or subtle ask bar switch.
* `asking`: Boolean flag disabling input during active generation.

### Tauri Command Interface
* `ask_meeting(id: string, question: string)`:
  * Backend retrieves transcript segments for meeting `id`.
  * Formats prompt with strict grounding instructions and structured layout rules.
  * Invokes selected provider (local worker or OpenAI).
  * Returns structured Markdown text.

---

## 4. Error Handling and Edge Conditions

| Scenario | Behavior |
| :--- | :--- |
| **Meeting not yet transcribed** | Input disabled; banner shows *"Transcript processing in background..."* |
| **Empty or whitespace question** | Send button disabled; Enter key ignored |
| **Topic not mentioned in audio** | Returns clean card: *"Not discussed in this recording"* |
| **Local worker unresponsive** | Shows inline card error with a *"Retry"* button |
| **OpenAI key missing when cloud selected** | Prompts user with direct button: *"Open Settings to set OpenAI Key"* |
| **Transcript longer than 8k tokens (Local)** | Chunks transcript or prioritizes top keyword-relevant sections |

---

## 5. Verification Checklist

1. **Grounded Memory Isolation**:
   * Query a topic mentioned in Meeting A while viewing Meeting B.
   * **Verification**: Meeting B refuses with *"Not discussed in this recording"*.

2. **Structured Output Formatting**:
   * Ask for a breakdown or list of items (e.g. *"What are the core topics?"*).
   * **Verification**: Response contains summary, Markdown table or bullets, and blockquote citation.

3. **Oatmeal UI Fidelity**:
   * Ask bar is sticky at bottom across all meeting tabs.
   * Clicking suggestion pills submits instantly.
   * Q&A cards can be dismissed (`×`) and copied.

4. **Spoken Self-Correction in Dictation**:
   * Dictate: *"Send the report on Monday, wait scratch that, send it on Wednesday morning."*
   * **Verification**: Cursor receives only *"Send it on Wednesday morning."*
