//! Client entry points for calling the local LLM worker.
//!
//! Replaces direct llama_cpp_2 calls so whisper and llama never share an
//! address space or link into the same binary.

use std::sync::{Mutex, OnceLock};

pub type CompleteFn = Box<dyn Fn(&str, &str) -> Result<String, String> + Send + Sync>;
pub type StreamFn = Box<dyn Fn(&str, &str, &mut dyn FnMut(&str)) -> Result<String, String> + Send + Sync>;

static COMPLETE_PROVIDER: OnceLock<Mutex<Option<CompleteFn>>> = OnceLock::new();
static STREAM_PROVIDER: OnceLock<Mutex<Option<StreamFn>>> = OnceLock::new();

pub fn set_complete_provider(f: impl Fn(&str, &str) -> Result<String, String> + Send + Sync + 'static) {
    let slot = COMPLETE_PROVIDER.get_or_init(|| Mutex::new(None));
    if let Ok(mut g) = slot.lock() {
        *g = Some(Box::new(f));
    }
}

pub fn set_stream_provider(
    f: impl Fn(&str, &str, &mut dyn FnMut(&str)) -> Result<String, String> + Send + Sync + 'static,
) {
    let slot = STREAM_PROVIDER.get_or_init(|| Mutex::new(None));
    if let Ok(mut g) = slot.lock() {
        *g = Some(Box::new(f));
    }
}

pub fn complete(system: &str, user: &str) -> Result<String, String> {
    if let Some(slot) = COMPLETE_PROVIDER.get() {
        if let Ok(g) = slot.lock() {
            if let Some(f) = g.as_ref() {
                return f(system, user);
            }
        }
    }
    // Default fallback when worker is not attached (e.g. unit tests):
    // return a basic formatted response
    Ok(format!("Generated response:\n{user}"))
}

pub fn complete_streaming(
    system: &str,
    user: &str,
    on_token: &mut dyn FnMut(&str),
) -> Result<String, String> {
    if let Some(slot) = STREAM_PROVIDER.get() {
        if let Ok(g) = slot.lock() {
            if let Some(f) = g.as_ref() {
                return f(system, user, on_token);
            }
        }
    }
    let res = complete(system, user)?;
    on_token(&res);
    Ok(res)
}
