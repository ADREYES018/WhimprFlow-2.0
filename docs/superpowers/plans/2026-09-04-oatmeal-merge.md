# Oatmeal Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Oatmeal, in full, into WhimprFlow so there is one application that dictates, runs commands, records meetings, and answers questions across the library.

**Architecture:** Oatmeal's Rust moves into WhimprFlow as new crates, largely unchanged. The one structural change on the way in is that every llama call routes through WhimprFlow's existing out-of-process worker instead of loading llama in-process. That removes the ggml symbol collision between whisper and llama, which is the reason Oatmeal pins `llama-cpp-2 = "=0.1.141"` today.

**Tech Stack:** Rust 2021, Tauri v2 with `macos-private-api`, `whisper-rs` 0.16, `llama-cpp-2` (worker process), `cpal` 0.15, `screencapturekit` 8.0.1, `objc2`/`objc2-event-kit`, `symphonia`, React 18 + TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-04-control-features-design.md`, part B.

**Source:** `~/Adriel_2.0/oatmeal-repo/app/src-tauri/src/`. Read-only. Nothing in this plan modifies the Oatmeal repository.

## Global Constraints

- **Prerequisite:** the control-features plan (`docs/superpowers/plans/2026-09-04-control-features.md`) is complete and its tests pass. This plan starts after it.
- **One `whisper-rs` version in the workspace.** Two versions cannot coexist: each statically links its own ggml and exports roughly 795 identical symbols, so the linker resolves each name once and splits the implementation across both copies. The target is 0.16.
- **No in-process llama.** Every llama call goes through `crates/whimpr-llm-worker`. Any ported code that calls `llama_cpp_2` directly is rewritten to call the worker. There is no `llama-cpp-2` dependency in the Tauri binary's dependency tree when this plan is done.
- **Licence.** Every ported file keeps its original header. `LICENSE` gains an attribution section naming Oatmeal, Vedant Soni, and MIT. `README.md` credits it. Task 1 does this before any code moves.
- **GPU priority is fixed:** live transcription first, dictation cleanup second, notes and study last. A dropped live transcript is unrecoverable.
- Dictation must keep working at every step. `cargo test -p whimpr-core && cargo build -p whimpr` passes before every commit, and a manual dictation round-trip is verified at the end of every task that touches `whimpr-asr`, `whimpr-audio`, or `hotkey.rs`.
- Screen Recording permission denied must degrade to mic-only recording, never to a crash and never to broken dictation.
- Commit after every task.

---

### Task 1: Attribution

**Files:**
- Modify: `LICENSE`, `README.md`

- [ ] **Step 1: Add the attribution section to `LICENSE`**

Append:

```
---

## Third-party code

This project incorporates code from Oatmeal (https://github.com/VedSoni-dev/oatmeal),
copyright (c) Vedant Soni, licensed under the MIT License. The meeting capture,
live transcription, library, notes, study, media, and calendar subsystems derive
from that work. Ported files retain their original headers.
```

- [ ] **Step 2: Credit it in `README.md`**

Add a "Credits" section near the bottom naming Oatmeal, its author, its licence, and a one-line description of what came from it.

- [ ] **Step 3: Commit**

```bash
git add LICENSE README.md
git commit -m "docs: attribute Oatmeal (MIT, Vedant Soni)"
```

---

### Task 2: Route all llama through the worker

**Files:**
- Modify: `crates/whimpr-llm-worker/src/` (add a general completion entry point)
- Modify: `src-tauri/src/local_llm.rs`
- Test: `crates/whimpr-llm-worker/tests/`

**Interfaces:**
- Consumes: the existing worker protocol.
- Produces: `local_llm::complete(prompt: &str) -> anyhow::Result<String>` and `local_llm::complete_streaming(prompt: &str, sink: impl FnMut(&str)) -> anyhow::Result<String>`.

Oatmeal's `chat.rs` streams tokens to the UI. The worker needs a streaming path before `chat.rs` can be ported, or every note generation looks frozen for thirty seconds.

- [ ] **Step 1: Read the existing worker protocol**

Run: `sed -n '1,80p' src-tauri/src/local_llm.rs && grep -n "fn \|enum \|struct " crates/whimpr-llm-worker/src/*.rs | head -40`

- [ ] **Step 2: Write the failing test**

In `crates/whimpr-llm-worker/tests/completion.rs`, a test that sends a fixed prompt and asserts a non-empty response plus at least two streamed chunks. Mark it `#[ignore]` if it needs a downloaded model, and document the command that runs it.

- [ ] **Step 3: Run it to confirm it fails**

Run: `cargo test -p whimpr-llm-worker -- --ignored`
Expected: FAIL, function not found.

- [ ] **Step 4: Implement**

Add a request variant carrying a raw prompt and a flag for streaming, and a response variant carrying either a full string or a token chunk. Reuse the existing framing rather than inventing a second protocol.

- [ ] **Step 5: Run it to confirm it passes**

Run: `cargo test -p whimpr-llm-worker -- --ignored`
Expected: PASS.

- [ ] **Step 6: Verify dictation is unaffected**

Build and run the app, dictate a sentence, confirm cleanup still works.

- [ ] **Step 7: Commit**

```bash
git add crates/whimpr-llm-worker src-tauri/src/local_llm.rs
git commit -m "feat(worker): general completion and streaming entry points"
```

---

### Task 3: Bump whisper-rs to 0.16

**Files:**
- Modify: `crates/whimpr-asr/Cargo.toml:19`, `:23`
- Modify: `crates/whimpr-asr/src/` wherever the API changed

**This is the gate for the whole plan.** Everything from Task 5 on depends on it.

- [ ] **Step 1: Record the current behavior**

Dictate five sentences of varying length. Save the transcripts to `docs/superpowers/plans/whisper-baseline.md`. This is the comparison for step 5, and without it "unchanged" is unverifiable.

- [ ] **Step 2: Bump and build**

Change both `whisper-rs` lines in `crates/whimpr-asr/Cargo.toml` from `0.12` to `0.16`.

Run: `cargo build -p whimpr-asr 2>&1 | tail -40`
Expected: compile errors. `whisper-rs` changed its context and state API between these versions; read each error and consult the crate's changelog rather than guessing.

- [ ] **Step 3: Fix the call sites**

Work through the errors one at a time. Do not change behavior, only the API surface.

- [ ] **Step 4: Run the ASR tests**

Run: `cargo test -p whimpr-asr`
Expected: PASS.

- [ ] **Step 5: Verify dictation is unchanged**

Build and run the app. Dictate the same five sentences from step 1 and compare against the baseline. Differences in punctuation are acceptable. A dropped word, a truncated sentence, or a latency regression is not.

- [ ] **Step 6: Commit**

```bash
git add crates/whimpr-asr docs/superpowers/plans/whisper-baseline.md
git commit -m "chore(asr): bump whisper-rs to 0.16 for the Oatmeal merge"
```

**Gate:** if step 5 fails and cannot be fixed within a day, revert this commit and stop. The control-features work stands on its own and everything from Task 5 on is blocked.

---

### Task 4: Model management, and remove the 148 MB blob from git

**Files:**
- Create: `crates/whimpr-media/` (new crate: `Cargo.toml`, `src/lib.rs`, `src/model.rs`)
- Modify: `Cargo.toml` (workspace members), `.gitignore`
- Port from: `oatmeal-repo/app/src-tauri/src/model.rs`
- Delete: `ggml-base.en.bin`

**Interfaces:**
- Produces: `whimpr_media::model::{ensure_whisper_model, ensure_chat_model, model_status, ModelSpec}`.

- [ ] **Step 1: Create the crate and port `model.rs`**

Copy `model.rs` in with its header intact. It shells out to `curl` with `-C -` for resumable downloads and renames a `.part` file on success, so a half-download never looks valid. Keep that.

- [ ] **Step 2: Extend it to cover the dictation model**

Add a `ModelSpec` for `ggml-base.en`, the model WhimprFlow currently ships in git.

- [ ] **Step 3: Write the failing test**

A test asserting `ensure_whisper_model` returns the existing path without downloading when the file is already present, and that a `.part` file is never returned as a valid model path.

- [ ] **Step 4: Run it**

Run: `cargo test -p whimpr-media`
Expected: PASS.

- [ ] **Step 5: Wire it into startup**

Replace `model_path()` in `src-tauri/src/hotkey.rs:140` with a call into `whimpr_media::model`. On first run, the Hub shows a download state rather than silently failing ASR.

- [ ] **Step 6: Remove the blob**

```bash
git rm --cached ggml-base.en.bin
echo "*.bin" >> .gitignore
```

Leave the file on disk so the current install keeps working.

- [ ] **Step 7: Verify**

Move the local `ggml-base.en.bin` aside, launch the app, and confirm it downloads the model and then dictates. Move it back.

- [ ] **Step 8: Commit**

```bash
git add crates/whimpr-media Cargo.toml .gitignore src-tauri/src/hotkey.rs
git commit -m "feat(models): resumable downloads, drop the committed model blob"
```

---

### Task 5: Shared whisper model registry

**Files:**
- Modify: `crates/whimpr-asr/src/lib.rs`

**Interfaces:**
- Produces: `whimpr_asr::registry::{acquire(spec) -> ModelHandle, ModelHandle}` where dropping the last handle for a spec schedules an unload after an idle timeout.

Dictation wants a small fast model; meetings want a large accurate one. Without a registry both stay resident and the app idles at several gigabytes.

- [ ] **Step 1: Write the failing test**

Two `acquire` calls for the same spec return handles backed by one loaded context; dropping one keeps the model alive; dropping both schedules the unload.

- [ ] **Step 2: Run it**

Run: `cargo test -p whimpr-asr registry`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

A `Mutex<HashMap<ModelSpec, Weak<WhisperContext>>>` plus an idle timer. Keep it small.

- [ ] **Step 4: Run it**

Run: `cargo test -p whimpr-asr registry`
Expected: PASS.

- [ ] **Step 5: Move dictation onto the registry**

Replace the `ASR` static in `hotkey.rs` with a registry handle. Verify dictation still works.

- [ ] **Step 6: Commit**

```bash
git add crates/whimpr-asr src-tauri/src/hotkey.rs
git commit -m "feat(asr): reference-counted model registry with idle unload"
```

---

### Task 6: System audio capture

**Files:**
- Modify: `crates/whimpr-audio/Cargo.toml`, `crates/whimpr-audio/src/lib.rs`
- Create: `crates/whimpr-audio/src/sysaudio.rs`
- Port from: `oatmeal-repo/app/src-tauri/src/sysaudio.rs` (268 lines), `mic.rs` (620 lines)

**Interfaces:**
- Produces: `whimpr_audio::sysaudio::{start_sysaudio_recording, stop_sysaudio_recording, is_sysaudio_recording}` and the mic equivalents.

- [ ] **Step 1: Add the dependency**

`screencapturekit = "8.0.1"` under a `cfg(target_os = "macos")` target section.

- [ ] **Step 2: Port both files**

Headers intact. `mic.rs` overlaps the existing `whimpr-audio` capture path: keep both, since dictation's is push-to-talk and short while the meeting one is long-running and writes WAV. Share only `resample_to_16k`.

- [ ] **Step 3: Guard the permission**

Every entry point returns a typed error when Screen Recording is denied. It must never panic and never block the mic path.

- [ ] **Step 4: Write the failing test**

`start_sysaudio_recording` with permission denied returns `Err`, and `is_sysaudio_recording` stays false.

- [ ] **Step 5: Run it**

Run: `cargo test -p whimpr-audio`
Expected: PASS.

- [ ] **Step 6: Verify by hand**

With Screen Recording granted, record ten seconds of system audio and confirm the WAV is non-silent. With it denied, confirm the error surfaces and dictation still works.

- [ ] **Step 7: Commit**

```bash
git add crates/whimpr-audio
git commit -m "feat(audio): port system audio capture from Oatmeal"
```

---

### Task 7: Meetings crate

**Files:**
- Create: `crates/whimpr-meetings/` (`session.rs`, `live.rs`, `store.rs`, `library.rs`, `sleep.rs`)
- Port from: the same-named files in `oatmeal-repo/app/src-tauri/src/`
- Modify: workspace `Cargo.toml`

**Interfaces:**
- Produces: `whimpr_meetings::{Meeting, TranscriptLine, Folder, SearchHit, LiveLine}` and the session lifecycle: `begin_session`, `continue_session`, `stop_session`, `finish_meeting`, `session_elapsed_ms`, `is_session_active`, `live_lines`.

- [ ] **Step 1: Port `store.rs` and `library.rs` first**

They are pure disk work with no audio and no model. The folder tree is the index; there is no database. Get their tests green before touching anything live.

Run: `cargo test -p whimpr-meetings`

- [ ] **Step 2: Port `session.rs`**

Its transcription calls go through the Task 5 registry rather than loading their own context.

- [ ] **Step 3: Port `live.rs`**

It taps samples from both lanes, downmixes to mono, resamples to 16 kHz, sums the lanes, and emits finished windows as Tauri events. Reuse `whimpr_audio::resample_to_16k` instead of its own copy.

- [ ] **Step 4: Port `sleep.rs`**

macOS suspends audio devices on lid-close and nothing reaches either lane until wake, so the meeting silently loses that stretch. Wire it to dictation as well: the same hole exists there today and nobody noticed.

- [ ] **Step 5: Write the failing tests**

Port Oatmeal's existing tests for these modules. Add one asserting a sleep gap is recorded in the transcript rather than read as silence.

- [ ] **Step 6: Run them**

Run: `cargo test -p whimpr-meetings`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/whimpr-meetings Cargo.toml
git commit -m "feat(meetings): port session, live, store, library and sleep"
```

---

### Task 8: Screen Recording permission and the hidden windows

**Files:**
- Modify: `src-tauri/src/lib.rs` (`StatusReport`, `get_status`, a `request_screen_recording` command, window builders)
- Create: `src-tauri/src/window.rs`
- Port from: `oatmeal-repo/app/src-tauri/src/window.rs` (126 lines)
- Modify: `ui/src/hub/Onboarding.tsx`, `ui/src/hub/api.ts` (`Status`)

**Interfaces:**
- Produces: `Status.screen_recording: bool`, commands `request_screen_recording`, `set_hidden_from_capture`, `is_hidden_from_capture`, `set_transcript_window_visible`, `set_transcript_pinned`, `is_transcript_window_visible`.

- [ ] **Step 1: Port `window.rs`**

`NSWindowSharingNone` excludes a window from every screen and window capture while leaving it visible on the user's own display. Applied per window: the Hub stays normal, the recorder and transcript windows are hidden from capture.

- [ ] **Step 2: Add the permission to the status report**

Extend `StatusReport` and `get_status` at `src-tauri/src/lib.rs:170`, mirroring how microphone and accessibility are reported.

- [ ] **Step 3: Add the onboarding gate**

A fourth card in `Onboarding.tsx`. Copy must say plainly that it is needed for recording system audio in meetings, and that dictation works without it. It is not a blocking gate: the wizard's existing condition stays `accessibility && microphone`.

- [ ] **Step 4: Add the banner case**

The `ErrorBanner` in `App.tsx` already handles a lapsed Accessibility grant. Add the equivalent for Screen Recording, shown only while a recording session is active.

- [ ] **Step 5: Verify**

Run the app with Screen Recording denied: onboarding shows the card, dictation works, mic-only recording works, system audio reports a clear error. Grant it, confirm the recorder window does not appear in a QuickTime screen recording.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src ui/src/hub
git commit -m "feat(permissions): screen recording gate and capture-hidden windows"
```

---

### Task 9: Notes crate

**Files:**
- Create: `crates/whimpr-notes/` (`chat.rs`, `recall.rs`, `study.rs`, `homework.rs`)
- Port from: the same-named files in `oatmeal-repo/app/src-tauri/src/`

**Interfaces:**
- Produces: `whimpr_notes::{write_notes, ask_meeting, ask_library, draft_followup, generate_study_plan, generate_flashcards, generate_quiz, Flashcard, QuizQuestion, StudySettings, HomeworkItem, LibraryAnswer}`.

**This is where the in-process llama goes away.**

- [ ] **Step 1: Port `chat.rs`, replacing its llama calls**

Every `llama_cpp_2` call becomes `local_llm::complete` or `complete_streaming` from Task 2. Its model loading, keep-resident, and unload logic is deleted; the worker owns that now.

- [ ] **Step 2: Confirm the dependency is gone**

Run: `cargo tree -p whimpr -i llama-cpp-2`
Expected: no results. The Tauri binary must not link llama. If it does, a `chat.rs` call site was missed.

- [ ] **Step 3: Delete the pin**

There is no `llama-cpp-2` line in any crate but `whimpr-llm-worker`, and that one carries no `=` pin. Record in the commit message that the ABI hazard is resolved by process isolation.

- [ ] **Step 4: Port `recall.rs`, `study.rs`, `homework.rs`**

`recall.rs` picks the meetings most likely to hold an answer and fills the context window with them. `homework.rs` is a plain JSON list, no models involved.

- [ ] **Step 5: Port the GPU gate**

`autoanswer.rs` becomes `whimpr_core::gpu_gate`, extended to cover dictation cleanup. Priority: live transcription, then dictation, then notes and study.

- [ ] **Step 6: Write the failing test**

Under simulated contention (a live session, a dictation, and a note generation queued together), the live transcription request is served first and never starved.

- [ ] **Step 7: Run the tests**

Run: `cargo test -p whimpr-notes && cargo test -p whimpr-core gpu_gate`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/whimpr-notes crates/whimpr-core Cargo.toml
git commit -m "feat(notes): port note, recall and study generation through the worker

All llama calls now cross a process boundary, so whisper and llama no longer
share an address space. The =0.1.141 pin Oatmeal needed for ggml ABI
compatibility is gone."
```

---

### Task 10: Media crate

**Files:**
- Modify: `crates/whimpr-media/` (add `video.rs`, `update.rs`)
- Port from: `oatmeal-repo/app/src-tauri/src/video.rs` (729), `update.rs` (768)
- Port the LaTeX-from-speech path from `oatmeal-repo/app/src-tauri/src/lib.rs:907-963`

**Interfaces:**
- Produces: `whimpr_media::video::{probe, import, VideoInfo, Range}`, `whimpr_media::update::{check, UpdateStatus, ReleaseNotes, install}`, `whimpr_media::latex::from_speech`.

- [ ] **Step 1: Port `video.rs`**

It decodes YouTube's m4a in-process with `symphonia`, AAC-in-MP4 only, so there is no ffmpeg dependency. Keep the feature list exactly as it is.

- [ ] **Step 2: Port `update.rs`, repointed**

The GitHub Releases API is the manifest and the attached DMG is the download. Repoint it at this repository. There is no release pipeline yet, so it ships inert; that is expected and should be noted in the module header.

- [ ] **Step 3: Port the LaTeX path**

Spoken mathematics to LaTeX, through the worker, behind the GPU gate at the lowest priority.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p whimpr-media`
Expected: PASS.

- [ ] **Step 5: Verify by hand**

Import a short YouTube video and confirm a transcript lands beside the meetings.

- [ ] **Step 6: Commit**

```bash
git add crates/whimpr-media
git commit -m "feat(media): port video import, update checks and LaTeX from speech"
```

---

### Task 11: Calendar

**Files:**
- Create: `crates/whimpr-meetings/src/apple_calendar.rs`
- Port from: `oatmeal-repo/app/src-tauri/src/apple_calendar.rs` (216 lines)

**Interfaces:**
- Produces: `whimpr_meetings::calendar::{authorized, request_access, list_events, CalendarFeed}`.

- [ ] **Step 1: Port it**

EventKit via `objc2-event-kit`. Add the dependency to `whimpr-meetings` under the macOS target.

- [ ] **Step 2: Add the entitlement**

Copy the calendar usage description from Oatmeal's `Info.plist` into WhimprFlow's. Without it the permission prompt never appears and the call fails silently.

- [ ] **Step 3: Verify**

Grant calendar access and confirm today's events list. Deny it and confirm a clear error rather than an empty list, since an empty list reads as "no meetings today" and is wrong.

- [ ] **Step 4: Commit**

```bash
git add crates/whimpr-meetings src-tauri/Info.plist
git commit -m "feat(calendar): port EventKit agenda from Oatmeal"
```

---

### Task 12: Register the full command surface

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Reference: `oatmeal-repo/app/src-tauri/src/lib.rs` (77 commands)

- [ ] **Step 1: Enumerate what is missing**

Run: `grep -A 1 "tauri::command" ~/Adriel_2.0/oatmeal-repo/app/src-tauri/src/lib.rs | grep "^fn " | sed 's/fn \([a-z_]*\).*/\1/' | sort > /tmp/oatmeal-cmds.txt`
Then compare against WhimprFlow's `generate_handler!` list.

- [ ] **Step 2: Add each command**

Each is a thin delegation to a crate function, exactly like the existing dictionary commands. No logic in `lib.rs`.

- [ ] **Step 3: Resolve the name collisions**

Both apps have `get_settings` and `save_settings`. WhimprFlow's win; Oatmeal's settings merge into `whimpr_core::Settings`, keeping the unknown-key preservation from Oatmeal's `settings.rs` so a hand-edited config survives a round-trip.

- [ ] **Step 4: Verify**

Run: `cargo build -p whimpr 2>&1 | grep -c warning`
An unregistered command shows up as an unused-function warning. Every one must be intentional.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(commands): register the full merged command surface"
```

---

### Task 13: Delete the dead paths

**Files:**
- Modify: `crates/whimpr-core/src/agentic_os.rs` (remove `handle_start_recording`)
- Modify: `crates/whimpr-core/src/router.rs` (repoint the `start_recording` intent)

- [ ] **Step 1: Repoint the intent**

`Route::Command { intent: "start_recording" }` now begins a real in-app session instead of shelling out to `open http://localhost:4123`.

- [ ] **Step 2: Delete `handle_start_recording`**

Along with the `curl` health check and the hardcoded `oatmeal-repo/capture/server.mjs` paths.

- [ ] **Step 3: Verify**

Say "hey shrimp start recording" and confirm a session begins inside WhimprFlow with no browser window and no node process.

- [ ] **Step 4: Commit**

```bash
git add crates/whimpr-core
git commit -m "refactor: drop the localhost:4123 recording bridge"
```

---

## UI track

The React rewrite of Oatmeal's 6,370 lines of vanilla JS runs in parallel from Task 7 and is specified separately in `docs/superpowers/specs/2026-09-04-gemini-ui-handoff.md`. It has no Rust dependencies: every pane builds against `api.ts` wrappers that return safe defaults until the commands land.

## Self-review notes

**Spec coverage.** Attribution (1), worker routing (2), whisper bump (3), models and the blob (4), registry (5), system audio (6), meetings (7), permissions and windows (8), notes, recall, study, homework and the GPU gate (9), video, update and LaTeX (10), calendar (11), command surface (12), dead paths (13). Every Oatmeal module in the spec's table has a task.

**Ordering.** Task 3 is the gate. Tasks 1 and 2 precede it because neither depends on the whisper version and Task 2 is what makes Task 9 possible. Tasks 4 and 5 precede 6 and 7 because both need the registry.

**Interfaces.** `local_llm::complete` is defined in Task 2 and consumed in 9 and 10 under that name. The `ModelSpec` from Task 4 is consumed by the registry in Task 5. `resample_to_16k` is the existing `whimpr-audio` function, reused rather than duplicated in Tasks 6 and 7.

**Deliberately vaguer than the control-features plan.** Tasks 6, 7, 9, and 10 port existing, tested code rather than writing new logic, so the step detail is verification and adaptation rather than inline implementations. The source files are named with line counts so the worker knows the size of what they are moving.
