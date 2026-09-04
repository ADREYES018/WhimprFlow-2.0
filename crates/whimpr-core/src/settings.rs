//! User settings, persisted as JSON. Drives the cleanup engine (which provider,
//! how aggressive) and other behavior. Kept dependency-light so it lives in core.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cleanup::CleanupLevel;

/// Which cleanup engine processes transcripts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CleanupMode {
    /// Paste the raw transcript (no cleanup).
    Raw,
    /// Local on-device model (default: works offline, no API key).
    #[default]
    Local,
    /// OpenAI cloud.
    OpenAi,
    /// Anthropic cloud.
    Anthropic,
}

fn default_openai_model() -> String { "gpt-4o-mini".to_string() }
fn default_anthropic_model() -> String { "claude-haiku-4-5".to_string() }
fn default_trigger_key() -> String { "Option + Space".to_string() }
fn default_trigger_mode() -> String { "hold".to_string() }
fn default_whisper_model() -> String { "auto".to_string() }
fn default_local_model() -> String { "auto".to_string() }
fn default_wake_word() -> String { "hey shrimp".to_string() }
fn default_true() -> bool { true }
fn default_command_provider() -> String { "auto".to_string() }
fn default_chunk_seconds() -> u32 { 30 }
fn default_followup_style() -> String { "brief".to_string() }

/// Persisted user configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub cleanup_mode: CleanupMode,
    #[serde(default)]
    pub cleanup_level: CleanupLevel,
    #[serde(default = "default_openai_model")]
    pub openai_model: String,
    /// API root for the "OpenAI" cleanup mode, e.g. `https://openrouter.ai/api/v1`
    /// to route through OpenRouter instead of OpenAI directly (same wire format).
    /// Empty string (the default) means OpenAI's own endpoint.
    #[serde(default)]
    pub openai_base_url: String,
    #[serde(default = "default_anthropic_model")]
    pub anthropic_model: String,
    /// Play the record-start ping.
    #[serde(default = "default_true")]
    pub sound_on_start: bool,
    /// The hotkey used to trigger recording (e.g. "Fn", "Left Control", "Right Alt")
    #[serde(default = "default_trigger_key")]
    pub trigger_key: String,
    #[serde(default = "default_trigger_mode")]
    pub trigger_mode: String,
    /// The ASR model file to use (e.g. "ggml-small.en.bin"). "auto" picks the largest available.
    #[serde(default = "default_whisper_model")]
    pub whisper_model: String,
    #[serde(default = "default_local_model")]
    pub local_model: String,
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

    // Merged Oatmeal settings
    #[serde(default, alias = "displayName")]
    pub display_name: String,
    #[serde(default)]
    pub language: String,
    #[serde(default = "default_followup_style", alias = "followupStyle")]
    pub followup_style: String,
    #[serde(default, alias = "followupCustom")]
    pub followup_custom: String,
    #[serde(default = "default_chunk_seconds", alias = "chunkSeconds")]
    pub chunk_seconds: u32,
    #[serde(default = "default_true", alias = "micEnabled")]
    pub mic_enabled: bool,

    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            cleanup_mode: CleanupMode::default(),
            cleanup_level: CleanupLevel::Light,
            openai_model: default_openai_model(),
            openai_base_url: String::new(),
            anthropic_model: default_anthropic_model(),
            sound_on_start: true,
            trigger_key: default_trigger_key(),
            trigger_mode: default_trigger_mode(),
            whisper_model: default_whisper_model(),
            local_model: default_local_model(),
            wake_word: default_wake_word(),
            wake_word_enabled: true,
            command_provider: default_command_provider(),
            style_enabled: false,
            snippets_enabled: true,
            display_name: String::new(),
            language: String::new(),
            followup_style: default_followup_style(),
            followup_custom: String::new(),
            chunk_seconds: default_chunk_seconds(),
            mic_enabled: true,
            extra: HashMap::new(),
        }
    }
}

impl Settings {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let s = Settings::default();
        assert_eq!(s.cleanup_mode, CleanupMode::Local);
        assert_eq!(s.cleanup_level, CleanupLevel::Light);
        assert_eq!(s.chunk_seconds, 30);
        assert!(s.mic_enabled);
    }

    #[test]
    fn round_trips_json() {
        let s = Settings {
            cleanup_mode: CleanupMode::Local,
            ..Default::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.cleanup_mode, CleanupMode::Local);
    }

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

    #[test]
    fn preserves_unknown_keys_across_roundtrip() {
        let text = r#"{
            "cleanup_mode": "local",
            "some_custom_future_key": "custom_value"
        }"#;
        let s: Settings = serde_json::from_str(text).unwrap();
        let serialized = serde_json::to_string(&s).unwrap();
        assert!(serialized.contains("some_custom_future_key"));
        assert!(serialized.contains("custom_value"));
    }
}
