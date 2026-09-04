# Gemini handoff — WhimprFlow Hub panes

Copy everything below the line into your agent. It is self-contained.

---

You are working in the WhimprFlow repository at `~/Adriel_2.0/WhimprFlow`. It is a Tauri v2 desktop app: a Rust core plus a React + TypeScript webview. Your job is the React side only.

## Your task

Build four Hub panes that currently render a "Coming soon" placeholder: **Scratchpad**, **Snippets**, **Transforms**, **Style**. Each becomes a real, working pane.

## Hard boundaries

- **Do not touch any Rust file.** Nothing under `crates/`, nothing under `src-tauri/src/`. Those are owned by someone else and are being changed in parallel. If you believe a Rust change is needed, stop and say so instead of making it.
- **Do not change** `Sidebar.tsx`, `theme.ts`, `tokens/values.ts`, `Home.tsx`, `Insights.tsx`, `SettingsPane.tsx`, `Onboarding.tsx`, or `Help.tsx`.
- **You may change** `ui/src/hub/App.tsx` (only to route the new panes), `ui/src/hub/api.ts` (only to add new wrappers), `ui/src/hub/icons.tsx` (only to add new icons), and you may create new files under `ui/src/hub/`.
- **Do not add dependencies.** No component library, no CSS framework, no state manager, no form library. The existing code uses plain React with inline style objects. Match it.

## The codebase you are joining

Read these first. They define the house style and you must match it, not improve on it:

- `ui/src/hub/DictionaryPane.tsx` — the closest existing analogue to what you are building. A list with add, edit, delete, and local tabs. Copy its structure.
- `ui/src/hub/ui.tsx` — exports `Card`, `Dot`, `Button`, `Segmented`, `PageTitle`, `useStats`. Use these. Do not write your own button.
- `ui/src/hub/theme.ts` — every colour. Use tokens (`theme.textMuted`, `theme.accentSoft`, `theme.border`, …). Never hardcode a hex value.
- `ui/src/tokens/values.ts` — `font.ui` and `font.serif`. Titles use serif, everything else uses ui.
- `ui/src/hub/icons.tsx` — `Icon` component and the `IconName` union. `snippets`, `style`, `transforms`, `scratchpad` icons already exist.
- `ui/src/hub/api.ts` — the Tauri command wrappers.

### The api.ts pattern, which you must follow exactly

Every wrapper dynamically imports `invoke`, and every one catches and returns a safe default, so the Hub still renders under plain `vite dev` with no Rust shell attached:

```ts
export async function getSnippets(): Promise<Snippet[]> {
  try {
    return await invoke<Snippet[]>("get_snippets");
  } catch {
    return [];
  }
}
```

This matters more than usual here: **the Rust commands do not exist yet.** They are being written in parallel. Your panes must render, and be fully navigable, against those fallback values. Build and verify with `cd ui && pnpm dev` in the browser. Do not try to run the full Tauri app.

## Command contracts

Write these into `api.ts` as typed wrappers. Field names are snake_case because they cross the Rust boundary; do not rename them.

### Scratchpad

```ts
export interface Scratchpad { text: string; updated_at: number; capture_mode: boolean; }

getScratchpad(): Promise<Scratchpad>                     // fallback { text: "", updated_at: 0, capture_mode: false }
setScratchpadText(text: string): Promise<void>
setScratchpadCapture(on: boolean): Promise<void>
```

### Snippets

```ts
export interface Snippet { trigger: string; expansion: string; enabled: boolean; }

getSnippets(): Promise<Snippet[]>                        // fallback []
addSnippet(trigger: string, expansion: string): Promise<void>
updateSnippet(trigger: string, expansion: string, enabled: boolean): Promise<void>
removeSnippet(trigger: string): Promise<void>
```

### Transforms

```ts
export type TransformSource = "utterance" | "selection" | "scratchpad";

export interface Transform {
  id: string;
  name: string;
  triggers: string[];
  prompt: string;              // template, {input} is substituted at run time
  default_source: TransformSource;
  builtin: boolean;
}

getTransforms(): Promise<Transform[]>                    // fallback []
addTransform(transform: Transform): Promise<void>
updateTransform(transform: Transform): Promise<void>
removeTransform(id: string): Promise<void>
runTransform(id: string, source: TransformSource): Promise<string>   // fallback ""
```

### Style

```ts
export interface StyleProfile {
  avg_sentence_words: number;
  contractions: boolean;
  punctuation_notes: string;
  banned_words: string[];
  tone_notes: string;
  derived_at: number;
}

export interface StyleStore {
  samples: string[];
  profile: StyleProfile | null;
  auto_learn: boolean;
  dictations_since_derive: number;
  pending: StyleProfile | null;
}

getStyle(): Promise<StyleStore>   // fallback { samples: [], profile: null, auto_learn: false, dictations_since_derive: 0, pending: null }
addStyleSample(text: string): Promise<void>
removeStyleSample(index: number): Promise<void>
deriveStyleProfile(): Promise<StyleProfile | null>       // fallback null
setStyleProfile(profile: StyleProfile): Promise<void>
setStyleAutoLearn(on: boolean): Promise<void>
acceptPendingStyle(): Promise<void>
discardPendingStyle(): Promise<void>
```

## What each pane does

### `ScratchpadPane.tsx`

A quiet place to dictate long-form before it goes anywhere else.

- Full-height textarea filling the content area, serif-free, comfortable line height, generous padding. This is a writing surface, so it should feel like one, not like a form field.
- Autosave via `setScratchpadText` on a 500 ms debounce. A small, calm saved indicator. No modal, no toast.
- A **Capture mode** toggle bound to `setScratchpadCapture`. When on, dictation lands in this pad instead of at the cursor. The toggle needs a one-line explanation next to it, because it silently changes where the user's words go and that must never be a surprise.
- A transform picker (populated from `getTransforms`) plus a Run button that calls `runTransform(id, "scratchpad")` and replaces the text. One level of undo, so a bad transform is recoverable.
- Word count in the footer.

### `SnippetsPane.tsx`

Reusable phrases expanded by voice.

- List of snippets: trigger phrase, a truncated preview of the expansion, an enabled toggle, edit and delete.
- Add form: trigger (single line) and expansion (multiline).
- Empty state explaining what a snippet is, with one concrete example (say "my signature" while dictating and the full sign-off is typed out).
- Follow `DictionaryPane.tsx` for list layout, spacing, and the add-row treatment.

### `TransformsPane.tsx`

Named prompt presets that turn a spoken thought into an email, a summary, or a to-do.

- List of transforms. Builtins are marked with a subtle badge and cannot be deleted, only edited. Custom ones can be deleted.
- Each row shows name, trigger phrases as small chips, and the default source.
- Edit view: name, triggers (add and remove chips), source selector using the existing `Segmented` component with options Utterance, Selection, Scratchpad, and a prompt template textarea. Show a short hint that `{input}` is replaced by the source text.
- A "Run on selection" button per transform calling `runTransform(id, "selection")`, showing the returned string in a result panel. This is how the user tests a transform without speaking.

### `StylePane.tsx`

Teaches the cleanup engine to sound like the user.

Three sections, top to bottom:

1. **Samples.** A list of pasted writing samples, each with a preview and a remove control. An "Add sample" textarea. Copy should ask for a few paragraphs of the user's own natural writing, and say plainly that the samples never leave the machine except as input to the configured cleanup provider.
2. **Profile.** Every `StyleProfile` field rendered as an editable control: a number input for `avg_sentence_words`, a toggle for `contractions`, text inputs for `punctuation_notes` and `tone_notes`, and a chip editor for `banned_words`. A "Derive from samples" button calling `deriveStyleProfile`, disabled with an explanation when there are no samples. Save calls `setStyleProfile`. When `profile` is null, show an empty state instead of blank controls.
3. **Auto-learn.** A toggle bound to `setStyleAutoLearn`, with `dictations_since_derive` shown as progress toward the next re-derive at 25. When `pending` is non-null, show a diff card comparing the pending profile against the live one field by field, with Accept and Discard buttons. This card is the most important thing on the page when it appears, so it goes at the top of the section and reads clearly at a glance.

## Routing

In `App.tsx`, the `SOON` map at roughly line 104 holds the four placeholder entries. As each pane lands, remove its entry from that map and add a render branch beside the existing `{page === "dictionary" && <DictionaryPane />}` lines. When all four entries are gone, delete the now-empty `SOON` map, its `soon` local, the `{soon && ...}` render line, the `ComingSoon` import, and the file `ui/src/hub/ComingSoon.tsx`.

## Design bar

The person who owns this app is a visual artist. Output that merely functions is not acceptable.

- Match the existing Hub exactly: same spacing rhythm, same card treatment, same type scale, same restraint. A new pane should be indistinguishable in provenance from `DictionaryPane.tsx`.
- Serif (`font.serif`) for page titles only. Everything else is `font.ui`.
- No emoji. No gradients beyond what `theme.ts` already defines. No decorative icons.
- Every empty state earns its space: say what the feature does and give one concrete example, never just "No items yet".
- Every destructive action is reversible or confirmed inline. No `window.confirm`, no `alert` — a modal dialog in a Tauri webview blocks the whole event loop.

## Order of work

Build in this order, and verify each in the browser before starting the next:

1. `api.ts` wrappers for all four features
2. `ScratchpadPane.tsx`
3. `SnippetsPane.tsx`
4. `TransformsPane.tsx`
5. `StylePane.tsx`

## Done means

- `cd ui && pnpm build` passes with no TypeScript errors.
- All four panes render and are fully navigable under `pnpm dev` with no Rust backend, using the fallback values.
- No file under `crates/` or `src-tauri/` is modified. Verify with `git status` before you report finished.
