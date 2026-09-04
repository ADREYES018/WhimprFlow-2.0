use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Template {
    #[default]
    General,
    Standup,
    OneOnOne,
    Interview,
    Lecture,
}

pub fn write_notes(_model: &Path, transcript: &str, template: Template) -> Result<String, String> {
    Ok(format!("# Notes\n\nTemplate: {:?}\n\n{}", template, transcript))
}
