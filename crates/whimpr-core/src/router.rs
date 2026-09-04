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
        if let Some(_) = rest.strip_prefix(&n) {
            // Extract body from the original text preserving case.
            // Count how many words the wake word + trigger consume in
            // normalized space, then skip that many in the original.
            let wake_words = normalize(&settings.wake_word).split_whitespace().count();
            let trig_words = n.split_whitespace().count();
            let skip = wake_words + trig_words;
            let original_words: Vec<&str> = raw.split_whitespace().collect();
            let body = if skip < original_words.len() {
                original_words[skip..].join(" ")
            } else {
                String::new()
            };
            return Route::Transform {
                id: (*id).to_string(),
                body,
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

/// The last step before text is pasted: snippet expansion, when enabled.
/// Runs after cleanup and after `apply_vocab`, so a dictionary correction can
/// produce a trigger.
pub fn finalize_dictation(cleaned: &str, settings: &Settings, snippets: &SnippetStore) -> String {
    if !settings.snippets_enabled {
        return cleaned.to_string();
    }
    crate::snippets::expand(cleaned, snippets)
}

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

    #[test]
    fn start_recording_intent_routes_to_command() {
        let (s, t, sn) = fixtures();
        assert_eq!(
            route_by_rules("hey shrimp start recording", &s, &t, &sn),
            Route::Command { intent: "start_recording".into(), target: String::new() }
        );
        assert_eq!(
            route_by_rules("hey shrimp record this", &s, &t, &sn),
            Route::Command { intent: "start_recording".into(), target: String::new() }
        );
    }
}
