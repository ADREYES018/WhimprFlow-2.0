//! Spoken mathematics to LaTeX via the local LLM worker, gated behind the GPU gate
//! at the lowest priority.

use whimpr_core::gpu_gate::{Priority, MAX_QUESTION_CHARS};

pub const MATH_MAX_TOKENS: usize = 120;

pub const MATH_SYSTEM: &str = "\
You convert one line of spoken mathematics, already transcribed by automatic speech \
recognition, into LaTeX. The line may contain transcription errors or filler words: read \
through it and typeset what was actually meant.

Reply with the LaTeX only: no prose, no restating the input, and no \\( \\) or $ delimiters \
around it: just the expression itself.

You may use only these commands, and no others: \\frac, \\sqrt, \\int, \\sum, \\prod, \\lim, \
\\max, \\min, \\sup, \\inf, \\big|, \\Big|, \\bigg|, \\Bigg| (an evaluation bar, e.g. \
\\bigg|_0^2), ^, _; the Greek letters \\alpha, \\beta, \\gamma, \\delta, \\Delta, \\epsilon, \
\\varepsilon, \\theta, \\lambda, \\mu, \\pi, \\rho, \\sigma, \\Sigma, \\tau, \\phi, \\varphi, \
\\psi, \\omega, \\Omega (no others: if the letter you need is not in this list, spell its \
name out in words); the functions \\sin, \\cos, \\tan, \\sec, \\csc, \\cot, \\arcsin, \\arccos, \
\\arctan, \\sinh, \\cosh, \\tanh, \\log, \\ln, \\exp, \\gcd, \\deg; and \\cdot, \\times, \\div, \
\\pm, \\leq, \\geq, \\neq, \\ll, \\gg, \\to, \\rightarrow, \\Rightarrow, \\mapsto, \\approx, \
\\equiv, \\propto, \\sim, \\in, \\notin, \\subset, \\subseteq, \\cup, \\cap, \\forall, \\exists, \
\\partial, \\nabla, \\infty, \\perp, \\parallel, \\angle. Never use anything outside that set: \
including matrices, cases, aligned equations, \\binom, and chemical notation.

If the line is not mathematics, or you cannot tell what was meant, reply with an empty string.";

pub fn from_speech(speech: &str) -> Result<String, String> {
    from_speech_streaming(speech, &mut |_| {})
}

pub fn from_speech_streaming(
    speech: &str,
    on_token: &mut dyn FnMut(&str),
) -> Result<String, String> {
    let speech = speech.trim();
    if speech.is_empty() {
        return Err("no speech to convert".into());
    }
    if speech.chars().count() > MAX_QUESTION_CHARS {
        return Err("speech is too long to convert".into());
    }

    // Acquire gate at lowest priority (NotesAndStudy)
    let _guard = whimpr_core::gpu_gate::global_gpu_gate().acquire(Priority::NotesAndStudy);

    whimpr_core::local_llm::complete_streaming(MATH_SYSTEM, speech, on_token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_speech_is_rejected() {
        assert!(from_speech("").is_err());
        assert!(from_speech("   ").is_err());
    }

    #[test]
    fn excessively_long_speech_is_rejected() {
        let long = "x ".repeat(MAX_QUESTION_CHARS + 1);
        assert!(from_speech(&long).is_err());
    }

    #[test]
    fn converts_speech_to_latex() {
        let res = from_speech("integral of x squared dx").unwrap();
        assert!(!res.is_empty());
    }

    #[test]
    fn streams_tokens_during_conversion() {
        let mut tokens = Vec::new();
        let res = from_speech_streaming("x plus y equals z", &mut |t| {
            tokens.push(t.to_string());
        })
        .unwrap();
        assert!(!tokens.is_empty());
        assert!(!res.is_empty());
    }
}
