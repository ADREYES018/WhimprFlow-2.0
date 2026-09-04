# WhimprFlow — Control Features and Oatmeal Merge

**Date:** 2026-09-04
**Status:** Approved, not implemented
**Scope:** Two bodies of work in one app. (A) Ship the four placeholder Hub tabs and a real command router. (B) Merge Oatmeal, in full, into WhimprFlow so there is one application.

---

## 1. Goal

One local-first application that:

- dictates and cleans text anywhere you can type (today)
- runs spoken commands, expands snippets, applies your voice, and holds a scratchpad (part A)
- records meetings and lectures, transcribes them live, writes notes, and answers questions across the library (part B)

Nothing leaves the machine except model downloads and the cleanup call when a cloud provider is deliberately selected.

## 2. Starting state

### WhimprFlow

~3,600 lines of Rust, ~2,000 of React. Tauri v2.

- **Works:** push-to-talk, on-device Whisper, local llama cleanup in a **separate worker process**, cloud cleanup (OpenAI/Anthropic), clipboard paste, personal dictionary with macOS auto-learn, usage stats, floating pill overlay.
- **Placeholder:** `snippets`, `style`, `transforms`, `scratchpad` route in `ui/src/hub/Sidebar.tsx` and render `ComingSoon` from the `SOON` map in `ui/src/hub/App.tsx:104`.
- **Half-built:** `src-tauri/src/hotkey.rs:589` hardcodes the wake word `"hey shrimp"` then keyword-matches `terminal`, `oatmeal`, `safari`, `notes`, and bare `open X`. The JSON intent contract it feeds is already parsed at `hotkey.rs:634`.
- **Dead plumbing:** `CleanupContext.window_context` is declared at `cleanup/mod.rs:49` and consumed by the prompt builder at `cleanup/mod.rs:151`, but nothing ever populates it outside a test.
- **Wart:** `ggml-base.en.bin`, 148 MB, is committed to the repository.

### Oatmeal

MIT, by Vedant Soni. 12,774 lines of Rust across 21 modules, 6,370 lines of vanilla JS and HTML. Also Tauri v2, also `macos-private-api`, also `cpal` 0.15. 77 Tauri commands.

Everything in it is in scope. Nothing is dropped.

| Area | Modules | What it does |
|---|---|---|
| Capture | `mic.rs`, `sysaudio.rs`, `session.rs`, `sleep.rs` | Mic plus system audio via ScreenCaptureKit, session lifecycle writing WAV + markdown, sleep-gap detection |
| Live | `live.rs`, `transcribe.rs`, `autoanswer.rs` | Streaming transcript from a sample tap, GPU rate gate |
| Window | `window.rs` | `NSWindowSharingNone`, invisible to screen share; pinnable transcript window |
| Library | `library.rs`, `store.rs` | Folder tree as the index. List, search, snippet search, folders, rename, delete, export |
| Notes | `chat.rs`, `recall.rs` | Note and recap generation, ask-a-meeting, ask-the-library, draft follow-up |
| Study | `study.rs`, `homework.rs` | Study plan, flashcards, quiz, homework list with due dates |
| Media | `video.rs`, `model.rs`, `update.rs` | YouTube audio import, resumable model downloads, GitHub Releases update check |
| Math | LaTeX-from-speech path in `lib.rs` | Spoken mathematics to LaTeX for lecture mode |
| Calendar | `apple_calendar.rs` | EventKit agenda, meeting titles |

## 3. Dependency conflicts, and the resolution

| | WhimprFlow | Oatmeal | Resolution |
|---|---|---|---|
| Tauri | v2, `macos-private-api` | v2, `macos-private-api` | No conflict |
| `cpal` | 0.15 | 0.15 | No conflict |
| `whisper-rs` | 0.12 | 0.16 | **Unify on 0.16.** Two versions cannot coexist |
| `llama-cpp-2` | 0.1, separate worker process | `=0.1.141`, in-process | **Route all llama through the worker.** Pin deleted |
| ScreenCaptureKit | absent | 8.0.1 | New dependency, macOS only |

### Why the whisper versions cannot both ship

`whisper-rs` and `llama-cpp-2` each statically link their own copy of ggml and export roughly 795 identical symbols. The linker resolves each name once, so the implementation gets split across the two copies. Oatmeal's `Cargo.toml` documents this in detail: from `llama-cpp-2` 0.1.142 onward, llama's ggml inserts `set_tensor_2d`/`get_tensor_2d` into the middle of `ggml_backend_buffer_i` and appends `uid` to `ggml_cgraph`, so llama allocates graphs with whisper's layout and reads them back with its own, on every decode. Oatmeal's answer is the `=0.1.141` pin.

Two different `whisper-rs` versions in one binary is the same failure with the same cause and no pin that fixes it.

### Why the merge makes this better, not worse

WhimprFlow already runs llama in a separate process (`crates/whimpr-llm-worker`). Once Oatmeal's `chat.rs` goes through that worker instead of loading llama in-process:

- whisper and llama no longer share an address space
- the ~795-symbol collision stops being a class of bug this application can have
- the `=0.1.141` pin is deleted, and both dependencies move independently again

This is a fix Oatmeal cannot make alone without adopting a worker process it does not have. It is the load-bearing reason the merge is worth doing rather than shipping two apps.

## 4. Architecture after the merge

```
crates/
  whimpr-core/       state machine, cleanup, dictionary, stats
                     + snippets, style, transforms, scratchpad, router   (part A)
  whimpr-asr/        Whisper                          → bumped to whisper-rs 0.16
  whimpr-audio/      mic capture + resampling         + sysaudio (ScreenCaptureKit)
  whimpr-cleanup/    OpenAI / Anthropic providers
  whimpr-llm-worker/ llama worker process — now serves cleanup, notes, study, recall
  whimpr-meetings/   session, live, store, library, sleep
  whimpr-notes/      chat, recall, study, homework
  whimpr-media/      video (YouTube), model download, update check
src-tauri/           one shell: hotkey, paste, autolearn, recording, windows
ui/src/hub/          React — 5 existing panes, 4 new, every Oatmeal surface rewritten
```

### Shared-resource rules

There is one Metal GPU and now three consumers: live transcription, dictation cleanup, and note/study/recall generation.

`autoanswer.rs` already implements a single shared rate gate, and its header explains why one gate beats two contending against the same device. Extend that gate to cover dictation cleanup as well, with a fixed priority order:

1. **Live transcription** — first, always. A dropped live transcript is unrecoverable; the meeting does not happen twice.
2. **Dictation cleanup** — second. The user is waiting with a cursor blinking.
3. **Notes, study, recall** — last. Always retryable.

Whisper models are held in one reference-counted registry, loaded on demand and unloaded after idle. Dictation wants a small fast model; meetings want a large accurate one. Without a registry both stay resident and the app idles at several gigabytes.

## 5. Part A — control features

### 5.1 New core modules

Each copies the existing `dictionary` / `stats` pattern exactly: one struct, one JSON file in the support dir (`hotkey.rs:156`), one `OnceLock<Mutex<_>>` in `hotkey.rs`, one set of Tauri commands.

| Module | File | Holds |
|---|---|---|
| `snippets.rs` | `snippets.json` | trigger phrase, expansion, enabled |
| `style.rs` | `style.json` | samples, base profile, per-context overrides, auto-learn state |
| `transforms.rs` | `transforms.json` | id, name, triggers, prompt template, default source, builtin |
| `scratchpad.rs` | `scratchpad.json` | doc text, updated_at, capture_mode |
| `router.rs` | none | transcript to route classification |

New `Settings` fields, every one `#[serde(default)]` so existing `settings.json` files keep loading: `wake_word` (default `"hey shrimp"`), `wake_word_enabled`, `command_provider` (`auto`/`cloud`/`local`/`rules`), `style_enabled`, `snippets_enabled`.

### 5.2 Pipeline

Replaces the hardcoded block at `hotkey.rs:589`.

```
transcript
  └─ router::route(raw, &settings, &transforms, &snippets) -> Route
       ├─ Route::Command   { intent, target }   -> agentic_os::execute_system_command
       ├─ Route::Transform { id, body, source } -> run -> paste or scratchpad
       └─ Route::Dictate   -> clean_transcript (style injected)
                            -> snippets::expand
                            -> paste, or append to scratchpad when capture_mode
```

Router layers, each falling through to the next:

1. **Wake word.** Absent means `Route::Dictate` immediately. No wake word, no command, ever.
2. **Rule table.** Deterministic, offline, instant. The five `agentic_os` intents plus every transform and snippet trigger phrase.
3. **LLM intent.** Only when no rule matched. Returns the JSON contract already parsed at `hotkey.rs:634`. `command_provider` selects: `auto` uses cloud when a key is in the keychain and the local worker otherwise; `cloud` and `local` force one; `rules` skips this layer.
4. **Fallback.** Nothing matched: `Route::Dictate`. Audio is never silently dropped.

```rust
pub enum Route {
    Command { intent: String, target: String },
    Transform { id: String, body: String, source: TransformSource },
    Dictate,
}

pub enum TransformSource { Utterance, Selection, Scratchpad }
```

### 5.3 Scratchpad

Store: `{ text: String, updated_at: u64, capture_mode: bool }`.

With `capture_mode` on, `Route::Dictate` appends cleaned text to the doc instead of pasting at the cursor, and the overlay pill shows a distinct state so it is never ambiguous where words are going. Transforms run over the doc with one level of undo.

Commands: `get_scratchpad`, `set_scratchpad_text`, `set_scratchpad_capture`.

### 5.4 Snippets

Entry: `{ trigger, expansion, enabled }`.

Expansion is a post-cleanup literal pass in `snippets::expand`: case-insensitive, longest trigger first, whole-phrase boundaries only so a trigger cannot fire mid-word. Runs after `apply_vocab`, so a dictionary correction can produce a trigger. The router's rule table also matches a bare trigger after the wake word.

Commands: `get_snippets`, `add_snippet`, `update_snippet`, `remove_snippet`.

### 5.5 Style

Seeded, not derived. `references/voice-tone-reference.md` (branch `claude/voice-tone-reference-xukgz5`) is already a finished profile: filler kill-list, hard rules, tone dials, before/after pairs, and a one-paragraph summary. Phase 4 ships with it loaded.

Two things fall out of that document:

- **Section 8 is dictionary data, not style.** Fifteen term-to-mishear pairs (Claude Code not Cloud Code, Anthropic not Anthropik, kanban not "can ban"). Those import straight into `dictionary.json`. Accuracy for free, no new code.
- **Section 6 breaks the single-profile design.** Five registers: LinkedIn post, Instagram caption, client email, job application, notes to self. So the store holds a base profile plus per-context overrides matched on the active app bundle id.

```rust
pub struct StyleStore {
    pub samples: Vec<String>,
    pub base: Option<StyleProfile>,
    pub contexts: Vec<StyleContext>,   // per-app overrides
    pub auto_learn: bool,
    pub dictations_since_derive: u32,
    pub pending: Option<StyleProfile>,
}

pub struct StyleContext {
    pub id: String,
    pub name: String,                  // "Client email"
    pub bundle_ids: Vec<String>,       // ["com.google.Chrome", "com.apple.mail"]
    pub profile: StyleProfile,
}

pub struct StyleProfile {
    pub avg_sentence_words: u32,
    pub contractions: bool,
    pub punctuation_notes: String,
    pub banned_words: Vec<String>,
    pub tone_notes: String,
    pub derived_at: u64,
}
```

Resolution order: the context whose `bundle_ids` contains the active app, else base, else no injection. Injection appends a descriptive voice block to the cleanup system prompt — constraints only, never example text, so sample content cannot leak into output.

Auto-learn counts accepted dictations (pasted, and not corrected by the autolearn observer). Every 25, re-derive from recent history into `pending`. The pane shows a field-by-field diff with Accept and Discard. Nothing changes the live profile without an explicit accept. That is what keeps the voice from drifting silently.

**Gates.** `cleanup/gates.rs` measures divergence from the raw transcript. A style profile legitimately increases divergence, so with `style_enabled` the threshold widens by a fixed factor at the active `CleanupLevel`. Without this, styled output is rejected and the user sees raw text with no explanation. This phase is not done until a test proves a styled edit survives the gates.

Commands: `get_style`, `add_style_sample`, `remove_style_sample`, `derive_style_profile`, `set_style_profile`, `set_style_context`, `remove_style_context`, `set_style_auto_learn`, `accept_pending_style`, `discard_pending_style`.

### 5.6 Transforms

```rust
pub struct Transform {
    pub id: String,
    pub name: String,
    pub triggers: Vec<String>,
    pub prompt: String,                 // {input} substituted at run time
    pub default_source: TransformSource,
    pub builtin: bool,
}
```

Builtins seeded on first run, editable, not deletable: Email, Summary, To-do list, Reply, Bullets. Source resolves to the utterance, the current selection (`agentic_os::get_selected_text`, which already restores the prior clipboard), or the scratchpad. On provider error, paste nothing and report through `diag::report`. A failed transform must never paste a raw prompt into the user's document.

Commands: `get_transforms`, `add_transform`, `update_transform`, `remove_transform`, `run_transform`.

### 5.7 Window context

`window_context` is declared and consumed but never populated. Fill it from the Accessibility API already granted: roughly 200 characters around the caret, plus the selection. Treated as reference, never as instructions, exactly as the prompt builder already assumes.

This is the cheapest large gain in the project. It sharpens every cleanup, and it is what lets a transform know what it is replying to.

## 6. Part B — the merge

Ported modules keep their MIT headers. WhimprFlow's LICENSE gains an attribution section and the README credits Oatmeal and Vedant Soni. Not optional.

| Ported | Into | Change on the way in |
|---|---|---|
| `mic.rs`, `sysaudio.rs` | `whimpr-audio` | Share the existing resampler |
| `session.rs`, `live.rs`, `store.rs`, `library.rs`, `sleep.rs` | `whimpr-meetings` | Transcription goes through the shared model registry |
| `transcribe.rs` | `whimpr-asr` | Merge with the existing ASR path, one whisper-rs |
| `chat.rs`, `recall.rs`, `study.rs`, `homework.rs` | `whimpr-notes` | **llama calls go through `whimpr-llm-worker`**, in-process llama deleted |
| `video.rs`, `model.rs`, `update.rs` | `whimpr-media` | `update.rs` repointed at this repository |
| `window.rs` | `src-tauri` | Applied per-window: Hub normal, recorder and transcript hidden from capture |
| `autoanswer.rs` | `whimpr-core` | Gate extended to cover dictation cleanup, priority order in §4 |
| `apple_calendar.rs` | `whimpr-meetings` | Unchanged |
| `settings.rs` | merged into `whimpr-core/settings.rs` | Keep its unknown-key preservation on save |

Deleted on the way in: `capture/server.mjs` and the node stack, the `localhost:4123` dependency, `agentic_os::handle_start_recording`, Oatmeal's in-process llama, the `=0.1.141` pin, and `ggml-base.en.bin` from git once `model.rs` lands.

### Two wins that come free

- `model.rs` downloads models on first run with resumable `curl` and atomic rename. Porting it lets the 148 MB blob leave the repository.
- `sleep.rs` handles macOS suspending audio devices on lid-close, which today silently eats dictation too. It covers both halves once merged.

### New permission

ScreenCaptureKit needs Screen Recording. `get_status` gains a fourth field, onboarding a fourth gate, and the error banner a fourth case. Dictation must keep working with it denied: system audio is the only thing that fails.

## 7. Phases

| Phase | Work | Risk |
|---|---|---|
| 0 | Data layer: settings fields, five core modules, all Tauri commands, `api.ts` wrappers | none |
| 0.5 | Import voice-ref §8 terms into `dictionary.json` | none |
| 1 | Scratchpad | none |
| 2 | Snippets and the expansion pass | low |
| 3 | Transforms and the selection run path | low |
| 4 | Style: seed from the voice ref, per-context profiles, gate widening, auto-learn | medium |
| 5 | `router.rs` replaces the hardcoded wake word | medium, live paste path |
| 6 | Populate `window_context` from the caret | low |
| 7 | All llama through `whimpr-llm-worker`, `=0.1.141` pin deleted | medium |
| 8 | `whimpr-asr` to whisper-rs 0.16, dictation verified unchanged | **gate** |
| 9 | Port `model.rs`, shared model registry, remove the 148 MB blob from git | medium |
| 10 | `whimpr-meetings`: session, sysaudio, mic, live, store, sleep | high |
| 11 | Screen Recording permission, onboarding gate, hidden recorder and transcript windows | medium |
| 12 | `whimpr-notes`: chat, ask-a-meeting, ask-the-library, draft follow-up, through the worker | medium |
| 13 | Library: folders, search, snippet search, export, rename, delete | low |
| 14 | Study: plan, flashcards, quiz. Homework | low |
| 15 | `whimpr-media`: YouTube import, LaTeX from speech, update check | medium |
| 16 | Apple Calendar via EventKit | low |

Phase 8 is the gate. Everything from 10 onward depends on it. Phases 0 to 6 stand on their own if it goes badly.

The UI track runs in parallel from phase 10 and is the long pole: 6,370 lines of vanilla JS rewritten as React panes matching the Hub.

## 8. Testing

- **Router:** wake word absent yields `Dictate`. Wake word plus known verb yields `Command` with no LLM call. Unknown phrasing under `command_provider: "rules"` yields `Dictate`, not an error.
- **Snippets:** longest match first, word boundaries only, disabled entries skipped.
- **Style:** profiles round-trip through JSON. Context resolution picks the right override for a bundle id. A styled edit passes the widened gates at `CleanupLevel::Light`.
- **Transforms:** a provider error results in zero pasted characters.
- **Stores:** each persists, reloads, and loads a file written before the new fields existed.
- **Phase 8 gate:** the existing ASR tests pass on 0.16, and a manual dictation round-trip is verified before phase 10 starts.
- **GPU gate:** under a live session plus a dictation plus a note generation, the live transcript never starves.
- **Permissions:** with Screen Recording denied, dictation and mic recording still work and only system audio reports a failure.

Existing tests stay green. The raw-transcript fallback is load-bearing and is not weakened by any phase.

## 9. Out of scope

- Cross-device sync (Mac, Windows, iPhone, Android). Local-first is the point and there is no server.
- Multi-language ASR. The shipped model is English-only; `model.rs` makes larger multilingual models installable later, but nothing here targets them.
- Windows parity for anything using AppleScript, EventKit, or ScreenCaptureKit. Those compile to an unsupported error off macOS. Dictation, snippets, style, transforms, and the scratchpad stay cross-platform.
