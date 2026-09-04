use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, Weak};
use std::time::Duration;

use crate::WhisperEngine;

/// How long a model stays resident after its last handle drops.
///
/// The point of the registry is that dictation's small model and a meeting's
/// large one do not both sit in memory forever, while a model in active use is
/// not reloaded between uses. A window this long covers the gap between two
/// dictations or two meeting chunks; anything much shorter and every pause pays
/// a full model load, which is the cost the registry exists to avoid.
pub const IDLE_UNLOAD: Duration = Duration::from_secs(60);

struct Slot {
    /// The live engine, if one is loaded. Weak so handles decide its lifetime.
    engine: Weak<WhisperEngine>,
    /// A strong reference held for `IDLE_UNLOAD` after the last handle drops, so
    /// a reacquire inside the window costs nothing.
    idle: Option<Arc<WhisperEngine>>,
    /// Bumped on every acquire. An idle timer holding a stale generation has been
    /// superseded by a later acquire and does nothing.
    generation: u64,
    /// Held while this path is loading, so two threads never load the same model
    /// twice. Per-path, so loading one model does not block acquiring another.
    load: Arc<Mutex<()>>,
}

impl Slot {
    fn new() -> Self {
        Self {
            engine: Weak::new(),
            idle: None,
            generation: 0,
            load: Arc::new(Mutex::new(())),
        }
    }
}

static REGISTRY: OnceLock<Mutex<HashMap<PathBuf, Slot>>> = OnceLock::new();

/// Lock the registry, recovering from a poisoned mutex rather than panicking.
///
/// A panic while the map was held used to poison it permanently, which took down
/// dictation and every kind of transcription for the rest of the process. The map
/// holds nothing a panic can leave in a dangerous state: a stale `Weak` simply
/// fails to upgrade and is replaced by a fresh load.
fn lock_registry() -> MutexGuard<'static, HashMap<PathBuf, Slot>> {
    REGISTRY
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

pub struct ModelHandle {
    pub engine: Arc<WhisperEngine>,
    /// Which slot this handle came from, so its drop can schedule the unload.
    path: PathBuf,
}

impl Drop for ModelHandle {
    fn drop(&mut self) {
        let engine = Arc::clone(&self.engine);
        let path = self.path.clone();

        let generation = {
            let mut map = lock_registry();
            match map.get_mut(&path) {
                Some(slot) => {
                    slot.idle = Some(engine);
                    slot.generation
                }
                // No slot means the registry was cleared under us. Dropping the
                // local strong reference here is the whole cleanup.
                None => return,
            }
        };

        std::thread::spawn(move || {
            std::thread::sleep(IDLE_UNLOAD);
            let mut map = lock_registry();
            if let Some(slot) = map.get_mut(&path) {
                // A reacquire since bumped the generation. That acquire owns the
                // lifetime now and will schedule its own unload.
                if slot.generation == generation {
                    slot.idle = None;
                }
            }
        });
    }
}

pub fn acquire(path: PathBuf) -> anyhow::Result<ModelHandle> {
    // Already resident, either in use or inside its idle window.
    let load_lock = {
        let mut map = lock_registry();
        let slot = map.entry(path.clone()).or_insert_with(Slot::new);
        if let Some(engine) = slot.engine.upgrade() {
            slot.generation += 1;
            // The handle keeps it alive from here, so stop holding it idle.
            slot.idle = None;
            return Ok(ModelHandle { engine, path });
        }
        slot.load.clone()
    };

    // Load with the registry lock released. A large model takes seconds to load,
    // and holding the map across that blocked acquiring an unrelated model that
    // was already resident, including live transcription's.
    let _loading = load_lock.lock().unwrap_or_else(|e| e.into_inner());

    // Another thread may have finished loading this same path while we waited on
    // its load lock.
    {
        let mut map = lock_registry();
        if let Some(slot) = map.get_mut(&path) {
            if let Some(engine) = slot.engine.upgrade() {
                slot.generation += 1;
                slot.idle = None;
                return Ok(ModelHandle { engine, path });
            }
        }
    }

    let engine = Arc::new(WhisperEngine::load(&path)?);
    {
        let mut map = lock_registry();
        let slot = map.entry(path.clone()).or_insert_with(Slot::new);
        slot.engine = Arc::downgrade(&engine);
        slot.idle = None;
        slot.generation += 1;
    }
    Ok(ModelHandle { engine, path })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_path() -> Option<PathBuf> {
        let home = std::env::var("HOME").ok()?;
        let path = PathBuf::from(home)
            .join("Library/Application Support/WhimprFlow/models/ggml-base.en.bin");
        path.exists().then_some(path)
    }

    #[test]
    fn acquire_loads_and_shares() {
        let Some(path) = model_path() else {
            return; // No model in this environment.
        };

        let h1 = acquire(path.clone()).unwrap();
        let h2 = acquire(path.clone()).unwrap();

        // Both handles are backed by one engine, which is the point of sharing.
        assert!(Arc::ptr_eq(&h1.engine, &h2.engine));

        let weak = Arc::downgrade(&h1.engine);
        drop(h1);
        assert!(weak.upgrade().is_some(), "still held by h2");

        // Dropping the last handle keeps the model warm for IDLE_UNLOAD instead
        // of unloading immediately, so a reacquire does not pay a second load.
        // The unload itself is not asserted here: waiting out the window would
        // put a minute of sleep in the suite.
        drop(h2);
        std::thread::sleep(Duration::from_millis(150));
        assert!(
            weak.upgrade().is_some(),
            "the model should stay resident through its idle window"
        );

        // Reacquiring inside the window reuses that same engine.
        let h3 = acquire(path).unwrap();
        assert!(
            Arc::ptr_eq(&h3.engine, &weak.upgrade().unwrap()),
            "a reacquire inside the idle window should not reload"
        );
    }

    /// A panic while the registry was held used to poison the mutex, and every
    /// later acquire panicked on `unwrap` for the rest of the process. One bad
    /// model file took out dictation and all transcription until restart.
    #[test]
    fn a_poisoned_registry_does_not_break_every_later_acquire() {
        let missing = PathBuf::from("/nonexistent/whimpr-poison-test.bin");

        // Poison the registry from another thread.
        let poisoner = std::thread::spawn(|| {
            let _map = lock_registry();
            panic!("poison the registry on purpose");
        });
        assert!(poisoner.join().is_err(), "the poisoning thread must panic");

        // A missing model is an error, not a panic, and the registry is still
        // usable afterwards.
        assert!(acquire(missing.clone()).is_err());
        assert!(acquire(missing).is_err());
    }
}
