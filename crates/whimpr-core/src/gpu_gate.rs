// Rate limiting and priority arbitration for the GPU.
//
// Whisper and local LLM share the GPU. Priority order:
// 1. LiveTranscription (highest)
// 2. Dictation (medium)
// 3. NotesAndStudy (lowest)
//
// When multiple tasks contend for the GPU, LiveTranscription is served first
// and never starved.

use std::collections::BinaryHeap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

pub const MIN_INTERVAL: Duration = Duration::from_secs(6);
pub const MAX_QUESTION_CHARS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Priority {
    LiveTranscription = 0,
    Dictation = 1,
    NotesAndStudy = 2,
}

#[derive(Copy, Clone, Eq, PartialEq)]
struct Request {
    priority: Priority,
    id: u64,
}

impl Ord for Request {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Lower priority enum value means HIGHER actual priority in the BinaryHeap.
        // If equal priority, lower id (earlier queued) comes first.
        other
            .priority
            .cmp(&self.priority)
            .then_with(|| other.id.cmp(&self.id))
    }
}

impl PartialOrd for Request {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

struct GateInner {
    in_flight: bool,
    last_started: Option<Instant>,
    min_interval: Duration,
    next_id: u64,
    queue: BinaryHeap<Request>,
}

#[derive(Clone)]
pub struct GpuGate {
    inner: Arc<Mutex<GateInner>>,
    cv: Arc<Condvar>,
}

static GLOBAL_GPU_GATE: std::sync::OnceLock<GpuGate> = std::sync::OnceLock::new();

pub fn global_gpu_gate() -> &'static GpuGate {
    GLOBAL_GPU_GATE.get_or_init(|| GpuGate::with_min_interval(MIN_INTERVAL))
}

pub struct GpuGuard {
    gate: GpuGate,
}

impl Drop for GpuGuard {
    fn drop(&mut self) {
        self.gate.release();
    }
}

impl Default for GpuGate {
    fn default() -> Self {
        Self::new()
    }
}

impl GpuGate {
    pub fn new() -> Self {
        Self::with_min_interval(Duration::ZERO)
    }

    pub fn with_min_interval(min_interval: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(GateInner {
                in_flight: false,
                last_started: None,
                min_interval,
                next_id: 0,
                queue: BinaryHeap::new(),
            })),
            cv: Arc::new(Condvar::new()),
        }
    }

    /// Claim the gate with a priority. Blocks until the gate is available and this request
    /// has the highest priority among waiting requests.
    pub fn acquire(&self, priority: Priority) -> GpuGuard {
        let mut inner = self.inner.lock().unwrap();
        let id = inner.next_id;
        inner.next_id += 1;
        inner.queue.push(Request { priority, id });

        loop {
            if !inner.in_flight {
                if let Some(top) = inner.queue.peek() {
                    if top.id == id {
                        inner.queue.pop();
                        inner.in_flight = true;
                        inner.last_started = Some(Instant::now());
                        return GpuGuard {
                            gate: self.clone(),
                        };
                    }
                }
            }
            inner = self.cv.wait(inner).unwrap();
        }
    }

    /// Try to claim the gate without blocking, honoring interval and current in_flight.
    pub fn try_acquire(&self, priority: Priority) -> Option<GpuGuard> {
        let mut inner = self.inner.lock().unwrap();
        if inner.in_flight {
            return None;
        }
        if let Some(last) = inner.last_started {
            if inner.min_interval > Duration::ZERO
                && Instant::now().duration_since(last) < inner.min_interval
            {
                return None;
            }
        }
        if let Some(top) = inner.queue.peek() {
            if top.priority < priority {
                return None;
            }
        }
        inner.in_flight = true;
        inner.last_started = Some(Instant::now());
        Some(GpuGuard {
            gate: self.clone(),
        })
    }

    fn release(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.in_flight = false;
        self.cv.notify_all();
    }
}

/// Single-flight, rate-limited gate (compatible with Oatmeal's `autoanswer::Gate`).
#[derive(Default)]
pub struct Gate {
    in_flight: bool,
    last_started: Option<Instant>,
}

impl Gate {
    pub fn try_begin(&mut self, now: Instant) -> bool {
        if self.in_flight {
            return false;
        }
        if let Some(last) = self.last_started {
            if now.duration_since(last) < MIN_INTERVAL {
                return false;
            }
        }
        self.in_flight = true;
        self.last_started = Some(now);
        true
    }

    pub fn finish(&mut self) {
        self.in_flight = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simulated_contention_prioritizes_live_transcription() {
        let gate = GpuGate::new();
        // Hold the gate first
        let initial_guard = gate.acquire(Priority::NotesAndStudy);

        let execution_order = Arc::new(Mutex::new(Vec::new()));
        let mut handles = Vec::new();

        // Queue NotesAndStudy first
        let g1 = gate.clone();
        let o1 = execution_order.clone();
        handles.push(std::thread::spawn(move || {
            let _guard = g1.acquire(Priority::NotesAndStudy);
            o1.lock().unwrap().push(Priority::NotesAndStudy);
        }));

        // Allow thread 1 to register in queue
        std::thread::sleep(Duration::from_millis(15));

        // Queue Dictation second
        let g2 = gate.clone();
        let o2 = execution_order.clone();
        handles.push(std::thread::spawn(move || {
            let _guard = g2.acquire(Priority::Dictation);
            o2.lock().unwrap().push(Priority::Dictation);
        }));

        std::thread::sleep(Duration::from_millis(15));

        // Queue LiveTranscription third (latest arrival, highest priority)
        let g3 = gate.clone();
        let o3 = execution_order.clone();
        handles.push(std::thread::spawn(move || {
            let _guard = g3.acquire(Priority::LiveTranscription);
            o3.lock().unwrap().push(Priority::LiveTranscription);
        }));

        std::thread::sleep(Duration::from_millis(20));

        // Release initial hold
        drop(initial_guard);

        for h in handles {
            h.join().unwrap();
        }

        let order = execution_order.lock().unwrap().clone();
        assert_eq!(
            order,
            vec![
                Priority::LiveTranscription,
                Priority::Dictation,
                Priority::NotesAndStudy
            ],
            "LiveTranscription must be served first, then Dictation, then NotesAndStudy"
        );
    }

    #[test]
    fn rate_limiting_gate_works() {
        let mut g = Gate::default();
        let t = Instant::now();
        assert!(g.try_begin(t), "the first claim wins");
        assert!(!g.try_begin(t), "second claim fails while in flight");
        g.finish();
        assert!(!g.try_begin(t + Duration::from_secs(1)), "inside min interval");
        assert!(g.try_begin(t + MIN_INTERVAL), "passes after min interval");
    }
}
