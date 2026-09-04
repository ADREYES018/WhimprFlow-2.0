# Notetaker UI Implementation Plan

Build the frontend for the Oatmeal notetaker. The backend is already merged,
tested and registered; there is no UI to reach any of it.

**Scope:** `ui/src/hub/` only. Do not modify Rust. Every command this plan uses
already exists, is already registered in `generate_handler!`, and needs no
backend change. If you think you need a Rust change, stop and say so instead.

**Tech stack:** React 18 + TypeScript, Tauri v2. No new dependencies.

## Where things stand

The Oatmeal merge (`docs/superpowers/plans/2026-09-04-oatmeal-merge.md`, 13
tasks) ported the engine and stopped at the command layer. Its only frontend
work was an onboarding permission card. Concretely:

- 109 Tauri commands are defined and registered.
- 43 are called from the UI.
- **66 are never called from anything.** Almost all are the notetaker.

The sidebar has `home`, `dictionary`, `scratchpad`, `snippets`, `style`,
`transforms`, `settings`, plus help and insights. There is no meetings,
library, notes or study surface. This plan adds them.

## Global constraints

1. **Dictation, transforms, snippets and the scratchpad must keep working.**
   They are the app's shipping features. Never regress them for the notetaker.
2. **Match the existing conventions exactly.** Read `SnippetsPane.tsx` and
   `TransformsPane.tsx` first; they are the reference for pane structure, and
   `TransformsPane.tsx` also shows list + detail + run-with-result.
3. **Every command call goes through a wrapper in `api.ts`.** Panes never call
   `invoke` directly. The wrapper is the private `invoke<T>` at `api.ts:70`.
4. **Every mutation goes through `useAction()`** (`useAction.tsx`). It carries a
   thrown command error to the screen. A wrapper that swallows an error and
   returns a fallback is a bug: it renders a failed write as a success.
5. **Primitives come from `ui.tsx`**: `Card`, `Dot`, `Button`, `Segmented`,
   `PageTitle`. Colors from `theme`, type from `tokens/values`. No ad-hoc hex.
6. Run `ui/node_modules/.bin/tsc --noEmit` before every commit.

## Traps that will cost you hours

Read this section before writing code. Each item is verified against the Rust.

- **`app: tauri::AppHandle` is injected by Tauri, never passed from JS.**
  `start_session`, `continue_session`, `ask_meeting`, `ask_library` and
  `draft_followup` all take it as their first parameter. Pass only the
  remaining arguments. Passing `app` yourself fails at runtime.
- **`start_session` already starts both recorders.** It calls
  `begin_session_with_emitter`, which starts mic and system audio internally.
  Do **not** also call `start_mic_recording` / `start_sysaudio_recording` for a
  meeting: the second start returns `AlreadyRecording`. Those raw audio
  commands exist for standalone capture, not for sessions.
- **`stop_session` and `finish_meeting` need a whisper model path.** Signatures
  are `stop_session(modelPath, language)` and
  `finish_meeting(id, modelPath, language)`. Get the path from
  `default_model_path() -> String`. Passing `""` makes the backend resolve
  `base.en` itself, which is the sane default; prefer that over guessing a path.
- **`ask_meeting` with an empty `id` asks about the *live* session**, reading
  `live_lines()` instead of a stored transcript. That is deliberate: use `""`
  for "ask about what is being said right now".
- **Serde casing differs per type.** `StudySettings` is `camelCase`, so its
  JSON keys are `count`, `difficulty`, `topicFocus`. `Template` and
  `Difficulty` are `snake_case`. Everything else is as-declared. Get this wrong
  and the command rejects the payload with a deserialize error.
- **System audio needs Screen Recording permission; dictation does not.**
  `App.tsx:170` already shows a banner when a session is recording without it.
  A meeting can still record mic-only. Surface that state, do not block on it.
- **A recorder that fails to start is not fatal.** The backend retires that
  audio lane and the meeting continues on the other one. The live transcript
  will simply be missing that source. Do not treat a failed sysaudio start as a
  failed meeting.

## Types to add to `api.ts`

Transcribed from the Rust. Field names are exact.

```ts
export type Template = "general" | "standup" | "one_on_one" | "interview" | "lecture";
export type Difficulty = "easy" | "medium" | "hard";

export interface Meeting {
  id: string;
  title: string;
  started_at: string;
  duration_secs: number;
  transcribed: boolean;
  pending_segments: number[];
  has_notes: boolean;
  notes_stale: boolean;
  template: Template;
  dir: string;
  folder: string | null;
}

export interface TranscriptLine { at: string; text: string; speaker: string | null }
export interface Folder { name: string; count: number }
export interface LiveLine { at_ms: number; text: string }
export interface Segment { start_cs: number; end_cs: number; text: string }

export interface SessionPaths {
  dir: string; mic_wav: string; sys_wav: string;
  title: string; slug: string; segment: number;
}
export interface MeetingResult {
  transcript_path: string; dir: string; text: string; segments: Segment[];
}

export interface Flashcard { front: string; back: string }
export interface QuizQuestion { question: string; options: string[]; correct_index: number }
// camelCase on the wire — see Traps.
export interface StudySettings { count: number; difficulty: Difficulty; topicFocus: string }

export interface HomeworkItem {
  id: string; title: string; note: string; due_date: string; done: boolean;
}
export interface Source { id: string; title: string; started_at: string }
export interface LibraryAnswer { answer: string; sources: Source[] }

export interface CalendarEvent {
  id: string; summary: string; start: string; end: string | null;
  all_day: boolean; location: string | null; link: string | null; calendar: string | null;
}
export interface CalendarFeed { authorized: boolean; denied: boolean; events: CalendarEvent[] }

export interface VideoInfo { id: string; title: string; duration_secs: number }
```

## The command surface

Exact signatures, as they exist in `src-tauri/src/lib.rs`. `app` is omitted
because Tauri injects it.

**Session**
| Command | Args | Returns |
|---|---|---|
| `start_session` | `title, language` | `SessionPaths` |
| `stop_session` | `modelPath, language` | `MeetingResult` |
| `continue_session` | `id, language` | `SessionPaths` |
| `finish_meeting` | `id, modelPath, language` | `Meeting` |
| `is_session_active` | — | `boolean` |
| `session_elapsed_ms` | — | `number \| null` |

**Live** — `live_lines() -> LiveLine[]`, `answer_live_question(question) -> string`

**Library** — `list_meetings() -> Meeting[]`, `search_meetings(query) -> Meeting[]`,
`delete_meeting(id) -> string`, `rename_meeting(id, title)`,
`export_meeting(id) -> string`, `meeting_segments(id) -> TranscriptLine[]`,
`meeting_typed_notes(id) -> string | null`,
`move_meeting_to_folder(id, folder: string | null)`

**Folders** — `list_folders() -> Folder[]`, `create_folder(name)`,
`rename_folder(old, new)`, `delete_folder(name)`

**Notes** — `write_notes(id, template, force) -> string`,
`save_notes(title, body) -> string | null`,
`ask_meeting(id, question) -> string`,
`ask_library(question) -> LibraryAnswer`, `draft_followup(id) -> string`

**Study** — `generate_study_plan(id, settings, force) -> string`,
`generate_flashcards(id, settings, force) -> Flashcard[]`,
`generate_quiz(id, settings, force) -> QuizQuestion[]`,
plus `cached_study_plan(id)`, `cached_flashcards(id)`, `cached_quiz(id)`,
`last_study_settings(id)` which all return `null` when nothing is cached.

**Homework** — `list_homework() -> HomeworkItem[]`,
`add_homework(meetingId, title, dueDate) -> HomeworkItem`,
`set_homework_done(id, done)`, `delete_homework(id)`

**Calendar** — `list_events(days) -> CalendarFeed`, `calendar_authorized() -> boolean`,
`calendar_request_access() -> boolean`, `open_calendar_settings()`

**Media** — `video_probe(url) -> VideoInfo`,
`video_import(meetingId, url, start, end) -> string`,
`latex_from_speech(speech) -> string`, `transcribe_wav(path) -> string`

## Live transcript events

The backend pushes each line as it is decoded:

```ts
import { listen } from "@tauri-apps/api/event";
const un = await listen<LiveLine>("whimpr://live-line", (e) => append(e.payload));
```

Follow the pattern already in `App.tsx:141-149`, including returning the
unlisten function from the effect. Use `live_lines()` once on mount to backfill
what was said before the pane opened, then rely on the event for new lines.
Do not poll `live_lines()` on an interval.

## Tasks

Each task ends green and committed. Ship in this order: task 2 is the feature's
spine and the rest hang off it.

### Task 1: API layer
- [ ] Add every type above to `api.ts`.
- [ ] Add one wrapper per command, matching the existing wrapper style. Throw on
      failure; do not catch and substitute a fallback.
- [ ] Add the non-Tauri mock branch each wrapper needs, following the
      `mockTransforms` pattern, so the UI runs in a browser without Tauri.
- **Verify:** `tsc --noEmit` clean. No pane changes yet.

### Task 2: Meetings pane and recording
- [ ] `MeetingsPane.tsx`: start/stop recording, elapsed timer from
      `session_elapsed_ms`, live transcript fed by `whimpr://live-line`.
- [ ] Add `meetings` to `Sidebar.tsx` and route it in `App.tsx`.
- [ ] On mount, reconcile with `is_session_active()`: a session can already be
      running from a wake-word trigger via `hotkey.rs`, and the pane must show
      that rather than offering to start a second one.
- [ ] Show mic-only state when Screen Recording is denied.
- **Verify:** record a real 30-second meeting with speech. Lines appear in the
      live panel while talking. Stop produces a meeting. This is the acceptance
      test for the whole plan, because the live tap had no consumer until now.

### Task 3: Library
- [ ] `LibraryPane.tsx`: meeting list, search, rename, delete, export.
- [ ] Detail view with the transcript from `meeting_segments`.
- [ ] Folder sidebar with create/rename/delete and move-to-folder.
- [ ] Render `transcribed: false` and `pending_segments` honestly: a meeting can
      exist with its transcript still being built.
- **Verify:** the meeting from task 2 is listed, opens, shows its transcript,
      survives a rename, moves between folders, exports.

### Task 4: Notes
- [ ] Notes view per meeting: generate with a `Template` picker, edit, save.
- [ ] Ask-this-meeting box wired to `ask_meeting(id, question)`.
- [ ] Ask-the-library box wired to `ask_library`, rendering `sources`.
- [ ] Respect `notes_stale`: offer regeneration with `force: true`.
- **Verify:** generated notes are a real answer about what was said, not an echo
      of the prompt. An echo means the LLM provider is not attached; that is a
      backend problem, not yours, so report it rather than working around it.

### Task 5: Study and homework
- [ ] Study plan, flashcards, quiz per meeting, with a `StudySettings` form.
- [ ] Load the cached versions first; only generate on request.
- [ ] Homework list with add, done toggle, delete.
- **Verify:** generating twice without `force` serves the cache and does not
      re-run the model.

### Task 6: Calendar and media (optional, ship last)
- [ ] Upcoming events from `list_events`, with the authorize prompt when
      `authorized` is false and a settings link when `denied` is true.
- [ ] Video import via `video_probe` then `video_import`.
- **Verify:** denying calendar access shows the prompt and never blocks the app.

## Out of scope

- Any Rust change.
- Speaker diarization. `TranscriptLine.speaker` exists and is usually `null`.
- The `.part` download-resume corruption bug in
  `crates/whimpr-media/src/model.rs`. Real, tracked separately, not UI work.
- Windows. The platform layer there is unverified and `local_worker` is not
  exported for it.
