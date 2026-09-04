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
  screen_recording: boolean;
  has_openai_key: boolean;
  has_anthropic_key: boolean;
  meeting_recording_active?: boolean;
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
      screen_recording: false,
      has_openai_key: false,
      has_anthropic_key: false,
      meeting_recording_active: false,
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

export async function requestScreenRecording(): Promise<void> {
  try {
    await invoke<void>("request_screen_recording");
  } catch {
    /* browser preview */
  }
}

export async function setHiddenFromCapture(hidden: boolean): Promise<void> {
  try {
    await invoke<void>("set_hidden_from_capture", { hidden });
  } catch {
    /* browser preview */
  }
}

export async function isHiddenFromCapture(): Promise<boolean> {
  try {
    return await invoke<boolean>("is_hidden_from_capture");
  } catch {
    return true;
  }
}

export async function setTranscriptWindowVisible(visible: boolean): Promise<void> {
  try {
    await invoke<void>("set_transcript_window_visible", { visible });
  } catch {
    /* browser preview */
  }
}

export async function setTranscriptPinned(pinned: boolean): Promise<void> {
  try {
    await invoke<void>("set_transcript_pinned", { pinned });
  } catch {
    /* browser preview */
  }
}

export async function isTranscriptWindowVisible(): Promise<boolean> {
  try {
    return await invoke<boolean>("is_transcript_window_visible");
  } catch {
    return false;
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

// ── Notetaker & Meetings ───────────────────────────────────────────────────
export type Template = "general" | "standup" | "one_on_one" | "interview" | "lecture";
export type Difficulty = "easy" | "medium" | "hard";

export interface Meeting {
  id: string;
  title: string;
  started_at: string;
  duration_secs: number;
  transcribed: boolean;
  pending_segments: number[];
  has_notes: boolean;
  notes_stale: boolean;
  template: Template;
  dir: string;
  folder: string | null;
}

export interface TranscriptLine {
  at: string;
  text: string;
  speaker: string | null;
}

export interface Folder {
  name: string;
  count: number;
}

export interface LiveLine {
  at_ms: number;
  text: string;
}

export interface Segment {
  start_cs: number;
  end_cs: number;
  text: string;
}

export interface SessionPaths {
  dir: string;
  mic_wav: string;
  sys_wav: string;
  title: string;
  slug: string;
  segment: number;
}

export interface MeetingResult {
  transcript_path: string;
  dir: string;
  text: string;
  segments: Segment[];
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
}

// camelCase on the wire — see Traps.
export interface StudySettings {
  count: number;
  difficulty: Difficulty;
  topicFocus: string;
}

export interface HomeworkItem {
  id: string;
  title: string;
  note: string;
  due_date: string;
  done: boolean;
}

export interface Source {
  id: string;
  title: string;
  started_at: string;
}

export interface LibraryAnswer {
  answer: string;
  sources: Source[];
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string | null;
  all_day: boolean;
  location: string | null;
  link: string | null;
  calendar: string | null;
}

export interface CalendarFeed {
  authorized: boolean;
  denied: boolean;
  events: CalendarEvent[];
}

export interface VideoInfo {
  id: string;
  title: string;
  duration_secs: number;
}

let mockMeetings: Meeting[] = [
  {
    id: "meeting_demo_1",
    title: "Sprint Planning & Roadmap",
    started_at: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
    duration_secs: 1845,
    transcribed: true,
    pending_segments: [],
    has_notes: true,
    notes_stale: false,
    template: "general",
    dir: "/mock/meetings/demo1",
    folder: "Product",
  },
  {
    id: "meeting_demo_2",
    title: "1:1 Sync with Alex",
    started_at: new Date(Date.now() - 86400 * 1000).toISOString(),
    duration_secs: 1210,
    transcribed: true,
    pending_segments: [],
    has_notes: false,
    notes_stale: false,
    template: "one_on_one",
    dir: "/mock/meetings/demo2",
    folder: null,
  },
];

let mockFolders: Folder[] = [
  { name: "Product", count: 1 },
  { name: "Lectures", count: 0 },
];

let mockSessionActive = false;
let mockSessionStartTime: number | null = null;
const mockLiveLines: LiveLine[] = [
  { at_ms: 1200, text: "Good morning everyone, let us get started." },
  { at_ms: 4500, text: "We have three main agenda items today." },
];
const mockMeetingSegments: Record<string, TranscriptLine[]> = {
  meeting_demo_1: [
    { at: "00:01", text: "Good morning team, let's review our roadmap priorities.", speaker: null },
    { at: "00:25", text: "First item is the notetaker UI implementation.", speaker: null },
    { at: "01:10", text: "Next is finalizing the study plan generator.", speaker: null },
  ],
  meeting_demo_2: [
    { at: "00:05", text: "Hey Alex, how is the backend migration going?", speaker: null },
    { at: "00:40", text: "All 109 commands are registered cleanly in Tauri.", speaker: null },
  ],
};
const mockTypedNotes: Record<string, string> = {
  meeting_demo_1: "# Sprint Planning & Roadmap\n\n- Reviewed Q3 priorities\n- Completed notetaker engine merge\n- Scheduled UI sprint",
};
const mockStudyPlans: Record<string, string> = {};
const mockFlashcards: Record<string, Flashcard[]> = {};
const mockQuizzes: Record<string, QuizQuestion[]> = {};
const mockLastStudySettings: Record<string, StudySettings> = {};
let mockHomework: HomeworkItem[] = [
  {
    id: "hw_1",
    title: "Review notetaker architecture documentation",
    note: "Check Rust command bindings and events",
    due_date: "2026-09-10",
    done: false,
  },
];
let mockCalendarFeed: CalendarFeed = {
  authorized: true,
  denied: false,
  events: [
    {
      id: "cal_1",
      summary: "Weekly Engineering Standup",
      start: new Date(Date.now() + 3600 * 1000).toISOString(),
      end: new Date(Date.now() + 5400 * 1000).toISOString(),
      all_day: false,
      location: "Room 402 / Meet",
      link: null,
      calendar: "Work",
    },
  ],
};

// ── Session ────────────────────────────────────────────────────────────────
export async function startSession(title: string, language: string = "en"): Promise<SessionPaths> {
  if (!isTauri()) {
    mockSessionActive = true;
    mockSessionStartTime = Date.now();
    const id = `meeting_${Date.now()}`;
    const newMeeting: Meeting = {
      id,
      title: title || "Untitled meeting",
      started_at: new Date().toISOString(),
      duration_secs: 0,
      transcribed: false,
      pending_segments: [],
      has_notes: false,
      notes_stale: false,
      template: "general",
      dir: `/mock/meetings/${id}`,
      folder: null,
    };
    mockMeetings.unshift(newMeeting);
    return {
      dir: newMeeting.dir,
      mic_wav: `${newMeeting.dir}/mic.wav`,
      sys_wav: `${newMeeting.dir}/sys.wav`,
      title: newMeeting.title,
      slug: id,
      segment: 1,
    };
  }
  return await invoke<SessionPaths>("start_session", { title, language });
}

export async function stopSession(modelPath: string = "", language: string = "en"): Promise<MeetingResult> {
  if (!isTauri()) {
    mockSessionActive = false;
    mockSessionStartTime = null;
    return {
      transcript_path: "/mock/transcript.txt",
      dir: "/mock/meetings",
      text: "Mock meeting transcript generated during development.",
      segments: [],
    };
  }
  return await invoke<MeetingResult>("stop_session", { modelPath, language });
}

export async function continueSession(id: string, language: string = "en"): Promise<SessionPaths> {
  if (!isTauri()) {
    mockSessionActive = true;
    mockSessionStartTime = Date.now();
    const m = mockMeetings.find((item) => item.id === id);
    const dir = m?.dir ?? `/mock/meetings/${id}`;
    return {
      dir,
      mic_wav: `${dir}/mic.wav`,
      sys_wav: `${dir}/sys.wav`,
      title: m?.title ?? "Meeting",
      slug: id,
      segment: 1,
    };
  }
  return await invoke<SessionPaths>("continue_session", { id, language });
}

export async function finishMeeting(id: string, modelPath: string = "", language: string = "en"): Promise<Meeting> {
  if (!isTauri()) {
    const m = mockMeetings.find((item) => item.id === id);
    if (m) {
      m.transcribed = true;
      return { ...m };
    }
    throw new Error(`Meeting ${id} not found`);
  }
  return await invoke<Meeting>("finish_meeting", { id, modelPath, language });
}

export async function isSessionActive(): Promise<boolean> {
  if (!isTauri()) return mockSessionActive;
  return await invoke<boolean>("is_session_active");
}

export async function sessionElapsedMs(): Promise<number | null> {
  if (!isTauri()) {
    return mockSessionActive && mockSessionStartTime !== null
      ? Date.now() - mockSessionStartTime
      : null;
  }
  return await invoke<number | null>("session_elapsed_ms");
}

export async function defaultModelPath(): Promise<string> {
  if (!isTauri()) return "";
  return await invoke<string>("default_model_path");
}

// ── Live ───────────────────────────────────────────────────────────────────
export async function getLiveLines(): Promise<LiveLine[]> {
  if (!isTauri()) return [...mockLiveLines];
  return await invoke<LiveLine[]>("live_lines");
}

export async function answerLiveQuestion(question: string): Promise<string> {
  if (!isTauri()) {
    return `[Live Answer to "${question}"]: The recent discussion touched upon key milestones and next steps.`;
  }
  return await invoke<string>("answer_live_question", { question });
}

// ── Library ────────────────────────────────────────────────────────────────
export async function listMeetings(): Promise<Meeting[]> {
  if (!isTauri()) return [...mockMeetings];
  return await invoke<Meeting[]>("list_meetings");
}

export async function searchMeetings(query: string): Promise<Meeting[]> {
  if (!isTauri()) {
    const q = query.toLowerCase();
    return mockMeetings.filter((m) => m.title.toLowerCase().includes(q));
  }
  return await invoke<Meeting[]>("search_meetings", { query });
}

export async function deleteMeeting(id: string): Promise<string> {
  if (!isTauri()) {
    mockMeetings = mockMeetings.filter((m) => m.id !== id);
    return id;
  }
  return await invoke<string>("delete_meeting", { id });
}

export async function renameMeeting(id: string, title: string): Promise<void> {
  if (!isTauri()) {
    const m = mockMeetings.find((item) => item.id === id);
    if (m) m.title = title;
    return;
  }
  await invoke<void>("rename_meeting", { id, title });
}

export async function exportMeeting(id: string): Promise<string> {
  if (!isTauri()) {
    const m = mockMeetings.find((item) => item.id === id);
    return `# ${m?.title ?? "Meeting"}\n\nExported transcript for ${m?.title ?? id}.`;
  }
  return await invoke<string>("export_meeting", { id });
}

export async function getMeetingSegments(id: string): Promise<TranscriptLine[]> {
  if (!isTauri()) {
    return (
      mockMeetingSegments[id] ?? [
        { at: "00:01", text: "Meeting recording started.", speaker: null },
      ]
    );
  }
  return await invoke<TranscriptLine[]>("meeting_segments", { id });
}

export async function getMeetingTypedNotes(id: string): Promise<string | null> {
  if (!isTauri()) {
    return mockTypedNotes[id] ?? null;
  }
  return await invoke<string | null>("meeting_typed_notes", { id });
}

export async function moveMeetingToFolder(id: string, folder: string | null): Promise<void> {
  if (!isTauri()) {
    const m = mockMeetings.find((item) => item.id === id);
    if (m) m.folder = folder;
    return;
  }
  await invoke<void>("move_meeting_to_folder", { id, folder });
}

// ── Folders ────────────────────────────────────────────────────────────────
export async function listFolders(): Promise<Folder[]> {
  if (!isTauri()) {
    return mockFolders.map((f) => ({
      ...f,
      count: mockMeetings.filter((m) => m.folder === f.name).length,
    }));
  }
  return await invoke<Folder[]>("list_folders");
}

export async function createFolder(name: string): Promise<void> {
  if (!isTauri()) {
    if (!mockFolders.some((f) => f.name === name)) {
      mockFolders.push({ name, count: 0 });
    }
    return;
  }
  await invoke<void>("create_folder", { name });
}

export async function renameFolder(oldName: string, newName: string): Promise<void> {
  if (!isTauri()) {
    const f = mockFolders.find((folder) => folder.name === oldName);
    if (f) f.name = newName;
    mockMeetings.forEach((m) => {
      if (m.folder === oldName) m.folder = newName;
    });
    return;
  }
  await invoke<void>("rename_folder", { old: oldName, new: newName });
}

export async function deleteFolder(name: string): Promise<void> {
  if (!isTauri()) {
    mockFolders = mockFolders.filter((f) => f.name !== name);
    mockMeetings.forEach((m) => {
      if (m.folder === name) m.folder = null;
    });
    return;
  }
  await invoke<void>("delete_folder", { name });
}

// ── Notes ──────────────────────────────────────────────────────────────────
export async function writeNotes(
  id: string,
  template: Template = "general",
  force: boolean = false,
): Promise<string> {
  if (!isTauri()) {
    const generated = `# Notes (${template})\n\n- Key points discussed\n- Decisions agreed upon\n- Next steps`;
    mockTypedNotes[id] = generated;
    const m = mockMeetings.find((item) => item.id === id);
    if (m) {
      m.has_notes = true;
      m.notes_stale = false;
      m.template = template;
    }
    return generated;
  }
  return await invoke<string>("write_notes", { id, template, force });
}

export async function saveNotes(title: string, body: string): Promise<string | null> {
  if (!isTauri()) {
    const m = mockMeetings.find((item) => item.title === title);
    if (m) {
      mockTypedNotes[m.id] = body;
      m.has_notes = true;
      m.notes_stale = false;
    }
    return `/mock/notes/${title}.md`;
  }
  return await invoke<string | null>("save_notes", { title, body });
}

export async function askMeeting(id: string, question: string): Promise<string> {
  if (!isTauri()) {
    const target = id ? `meeting ${id}` : "the live session";
    return `Answer regarding ${target}: In response to "${question}", the discussion covered relevant details.`;
  }
  return await invoke<string>("ask_meeting", { id, question });
}

export async function askLibrary(question: string): Promise<LibraryAnswer> {
  if (!isTauri()) {
    return {
      answer: `Cross-meeting search for "${question}": Found relevant topics in your meeting library.`,
      sources: mockMeetings.slice(0, 2).map((m) => ({
        id: m.id,
        title: m.title,
        started_at: m.started_at,
      })),
    };
  }
  return await invoke<LibraryAnswer>("ask_library", { question });
}

export async function draftFollowup(id: string): Promise<string> {
  if (!isTauri()) {
    return "Subject: Follow-up and Next Steps\n\nHi everyone,\n\nFollowing up on our recent meeting, here is the summary of action items...";
  }
  return await invoke<string>("draft_followup", { id });
}

// ── Study ──────────────────────────────────────────────────────────────────
export async function generateStudyPlan(
  id: string,
  settings: StudySettings,
  force: boolean = false,
): Promise<string> {
  if (!isTauri()) {
    const plan = `# Study Plan (${settings.difficulty})\n\nFocus: ${settings.topicFocus || "Comprehensive"}\n\n1. Review primary takeaways\n2. Deep dive into core concepts\n3. Practical exercises`;
    mockStudyPlans[id] = plan;
    mockLastStudySettings[id] = settings;
    return plan;
  }
  return await invoke<string>("generate_study_plan", { id, settings, force });
}

export async function cachedStudyPlan(id: string): Promise<string | null> {
  if (!isTauri()) return mockStudyPlans[id] ?? null;
  return await invoke<string | null>("cached_study_plan", { id });
}

export async function generateFlashcards(
  id: string,
  settings: StudySettings,
  force: boolean = false,
): Promise<Flashcard[]> {
  if (!isTauri()) {
    const cards: Flashcard[] = [
      { front: "What is the primary goal of this feature?", back: "Provide a seamless notetaker UI for meetings." },
      { front: "Which layer holds the authoritative command signatures?", back: "The Rust backend registered handlers." },
    ];
    mockFlashcards[id] = cards;
    mockLastStudySettings[id] = settings;
    return cards;
  }
  return await invoke<Flashcard[]>("generate_flashcards", { id, settings, force });
}

export async function cachedFlashcards(id: string): Promise<Flashcard[] | null> {
  if (!isTauri()) return mockFlashcards[id] ?? null;
  return await invoke<Flashcard[] | null>("cached_flashcards", { id });
}

export async function generateQuiz(
  id: string,
  settings: StudySettings,
  force: boolean = false,
): Promise<QuizQuestion[]> {
  if (!isTauri()) {
    const quiz: QuizQuestion[] = [
      {
        question: "Which component handles desktop command invocations?",
        options: ["Tauri IPC", "Direct HTTP", "WebSockets", "Local storage"],
        correct_index: 0,
      },
    ];
    mockQuizzes[id] = quiz;
    mockLastStudySettings[id] = settings;
    return quiz;
  }
  return await invoke<QuizQuestion[]>("generate_quiz", { id, settings, force });
}

export async function cachedQuiz(id: string): Promise<QuizQuestion[] | null> {
  if (!isTauri()) return mockQuizzes[id] ?? null;
  return await invoke<QuizQuestion[] | null>("cached_quiz", { id });
}

export async function lastStudySettings(id: string): Promise<StudySettings | null> {
  if (!isTauri()) return mockLastStudySettings[id] ?? null;
  return await invoke<StudySettings | null>("last_study_settings", { id });
}

// ── Homework ───────────────────────────────────────────────────────────────
export async function listHomework(): Promise<HomeworkItem[]> {
  if (!isTauri()) return [...mockHomework];
  return await invoke<HomeworkItem[]>("list_homework");
}

export async function addHomework(
  meetingId: string,
  title: string,
  dueDate: string,
): Promise<HomeworkItem> {
  if (!isTauri()) {
    const item: HomeworkItem = {
      id: `hw_${Date.now()}`,
      title,
      note: "",
      due_date: dueDate,
      done: false,
    };
    mockHomework.push(item);
    return item;
  }
  return await invoke<HomeworkItem>("add_homework", { meetingId, title, dueDate });
}

export async function setHomeworkDone(id: string, done: boolean): Promise<void> {
  if (!isTauri()) {
    const item = mockHomework.find((hw) => hw.id === id);
    if (item) item.done = done;
    return;
  }
  await invoke<void>("set_homework_done", { id, done });
}

export async function deleteHomework(id: string): Promise<void> {
  if (!isTauri()) {
    mockHomework = mockHomework.filter((hw) => hw.id !== id);
    return;
  }
  await invoke<void>("delete_homework", { id });
}

// ── Calendar ───────────────────────────────────────────────────────────────
export async function listEvents(days: number = 7): Promise<CalendarFeed> {
  if (!isTauri()) return { ...mockCalendarFeed };
  return await invoke<CalendarFeed>("list_events", { days });
}

export async function calendarAuthorized(): Promise<boolean> {
  if (!isTauri()) return mockCalendarFeed.authorized;
  return await invoke<boolean>("calendar_authorized");
}

export async function calendarRequestAccess(): Promise<boolean> {
  if (!isTauri()) {
    mockCalendarFeed.authorized = true;
    mockCalendarFeed.denied = false;
    return true;
  }
  return await invoke<boolean>("calendar_request_access");
}

export async function openCalendarSettings(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("open_calendar_settings");
}

// ── Media ──────────────────────────────────────────────────────────────────
export async function videoProbe(url: string): Promise<VideoInfo> {
  if (!isTauri()) {
    return { id: "vid_1", title: "Imported Media Video", duration_secs: 1800 };
  }
  return await invoke<VideoInfo>("video_probe", { url });
}

export async function videoImport(
  meetingId: string,
  url: string,
  start: string,
  end: string,
): Promise<string> {
  if (!isTauri()) {
    return "Media segment imported successfully.";
  }
  return await invoke<string>("video_import", { meetingId, url, start, end });
}

export async function latexFromSpeech(speech: string): Promise<string> {
  if (!isTauri()) {
    return "\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}";
  }
  return await invoke<string>("latex_from_speech", { speech });
}

export async function transcribeWav(path: string): Promise<string> {
  if (!isTauri()) {
    return "Transcribed audio content from wav.";
  }
  return await invoke<string>("transcribe_wav", { path });
}

