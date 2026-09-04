//! Hold-Fn → pill wiring for the demo shell.
//!
//! This installs an in-process CoreGraphics event tap that feeds Fn key-down /
//! key-up into the real [`whimpr_core`] dictation state machine, and turns the
//! machine's actions into `whimpr://flowbar/state` events the overlay pill
//! renders. There is no audio or ASR yet, so a finalized session is simulated as
//! completing shortly after key release — enough to see the full
//! recording → transcribing → done → idle loop driven by the actual state machine.
//!
//! In the shipping product this hook lives in a separate sidecar process (so heavy
//! inference can't stall it); running it in-process is an acceptable macOS-only
//! path for this demo and the early milestones.

/// Dictionary entry shape sent to the Hub UI (auto-learned entries flagged).
#[derive(Clone, serde::Serialize)]
pub struct DictEntryDto {
    pub correct: String,
    pub mishears: Vec<String>,
    pub auto: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use std::os::raw::c_void;
    use std::path::PathBuf;
    use super::DictEntryDto;
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use whimpr_core::state::{Action, BarState};
    use whimpr_core::{
        AsrEngine, CleanupContext, CleanupMode, CleanupProvider, Input, PipelineEvent, StateMachine,
        TriggerToken,
    };
    use whimpr_ipc::BindingId;

    const OVERLAY_LABEL: &str = "whimpr_bar";

    // --- CoreGraphics / CoreFoundation FFI (listen-only Fn tap) -----------
    type CFMachPortRef = *mut c_void;
    type CFRunLoopSourceRef = *mut c_void;
    type CFRunLoopRef = *mut c_void;
    type CFStringRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CGEventRef = *mut c_void;
    type CGEventTapProxy = *mut c_void;
    type CGEventTapCallBack =
        extern "C" fn(CGEventTapProxy, u32, CGEventRef, *mut c_void) -> CGEventRef;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            events_of_interest: u64,
            callback: CGEventTapCallBack,
            user_info: *mut c_void,
        ) -> CFMachPortRef;
        fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
        fn CGEventGetFlags(event: CGEventRef) -> u64;
        fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFMachPortCreateRunLoopSource(
            allocator: CFAllocatorRef,
            port: CFMachPortRef,
            order: isize,
        ) -> CFRunLoopSourceRef;
        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
        fn CFRunLoopRun();
        static kCFRunLoopDefaultMode: CFStringRef;
    }

    const K_CG_SESSION_EVENT_TAP: u32 = 1;
    const K_CG_HEAD_INSERT: u32 = 0;
    const K_CG_TAP_OPTION_LISTEN_ONLY: u32 = 1;
    const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;
    const K_CG_EVENT_KEY_DOWN: u32 = 10;
    const K_CG_EVENT_KEY_UP: u32 = 11;
    const EVENTS_OF_INTEREST: u64 = (1 << K_CG_EVENT_FLAGS_CHANGED) | (1 << K_CG_EVENT_KEY_DOWN) | (1 << K_CG_EVENT_KEY_UP);
    const FLAG_OPTION: u64 = 0x0008_0000;
    const FLAG_SECONDARY_FN: u64 = 0x0080_0000;
    const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
    const K_CG_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const K_CG_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static MACHINE: OnceLock<Mutex<StateMachine>> = OnceLock::new();
    static CLOCK: OnceLock<Instant> = OnceLock::new();
    static FN_IS_DOWN: AtomicBool = AtomicBool::new(false);
    static TRIGGER_MODIFIERS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0x0008_0000);
    static TRIGGER_KEYCODE: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(49);
    static TRIGGER_MODE_IS_TOGGLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    static TOGGLE_STATE_IS_RECORDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    static TAP_PORT: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
    /// Set once at startup if no Whisper model file exists on disk at all —
    /// distinct from "still loading", so the finalize path only shows the
    /// user a loud "no speech model" error for the real case, not a race
    /// against the ~1s background load right after launch.
    static ASR_MODEL_MISSING: AtomicBool = AtomicBool::new(false);
    /// Bundle id of the app that was frontmost at record-start = the paste target.
    /// Cleanup uses it to format for the medium (email vs. text vs. chat).
    static TARGET_APP: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    static CAPTURE: OnceLock<Mutex<Option<whimpr_audio::CaptureHandle>>> = OnceLock::new();
    static ASR: OnceLock<Arc<whimpr_asr::WhisperEngine>> = OnceLock::new();
    static OPENAI: OnceLock<Mutex<Option<whimpr_cleanup::OpenAiProvider>>> = OnceLock::new();
    static ANTHROPIC: OnceLock<Mutex<Option<whimpr_cleanup::AnthropicProvider>>> = OnceLock::new();
    static LOCAL: OnceLock<Mutex<Option<crate::local_llm::LocalWorker>>> = OnceLock::new();
    static SETTINGS: OnceLock<Mutex<whimpr_core::Settings>> = OnceLock::new();
    static DICTIONARY: OnceLock<Mutex<whimpr_core::DictionaryStore>> = OnceLock::new();
    static STATS: OnceLock<Mutex<whimpr_core::StatsStore>> = OnceLock::new();
    static SNIPPETS: OnceLock<Mutex<whimpr_core::SnippetStore>> = OnceLock::new();
    static STYLE: OnceLock<Mutex<whimpr_core::StyleStore>> = OnceLock::new();
    static TRANSFORMS: OnceLock<Mutex<whimpr_core::TransformStore>> = OnceLock::new();
    static SCRATCHPAD: OnceLock<Mutex<whimpr_core::Scratchpad>> = OnceLock::new();

    #[derive(Clone, Serialize)]
    struct BarPayload {
        state: &'static str,
    }

    #[derive(Clone, Serialize)]
    struct WavePayload {
        bars: Vec<f32>,
    }

    #[derive(Clone, Serialize)]
    struct TranscriptPayload {
        text: String,
    }

    /// The whisper ASR model to load: prefer the most accurate one present, in
    /// descending quality order, falling back to the small base model. Bigger
    /// English models mis-hear names/technical terms far less (and better ASR means
    /// less for cleanup and the dictionary to fix downstream).
    fn model_path() -> PathBuf {
        let dir = support_dir().join("models");
        for name in [
            "ggml-large-v3-turbo.bin",
            "ggml-medium.en.bin",
            "ggml-small.en.bin",
            "ggml-base.en.bin",
        ] {
            let p = dir.join(name);
            if p.exists() {
                return p;
            }
        }
        dir.join("ggml-base.en.bin")
    }

    fn support_dir() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support/WhimprFlow")
    }
    fn settings_path() -> PathBuf {
        support_dir().join("settings.json")
    }
    fn dict_path() -> PathBuf {
        support_dir().join("dictionary.json")
    }
    fn stats_path() -> PathBuf {
        support_dir().join("stats.json")
    }
    fn snippets_path() -> PathBuf { support_dir().join("snippets.json") }
    fn style_path() -> PathBuf { support_dir().join("style.json") }
    fn transforms_path() -> PathBuf { support_dir().join("transforms.json") }
    fn scratchpad_path() -> PathBuf { support_dir().join("scratchpad.json") }

    /// Seconds since the Unix epoch (UTC), or 0 if the clock is before the epoch.
    fn unix_now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    /// Log one completed dictation to the stats store (words, speaking time, text,
    /// target app) and persist it. Powers both the Hub stats and the history list.
    pub fn record_dictation(text: &str, duration_secs: f32) {
        let words = whimpr_core::stats::count_words(text);
        if words == 0 {
            return;
        }
        let app = TARGET_APP.get().and_then(|m| m.lock().unwrap().clone());
        if let Some(m) = STATS.get() {
            let mut store = m.lock().unwrap();
            let duration_ms = (duration_secs.max(0.0) * 1000.0) as u32;
            let chars = text.chars().count() as u32;
            store.record(words, duration_ms, chars, unix_now(), text.to_string(), app);
            let _ = store.save(&stats_path());
        }
    }

    /// The most recent dictations for the Hub Home history list.
    pub fn history(limit: usize) -> Vec<whimpr_core::HistoryItem> {
        STATS
            .get()
            .map(|m| m.lock().unwrap().history(limit))
            .unwrap_or_default()
    }

    /// The dictionary entries for the Hub Dictionary screen (auto-learned flagged).
    pub fn dictionary_entries() -> Vec<DictEntryDto> {
        DICTIONARY
            .get()
            .map(|m| {
                m.lock()
                    .unwrap()
                    .entries
                    .iter()
                    .map(|e| DictEntryDto {
                        correct: e.correct.clone(),
                        mishears: e.mishears.clone(),
                        auto: matches!(e.source, whimpr_core::DictSource::Auto),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn snippets() -> &'static Mutex<whimpr_core::SnippetStore> {
        SNIPPETS.get_or_init(|| Mutex::new(whimpr_core::SnippetStore::load(&snippets_path())))
    }

    pub fn local_worker() -> &'static Mutex<Option<crate::local_llm::LocalWorker>> {
        LOCAL.get_or_init(|| Mutex::new(None))
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

    #[allow(dead_code)]
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

    /// Add a manual dictionary entry and persist.
    pub fn dictionary_add(correct: String, mishears: Vec<String>) {
        if let Some(m) = DICTIONARY.get() {
            let mut store = m.lock().unwrap();
            store.add(correct, mishears, whimpr_core::DictSource::Manual);
            let _ = store.save(&dict_path());
        }
    }

    /// Remove a dictionary entry by spelling and persist.
    pub fn dictionary_remove(correct: &str) {
        if let Some(m) = DICTIONARY.get() {
            let mut store = m.lock().unwrap();
            if store.remove(correct) {
                let _ = store.save(&dict_path());
            }
        }
    }

    /// Add an AUTO-learned entry (from the post-paste correction observer) and persist.
    /// Marked ✨ auto in the UI. No-op if it would duplicate an existing entry's data.
    pub fn dictionary_learn(correct: String, mishears: Vec<String>) {
        if let Some(m) = DICTIONARY.get() {
            let mut store = m.lock().unwrap();
            store.add(correct, mishears, whimpr_core::DictSource::Auto);
            let _ = store.save(&dict_path());
        }
    }

    /// Aggregated stats for the Hub. `tz_offset_minutes` is the UI's
    /// `Date.getTimezoneOffset()` so day math matches the user's local clock.
    pub fn stats_summary(tz_offset_minutes: i32) -> whimpr_core::StatsSummary {
        STATS
            .get()
            .map(|m| m.lock().unwrap().summary(tz_offset_minutes, unix_now()))
            .unwrap_or_else(|| {
                whimpr_core::StatsStore::default().summary(tz_offset_minutes, unix_now())
            })
    }

    /// Read an API key from an env var or the OS keychain (never a plaintext file).
    fn read_key(account: &str, env_var: &str) -> Option<String> {
        if let Ok(k) = std::env::var(env_var) {
            let k = k.trim().to_string();
            if !k.is_empty() {
                return Some(k);
            }
        }
        keyring::Entry::new("com.whimpr.whimprflow", account)
            .ok()
            .and_then(|e| e.get_password().ok())
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
    }
    fn read_openai_key() -> Option<String> {
        read_key("openai_api_key", "OPENAI_API_KEY")
    }
    fn read_anthropic_key() -> Option<String> {
        read_key("anthropic_api_key", "ANTHROPIC_API_KEY")
    }

    /// A snapshot of the current settings.
    pub fn current_settings() -> whimpr_core::Settings {
        SETTINGS
            .get()
            .map(|m| m.lock().unwrap().clone())
            .unwrap_or_default()
    }
    /// Apply new settings and rebuild the cloud providers (picks up model changes).

    fn parse_hotkey(key: &str) -> (u64, i64) {
        let mut mods = 0;
        if key.contains("Option") || key.contains("Alt") { mods |= FLAG_OPTION; }
        if key.contains("Command") || key.contains("Cmd") || key.contains("Meta") { mods |= 0x0010_0000; }
        if key.contains("Control") || key.contains("Ctrl") { mods |= 0x0004_0000; }
        if key.contains("Shift") { mods |= 0x0002_0000; }
        if key.contains("Fn") { mods |= FLAG_SECONDARY_FN; }

        let code = if key.contains("Space") { 49 }
            else if key.contains("Fn") && mods == FLAG_SECONDARY_FN { 63 }
            else if key.contains("Enter") { 36 }
            else { 49 }; // basic fallback
        (mods, code)
    }

    pub fn update_settings(new: whimpr_core::Settings) {
        let (m, c) = parse_hotkey(&new.trigger_key);
        TRIGGER_MODIFIERS.store(m, Ordering::SeqCst);
        TRIGGER_KEYCODE.store(c, Ordering::SeqCst);
        TRIGGER_MODE_IS_TOGGLE.store(new.trigger_mode == "toggle", Ordering::SeqCst);

        if let Some(m) = SETTINGS.get() {
            *m.lock().unwrap() = new.clone();
        }
        let _ = new.save(&settings_path());
        rebuild_providers();
    }

    /// (Re)build the cloud cleanup providers from the current keys + settings. Called
    /// at startup and whenever a key or model changes, so edits take effect live.
    pub fn rebuild_providers() {
        let settings = current_settings();
        let openai = read_openai_key().map(|k| {
            whimpr_cleanup::OpenAiProvider::with_base_url(
                k,
                settings.openai_model.clone(),
                Some(settings.openai_base_url.clone()),
            )
        });
        let anthropic = read_anthropic_key()
            .map(|k| whimpr_cleanup::AnthropicProvider::new(k, settings.anthropic_model.clone()));
        eprintln!(
            "[whimpr] cleanup providers: openai={}, anthropic={}",
            openai.is_some(),
            anthropic.is_some()
        );
        match OPENAI.get() {
            Some(m) => *m.lock().unwrap() = openai,
            None => {
                let _ = OPENAI.set(Mutex::new(openai));
            }
        }
        match ANTHROPIC.get() {
            Some(m) => *m.lock().unwrap() = anthropic,
            None => {
                let _ = ANTHROPIC.set(Mutex::new(anthropic));
            }
        }
    }
    /// Roughly 200 characters around the caret in the focused text field, for
    /// the cleanup prompt's context block. `None` when there is no text field,
    /// no Accessibility permission, or nothing readable.
    ///
    /// Reference material only. `assemble_user_message` tags it so the model
    /// never reads it as instructions.
    #[cfg(target_os = "macos")]
    fn caret_context() -> Option<String> {
        const WINDOW: usize = 200;
        let (value, caret) = crate::autolearn::focused_value_and_caret()?;
        let start = caret.saturating_sub(WINDOW / 2);
        let end = (caret + WINDOW / 2).min(value.len());
        let slice = value.get(start..end)?;
        let trimmed = slice.trim();
        if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
    }

    #[cfg(not(target_os = "macos"))]
    fn caret_context() -> Option<String> { None }

    /// Clean a raw transcript per the current settings (mode + level), feeding in the
    /// dictionary vocabulary relevant to this utterance. Falls back to raw whenever
    /// cleanup is off, the provider is unavailable, it errors, or the gates reject it.
    fn clean_transcript(raw: &str, active_app: Option<String>, active_window: Option<String>) -> String {
        let settings = current_settings();
        let level = settings.cleanup_level;
        if matches!(settings.cleanup_mode, CleanupMode::Raw) || level.bypasses_llm() {
            return raw.to_string();
        }
        // Turn explicit spoken layout cues ("new line", "new paragraph") into break
        // markers up front — the model passes an opaque marker through reliably but
        // mangles the literal cue words. The model sees `raw` (with markers); the gate
        // and any raw fallback use `raw_out` (markers restored to real breaks) so we
        // never paste a "[[NL]]" token or lose an explicit break.
        let raw_norm = whimpr_core::cleanup::pre_normalize_layout(raw);
        let raw = raw_norm.as_str();
        let vocab = DICTIONARY
            .get()
            .map(|d| d.lock().unwrap().prefilter(raw, 15))
            .unwrap_or_default();
        // Apply the dictionary to the raw fallback as well. Every path below can
        // paste `raw_out` — cleanup off, no API key, model not loaded, provider
        // error, gate rejection — and before this the dictionary was silently
        // dropped on all of them. Correcting both sides also keeps a legitimate
        // spelling fix from counting as novelty and tripping the gate.
        let raw_out = whimpr_core::cleanup::apply_vocab(
            &whimpr_core::cleanup::post_process(&raw_norm),
            &vocab,
        );
        let app_bundle_id = TARGET_APP.get().and_then(|m| m.lock().unwrap().clone());
        if let Some(app) = app_bundle_id.as_deref() {
            eprintln!("[whimpr] cleanup target app: {app}");
        }
        let settings = current_settings();
        let style_profile = if settings.style_enabled {
            style().lock().unwrap().resolve(app_bundle_id.as_deref()).cloned()
        } else {
            None
        };
        let ctx = CleanupContext {
            level,
            vocab: vocab.clone(),
            app_bundle_id,
            active_app_name: active_app,
            active_window_title: active_window,
            window_context: caret_context(),
            style: style_profile,
        };
        // Run the on-device model with the same prompt + per-app formatting.
        let run_local = || -> Option<anyhow::Result<String>> {
            LOCAL.get().and_then(|m| {
                m.lock().unwrap().as_mut().map(|w| {
                    // System prompt + few-shot demonstration turns + the transcript,
                    // so the on-device model actually produces newlines/lists and
                    // resolves self-corrections instead of just being told to.
                    let messages = whimpr_core::cleanup::build_messages(raw, &ctx);
                    w.cleanup(&messages)
                })
            })
        };
        // Selected provider, falling back to local when a cloud key is missing or when the API errors
        let try_cloud_with_local_fallback = |cloud_opt: Option<anyhow::Result<String>>| -> Option<anyhow::Result<String>> {
            match cloud_opt {
                Some(Ok(text)) => Some(Ok(text)),
                Some(Err(e)) => {
                    eprintln!("[whimpr] cloud cleanup error ({e}), falling back to local model");
                    run_local()
                }
                None => run_local(),
            }
        };

        let result: Option<anyhow::Result<String>> = match settings.cleanup_mode {
            CleanupMode::OpenAi => try_cloud_with_local_fallback(
                OPENAI.get().and_then(|m| m.lock().unwrap().as_ref().map(|p| p.cleanup(raw, &ctx)))
            ),
            CleanupMode::Anthropic => try_cloud_with_local_fallback(
                ANTHROPIC.get().and_then(|m| m.lock().unwrap().as_ref().map(|p| p.cleanup(raw, &ctx)))
            ),
            CleanupMode::Local => run_local(),
            CleanupMode::Raw => None,
        };
        match result {
            Some(Ok(cleaned)) => {
                // Every response is a JSON envelope now, dictation included. Unwrap it
                // BEFORE post-processing and gating: gating the envelope compares a
                // sentence against JSON braces, which always diverges far enough to be
                // rejected, so cleanup silently never applied.
                match whimpr_core::cleanup::parse_response(&cleaned) {
                    // A command is dispatched by the caller, never pasted, so it skips
                    // the gates entirely. Hand the envelope back untouched.
                    whimpr_core::cleanup::ModelResponse::Command { .. } => cleaned,
                    whimpr_core::cleanup::ModelResponse::Dictate(text) => {
                        // Deterministic safety net: convert any leftover spoken layout cue
                        // the model missed into real line breaks, strip stray code fences,
                        // cap blank lines. Guarantees no "new line"/"new paragraph" word
                        // reaches the cursor.
                        let text = whimpr_core::cleanup::apply_vocab(
                            &whimpr_core::cleanup::post_process(&text),
                            &vocab,
                        );
                        if whimpr_core::cleanup::evaluate_gates(&raw_out, &text, level, settings.style_enabled).passed() {
                            text
                        } else {
                            eprintln!("[whimpr] cleanup gate rejected the edit — pasting raw");
                            raw_out
                        }
                    }
                }
            }
            Some(Err(e)) => {
                eprintln!("[whimpr] cleanup failed ({e}) — pasting raw");
                raw_out
            }
            None => {
                if matches!(settings.cleanup_mode, CleanupMode::Local) {
                    eprintln!("[whimpr] local cleanup model not wired yet — pasting raw");
                } else {
                    eprintln!("[whimpr] cleanup provider has no API key — pasting raw");
                }
                raw_out
            }
        }
    }

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

    fn now_ms() -> u64 {
        CLOCK.get().map(|c| c.elapsed().as_millis() as u64).unwrap_or(0)
    }

    fn bar_name(b: BarState) -> &'static str {
        match b {
            BarState::Idle => "idle",
            BarState::Recording => "recording",
            BarState::Locked => "locked",
            BarState::Transcribing => "transcribing",
            BarState::Done => "done",
            BarState::Cancelled => "cancelled",
            BarState::Error => "error",
        }
    }

    fn emit_bar(app: &AppHandle, state: &'static str) {
        eprintln!("[whimpr] pill -> {state}");
        if matches!(state, "idle" | "done" | "cancelled" | "error") {
            TOGGLE_STATE_IS_RECORDING.store(false, Ordering::SeqCst);
        }
        let _ = app.emit_to(OVERLAY_LABEL, "whimpr://flowbar/state", BarPayload { state });
    }

    /// Feed one input into the shared state machine and enact its actions.
    fn handle_input(input: Input) {
        let (Some(app), Some(machine)) = (APP.get(), MACHINE.get()) else {
            return;
        };
        let actions = {
            let mut m = machine.lock().unwrap();
            m.step(input)
        };
        for action in actions {
            apply_action(app, action);
        }
    }

    fn apply_action(app: &AppHandle, action: Action) {
        match action {
            Action::ShowBar(bar) => {
                emit_bar(app, bar_name(bar));
                // Let the "done" tick linger briefly before returning to idle.
                if bar == BarState::Done {
                    let app2 = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(500));
                        emit_bar(&app2, "idle");
                    });
                }
            }
            // Start the microphone; stream real RMS bars to the pill waveform.
            // Runs off the tap thread so the mic-permission prompt can't stall keys.
            Action::StartCapture { .. } => {
                let app_thread = app.clone();
                std::thread::spawn(move || {
                    let app_cb = app_thread.clone();
                    match whimpr_audio::start(move |bars| {
                        let _ = app_cb.emit_to(
                            OVERLAY_LABEL,
                            "whimpr://audio/waveform",
                            WavePayload { bars: bars.to_vec() },
                        );
                    }) {
                        Ok(handle) => {
                            *CAPTURE.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(handle);
                        }
                        Err(e) => eprintln!("[whimpr] mic capture failed to start: {e}"),
                    }
                });
            }
            // Stop the mic, transcribe the buffered audio, and advance the machine.
            Action::StopCaptureAndFinalize { session } => {
                let app2 = app.clone();
                let handle = CAPTURE.get().and_then(|slot| slot.lock().unwrap().take());
                std::thread::spawn(move || {
                    // Whatever happens, return the pill to idle (done -> idle).
                    let finish =
                        || handle_input(Input::Pipeline(PipelineEvent::Committed { session }));
                    let Some(res) = handle.and_then(|h| h.stop()) else {
                        eprintln!("[whimpr] no audio captured");
                        finish();
                        return;
                    };
                    let peak = res.samples.iter().fold(0f32, |m, &s| m.max(s.abs()));
                    eprintln!(
                        "[whimpr] captured {} samples @ {} Hz (~{:.2}s), peak {:.4}",
                        res.samples.len(),
                        res.sample_rate,
                        res.duration_secs(),
                        peak
                    );
                    // Below ~600ms is very likely an accidental brief tap (the SPEC's
                    // own single-tap-no-op gate), so don't alarm the user over it —
                    // only surface a loud diagnostic for holds long enough to be a
                    // real, intentional dictation attempt.
                    let was_real_attempt = res.duration_secs() >= 0.6;
                    if peak < 0.005 {
                        eprintln!(
                            "[whimpr] ⚠ audio is silent — the mic isn't being captured. Grant \
                             Microphone access to your terminal (System Settings → Privacy & \
                             Security → Microphone), then fully quit + reopen it and rerun."
                        );
                        if was_real_attempt {
                            crate::diag::report(
                                &app2,
                                whimpr_core::InjectionFailure::NoAudioCaptured,
                            );
                        }
                        finish();
                        return;
                    }
                    let Some(asr) = ASR.get().cloned() else {
                        eprintln!("[whimpr] ASR not ready (model still loading or missing)");
                        if was_real_attempt && ASR_MODEL_MISSING.load(Ordering::SeqCst) {
                            crate::diag::report(&app2, whimpr_core::InjectionFailure::AsrUnavailable);
                        }
                        finish();
                        return;
                    };
                    let pcm = whimpr_audio::resample_to_16k(&res.samples, res.sample_rate);
                    match asr.transcribe(&pcm) {
                        Ok(t) => {
                            let raw = t.text;
                            eprintln!("[whimpr] TRANSCRIPT: \"{}\"", raw);
                            
                            // Get active context before cleanup
                            let active_app = whimpr_core::agentic_os::get_frontmost_app().unwrap_or_default();
                            let active_window = whimpr_core::agentic_os::get_active_window_title().unwrap_or_default();
                            eprintln!("[whimpr] Context -> app: {}, window: {}", active_app, active_window);

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
                                whimpr_core::Route::Dictate => {
                                    let cleaned = clean_transcript(
                                        &raw,
                                        if active_app.is_empty() { None } else { Some(active_app.clone()) },
                                        if active_window.is_empty() { None } else { Some(active_window) },
                                    );
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

                            if text != raw && !text.is_empty() {
                                eprintln!("[whimpr] CLEANED:   \"{}\"", text);
                            }
                            if !text.is_empty() {
                                if let Err(e) = crate::paste::paste_text(&text) {
                                    eprintln!("[whimpr] paste failed: {e}");
                                    // Distinguish the two real causes: Accessibility was
                                    // never (or no longer) granted, vs. everything else
                                    // (clipboard contention, etc.) — `is_trusted()` is the
                                    // authoritative check, cheaper and more precise than
                                    // matching on the error string.
                                    let failure = if !crate::paste::is_trusted() {
                                        whimpr_core::InjectionFailure::AccessibilityNotGranted
                                    } else {
                                        whimpr_core::InjectionFailure::ClipboardUnavailable
                                    };
                                    crate::diag::report(&app2, failure);
                                } else {
                                    crate::diag::clear_last_error();
                                }
                                // Log words + speaking time for the Hub stats (WPM, streak…).
                                record_dictation(&text, res.duration_secs());
                                // Watch the field for a post-paste correction to learn (✨).
                                crate::autolearn::watch_correction(&text);
                            } else if was_real_attempt {
                                crate::diag::report(&app2, whimpr_core::InjectionFailure::EmptyTranscript);
                            }
                            let _ = app2.emit_to(
                                OVERLAY_LABEL,
                                "whimpr://transcript",
                                TranscriptPayload { text },
                            );
                        }
                        Err(e) => {
                            eprintln!("[whimpr] ASR error: {e}");
                            if was_real_attempt {
                                crate::diag::report(&app2, whimpr_core::InjectionFailure::AsrUnavailable);
                            }
                        }
                    }
                    finish();
                });
            }
            Action::DiscardCapture { .. } => {
                if let Some(slot) = CAPTURE.get() {
                    if let Some(handle) = slot.lock().unwrap().take() {
                        let _ = handle.stop();
                    }
                }
            }
            // The ASR path (StopCaptureAndFinalize) now drives pipeline completion.
            Action::RunPipeline { .. } => {}
            Action::PlayPing => {
                let sound_on = SETTINGS.get().map(|m| m.lock().unwrap().sound_on_start).unwrap_or(true);
                if sound_on {
                    std::thread::spawn(|| {
                        let _ = std::process::Command::new("afplay")
                            .arg("/System/Library/Sounds/Pop.aiff")
                            .output();
                    });
                }
            }
            _ => {}
        }
    }

    extern "C" fn tap_callback(
        _proxy: CGEventTapProxy,
        etype: u32,
        event: CGEventRef,
        _info: *mut c_void,
    ) -> CGEventRef {
        if etype == K_CG_TAP_DISABLED_BY_TIMEOUT || etype == K_CG_TAP_DISABLED_BY_USER_INPUT {
            let port = TAP_PORT.load(Ordering::SeqCst);
            if !port.is_null() {
                unsafe { CGEventTapEnable(port, true) };
            }
            return event;
        }
        if etype == K_CG_EVENT_KEY_DOWN || etype == K_CG_EVENT_KEY_UP {
            let keycode =
                unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) };
            let expected_mod = TRIGGER_MODIFIERS.load(Ordering::SeqCst);
            let expected_code = TRIGGER_KEYCODE.load(Ordering::SeqCst);
            
            // Allow triggering down if target modifier matches.
            // But wait, the macro might be `Fn` which only sends flag changed event!
            let is_fn_driven = expected_code == 63;
            if is_fn_driven {
                if etype == K_CG_EVENT_FLAGS_CHANGED && keycode == 63 {
                    let flags = unsafe { CGEventGetFlags(event) };
                    let down = (flags & expected_mod) != 0;
                    let was_down = FN_IS_DOWN.swap(down, Ordering::SeqCst);
                    let at_ms = now_ms();
                    if down && !was_down {
                        let target = crate::appctx::frontmost_bundle_id();
                        *TARGET_APP.get_or_init(|| Mutex::new(None)).lock().unwrap() = target;
                        if TRIGGER_MODE_IS_TOGGLE.load(Ordering::SeqCst) {
                            let is_rec = TOGGLE_STATE_IS_RECORDING.load(Ordering::SeqCst);
                            if !is_rec {
                                TOGGLE_STATE_IS_RECORDING.store(true, Ordering::SeqCst);
                                handle_input(Input::Trigger(TriggerToken::Down { binding: BindingId::PushToTalk, at_ms }));
                            } else {
                                TOGGLE_STATE_IS_RECORDING.store(false, Ordering::SeqCst);
                                handle_input(Input::Trigger(TriggerToken::Up { binding: BindingId::PushToTalk, at_ms }));
                            }
                        } else {
                            handle_input(Input::Trigger(TriggerToken::Down { binding: BindingId::PushToTalk, at_ms }));
                        }
                    } else if !down && was_down {
                        if !TRIGGER_MODE_IS_TOGGLE.load(Ordering::SeqCst) {
                            handle_input(Input::Trigger(TriggerToken::Up { binding: BindingId::PushToTalk, at_ms }));
                        }
                    }
                }
            } else {
                if keycode == expected_code {
                    let flags = unsafe { CGEventGetFlags(event) };
                    let down = etype == K_CG_EVENT_KEY_DOWN;
                    
                    if (!down) || ((flags & expected_mod) == expected_mod) {
                    let was_down = FN_IS_DOWN.swap(down, Ordering::SeqCst);
                    let at_ms = now_ms();
                    if down && !was_down {
                        eprintln!("[whimpr] Option+Space DOWN");
                        let target = crate::appctx::frontmost_bundle_id();
                        *TARGET_APP.get_or_init(|| Mutex::new(None)).lock().unwrap() = target;
                        if TRIGGER_MODE_IS_TOGGLE.load(Ordering::SeqCst) {
                            let is_rec = TOGGLE_STATE_IS_RECORDING.load(Ordering::SeqCst);
                            if !is_rec {
                                TOGGLE_STATE_IS_RECORDING.store(true, Ordering::SeqCst);
                                handle_input(Input::Trigger(TriggerToken::Down { binding: BindingId::PushToTalk, at_ms }));
                            } else {
                                TOGGLE_STATE_IS_RECORDING.store(false, Ordering::SeqCst);
                                handle_input(Input::Trigger(TriggerToken::Up { binding: BindingId::PushToTalk, at_ms }));
                            }
                        } else {
                            handle_input(Input::Trigger(TriggerToken::Down { binding: BindingId::PushToTalk, at_ms }));
                        }
                    } else if !down && was_down {
                        eprintln!("[whimpr] Option+Space UP");
                        if !TRIGGER_MODE_IS_TOGGLE.load(Ordering::SeqCst) {
                            handle_input(Input::Trigger(TriggerToken::Up { binding: BindingId::PushToTalk, at_ms }));
                        }
                    }
                }
            }
            }
        }
        event
    }

    pub fn install(app: AppHandle) {
        let _ = APP.set(app);
        let _ = MACHINE.set(Mutex::new(StateMachine::new()));
        let _ = CLOCK.set(Instant::now());
        let settings = whimpr_core::Settings::load(&settings_path());
        {
            let (m, c) = parse_hotkey(&settings.trigger_key);
            TRIGGER_MODIFIERS.store(m, std::sync::atomic::Ordering::SeqCst);
            TRIGGER_KEYCODE.store(c, std::sync::atomic::Ordering::SeqCst);
            TRIGGER_MODE_IS_TOGGLE.store(settings.trigger_mode == "toggle", std::sync::atomic::Ordering::SeqCst);
        }

        // Load the speech-to-text model off the main thread (it takes ~1s).
        std::thread::spawn(|| {
            let path = model_path();
            if !path.exists() {
                eprintln!("[whimpr] ASR model not found at {}", path.display());
                ASR_MODEL_MISSING.store(true, Ordering::SeqCst);
                return;
            }
            match whimpr_asr::WhisperEngine::load(&path) {
                Ok(engine) => {
                    let _ = ASR.set(Arc::new(engine));
                    eprintln!("[whimpr] ASR model loaded — ready to transcribe");
                }
                Err(e) => {
                    eprintln!("[whimpr] ASR model load failed: {e}");
                    ASR_MODEL_MISSING.store(true, Ordering::SeqCst);
                }
            }
        });

        // Load settings + dictionary, and build cloud providers from stored keys.
        let settings = whimpr_core::Settings::load(&settings_path());
        let dict = whimpr_core::DictionaryStore::load(&dict_path());
        eprintln!(
            "[whimpr] cleanup mode: {:?}, level: {:?}",
            settings.cleanup_mode, settings.cleanup_level
        );
        let _ = SETTINGS.set(Mutex::new(settings));
        let _ = DICTIONARY.set(Mutex::new(dict));
        let _ = STATS.set(Mutex::new(whimpr_core::StatsStore::load(&stats_path())));
        rebuild_providers();

        // Start the local cleanup worker in the background (model load takes a few
        // seconds; the first local cleanup waits for it, subsequent ones are fast).
        std::thread::spawn(|| {
            let worker = crate::local_llm::spawn_default(&SETTINGS.get().unwrap().lock().unwrap().local_model);
            let _ = LOCAL.set(Mutex::new(worker));
        });

        // Accessibility is the ONE permission that makes the Fn CGEventTap global AND
        // lets us post the Cmd+V paste into other apps. Without it, a keyboard tap is
        // silently limited to frontmost-only — the exact bug. Prompt for it up front.
        if crate::paste::is_trusted() {
            eprintln!("[whimpr] Accessibility granted — Fn works in every app, paste enabled");
        } else {
            eprintln!(
                "[whimpr] ⚠ Accessibility NOT granted — Fn only works while WhimprFlow is \
                 frontmost and paste is disabled. Prompting; grant WhimprFlow under System \
                 Settings → Privacy & Security → Accessibility (no relaunch needed)."
            );
            crate::paste::prompt_accessibility();
        }
        // Input Monitoring is NOT the gate for a CGEventTap — kept only as diagnostics.
        eprintln!(
            "[whimpr] (info) Input Monitoring: {}",
            crate::paste::input_monitoring_granted()
        );

        // Periodic tick drives the double-tap timeout / session cap.
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_millis(100));
            handle_input(Input::Tick { now_ms: now_ms() });
        });

        // The event tap runs on a thread with its own CFRunLoop. CRITICAL: create it
        // ONLY after the process is trusted for Accessibility. macOS fixes a keyboard
        // tap's privilege at CGEventTapCreate time — a tap born untrusted is
        // permanently frontmost-only and is NOT upgraded when the grant later arrives.
        // Polling here also means the Fn key starts working the moment the user grants
        // Accessibility, without a relaunch.
        std::thread::spawn(|| {
            while !crate::paste::is_trusted() {
                std::thread::sleep(Duration::from_millis(500));
            }
            eprintln!("[whimpr] Accessibility present — creating global Fn tap");
            // Bug fix: this used to try CGEventTapCreate exactly once and, if it
            // came back null despite Accessibility being granted (the real-world
            // stale-TCC-entry case this app's own comments already knew about),
            // give up FOREVER with only an eprintln — the Fn key would then do
            // nothing for the rest of the run, indistinguishable from "text isn't
            // typed" to the user, with zero visible explanation. Now: report it
            // loudly once, and keep retrying — toggling the Accessibility entry
            // off/on in System Settings, or removing and re-adding it, fixes the
            // stale grant without requiring a relaunch, and this way that fix is
            // picked up automatically.
            let mut reported = false;
            let port = loop {
                let port = unsafe {
                    CGEventTapCreate(
                        K_CG_SESSION_EVENT_TAP,
                        K_CG_HEAD_INSERT,
                        K_CG_TAP_OPTION_LISTEN_ONLY,
                        EVENTS_OF_INTEREST,
                        tap_callback,
                        null_mut(),
                    )
                };
                if !port.is_null() {
                    break port;
                }
                eprintln!(
                    "[whimpr] Fn tap null despite Accessibility — likely a stale TCC entry from \
                     an earlier build. Run: tccutil reset Accessibility com.whimpr.whimprflow, \
                     or toggle WhimprFlow off/on under System Settings → Privacy & Security → \
                     Accessibility. Retrying…"
                );
                if !reported {
                    if let Some(app) = APP.get() {
                        crate::diag::report(app, whimpr_core::InjectionFailure::HotkeyTapFailed);
                    }
                    reported = true;
                }
                std::thread::sleep(Duration::from_secs(5));
            };
            if reported {
                eprintln!("[whimpr] Fn tap recovered — the key is live now.");
                crate::diag::clear_last_error();
            }
            TAP_PORT.store(port, Ordering::SeqCst);
            unsafe {
                let source = CFMachPortCreateRunLoopSource(null(), port, 0);
                CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopDefaultMode);
                CGEventTapEnable(port, true);
                CFRunLoopRun();
            }
        });
    }
}

#[cfg(target_os = "macos")]
pub use imp::{
    current_settings, dictionary_add, dictionary_entries, dictionary_learn, dictionary_remove,
    history, install, rebuild_providers, stats_summary, update_settings,
    snippets_all, snippet_add, snippet_update, snippet_remove,
    transforms_all, transform_add, transform_update, transform_remove,
    scratchpad_get, scratchpad_set_text, scratchpad_set_capture,
    style_get, style_mutate, local_worker,
};

// Windows uses the real (but unverified) platform layer in `crate::win`.
#[cfg(target_os = "windows")]
pub use crate::win::{
    current_settings, dictionary_add, dictionary_entries, dictionary_learn, dictionary_remove,
    history, install, rebuild_providers, stats_summary, update_settings,
};

// Other platforms (Linux, etc.): inert stubs so the crate still builds.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod other {
    pub fn install(_app: tauri::AppHandle) {}
    pub fn current_settings() -> whimpr_core::Settings {
        whimpr_core::Settings::default()
    }
    pub fn update_settings(_new: whimpr_core::Settings) {}
    pub fn rebuild_providers() {}
    pub fn stats_summary(tz_offset_minutes: i32) -> whimpr_core::StatsSummary {
        whimpr_core::StatsStore::default().summary(tz_offset_minutes, 0)
    }
    pub fn history(_limit: usize) -> Vec<whimpr_core::HistoryItem> {
        Vec::new()
    }
    pub fn dictionary_entries() -> Vec<super::DictEntryDto> {
        Vec::new()
    }
    pub fn dictionary_add(_correct: String, _mishears: Vec<String>) {}
    pub fn dictionary_remove(_correct: &str) {}
    pub fn dictionary_learn(_correct: String, _mishears: Vec<String>) {}
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use other::{
    current_settings, dictionary_add, dictionary_entries, dictionary_learn, dictionary_remove,
    history, install, rebuild_providers, stats_summary, update_settings,
};
