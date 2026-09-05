//! Optional, informational eval harness for the dictation self-correction repair
//! rule (SYSTEM_PROMPT + FEW_SHOT in crates/whimpr-core/src/cleanup/prompts.rs).
//!
//! This calls a real cloud model, so it is `#[ignore]`d by default and never
//! runs as part of `cargo test`. Run it explicitly:
//!
//!   OPENAI_API_KEY=... cargo test -p whimpr-core --test repair_eval -- --ignored
//!
//! With no API key set it skips cleanly instead of failing, so it is safe to
//! leave in CI without ever gating a build on live model output. It reuses the
//! existing OpenAiProvider from whimpr-cleanup (the same provider seam the real
//! app uses) rather than a parallel HTTP client, so this is a dev-only,
//! integration-test-only dependency (see whimpr-core/Cargo.toml).

use serde::Deserialize;
use whimpr_cleanup::OpenAiProvider;
use whimpr_core::cleanup::{parse_response, CleanupContext, CleanupProvider, ModelResponse};

#[derive(Deserialize)]
struct Case {
    raw: String,
    expected: String,
    kind: String,
}

fn normalize(s: &str) -> String {
    s.trim().split_whitespace().collect::<Vec<_>>().join(" ").to_ascii_lowercase()
}

#[test]
#[ignore]
fn repair_eval_against_a_live_provider() {
    let Ok(api_key) = std::env::var("OPENAI_API_KEY") else {
        eprintln!(
            "repair_eval: OPENAI_API_KEY not set, skipping. This eval only runs \
             when explicitly invoked with a key present."
        );
        return;
    };

    let fixture_path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/speech_repair_cases.json");
    let fixture_raw = std::fs::read_to_string(fixture_path)
        .unwrap_or_else(|e| panic!("failed to read {fixture_path}: {e}"));
    let cases: Vec<Case> =
        serde_json::from_str(&fixture_raw).unwrap_or_else(|e| panic!("failed to parse fixture: {e}"));

    let model = std::env::var("REPAIR_EVAL_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
    let provider = OpenAiProvider::new(api_key, model);
    let ctx = CleanupContext::default();

    let mut ran = 0usize;
    let mut per_kind_pass: std::collections::HashMap<String, (usize, usize)> = std::collections::HashMap::new();

    for case in &cases {
        ran += 1;
        let entry = per_kind_pass.entry(case.kind.clone()).or_insert((0, 0));
        entry.1 += 1;

        let actual = match provider.cleanup(&case.raw, &ctx) {
            Ok(envelope) => match parse_response(&envelope) {
                ModelResponse::Dictate(text) => text,
                ModelResponse::Command { .. } => {
                    eprintln!("repair_eval [{}]: provider returned a command envelope, treating as a mismatch", case.kind);
                    String::new()
                }
            },
            Err(e) => {
                eprintln!("repair_eval [{}]: provider call failed: {e}", case.kind);
                continue;
            }
        };

        let matched = normalize(&actual) == normalize(&case.expected);
        if matched {
            entry.0 += 1;
        } else {
            println!(
                "MISMATCH [{}]\n  raw:      {}\n  expected: {}\n  actual:   {}",
                case.kind, case.raw, case.expected, actual
            );
        }
    }

    println!("\nrepair_eval pass rate by kind:");
    let mut kinds: Vec<&String> = per_kind_pass.keys().collect();
    kinds.sort();
    for kind in kinds {
        let (pass, total) = per_kind_pass[kind];
        println!("  {kind}: {pass}/{total}");
    }

    // Informational only. A pass-rate threshold would gate CI on live model
    // behavior, which the brief explicitly rules out; this only asserts the
    // harness itself ran the full fixture set.
    assert_eq!(ran, cases.len(), "repair_eval should attempt every fixture case");
}
