# Grounded Transcript Q&A and Dictation Self-Correction Design

**Date:** 2026-09-05  
**Status:** Approved  
**Target:** WhimprFlow Hub UI & Dictation Engine  

---

## 1. Overview and Goals

This feature enhances WhimprFlow's notetaker and dictation system in three key areas:

1. **Single-Meeting Grounded Q&A (Local Memory)**:
   * Oatmeal-style inquiry bar pinned to the bottom of the active meeting view.
   * Scoped strictly to the selected meeting's transcript ("single transcript memory").
   * Returns structured, easy-to-read answers (concise summary, Markdown tables or bullet lists, and exact verbatim quotes).
   * Refuses unmentioned topics with zero hallucination.

2. **Global Collection Q&A (All-Transcripts Memory)**:
   * Oatmeal-style inquiry bar on the main Library dashboard (outside individual meetings).
   * Queries across the entire archive of recorded transcripts (`ask_library`).
   * Synthesizes findings across multiple meetings and displays source meeting chips with dates and titles that link directly into those meetings.

3. **Dictation Spoken Self-Correction (Auto-Edit)**:
   * Recognizes spoken retractions and mid-thought changes during live voice dictation (e.g. "meet at 2 PM, wait no, scratch that, make it 4 PM").
   * Resolves the correction in real time, emitting exclusively the final intended decision at the cursor.

---

## 2. Architecture and Subsystems

### A. Dual-Scope Grounded Q&A Engine

```
[ OUTSIDE: All-Transcripts Library View ]
  Sticky / In-flow Oatmeal Ask Bar:
  "Ask across all your meetings..."
              |
              v
        `ask_library(question)`
              |
        +-----+-----+
        |           |
        v           v
  Local Worker   OpenAI API
        |
        v
  Synthesized Answer + Meeting Source Pills [Meeting 1] [Meeting 2]

----------------------------------------------------------------------

[ INSIDE: Individual Meeting Detail View ]
  Sticky Oatmeal Ask Bar:
  "Ask anything about this meeting..."
              |
              v
        `ask_meeting(id, question)`
              |
        +-----+-----+
        |           |
        v           v
  Local Worker   OpenAI API
        |
        v
  Strictly Grounded Answer (Summary, Tables, Bullets, Quotes)
```

#### Grounding Constraints
* **Single Meeting Context Boundary**: Scoped exclusively to the selected meeting transcript. Cross-transcript data and outside web knowledge are excluded.
* **Global Collection Context Boundary**: Scoped to the user's recorded meeting archive. Excerpts are formatted with meeting IDs, titles, and dates.
* **Keyword Pre-filter**: If query terms are absent, returns an immediate refusal without calling the model.
* **Deterministic Generation**: Temperature locked to `0.0`.
* **Refusal Behavior**: If the topic cannot be substantiated by verbatim sentences, the model explicitly states it was not discussed.

#### Structured Output Contract
Every grounded response adheres to a three-tier structure:
1. **Direct Answer**: One to two plain sentences summarizing the finding.
2. **Structured Details**: A Markdown table (for comparisons, metrics, status tables, or multi-attribute items) or grouped bullet points.
3. **Transcript Evidence / Sources**: Verbatim blockquote citations for single-meeting queries, or clickable source meeting pills for global library queries.

---

### B. Oatmeal UI Layout Specifications

The UI provides the Oatmeal editorial layout across both scopes:

1. **Inside Meeting View (`viewNote` equivalent)**:
   * Centered column (`max-width: 720px`).
   * Pinned sticky bottom ask bar with quick pills (`Key decisions`, `Action items`, `Main topics`, `Next steps`, `Pillars / Takeaways`).
   * Conversational Q&A card stream above the bar with question row (`›`), dismiss (`×`), copy button, and pulsing status dot.

2. **Outside in Library View (`viewDash` equivalent)**:
   * Centered inquiry section at the top of the meeting library.
   * Rounded ask bar with placeholder: `"Ask across all your meetings (e.g. 'what did we decide about pricing?')"`
   * Result cards displaying synthesized findings and clickable meeting source tags. Clicking a source tag opens that meeting directly.

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
