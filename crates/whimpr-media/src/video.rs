//! YouTube as a source for a note: fetch a video's audio, transcribe the
//! stretch the user watched, and file it beside the meeting's own transcript.

use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};

/// The stretch of a video to transcribe, in seconds from its start.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Range {
    pub start_secs: f64,
    pub end_secs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Segment {
    pub start_cs: i64,
    pub end_cs: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Transcript {
    pub segments: Vec<Segment>,
    pub text: String,
}

/// The eleven-character video id out of any YouTube URL shape.
pub fn video_id(url: &str) -> Result<String, String> {
    let url = url.trim();
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.strip_prefix("www.").unwrap_or(host);
    let host = host.strip_prefix("m.").unwrap_or(host);

    let raw = match host {
        "youtu.be" => path.split(['?', '&', '/']).next().unwrap_or(""),
        "youtube.com" => {
            if let Some(embed) = path.strip_prefix("embed/") {
                embed.split(['?', '&', '/']).next().unwrap_or("")
            } else {
                let (route, query) = path.split_once('?').unwrap_or((path, ""));
                if route != "watch" {
                    return Err("that is not a YouTube video link".into());
                }
                query
                    .split('&')
                    .find_map(|pair| pair.strip_prefix("v="))
                    .unwrap_or("")
            }
        }
        _ => return Err("WhimprFlow can only read YouTube links".into()),
    };

    let ok = raw.len() == 11
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !ok {
        return Err("that link does not contain a video id".into());
    }
    Ok(raw.to_string())
}

/// `90`, `12:30` or `1:05:20` to seconds.
pub fn parse_timestamp(s: &str) -> Result<f64, String> {
    let s = s.trim();
    if s.is_empty() {
        return Err("empty timestamp".into());
    }
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() > 3 {
        return Err(format!("{s} is not a time"));
    }
    let mut nums = Vec::with_capacity(parts.len());
    for p in &parts {
        let n: f64 = p
            .parse()
            .map_err(|_| format!("{s} is not a time (use 12:30 or 1:05:20)"))?;
        if n < 0.0 {
            return Err(format!("{s} is not a time"));
        }
        nums.push(n);
    }
    if nums.len() > 1 && nums[1..].iter().any(|n| *n >= 60.0) {
        return Err(format!("{s} is not a time: minutes and seconds run 0 to 59"));
    }
    Ok(match nums.as_slice() {
        [s] => *s,
        [m, s] => m * 60.0 + s,
        [h, m, s] => h * 3600.0 + m * 60.0 + s,
        _ => unreachable!("length checked above"),
    })
}

const MIN_RANGE_SECS: f64 = 1.0;

/// Turn input times into a range inside a video of `duration_secs`.
/// Blank start means beginning; blank end means end of video.
pub fn parse_range(start: &str, end: &str, duration_secs: f64) -> Result<Range, String> {
    let start_secs = if start.trim().is_empty() {
        0.0
    } else {
        parse_timestamp(start)?
    };
    let end_secs = if end.trim().is_empty() {
        duration_secs
    } else {
        parse_timestamp(end)?
    };

    if start_secs >= duration_secs {
        return Err(format!(
            "that video is only {} long: the start time is past the end of it",
            human(duration_secs)
        ));
    }
    let end_secs = end_secs.min(duration_secs);
    if end_secs - start_secs < MIN_RANGE_SECS {
        return Err("that range is empty: the end time must come after the start".into());
    }
    Ok(Range {
        start_secs,
        end_secs,
    })
}

fn human(secs: f64) -> String {
    let total = secs.max(0.0) as u64;
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

const YT_DLP_VERSION: &str = "2026.07.04";

pub fn yt_dlp_path() -> PathBuf {
    crate::model::support_root().join("bin").join("yt-dlp")
}

pub fn ensure_yt_dlp() -> Result<PathBuf, String> {
    let dest = yt_dlp_path();
    if dest.is_file() {
        return Ok(dest);
    }
    let dir = dest.parent().expect("yt_dlp_path always has a parent");
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    let url = format!(
        "https://github.com/yt-dlp/yt-dlp/releases/download/{YT_DLP_VERSION}/yt-dlp_macos"
    );
    let part = dest.with_extension("part");
    let status = Command::new("curl")
        .arg("-L")
        .arg("-f")
        .arg("--connect-timeout")
        .arg("30")
        .arg("--speed-limit")
        .arg("1024")
        .arg("--speed-time")
        .arg("120")
        .arg("-o")
        .arg(&part)
        .arg(&url)
        .status()
        .map_err(|e| format!("could not run curl: {e}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&part);
        return Err(
            "could not download YouTube helper: check your connection and try again".into(),
        );
    }

    make_executable(&part)?;
    std::fs::rename(&part, &dest).map_err(|e| format!("install yt-dlp: {e}"))?;
    Ok(dest)
}

fn make_executable(p: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(p)
            .map_err(|e| format!("stat {}: {e}", p.display()))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(p, perms).map_err(|e| format!("chmod {}: {e}", p.display()))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub duration_secs: f64,
}

pub fn probe(url: &str) -> Result<VideoInfo, String> {
    let id = video_id(url)?;
    let exe = ensure_yt_dlp()?;
    let out = Command::new(&exe)
        .arg("--dump-json")
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg(format!("https://www.youtube.com/watch?v={id}"))
        .output()
        .map_err(|e| format!("could not run YouTube helper: {e}"))?;

    if !out.status.success() {
        return Err(yt_dlp_error(&String::from_utf8_lossy(&out.stderr)));
    }
    parse_probe_json(&String::from_utf8_lossy(&out.stdout))
}

pub fn parse_probe_json(json: &str) -> Result<VideoInfo, String> {
    let v: serde_json::Value =
        serde_json::from_str(json.trim()).map_err(|_| "could not read video details".to_string())?;
    let duration = v
        .get("duration")
        .and_then(|d| d.as_f64())
        .filter(|d| *d > 0.0)
        .ok_or("video has no length readable by WhimprFlow: live streams cannot be imported")?;
    Ok(VideoInfo {
        id: v.get("id").and_then(|s| s.as_str()).unwrap_or_default().to_string(),
        title: v
            .get("title")
            .and_then(|s| s.as_str())
            .unwrap_or("Untitled video")
            .to_string(),
        duration_secs: duration,
    })
}

fn yt_dlp_error(stderr: &str) -> String {
    let low = stderr.to_lowercase();
    if low.contains("private video") {
        "that video is private".into()
    } else if low.contains("sign in to confirm your age") || low.contains("age-restricted") {
        "that video is age-restricted, so WhimprFlow cannot read it".into()
    } else if low.contains("video unavailable") || low.contains("removed") {
        "that video is not available".into()
    } else if low.contains("not available in your country") || low.contains("geo") {
        "that video is not available in your region".into()
    } else if low.contains("unable to extract") || low.contains("nsig") || low.contains("player response") || low.contains("page needs to be reloaded") {
        "YouTube changed format WhimprFlow helper does not understand yet: updating WhimprFlow should fix it".into()
    } else {
        let tail = stderr.trim().lines().last().unwrap_or("").trim();
        if tail.is_empty() {
            "could not read that video".into()
        } else {
            format!("could not read that video: {tail}")
        }
    }
}

pub fn slice_range(samples: &[f32], range: Range, rate: u32) -> Result<Vec<f32>, String> {
    let rate = rate as f64;
    let start = (range.start_secs * rate).round().max(0.0) as usize;
    let end = ((range.end_secs * rate).round().max(0.0) as usize).min(samples.len());
    if start >= samples.len() {
        return Err("range starts after the end of the audio".into());
    }
    if end <= start {
        return Err("range is empty".into());
    }
    Ok(samples[start..end].to_vec())
}

pub fn download_audio(id: &str, dest_dir: &Path) -> Result<PathBuf, String> {
    let exe = ensure_yt_dlp()?;
    let out_tpl = dest_dir.join(format!("{id}.%(ext)s"));
    let out = Command::new(&exe)
        .arg("-f")
        .arg("bestaudio[ext=m4a]")
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg("-o")
        .arg(&out_tpl)
        .arg(format!("https://www.youtube.com/watch?v={id}"))
        .output()
        .map_err(|e| format!("could not run YouTube helper: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.to_lowercase().contains("requested format is not available") {
            return Err("that video has no audio track WhimprFlow can read".into());
        }
        return Err(yt_dlp_error(&stderr));
    }

    let path = dest_dir.join(format!("{id}.m4a"));
    if !path.is_file() {
        return Err("the download finished but produced no audio file".into());
    }
    Ok(path)
}

pub fn decode_m4a(path: &Path) -> Result<(Vec<f32>, u32), String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::errors::Error as SymphoniaError;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("m4a");

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("audio not in a format WhimprFlow can read: {e}"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("download contains no audio track")?;
    let track_id = track.id;
    let n_frames = track.codec_params.n_frames;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("cannot decode audio: {e}"))?;

    let mut samples: Vec<f32> = match n_frames {
        Some(n) => Vec::with_capacity(n as usize),
        None => Vec::new(),
    };
    let mut rate = 0u32;
    let mut buf: Option<SampleBuffer<f32>> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(e) => {
                return Err(format!(
                    "audio ended unexpectedly ({e}): try importing again"
                ));
            }
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let spec = *decoded.spec();
        rate = spec.rate;
        let channels = spec.channels.count().max(1);
        let sb = buf.get_or_insert_with(|| {
            SampleBuffer::<f32>::new(decoded.capacity() as u64, spec)
        });
        sb.copy_interleaved_ref(decoded);
        for frame in sb.samples().chunks(channels) {
            samples.push(frame.iter().sum::<f32>() / channels as f32);
        }
    }

    if samples.is_empty() || rate == 0 {
        return Err("audio decoded to nothing".into());
    }
    Ok((samples, rate))
}

pub fn next_video_path(dir: &Path) -> PathBuf {
    for n in 1..u32::MAX {
        let p = dir.join(format!("video-{n}.md"));
        if !p.exists() {
            return p;
        }
    }
    unreachable!("a meeting will not hold four billion videos")
}

pub fn render_markdown(
    info: &VideoInfo,
    range: Range,
    transcript: &Transcript,
) -> String {
    format!(
        "# {title}\n\n_From https://www.youtube.com/watch?v={id} : {start} to {end}_\n\n\
         ## Transcript\n\n{text}\n",
        title = info.title,
        id = info.id,
        start = human(range.start_secs),
        end = human(range.end_secs),
        text = transcript.text.trim(),
    )
}

pub fn ensure_whisper() -> Result<PathBuf, String> {
    crate::model::ensure_whisper_model("large-v3-turbo")
        .or_else(|_| crate::model::ensure_whisper_model("base.en"))
}

pub fn meeting_dir(id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || Path::new(id).components().count() != 1
    {
        return Err(format!("invalid meeting id: {id}"));
    }
    let root = crate::model::support_root().join("recordings");
    let flat = root.join(id);
    if flat.is_dir() {
        return Ok(flat);
    }
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let nested = p.join(id);
                if nested.is_dir() {
                    return Ok(nested);
                }
            }
        }
    }
    Err(format!("no such meeting: {id}"))
}

pub fn mark_notes_stale(dir: &Path) -> Result<(), String> {
    let meta_path = dir.join("meta.json");
    let mut meta = if meta_path.is_file() {
        let text = std::fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        serde_json::from_str::<serde_json::Value>(&text).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let Some(obj) = meta.as_object_mut() {
        obj.insert("notes_stale".into(), serde_json::Value::Bool(true));
        let serialized = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        std::fs::write(&meta_path, serialized).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn transcribe_samples(model_path: &Path, samples: &[f32]) -> Result<Transcript, String> {
    use whimpr_core::AsrEngine;
    let handle = whimpr_asr::registry::acquire(model_path.to_path_buf())
        .map_err(|e| format!("acquire whisper engine: {e}"))?;
    let asr_transcript = handle.engine.transcribe(samples)
        .map_err(|e| format!("transcription failed: {e}"))?;
    Ok(Transcript {
        segments: vec![],
        text: asr_transcript.text,
    })
}

pub fn import(meeting_id: &str, url: &str, start: &str, end: &str) -> Result<String, String> {
    let dir = meeting_dir(meeting_id)?;
    let info = probe(url)?;
    let range = parse_range(start, end, info.duration_secs)?;
    let model_path = ensure_whisper()?;

    let scratch = std::env::temp_dir().join(format!("whimpr-video-{}", info.id));
    std::fs::create_dir_all(&scratch).map_err(|e| format!("create scratch dir: {e}"))?;
    let audio = download_audio(&info.id, &scratch);
    let result = audio.and_then(|path| {
        let decoded = decode_m4a(&path);
        let _ = std::fs::remove_file(&path);
        let (samples, rate) = decoded?;
        let samples = whimpr_audio::resample_to_16k(&samples, rate);
        let cut = slice_range(&samples, range, 16_000)?;
        transcribe_samples(&model_path, &cut)
    });
    let _ = std::fs::remove_dir_all(&scratch);
    let transcript = result?;

    let path = next_video_path(&dir);
    std::fs::write(&path, render_markdown(&info, range, &transcript))
        .map_err(|e| format!("write {}: {e}", path.display()))?;

    if let Err(e) = mark_notes_stale(&dir) {
        eprintln!("[whimpr] video imported but could not flag notes stale: {e}");
    }
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slices_the_requested_seconds_out_of_the_samples() {
        let samples: Vec<f32> = (0..160_000).map(|i| i as f32).collect();
        let cut = slice_range(
            &samples,
            Range { start_secs: 2.0, end_secs: 5.0 },
            16_000,
        )
        .unwrap();
        assert_eq!(cut.len(), 48_000);
        assert_eq!(cut[0], 32_000.0);
        assert_eq!(*cut.last().unwrap(), 79_999.0);
    }

    #[test]
    fn a_slice_past_the_end_of_the_audio_is_clamped_not_a_panic() {
        let samples: Vec<f32> = vec![1.0; 16_000 * 10];
        let cut = slice_range(
            &samples,
            Range { start_secs: 9.0, end_secs: 12.0 },
            16_000,
        )
        .unwrap();
        assert_eq!(cut.len(), 16_000);
    }

    #[test]
    fn refuses_a_slice_that_starts_past_the_audio() {
        let samples: Vec<f32> = vec![1.0; 16_000];
        assert!(slice_range(&samples, Range { start_secs: 5.0, end_secs: 8.0 }, 16_000).is_err());
    }

    #[test]
    fn reads_the_id_out_of_every_youtube_url_shape() {
        for url in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=dQw4w9WgXcQ",
            "http://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2",
            "https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?t=90",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "  https://youtu.be/dQw4w9WgXcQ  ",
        ] {
            assert_eq!(video_id(url).unwrap(), "dQw4w9WgXcQ", "failed on {url}");
        }
    }

    #[test]
    fn refuses_anything_that_is_not_a_youtube_video() {
        for url in [
            "",
            "not a url",
            "https://example.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/",
            "https://www.youtube.com/watch?v=",
            "https://vimeo.com/12345",
            "https://www.youtube.com/playlist?list=PL123",
            "https://www.youtube.com/@someone",
        ] {
            assert!(video_id(url).is_err(), "should have rejected {url}");
        }
    }

    #[test]
    fn parses_the_timestamp_shapes_a_person_actually_types() {
        assert_eq!(parse_timestamp("0").unwrap(), 0.0);
        assert_eq!(parse_timestamp("90").unwrap(), 90.0);
        assert_eq!(parse_timestamp("12:30").unwrap(), 750.0);
        assert_eq!(parse_timestamp("1:05:20").unwrap(), 3920.0);
        assert_eq!(parse_timestamp("01:05:20").unwrap(), 3920.0);
        assert_eq!(parse_timestamp(" 12:30 ").unwrap(), 750.0);
    }

    #[test]
    fn refuses_malformed_timestamps() {
        for s in ["", "abc", "12:", ":30", "1:2:3:4", "-5", "12:60", "1:70:00", "12.5.6"] {
            assert!(parse_timestamp(s).is_err(), "should have rejected {s:?}");
        }
    }

    #[test]
    fn an_empty_range_means_the_whole_video() {
        let r = parse_range("", "", 600.0).unwrap();
        assert_eq!(r.start_secs, 0.0);
        assert_eq!(r.end_secs, 600.0);
    }

    #[test]
    fn a_blank_end_runs_to_the_end_of_the_video() {
        let r = parse_range("2:00", "", 600.0).unwrap();
        assert_eq!(r.start_secs, 120.0);
        assert_eq!(r.end_secs, 600.0);
    }

    #[test]
    fn an_end_past_the_duration_is_clamped_not_rejected() {
        let r = parse_range("0:00", "10:00", 570.0).unwrap();
        assert_eq!(r.end_secs, 570.0);
    }

    #[test]
    fn refuses_a_range_that_cannot_describe_anything() {
        assert!(parse_range("20:00", "25:00", 600.0).is_err());
        assert!(parse_range("5:00", "2:00", 600.0).is_err());
        assert!(parse_range("5:00", "5:00", 600.0).is_err());
        assert!(parse_range("5:00", "5:00.5", 600.0).is_err());
    }

    #[test]
    fn the_yt_dlp_path_sits_under_the_support_root() {
        let p = yt_dlp_path();
        assert!(p.ends_with("bin/yt-dlp"), "unexpected path {}", p.display());
        assert!(p.to_string_lossy().contains("WhimprFlow"));
    }

    #[test]
    fn reads_title_and_duration_out_of_a_probe() {
        let json = r#"{"id":"dQw4w9WgXcQ","title":"Lecture 4 : Ecology","duration":3672.0,"other":"ignored"}"#;
        let info = parse_probe_json(json).unwrap();
        assert_eq!(info.id, "dQw4w9WgXcQ");
        assert_eq!(info.title, "Lecture 4 : Ecology");
        assert_eq!(info.duration_secs, 3672.0);
    }

    #[test]
    fn accepts_an_integer_duration() {
        let json = r#"{"id":"dQw4w9WgXcQ","title":"T","duration":212}"#;
        assert_eq!(parse_probe_json(json).unwrap().duration_secs, 212.0);
    }

    #[test]
    fn refuses_a_probe_with_no_usable_duration() {
        for json in [
            r#"{"id":"x","title":"Live now","duration":null}"#,
            r#"{"id":"x","title":"No duration"}"#,
            r#"{"id":"x","title":"Zero","duration":0}"#,
            "not json at all",
        ] {
            assert!(parse_probe_json(json).is_err(), "should have rejected {json}");
        }
    }

    #[test]
    fn video_transcripts_number_upwards_within_a_meeting() {
        let dir = std::env::temp_dir().join("whimpr-video-numbering");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        assert!(next_video_path(&dir).ends_with("video-1.md"));
        std::fs::write(dir.join("video-1.md"), "x").unwrap();
        assert!(next_video_path(&dir).ends_with("video-2.md"));
        std::fs::write(dir.join("video-2.md"), "x").unwrap();
        assert!(next_video_path(&dir).ends_with("video-3.md"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_written_markdown_records_where_the_words_came_from() {
        let info = VideoInfo {
            id: "dQw4w9WgXcQ".into(),
            title: "Lecture 4 : Ecology".into(),
            duration_secs: 3672.0,
        };
        let transcript = Transcript {
            text: "carbon sinks and the nitrogen cycle".into(),
            segments: vec![],
        };
        let md = render_markdown(&info, Range { start_secs: 750.0, end_secs: 1680.0 }, &transcript);

        assert!(md.contains("Lecture 4 : Ecology"), "title missing:\n{md}");
        assert!(md.contains("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "url missing:\n{md}");
        assert!(md.contains("12:30"), "start missing:\n{md}");
        assert!(md.contains("28:00"), "end missing:\n{md}");
        assert!(md.contains("carbon sinks and the nitrogen cycle"), "words missing:\n{md}");

        fn strip_markup(s: &str) -> String {
            let mut out = Vec::new();
            for line in s.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('#') || (trimmed.starts_with('_') && trimmed.ends_with('_')) {
                    continue;
                }
                out.push(line);
            }
            out.join("\n").trim().to_string()
        }

        let stripped = strip_markup(&md);
        assert!(!stripped.contains("youtube.com"), "url leaked into source text: {stripped}");
        assert!(stripped.contains("carbon sinks"), "words lost: {stripped}");
    }
}
