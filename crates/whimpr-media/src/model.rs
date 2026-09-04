// Model management — fetch ggml model files on first run.
//
// Rather than pull in an async HTTP stack, we shell out to `curl` (always present
// on macOS). Downloads are resumable (`-C -`) and atomic-ish: fetch to a `.part`
// file and rename on success, so a half-download never looks like a valid model.
//
// Two families live here: Whisper (speech-to-text) and the local chat model used
// for note summaries and recaps. They differ only in size and URL.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

pub struct ModelSpec {
    pub name: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub approx_mb: u32,
}

pub const WHISPER_MODELS: &[ModelSpec] = &[
    ModelSpec {
        name: "base.en",
        file: "ggml-base.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        approx_mb: 148,
    },
    ModelSpec {
        name: "small.en",
        file: "ggml-small.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
        approx_mb: 466,
    },
    ModelSpec {
        name: "medium.en",
        file: "ggml-medium.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
        approx_mb: 1533,
    },
    ModelSpec {
        name: "large-v3-turbo",
        file: "ggml-large-v3-turbo-q8_0.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin",
        approx_mb: 833,
    },
];

pub fn whisper_model(name: &str) -> Option<&'static ModelSpec> {
    WHISPER_MODELS.iter().find(|m| m.name == name)
}

fn app_support_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(base).join("WhimprFlow")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support/WhimprFlow")
    }
}

pub fn support_root() -> PathBuf {
    app_support_dir()
}

pub fn model_dir() -> PathBuf {
    app_support_dir().join("models")
}

pub fn ensure_whisper_model(setting_name: &str) -> Result<PathBuf, String> {
    ensure_whisper_model_in(&model_dir(), setting_name)
}

/// As `ensure_whisper_model`, but against an explicit directory. Split out so a
/// test can prove an already-present model short-circuits the download without
/// reaching into the real application-support directory.
fn ensure_whisper_model_in(dir: &Path, setting_name: &str) -> Result<PathBuf, String> {
    let name = if setting_name.is_empty() || setting_name == "auto" {
        "ggml-base.en.bin"
    } else {
        setting_name
    };

    let spec = WHISPER_MODELS
        .iter()
        .find(|m| m.file == name || m.name == name)
        .or_else(|| WHISPER_MODELS.first())
        .unwrap();

    let dest = dir.join(spec.file);
    if is_present(&dest) {
        return Ok(dest);
    }
    download_to(&dest, spec.url)?;
    Ok(dest)
}

pub fn model_status(file: &str) -> Option<u64> {
    let dest = model_dir().join(file);
    if is_present(&dest) {
        Some(file_len(&dest))
    } else {
        None
    }
}

pub const CHAT_MODEL_FILE: &str = "qwen2.5-3b-instruct-q4_k_m.gguf";
const CHAT_MODEL_URL: &str = "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf";
pub const CHAT_MODEL_APPROX_MB: u32 = 1930;

pub fn chat_model_path() -> PathBuf {
    if let Ok(env) = std::env::var("OATMEAL_LLM") {
        if !env.trim().is_empty() {
            return PathBuf::from(env);
        }
    }
    model_dir().join(CHAT_MODEL_FILE)
}

pub fn ensure_chat_model() -> Result<PathBuf, String> {
    let dest = chat_model_path();
    if is_present(&dest) {
        return Ok(dest);
    }
    if dest.file_name().and_then(|f| f.to_str()) != Some(CHAT_MODEL_FILE) {
        return Err(format!(
            "no model at {} — OATMEAL_LLM points somewhere WhimprFlow can't download",
            dest.display()
        ));
    }
    download_to(&dest, CHAT_MODEL_URL)?;
    Ok(dest)
}

pub fn is_present(p: &Path) -> bool {
    file_len(p) > 1_000_000
}

/// Serialises downloads. Five commands can reach `ensure_chat_model` at once
/// (the chip, notes, recap, follow-up and library recall), and without a lock
/// they race on one `.part`: curl resumes with `O_APPEND`, so the loser keeps
/// writing into the inode the winner has already renamed into place. Both curls
/// exit 0, so nothing downstream notices the model is now interleaved garbage —
/// and `is_present`'s 1 MB floor calls it valid forever after.
fn download_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// What the server says the file should weigh, via a HEAD request. `None` when
/// it won't say, which just means we can't size-check this one.
fn remote_size(url: &str) -> Option<u64> {
    let out = Command::new("curl")
        .arg("-sfIL")
        .arg("--connect-timeout")
        .arg("30")
        .arg(url)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // Redirects mean several header blocks; the last Content-Length is the one
    // describing the body we'd actually receive.
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.split_once(':'))
        .filter(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .filter_map(|(_, v)| v.trim().parse::<u64>().ok())
        .last()
}

pub(crate) fn download_to(dest: &Path, url: &str) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create models dir {}: {e}", parent.display()))?;
    }

    let _guard = download_lock()
        .lock()
        .map_err(|_| "model download state poisoned".to_string())?;

    // Whoever held the lock may have just finished the very file we want.
    if is_present(dest) {
        return Ok(());
    }

    let part = dest.with_extension("part");
    let expected = remote_size(url);

    // A `.part` at or past the full size makes curl's resume ask for a range the
    // server can't satisfy. It answers 416, and curl treats that as "already
    // complete" and exits 0 *even under -f* — promoting a stale or truncated
    // file to a real model. Start that one over instead.
    if let Some(exp) = expected {
        if file_len(&part) >= exp {
            let _ = std::fs::remove_file(&part);
        }
    }

    let status = Command::new("curl")
        .arg("-L") // follow redirects (HF serves a CDN redirect)
        .arg("-f") // fail on HTTP errors instead of writing an error body
        .arg("-C")
        .arg("-") // resume a partial download if one exists
        .arg("--connect-timeout")
        .arg("30")
        // Without these a stalled transfer — dead CDN node, captive portal,
        // laptop asleep — hangs the command forever with no way to cancel.
        .arg("--speed-limit")
        .arg("1024")
        .arg("--speed-time")
        .arg("120")
        .arg("-o")
        .arg(&part)
        .arg(url)
        .status()
        .map_err(|e| format!("spawn curl: {e}"))?;

    // Every failure below removes the `.part`. Leaving it behind orphaned
    // gigabytes the user couldn't find, and wedged every retry at the same
    // offset — a Range-stripping proxy made that unrecoverable without deleting
    // the file by hand.
    if !status.success() {
        let _ = std::fs::remove_file(&part);
        return Err(format!(
            "curl exited with {} while downloading the model",
            status.code().unwrap_or(-1)
        ));
    }
    let got = file_len(&part);
    if got < 1_000_000 {
        let _ = std::fs::remove_file(&part);
        return Err("downloaded model looks truncated".into());
    }
    if let Some(exp) = expected {
        if got != exp {
            let _ = std::fs::remove_file(&part);
            return Err(format!("downloaded model is {got} bytes, expected {exp}"));
        }
    }

    std::fs::rename(&part, dest)
        .map_err(|e| format!("finalize model file {}: {e}", dest.display()))?;
    Ok(())
}

fn file_len(p: &Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Bodies have to clear `is_present`'s 1 MB floor to be treated as a model.
    const BODY: usize = 2 * 1024 * 1024;

    #[derive(Clone, Copy)]
    enum Mode {
        /// Serves the whole body, honouring `Range` like HuggingFace does.
        Full,
        /// Refuses with a 500, the way an expired CDN signature does.
        Fail500,
        /// Advertises the full length but hangs up halfway — a truncated body
        /// that still claims to be complete.
        Short,
    }

    /// A range-capable HTTP server on an ephemeral port. Enough of the protocol
    /// to exercise `download_to`'s real curl invocation without the network.
    fn serve(mode: Mode) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        std::thread::spawn(move || {
            let body = vec![b'x'; BODY];
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { continue };
                let mut buf = Vec::new();
                let mut tmp = [0u8; 1024];
                while let Ok(n) = s.read(&mut tmp) {
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let req = String::from_utf8_lossy(&buf).to_string();
                let is_head = req.starts_with("HEAD");
                let start = req
                    .lines()
                    .find(|l| l.to_ascii_lowercase().starts_with("range:"))
                    .and_then(|l| l.split("bytes=").nth(1))
                    .and_then(|r| r.trim().trim_end_matches('-').parse::<usize>().ok())
                    .unwrap_or(0)
                    .min(body.len());

                if matches!(mode, Mode::Fail500) {
                    let _ = s.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }

                let rest = &body[start..];
                let head = if start > 0 {
                    format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\n\r\n",
                        rest.len(), start, body.len() - 1, body.len()
                    )
                } else {
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n\r\n",
                        rest.len()
                    )
                };
                if s.write_all(head.as_bytes()).is_err() {
                    continue;
                }
                if is_head {
                    continue;
                }
                let send = match mode {
                    Mode::Short => &rest[..rest.len() / 2],
                    _ => rest,
                };
                let _ = s.write_all(send);
                let _ = s.flush();
            }
        });
        format!("http://127.0.0.1:{port}/model.bin")
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("oatmeal-model-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).expect("scratch dir");
        d.join("ggml-test.bin")
    }

    /// Two callers racing on one destination must not interleave into the same
    /// `.part`. Before the lock, curl resumed with `O_APPEND` and the loser kept
    /// writing into the file the winner had already renamed — both exited 0, and
    /// the result was a model of the wrong size that `is_present` blessed forever.
    #[test]
    fn concurrent_downloads_produce_one_valid_file() {
        let url = serve(Mode::Full);
        let dest = scratch("concurrent");

        let handles: Vec<_> = (0..2)
            .map(|_| {
                let (d, u) = (dest.clone(), url.clone());
                std::thread::spawn(move || download_to(&d, &u))
            })
            .collect();
        for h in handles {
            h.join().expect("thread").expect("download should succeed");
        }

        assert_eq!(
            file_len(&dest),
            BODY as u64,
            "final model is not exactly the served size — the downloads interleaved"
        );
        assert!(
            !dest.with_extension("part").exists(),
            "a .part survived a successful download"
        );
    }

    /// A failed download used to leave its `.part` behind: gigabytes the user
    /// couldn't find, and — because curl resumes from whatever is there — every
    /// retry wedged at the same offset. A Range-stripping proxy made that
    /// unrecoverable without deleting the file by hand.
    ///
    /// Seeded with a leftover `.part` because that is the state the bug actually
    /// produces; an unseeded 500 never creates one, so it would pass either way.
    #[test]
    fn a_failed_download_leaves_no_part_file() {
        let url = serve(Mode::Fail500);
        let dest = scratch("failed");
        let part = dest.with_extension("part");
        std::fs::write(&part, vec![b'x'; 4096]).expect("seed a stale .part");

        assert!(download_to(&dest, &url).is_err(), "a 500 must not succeed");
        assert!(
            !part.exists(),
            ".part orphaned after a failed download — the next retry will resume from it"
        );
        assert!(!dest.exists(), "a failed download must not produce a model");
    }

    /// A body shorter than advertised must never be renamed into place. The old
    /// code trusted curl's exit status plus a 1 MB floor, so a truncated file
    /// well over 1 MB became the model.
    #[test]
    fn a_short_download_is_rejected_before_rename() {
        let url = serve(Mode::Short);
        let dest = scratch("short");

        assert!(
            download_to(&dest, &url).is_err(),
            "a truncated body must be rejected"
        );
        assert!(!dest.exists(), "a truncated body was renamed into place");
        assert!(
            !dest.with_extension("part").exists(),
            ".part orphaned after a truncated download"
        );
    }

    /// An already-downloaded model must be returned as-is. If this regresses,
    /// every launch re-fetches gigabytes over the network, so the test drives
    /// `ensure_whisper_model_in` itself rather than the `is_present` gate it
    /// happens to use: the point is that the download is never reached, and only
    /// the real function can show that. It stays offline for the same reason —
    /// a seeded model means no request is ever made.
    #[test]
    fn ensure_whisper_model_returns_existing_without_download() {
        let dir = scratch("existing").parent().unwrap().to_path_buf();
        let seeded = dir.join("ggml-base.en.bin");
        std::fs::write(&seeded, vec![b'x'; 2_000_000]).unwrap();

        let got = ensure_whisper_model_in(&dir, "auto").expect("a present model must be returned");
        assert_eq!(got, seeded);
        assert!(
            !dir.join("ggml-base.en.bin.part").exists(),
            "a present model must not start a download"
        );
    }

    /// A `.part` alone is a half-finished download, never a usable model. If it
    /// counted as present, whisper would be handed a truncated file.
    #[test]
    fn a_part_file_alone_does_not_count_as_a_present_model() {
        let dir = scratch("partonly").parent().unwrap().to_path_buf();
        std::fs::write(dir.join("ggml-base.en.bin.part"), vec![b'x'; 2_000_000]).unwrap();
        assert!(!is_present(&dir.join("ggml-base.en.bin")));
    }

    #[test]
    fn part_file_is_not_a_valid_model() {
        let dest = scratch("partfile");
        let part = dest.with_extension("part");
        std::fs::write(&part, vec![b'x'; 2_000_000]).unwrap();
        assert!(!is_present(&dest));
    }
}
