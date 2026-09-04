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
