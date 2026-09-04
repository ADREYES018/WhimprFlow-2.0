pub mod store;
pub mod library;
pub mod session;
pub mod settings;
pub mod chat;
pub mod transcribe;
pub mod sleep;
pub mod live;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

pub use whimpr_media::model;
pub use library::{Meeting, TranscriptLine, Folder, SearchHit};
pub use live::LiveLine;
pub use session::SessionPaths;

struct ActiveState {
    session: Mutex<Option<SessionPaths>>,
    take_started: Mutex<Option<Instant>>,
    live: Mutex<Option<live::LiveSession>>,
}

static ACTIVE_STATE: ActiveState = ActiveState {
    session: Mutex::new(None),
    take_started: Mutex::new(None),
    live: Mutex::new(None),
};

pub fn is_session_active() -> bool {
    ACTIVE_STATE
        .session
        .lock()
        .map(|s| s.is_some())
        .unwrap_or(false)
}

pub fn session_elapsed_ms() -> Option<u64> {
    ACTIVE_STATE.session.lock().ok()?.as_ref()?;
    let started = (*ACTIVE_STATE.take_started.lock().ok()?)?;
    Some(started.elapsed().as_millis() as u64)
}

pub fn live_lines() -> Vec<LiveLine> {
    ACTIVE_STATE
        .live
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|l| l.lines()))
        .unwrap_or_default()
}

pub fn begin_session(title: &str) -> Result<SessionPaths, String> {
    begin_session_with_emitter(title, "", |_| {})
}

pub fn begin_session_with_emitter(
    title: &str,
    language: &str,
    emit: impl Fn(LiveLine) + Send + 'static,
) -> Result<SessionPaths, String> {
    let mut sess = ACTIVE_STATE
        .session
        .lock()
        .map_err(|_| "session state poisoned")?;
    if sess.is_some() {
        return Err("a meeting is already being recorded".into());
    }
    let paths = session::new_session(title)?;

    let (tap, mut lanes) = live::Tap::with_lanes(2);
    let sys_lane = lanes.pop();
    let mic_lane = lanes.pop();

    if let Some(_mic_l) = mic_lane {
        let _ = whimpr_audio::mic::start_mic_recording(PathBuf::from(&paths.mic_wav));
    }
    if let Some(_sys_l) = sys_lane {
        let _ = whimpr_audio::sysaudio::start_sysaudio_recording(PathBuf::from(&paths.sys_wav));
    }

    let lang = if language.trim().is_empty() {
        None
    } else {
        Some(language.to_string())
    };
    let live_session = live::LiveSession::start(tap, String::new(), lang, emit)?;
    *ACTIVE_STATE.live.lock().map_err(|_| "live state poisoned")? = Some(live_session);
    *ACTIVE_STATE.take_started.lock().map_err(|_| "take_started poisoned")? = Some(Instant::now());
    *sess = Some(paths.clone());

    Ok(paths)
}

pub fn continue_session(dir: &Path, title: &str) -> Result<SessionPaths, String> {
    continue_session_with_emitter(dir, title, "", |_| {})
}

pub fn continue_session_with_emitter(
    dir: &Path,
    title: &str,
    language: &str,
    emit: impl Fn(LiveLine) + Send + 'static,
) -> Result<SessionPaths, String> {
    let mut sess = ACTIVE_STATE
        .session
        .lock()
        .map_err(|_| "session state poisoned")?;
    if sess.is_some() {
        return Err("a meeting is already being recorded".into());
    }
    let paths = session::continue_session(dir, title)?;

    let (tap, mut lanes) = live::Tap::with_lanes(2);
    let sys_lane = lanes.pop();
    let mic_lane = lanes.pop();

    if let Some(_mic_l) = mic_lane {
        let _ = whimpr_audio::mic::start_mic_recording(PathBuf::from(&paths.mic_wav));
    }
    if let Some(_sys_l) = sys_lane {
        let _ = whimpr_audio::sysaudio::start_sysaudio_recording(PathBuf::from(&paths.sys_wav));
    }

    let lang = if language.trim().is_empty() {
        None
    } else {
        Some(language.to_string())
    };
    let live_session = live::LiveSession::start(tap, String::new(), lang, emit)?;
    *ACTIVE_STATE.live.lock().map_err(|_| "live state poisoned")? = Some(live_session);
    *ACTIVE_STATE.take_started.lock().map_err(|_| "take_started poisoned")? = Some(Instant::now());
    *sess = Some(paths.clone());

    Ok(paths)
}

pub fn stop_session(
    model_path: &str,
    language: &str,
) -> Result<session::MeetingResult, String> {
    let paths = {
        let mut sess = ACTIVE_STATE
            .session
            .lock()
            .map_err(|_| "session state poisoned")?;
        sess.take().ok_or("no meeting is being recorded")?
    };
    if let Ok(mut started) = ACTIVE_STATE.take_started.lock() {
        *started = None;
    }

    let progress = ACTIVE_STATE
        .live
        .lock()
        .map_err(|_| "live state poisoned")?
        .take()
        .map(|live| live.finish());

    let _ = whimpr_audio::mic::stop_mic_recording();
    let _ = whimpr_audio::sysaudio::stop_sysaudio_recording();

    let lang = if language.trim().is_empty() {
        None
    } else {
        Some(language.trim())
    };
    let dir = PathBuf::from(&paths.dir);
    let result = session::finish_from_blocks(
        &dir,
        &paths.title,
        paths.segment,
        model_path,
        lang,
        progress,
    )?;
    library::record_transcribed_segment(&dir, paths.segment)?;
    if paths.segment > 1 {
        library::mark_notes_stale(&dir)?;
    }
    Ok(result)
}

pub fn finish_meeting(
    id: &str,
    model_path: &str,
    language: &str,
) -> Result<library::Meeting, String> {
    let meeting = library::meeting(id)?;
    let dir = PathBuf::from(&meeting.dir);

    if is_session_active() {
        if let Ok(guard) = ACTIVE_STATE.session.lock() {
            if let Some(s) = guard.as_ref() {
                if Path::new(&s.dir) == dir {
                    return Err("that meeting is still recording — stop it first".into());
                }
            }
        }
    }
    if meeting.pending_segments.is_empty() {
        return Err("this meeting has already been transcribed".into());
    }

    let lang = if language.trim().is_empty() {
        None
    } else {
        Some(language.trim())
    };

    for segment in &meeting.pending_segments {
        let _ = session::finish(&dir, &meeting.title, *segment, model_path, lang)?;
        library::record_transcribed_segment(&dir, *segment)?;
    }
    library::meeting(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_states_transition_normally() {
        assert!(!is_session_active());
        assert_eq!(session_elapsed_ms(), None);
        assert_eq!(live_lines().len(), 0);
    }
}
