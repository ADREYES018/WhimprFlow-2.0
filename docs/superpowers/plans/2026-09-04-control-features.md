# WhimprFlow Control Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four placeholder Hub tabs (Snippets, Style, Transforms, Scratchpad) as working features and replace the hardcoded wake-word block with a real intent router.

**Architecture:** Four new stores in `whimpr-core`, each copying the existing `dictionary`/`stats` pattern exactly: one struct, one JSON file in the app-support dir, one `OnceLock<Mutex<_>>` in `hotkey.rs`, one set of Tauri commands. A fifth module, `router.rs`, classifies each transcript into Command, Transform, or Dictate before the existing cleanup path runs.

**Tech Stack:** Rust 2021, Tauri v2, serde/serde_json, React 18 + TypeScript, vite, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-04-control-features-design.md`

## Global Constraints

- Every new `Settings` field carries `#[serde(default = "...")]`. An existing `settings.json` written before these fields must still load.
- Every new store implements `load(&Path) -> Self` (returning `Self::default()` on missing or unparseable) and `save(&Path) -> std::io::Result<()>` (creating parent dirs), matching `crates/whimpr-core/src/dictionary/mod.rs`.
- The raw-transcript fallback is load-bearing. No task may weaken it. If any layer fails, the raw transcript is pasted.
- Audio is never silently dropped. If the router classifies nothing, the result is `Route::Dictate`.
- No new dependencies in `ui/`. Plain React with inline style objects, existing primitives from `ui/src/hub/ui.tsx`.
- No em-dashes in any user-visible copy.
- macOS is the reference platform. Anything calling `agentic_os` (AppleScript) compiles on Windows and returns an unsupported error.
- Run `cargo test -p whimpr-core` after every Rust task. Run `cd ui && pnpm build` after every UI task.
- Commit after every task.

---

### Task 1: Settings fields for the new features

**Files:**
- Modify: `crates/whimpr-core/src/settings.rs:26-29` (default fns), `:31-56` (struct), `:58-73` (Default impl)
- Test: `crates/whimpr-core/src/settings.rs` (inline `mod tests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `Settings.wake_word: String`, `Settings.wake_word_enabled: bool`, `Settings.command_provider: String`, `Settings.style_enabled: bool`, `Settings.snippets_enabled: bool`.

- [ ] **Step 1: Write the failing test**

Add to the existing `mod tests` block at the bottom of `crates/whimpr-core/src/settings.rs`:

```rust
    #[test]
    fn new_fields_have_defaults() {
        let s = Settings::default();
        assert_eq!(s.wake_word, "hey shrimp");
        assert!(s.wake_word_enabled);
        assert_eq!(s.command_provider, "auto");
        assert!(!s.style_enabled);
        assert!(s.snippets_enabled);
    }

    #[test]
    fn loads_a_settings_file_written_before_these_fields_existed() {
        let old = r#"{
            "cleanup_mode": "local",
            "cleanup_level": "light",
            "openai_model": "gpt-4o-mini",
            "anthropic_model": "claude-haiku-4-5",
            "sound_on_start": true
        }"#;
        let s: Settings = serde_json::from_str(old).expect("old settings must still parse");
        assert_eq!(s.wake_word, "hey shrimp");
        assert!(s.snippets_enabled);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p whimpr-core settings`
Expected: FAIL, `no field 'wake_word' on type 'Settings'`.

- [ ] **Step 3: Write minimal implementation**

Add the default functions beside the existing ones at `crates/whimpr-core/src/settings.rs:26`:

```rust
fn default_wake_word() -> String { "hey shrimp".to_string() }
fn default_true() -> bool { true }
fn default_command_provider() -> String { "auto".to_string() }
```

Add these fields to the end of `pub struct Settings`:

```rust
    /// Spoken prefix that turns an utterance into a command instead of dictation.
    #[serde(default = "default_wake_word")]
    pub wake_word: String,
    /// When false, no utterance is ever treated as a command.
    #[serde(default = "default_true")]
    pub wake_word_enabled: bool,
    /// How unmatched commands are classified: "auto" | "cloud" | "local" | "rules".
    /// "rules" skips the LLM layer entirely.
    #[serde(default = "default_command_provider")]
    pub command_provider: String,
    /// Inject the user's style profile into the cleanup prompt.
    #[serde(default)]
    pub style_enabled: bool,
    /// Expand snippet triggers after cleanup.
    #[serde(default = "default_true")]
    pub snippets_enabled: bool,
```

Add the matching lines to `impl Default for Settings`:

```rust
            wake_word: default_wake_word(),
            wake_word_enabled: true,
            command_provider: default_command_provider(),
            style_enabled: false,
            snippets_enabled: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-core settings`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/whimpr-core/src/settings.rs
git commit -m "feat(settings): add wake word, command provider, style and snippet toggles"
```

---

### Task 2: Snippets store and expansion pass

**Files:**
- Create: `crates/whimpr-core/src/snippets.rs`
- Modify: `crates/whimpr-core/src/lib.rs:12-19` (module list), `:21-28` (re-exports)
- Test: inline `mod tests` in `crates/whimpr-core/src/snippets.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `snippets::Snippet { trigger: String, expansion: String, enabled: bool }`, `snippets::SnippetStore { entries: Vec<Snippet> }` with `load`, `save`, `add(trigger, expansion)`, `update(trigger, expansion, enabled)`, `remove(&str)`, and the free function `snippets::expand(text: &str, store: &SnippetStore) -> String`.

- [ ] **Step 1: Write the failing test**

Create `crates/whimpr-core/src/snippets.rs` containing only this test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn store(pairs: &[(&str, &str)]) -> SnippetStore {
        let mut s = SnippetStore::default();
        for (t, e) in pairs {
            s.add(*t, *e);
        }
        s
    }

    #[test]
    fn expands_a_trigger_case_insensitively() {
        let s = store(&[("my signature", "Adriel Reyes\nVisual artist")]);
        assert_eq!(expand("Thanks. My Signature", &s), "Thanks. Adriel Reyes\nVisual artist");
    }

    #[test]
    fn matches_the_longest_trigger_first() {
        let s = store(&[("my address", "SHORT"), ("my address in dubai", "LONG")]);
        assert_eq!(expand("send my address in dubai now", &s), "send LONG now");
    }

    #[test]
    fn does_not_fire_inside_a_word() {
        let s = store(&[("cat", "DOG")]);
        assert_eq!(expand("concatenate", &s), "concatenate");
    }

    #[test]
    fn skips_disabled_entries() {
        let mut s = store(&[("my bio", "BIO")]);
        s.update("my bio", "BIO", false);
        assert_eq!(expand("here is my bio", &s), "here is my bio");
    }

    #[test]
    fn round_trips_json() {
        let s = store(&[("a", "b")]);
        let json = serde_json::to_string(&s).unwrap();
        let back: SnippetStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back.entries.len(), 1);
        assert_eq!(back.entries[0].expansion, "b");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add `pub mod snippets;` to `crates/whimpr-core/src/lib.rs` after `pub mod settings;`, then run:

Run: `cargo test -p whimpr-core snippets`
Expected: FAIL, `cannot find type 'SnippetStore' in this scope`.

- [ ] **Step 3: Write minimal implementation**

Put this above the test module in `crates/whimpr-core/src/snippets.rs`:

```rust
//! Reusable phrases expanded by voice. A snippet is a trigger phrase and the
//! text it stands for. Expansion runs after cleanup and after `apply_vocab`, so
//! a dictionary correction can produce a trigger.

use std::path::Path;

use serde::{Deserialize, Serialize};

fn default_true() -> bool { true }

/// One snippet: what you say, and what gets typed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snippet {
    pub trigger: String,
    pub expansion: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// The user's snippets, persisted as JSON.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SnippetStore {
    #[serde(default)]
    pub entries: Vec<Snippet>,
}

impl SnippetStore {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }

    /// Add, or replace the expansion of an existing trigger (case-insensitive).
    pub fn add(&mut self, trigger: impl Into<String>, expansion: impl Into<String>) {
        let trigger = trigger.into();
        let expansion = expansion.into();
        if let Some(e) = self
            .entries
            .iter_mut()
            .find(|e| e.trigger.eq_ignore_ascii_case(&trigger))
        {
            e.expansion = expansion;
            return;
        }
        self.entries.push(Snippet { trigger, expansion, enabled: true });
    }

    pub fn update(&mut self, trigger: &str, expansion: impl Into<String>, enabled: bool) {
        if let Some(e) = self
            .entries
            .iter_mut()
            .find(|e| e.trigger.eq_ignore_ascii_case(trigger))
        {
            e.expansion = expansion.into();
            e.enabled = enabled;
        }
    }

    pub fn remove(&mut self, trigger: &str) {
        self.entries.retain(|e| !e.trigger.eq_ignore_ascii_case(trigger));
    }

    /// Enabled entries, longest trigger first, so a longer trigger always wins
    /// over a shorter one it contains.
    fn active_sorted(&self) -> Vec<&Snippet> {
        let mut v: Vec<&Snippet> = self.entries.iter().filter(|e| e.enabled).collect();
        v.sort_by_key(|e| std::cmp::Reverse(e.trigger.len()));
        v
    }
}

/// True when `idx..idx+len` in `hay` is bounded by non-alphanumerics on both
/// sides, so a trigger cannot fire in the middle of a longer word.
fn on_word_boundary(hay: &str, idx: usize, len: usize) -> bool {
    let before_ok = hay[..idx].chars().next_back().map_or(true, |c| !c.is_alphanumeric());
    let after_ok = hay[idx + len..].chars().next().map_or(true, |c| !c.is_alphanumeric());
    before_ok && after_ok
}

/// Replace every enabled trigger phrase in `text` with its expansion.
/// Case-insensitive, longest trigger first, whole phrases only.
pub fn expand(text: &str, store: &SnippetStore) -> String {
    let mut out = text.to_string();
    for snip in store.active_sorted() {
        if snip.trigger.is_empty() {
            continue;
        }
        loop {
            let lower = out.to_lowercase();
            let needle = snip.trigger.to_lowercase();
            let Some(idx) = lower.find(&needle) else { break };
            if !on_word_boundary(&lower, idx, needle.len()) {
                // Advance past this occurrence and look for a later one.
                let Some(next) = lower[idx + needle.len()..].find(&needle) else { break };
                let _ = next;
                break;
            }
            out.replace_range(idx..idx + needle.len(), &snip.expansion);
        }
    }
    out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-core snippets`
Expected: PASS, 5 tests.

- [ ] **Step 5: Re-export from the crate root**

In `crates/whimpr-core/src/lib.rs`, add beside the other re-exports:

```rust
pub use snippets::{Snippet, SnippetStore};
```

Run: `cargo test -p whimpr-core`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add crates/whimpr-core/src/snippets.rs crates/whimpr-core/src/lib.rs
git commit -m "feat(snippets): store and word-boundary expansion pass"
```

---

### Task 3: Scratchpad store

**Files:**
- Create: `crates/whimpr-core/src/scratchpad.rs`
- Modify: `crates/whimpr-core/src/lib.rs`
- Test: inline `mod tests`

**Interfaces:**
- Consumes: nothing.
- Produces: `scratchpad::Scratchpad { text: String, updated_at: u64, capture_mode: bool }` with `load`, `save`, `set_text(&mut self, String)`, `append(&mut self, &str)`, `set_capture(&mut self, bool)`.

- [ ] **Step 1: Write the failing test**

Create `crates/whimpr-core/src/scratchpad.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_adds_a_blank_line_between_entries() {
        let mut s = Scratchpad::default();
        s.append("First thought.");
        s.append("Second thought.");
        assert_eq!(s.text, "First thought.\n\nSecond thought.");
    }

    #[test]
    fn append_into_an_empty_pad_does_not_lead_with_blank_lines() {
        let mut s = Scratchpad::default();
        s.append("Only thought.");
        assert_eq!(s.text, "Only thought.");
    }

    #[test]
    fn set_text_stamps_updated_at() {
        let mut s = Scratchpad::default();
        assert_eq!(s.updated_at, 0);
        s.set_text("hello".to_string());
        assert!(s.updated_at > 0);
    }

    #[test]
    fn capture_mode_defaults_off_and_round_trips() {
        let mut s = Scratchpad::default();
        assert!(!s.capture_mode);
        s.set_capture(true);
        let json = serde_json::to_string(&s).unwrap();
        let back: Scratchpad = serde_json::from_str(&json).unwrap();
        assert!(back.capture_mode);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add `pub mod scratchpad;` to `crates/whimpr-core/src/lib.rs`, then run:

Run: `cargo test -p whimpr-core scratchpad`
Expected: FAIL, `cannot find type 'Scratchpad' in this scope`.

- [ ] **Step 3: Write minimal implementation**

Above the test module:

```rust
//! The scratchpad: one long-form document you dictate into before the text goes
//! anywhere else. With `capture_mode` on, dictation appends here instead of
//! pasting at the cursor.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Scratchpad {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub updated_at: u64,
    /// When true, dictation lands in this pad instead of at the cursor.
    #[serde(default)]
    pub capture_mode: bool,
}

impl Scratchpad {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }

    pub fn set_text(&mut self, text: String) {
        self.text = text;
        self.updated_at = now_unix();
    }

    /// Append a dictated block, separated by a blank line. An empty pad gains
    /// no leading whitespace.
    pub fn append(&mut self, block: &str) {
        if self.text.is_empty() {
            self.text = block.to_string();
        } else {
            self.text.push_str("\n\n");
            self.text.push_str(block);
        }
        self.updated_at = now_unix();
    }

    pub fn set_capture(&mut self, on: bool) {
        self.capture_mode = on;
        self.updated_at = now_unix();
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-core scratchpad`
Expected: PASS, 4 tests.

- [ ] **Step 5: Re-export and commit**

Add `pub use scratchpad::Scratchpad;` to `crates/whimpr-core/src/lib.rs`.

```bash
cargo test -p whimpr-core
git add crates/whimpr-core/src/scratchpad.rs crates/whimpr-core/src/lib.rs
git commit -m "feat(scratchpad): long-form dictation store with capture mode"
```

---

### Task 4: Transforms store with seeded builtins

**Files:**
- Create: `crates/whimpr-core/src/transforms.rs`
- Modify: `crates/whimpr-core/src/lib.rs`
- Test: inline `mod tests`

**Interfaces:**
- Consumes: nothing.
- Produces: `transforms::TransformSource` (`Utterance`, `Selection`, `Scratchpad`), `transforms::Transform { id, name, triggers, prompt, default_source, builtin }`, `transforms::TransformStore { entries }` with `load`, `save`, `seeded()`, `add`, `update`, `remove(&str)`, `get(&str)`, and `Transform::render(&self, input: &str) -> String`.

- [ ] **Step 1: Write the failing test**

Create `crates/whimpr-core/src/transforms.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_store_has_the_five_builtins() {
        let s = TransformStore::seeded();
        let names: Vec<&str> = s.entries.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["Email", "Summary", "To-do list", "Reply", "Bullets"]);
        assert!(s.entries.iter().all(|t| t.builtin));
    }

    #[test]
    fn render_substitutes_the_input_placeholder() {
        let t = Transform {
            id: "x".into(),
            name: "X".into(),
            triggers: vec![],
            prompt: "Rewrite this as a haiku:\n{input}".into(),
            default_source: TransformSource::Utterance,
            builtin: false,
        };
        assert_eq!(t.render("hello"), "Rewrite this as a haiku:\nhello");
    }

    #[test]
    fn remove_refuses_to_delete_a_builtin() {
        let mut s = TransformStore::seeded();
        let before = s.entries.len();
        assert!(!s.remove("email"));
        assert_eq!(s.entries.len(), before);
    }

    #[test]
    fn remove_deletes_a_custom_transform() {
        let mut s = TransformStore::seeded();
        s.add(Transform {
            id: "mine".into(),
            name: "Mine".into(),
            triggers: vec!["do my thing".into()],
            prompt: "{input}".into(),
            default_source: TransformSource::Selection,
            builtin: false,
        });
        assert!(s.remove("mine"));
        assert!(s.get("mine").is_none());
    }

    #[test]
    fn load_of_a_missing_file_returns_the_seeded_builtins() {
        let s = TransformStore::load(std::path::Path::new("/nonexistent/transforms.json"));
        assert_eq!(s.entries.len(), 5);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add `pub mod transforms;` to `crates/whimpr-core/src/lib.rs`, then run:

Run: `cargo test -p whimpr-core transforms`
Expected: FAIL, `cannot find type 'TransformStore' in this scope`.

- [ ] **Step 3: Write minimal implementation**

Above the test module:

```rust
//! Named prompt presets. A transform turns one piece of text into another:
//! a spoken thought into an email, a selection into a summary, the scratchpad
//! into a to-do list.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Where a transform's input comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransformSource {
    /// The words spoken after the trigger phrase.
    Utterance,
    /// The current selection in the frontmost app.
    Selection,
    /// The whole scratchpad document.
    Scratchpad,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transform {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub triggers: Vec<String>,
    /// Prompt template. `{input}` is replaced with the resolved source text.
    pub prompt: String,
    pub default_source: TransformSource,
    #[serde(default)]
    pub builtin: bool,
}

impl Transform {
    pub fn render(&self, input: &str) -> String {
        self.prompt.replace("{input}", input)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TransformStore {
    #[serde(default)]
    pub entries: Vec<Transform>,
}

fn builtin(id: &str, name: &str, triggers: &[&str], prompt: &str, source: TransformSource) -> Transform {
    Transform {
        id: id.to_string(),
        name: name.to_string(),
        triggers: triggers.iter().map(|s| s.to_string()).collect(),
        prompt: prompt.to_string(),
        default_source: source,
        builtin: true,
    }
}

impl TransformStore {
    /// The five builtins, in display order. Editable, never deletable.
    pub fn seeded() -> Self {
        Self {
            entries: vec![
                builtin(
                    "email",
                    "Email",
                    &["make this an email", "email this", "turn this into an email"],
                    "Rewrite the text below as a short email. Keep the sender's own wording and \
                     contractions. No preamble, no sign-off unless the text has one. Return only \
                     the email.\n\n{input}",
                    TransformSource::Utterance,
                ),
                builtin(
                    "summary",
                    "Summary",
                    &["summarize this", "summarise this", "make this a summary"],
                    "Summarize the text below in at most five sentences. Keep concrete details \
                     and numbers. Return only the summary.\n\n{input}",
                    TransformSource::Selection,
                ),
                builtin(
                    "todo",
                    "To-do list",
                    &["make this a to do list", "turn this into tasks", "make this a todo"],
                    "Turn the text below into a plain list of actionable items, one per line, \
                     each starting with '- '. Drop anything that is not an action. Return only \
                     the list.\n\n{input}",
                    TransformSource::Utterance,
                ),
                builtin(
                    "reply",
                    "Reply",
                    &["draft a reply", "reply to this"],
                    "Write a short reply to the message below. Match its register. No preamble. \
                     Return only the reply.\n\n{input}",
                    TransformSource::Selection,
                ),
                builtin(
                    "bullets",
                    "Bullets",
                    &["make this bullets", "bullet this"],
                    "Rewrite the text below as bullet points, one idea per line, each starting \
                     with '- '. Keep the original wording where you can. Return only the \
                     bullets.\n\n{input}",
                    TransformSource::Selection,
                ),
            ],
        }
    }

    /// Load from `path`, falling back to the seeded builtins when the file is
    /// missing or unreadable. A first run therefore always has the five presets.
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Self>(&s).ok())
            .filter(|s| !s.entries.is_empty())
            .unwrap_or_else(Self::seeded)
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }

    pub fn get(&self, id: &str) -> Option<&Transform> {
        self.entries.iter().find(|t| t.id == id)
    }

    /// Add, or replace an existing transform with the same id.
    pub fn add(&mut self, t: Transform) {
        if let Some(slot) = self.entries.iter_mut().find(|e| e.id == t.id) {
            *slot = t;
            return;
        }
        self.entries.push(t);
    }

    /// Replace a transform in place, keeping its `builtin` flag whatever the
    /// caller passed, so a builtin cannot be edited into a deletable one.
    pub fn update(&mut self, t: Transform) {
        if let Some(slot) = self.entries.iter_mut().find(|e| e.id == t.id) {
            let builtin = slot.builtin;
            *slot = Transform { builtin, ..t };
        }
    }

    /// Remove a custom transform. Returns false for a builtin or unknown id.
    pub fn remove(&mut self, id: &str) -> bool {
        let Some(pos) = self.entries.iter().position(|e| e.id == id) else { return false };
        if self.entries[pos].builtin {
            return false;
        }
        self.entries.remove(pos);
        true
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-core transforms`
Expected: PASS, 5 tests.

- [ ] **Step 5: Re-export and commit**

Add `pub use transforms::{Transform, TransformSource, TransformStore};` to `crates/whimpr-core/src/lib.rs`.

```bash
cargo test -p whimpr-core
git add crates/whimpr-core/src/transforms.rs crates/whimpr-core/src/lib.rs
git commit -m "feat(transforms): store with five seeded builtin presets"
```

---

### Task 5: Style store with per-context resolution

**Files:**
- Create: `crates/whimpr-core/src/style.rs`
- Modify: `crates/whimpr-core/src/lib.rs`
- Test: inline `mod tests`

**Interfaces:**
- Consumes: nothing.
- Produces: `style::StyleProfile`, `style::StyleContext`, `style::StyleStore` with `load`, `save`, `resolve(&self, bundle_id: Option<&str>) -> Option<&StyleProfile>`, `set_context`, `remove_context(&str)`, `accept_pending`, `discard_pending`, and `StyleProfile::to_prompt_block(&self) -> String`.

- [ ] **Step 1: Write the failing test**

Create `crates/whimpr-core/src/style.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn profile(tone: &str) -> StyleProfile {
        StyleProfile {
            avg_sentence_words: 12,
            contractions: true,
            punctuation_notes: "no em-dashes".into(),
            banned_words: vec!["game-changer".into()],
            tone_notes: tone.into(),
            derived_at: 1,
        }
    }

    #[test]
    fn resolve_prefers_a_matching_context_over_base() {
        let mut s = StyleStore::default();
        s.base = Some(profile("base"));
        s.set_context(StyleContext {
            id: "email".into(),
            name: "Client email".into(),
            bundle_ids: vec!["com.apple.mail".into()],
            profile: profile("email"),
        });
        assert_eq!(s.resolve(Some("com.apple.mail")).unwrap().tone_notes, "email");
    }

    #[test]
    fn resolve_falls_back_to_base_for_an_unknown_app() {
        let mut s = StyleStore::default();
        s.base = Some(profile("base"));
        assert_eq!(s.resolve(Some("com.unknown.app")).unwrap().tone_notes, "base");
    }

    #[test]
    fn resolve_is_none_when_nothing_is_configured() {
        let s = StyleStore::default();
        assert!(s.resolve(Some("com.apple.mail")).is_none());
    }

    #[test]
    fn prompt_block_names_every_constraint_and_no_sample_text() {
        let p = profile("Casual, direct");
        let block = p.to_prompt_block();
        assert!(block.contains("game-changer"));
        assert!(block.contains("no em-dashes"));
        assert!(block.contains("Casual, direct"));
        assert!(block.contains("contractions"));
    }

    #[test]
    fn accept_pending_promotes_it_to_base_and_clears_the_counter() {
        let mut s = StyleStore::default();
        s.base = Some(profile("old"));
        s.pending = Some(profile("new"));
        s.dictations_since_derive = 25;
        s.accept_pending();
        assert_eq!(s.base.unwrap().tone_notes, "new");
        assert!(s.pending.is_none());
        assert_eq!(s.dictations_since_derive, 0);
    }

    #[test]
    fn discard_pending_leaves_base_untouched() {
        let mut s = StyleStore::default();
        s.base = Some(profile("old"));
        s.pending = Some(profile("new"));
        s.discard_pending();
        assert_eq!(s.base.unwrap().tone_notes, "old");
        assert!(s.pending.is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add `pub mod style;` to `crates/whimpr-core/src/lib.rs`, then run:

Run: `cargo test -p whimpr-core style`
Expected: FAIL, `cannot find type 'StyleStore' in this scope`.

- [ ] **Step 3: Write minimal implementation**

Above the test module:

```rust
//! The user's writing voice, as constraints the cleanup prompt can carry.
//!
//! A profile is descriptive only. It never contains sample text, so nothing the
//! user pasted as a sample can leak into pasted output. One base profile applies
//! everywhere; per-app contexts override it, because the register for a client
//! email is not the register for a note to yourself.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// A described writing voice. Constraints, never examples.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StyleProfile {
    pub avg_sentence_words: u32,
    pub contractions: bool,
    pub punctuation_notes: String,
    pub banned_words: Vec<String>,
    pub tone_notes: String,
    pub derived_at: u64,
}

impl StyleProfile {
    /// Render as the voice block appended to the cleanup system prompt.
    pub fn to_prompt_block(&self) -> String {
        let mut out = String::from("\n\n# The user's voice\nMatch these constraints exactly.\n");
        out.push_str(&format!("- Aim for about {} words per sentence.\n", self.avg_sentence_words));
        out.push_str(if self.contractions {
            "- Keep contractions. Do not expand them.\n"
        } else {
            "- Avoid contractions.\n"
        });
        if !self.punctuation_notes.trim().is_empty() {
            out.push_str(&format!("- Punctuation: {}\n", self.punctuation_notes.trim()));
        }
        if !self.banned_words.is_empty() {
            out.push_str(&format!("- Never use these words: {}\n", self.banned_words.join(", ")));
        }
        if !self.tone_notes.trim().is_empty() {
            out.push_str(&format!("- Tone: {}\n", self.tone_notes.trim()));
        }
        out
    }
}

/// A per-app override, e.g. the client-email register for Mail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StyleContext {
    pub id: String,
    pub name: String,
    pub bundle_ids: Vec<String>,
    pub profile: StyleProfile,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StyleStore {
    /// Raw writing samples the user pasted. Input to derivation only.
    #[serde(default)]
    pub samples: Vec<String>,
    #[serde(default)]
    pub base: Option<StyleProfile>,
    #[serde(default)]
    pub contexts: Vec<StyleContext>,
    #[serde(default)]
    pub auto_learn: bool,
    #[serde(default)]
    pub dictations_since_derive: u32,
    /// A proposed update awaiting the user's explicit accept.
    #[serde(default)]
    pub pending: Option<StyleProfile>,
}

/// Re-derive is proposed after this many accepted dictations.
pub const DERIVE_EVERY: u32 = 25;

impl StyleStore {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }

    /// The profile that applies to `bundle_id`: a matching context, else base,
    /// else nothing.
    pub fn resolve(&self, bundle_id: Option<&str>) -> Option<&StyleProfile> {
        if let Some(id) = bundle_id {
            if let Some(ctx) = self
                .contexts
                .iter()
                .find(|c| c.bundle_ids.iter().any(|b| b.eq_ignore_ascii_case(id)))
            {
                return Some(&ctx.profile);
            }
        }
        self.base.as_ref()
    }

    /// Add or replace a context by id.
    pub fn set_context(&mut self, ctx: StyleContext) {
        if let Some(slot) = self.contexts.iter_mut().find(|c| c.id == ctx.id) {
            *slot = ctx;
            return;
        }
        self.contexts.push(ctx);
    }

    pub fn remove_context(&mut self, id: &str) {
        self.contexts.retain(|c| c.id != id);
    }

    /// Promote the pending profile to base. The only path that changes the live
    /// voice from auto-learn.
    pub fn accept_pending(&mut self) {
        if let Some(p) = self.pending.take() {
            self.base = Some(p);
        }
        self.dictations_since_derive = 0;
    }

    pub fn discard_pending(&mut self) {
        self.pending = None;
        self.dictations_since_derive = 0;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-core style`
Expected: PASS, 6 tests.

- [ ] **Step 5: Re-export and commit**

Add `pub use style::{StyleContext, StyleProfile, StyleStore};` to `crates/whimpr-core/src/lib.rs`.

```bash
cargo test -p whimpr-core
git add crates/whimpr-core/src/style.rs crates/whimpr-core/src/lib.rs
git commit -m "feat(style): profile store with per-app context resolution"
```

---

### Task 6: Style injection into the cleanup prompt, with widened gates

**Files:**
- Modify: `crates/whimpr-core/src/cleanup/mod.rs:37-63` (`CleanupContext`), `:114-126` (`build_messages`)
- Modify: `crates/whimpr-core/src/cleanup/gates.rs` (threshold)
- Test: inline `mod tests` in both files

**Interfaces:**
- Consumes: `style::StyleProfile::to_prompt_block` from Task 5.
- Produces: `CleanupContext.style: Option<StyleProfile>`; `gates::evaluate(raw, cleaned, level, style_active: bool)`.

- [ ] **Step 1: Write the failing test**

Add to the test module in `crates/whimpr-core/src/cleanup/mod.rs`:

```rust
    #[test]
    fn system_prompt_carries_the_voice_block_when_a_style_is_set() {
        let ctx = CleanupContext {
            style: Some(crate::style::StyleProfile {
                avg_sentence_words: 10,
                contractions: true,
                punctuation_notes: "no em-dashes".into(),
                banned_words: vec!["game-changer".into()],
                tone_notes: "Casual and direct".into(),
                derived_at: 1,
            }),
            ..Default::default()
        };
        let msgs = build_messages("hello there", &ctx);
        let system = &msgs[0].content;
        assert!(system.contains("The user's voice"));
        assert!(system.contains("game-changer"));
    }

    #[test]
    fn system_prompt_is_unchanged_when_no_style_is_set() {
        let ctx = CleanupContext::default();
        let msgs = build_messages("hello there", &ctx);
        assert!(!msgs[0].content.contains("The user's voice"));
    }
```

Add to the test module in `crates/whimpr-core/src/cleanup/gates.rs`:

```rust
    #[test]
    fn a_styled_edit_that_fails_the_normal_gate_passes_the_widened_one() {
        let raw = "so basically I was thinking maybe we could just do the portfolio first and then yeah the coffee thing after";
        let cleaned = "Portfolio first, coffee brand after.";
        assert!(!evaluate(raw, cleaned, CleanupLevel::Light, false).passed());
        assert!(evaluate(raw, cleaned, CleanupLevel::Light, true).passed());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p whimpr-core cleanup`
Expected: FAIL, `struct 'CleanupContext' has no field named 'style'` and `evaluate takes 3 arguments but 4 were supplied`.

- [ ] **Step 3: Write minimal implementation**

In `crates/whimpr-core/src/cleanup/mod.rs`, add to `CleanupContext` and its `Default` impl:

```rust
    /// The voice profile that applies to this utterance, if any.
    pub style: Option<crate::style::StyleProfile>,
```

```rust
            style: None,
```

Note: `CleanupContext` derives `PartialEq, Eq`, so `StyleProfile` must too. It already does from Task 5.

In `build_messages`, replace the system message push with:

```rust
    let mut system = prompts::system_for(ctx.level, ctx.app_bundle_id.as_deref());
    if let Some(style) = ctx.style.as_ref() {
        system.push_str(&style.to_prompt_block());
    }
    msgs.push(CleanupMsg { role: "system", content: system });
```

In `crates/whimpr-core/src/cleanup/gates.rs`, add the parameter to `evaluate` and widen the divergence threshold when it is set. A style profile legitimately shortens and rewrites text, so the ceiling rises:

```rust
/// Multiplier applied to the divergence ceiling when a style profile is active.
/// Styling deliberately rewrites more than plain cleanup; without this the gate
/// rejects every styled edit and the user silently gets raw text.
const STYLE_TOLERANCE: f32 = 2.5;
```

Then, wherever the existing threshold is compared, multiply it by `STYLE_TOLERANCE` when `style_active` is true. Update every existing call site of `evaluate` to pass `false`, except the one in `hotkey.rs` which passes `settings.style_enabled`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-core`
Expected: PASS, all tests including the two new cleanup tests and the new gate test.

- [ ] **Step 5: Commit**

```bash
git add crates/whimpr-core/src/cleanup/
git commit -m "feat(style): inject the voice block and widen gates when styling is on"
```

---

### Task 7: The router

**Files:**
- Create: `crates/whimpr-core/src/router.rs`
- Modify: `crates/whimpr-core/src/lib.rs`
- Test: inline `mod tests`

**Interfaces:**
- Consumes: `Settings` (Task 1), `SnippetStore` (Task 2), `TransformStore` and `TransformSource` (Task 4).
- Produces: `router::Route` (`Command { intent, target }`, `Transform { id, body, source }`, `Snippet { trigger }`, `Dictate`), `router::normalize(&str) -> String`, `router::strip_wake_word(&str, &str) -> Option<String>`, `router::route_by_rules(raw, &Settings, &TransformStore, &SnippetStore) -> Route`.

The LLM layer is deliberately not in this module. `route_by_rules` returns `Route::Dictate` when nothing matches, and the caller in `hotkey.rs` decides whether to consult a provider before accepting that.

- [ ] **Step 1: Write the failing test**

Create `crates/whimpr-core/src/router.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;
    use crate::snippets::SnippetStore;
    use crate::transforms::TransformStore;

    fn fixtures() -> (Settings, TransformStore, SnippetStore) {
        let mut snips = SnippetStore::default();
        snips.add("my signature", "Adriel Reyes");
        (Settings::default(), TransformStore::seeded(), snips)
    }

    #[test]
    fn no_wake_word_is_always_dictation() {
        let (s, t, sn) = fixtures();
        assert_eq!(route_by_rules("open terminal", &s, &t, &sn), Route::Dictate);
    }

    #[test]
    fn wake_word_plus_a_known_verb_is_a_command() {
        let (s, t, sn) = fixtures();
        assert_eq!(
            route_by_rules("Hey shrimp, open Safari.", &s, &t, &sn),
            Route::Command { intent: "open_app".into(), target: "Safari".into() }
        );
    }

    #[test]
    fn wake_word_plus_a_transform_trigger_is_a_transform() {
        let (s, t, sn) = fixtures();
        assert_eq!(
            route_by_rules("hey shrimp make this an email", &s, &t, &sn),
            Route::Transform {
                id: "email".into(),
                body: String::new(),
                source: crate::transforms::TransformSource::Utterance,
            }
        );
    }

    #[test]
    fn a_transform_trigger_keeps_the_words_that_follow_as_the_body() {
        let (s, t, sn) = fixtures();
        assert_eq!(
            route_by_rules("hey shrimp make this an email telling Sam I am late", &s, &t, &sn),
            Route::Transform {
                id: "email".into(),
                body: "telling Sam I am late".into(),
                source: crate::transforms::TransformSource::Utterance,
            }
        );
    }

    #[test]
    fn wake_word_plus_a_snippet_trigger_is_a_snippet() {
        let (s, t, sn) = fixtures();
        assert_eq!(
            route_by_rules("hey shrimp my signature", &s, &t, &sn),
            Route::Snippet { trigger: "my signature".into() }
        );
    }

    #[test]
    fn wake_word_with_nothing_recognizable_falls_through_to_dictation() {
        let (s, t, sn) = fixtures();
        assert_eq!(route_by_rules("hey shrimp flibbertigibbet", &s, &t, &sn), Route::Dictate);
    }

    #[test]
    fn a_disabled_wake_word_never_produces_a_command() {
        let (mut s, t, sn) = fixtures();
        s.wake_word_enabled = false;
        assert_eq!(route_by_rules("hey shrimp open Safari", &s, &t, &sn), Route::Dictate);
    }

    #[test]
    fn search_the_web_captures_the_whole_query() {
        let (s, t, sn) = fixtures();
        assert_eq!(
            route_by_rules("hey shrimp search the web for tauri v2 windows", &s, &t, &sn),
            Route::Command { intent: "search_web".into(), target: "tauri v2 windows".into() }
        );
    }

    #[test]
    fn normalize_drops_punctuation_and_case() {
        assert_eq!(normalize("Hey, Shrimp!  Open  Safari."), "hey shrimp open safari");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add `pub mod router;` to `crates/whimpr-core/src/lib.rs`, then run:

Run: `cargo test -p whimpr-core router`
Expected: FAIL, `cannot find type 'Route' in this scope`.

- [ ] **Step 3: Write minimal implementation**

Above the test module:

```rust
//! Deciding what an utterance is: a command to run, a transform to apply, a
//! snippet to expand, or ordinary dictation.
//!
//! Layer order is the whole design. The wake word gates everything, so an
//! utterance without it can never fire a command. Rules run next because they
//! are instant, offline, and free. Only when the rules find nothing does the
//! caller pay for an LLM. And when nothing at all classifies, the answer is
//! dictation, so a router bug costs the user a stray sentence rather than their
//! words.

use crate::settings::Settings;
use crate::snippets::SnippetStore;
use crate::transforms::{TransformSource, TransformStore};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Command { intent: String, target: String },
    Transform { id: String, body: String, source: TransformSource },
    Snippet { trigger: String },
    Dictate,
}

/// Lowercase, strip punctuation, collapse whitespace. Whisper punctuates
/// unpredictably, so every comparison happens on this form.
pub fn normalize(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Strip the wake word from the front of a normalized utterance, returning the
/// remainder. `None` when the wake word is not there at all.
pub fn strip_wake_word(normalized: &str, wake_word: &str) -> Option<String> {
    let wake = normalize(wake_word);
    if wake.is_empty() {
        return None;
    }
    let rest = normalized.strip_prefix(&wake)?;
    Some(rest.trim().to_string())
}

/// Capitalize the first letter, for an app name spoken in lowercase.
fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

/// The deterministic layer. Instant, offline, no API cost. Returns
/// `Route::Dictate` when nothing matches, which the caller may override by
/// consulting an LLM.
pub fn route_by_rules(
    raw: &str,
    settings: &Settings,
    transforms: &TransformStore,
    snippets: &SnippetStore,
) -> Route {
    if !settings.wake_word_enabled {
        return Route::Dictate;
    }
    let normalized = normalize(raw);
    let Some(rest) = strip_wake_word(&normalized, &settings.wake_word) else {
        return Route::Dictate;
    };
    if rest.is_empty() {
        return Route::Dictate;
    }

    // Transform triggers, longest first so "make this an email" beats "email this".
    let mut triggers: Vec<(&str, &str, TransformSource)> = Vec::new();
    for t in &transforms.entries {
        for trig in &t.triggers {
            triggers.push((t.id.as_str(), trig.as_str(), t.default_source));
        }
    }
    triggers.sort_by_key(|(_, trig, _)| std::cmp::Reverse(trig.len()));
    for (id, trig, source) in &triggers {
        let n = normalize(trig);
        if let Some(body) = rest.strip_prefix(&n) {
            return Route::Transform {
                id: (*id).to_string(),
                body: body.trim().to_string(),
                source: *source,
            };
        }
    }

    // Snippet triggers, longest first.
    let mut snips: Vec<&str> = snippets
        .entries
        .iter()
        .filter(|s| s.enabled)
        .map(|s| s.trigger.as_str())
        .collect();
    snips.sort_by_key(|t| std::cmp::Reverse(t.len()));
    for trig in snips {
        if rest == normalize(trig) {
            return Route::Snippet { trigger: trig.to_string() };
        }
    }

    // System intents.
    if let Some(q) = rest
        .strip_prefix("search the web for ")
        .or_else(|| rest.strip_prefix("search for "))
        .or_else(|| rest.strip_prefix("google "))
    {
        return Route::Command { intent: "search_web".into(), target: q.trim().to_string() };
    }
    if let Some(app) = rest.strip_prefix("open ").or_else(|| rest.strip_prefix("launch ")) {
        let app = app.trim();
        if app.starts_with("http") || app.contains(".com") || app.contains(".ai") {
            return Route::Command { intent: "open_url".into(), target: app.to_string() };
        }
        if !app.is_empty() {
            return Route::Command { intent: "open_app".into(), target: capitalize(app) };
        }
    }
    if let Some(btn) = rest.strip_prefix("click ").or_else(|| rest.strip_prefix("press ")) {
        let btn = btn.trim();
        if !btn.is_empty() {
            return Route::Command { intent: "ui_click".into(), target: capitalize(btn) };
        }
    }
    if rest.starts_with("start recording") || rest.starts_with("record this") {
        return Route::Command { intent: "start_recording".into(), target: String::new() };
    }

    Route::Dictate
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-core router`
Expected: PASS, 9 tests.

- [ ] **Step 5: Re-export and commit**

Add `pub use router::Route;` to `crates/whimpr-core/src/lib.rs`.

```bash
cargo test -p whimpr-core
git add crates/whimpr-core/src/router.rs crates/whimpr-core/src/lib.rs
git commit -m "feat(router): deterministic wake-word, transform, snippet and intent rules"
```

---

### Task 8: Tauri commands for the four stores

**Files:**
- Modify: `src-tauri/src/hotkey.rs:156-170` (path helpers, statics), and add store accessors beside `dictionary_entries` at `:204`
- Modify: `src-tauri/src/lib.rs:98-260` (command fns), `:281-295` (`invoke_handler` list)

**Interfaces:**
- Consumes: every store from Tasks 2-5.
- Produces: Tauri commands `get_scratchpad`, `set_scratchpad_text`, `set_scratchpad_capture`, `get_snippets`, `add_snippet`, `update_snippet`, `remove_snippet`, `get_transforms`, `add_transform`, `update_transform`, `remove_transform`, `get_style`, `add_style_sample`, `remove_style_sample`, `set_style_profile`, `set_style_context`, `remove_style_context`, `set_style_auto_learn`, `accept_pending_style`, `discard_pending_style`.

- [ ] **Step 1: Add the path helpers and statics**

In `src-tauri/src/hotkey.rs`, beside `dict_path()` at line 163:

```rust
    fn snippets_path() -> PathBuf { support_dir().join("snippets.json") }
    fn style_path() -> PathBuf { support_dir().join("style.json") }
    fn transforms_path() -> PathBuf { support_dir().join("transforms.json") }
    fn scratchpad_path() -> PathBuf { support_dir().join("scratchpad.json") }
```

Beside the existing `OnceLock` statics near line 114:

```rust
    static SNIPPETS: OnceLock<Mutex<whimpr_core::SnippetStore>> = OnceLock::new();
    static STYLE: OnceLock<Mutex<whimpr_core::StyleStore>> = OnceLock::new();
    static TRANSFORMS: OnceLock<Mutex<whimpr_core::TransformStore>> = OnceLock::new();
    static SCRATCHPAD: OnceLock<Mutex<whimpr_core::Scratchpad>> = OnceLock::new();
```

- [ ] **Step 2: Add the accessors**

Beside `dictionary_entries()` at line 204, following the same lock-load-save shape the dictionary uses:

```rust
    fn snippets() -> &'static Mutex<whimpr_core::SnippetStore> {
        SNIPPETS.get_or_init(|| Mutex::new(whimpr_core::SnippetStore::load(&snippets_path())))
    }
    fn style() -> &'static Mutex<whimpr_core::StyleStore> {
        STYLE.get_or_init(|| Mutex::new(whimpr_core::StyleStore::load(&style_path())))
    }
    fn transforms() -> &'static Mutex<whimpr_core::TransformStore> {
        TRANSFORMS.get_or_init(|| Mutex::new(whimpr_core::TransformStore::load(&transforms_path())))
    }
    fn scratchpad() -> &'static Mutex<whimpr_core::Scratchpad> {
        SCRATCHPAD.get_or_init(|| Mutex::new(whimpr_core::Scratchpad::load(&scratchpad_path())))
    }

    pub fn snippets_all() -> Vec<whimpr_core::Snippet> { snippets().lock().unwrap().entries.clone() }

    pub fn snippet_add(trigger: String, expansion: String) {
        let mut s = snippets().lock().unwrap();
        s.add(trigger, expansion);
        let _ = s.save(&snippets_path());
    }

    pub fn snippet_update(trigger: String, expansion: String, enabled: bool) {
        let mut s = snippets().lock().unwrap();
        s.update(&trigger, expansion, enabled);
        let _ = s.save(&snippets_path());
    }

    pub fn snippet_remove(trigger: &str) {
        let mut s = snippets().lock().unwrap();
        s.remove(trigger);
        let _ = s.save(&snippets_path());
    }

    pub fn transforms_all() -> Vec<whimpr_core::Transform> {
        transforms().lock().unwrap().entries.clone()
    }

    pub fn transform_add(t: whimpr_core::Transform) {
        let mut s = transforms().lock().unwrap();
        s.add(t);
        let _ = s.save(&transforms_path());
    }

    pub fn transform_update(t: whimpr_core::Transform) {
        let mut s = transforms().lock().unwrap();
        s.update(t);
        let _ = s.save(&transforms_path());
    }

    pub fn transform_remove(id: &str) -> bool {
        let mut s = transforms().lock().unwrap();
        let ok = s.remove(id);
        let _ = s.save(&transforms_path());
        ok
    }

    pub fn scratchpad_get() -> whimpr_core::Scratchpad { scratchpad().lock().unwrap().clone() }

    pub fn scratchpad_set_text(text: String) {
        let mut s = scratchpad().lock().unwrap();
        s.set_text(text);
        let _ = s.save(&scratchpad_path());
    }

    pub fn scratchpad_set_capture(on: bool) {
        let mut s = scratchpad().lock().unwrap();
        s.set_capture(on);
        let _ = s.save(&scratchpad_path());
    }

    pub fn scratchpad_append(block: &str) {
        let mut s = scratchpad().lock().unwrap();
        s.append(block);
        let _ = s.save(&scratchpad_path());
    }

    pub fn style_get() -> whimpr_core::StyleStore { style().lock().unwrap().clone() }

    /// Mutate the style store and persist. Every style command goes through this
    /// so there is exactly one save path.
    pub fn style_mutate(f: impl FnOnce(&mut whimpr_core::StyleStore)) {
        let mut s = style().lock().unwrap();
        f(&mut s);
        let _ = s.save(&style_path());
    }
```

- [ ] **Step 3: Add the Tauri commands**

In `src-tauri/src/lib.rs`, beside the existing dictionary commands:

```rust
#[tauri::command]
fn get_snippets() -> Vec<whimpr_core::Snippet> { hotkey::snippets_all() }

#[tauri::command]
fn add_snippet(trigger: String, expansion: String) { hotkey::snippet_add(trigger, expansion) }

#[tauri::command]
fn update_snippet(trigger: String, expansion: String, enabled: bool) {
    hotkey::snippet_update(trigger, expansion, enabled)
}

#[tauri::command]
fn remove_snippet(trigger: String) { hotkey::snippet_remove(&trigger) }

#[tauri::command]
fn get_transforms() -> Vec<whimpr_core::Transform> { hotkey::transforms_all() }

#[tauri::command]
fn add_transform(transform: whimpr_core::Transform) { hotkey::transform_add(transform) }

#[tauri::command]
fn update_transform(transform: whimpr_core::Transform) { hotkey::transform_update(transform) }

#[tauri::command]
fn remove_transform(id: String) -> bool { hotkey::transform_remove(&id) }

#[tauri::command]
fn get_scratchpad() -> whimpr_core::Scratchpad { hotkey::scratchpad_get() }

#[tauri::command]
fn set_scratchpad_text(text: String) { hotkey::scratchpad_set_text(text) }

#[tauri::command]
fn set_scratchpad_capture(on: bool) { hotkey::scratchpad_set_capture(on) }

#[tauri::command]
fn get_style() -> whimpr_core::StyleStore { hotkey::style_get() }

#[tauri::command]
fn add_style_sample(text: String) {
    hotkey::style_mutate(|s| s.samples.push(text));
}

#[tauri::command]
fn remove_style_sample(index: usize) {
    hotkey::style_mutate(|s| {
        if index < s.samples.len() {
            s.samples.remove(index);
        }
    });
}

#[tauri::command]
fn set_style_profile(profile: whimpr_core::StyleProfile) {
    hotkey::style_mutate(|s| s.base = Some(profile));
}

#[tauri::command]
fn set_style_context(context: whimpr_core::StyleContext) {
    hotkey::style_mutate(|s| s.set_context(context));
}

#[tauri::command]
fn remove_style_context(id: String) {
    hotkey::style_mutate(|s| s.remove_context(&id));
}

#[tauri::command]
fn set_style_auto_learn(on: bool) {
    hotkey::style_mutate(|s| s.auto_learn = on);
}

#[tauri::command]
fn accept_pending_style() { hotkey::style_mutate(|s| s.accept_pending()); }

#[tauri::command]
fn discard_pending_style() { hotkey::style_mutate(|s| s.discard_pending()); }
```

- [ ] **Step 4: Register every command**

Add all twenty names to the `tauri::generate_handler![...]` list at `src-tauri/src/lib.rs:281`.

- [ ] **Step 5: Verify it compiles**

Run: `cargo build -p whimpr 2>&1 | tail -20`
Expected: no errors. A missing entry in `generate_handler!` shows up as an unused-function warning, so check for those too.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/hotkey.rs src-tauri/src/lib.rs
git commit -m "feat(commands): expose snippet, transform, scratchpad and style stores"
```

---

### Task 9: Import the voice-reference dictionary terms

**Files:**
- Create: `scripts/import-voice-terms.sh`
- Test: manual verification against the running app

**Interfaces:**
- Consumes: `add_dictionary_entry` (existing).
- Produces: fifteen entries in `dictionary.json`.

This is section 8 of `references/voice-tone-reference.md`, which is dictionary data rather than style data. Importing it is pure accuracy gain with no new code.

- [ ] **Step 1: Write the script**

Create `scripts/import-voice-terms.sh`:

```bash
#!/usr/bin/env bash
# One-off: seed the dictionary with the terms from the voice reference doc,
# section 8. Safe to re-run — DictionaryStore::add de-duplicates by spelling.
set -euo pipefail

DICT="$HOME/Library/Application Support/dev.whimprflow.app/dictionary.json"
[ -f "$DICT" ] && cp "$DICT" "$DICT.bak"

python3 - "$DICT" <<'PY'
import json, sys, os

path = sys.argv[1]
terms = [
    ("Adriel Reyes", ["Adrial", "Adrielle", "Adriel Reyez"]),
    ("Claude Code", ["Cloud Code"]),
    ("CLAUDE.md", ["claude md"]),
    ("Anthropic", ["Anthropik"]),
    ("Opus", []), ("Sonnet", []), ("Haiku", []),
    ("MCP", ["M C P"]),
    ("NotebookLM", ["Notebook LM"]),
    ("Nano Banana Pro", ["nano banana"]),
    ("Wispr Flow", ["Whisper Flow", "Whimper Flow"]),
    ("Canva", ["Canvas"]),
    ("LinkedIn", ["Linked In"]),
    ("Netlify", ["Net Lify"]),
    ("Gemini", ["Jemini"]),
    ("GST", ["G S T"]),
    ("kanban", ["can ban"]),
]

store = {"entries": []}
if os.path.exists(path):
    with open(path) as f:
        store = json.load(f)

existing = {e["correct"].lower() for e in store.get("entries", [])}
added = 0
for correct, mishears in terms:
    if correct.lower() in existing:
        continue
    store.setdefault("entries", []).append(
        {"correct": correct, "mishears": mishears, "source": "manual"}
    )
    added += 1

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(store, f, indent=2)
print(f"added {added} entries, {len(store['entries'])} total")
PY
```

- [ ] **Step 2: Confirm the support-directory path**

Run: `grep -n "support_dir" -A 4 src-tauri/src/hotkey.rs | head -12`
If the bundle identifier differs from `dev.whimprflow.app`, correct `DICT` in the script to match before running it.

- [ ] **Step 3: Run it**

Run: `chmod +x scripts/import-voice-terms.sh && ./scripts/import-voice-terms.sh`
Expected: `added 17 entries, 17 total` on a fresh install.

- [ ] **Step 4: Verify in the app**

Launch the app, open the Dictionary pane, and confirm the terms are listed.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-voice-terms.sh
git commit -m "chore(dictionary): import the voice reference terms"
```

---

### Task 10: Wire the router into the dictation pipeline

**Files:**
- Modify: `src-tauri/src/hotkey.rs:586-670` (replacing the hardcoded wake-word block and the JSON parse)

**Interfaces:**
- Consumes: `router::route_by_rules` (Task 7), the store accessors (Task 8), `snippets::expand` (Task 2), `StyleStore::resolve` (Task 5).
- Produces: no new public surface. This task replaces existing behavior.

This is the only task that touches the live paste path. Everything it replaces is currently hardcoded.

- [ ] **Step 1: Write the failing test**

Extraction first, so the decision is testable without a microphone. Add to `crates/whimpr-core/src/router.rs`:

```rust
    #[test]
    fn dictation_with_snippets_disabled_is_left_alone() {
        let mut s = Settings::default();
        s.snippets_enabled = false;
        let mut snips = SnippetStore::default();
        snips.add("my signature", "Adriel Reyes");
        assert_eq!(finalize_dictation("send my signature", &s, &snips), "send my signature");
    }

    #[test]
    fn dictation_with_snippets_enabled_expands_them() {
        let s = Settings::default();
        let mut snips = SnippetStore::default();
        snips.add("my signature", "Adriel Reyes");
        assert_eq!(finalize_dictation("send my signature", &s, &snips), "send Adriel Reyes");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p whimpr-core router`
Expected: FAIL, `cannot find function 'finalize_dictation'`.

- [ ] **Step 3: Add the function**

In `crates/whimpr-core/src/router.rs`:

```rust
/// The last step before text is pasted: snippet expansion, when enabled.
/// Runs after cleanup and after `apply_vocab`, so a dictionary correction can
/// produce a trigger.
pub fn finalize_dictation(cleaned: &str, settings: &Settings, snippets: &SnippetStore) -> String {
    if !settings.snippets_enabled {
        return cleaned.to_string();
    }
    crate::snippets::expand(cleaned, snippets)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-core router`
Expected: PASS, 11 tests.

- [ ] **Step 5: Replace the pipeline block**

In `src-tauri/src/hotkey.rs`, delete the block from `let raw_lower = raw.to_lowercase()...` through the end of the `let text = match maybe_parsed {...}` expression (roughly lines 588-666) and replace it with:

```rust
                            let settings = current_settings();
                            let transforms_snapshot = transforms().lock().unwrap().clone();
                            let snippets_snapshot = snippets().lock().unwrap().clone();

                            let route = whimpr_core::router::route_by_rules(
                                &raw,
                                &settings,
                                &transforms_snapshot,
                                &snippets_snapshot,
                            );

                            let text = match route {
                                whimpr_core::Route::Command { intent, target } => {
                                    eprintln!("[whimpr] COMMAND: {intent} -> {target}");
                                    let _ = app2.emit(
                                        "whimpr://flowbar/state",
                                        serde_json::json!({ "state": "command" }),
                                    );
                                    if let Err(e) =
                                        whimpr_core::agentic_os::execute_system_command(&intent, &target)
                                    {
                                        eprintln!("[whimpr] command failed: {e}");
                                    }
                                    std::thread::sleep(std::time::Duration::from_millis(800));
                                    String::new()
                                }
                                whimpr_core::Route::Snippet { trigger } => snippets_snapshot
                                    .entries
                                    .iter()
                                    .find(|s| s.trigger.eq_ignore_ascii_case(&trigger))
                                    .map(|s| s.expansion.clone())
                                    .unwrap_or_default(),
                                whimpr_core::Route::Transform { id, body, source } => {
                                    run_transform(&id, &body, source, &transforms_snapshot)
                                }
                                // `clean_transcript` returns plain text for dictation: it
                                // unwraps the model's JSON envelope internally (see
                                // `cleanup::parse_response`). If the model answers a
                                // dictation with a command envelope anyway, that function
                                // hands the envelope back, so guard against pasting it.
                                whimpr_core::Route::Dictate => {
                                    let cleaned = clean_transcript(
                                        &raw,
                                        if active_app.is_empty() { None } else { Some(active_app.clone()) },
                                        if active_window.is_empty() { None } else { Some(active_window) },
                                    );
                                    // A command envelope on the dictate path means the
                                    // model ignored the route. Paste the raw transcript
                                    // rather than a blob of JSON.
                                    if matches!(
                                        whimpr_core::cleanup::parse_response(&cleaned),
                                        whimpr_core::cleanup::ModelResponse::Command { .. }
                                    ) {
                                        raw.clone()
                                    } else {
                                        whimpr_core::router::finalize_dictation(
                                            &cleaned,
                                            &settings,
                                            &snippets_snapshot,
                                        )
                                    }
                                }
                            };
```

Then, immediately before the existing `if !text.is_empty()` paste block, add the scratchpad diversion:

```rust
                            // Capture mode sends dictation to the scratchpad instead of the
                            // cursor. Commands and snippets still behave normally.
                            if !text.is_empty() && scratchpad_get().capture_mode {
                                scratchpad_append(&text);
                                let _ = app2.emit(
                                    "whimpr://flowbar/state",
                                    serde_json::json!({ "state": "scratchpad" }),
                                );
                                record_dictation(&text, res.duration_secs());
                                finish();
                                return;
                            }
```

- [ ] **Step 6: Add the transform runner**

Beside `clean_transcript` in `src-tauri/src/hotkey.rs`:

```rust
    /// Resolve a transform's input, run it through the active cleanup provider,
    /// and return the result. Returns an empty string on any failure, so a
    /// failed transform pastes nothing rather than pasting a raw prompt.
    fn run_transform(
        id: &str,
        body: &str,
        source: whimpr_core::TransformSource,
        store: &whimpr_core::TransformStore,
    ) -> String {
        let Some(t) = store.get(id) else {
            eprintln!("[whimpr] unknown transform: {id}");
            return String::new();
        };
        let input = match source {
            whimpr_core::TransformSource::Utterance => body.to_string(),
            whimpr_core::TransformSource::Selection => {
                match whimpr_core::agentic_os::get_selected_text() {
                    Ok(Some(s)) => s,
                    _ => {
                        eprintln!("[whimpr] transform {id}: nothing selected");
                        return String::new();
                    }
                }
            }
            whimpr_core::TransformSource::Scratchpad => scratchpad_get().text,
        };
        if input.trim().is_empty() {
            return String::new();
        }
        match crate::local_llm::complete(&t.render(&input)) {
            Ok(out) => out.trim().to_string(),
            Err(e) => {
                eprintln!("[whimpr] transform {id} failed: {e}");
                String::new()
            }
        }
    }
```

If `crate::local_llm` exposes no `complete` function, add one that sends a single user message through the same worker `clean_transcript` already uses, and returns the raw completion without the cleanup gates. Gates measure divergence from a transcript, which is meaningless for a transform.

- [ ] **Step 7: Verify**

Run: `cargo build -p whimpr 2>&1 | tail -20`
Expected: no errors.

Then build and run the app, and verify by hand:
1. Dictate ordinary text. It pastes as before.
2. Say "hey shrimp open Safari". Safari opens, nothing pastes.
3. Add a snippet, then dictate a sentence containing its trigger. It expands.
4. Turn on scratchpad capture mode, dictate, and confirm the text lands in the pad and not at the cursor.

- [ ] **Step 8: Commit**

```bash
git add crates/whimpr-core/src/router.rs src-tauri/src/hotkey.rs
git commit -m "feat(router): replace the hardcoded wake word with the rule router"
```

---

### Task 11: Populate window context from the caret

**Files:**
- Modify: `src-tauri/src/autolearn.rs` (reuse its Accessibility reads), `src-tauri/src/hotkey.rs` (ctx construction in `clean_transcript`)
- Test: manual

**Interfaces:**
- Consumes: the existing Accessibility permission and the `AXUIElement` reads already in `autolearn.rs`.
- Produces: `hotkey::caret_context() -> Option<String>`.

`CleanupContext.window_context` is declared at `cleanup/mod.rs:49` and consumed at `:151`, but nothing populates it. The prompt builder already guards against junk: it requires more than two words and rejects text ending in an ellipsis.

- [ ] **Step 1: Find the existing accessibility read**

Run: `grep -n "AXUIElement\|AXValue\|focused" src-tauri/src/autolearn.rs | head -20`
The post-paste observer already reads the focused element's value. That is the same read this task needs.

- [ ] **Step 2: Add the accessor**

In `src-tauri/src/hotkey.rs`, following whatever accessor `autolearn.rs` uses for the focused element:

```rust
    /// Roughly 200 characters around the caret in the focused text field, for
    /// the cleanup prompt's context block. `None` when there is no text field,
    /// no Accessibility permission, or nothing readable.
    ///
    /// Reference material only. `assemble_user_message` tags it so the model
    /// never reads it as instructions.
    #[cfg(target_os = "macos")]
    pub fn caret_context() -> Option<String> {
        const WINDOW: usize = 200;
        let (value, caret) = crate::autolearn::focused_value_and_caret()?;
        let start = caret.saturating_sub(WINDOW / 2);
        let end = (caret + WINDOW / 2).min(value.len());
        let slice = value.get(start..end)?;
        let trimmed = slice.trim();
        if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn caret_context() -> Option<String> { None }
```

If `autolearn.rs` has no `focused_value_and_caret`, add it there, returning the focused element's `AXValue` string and its `AXSelectedTextRange` location. Keep it `pub(crate)`.

- [ ] **Step 3: Pass it into the context**

In `clean_transcript`, where `CleanupContext` is built, add:

```rust
            window_context: caret_context(),
            style: if settings.style_enabled {
                style().lock().unwrap().resolve(app.as_deref()).cloned()
            } else {
                None
            },
```

- [ ] **Step 4: Verify**

Run: `cargo build -p whimpr 2>&1 | tail -20`
Expected: no errors.

Then run the app with the console visible, put the caret in the middle of an existing paragraph in any text field, dictate a sentence, and confirm the log shows a `WINDOW_CONTEXT` block carrying the surrounding text.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/hotkey.rs src-tauri/src/autolearn.rs
git commit -m "feat(context): populate window context from the caret"
```

---

### Task 12: Style derivation and auto-learn proposals

**Files:**
- Modify: `src-tauri/src/lib.rs` (the `derive_style_profile` command), `src-tauri/src/hotkey.rs` (`record_dictation`)
- Test: inline test in `crates/whimpr-core/src/style.rs`

**Interfaces:**
- Consumes: `StyleStore` (Task 5), `local_llm::complete` (Task 10).
- Produces: Tauri command `derive_style_profile() -> Option<StyleProfile>`; `style::DERIVE_PROMPT`; `style::parse_profile(&str) -> Option<StyleProfile>`.

- [ ] **Step 1: Write the failing test**

Add to the test module in `crates/whimpr-core/src/style.rs`:

```rust
    #[test]
    fn parse_profile_reads_the_model_json() {
        let json = r#"{
            "avg_sentence_words": 11,
            "contractions": true,
            "punctuation_notes": "no em-dashes, commas over semicolons",
            "banned_words": ["game-changer", "leverage"],
            "tone_notes": "Casual and direct, confident without posturing"
        }"#;
        let p = parse_profile(json).expect("must parse");
        assert_eq!(p.avg_sentence_words, 11);
        assert_eq!(p.banned_words.len(), 2);
        assert!(p.derived_at > 0);
    }

    #[test]
    fn parse_profile_survives_a_fenced_response() {
        let fenced = "```json\n{\"avg_sentence_words\":9,\"contractions\":false,\
                      \"punctuation_notes\":\"\",\"banned_words\":[],\"tone_notes\":\"Dry\"}\n```";
        assert_eq!(parse_profile(fenced).unwrap().avg_sentence_words, 9);
    }

    #[test]
    fn parse_profile_rejects_junk() {
        assert!(parse_profile("I'm sorry, I can't do that.").is_none());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p whimpr-core style`
Expected: FAIL, `cannot find function 'parse_profile'`.

- [ ] **Step 3: Write the implementation**

In `crates/whimpr-core/src/style.rs`:

```rust
/// The prompt that turns writing samples into a profile. Asks for constraints,
/// never for example sentences, so nothing from a sample can be echoed back into
/// the user's pasted text later.
pub const DERIVE_PROMPT: &str = "\
Below are writing samples from one person. Describe their writing as constraints \
another writer could follow. Reply with JSON only, no prose, in exactly this shape:

{\"avg_sentence_words\": <integer>, \"contractions\": <true|false>, \
\"punctuation_notes\": \"<short phrase>\", \"banned_words\": [\"<word>\"], \
\"tone_notes\": \"<one or two sentences>\"}

Do not quote or paraphrase any sample. Describe only.

SAMPLES:
{input}";

/// Parse a model response into a profile, tolerating a markdown code fence.
/// Returns `None` for anything that is not the expected JSON.
pub fn parse_profile(response: &str) -> Option<StyleProfile> {
    let start = response.find('{')?;
    let end = response.rfind('}')?;
    let json = response.get(start..=end)?;

    #[derive(Deserialize)]
    struct Raw {
        avg_sentence_words: u32,
        contractions: bool,
        #[serde(default)]
        punctuation_notes: String,
        #[serde(default)]
        banned_words: Vec<String>,
        #[serde(default)]
        tone_notes: String,
    }

    let raw: Raw = serde_json::from_str(json).ok()?;
    Some(StyleProfile {
        avg_sentence_words: raw.avg_sentence_words,
        contractions: raw.contractions,
        punctuation_notes: raw.punctuation_notes,
        banned_words: raw.banned_words,
        tone_notes: raw.tone_notes,
        derived_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(1),
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p whimpr-core style`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the command**

In `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn derive_style_profile() -> Option<whimpr_core::StyleProfile> {
    let samples = hotkey::style_get().samples;
    if samples.is_empty() {
        return None;
    }
    let prompt = whimpr_core::style::DERIVE_PROMPT.replace("{input}", &samples.join("\n\n---\n\n"));
    let response = local_llm::complete(&prompt).ok()?;
    let profile = whimpr_core::style::parse_profile(&response)?;
    let p = profile.clone();
    hotkey::style_mutate(move |s| s.base = Some(p));
    Some(profile)
}
```

Register `derive_style_profile` in `generate_handler!`.

- [ ] **Step 6: Wire the auto-learn counter**

In `record_dictation` in `src-tauri/src/hotkey.rs`, after the stats write:

```rust
        // Auto-learn: count accepted dictations and, every DERIVE_EVERY, propose a
        // re-derived profile. The proposal is never applied without an explicit
        // accept in the Style pane, so the voice cannot drift on its own.
        style_mutate(|s| {
            if !s.auto_learn || s.pending.is_some() {
                return;
            }
            s.dictations_since_derive += 1;
        });
```

The proposal itself is generated by the Style pane calling `derive_style_profile` when the counter reaches `DERIVE_EVERY`, writing to `pending` rather than `base`. Add a second command for that path:

```rust
#[tauri::command]
fn propose_style_profile() -> Option<whimpr_core::StyleProfile> {
    let store = hotkey::style_get();
    let recent: Vec<String> = hotkey::history(50).into_iter().map(|h| h.text).collect();
    if recent.is_empty() {
        return None;
    }
    let _ = store;
    let prompt = whimpr_core::style::DERIVE_PROMPT.replace("{input}", &recent.join("\n\n---\n\n"));
    let response = local_llm::complete(&prompt).ok()?;
    let profile = whimpr_core::style::parse_profile(&response)?;
    let p = profile.clone();
    hotkey::style_mutate(move |s| s.pending = Some(p));
    Some(profile)
}
```

Register it too.

- [ ] **Step 7: Verify**

Run: `cargo build -p whimpr 2>&1 | tail -20`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add crates/whimpr-core/src/style.rs src-tauri/src/lib.rs src-tauri/src/hotkey.rs
git commit -m "feat(style): derive profiles from samples and propose auto-learn updates"
```

---

### Task 13: Seed the style store from the voice reference

**Files:**
- Create: `scripts/import-voice-profile.sh`

**Interfaces:**
- Consumes: the `StyleStore` JSON shape from Task 5.
- Produces: a populated `style.json` with a base profile and five contexts.

`references/voice-tone-reference.md` is already a finished profile. Section 6 gives five registers, which map to contexts.

- [ ] **Step 1: Write the script**

Create `scripts/import-voice-profile.sh`:

```bash
#!/usr/bin/env bash
# Seed style.json from references/voice-tone-reference.md. Overwrites the base
# profile and the five contexts; leaves samples and auto-learn state alone.
set -euo pipefail

STYLE="$HOME/Library/Application Support/dev.whimprflow.app/style.json"
[ -f "$STYLE" ] && cp "$STYLE" "$STYLE.bak"

python3 - "$STYLE" <<'PY'
import json, os, sys, time

path = sys.argv[1]
now = int(time.time())

BANNED = ["game-changer", "revolutionary", "insane", "mind-blowing", "amazing",
          "leverage", "unlock", "just", "really", "actually", "simply",
          "basically", "kind of", "sort of"]

def profile(words, tone):
    return {
        "avg_sentence_words": words,
        "contractions": True,
        "punctuation_notes": "no em-dashes, use a comma or a period instead",
        "banned_words": BANNED,
        "tone_notes": tone,
        "derived_at": now,
    }

store = {}
if os.path.exists(path):
    with open(path) as f:
        store = json.load(f)

store["base"] = profile(
    12,
    "Casual and direct. A person talking, not a brand posting. Lead with the "
    "answer, context after. Confident without guru posturing. No preamble, "
    "no padding, no fake enthusiasm.",
)

store["contexts"] = [
    {
        "id": "linkedin",
        "name": "LinkedIn post",
        "bundle_ids": ["com.google.Chrome", "com.apple.Safari"],
        "profile": profile(
            12,
            "Teaching one usable idea to people learning AI. Concrete tools and "
            "numbers. No influencer cadence, no one-line-per-paragraph drama.",
        ),
    },
    {
        "id": "instagram",
        "name": "Instagram caption",
        "bundle_ids": [],
        "profile": profile(8, "Short, personal, in the moment. The video carries it."),
    },
    {
        "id": "email",
        "name": "Client email",
        "bundle_ids": ["com.apple.mail", "com.microsoft.Outlook"],
        "profile": profile(
            14,
            "Casual-professional. Warm and direct, no fluff, no corporate polish. "
            "Never turn 'I want' into 'I would like to request'.",
        ),
    },
    {
        "id": "job",
        "name": "Job application",
        "bundle_ids": [],
        "profile": profile(
            15, "Professional but still human. No buzzword soup, no self-promotion cliches."
        ),
    },
    {
        "id": "notes",
        "name": "Notes to self",
        "bundle_ids": ["com.apple.Notes", "dev.whimprflow.app"],
        "profile": profile(6, "Fragments are fine. Cut filler, change nothing else."),
    },
]

store.setdefault("samples", [])
store.setdefault("auto_learn", False)
store.setdefault("dictations_since_derive", 0)
store.setdefault("pending", None)

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(store, f, indent=2)
print(f"seeded base profile and {len(store['contexts'])} contexts")
PY
```

- [ ] **Step 2: Run it**

Run: `chmod +x scripts/import-voice-profile.sh && ./scripts/import-voice-profile.sh`
Expected: `seeded base profile and 5 contexts`.

- [ ] **Step 3: Turn styling on and verify**

Launch the app, open Settings, enable style, dictate a rambling sentence into a text field, and confirm the pasted result is shorter and free of the banned filler words. If it pastes raw instead, the gates are still too tight and Task 6's `STYLE_TOLERANCE` needs raising.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-voice-profile.sh
git commit -m "chore(style): seed the profile and contexts from the voice reference"
```

---

## Self-review notes

**Spec coverage.** Settings (Task 1), snippets store and expansion (2, 10), scratchpad (3, 10), transforms (4, 10), style store and contexts (5), style injection and gates (6), router (7, 10), Tauri commands (8), dictionary import (9), window context (11), derivation and auto-learn (12), voice-reference seed (13). The four React panes are covered by the separate UI handoff at `docs/superpowers/specs/2026-09-04-gemini-ui-handoff.md` and are not tasks here.

**Interfaces.** `TransformSource` is defined once in Task 4 and referenced by Tasks 7, 8, and 10 under that name. `StyleProfile` is defined in Task 5 and consumed unchanged in 6, 8, 12, and 13. `expand` (Task 2) is called only through `finalize_dictation` (Task 10).

**Known follow-ups, not defects.** Task 10 assumes `local_llm::complete` exists or is added in that task; the step says so explicitly. Task 11 assumes `autolearn.rs` exposes a focused-element read, and says to add one if it does not.
