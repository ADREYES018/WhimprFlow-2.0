# WhimprFlow Control Features — Design Spec

**Date:** 2026-09-04
**Status:** Approved, not implemented
**Scope:** Ship the four placeholder tabs (Snippets, Style, Transforms, Scratchpad) as working features, and replace the hardcoded wake-word block with a real intent router.

---

## 1. Problem

WhimprFlow dictates and cleans text. Five things it advertises but does not do:

1. **Commands.** `src-tauri/src/hotkey.rs:589` checks `raw_lower.starts_with("hey shrimp")` then keyword-matches a hardcoded list (`terminal`, `oatmeal`, `safari`, `notes`, bare `open X`). Nothing else works. The wake word is not configurable.
2. **Transforms.** No way to say "make this an email" and get an email.
3. **Snippets.** No reusable phrase expansion.
4. **Style.** Cleanup output does not sound like the user. `cleanup/prompts.rs` carries one fixed system prompt for everyone.
5. **Scratchpad.** No place to dictate long-form before it lands somewhere.

All four tabs already route in `ui/src/hub/Sidebar.tsx` and render `ComingSoon` via the `SOON` map in `ui/src/hub/App.tsx:104`.

## 2. What already exists (build on it, do not rebuild)

- **JSON intent contract.** `clean_transcript` returns JSON; `hotkey.rs:634` parses `{ type, text_to_paste, command_intent, command_target }` and dispatches `type: "command"` to `agentic_os::execute_system_command`. The seam is there. It is just fed by a keyword table.
- **Execution layer.** `crates/whimpr-core/src/agentic_os.rs` has `run_applescript`, `get_frontmost_app`, `get_active_window_title`, `get_selected_text` (clipboard-safe, restores prior contents), and `execute_system_command` with intents `open_app`, `search_web`, `ui_click`, `open_url`, `start_recording`.
- **Persistence pattern.** `dictionary/mod.rs` and `stats.rs` each own a struct, serialize to a JSON file under the support dir (`hotkey.rs:156` `support_dir()`), and expose Tauri commands in `src-tauri/src/lib.rs`. Every new store copies this shape exactly.
- **UI primitives.** `ui/src/hub/ui.tsx` exports `Card`, `Dot`, `Button`, `Segmented`, `PageTitle`, `useStats`. `theme.ts` holds every colour token. `icons.tsx` already ships `snippets`, `style`, `transforms`, `scratchpad` glyphs.
- **API wrapper pattern.** `ui/src/hub/api.ts` wraps every Tauri command in `try/catch` returning a safe default, so the Hub renders in plain `vite dev` with no shell. Every new wrapper must keep this.
- **Cleanup gates.** `cleanup/gates.rs` rejects edits that stray too far from the raw transcript, falling back to raw. Relevant to Style (§7).

## 3. Architecture

Five new modules in `crates/whimpr-core/src/`, four with a JSON file beside `dictionary.json` / `stats.json` in the support dir.

| Module | File | Owns |
|---|---|---|
| `snippets.rs` | `snippets.json` | trigger phrase to expansion |
| `style.rs` | `style.json` | raw samples, derived profile, auto-learn state |
| `transforms.rs` | `transforms.json` | builtin + custom prompt presets |
| `scratchpad.rs` | `scratchpad.json` | one long-form doc, capture-mode flag |
| `router.rs` | none | classifies a transcript into a route |

Each store is `Send + Sync` behind a `OnceLock<Mutex<_>>` in `hotkey.rs`, matching how `DICT` and `STATS` are held today.

### New settings fields

Appended to `Settings` in `crates/whimpr-core/src/settings.rs`. Every field gets `#[serde(default = ...)]` so existing `settings.json` files keep loading.

```rust
#[serde(default = "default_wake_word")]
pub wake_word: String,            // "hey shrimp"
#[serde(default = "default_true")]
pub wake_word_enabled: bool,      // true
#[serde(default = "default_command_provider")]
pub command_provider: String,     // "auto" | "cloud" | "local" | "rules"
#[serde(default)]
pub style_enabled: bool,          // false until a profile exists
#[serde(default = "default_true")]
pub snippets_enabled: bool,
```

## 4. The pipeline

Replaces the `if raw_lower.trim().starts_with("hey shrimp")` block at `hotkey.rs:589`.

```
transcript
  └─ router::route(raw, &settings, &transforms, &snippets) -> Route
       ├─ Route::Command   { intent, target }
       │    └─ agentic_os::execute_system_command -> no paste
       ├─ Route::Transform { id, body, source }
       │    └─ resolve source -> run transform prompt -> paste or scratchpad
       └─ Route::Dictate
            └─ clean_transcript (style profile injected)
               -> snippets::expand
               -> paste, or append to scratchpad if capture_mode
```

### Router layers

`router::route` tries each in order and falls through on no match:

1. **Wake word.** If `wake_word_enabled` and the transcript starts with `wake_word` (case- and punctuation-insensitive, same normalisation as the current code), strip it and continue into layers 2 and 3. If the wake word is absent, return `Route::Dictate` immediately. No wake word means no command, ever.
2. **Rule table.** Deterministic, offline, instant. Matches verb prefixes against the five `agentic_os` intents, plus every transform trigger phrase and every snippet trigger phrase. This is the layer that handles the common case with zero latency and zero API cost.
3. **LLM intent.** No rule matched. Ask a model for the JSON contract already parsed at `hotkey.rs:634`. Provider selection follows `command_provider`: `auto` uses the cloud provider when an API key is present in the keychain and falls back to the local llama worker otherwise; `cloud` and `local` force one; `rules` skips this layer entirely.
4. **Fallback.** Nothing classified it: return `Route::Dictate`. Audio is never silently dropped. This is the rule that keeps a router bug from eating the user's words.

### Route type

```rust
pub enum Route {
    Command { intent: String, target: String },
    Transform { id: String, body: String, source: TransformSource },
    Dictate,
}

pub enum TransformSource {
    Utterance,  // the words after the trigger phrase
    Selection,  // agentic_os::get_selected_text()
    Scratchpad, // the current scratchpad doc
}
```

## 5. Scratchpad

**Store:** `{ text: String, updated_at: u64, capture_mode: bool }`.

**Behaviour:** when `capture_mode` is on, `Route::Dictate` appends the cleaned text to the doc instead of pasting at the cursor. The overlay pill shows a distinct state so it is never ambiguous where words are going.

**Pane:** a full-height textarea, autosaving on a 500 ms debounce. A transform picker runs any transform over the doc and replaces the content (with one level of undo). Copy-all button. Word count.

**Tauri commands:** `get_scratchpad`, `set_scratchpad_text(text)`, `set_scratchpad_capture(on)`.

**Risk:** none. Touches no existing path.

## 6. Snippets

**Store entry:** `{ trigger: String, expansion: String, enabled: bool }`.

**Expansion:** a post-cleanup literal pass in `snippets::expand`. Case-insensitive, longest trigger matched first, whole-phrase boundaries only so a trigger cannot fire inside a word. Runs after `apply_vocab` so a dictionary correction can produce a trigger.

**Voice:** the router's rule table also matches a bare trigger after the wake word ("hey shrimp, my signature"), which pastes the expansion alone.

**Pane:** list, add, edit, delete. Same layout language as `DictionaryPane.tsx`.

**Tauri commands:** `get_snippets`, `add_snippet(trigger, expansion)`, `update_snippet(trigger, expansion, enabled)`, `remove_snippet(trigger)`.

## 7. Style

**Store:**

```rust
pub struct StyleStore {
    pub samples: Vec<String>,          // pasted by the user
    pub profile: Option<StyleProfile>, // derived
    pub auto_learn: bool,
    pub dictations_since_derive: u32,
    pub pending: Option<StyleProfile>, // a proposed auto-learn update
}

pub struct StyleProfile {
    pub avg_sentence_words: u32,
    pub contractions: bool,
    pub punctuation_notes: String,  // e.g. "no em-dashes, commas over semicolons"
    pub banned_words: Vec<String>,
    pub tone_notes: String,         // 1-3 sentences
    pub derived_at: u64,
}
```

**Derivation:** one LLM pass over the samples, using the active cleanup provider. Output is the `StyleProfile` JSON above. Every field stays editable by hand in the pane; a derive never overwrites a field the user has edited since the last derive.

**Injection:** when `style_enabled` and a profile exists, `cleanup::build_messages` appends a voice block to the system prompt. The block is descriptive constraints only, never example text, so it cannot leak sample content into output.

**Auto-learn:** counts accepted dictations (those that were pasted and not corrected by the autolearn observer). Every 25, re-derive from the most recent history and store the result in `pending`. The Style pane shows a diff against the live profile with Accept and Discard. Nothing changes the live profile without an explicit accept. This is what stops the voice from drifting silently.

**Gates:** `evaluate_gates` measures divergence from the raw transcript. A style profile legitimately increases divergence, so with `style_enabled` the gate threshold widens by a fixed factor at the active `CleanupLevel`. Without this change, styled output is rejected and the user sees raw text with no explanation. Phase 4 is not done until a test proves a styled edit survives the gates.

**Tauri commands:** `get_style`, `add_style_sample(text)`, `remove_style_sample(index)`, `derive_style_profile`, `set_style_profile(profile)`, `set_style_auto_learn(on)`, `accept_pending_style`, `discard_pending_style`.

## 8. Transforms

**Store entry:**

```rust
pub struct Transform {
    pub id: String,
    pub name: String,
    pub triggers: Vec<String>,     // "make this an email", "email this"
    pub prompt: String,            // template, {input} substituted
    pub default_source: TransformSource,
    pub builtin: bool,
}
```

**Builtins** (seeded on first run, editable, not deletable): Email, Summary, To-do list, Reply, Bullets.

**Execution:** resolve the source to an input string, substitute into the prompt, send to the active cleanup provider, paste the result (or write it to the scratchpad when the source was `Scratchpad`). On provider error, paste nothing and report through `diag::report` — a failed transform must not paste a half-finished or raw prompt into the user's document.

**Pane:** list of transforms with name, triggers, source, and prompt. Add and edit custom ones. A "Run on selection" button for testing without voice.

**Tauri commands:** `get_transforms`, `add_transform(transform)`, `update_transform(transform)`, `remove_transform(id)`, `run_transform(id, source)`.

## 9. Phases

Each phase ships something that works on its own.

| Phase | Work | Owner |
|---|---|---|
| 0 | Settings fields, five core modules, all Tauri commands, `api.ts` wrappers | Rust (Claude) |
| 1 | Scratchpad store wiring + `ScratchpadPane.tsx` | Rust + Gemini UI |
| 2 | Snippets store + expansion pass + `SnippetsPane.tsx` | Rust + Gemini UI |
| 3 | Transforms store + run path + `TransformsPane.tsx` | Rust + Gemini UI |
| 4 | Style derive, prompt injection, gate widening, auto-learn + `StylePane.tsx` | Rust + Gemini UI |
| 5 | `router.rs`, replacing the hardcoded wake-word block | Rust (Claude) |

Phase 0 blocks everything. Phases 1 to 4 are independent of each other. Phase 5 is last because it is the only one that touches the live dictation path.

Each pane replaces its entry in the `SOON` map in `App.tsx` and adds a real render branch. The `ComingSoon` component stays in the tree until phase 4 removes the last entry, then the file is deleted along with the now-unused `SOON` map.

## 10. Testing

- **Router:** table test per layer. Wake word absent yields `Dictate`. Wake word plus known verb yields `Command` without calling an LLM. Unknown phrasing with `command_provider: "rules"` yields `Dictate`, not an error.
- **Snippets:** longest-match-first, word-boundary-only, disabled entries skipped.
- **Style:** profile round-trips through JSON. A styled edit passes the widened gates at `CleanupLevel::Light`.
- **Transforms:** provider error results in zero pasted characters.
- **Stores:** each persists and reloads, and each loads a file written before the new fields existed.

Existing tests must stay green. The raw-transcript fallback is load-bearing and is not to be weakened by any phase.

## 11. Open items

- The user must supply several paragraphs of their own writing before phase 4 can derive a profile. Until then Style ships with derive wired but no profile.
- Windows parity: `agentic_os.rs` is AppleScript, so `Route::Command` is macOS-only. Phases 1 to 4 are cross-platform. Phase 5 compiles on Windows but returns an unsupported error per intent. Full Windows commands are out of scope here.
