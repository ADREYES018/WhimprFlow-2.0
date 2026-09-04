//! WhimprFlow Tauri shell.
//!
//! Runs as a macOS accessory (menu-bar) app: a tray item, a transparent
//! always-on-top Flow Bar overlay, and a hidden Hub window. This is the M0
//! skeleton — the sidecar supervisor, real state-machine bridge, and native
//! panel promotion arrive in later milestones. The overlay already listens for
//! `whimpr://flowbar/state`, so the tray demo items prove the event pipeline.

mod appctx;
mod autolearn;
mod diag;
mod hotkey;
mod local_llm;
mod paste;
mod window;
#[cfg(target_os = "windows")]
mod win;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const OVERLAY_LABEL: &str = "whimpr_bar";
pub const HUB_LABEL: &str = "main";
pub const TRANSCRIPT_WINDOW: &str = "transcript";

#[derive(Clone, Serialize)]
struct BarStatePayload {
    state: &'static str,
}

/// Anchor the overlay window bottom-center of its monitor.
fn position_overlay(w: &WebviewWindow) {
    // current_monitor() can be None before the window maps; fall back sensibly.
    let monitor = w
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| w.current_monitor().ok().flatten())
        .or_else(|| w.available_monitors().ok().and_then(|m| m.into_iter().next()));
    let Some(monitor) = monitor else {
        eprintln!("[whimpr] no monitor found — overlay stays at default position");
        return;
    };
    let scale = monitor.scale_factor();
    let msize = monitor.size();
    let mpos = monitor.position();
    let Ok(wsize) = w.outer_size() else { return };
    let inset = (40.0 * scale) as i32;
    let x = mpos.x + (msize.width as i32 - wsize.width as i32) / 2;
    let y = mpos.y + msize.height as i32 - wsize.height as i32 - inset;
    let _ = w.set_position(tauri::PhysicalPosition { x, y });
    eprintln!(
        "[whimpr] overlay placed: monitor {}x{} @({},{}) scale {:.1} -> window {}x{} @({},{})",
        msize.width, msize.height, mpos.x, mpos.y, scale, wsize.width, wsize.height, x, y
    );
}

fn build_overlay(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let overlay = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("WhimprBar")
    // Tight window so it only catches clicks right around the pill, not a big
    // invisible box over the app behind it.
    .inner_size(300.0, 72.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .resizable(false)
    .visible(true)
    .build()?;
    let hidden = HIDDEN_FROM_CAPTURE.load(std::sync::atomic::Ordering::SeqCst);
    let _ = window::set_hidden_from_capture(&overlay, hidden);
    position_overlay(&overlay);
    let _ = overlay.show();
    Ok(overlay)
}

fn build_hub(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, HUB_LABEL, WebviewUrl::App("index.html".into()))
        .title("WhimprFlow")
        .inner_size(920.0, 640.0)
        .min_inner_size(720.0, 480.0)
        .visible(true)
        .build()
}

fn emit_bar_state(app: &tauri::AppHandle, state: &'static str) {
    let _ = app.emit_to(OVERLAY_LABEL, "whimpr://flowbar/state", BarStatePayload { state });
}


#[tauri::command]
fn list_models() -> Vec<String> {
    let mut models = vec!["auto".to_string()];
    #[cfg(target_os = "macos")]
    let dir = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/Application Support/WhimprFlow/models");
    #[cfg(not(target_os = "macos"))]
    let dir = std::path::PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("WhimprFlow/models");
    
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".bin") || name.ends_with(".gguf") {
                    models.push(name.to_string());
                }
            }
        }
    }
    models
}

#[tauri::command]
fn get_settings() -> whimpr_core::Settings {
    hotkey::current_settings()
}

#[tauri::command]
fn set_settings(settings: whimpr_core::Settings) {
    hotkey::update_settings(settings);
}

/// Aggregated dictation stats for the Hub dashboard. `tz_offset_minutes` is the
/// browser's `Date.getTimezoneOffset()` so "today"/streak match the user's clock.
#[tauri::command]
fn get_stats(tz_offset_minutes: i32) -> whimpr_core::StatsSummary {
    hotkey::stats_summary(tz_offset_minutes)
}

/// Recent dictations for the Hub Home history list (newest first).
#[tauri::command]
fn get_history() -> Vec<whimpr_core::HistoryItem> {
    hotkey::history(200)
}

/// Dictionary entries for the Hub Dictionary screen.
#[tauri::command]
fn get_dictionary() -> Vec<hotkey::DictEntryDto> {
    hotkey::dictionary_entries()
}

/// Add a manual dictionary entry (word + optional known mishears).
#[tauri::command]
fn add_dictionary_entry(correct: String, mishears: Vec<String>) {
    hotkey::dictionary_add(correct, mishears);
}

/// Remove a dictionary entry by its spelling.
#[tauri::command]
fn remove_dictionary_entry(correct: String) {
    hotkey::dictionary_remove(&correct);
}

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
fn run_transform(id: String, source: whimpr_core::TransformSource) -> String {
    hotkey::transform_run(&id, source)
}

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

#[tauri::command]
fn propose_style_profile() -> Option<whimpr_core::StyleProfile> {
    let recent: Vec<String> = hotkey::history(50).into_iter().map(|h| h.text).collect();
    if recent.is_empty() {
        return None;
    }
    let prompt = whimpr_core::style::DERIVE_PROMPT.replace("{input}", &recent.join("\n\n---\n\n"));
    let response = local_llm::complete(&prompt).ok()?;
    let profile = whimpr_core::style::parse_profile(&response)?;
    let p = profile.clone();
    hotkey::style_mutate(move |s| s.pending = Some(p));
    Some(profile)
}

/// Permission + capability status shown in the Hub.
#[derive(Clone, Serialize)]
struct StatusReport {
    accessibility: bool,
    microphone: bool,
    input_monitoring: bool,
    screen_recording: bool,
    has_openai_key: bool,
    has_anthropic_key: bool,
}

#[tauri::command]
fn get_status() -> StatusReport {
    StatusReport {
        accessibility: paste::is_trusted(),
        microphone: paste::microphone_granted(),
        input_monitoring: paste::input_monitoring_granted(),
        screen_recording: whimpr_audio::sysaudio::has_screen_capture_permission(),
        has_openai_key: has_key("openai_api_key"),
        has_anthropic_key: has_key("anthropic_api_key"),
    }
}

/// The most recent loud diagnostic (permission/injection failure), if any —
/// lets the Hub show what went wrong even if it was opened after the fact.
/// See `diag::report`, called from the dictation pipeline whenever text
/// fails to reach the cursor.
#[tauri::command]
fn get_last_error() -> Option<diag::ErrorDto> {
    diag::last_error()
}

fn has_key(account: &str) -> bool {
    keyring::Entry::new("com.whimpr.whimprflow", account)
        .ok()
        .and_then(|e| e.get_password().ok())
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) {
    let _ = std::process::Command::new("open").arg(url).spawn();
}

#[cfg(target_os = "macos")]
extern "C" {
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Request microphone access: trigger the native prompt (bundle has a usage string)
/// by briefly opening the input device, and open the Microphone settings pane.
#[tauri::command]
fn request_microphone() {
    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(|| {
            if let Ok(h) = whimpr_audio::start(|_: &[f32]| {}) {
                std::thread::sleep(std::time::Duration::from_millis(400));
                let _ = h.stop();
            }
        });
        open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
    }
}

/// Request Accessibility — the permission that makes the Fn key work in every app and
/// lets us type into other apps. Fire the native prompt, then open the pane.
#[tauri::command]
fn request_accessibility() {
    #[cfg(target_os = "macos")]
    {
        let _ = paste::prompt_accessibility();
        open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    }
}

/// Request Input Monitoring (needed for the Fn key to be seen in every app, not
/// just while WhimprFlow is frontmost): register + prompt, then open the pane.
#[tauri::command]
fn request_input_monitoring() {
    #[cfg(target_os = "macos")]
    {
        let _ = paste::request_input_monitoring();
        open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent");
    }
}

/// Request Screen Recording (needed for recording system audio in meetings):
/// trigger the system prompt and open the pane.
#[tauri::command]
fn request_screen_recording() {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let _ = CGRequestScreenCaptureAccess();
        }
        open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    }
}

static HIDDEN_FROM_CAPTURE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[tauri::command]
fn set_hidden_from_capture(app: tauri::AppHandle, hidden: bool) -> Result<(), String> {
    let _ = window::apply_on_main(&app, OVERLAY_LABEL, hidden);
    let _ = window::apply_on_main(&app, TRANSCRIPT_WINDOW, hidden);
    HIDDEN_FROM_CAPTURE.store(hidden, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn is_hidden_from_capture() -> bool {
    HIDDEN_FROM_CAPTURE.load(std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
fn set_transcript_window_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let win = if let Some(w) = app.get_webview_window(TRANSCRIPT_WINDOW) {
        w
    } else {
        let win = WebviewWindowBuilder::new(&app, TRANSCRIPT_WINDOW, WebviewUrl::App("transcript.html".into()))
            .title("WhimprFlow Transcript")
            .inner_size(480.0, 600.0)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
        let hidden = HIDDEN_FROM_CAPTURE.load(std::sync::atomic::Ordering::SeqCst);
        let _ = window::set_hidden_from_capture(&win, hidden);
        win
    };
    if visible {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    } else {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_transcript_pinned(app: tauri::AppHandle, pinned: bool) -> Result<(), String> {
    let win = app
        .get_webview_window(TRANSCRIPT_WINDOW)
        .ok_or("transcript window not found")?;
    window::set_pinned(&win, pinned)
}

#[tauri::command]
fn is_transcript_window_visible(app: tauri::AppHandle) -> bool {
    app.get_webview_window(TRANSCRIPT_WINDOW)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Save (or clear, when empty) an API key in the OS keychain, then rebuild providers
/// so it takes effect immediately.
#[tauri::command]
fn set_api_key(provider: String, key: String) -> Result<(), String> {
    let account = match provider.as_str() {
        "openai" => "openai_api_key",
        "anthropic" => "anthropic_api_key",
        _ => return Err(format!("unknown provider {provider}")),
    };
    let entry =
        keyring::Entry::new("com.whimpr.whimprflow", account).map_err(|e| e.to_string())?;
    let key = key.trim();
    // Delete any existing item first so the new one is created by (and readable to)
    // this app — a key added via the `security` CLI isn't readable by the app.
    let _ = entry.delete_credential();
    if !key.is_empty() {
        entry.set_password(key).map_err(|e| e.to_string())?;
    }
    hotkey::rebuild_providers();
    Ok(())
}

#[tauri::command]
fn save_settings(
    display_name: String,
    language: String,
    followup_style: String,
    followup_custom: String,
    chunk_seconds: u32,
    mic_enabled: bool,
) -> Result<whimpr_core::Settings, String> {
    let mut s = hotkey::current_settings();
    s.display_name = display_name;
    s.language = language;
    s.followup_style = followup_style;
    s.followup_custom = followup_custom;
    s.chunk_seconds = chunk_seconds;
    s.mic_enabled = mic_enabled;
    hotkey::update_settings(s.clone());
    Ok(s)
}

#[tauri::command]
fn list_homework() -> Vec<whimpr_notes::HomeworkItem> {
    whimpr_notes::list_homework()
}

#[tauri::command]
fn add_homework(meeting_id: String, title: String, due_date: String) -> Result<whimpr_notes::HomeworkItem, String> {
    whimpr_notes::add_homework(&meeting_id, &title, &due_date)
}

#[tauri::command]
fn set_homework_done(id: String, done: bool) -> Result<(), String> {
    whimpr_notes::set_homework_done(&id, done)
}

#[tauri::command]
fn delete_homework(id: String) -> Result<(), String> {
    whimpr_notes::delete_homework(&id)
}

const CHAT_TOKEN_EVENT: &str = "chat-token";

fn chat_token_sink(app: tauri::AppHandle) -> impl FnMut(&str) {
    use tauri::Emitter;
    let mut seq = 0u32;
    move |piece: &str| {
        seq += 1;
        let _ = app.emit(
            CHAT_TOKEN_EVENT,
            serde_json::json!({ "seq": seq, "text": piece }),
        );
    }
}

#[tauri::command(async)]
fn generate_study_plan(
    id: String,
    settings: whimpr_notes::StudySettings,
    force: bool,
) -> Result<String, String> {
    whimpr_notes::generate_study_plan(&id, &settings, force)
}

#[tauri::command]
fn cached_study_plan(id: String) -> Result<Option<String>, String> {
    whimpr_notes::study::cached_study_plan(&id)
}

#[tauri::command(async)]
fn generate_flashcards(
    id: String,
    settings: whimpr_notes::StudySettings,
    force: bool,
) -> Result<Vec<whimpr_notes::Flashcard>, String> {
    whimpr_notes::generate_flashcards(&id, &settings, force)
}

#[tauri::command]
fn cached_flashcards(id: String) -> Result<Option<Vec<whimpr_notes::Flashcard>>, String> {
    whimpr_notes::study::cached_flashcards(&id)
}

#[tauri::command(async)]
fn generate_quiz(
    id: String,
    settings: whimpr_notes::StudySettings,
    force: bool,
) -> Result<Vec<whimpr_notes::QuizQuestion>, String> {
    whimpr_notes::generate_quiz(&id, &settings, force)
}

#[tauri::command]
fn cached_quiz(id: String) -> Result<Option<Vec<whimpr_notes::QuizQuestion>>, String> {
    whimpr_notes::study::cached_quiz(&id)
}

#[tauri::command]
fn last_study_settings(id: String) -> Result<Option<whimpr_notes::StudySettings>, String> {
    whimpr_notes::study::last_settings(&id)
}

#[tauri::command(async)]
fn ask_meeting(app: tauri::AppHandle, id: String, question: String) -> Result<String, String> {
    let live = id.trim().is_empty();
    let transcript = if live {
        whimpr_meetings::live_lines()
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        whimpr_meetings::library::transcript_text(&id)?
    };
    let mut sink = chat_token_sink(app);
    whimpr_notes::ask_meeting(&transcript, &question, live, &mut sink)
}

#[tauri::command(async)]
fn ask_library(app: tauri::AppHandle, question: String) -> Result<whimpr_notes::LibraryAnswer, String> {
    let mut sink = chat_token_sink(app);
    whimpr_notes::ask_library(&question, &mut sink)
}

#[tauri::command(async)]
fn draft_followup(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let notes = whimpr_meetings::library::followup_source(&id)?;
    let s = hotkey::current_settings();
    let style = whimpr_notes::FollowupStyle::from_settings(&s.followup_style, &s.followup_custom);
    let mut sink = chat_token_sink(app);
    whimpr_notes::draft_followup(std::path::Path::new(""), &notes, &style, &mut sink)
}

#[tauri::command(async)]
fn write_notes(
    id: String,
    template: whimpr_meetings::chat::Template,
    force: bool,
) -> Result<String, String> {
    whimpr_meetings::library::write_notes(&id, template, force)
}

#[tauri::command(async)]
fn answer_live_question(question: String) -> Result<String, String> {
    let recent = whimpr_meetings::live_lines()
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let dummy_path = std::path::Path::new("");
    whimpr_notes::chat::answer_live(dummy_path, &recent, &question, &mut |_| {})
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn calendar_authorized() -> bool {
    whimpr_meetings::calendar::authorized()
}

#[tauri::command]
fn calendar_request_access() -> Result<bool, String> {
    whimpr_meetings::calendar::request_access()
}

#[tauri::command]
fn list_events(days: u32) -> Result<whimpr_meetings::calendar::CalendarFeed, String> {
    whimpr_meetings::calendar::list_events(days)
}

#[tauri::command]
fn open_calendar_settings() {
    #[cfg(target_os = "macos")]
    open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars");
}

#[tauri::command]
fn chat_model_status() -> serde_json::Value {
    let path = whimpr_media::model::model_dir().join(whimpr_media::model::CHAT_MODEL_FILE);
    serde_json::json!({
        "path": path.display().to_string(),
        "present": path.exists(),
        "loaded": whimpr_notes::chat::is_loaded(),
        "approx_mb": 4000,
    })
}

#[tauri::command]
fn default_model_path() -> String {
    whimpr_media::model::model_dir()
        .join("ggml-large-v3-turbo-q8_0.bin")
        .display()
        .to_string()
}

#[tauri::command(async)]
fn ensure_chat_model() -> Result<String, String> {
    whimpr_media::model::ensure_chat_model().map(|p| p.display().to_string())
}

#[tauri::command(async)]
fn ensure_model() -> Result<String, String> {
    whimpr_media::model::ensure_whisper_model("large-v3-turbo")
        .or_else(|_| whimpr_media::model::ensure_whisper_model("base.en"))
        .map(|p| p.display().to_string())
}

#[tauri::command(async)]
fn warm_chat_model() -> Result<(), String> {
    whimpr_notes::chat::warm(std::path::Path::new(""))
}

#[tauri::command(async)]
fn unload_chat_model() {
    whimpr_notes::chat::unload();
}

#[tauri::command]
fn check_for_update() -> whimpr_media::update::UpdateStatus {
    whimpr_media::update::check()
}

#[tauri::command(async)]
fn install_update(url: String) -> Result<(), String> {
    whimpr_media::update::install(&url)
}

#[tauri::command]
fn open_update_download(url: String) -> Result<(), String> {
    whimpr_media::update::open_download(&url)
}

#[tauri::command(async)]
fn release_notes() -> Result<whimpr_media::update::ReleaseNotes, String> {
    whimpr_media::update::notes()
}

#[tauri::command(async)]
fn latex_from_speech(speech: String) -> Result<String, String> {
    whimpr_media::latex::from_speech(&speech)
}

#[tauri::command(async)]
fn video_probe(url: String) -> Result<whimpr_media::video::VideoInfo, String> {
    whimpr_media::video::probe(&url)
}

#[tauri::command(async)]
fn video_import(meeting_id: String, url: String, start: String, end: String) -> Result<String, String> {
    whimpr_media::video::import(&meeting_id, &url, &start, &end)
}

#[tauri::command]
fn list_meetings() -> Vec<whimpr_meetings::Meeting> {
    whimpr_meetings::library::list_meetings()
}

#[tauri::command]
fn search_meetings(query: String) -> Vec<whimpr_meetings::Meeting> {
    whimpr_meetings::library::search_meetings(&query)
}

#[tauri::command]
fn delete_meeting(id: String) -> Result<String, String> {
    whimpr_meetings::library::delete_meeting(&id)
}

#[tauri::command]
fn rename_meeting(id: String, title: String) -> Result<(), String> {
    whimpr_meetings::library::rename_meeting(&id, &title)
}

#[tauri::command]
fn export_meeting(id: String) -> Result<String, String> {
    whimpr_meetings::library::export_meeting(&id)
}

#[tauri::command]
fn list_folders() -> Vec<whimpr_meetings::library::Folder> {
    whimpr_meetings::library::list_folders()
}

#[tauri::command]
fn create_folder(name: String) -> Result<(), String> {
    whimpr_meetings::library::create_folder(&name)
}

#[tauri::command]
fn rename_folder(old: String, new: String) -> Result<(), String> {
    whimpr_meetings::library::rename_folder(&old, &new)
}

#[tauri::command]
fn delete_folder(name: String) -> Result<(), String> {
    whimpr_meetings::library::delete_folder(&name)
}

#[tauri::command]
fn move_meeting_to_folder(id: String, folder: Option<String>) -> Result<(), String> {
    whimpr_meetings::library::move_meeting_to_folder(&id, folder.as_deref())
}

#[tauri::command]
fn meeting_typed_notes(id: String) -> Option<String> {
    whimpr_meetings::library::typed_notes(&id).ok()
}

#[tauri::command]
fn save_notes(title: String, body: String) -> Result<Option<String>, String> {
    if let Ok(dir) = whimpr_meetings::library::meeting_dir(&title) {
        let p = whimpr_meetings::session::write_notes(&dir, &title, &body)?;
        return Ok(Some(p.display().to_string()));
    }
    Ok(None)
}

#[tauri::command]
fn meeting_segments(id: String) -> Result<Vec<whimpr_meetings::library::TranscriptLine>, String> {
    whimpr_meetings::library::transcript_lines(&id)
}

#[tauri::command(async)]
fn finish_meeting(id: String, model_path: String, language: String) -> Result<whimpr_meetings::Meeting, String> {
    whimpr_meetings::finish_meeting(&id, &model_path, &language)
}

#[tauri::command(async)]
fn search_snippets(query: String) -> Vec<whimpr_meetings::library::SearchHit> {
    whimpr_meetings::library::search_hits(&query)
}

#[tauri::command]
fn data_status() -> serde_json::Value {
    serde_json::json!({
        "dataVersion": whimpr_meetings::store::DATA_VERSION,
        "storedVersion": whimpr_meetings::store::stored_version(),
        "writesLocked": whimpr_meetings::store::writes_locked(),
        "lockReason": whimpr_meetings::store::lock_reason(),
    })
}

#[tauri::command(async)]
fn start_session(
    app: tauri::AppHandle,
    title: String,
    language: String,
) -> Result<whimpr_meetings::SessionPaths, String> {
    whimpr_meetings::begin_session_with_emitter(&title, &language, move |line| {
        let _ = app.emit("whimpr://live-line", line);
    })
}

#[tauri::command(async)]
fn stop_session(
    model_path: String,
    language: String,
) -> Result<whimpr_meetings::session::MeetingResult, String> {
    whimpr_meetings::stop_session(&model_path, &language)
}

#[tauri::command(async)]
fn continue_session(
    app: tauri::AppHandle,
    id: String,
    language: String,
) -> Result<whimpr_meetings::SessionPaths, String> {
    let meeting = whimpr_meetings::library::meeting(&id)?;
    whimpr_meetings::continue_session_with_emitter(
        std::path::Path::new(&meeting.dir),
        &meeting.title,
        &language,
        move |line| {
            let _ = app.emit("whimpr://live-line", line);
        },
    )
}

#[tauri::command]
fn is_session_active() -> bool {
    whimpr_meetings::is_session_active()
}

#[tauri::command]
fn session_elapsed_ms() -> Option<u64> {
    whimpr_meetings::session_elapsed_ms()
}

#[tauri::command]
fn set_mic_muted(muted: bool) -> Result<bool, String> {
    whimpr_audio::mic::set_mic_muted(muted)
}

#[tauri::command]
fn is_mic_muted() -> Result<bool, String> {
    whimpr_audio::mic::is_mic_muted()
}

#[tauri::command]
fn start_mic_recording(path: String) -> Result<(), String> {
    whimpr_audio::mic::start_mic_recording(std::path::PathBuf::from(path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_mic_recording() -> Result<String, String> {
    whimpr_audio::mic::stop_mic_recording()
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn is_mic_recording() -> bool {
    whimpr_audio::mic::is_mic_recording()
}

#[tauri::command]
fn start_sysaudio_recording(path: String) -> Result<(), String> {
    whimpr_audio::sysaudio::start_sysaudio_recording(std::path::PathBuf::from(path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_sysaudio_recording() -> Result<String, String> {
    whimpr_audio::sysaudio::stop_sysaudio_recording()
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn is_sysaudio_recording() -> bool {
    whimpr_audio::sysaudio::is_sysaudio_recording()
}

#[tauri::command]
fn live_lines() -> Vec<whimpr_meetings::LiveLine> {
    whimpr_meetings::live_lines()
}

#[tauri::command(async)]
fn transcribe_wav(path: String) -> Result<String, String> {
    let samples = whimpr_meetings::transcribe::load_wav_mono_16k(std::path::Path::new(&path))?;
    let t = whimpr_meetings::transcribe::transcribe_samples("", &samples, None)?;
    Ok(t.text)
}

fn show_or_create_hub<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window(HUB_LABEL) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    } else if let Ok(w) = WebviewWindowBuilder::new(app, HUB_LABEL, WebviewUrl::App("index.html".into()))
        .title("WhimprFlow")
        .inner_size(920.0, 640.0)
        .min_inner_size(720.0, 480.0)
        .visible(true)
        .build()
    {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_settings,
            save_settings,
            get_stats,
            get_history,
            get_dictionary,
            add_dictionary_entry,
            remove_dictionary_entry,
            get_status,
            get_last_error,
            request_microphone,
            request_accessibility,
            request_input_monitoring,
            request_screen_recording,
            set_hidden_from_capture,
            is_hidden_from_capture,
            set_transcript_window_visible,
            set_transcript_pinned,
            is_transcript_window_visible,
            set_api_key,
            list_models,
            get_snippets,
            add_snippet,
            update_snippet,
            remove_snippet,
            get_transforms,
            add_transform,
            update_transform,
            remove_transform,
            run_transform,
            get_scratchpad,
            set_scratchpad_text,
            set_scratchpad_capture,
            get_style,
            add_style_sample,
            remove_style_sample,
            set_style_profile,
            set_style_context,
            remove_style_context,
            set_style_auto_learn,
            accept_pending_style,
            discard_pending_style,
            derive_style_profile,
            propose_style_profile,
            list_homework,
            add_homework,
            set_homework_done,
            delete_homework,
            generate_study_plan,
            cached_study_plan,
            generate_flashcards,
            cached_flashcards,
            generate_quiz,
            cached_quiz,
            last_study_settings,
            ask_meeting,
            ask_library,
            draft_followup,
            write_notes,
            answer_live_question,
            app_version,
            calendar_authorized,
            calendar_request_access,
            list_events,
            open_calendar_settings,
            chat_model_status,
            default_model_path,
            ensure_chat_model,
            ensure_model,
            warm_chat_model,
            unload_chat_model,
            check_for_update,
            install_update,
            open_update_download,
            release_notes,
            latex_from_speech,
            video_probe,
            video_import,
            list_meetings,
            search_meetings,
            delete_meeting,
            rename_meeting,
            export_meeting,
            list_folders,
            create_folder,
            rename_folder,
            delete_folder,
            move_meeting_to_folder,
            meeting_typed_notes,
            save_notes,
            meeting_segments,
            finish_meeting,
            search_snippets,
            data_status,
            start_session,
            stop_session,
            continue_session,
            is_session_active,
            session_elapsed_ms,
            set_mic_muted,
            is_mic_muted,
            start_mic_recording,
            stop_mic_recording,
            is_mic_recording,
            start_sysaudio_recording,
            stop_sysaudio_recording,
            is_sysaudio_recording,
            live_lines,
            transcribe_wav
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == HUB_LABEL {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Menu-bar accessory app: lives in the top menu bar, hidden from the macOS Dock.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            build_overlay(app)?;
            let hub = build_hub(app)?;
            let _ = hub.show();
            let _ = hub.set_focus();

            // Wire the Fn key to the pill via the real state machine. This also
            // starts the local LLM worker in the background.
            hotkey::install(app.handle().clone());

            // Point whimpr_core::local_llm at that worker, so notes, recall and
            // study generation reach llama instead of erroring out.
            local_llm::register_providers();

            let open = MenuItem::with_id(app, "open", "Open WhimprFlow", true, None::<&str>)?;
            let demo_rec =
                MenuItem::with_id(app, "demo_rec", "Demo: recording", true, None::<&str>)?;
            let demo_idle = MenuItem::with_id(app, "demo_idle", "Demo: idle", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit WhimprFlow", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &demo_rec, &demo_idle, &sep, &quit])?;

            let handle_for_tray = app.handle().clone();
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |_tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        show_or_create_hub(&handle_for_tray);
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_or_create_hub(app),
                    "demo_rec" => emit_bar_state(app, "recording"),
                    "demo_idle" => emit_bar_state(app, "idle"),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running WhimprFlow");
}
