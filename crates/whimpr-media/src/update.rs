//! Update checks against GitHub Releases.
//!
//! Note: There is no release pipeline yet, so update checks currently ship inert.
//!
//! There is no update server. The repository's own releases API is the manifest,
//! and the DMG attached to each release is the download.
//!
//! A release becomes mandatory by including a line in its notes:
//!
//! ```text
//! Whimpr-Minimum-Version: 1.3.0
//! ```
//!
//! Anyone below that is asked to update before continuing. With no such line,
//! a newer release is only an advisory update.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::Serialize;

const RELEASES_LATEST: &str = "https://api.github.com/repos/Blueturboguy07/WhimprFlow/releases/latest";
const RELEASES_BY_TAG: &str = "https://api.github.com/repos/Blueturboguy07/WhimprFlow/releases/tags/";
const REPO_PREFIX: &str = "https://github.com/Blueturboguy07/WhimprFlow/";
const MIN_VERSION_MARKER: &str = "whimpr-minimum-version:";
const LEGACY_MIN_VERSION_MARKER: &str = "oatmeal-minimum-version:";

pub fn current_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    pub latest: Option<String>,
    pub update_available: bool,
    pub mandatory: bool,
    pub minimum: Option<String>,
    pub release_url: Option<String>,
    pub download_url: Option<String>,
    pub checked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn parse_version(raw: &str) -> Option<(u32, u32, u32)> {
    let s = raw.trim();
    let s = s.strip_prefix('v').or_else(|| s.strip_prefix('V')).unwrap_or(s);
    let core = s
        .split(|c: char| c == '-' || c == '+' || c == ' ')
        .next()
        .unwrap_or("");
    if core.is_empty() {
        return None;
    }
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = match parts.next() {
        Some(p) => p.parse().ok()?,
        None => 0,
    };
    let patch = match parts.next() {
        Some(p) => p.parse().ok()?,
        None => 0,
    };
    Some((major, minor, patch))
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse_version(candidate), parse_version(current)) {
        (Some(c), Some(now)) => c > now,
        _ => false,
    }
}

pub fn minimum_from_notes(body: &str) -> Option<String> {
    for line in body.lines() {
        let bare = line.trim_matches(|c: char| {
            c.is_whitespace() || matches!(c, '#' | '*' | '-' | '_' | '>' | '`')
        });
        let lowered = bare.to_ascii_lowercase();
        let marker = if lowered.starts_with(MIN_VERSION_MARKER) {
            MIN_VERSION_MARKER
        } else if lowered.starts_with(LEGACY_MIN_VERSION_MARKER) {
            LEGACY_MIN_VERSION_MARKER
        } else {
            continue;
        };

        let value = bare[marker.len()..]
            .trim_matches(|c: char| c.is_whitespace() || c == '`' || c == '*' || c == '"');
        if !value.is_empty() && value.split(|c: char| c.is_whitespace()).count() == 1 {
            if parse_version(value).is_some() {
                return Some(value.to_string());
            }
        }
    }
    None
}

pub fn status_from_release(doc: &serde_json::Value, current: &str) -> UpdateStatus {
    let latest = doc
        .get("tag_name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string());
    let body = doc.get("body").and_then(|v| v.as_str()).unwrap_or("");
    let minimum = minimum_from_notes(body);

    let release_url = doc
        .get("html_url")
        .and_then(|v| v.as_str())
        .filter(|u| u.starts_with(REPO_PREFIX))
        .map(|s| s.to_string());

    let download_url = doc
        .get("assets")
        .and_then(|v| v.as_array())
        .and_then(|assets| {
            assets
                .iter()
                .filter_map(|a| a.get("browser_download_url").and_then(|v| v.as_str()))
                .find(|u| u.ends_with(".dmg") && u.starts_with(REPO_PREFIX))
        })
        .map(|s| s.to_string());

    UpdateStatus {
        current: current.to_string(),
        update_available: latest.as_deref().map(|l| is_newer(l, current)).unwrap_or(false),
        mandatory: minimum.as_deref().map(|m| is_newer(m, current)).unwrap_or(false),
        latest,
        minimum,
        release_url,
        download_url,
        checked: true,
        error: None,
    }
}

pub fn check() -> UpdateStatus {
    check_with(fetch_latest_release)
}

pub fn check_with(fetch: impl FnOnce() -> Result<Vec<u8>, String>) -> UpdateStatus {
    let unchecked = |error: String| UpdateStatus {
        current: current_version().to_string(),
        checked: false,
        error: Some(error),
        ..Default::default()
    };

    let body = match fetch() {
        Ok(b) => b,
        Err(e) => return unchecked(e),
    };

    match serde_json::from_slice::<serde_json::Value>(&body) {
        Ok(doc) => status_from_release(&doc, current_version()),
        Err(e) => unchecked(format!("could not read the release list: {e}")),
    }
}

fn fetch_latest_release() -> Result<Vec<u8>, String> {
    let out = Command::new("curl")
        .arg("-fsSL")
        .arg("--max-time")
        .arg("10")
        .arg("-H")
        .arg("User-Agent: WhimprFlow")
        .arg("-H")
        .arg("Accept: application/vnd.github+json")
        .arg(RELEASES_LATEST)
        .output();

    match out {
        Ok(o) if o.status.success() => Ok(o.stdout),
        Ok(o) => Err(format!(
            "could not reach GitHub (curl exited {})",
            o.status.code().unwrap_or(-1)
        )),
        Err(e) => Err(format!("could not run curl: {e}")),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotes {
    pub tag: String,
    pub name: String,
    pub body: String,
    pub release_url: Option<String>,
}

pub fn notes_from_release(doc: &serde_json::Value, tag: &str) -> ReleaseNotes {
    let name = doc
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(tag)
        .to_string();
    ReleaseNotes {
        tag: doc
            .get("tag_name")
            .and_then(|v| v.as_str())
            .unwrap_or(tag)
            .to_string(),
        name,
        body: doc
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string(),
        release_url: doc
            .get("html_url")
            .and_then(|v| v.as_str())
            .filter(|u| u.starts_with(REPO_PREFIX))
            .map(|s| s.to_string()),
    }
}

pub fn notes() -> Result<ReleaseNotes, String> {
    notes_with(current_version(), fetch_release_by_tag)
}

pub fn notes_with(
    version: &str,
    fetch: impl FnOnce(&str) -> Result<Vec<u8>, String>,
) -> Result<ReleaseNotes, String> {
    let tag = format!("v{version}");
    let body = fetch(&tag)?;
    let doc: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| format!("could not read the release: {e}"))?;
    if doc.get("tag_name").is_none() {
        return Err(format!("GitHub has no published release for {tag}"));
    }
    Ok(notes_from_release(&doc, &tag))
}

fn fetch_release_by_tag(tag: &str) -> Result<Vec<u8>, String> {
    let url = format!("{RELEASES_BY_TAG}{tag}");
    let out = Command::new("curl")
        .arg("-fsSL")
        .arg("--max-time")
        .arg("10")
        .arg("-H")
        .arg("User-Agent: WhimprFlow")
        .arg("-H")
        .arg("Accept: application/vnd.github+json")
        .arg(&url)
        .output();

    match out {
        Ok(o) if o.status.success() => Ok(o.stdout),
        Ok(o) => Err(format!(
            "could not reach GitHub (curl exited {})",
            o.status.code().unwrap_or(-1)
        )),
        Err(e) => Err(format!("could not run curl: {e}")),
    }
}

pub fn open_download(url: &str) -> Result<(), String> {
    if !url.starts_with(REPO_PREFIX) {
        return Err("refusing to open a link outside the WhimprFlow repository".into());
    }
    Command::new("open")
        .arg(url)
        .status()
        .map_err(|e| format!("open {url}: {e}"))?;
    Ok(())
}

const SWAP_SCRIPT: &str = r#"#!/bin/sh
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
sleep 0.5
rm -rf "$4"
mv "$2" "$4" || exit 1
if ! mv "$3" "$2"; then mv "$4" "$2"; exit 1; fi
rm -rf "$4"
open "$2"
rm -f "$5"
"#;

pub fn bundle_of(exe: &Path) -> Option<&Path> {
    exe.ancestors()
        .nth(3)
        .filter(|p| p.extension().map_or(false, |e| e == "app"))
}

fn writable(dir: &Path) -> bool {
    let probe = dir.join(".whimpr-write-probe");
    match fs::write(&probe, b"") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn run(cmd: &mut Command, what: &str) -> Result<(), String> {
    match cmd.output() {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => {
            let why = String::from_utf8_lossy(&o.stderr);
            let why = why.trim();
            Err(if why.is_empty() {
                format!("{what} failed")
            } else {
                format!("{what} failed: {why}")
            })
        }
        Err(e) => Err(format!("could not run {what}: {e}")),
    }
}

fn app_in(mount: &Path) -> Result<PathBuf, String> {
    fs::read_dir(mount)
        .map_err(|e| format!("could not read the disk image: {e}"))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| p.extension().map_or(false, |e| e == "app"))
        .ok_or_else(|| "the disk image has no application in it".into())
}

pub fn install(url: &str) -> Result<(), String> {
    if !url.starts_with(REPO_PREFIX) || !url.ends_with(".dmg") {
        return Err("refusing to install anything but a disk image from the WhimprFlow repository".into());
    }

    let exe = std::env::current_exe().map_err(|e| format!("could not find the running app: {e}"))?;
    let bundle = bundle_of(&exe)
        .ok_or("WhimprFlow is not running from an .app bundle, so it cannot replace itself")?
        .to_path_buf();
    let parent = bundle
        .parent()
        .ok_or("the installed app has no containing folder")?
        .to_path_buf();
    if !writable(&parent) {
        return Err(format!(
            "WhimprFlow cannot write to {} : install the update from the disk image instead",
            parent.display()
        ));
    }

    let staged = parent.join(".WhimprFlow.app.new");
    let old = parent.join(".WhimprFlow.app.old");

    let work = std::env::temp_dir().join("whimpr-update");
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| format!("could not make a scratch folder: {e}"))?;
    let dmg = work.join("WhimprFlow.dmg");
    let mount = work.join("mnt");

    run(
        Command::new("curl")
            .arg("-fsSL")
            .arg("--max-time")
            .arg("300")
            .arg("-H")
            .arg("User-Agent: WhimprFlow")
            .arg("-o")
            .arg(&dmg)
            .arg(url),
        "downloading the update",
    )?;

    run(
        Command::new("hdiutil")
            .arg("attach")
            .arg(&dmg)
            .arg("-nobrowse")
            .arg("-quiet")
            .arg("-readonly")
            .arg("-mountpoint")
            .arg(&mount),
        "opening the update",
    )?;

    let detach = || {
        let _ = Command::new("hdiutil")
            .arg("detach")
            .arg(&mount)
            .arg("-quiet")
            .output();
    };
    let copied = app_in(&mount).and_then(|app| {
        let _ = fs::remove_dir_all(&staged);
        run(
            Command::new("ditto").arg(&app).arg(&staged),
            "unpacking the update",
        )
    });
    detach();
    if let Err(e) = copied {
        let _ = fs::remove_dir_all(&staged);
        return Err(e);
    }

    let script = work.join("swap.sh");
    fs::write(&script, SWAP_SCRIPT).map_err(|e| format!("could not stage the update: {e}"))?;
    Command::new("/bin/sh")
        .arg(&script)
        .arg(std::process::id().to_string())
        .arg(&bundle)
        .arg(&staged)
        .arg(&old)
        .arg(&dmg)
        .spawn()
        .map_err(|e| format!("could not start the installer: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_numerically_not_lexically() {
        assert!(is_newer("1.10.0", "1.9.0"));
        assert!(!is_newer("1.9.0", "1.10.0"));
        assert!(is_newer("v1.3.0", "1.2.0"));
        assert!(is_newer("2.0.0", "1.99.99"));
        assert!(!is_newer("1.2.0", "1.2.0"));
        assert!(!is_newer("1.2", "1.2.0"));
        assert!(is_newer("1.2.1", "1.2"));
    }

    #[test]
    fn unparseable_versions_are_never_newer() {
        assert!(!is_newer("not-a-version", "1.2.0"));
        assert!(!is_newer("", "1.2.0"));
        assert!(!is_newer("1.3.0", "who knows"));
    }

    #[test]
    fn a_release_is_only_mandatory_when_its_notes_say_so() {
        let plain = serde_json::json!({
            "tag_name": "v1.3.0",
            "body": "## Install\n\nDrag it to Applications.",
            "html_url": "https://github.com/Blueturboguy07/WhimprFlow/releases/tag/v1.3.0",
        });
        let s = status_from_release(&plain, "1.2.0");
        assert!(s.update_available, "1.3.0 is newer than 1.2.0");
        assert!(!s.mandatory, "no marker means no gate");
        assert_eq!(s.minimum, None);
    }

    #[test]
    fn the_marker_makes_older_builds_mandatory() {
        let doc = serde_json::json!({
            "tag_name": "v1.3.0",
            "body": "## Notes\n\n- **Whimpr-Minimum-Version:** `1.3.0`\n\nFixes things.",
        });
        let blocked = status_from_release(&doc, "1.2.0");
        assert_eq!(blocked.minimum.as_deref(), Some("1.3.0"));
        assert!(blocked.mandatory, "1.2.0 is below published minimum");

        let fine = status_from_release(&doc, "1.3.0");
        assert!(!fine.mandatory);
        assert!(!fine.update_available);
    }

    #[test]
    fn a_mangled_marker_fails_open() {
        let doc = serde_json::json!({
            "tag_name": "v1.3.0",
            "body": "Whimpr-Minimum-Version: soon\n",
        });
        let s = status_from_release(&doc, "1.2.0");
        assert_eq!(s.minimum, None, "unparseable minimum must be ignored");
        assert!(!s.mandatory, "typo must not lock out user");
    }

    #[test]
    fn only_repository_urls_are_offered_or_opened() {
        let doc = serde_json::json!({
            "tag_name": "v1.3.0",
            "html_url": "https://evil.example/releases/tag/v1.3.0",
            "assets": [
                { "browser_download_url": "https://evil.example/WhimprFlow.dmg" },
                { "browser_download_url": "https://github.com/Blueturboguy07/WhimprFlow/releases/download/v1.3.0/WhimprFlow-1.3.0.dmg" }
            ],
        });
        let s = status_from_release(&doc, "1.2.0");
        assert_eq!(s.release_url, None, "off-repo release page dropped");
        assert!(s.download_url.unwrap().starts_with(REPO_PREFIX));
        assert!(open_download("https://evil.example/x.dmg").is_err());
    }

    #[test]
    fn the_bundle_is_found_three_levels_above_the_executable() {
        assert_eq!(
            bundle_of(Path::new("/Applications/WhimprFlow.app/Contents/MacOS/whimpr-app")),
            Some(Path::new("/Applications/WhimprFlow.app")),
        );
        assert_eq!(bundle_of(Path::new("/Users/x/whimpr/target/debug/whimpr-app")), None);
        assert_eq!(bundle_of(Path::new("/whimpr-app")), None);
    }

    #[test]
    fn install_refuses_anything_but_a_repository_disk_image() {
        for url in [
            "https://evil.example/WhimprFlow.dmg",
            "https://github.com/someone-else/WhimprFlow/releases/download/v9/WhimprFlow.dmg",
            "https://github.com/Blueturboguy07/WhimprFlow/releases/download/v1.5.1/notes.txt",
        ] {
            assert!(install(url).is_err(), "should have refused {url}");
        }
    }

    #[test]
    fn an_unreachable_check_never_blocks() {
        let s = check_with(|| Err("curl exited 6".into()));
        assert!(!s.checked, "failed fetch must not look checked");
        assert!(!s.mandatory, "being offline must never gate app");
        assert!(!s.update_available);
        assert_eq!(s.latest, None);
        assert_eq!(s.error.as_deref(), Some("curl exited 6"));
        assert_eq!(s.current, current_version());
    }

    #[test]
    fn a_reply_that_is_not_a_release_never_blocks() {
        for body in [
            &b"<html>sign in to continue</html>"[..],
            &b""[..],
            &b"{\"message\":\"API rate limit exceeded\""[..],
        ] {
            let s = check_with(|| Ok(body.to_vec()));
            assert!(!s.checked, "unparseable body should not look checked: {body:?}");
            assert!(!s.mandatory);
            assert!(!s.update_available);
        }
    }

    #[test]
    fn an_empty_release_document_never_blocks() {
        let s = check_with(|| Ok(b"{}".to_vec()));
        assert!(s.checked, "valid JSON did parse");
        assert_eq!(s.latest, None);
        assert!(!s.update_available);
        assert!(!s.mandatory);
    }

    #[test]
    fn the_marker_mentioned_in_prose_does_not_gate() {
        for body in [
            "Mark a release required with `Whimpr-Minimum-Version: 1.3.0` in its notes.",
            "- You can now set Whimpr-Minimum-Version: 9.9.9 to force an update",
            "See the docs for Whimpr-Minimum-Version: 1.3.0 and friends",
            "Legacy Oatmeal-Minimum-Version: 1.3.0 mentioned in notes",
        ] {
            let doc = serde_json::json!({ "tag_name": "v1.3.0", "body": body });
            let s = status_from_release(&doc, "1.2.0");
            assert_eq!(s.minimum, None, "prose should not be read as directive: {body}");
            assert!(!s.mandatory, "prose must not gate app: {body}");
        }
    }

    #[test]
    fn the_marker_on_its_own_line_still_gates() {
        for body in [
            "Whimpr-Minimum-Version: 1.3.0",
            "## Notes\n\nWhimpr-Minimum-Version: 1.3.0\n\nFixes things.",
            "- **Whimpr-Minimum-Version:** `1.3.0`",
            "> Whimpr-Minimum-Version: v1.3.0",
            "Oatmeal-Minimum-Version: 1.3.0",
            "- **Oatmeal-Minimum-Version:** `1.3.0`",
        ] {
            let doc = serde_json::json!({ "tag_name": "v1.3.0", "body": body });
            let s = status_from_release(&doc, "1.2.0");
            assert!(s.minimum.is_some(), "should have found minimum in: {body}");
            assert!(s.mandatory, "should gate 1.2.0: {body}");
        }
    }

    #[test]
    fn notes_are_asked_for_by_the_running_version_s_tag() {
        let mut asked = String::new();
        let got = notes_with("1.10.6", |tag| {
            asked = tag.to_string();
            Ok(br#"{"tag_name":"v1.10.6","name":"Quieter startup","body":"- Fixed a thing\n","html_url":"https://github.com/Blueturboguy07/WhimprFlow/releases/tag/v1.10.6"}"#.to_vec())
        })
        .expect("a well-formed release should parse");
        assert_eq!(asked, "v1.10.6");
        assert_eq!(got.name, "Quieter startup");
        assert_eq!(got.body, "- Fixed a thing");
        assert!(got.release_url.is_some());
    }

    #[test]
    fn a_nameless_release_falls_back_to_its_tag() {
        let doc = serde_json::json!({ "tag_name": "v1.4.0", "name": "  ", "body": "x" });
        assert_eq!(notes_from_release(&doc, "v1.4.0").name, "v1.4.0");
    }

    #[test]
    fn a_tag_with_no_release_is_an_error_not_empty_notes() {
        let err = notes_with("9.9.9", |_| Ok(br#"{"message":"Not Found"}"#.to_vec()))
            .expect_err("a message document is not a release");
        assert!(err.contains("v9.9.9"), "should name tag looked for: {err}");
    }

    #[test]
    fn an_unreachable_github_is_reported() {
        let err = notes_with("1.0.0", |_| Err("could not reach GitHub".into()))
            .expect_err("failed fetch must surface");
        assert_eq!(err, "could not reach GitHub");
    }

    #[test]
    fn a_release_url_outside_the_repo_is_dropped() {
        let doc = serde_json::json!({
            "tag_name": "v1.4.0",
            "body": "x",
            "html_url": "https://evil.example/not-us"
        });
        assert_eq!(notes_from_release(&doc, "v1.4.0").release_url, None);
    }
}
