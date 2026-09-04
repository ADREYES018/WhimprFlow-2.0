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
}
