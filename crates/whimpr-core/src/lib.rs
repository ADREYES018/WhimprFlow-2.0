//! `whimpr-core` — the platform-agnostic brain of WhimprFlow.
//!
//! Everything here is shared verbatim between macOS and Windows. Native concerns
//! (the hotkey hook, text injection, accessibility reads) live in the sidecar; the
//! ASR and cleanup-LLM implementations live in their own crates and plug in behind
//! the [`asr`] and [`cleanup`] trait seams defined here.
//!
//! What is implemented so far (M0/M1 foundation): the dictation [`state`] machine.
//! Subsequent milestones fill in the audio pipeline, ASR/cleanup traits, dictionary,
//! settings, and storage modules.

pub mod asr;
pub mod cleanup;
pub mod diagnostics;
pub mod dictionary;
pub mod gpu_gate;
pub mod local_llm;
pub mod router;
pub mod scratchpad;
pub mod settings;
pub mod snippets;
pub mod state;
pub mod stats;
pub mod style;
pub mod transforms;
pub mod types;

pub use asr::{AsrEngine, AsrEngineId, Transcript};
pub use cleanup::{CleanupContext, CleanupLevel, CleanupProvider, ProviderId, VocabEntry};
pub use diagnostics::{Diagnostic, InjectionFailure, Platform};
pub use dictionary::{DictSource, DictionaryEntry, DictionaryStore};
pub use router::Route;
pub use scratchpad::Scratchpad;
pub use settings::{CleanupMode, Settings};
pub use snippets::{Snippet, SnippetStore};
pub use stats::{HistoryItem, SessionRecord, StatsStore, StatsSummary};
pub use style::{StyleContext, StyleProfile, StyleStore};
pub use transforms::{Transform, TransformSource, TransformStore};
pub use state::{Action, BarState, DictationState, Input, PipelineEvent, StateMachine, TriggerToken};
pub use types::{RecordMode, SessionId};
pub mod agentic_os;
