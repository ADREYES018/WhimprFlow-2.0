use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use whisper_rs::{FullParams, SamplingStrategy};

pub const WHISPER_RATE: u32 = 16_000;
const MAX_CONSECUTIVE_REPEATS: usize = 2;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    Accurate,
    Background,
    Fast,
}

fn thread_budget(quality: Quality) -> i32 {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4) as i32;
    match quality {
        Quality::Fast => (cores - 2).max(2),
        Quality::Background => (cores / 3).max(1),
        Quality::Accurate => (cores - 1).max(2),
    }
}

pub struct Transcriber {
    handle: whimpr_asr::registry::ModelHandle,
}

impl Transcriber {
    pub fn load(model_path: &str) -> Result<Self, String> {
        let path = if model_path.trim().is_empty() {
            whimpr_media::model::ensure_whisper_model("base.en")?
        } else {
            PathBuf::from(model_path)
        };
        let handle = whimpr_asr::registry::acquire(path)
            .map_err(|e| format!("acquire asr model: {e}"))?;
        Ok(Self { handle })
    }

    pub fn load_accurate(model_path: &str) -> Result<Self, String> {
        let path = if model_path.trim().is_empty() {
            whimpr_media::model::ensure_whisper_model("large-v3-turbo")
                .or_else(|_| whimpr_media::model::ensure_whisper_model("base.en"))?
        } else {
            PathBuf::from(model_path)
        };
        let handle = whimpr_asr::registry::acquire(path)
            .map_err(|e| format!("acquire asr model: {e}"))?;
        Ok(Self { handle })
    }

    pub fn run(
        &self,
        samples: &[f32],
        language: Option<&str>,
        quality: Quality,
        context: Option<&str>,
    ) -> Result<Transcript, String> {
        if samples.is_empty() {
            return Err("no audio samples to transcribe".into());
        }

        let mut state = self
            .handle
            .engine
            .ctx
            .create_state()
            .map_err(|e| format!("create whisper state: {e}"))?;

        let strategy = match quality {
            Quality::Accurate | Quality::Background => SamplingStrategy::BeamSearch {
                beam_size: 5,
                patience: 0.0,
            },
            Quality::Fast => SamplingStrategy::Greedy { best_of: 1 },
        };
        let mut params = FullParams::new(strategy);
        if matches!(quality, Quality::Fast) {
            params.set_temperature_inc(0.0);
        }
        params.set_language(Some(language.unwrap_or("auto")));
        params.set_n_threads(thread_budget(quality));
        if let Some(ctx) = context.filter(|c| !c.trim().is_empty() && !c.contains('\0')) {
            params.set_initial_prompt(ctx);
        }
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        state
            .full(params, samples)
            .map_err(|e| format!("whisper inference failed: {e}"))?;

        let mut raw_segments = Vec::new();
        let n = state.full_n_segments();
        for i in 0..n {
            if let Some(seg) = state.get_segment(i) {
                let s = seg.to_str().unwrap_or_default();
                raw_segments.push(Segment {
                    start_cs: seg.start_timestamp(),
                    end_cs: seg.end_timestamp(),
                    text: collapse_repeated_sentences(s),
                });
            }
        }
        let segments = collapse_repeated_segments(raw_segments);

        let mut text = String::new();
        for seg in &segments {
            let trimmed = seg.text.trim();
            if !trimmed.is_empty() {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(trimmed);
            }
        }

        Ok(Transcript { segments, text })
    }
}

pub fn transcribe_samples(
    model_path: &str,
    samples: &[f32],
    language: Option<&str>,
) -> Result<Transcript, String> {
    Transcriber::load_accurate(model_path)?.run(samples, language, Quality::Accurate, None)
}

pub fn load_wav_mono_16k(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    let spec = reader.spec();
    let channels = spec.channels as usize;

    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?
        }
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|s| s.map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?,
    };

    let mono: Vec<f32> = if channels <= 1 {
        interleaved
    } else {
        interleaved
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    Ok(whimpr_audio::resample_to_16k(&mono, spec.sample_rate))
}

pub(crate) fn normalize_for_repeat_check(s: &str) -> String {
    s.trim()
        .trim_end_matches(|c: char| matches!(c, '.' | '!' | '?'))
        .to_lowercase()
}

fn sentences(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        if matches!(bytes[i], b'.' | b'!' | b'?') {
            while i + 1 < bytes.len() && matches!(bytes[i + 1], b'.' | b'!' | b'?') {
                i += 1;
            }
            let mut end = i + 1;
            while end < bytes.len() && bytes[end] == b' ' {
                end += 1;
            }
            out.push(&text[start..end]);
            start = end;
            i = end;
            continue;
        }
        i += 1;
    }
    if start < text.len() {
        out.push(&text[start..]);
    }
    out
}

fn collapse_repeated_sentences(text: &str) -> String {
    let parts = sentences(text);
    let mut out = String::with_capacity(text.len());
    let mut last_norm = String::new();
    let mut run = 0usize;
    for part in parts {
        let norm = normalize_for_repeat_check(part);
        if norm.is_empty() {
            last_norm.clear();
            run = 0;
            out.push_str(part);
            continue;
        }
        if norm == last_norm {
            run += 1;
        } else {
            last_norm = norm;
            run = 1;
        }
        if run <= MAX_CONSECUTIVE_REPEATS {
            out.push_str(part);
        }
    }
    out
}

fn collapse_repeated_segments(raw: Vec<Segment>) -> Vec<Segment> {
    let mut out = Vec::with_capacity(raw.len());
    let mut last_norm = String::new();
    let mut run = 0usize;
    for seg in raw {
        let norm = normalize_for_repeat_check(&seg.text);
        if norm.is_empty() {
            last_norm.clear();
            run = 0;
            out.push(seg);
            continue;
        }
        if norm == last_norm {
            run += 1;
        } else {
            last_norm = norm;
            run = 1;
        }
        if run <= MAX_CONSECUTIVE_REPEATS {
            out.push(seg);
        }
    }
    out
}
