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
