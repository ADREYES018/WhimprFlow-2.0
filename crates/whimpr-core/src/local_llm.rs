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

/// Drop any registered provider. Test-only: it exists so tests in other crates
/// can assert the unattached path, which must error rather than fabricate text.
pub fn clear_providers_for_tests() {
    if let Some(slot) = COMPLETE_PROVIDER.get() {
        if let Ok(mut g) = slot.lock() {
            *g = None;
        }
    }
    if let Some(slot) = STREAM_PROVIDER.get() {
        if let Ok(mut g) = slot.lock() {
            *g = None;
        }
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
    // No provider registered means the worker was never wired in (or failed to
    // start). Fail loudly: silently echoing the prompt back reads as a real
    // answer in the UI, which is worse than an error.
    Err("local LLM not attached".to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex as StdMutex, MutexGuard};

    // The providers are process-wide statics, so the tests that install one must
    // not interleave.
    static SERIAL: StdMutex<()> = StdMutex::new(());

    fn serial() -> MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn clear_providers() {
        clear_providers_for_tests();
    }

    #[test]
    fn complete_errors_when_no_provider_is_registered() {
        let _guard = serial();
        clear_providers();
        let err = complete("sys", "hello").unwrap_err();
        assert!(err.contains("not attached"), "got {err}");
    }

    #[test]
    fn complete_dispatches_to_the_registered_provider() {
        let _guard = serial();
        clear_providers();
        set_complete_provider(|system, user| Ok(format!("{system}|{user}")));
        assert_eq!(complete("sys", "hello").unwrap(), "sys|hello");
        clear_providers();
    }

    #[test]
    fn streaming_falls_back_to_complete_and_emits_one_token() {
        let _guard = serial();
        clear_providers();
        set_complete_provider(|_, user| Ok(format!("done: {user}")));
        let mut seen = String::new();
        let out = complete_streaming("sys", "hi", &mut |t| seen.push_str(t)).unwrap();
        assert_eq!(out, "done: hi");
        assert_eq!(seen, "done: hi");
        clear_providers();
    }

    #[test]
    fn streaming_dispatches_to_the_registered_stream_provider() {
        let _guard = serial();
        clear_providers();
        set_stream_provider(|_, user, on_token| {
            on_token("a");
            on_token("b");
            Ok(user.to_string())
        });
        let mut seen = String::new();
        let out = complete_streaming("sys", "hi", &mut |t| seen.push_str(t)).unwrap();
        assert_eq!(out, "hi");
        assert_eq!(seen, "ab");
        clear_providers();
    }
}
