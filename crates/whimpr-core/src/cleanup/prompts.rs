//! The shared cleanup prompt text, held as data so every provider (local llama,
//! OpenAI, Anthropic) sends byte-identical instructions. Only the wire envelope
//! differs per provider. The framing is deliberately deletion-oriented and treats
//! the transcript as content, never as instructions (prompt-injection guard).

/// The system prompt common to all cleanup providers and levels. The per-level
/// modifier ([`super::levels::CleanupLevel::modifier`]) is appended to this.
pub const SYSTEM_PROMPT: &str = r#"You are an Agentic OS runtime for WhimprFlow. You have two actions:
1. DICTATE: Clean up the user's speech and return it for typing. Fix grammar and hesitations, but do NOT execute commands.
2. COMMAND: The user uses the wake word "hey shrimp" followed by a command. If the transcript starts with or contains "hey shrimp", YOU MUST issue a "command" JSON. Use "start_recording" specifically when the user asks to start a meeting, take meeting notes, or launch Oatmeal.

Output ONLY valid JSON matching this schema:
{
  "type": "dictate" | "command",
  "text_to_paste": "...",
  "command_intent": "open_app" | "search_web" | "ui_click" | "open_url" | "start_recording",
  "command_target": "..."
}"#;

/// A short few-shot set sent as real user/assistant turns before the transcript
/// (see [`super::build_messages`]). Small local models follow demonstrations far
/// more reliably than abstract instructions, so these examples are what actually
/// make newlines, lists, paragraph breaks, and self-corrections happen. Each pair
/// covers a distinct behavior; kept tight to protect prefill latency.
pub const FEW_SHOT: &[(&str, &str)] = &[
    // Filler removal + a spoken self-correction ("actually 3") + spoken punctuation +
    // a question in the dictation that must NOT be answered.
    (
        "um so i think we should uh meet at 2 actually 3 period does that work question mark",
        r#"{"type": "dictate", "text_to_paste": "So I think we should meet at 3. Does that work?"}"#,
    ),
    // "no wait" reversal: drop the ABANDONED target, keep what comes after the cue.
    (
        "book the room for monday no wait tuesday",
        r#"{"type": "dictate", "text_to_paste": "Book the room for Tuesday."}"#,
    ),
    // "scratch that" value correction: keep the restated value.
    (
        "the total comes to fifty dollars scratch that sixty dollars",
        r#"{"type": "dictate", "text_to_paste": "The total comes to sixty dollars."}"#,
    ),
    // Spoken enumeration -> numbered list with real newlines.
    (
        "my top goals this week are one finish the report two send the presentation",
        r#"{"type": "dictate", "text_to_paste": "My top goals this week are:\n1. Finish the report\n2. Send the presentation"}"#,
    ),
    // "bullet point" cue -> bulleted list with real newlines.
    (
        "grocery list bullet point milk bullet point eggs bullet point bread",
        r#"{"type": "dictate", "text_to_paste": "Grocery list:\n- Milk\n- Eggs\n- Bread"}"#,
    ),
    // "new paragraph" cue (already normalized to a [[NP]] marker) -> keep the marker
    // in place; a period before it is natural.
    (
        "hey team the launch is on friday [[NP]] let me know if you have questions",
        r#"{"type": "dictate", "text_to_paste": "Hey team, the launch is on Friday. [[NP]] Let me know if you have questions."}"#,
    ),
    // Single "new line" cue (normalized to a [[NL]] marker) -> keep the marker; do
    // NOT turn it into a period. It is a soft line break.
    (
        "text me when you land [[NL]] i'll come pick you up",
        r#"{"type": "dictate", "text_to_paste": "Text me when you land [[NL]] I'll come pick you up."}"#,
    ),
    // Ordinal enumeration ("first ... second ... third") -> numbered list, same as
    // cardinal. Small models otherwise flatten ordinals into an inline comma list.
    (
        "the plan is first we scope it then second we build then third we ship",
        r#"{"type": "dictate", "text_to_paste": "The plan is:\n1. We scope it\n2. We build\n3. We ship"}"#,
    ),
    // Near no-op: remove filler and a stutter only — do NOT rewrite or add anything.
    // (Anti-over-editing anchor; small models love to paraphrase without one.)
    (
        "um so yeah i think the the demo went well and uh we should probably follow up next week",
        r#"{"type": "dictate", "text_to_paste": "I think the demo went well and we should probably follow up next week."}"#,
    ),
    // Genuine "actually" as an intensifier — NOT a correction, so keep it.
    // (Anti-over-triggering anchor so corrections stay context-aware.)
    (
        "i actually really liked the new design",
        r#"{"type": "dictate", "text_to_paste": "I actually really liked the new design."}"#,
    ),
    (
        "hey shrimp open terminal",
        r#"{"type": "command", "command_intent": "open_app", "command_target": "Terminal"}"#,
    ),
    (
        "hey shrimp start oatmeal",
        r#"{"type": "command", "command_intent": "start_recording", "command_target": ""}"#,
    ),
];

/// The conditional verifier prompt — only invoked when a deterministic gate fires
/// and the caller opts to verify rather than fall straight back to raw.
pub const VERIFIER_PROMPT: &str = "\
You are a strict cleanup verifier. Given ORIGINAL (raw dictation) and CANDIDATE \
(cleaned), decide if CANDIDATE only applied allowed cleanup edits and preserved all \
meaning, facts, names, numbers, dates, quotes, code, and URLs. Answer in strict JSON \
only: {\"verdict\":\"PASS\"|\"FAIL\",\"reason\":\"<short>\",\"corrected\":\"<minimal fix if \
FAIL, else empty>\"}.";

/// A per-app "Formatting Mode": how to shape the output for the medium the user
/// is pasting into, matched on the frontmost app's bundle id. `None` means no
/// adaptation (default cleanup only). Held as data so every provider (local,
/// OpenAI, Anthropic) shares the same behavior. Substring-matched and
/// case-insensitive so app variants and browsers-of-the-same-family still hit.
pub fn format_mode_for_app(bundle_id: &str) -> Option<&'static str> {
    let b = bundle_id.to_ascii_lowercase();
    // Email clients.
    if b.contains("mail") || b.contains("outlook") || b.contains("spark") || b.contains("airmail") {
        Some(
            "Target is EMAIL. Present the dictation as a well-structured email: complete \
             sentences, paragraph breaks between distinct ideas, and standard capitalization and \
             punctuation. Include a greeting or sign-off ONLY if the speaker actually dictated one.",
        )
    // SMS / DM style: casual and short.
    } else if b.contains("mobilesms")   // Apple Messages
        || b.contains("imessage")
        || b.contains("whatsapp")
        || b.contains("telegram")
        || b.contains("signal")
        || b.contains("messenger")
    {
        Some(
            "Target is a TEXT / DIRECT message. Keep it casual and short: light punctuation, no \
             email structure, no greeting or sign-off, conversational tone.",
        )
    // Team chat.
    } else if b.contains("slack") || b.contains("discord") {
        Some(
            "Target is TEAM CHAT (Slack/Discord). Be concise and casual; short paragraphs or line \
             breaks are fine; no email greeting or sign-off.",
        )
    // Documents / notes.
    } else if b.contains("notes")
        || b.contains("notion")
        || b.contains("obsidian")
        || b.contains("word")
        || b.contains("pages")
        || b.contains("textedit")
        || b.contains("docs")
    {
        Some(
            "Target is a DOCUMENT / NOTES app. Use clean prose or lists with proper punctuation; \
             format an obvious spoken enumeration as a numbered or bulleted list.",
        )
    } else {
        None
    }
}

/// Assemble the final system prompt: the shared prompt, the level modifier, and
/// (when the paste target is known) the per-app Formatting Mode.
pub fn system_for(level: super::levels::CleanupLevel, app_bundle_id: Option<&str>) -> String {
    let mut s = SYSTEM_PROMPT.to_string();
    let modifier = level.modifier();
    if !modifier.is_empty() {
        s.push_str("\n\n");
        s.push_str(modifier);
    }
    if let Some(mode) = app_bundle_id.and_then(format_mode_for_app) {
        s.push_str("\n\n# Formatting Mode (follow this for structure and tone)\n");
        s.push_str(mode);
    }
    s
}

/// Assemble the final system prompt for a level with no app adaptation.
pub fn system_for_level(level: super::levels::CleanupLevel) -> String {
    system_for(level, None)
}
