use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use crate::WhisperEngine;

static REGISTRY: OnceLock<Mutex<HashMap<PathBuf, Weak<WhisperEngine>>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<PathBuf, Weak<WhisperEngine>>> {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct ModelHandle {
    pub engine: Arc<WhisperEngine>,
}

impl Drop for ModelHandle {
    fn drop(&mut self) {
        let engine = Arc::clone(&self.engine);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            drop(engine);
        });
    }
}

pub fn acquire(path: PathBuf) -> anyhow::Result<ModelHandle> {
    let mut map = registry().lock().unwrap();
    if let Some(weak) = map.get(&path) {
        if let Some(engine) = weak.upgrade() {
            return Ok(ModelHandle { engine });
        }
    }
    
    let engine = Arc::new(WhisperEngine::load(&path)?);
    map.insert(path, Arc::downgrade(&engine));
    Ok(ModelHandle { engine })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_loads_and_shares() {
        // Find the real model downloaded in Task 4
        let home = std::env::var("HOME").unwrap();
        let path = PathBuf::from(home).join("Library/Application Support/WhimprFlow/models/ggml-base.en.bin");
        if !path.exists() {
            return; // Skip test in environments without the model
        }
        
        let h1 = acquire(path.clone()).unwrap();
        let h2 = acquire(path.clone()).unwrap();
        
        // Assert backed by same context
        assert!(Arc::ptr_eq(&h1.engine, &h2.engine));
        
        // Assert still alive
        let weak = Arc::downgrade(&h1.engine);
        drop(h1);
        assert!(weak.upgrade().is_some());
        
        // Assert unloaded
        drop(h2);
        // Wait for the background idle timer to drop the engine
        std::thread::sleep(Duration::from_millis(150));
        assert!(weak.upgrade().is_none());
    }
}
