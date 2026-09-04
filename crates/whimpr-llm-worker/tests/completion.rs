use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct Msg {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct Request {
    messages: Vec<Msg>,
    stream: bool,
    max_tokens: i32,
}

#[derive(Deserialize, Debug)]
struct Response {
    text: Option<String>,
    chunk: Option<String>,
    error: Option<String>,
}

fn worker_bin() -> PathBuf {
    let mut p = std::env::current_exe().unwrap();
    p.pop();
    if p.ends_with("deps") {
        p.pop();
    }
    p.join("whimpr-llm-worker")
}

fn get_model_path() -> String {
    std::env::var("HOME").unwrap_or_default()
        + "/Library/Application Support/WhimprFlow/models/qwen2.5-0.5b-instruct-q4_k_m.gguf"
}

/// Run: `cargo test -p whimpr-llm-worker -- --ignored`
#[test]
#[ignore]
fn streaming_completion_yields_chunks_then_full_text() {
    let bin = worker_bin();
    // Build the worker binary first.
    let status = Command::new("cargo")
        .args(["build", "-p", "whimpr-llm-worker"])
        .status()
        .unwrap();
    assert!(status.success());

    let mut child = Command::new(&bin)
        .arg(get_model_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("failed to spawn worker");

    let req = Request {
        messages: vec![Msg {
            role: "user".to_string(),
            content: "Write a short haiku about a robot.".to_string(),
        }],
        stream: true,
        max_tokens: 50,
    };

    let mut stdin = child.stdin.take().unwrap();
    let mut line = serde_json::to_string(&req).unwrap();
    line.push('\n');
    stdin.write_all(line.as_bytes()).unwrap();
    stdin.flush().unwrap();

    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    
    let mut chunks = 0;
    let mut final_text = String::new();
    
    for l in reader.lines() {
        let l = l.unwrap();
        let resp: Response = serde_json::from_str(&l).unwrap();
        if let Some(err) = resp.error {
            panic!("Worker error: {}", err);
        }
        if let Some(_) = resp.chunk {
            chunks += 1;
        }
        if let Some(text) = resp.text {
            final_text = text;
            break; // Done
        }
    }
    
    child.kill().unwrap();
    child.wait().unwrap();
    
    assert!(chunks >= 2, "Expected at least 2 chunks, got {}", chunks);
    assert!(!final_text.is_empty(), "Final text should not be empty");
}
