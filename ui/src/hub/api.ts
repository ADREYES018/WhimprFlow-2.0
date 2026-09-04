// Typed wrappers over the Tauri command surface. In a plain browser (vite dev
// without the shell) the invoke import fails and we fall back to defaults so the
// Hub still renders for iteration.

export type CleanupMode = "raw" | "local" | "open_ai" | "anthropic";
export type CleanupLevel = "none" | "light" | "medium" | "high";

export interface Settings {
  cleanup_mode: CleanupMode;
  cleanup_level: CleanupLevel;
  openai_model: string;
  // API root for "OpenAI" mode — leave blank for OpenAI itself, or point at
  // an OpenAI-compatible endpoint like OpenRouter (https://openrouter.ai/api/v1).
  openai_base_url: string;
  anthropic_model: string;
  sound_on_start: boolean;
  trigger_key: string;
  trigger_mode?: "hold" | "toggle";
  whisper_model: string;
  local_model?: string;
}

export interface Status {
  accessibility: boolean;
  microphone: boolean;
  input_monitoring: boolean;
  has_openai_key: boolean;
  has_anthropic_key: boolean;
}

export interface StatsSummary {
  total_words: number;
  total_sessions: number;
  total_speaking_secs: number;
  avg_wpm: number;
  best_wpm: number;
  words_today: number;
  wpm_today: number;
  day_streak: number;
  time_saved_secs: number;
  last7_words: number[];
}

export const EMPTY_STATS: StatsSummary = {
  total_words: 0,
  total_sessions: 0,
  total_speaking_secs: 0,
  avg_wpm: 0,
  best_wpm: 0,
  words_today: 0,
  wpm_today: 0,
  day_streak: 0,
  time_saved_secs: 0,
  last7_words: [0, 0, 0, 0, 0, 0, 0],
};

export const DEFAULT_SETTINGS: Settings = {
  cleanup_mode: "open_ai",
  cleanup_level: "light",
  openai_model: "gpt-4o-mini",
  openai_base_url: "",
  anthropic_model: "claude-haiku-4-5",
  sound_on_start: true,
  trigger_key: "Fn",
  whisper_model: "auto",
};

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function getSettings(): Promise<Settings> {
  try {
    return await invoke<Settings>("get_settings");
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setSettings(settings: Settings): Promise<void> {
  try {
    await invoke<void>("set_settings", { settings });
  } catch {
    /* browser preview — no-op */
  }
}

export async function getStatus(): Promise<Status> {
  try {
    return await invoke<Status>("get_status");
  } catch {
    return {
      accessibility: false,
      microphone: false,
      input_monitoring: false,
      has_openai_key: false,
      has_anthropic_key: false,
    };
  }
}

// The most recent loud diagnostic from the dictation pipeline (permission
// missing, hotkey tap dead, paste failed, empty transcript, …). Mirrors
// `diag::ErrorDto` in src-tauri/src/diag.rs.
export interface LastError {
  headline: string;
  detail: string;
}

export async function getLastError(): Promise<LastError | null> {
  try {
    return await invoke<LastError | null>("get_last_error");
  } catch {
    return null;
  }
}

export async function getStats(): Promise<StatsSummary> {
  try {
    const tz = new Date().getTimezoneOffset(); // minutes to add to local -> UTC
    return await invoke<StatsSummary>("get_stats", { tzOffsetMinutes: tz });
  } catch {
    return EMPTY_STATS;
  }
}

export async function requestMicrophone(): Promise<void> {
  try {
    await invoke<void>("request_microphone");
  } catch {
    /* browser preview */
  }
}

export async function requestAccessibility(): Promise<void> {
  try {
    await invoke<void>("request_accessibility");
  } catch {
    /* browser preview */
  }
}

export async function requestInputMonitoring(): Promise<void> {
  try {
    await invoke<void>("request_input_monitoring");
  } catch {
    /* browser preview */
  }
}

export async function setApiKey(provider: "openai" | "anthropic", key: string): Promise<void> {
  try {
    await invoke<void>("set_api_key", { provider, key });
  } catch {
    /* browser preview */
  }
}

// ── History ────────────────────────────────────────────────────────────────
export interface HistoryItem {
  ts_unix: number;
  text: string;
  app: string | null;
  words: number;
}

export async function getHistory(): Promise<HistoryItem[]> {
  try {
    return await invoke<HistoryItem[]>("get_history");
  } catch {
    return [];
  }
}

// ── Dictionary ───────────────────────────────────────────────────────────────
export interface DictEntry {
  correct: string;
  mishears: string[];
  auto: boolean;
}

export async function getDictionary(): Promise<DictEntry[]> {
  try {
    return await invoke<DictEntry[]>("get_dictionary");
  } catch {
    return [];
  }
}

export async function addDictionaryEntry(correct: string, mishears: string[]): Promise<void> {
  try {
    await invoke<void>("add_dictionary_entry", { correct, mishears });
  } catch {
    /* browser preview — no-op */
  }
}

export async function removeDictionaryEntry(correct: string): Promise<void> {
  try {
    await invoke<void>("remove_dictionary_entry", { correct });
  } catch {
    /* browser preview — no-op */
  }
}


export async function listModels(): Promise<string[]> {
  try {
    return await invoke<string[]>("list_models");
  } catch {
    return ["auto"];
  }
}

// ── Shell detection ────────────────────────────────────────────────────────
// The wrappers below branch on whether the Tauri shell is present, NOT on
// whether a call threw. Those are different questions with opposite answers:
// no shell means "you are in `vite dev`, use the in-memory mocks so the pane is
// explorable", while a throw inside the shell means the command genuinely
// failed and the user must be told. Catching both the same way is how a save
// that never persisted still renders as saved.
//
// Tauri v2 injects `__TAURI_INTERNALS__` onto `window` before any app code
// runs, so this is reliable from the first render.
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ── Scratchpad ─────────────────────────────────────────────────────────────
export interface Scratchpad {
  text: string;
  updated_at: number;
  capture_mode: boolean;
}

const mockScratchpad: Scratchpad = {
  text: "",
  updated_at: 0,
  capture_mode: false,
};

export async function getScratchpad(): Promise<Scratchpad> {
  if (!isTauri()) return { ...mockScratchpad };
  return await invoke<Scratchpad>("get_scratchpad");
}

export async function setScratchpadText(text: string): Promise<void> {
  if (!isTauri()) {
    mockScratchpad.text = text;
    mockScratchpad.updated_at = Date.now();
    return;
  }
  await invoke<void>("set_scratchpad_text", { text });
}

export async function setScratchpadCapture(on: boolean): Promise<void> {
  if (!isTauri()) {
    mockScratchpad.capture_mode = on;
    return;
  }
  await invoke<void>("set_scratchpad_capture", { on });
}

// ── Snippets ───────────────────────────────────────────────────────────────
export interface Snippet {
  trigger: string;
  expansion: string;
  enabled: boolean;
}

let mockSnippets: Snippet[] = [];

export async function getSnippets(): Promise<Snippet[]> {
  if (!isTauri()) return [...mockSnippets];
  return await invoke<Snippet[]>("get_snippets");
}

export async function addSnippet(trigger: string, expansion: string): Promise<void> {
  if (!isTauri()) {
    const existing = mockSnippets.find((s) => s.trigger === trigger);
    if (existing) {
      existing.expansion = expansion;
      existing.enabled = true;
    } else {
      mockSnippets.push({ trigger, expansion, enabled: true });
    }
    return;
  }
  await invoke<void>("add_snippet", { trigger, expansion });
}

export async function updateSnippet(trigger: string, expansion: string, enabled: boolean): Promise<void> {
  if (!isTauri()) {
    const idx = mockSnippets.findIndex((s) => s.trigger === trigger);
    if (idx >= 0) mockSnippets[idx] = { trigger, expansion, enabled };
    return;
  }
  await invoke<void>("update_snippet", { trigger, expansion, enabled });
}

export async function removeSnippet(trigger: string): Promise<void> {
  if (!isTauri()) {
    mockSnippets = mockSnippets.filter((s) => s.trigger !== trigger);
    return;
  }
  await invoke<void>("remove_snippet", { trigger });
}

// ── Transforms ─────────────────────────────────────────────────────────────
export type TransformSource = "utterance" | "selection" | "scratchpad";

export interface Transform {
  id: string;
  name: string;
  triggers: string[];
  prompt: string; // template, {input} substituted at run time
  default_source: TransformSource;
  builtin: boolean;
}

let mockTransforms: Transform[] = [];

export async function getTransforms(): Promise<Transform[]> {
  if (!isTauri()) return [...mockTransforms];
  return await invoke<Transform[]>("get_transforms");
}

export async function addTransform(transform: Transform): Promise<void> {
  if (!isTauri()) {
    mockTransforms.push(transform);
    return;
  }
  await invoke<void>("add_transform", { transform });
}

export async function updateTransform(transform: Transform): Promise<void> {
  if (!isTauri()) {
    const idx = mockTransforms.findIndex((t) => t.id === transform.id);
    if (idx >= 0) mockTransforms[idx] = transform;
    return;
  }
  await invoke<void>("update_transform", { transform });
}

export async function removeTransform(id: string): Promise<boolean> {
  if (!isTauri()) {
    const it = mockTransforms.find((t) => t.id === id);
    if (it && it.builtin) return false;
    mockTransforms = mockTransforms.filter((t) => t.id !== id);
    return true;
  }
  return await invoke<boolean>("remove_transform", { id });
}

export async function runTransform(id: string, source: TransformSource): Promise<string> {
  if (!isTauri()) {
    const found = mockTransforms.find((t) => t.id === id);
    return found ? `[Transformed via "${found.name}": sample output from ${source}]` : "";
  }
  return await invoke<string>("run_transform", { id, source });
}

// ── Style ──────────────────────────────────────────────────────────────────
export interface StyleProfile {
  avg_sentence_words: number;
  contractions: boolean;
  punctuation_notes: string;
  banned_words: string[];
  tone_notes: string;
  derived_at: number;
}

export interface StyleContext {
  id: string;
  name: string;
  bundle_ids: string[];
  profile: StyleProfile;
}

export interface StyleStore {
  samples: string[];
  base: StyleProfile | null;
  contexts: StyleContext[];
  auto_learn: boolean;
  dictations_since_derive: number;
  pending: StyleProfile | null;
}

/// Accepted dictations between auto-learn proposals. Mirrors
/// `whimpr_core::style::DERIVE_EVERY`.
export const DERIVE_EVERY = 25;

const mockStyle: StyleStore = {
  samples: [],
  base: null,
  contexts: [],
  auto_learn: false,
  dictations_since_derive: 0,
  pending: null,
};

export async function getStyle(): Promise<StyleStore> {
  if (!isTauri()) return { ...mockStyle };
  return await invoke<StyleStore>("get_style");
}

export async function addStyleSample(text: string): Promise<void> {
  if (!isTauri()) {
    mockStyle.samples.push(text);
    return;
  }
  await invoke<void>("add_style_sample", { text });
}

export async function removeStyleSample(index: number): Promise<void> {
  if (!isTauri()) {
    mockStyle.samples.splice(index, 1);
    return;
  }
  await invoke<void>("remove_style_sample", { index });
}

export async function deriveStyleProfile(): Promise<StyleProfile | null> {
  if (!isTauri()) {
    if (mockStyle.samples.length === 0) return null;
    const derived: StyleProfile = {
      avg_sentence_words: 14,
      contractions: true,
      punctuation_notes: "Clear commas and periods. Avoid run-on phrasing.",
      banned_words: ["synergy", "paradigm", "leverage"],
      tone_notes: "Direct, calm, precise tone.",
      derived_at: Date.now(),
    };
    mockStyle.base = derived;
    mockStyle.dictations_since_derive = 0;
    return derived;
  }
  return await invoke<StyleProfile | null>("derive_style_profile");
}

export async function proposeStyleProfile(): Promise<StyleProfile | null> {
  if (!isTauri()) return null;
  return await invoke<StyleProfile | null>("propose_style_profile");
}

export async function setStyleProfile(profile: StyleProfile): Promise<void> {
  if (!isTauri()) {
    mockStyle.base = profile;
    return;
  }
  await invoke<void>("set_style_profile", { profile });
}

export async function setStyleContext(context: StyleContext): Promise<void> {
  if (!isTauri()) {
    const idx = mockStyle.contexts.findIndex((c) => c.id === context.id);
    if (idx >= 0) mockStyle.contexts[idx] = context;
    else mockStyle.contexts.push(context);
    return;
  }
  await invoke<void>("set_style_context", { context });
}

export async function removeStyleContext(id: string): Promise<void> {
  if (!isTauri()) {
    mockStyle.contexts = mockStyle.contexts.filter((c) => c.id !== id);
    return;
  }
  await invoke<void>("remove_style_context", { id });
}

export async function setStyleAutoLearn(on: boolean): Promise<void> {
  if (!isTauri()) {
    mockStyle.auto_learn = on;
    return;
  }
  await invoke<void>("set_style_auto_learn", { on });
}

export async function acceptPendingStyle(): Promise<void> {
  if (!isTauri()) {
    if (mockStyle.pending) {
      mockStyle.base = mockStyle.pending;
      mockStyle.pending = null;
    }
    return;
  }
  await invoke<void>("accept_pending_style");
}

export async function discardPendingStyle(): Promise<void> {
  if (!isTauri()) {
    mockStyle.pending = null;
    return;
  }
  await invoke<void>("discard_pending_style");
}
