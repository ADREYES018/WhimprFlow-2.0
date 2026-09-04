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
