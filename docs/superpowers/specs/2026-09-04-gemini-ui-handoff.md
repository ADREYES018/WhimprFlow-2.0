# Gemini handoff — WhimprFlow Hub UI

Two independent tracks. **Track A** is ready now. **Track B** starts once Task 7 of the merge plan lands.

Copy the track you are starting, from its `---` to the end of its section, into your agent. Each is self-contained.

---

# TRACK A — the four new panes

You are working in the WhimprFlow repository at `~/Adriel_2.0/WhimprFlow`. It is a Tauri v2 desktop app: a Rust core plus a React and TypeScript webview. Your job is the React side only.

## Your task

Build four Hub panes that currently render a "Coming soon" placeholder: **Scratchpad**, **Snippets**, **Transforms**, **Style**. Each becomes a real, working pane.

## Hard boundaries

- **Do not touch any Rust file.** Nothing under `crates/`, nothing under `src-tauri/src/`. Those are owned by someone else and are changing in parallel. If you believe a Rust change is needed, stop and say so instead of making it.
- **Do not change** `Sidebar.tsx`, `theme.ts`, `tokens/values.ts`, `Home.tsx`, `Insights.tsx`, `SettingsPane.tsx`, `Onboarding.tsx`, or `Help.tsx`.
- **You may change** `ui/src/hub/App.tsx` (only to route the new panes), `ui/src/hub/api.ts` (only to add wrappers), `ui/src/hub/icons.tsx` (only to add icons), and you may create new files under `ui/src/hub/`.
- **Do not add dependencies.** No component library, no CSS framework, no state manager, no form library. The existing code is plain React with inline style objects. Match it.

## The codebase you are joining

Read these first. They define the house style, and you match it rather than improving on it:

- `ui/src/hub/DictionaryPane.tsx` — the closest existing analogue. A list with add, edit, delete, and local tabs. Copy its structure.
- `ui/src/hub/ui.tsx` — exports `Card`, `Dot`, `Button`, `Segmented`, `PageTitle`, `useStats`. Use these. Do not write your own button.
- `ui/src/hub/theme.ts` — every colour. Use tokens (`theme.textMuted`, `theme.accentSoft`, `theme.border`). Never hardcode a hex value.
- `ui/src/tokens/values.ts` — `font.ui` and `font.serif`. Page titles use serif, everything else uses ui.
- `ui/src/hub/icons.tsx` — the `Icon` component and the `IconName` union. `snippets`, `style`, `transforms`, `scratchpad` already exist.
- `ui/src/hub/api.ts` — the Tauri command wrappers.

### The api.ts pattern, which you follow exactly

Every wrapper dynamically imports `invoke` and catches, returning a safe default, so the Hub still renders under plain `vite dev` with no Rust shell attached:

```ts
export async function getSnippets(): Promise<Snippet[]> {
  try {
    return await invoke<Snippet[]>("get_snippets");
  } catch {
    return [];
  }
}
```

This matters more than usual: **the Rust commands may not exist yet.** They are being written in parallel. Your panes must render and be fully navigable against those fallback values. Build and verify with `cd ui && pnpm dev` in a browser. Do not try to run the full Tauri app.

## Command contracts

Write these into `api.ts` as typed wrappers. Field names are snake_case because they cross the Rust boundary. Do not rename them.

### Scratchpad

```ts
export interface Scratchpad { text: string; updated_at: number; capture_mode: boolean; }

getScratchpad(): Promise<Scratchpad>            // fallback { text: "", updated_at: 0, capture_mode: false }
setScratchpadText(text: string): Promise<void>
setScratchpadCapture(on: boolean): Promise<void>
```

### Snippets

```ts
export interface Snippet { trigger: string; expansion: string; enabled: boolean; }

getSnippets(): Promise<Snippet[]>               // fallback []
addSnippet(trigger: string, expansion: string): Promise<void>
updateSnippet(trigger: string, expansion: string, enabled: boolean): Promise<void>
removeSnippet(trigger: string): Promise<void>
```

### Transforms

```ts
export type TransformSource = "utterance" | "selection" | "scratchpad";

export interface Transform {
  id: string;
  name: string;
  triggers: string[];
  prompt: string;              // template, {input} substituted at run time
  default_source: TransformSource;
  builtin: boolean;
}

getTransforms(): Promise<Transform[]>           // fallback []
addTransform(transform: Transform): Promise<void>
updateTransform(transform: Transform): Promise<void>
removeTransform(id: string): Promise<boolean>   // false for a builtin; fallback false
runTransform(id: string, source: TransformSource): Promise<string>   // fallback ""
```

### Style

```ts
export interface StyleProfile {
  avg_sentence_words: number;
  contractions: boolean;
  punctuation_notes: string;
  banned_words: string[];
  tone_notes: string;
  derived_at: number;
}

export interface StyleContext {
  id: string;
  name: string;
  bundle_ids: string[];
  profile: StyleProfile;
}

export interface StyleStore {
  samples: string[];
  base: StyleProfile | null;
  contexts: StyleContext[];
  auto_learn: boolean;
  dictations_since_derive: number;
  pending: StyleProfile | null;
}

getStyle(): Promise<StyleStore>
// fallback { samples: [], base: null, contexts: [], auto_learn: false,
//            dictations_since_derive: 0, pending: null }
addStyleSample(text: string): Promise<void>
removeStyleSample(index: number): Promise<void>
deriveStyleProfile(): Promise<StyleProfile | null>   // fallback null
proposeStyleProfile(): Promise<StyleProfile | null>  // fallback null
setStyleProfile(profile: StyleProfile): Promise<void>
setStyleContext(context: StyleContext): Promise<void>
removeStyleContext(id: string): Promise<void>
setStyleAutoLearn(on: boolean): Promise<void>
acceptPendingStyle(): Promise<void>
discardPendingStyle(): Promise<void>
```

The re-derive threshold is **25** accepted dictations. Hardcode that constant in the pane.

## What each pane does

### `ScratchpadPane.tsx`

A quiet place to dictate long-form before it goes anywhere else.

- Full-height textarea filling the content area. Comfortable line height, generous padding. This is a writing surface, so it should feel like one and not like a form field.
- Autosave via `setScratchpadText` on a 500 ms debounce, with a small calm saved indicator. No modal, no toast.
- A **Capture mode** toggle bound to `setScratchpadCapture`, with a one-line explanation beside it. It silently changes where dictated words go, and that must never be a surprise.
- A transform picker populated from `getTransforms`, plus a Run button calling `runTransform(id, "scratchpad")` that replaces the text. One level of undo, so a bad transform is recoverable.
- Word count in the footer.

### `SnippetsPane.tsx`

Reusable phrases expanded by voice.

- List: trigger phrase, a truncated preview of the expansion, an enabled toggle, edit, delete.
- Add form: trigger on one line, expansion multiline.
- Empty state explaining what a snippet is with one concrete example: say "my signature" while dictating and the full sign-off is typed out.
- Follow `DictionaryPane.tsx` for list layout, spacing, and the add row.

### `TransformsPane.tsx`

Named prompt presets that turn a spoken thought into an email, a summary, or a to-do.

- List of transforms. Builtins carry a subtle badge and cannot be deleted, only edited. Custom ones can be deleted.
- Each row shows name, trigger phrases as small chips, and the default source.
- Edit view: name, a chip editor for triggers, a source selector built from the existing `Segmented` component with Utterance, Selection, Scratchpad, and a prompt template textarea with a hint that `{input}` is replaced by the source text.
- A "Run on selection" button per transform calling `runTransform(id, "selection")`, showing the result in a panel. This is how a transform gets tested without speaking.

### `StylePane.tsx`

Teaches the cleanup engine to sound like the user. Four sections, top to bottom.

1. **Pending update.** Rendered only when `pending` is not null, and then it is the most important thing on the page, so it goes first. A field-by-field diff of `pending` against `base`, with Accept and Discard calling `acceptPendingStyle` and `discardPendingStyle`. Reads clearly at a glance.
2. **Base profile.** Every `StyleProfile` field as an editable control: a number input for `avg_sentence_words`, a toggle for `contractions`, text inputs for `punctuation_notes` and `tone_notes`, a chip editor for `banned_words`. Save calls `setStyleProfile`. When `base` is null, an empty state rather than blank controls.
3. **Contexts.** A list of per-app overrides. Each shows its name, its bundle ids as chips, and expands to the same profile editor. Add and remove via `setStyleContext` and `removeStyleContext`. Copy should explain the idea in one line: the register for a client email is not the register for a note to yourself.
4. **Samples and auto-learn.** A list of pasted samples with previews and remove controls, an "Add sample" textarea, and a "Derive from samples" button calling `deriveStyleProfile`, disabled with an explanation when there are no samples. Then an auto-learn toggle bound to `setStyleAutoLearn`, with `dictations_since_derive` shown as progress toward 25.

## Routing

In `App.tsx`, the `SOON` map near line 104 holds the four placeholder entries. As each pane lands, remove its entry and add a render branch beside the existing `{page === "dictionary" && <DictionaryPane />}` lines. When all four are gone, delete the empty `SOON` map, its `soon` local, the `{soon && ...}` render line, the `ComingSoon` import, and `ui/src/hub/ComingSoon.tsx`.

## Design bar

The person who owns this app is a visual artist. Output that merely functions is not acceptable.

- Match the existing Hub exactly: same spacing rhythm, same card treatment, same type scale, same restraint. A new pane should be indistinguishable in provenance from `DictionaryPane.tsx`.
- Serif (`font.serif`) for page titles only. Everything else `font.ui`.
- No emoji. No gradients beyond what `theme.ts` defines. No decorative icons.
- **No em-dashes in any copy.** Use a comma, a period, or restructure.
- Every empty state earns its space: say what the feature does and give one concrete example, never just "No items yet".
- Every destructive action is reversible or confirmed inline. No `window.confirm`, no `alert`. A modal dialog in a Tauri webview blocks the whole event loop.

## Order of work

Build in this order, verifying each in the browser before the next:

1. `api.ts` wrappers for all four features
2. `ScratchpadPane.tsx`
3. `SnippetsPane.tsx`
4. `TransformsPane.tsx`
5. `StylePane.tsx`

## Done means

- `cd ui && pnpm build` passes with no TypeScript errors.
- All four panes render and are fully navigable under `pnpm dev` with no Rust backend, using the fallback values.
- No file under `crates/` or `src-tauri/` is modified. Verify with `git status` before reporting finished.

---

# TRACK B — the meeting and notes surfaces

**Do not start this until the merge plan's Task 7 has landed.** Check with: `ls ~/Adriel_2.0/WhimprFlow/crates/whimpr-meetings`. If that directory does not exist, stop and say so.

You are working in the WhimprFlow repository at `~/Adriel_2.0/WhimprFlow`. Everything in Track A's **Hard boundaries**, **The codebase you are joining**, **api.ts pattern**, and **Design bar** sections applies here unchanged. Read them first.

## Your task

WhimprFlow is absorbing Oatmeal, a local meeting recorder. Oatmeal's Rust is being ported into WhimprFlow's crates by someone else. Its user interface is 6,370 lines of vanilla HTML and JavaScript, and your job is to rebuild those surfaces as React panes inside the existing Hub.

## Read the source you are replacing

The original UI is at `~/Adriel_2.0/oatmeal-repo/app/src/`. It is **reference, not a template**:

- `index.html` (1,511 lines) — the main window: recording controls, agenda, meeting list, ask box, homework, settings
- `app.js` (2,954 lines) — all of its behavior
- `transcript.html` and `transcript.js` (968 lines) — the live transcript window
- `math.js`, `mathml.js`, `datepicker.js` — LaTeX rendering and a date picker
- `base.css` — its styling, which you are **not** carrying over. WhimprFlow's theme replaces it entirely.

Read it to learn what each screen does and which command each control calls. Then build the equivalent in the Hub's language. Do not port its markup, its class names, or its CSS.

## New sidebar entries

`ui/src/hub/Sidebar.tsx` gains four pages. Add them to the `Page` union and the `MAIN` array, after `scratchpad`:

```ts
| "meetings" | "notes" | "study" | "homework"
```

Add matching entries to `IconName` and `PATHS` in `icons.tsx`. Draw them in the existing style: 24×24 viewBox, 1.6 stroke width, two or three path strings, no fills.

## Command contracts

Every one of these is a real Tauri command in the merged app. Write typed wrappers in `api.ts` with the same try/catch fallback pattern.

```ts
// ── Recording session ──
export interface SessionState { active: boolean; elapsed_ms: number | null; }
beginSession(title: string): Promise<void>
continueSession(id: string): Promise<void>
stopSession(): Promise<string>            // returns the meeting id; fallback ""
isSessionActive(): Promise<boolean>       // fallback false
sessionElapsedMs(): Promise<number | null>
setMicMuted(muted: boolean): Promise<boolean>
isMicMuted(): Promise<boolean>
setHiddenFromCapture(hidden: boolean): Promise<void>
isHiddenFromCapture(): Promise<boolean>

// ── Live transcript ──
export interface LiveLine { ts_ms: number; text: string; speaker: string | null; }
liveLines(): Promise<LiveLine[]>          // fallback []
setTranscriptWindowVisible(visible: boolean): Promise<void>
setTranscriptPinned(pinned: boolean): Promise<void>
isTranscriptWindowVisible(): Promise<boolean>

// ── Library ──
export interface Meeting {
  id: string; title: string; started_at: number;
  duration_secs: number; folder: string | null; has_notes: boolean;
}
export interface TranscriptLine { ts_ms: number; text: string; speaker: string | null; }
export interface SearchHit { meeting_id: string; line: TranscriptLine; }
export interface Folder { name: string; count: number; }

listMeetings(): Promise<Meeting[]>              // fallback []
searchMeetings(query: string): Promise<Meeting[]>
searchSnippets(query: string): Promise<SearchHit[]>
meetingSegments(id: string): Promise<TranscriptLine[]>
meetingTypedNotes(id: string): Promise<string>
renameMeeting(id: string, title: string): Promise<void>
deleteMeeting(id: string): Promise<string>
exportMeeting(id: string): Promise<string>      // returns a written file path
listFolders(): Promise<Folder[]>
createFolder(name: string): Promise<void>
renameFolder(oldName: string, newName: string): Promise<void>
deleteFolder(name: string): Promise<void>
moveMeetingToFolder(id: string, folder: string | null): Promise<void>

// ── Notes and questions ──
writeNotes(id: string): Promise<string>
saveNotes(id: string, body: string): Promise<void>
askMeeting(id: string, question: string): Promise<string>
askLibrary(question: string): Promise<{ answer: string; meeting_ids: string[] }>
draftFollowup(id: string): Promise<string>

// ── Study ──
export interface Flashcard { front: string; back: string; }
export interface QuizQuestion { question: string; choices: string[]; answer_index: number; }
export interface StudySettings { count: number; difficulty: string; }

generateStudyPlan(id: string, settings: StudySettings): Promise<string>
generateFlashcards(id: string, settings: StudySettings): Promise<Flashcard[]>
generateQuiz(id: string, settings: StudySettings): Promise<QuizQuestion[]>
cachedStudyPlan(id: string): Promise<string | null>
cachedFlashcards(id: string): Promise<Flashcard[] | null>
cachedQuiz(id: string): Promise<QuizQuestion[] | null>
lastStudySettings(id: string): Promise<StudySettings | null>

// ── Homework ──
export interface HomeworkItem {
  id: string; title: string; note: string; due_date: string; done: boolean;
}
listHomework(): Promise<HomeworkItem[]>
addHomework(title: string, note: string, dueDate: string): Promise<HomeworkItem>
setHomeworkDone(id: string, done: boolean): Promise<void>
deleteHomework(id: string): Promise<void>

// ── Media ──
export interface VideoInfo { title: string; duration_secs: number; }
videoProbe(url: string): Promise<VideoInfo | null>
videoImport(url: string, startSecs: number, endSecs: number): Promise<string>

// ── Models and calendar ──
chatModelStatus(): Promise<{ present: boolean; path: string; bytes: number }>
ensureChatModel(): Promise<string>
calendarAuthorized(): Promise<boolean>
calendarRequestAccess(): Promise<boolean>
listEvents(days: number): Promise<{ events: { title: string; start: number; end: number }[] }>
openCalendarSettings(): Promise<void>
```

### Streaming

Note generation, answers, and study output stream token by token. They arrive as Tauri events, not as the command's return value. Subscribe the same way `App.tsx` already listens for `whimpr://error`:

```ts
const { listen } = await import("@tauri-apps/api/event");
const un = await listen<string>("whimpr://chat/token", (e) => append(e.payload));
```

Render partial text as it arrives. A thirty-second wait with no visible progress reads as a hang.

## What each pane does

### `MeetingsPane.tsx`

The recording surface and the library, on one page.

- **Recorder at the top.** A large record button, elapsed time while active, a mic mute toggle, and a hidden-from-capture toggle. The hidden toggle needs one line of explanation: the window stays visible to you and disappears from Zoom, Meet, and every screen recording. Also a control to show or hide the live transcript window.
- **Agenda.** Today's calendar events from `listEvents(1)`, each with a button that starts a session pre-titled with the event. When `calendarAuthorized()` is false, show a request-access card instead of an empty list. An empty list reads as "no meetings today" and would be wrong.
- **Library.** Meetings grouped by folder, each row showing title, date, duration, and whether notes exist. Search across titles, plus a separate search across transcript text using `searchSnippets`, whose hits show the matching line with its timestamp. Folder create, rename, delete, and drag-free move via a folder picker per row. Rename, delete, and export per meeting.
- Delete confirms inline. Never `window.confirm`.

### `NotesPane.tsx`

One meeting, opened from the library. Not a sidebar destination of its own; the sidebar's "Notes" entry opens the most recent meeting, or an empty state.

- Header: title (editable in place), date, duration, back to the library.
- Tabs: **Notes**, **Transcript**, **Ask**.
- **Notes:** the written notes, editable, autosaved via `saveNotes` on a debounce. A "Write notes" button calling `writeNotes`, streaming into the view.
- **Transcript:** the full line list from `meetingSegments`, each with a timestamp and speaker where present. Scrollable, searchable within the meeting.
- **Ask:** a question box calling `askMeeting`, with streamed answers and a history of previous questions in this session. A "Draft follow-up" button calling `draftFollowup`.
- A library-wide ask lives on `MeetingsPane`, not here, calling `askLibrary` and linking each cited meeting.

### `StudyPane.tsx`

- A meeting picker at the top, defaulting to the most recent.
- `StudySettings` controls: count and difficulty, using `Segmented`. Seed them from `lastStudySettings`.
- Three sections: **Study plan** (streamed prose), **Flashcards** (a flip card deck, keyboard navigable with arrow keys and space to flip), **Quiz** (multiple choice, one question at a time, answer revealed after selection, a score at the end).
- Each section loads its cached version first via `cachedStudyPlan`, `cachedFlashcards`, `cachedQuiz`, and only generates on an explicit button press. Generation is expensive.
- Where content contains mathematics, render it. `mathml.js` in the Oatmeal source shows the conversion it uses; port that logic into a small helper module rather than pulling in a library.

### `HomeworkPane.tsx`

The simplest pane. Independent of meetings.

- A list of items with title, note, due date, and a done checkbox, sorted by due date with overdue items marked.
- An add form with a date input. Use a native `<input type="date">` rather than porting `datepicker.js`.
- A count of what is outstanding.

### `LiveTranscriptWindow.tsx`

A separate Tauri window, not a Hub pane. It renders in its own webview like `ui/src/overlay/FlowBar.tsx` does, so follow that file's structure rather than the Hub's.

- Compact, dense, dark by default. It sits over other apps during a meeting.
- Lines from the `liveLines` event stream, newest at the bottom, auto-scrolling unless the user has scrolled up.
- A pin toggle calling `setTranscriptPinned` and a close control calling `setTranscriptWindowVisible(false)`.
- No chrome beyond that. This window is read during a meeting, in someone's peripheral vision.

### Media import

A small section on `MeetingsPane`: a URL field calling `videoProbe`, showing the title and duration on success, a start and end range, and an Import button calling `videoImport`. The result appears in the library as an ordinary meeting.

## Order of work

Each step verified in the browser before the next:

1. `api.ts` wrappers for every contract above
2. `Sidebar.tsx` and `icons.tsx` additions
3. `HomeworkPane.tsx` — the smallest, gets the patterns settled
4. `MeetingsPane.tsx` — recorder, agenda, library
5. `NotesPane.tsx` — the three tabs
6. `LiveTranscriptWindow.tsx`
7. `StudyPane.tsx` — flashcards and quiz last, they carry the most interaction

## Done means

- `cd ui && pnpm build` passes with no TypeScript errors.
- Every pane renders and is fully navigable under `pnpm dev` with no Rust backend, using the fallback values.
- Nothing under `crates/` or `src-tauri/` is modified. Verify with `git status` before reporting finished.
- Nothing in `~/Adriel_2.0/oatmeal-repo/` is modified. It is read-only reference.
