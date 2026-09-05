# Bottom Navigation Redesign Implementation Plan

> **For agentic workers:** Execute task-by-task. Each task is self-contained and
> names its own verification. Do not batch tasks. Do not start a task before the
> previous task's verification passes.

**Goal:** Replace the left sidebar with a floating bottom-center icon navigation
bar, group the eleven destinations into four groups with a second-level pill tab
strip, and convert the meeting ask bar into a bottom-right floating action button
so it stops competing with the nav for the bottom of the window.

**Design spec:** `docs/superpowers/specs/2026-09-05-bottom-nav-redesign-spec.md`.
Read it first. It carries the closed token list, the closed icon list, and the
list of things that must not change. This plan does not repeat them.

**Tech stack:** React 18, TypeScript, Vite, Tauri v2. Inline styles only.

---

## Global Constraints

- Add no dependencies. `ui/package.json` must end byte-identical to how it started.
- No `className` attributes anywhere. Inline `style={{ ... }}` objects only.
- Only tokens from `ui/src/hub/theme.ts` and `font` from `ui/src/tokens/values.ts`.
  There is no `theme.bg`, no `theme.red`, no `theme.primary`, no `theme.muted`.
- Only icon names from `ui/src/hub/icons.tsx`. There is no `arrowRight`, no
  `chevron`, no `menu`.
- No em-dashes on any added line, in code, comments, or copy.
- Never regress dictation, transforms, snippets, scratchpad, or meeting recording.
- Run `cd ui && ./node_modules/.bin/tsc --noEmit` after every frontend change.
- Do not change the `QAItem` interface, `AnswerMarkdown.tsx`, the raw try/catch
  error handling in `handleMeetingAsk` and `handleGlobalLibraryAsk` with its
  carve-out comments, or the library-wide ask bar's position at the top of the
  library list. These were reviewed and ruled on deliberately.

---

### Task 1: `BottomNav.tsx`

**Files:**
- Create: `ui/src/hub/BottomNav.tsx`
- Verify: `cd ui && ./node_modules/.bin/tsc --noEmit`

**Produces:** the floating bar, the `Page` type, the group definitions, and the
layout constants that Task 4 consumes.

- [ ] **Step 1: Move the `Page` type**

`Page` currently lives in `ui/src/hub/Sidebar.tsx` and is imported by
`ui/src/hub/App.tsx:5`. Re-declare it in `BottomNav.tsx` with the same eleven
members, unchanged: `home`, `meetings`, `library`, `insights`, `dictionary`,
`snippets`, `style`, `transforms`, `scratchpad`, `settings`, `help`.
Do not edit `Sidebar.tsx` or `App.tsx` in this task; Task 4 switches the imports.

- [ ] **Step 2: Export the layout constants**

```ts
export const BOTTOM_NAV_HEIGHT = 56;
export const BOTTOM_NAV_GAP = 20;
export const BOTTOM_NAV_BREATHING = 20;
export const MAIN_BOTTOM_PAD = BOTTOM_NAV_HEIGHT + BOTTOM_NAV_GAP + BOTTOM_NAV_BREATHING;
```

`MAIN_BOTTOM_PAD` must be computed from the other three, never written as a
literal. Task 4 imports it so the scroll padding cannot drift out of sync with
the bar's real size.

- [ ] **Step 3: Export the group definitions**

Four groups, in this order, with these exact icons and children:

| Group key | Label | Icon | Children in order |
|---|---|---|---|
| `home` | Home | `home` | `home` |
| `notes` | Notes | `meetings` | `meetings`, `library`, `insights` |
| `flow` | Flow | `mic` | `scratchpad`, `snippets`, `style`, `transforms`, `dictionary` |
| `settings` | Settings | `settings` | `settings`, `help` |

Each child needs a display label for Task 2's pill strip: Meetings, Library,
Insights, Scratchpad, Snippets, Style, Transforms, Dictionary, Settings, Help.
Export the group type and the group array. Task 4 drives pane switching from
this array rather than duplicating the mapping.

- [ ] **Step 4: Build the bar**

Fixed, horizontally centered, `BOTTOM_NAV_GAP` clear of the window bottom.
Container radius 20, background `theme.cardBg`, `1px solid ${theme.border}`,
`theme.shadowHover`. Four icon buttons, each at least 40x40. Icon only, no text.
Active: icon `theme.accentDeep` on an `theme.accentSoft` pill. Inactive: icon
`theme.textMuted`, transparent, `theme.hover` on hover. Transition background and
color at 120ms ease, matching `Sidebar.tsx:37-60`. z-index above panes, below
any existing modal layer.

- [ ] **Step 5: Tooltips**

On hover, show the group label above the bar. Build inline, no library. Ground
`theme.bannerVia`, text `#ffffff` at 11.5px in `font.ui`, small radius,
`theme.shadow`. Also set the native `title` attribute for accessibility, but do
not rely on it as the only tooltip.

- [ ] **Step 6: Verify**

`cd ui && ./node_modules/.bin/tsc --noEmit` exits 0 with no output.

- [ ] **Step 7: Commit**

```bash
git add ui/src/hub/BottomNav.tsx
git commit -m "feat(ui): add floating bottom navigation bar with grouped destinations"
```

---

### Task 2: `PillTabs.tsx`

**Files:**
- Create: `ui/src/hub/PillTabs.tsx`
- Verify: `cd ui && ./node_modules/.bin/tsc --noEmit`

**Produces:** the reusable second-level pill strip. Three groups use it, so it
must be generic over its items. Do not hardcode any group's children into it.

- [ ] **Step 1: Component contract**

Props: an array of items each carrying a key and a label, the active key, and a
change handler. Keep it a presentational component with no internal routing
knowledge and no knowledge of `Page`.

- [ ] **Step 2: Styling**

Strip container: `theme.cardBgSubtle`, radius 14, small padding, laid out inline
with a small gap. Each pill: radius 999, padding about `6px 14px`, 13px text in
`font.ui`. Active pill: `theme.accent` background with `#ffffff` text. Inactive:
transparent, `theme.textMuted`, `theme.hover` on hover. Transition at 120ms ease
to match the rest of the app.

`#ffffff` as a literal for text on a filled accent is established repo
convention, used in `App.tsx`, `TransformsPane.tsx`, and `DictionaryPane.tsx`.
It is not a token violation.

- [ ] **Step 3: Verify**

`cd ui && ./node_modules/.bin/tsc --noEmit` exits 0 with no output.

- [ ] **Step 4: Commit**

```bash
git add ui/src/hub/PillTabs.tsx
git commit -m "feat(ui): add reusable pill tab strip for second-level navigation"
```

---

### Task 3: Ask bar becomes a floating action button

**Files:**
- Modify: `ui/src/hub/OatmealAskBar.tsx`
- Modify: `ui/src/hub/LibraryPane.tsx`
- Verify: `cd ui && ./node_modules/.bin/tsc --noEmit`

**Why:** the bottom-center nav collides with the bottom-sticky meeting ask bar.

- [ ] **Step 1: Collapsed state**

In the meeting detail context only, the ask bar collapses to a circular floating
action button anchored bottom right, clear of the nav bar both horizontally and
vertically. Use the `mic` or `search` icon; both exist, pick whichever reads
better. When the current meeting has existing Q&A history, the button carries a
small count badge or dot so the user knows history is there.

- [ ] **Step 2: Expanded state**

Clicking expands the full ask bar and Q&A feed as a panel anchored bottom right,
sitting above the nav bar and never covering it. A close affordance using the
`close` icon collapses it, as does clicking outside the panel.

- [ ] **Step 3: Preserve state across collapse**

`meetingQAHistory` stays in `LibraryPane.tsx`, keyed by meeting id. Do not move
it into the component. Collapsing and reopening must not lose history.

- [ ] **Step 4: Leave the library bar alone**

The library-wide ask bar at the top of the library list is already
`stickyBottom={false}` and does not collide with anything. Do not change its
placement or behavior.

- [ ] **Step 5: Verify**

`cd ui && ./node_modules/.bin/tsc --noEmit` exits 0 with no output. Then confirm
by reading the diff that `QAItem`, `AnswerMarkdown.tsx`, and both handlers' raw
try/catch blocks with their carve-out comments are untouched.

- [ ] **Step 6: Commit**

```bash
git add ui/src/hub/OatmealAskBar.tsx ui/src/hub/LibraryPane.tsx
git commit -m "feat(ui): collapse meeting ask bar into a bottom-right floating action button"
```

---

### Task 4: `App.tsx` integration and `Sidebar.tsx` retirement

**Files:**
- Modify: `ui/src/hub/App.tsx`
- Delete: `ui/src/hub/Sidebar.tsx`
- Verify: `cd ui && ./node_modules/.bin/tsc --noEmit`

- [ ] **Step 1: Swap the nav**

Remove the `Sidebar` import at `App.tsx:5` and its usage at `App.tsx:214`. Import
`Page` from `BottomNav.tsx` instead. Mount `BottomNav` fixed at bottom center.
The shell at `App.tsx:213` is currently a flex row sized for a side rail; adjust
it so the pane area occupies the full width.

- [ ] **Step 2: Per-group active child**

Track which child is active within each group, so switching from Notes to Flow
and back returns you to the child you were last on rather than resetting to the
group's first child. A record keyed by group key is sufficient.

- [ ] **Step 3: Mount the pill strip**

Render `PillTabs` at the top of the `<main>` area when the active group has more
than one child. Home has one child, so it renders no strip.

- [ ] **Step 4: Fix content clipping**

Import `MAIN_BOTTOM_PAD` from `BottomNav.tsx` and apply it as the bottom padding
of the `<main>` scroll container at `App.tsx:215`. Do not write a numeric literal
here. Without this the last row of every pane is permanently hidden under the
floating bar.

- [ ] **Step 5: Delete the sidebar**

Once nothing imports it, delete `ui/src/hub/Sidebar.tsx`. Removing a source
module being replaced is correct; the repo's archive-rather-than-delete rule
applies to documents and project files, not to dead code in a refactor.

- [ ] **Step 6: Verify**

`cd ui && ./node_modules/.bin/tsc --noEmit` exits 0. `grep -rn "Sidebar" ui/src/`
returns nothing.

- [ ] **Step 7: Commit**

```bash
git add -A ui/src/hub/
git commit -m "feat(ui): wire bottom navigation into the app shell and retire the sidebar"
```

---

### Task 5: Verification gate

**Files:** none modified. This task only runs checks and reports.

- [ ] **Step 1: Run every check and quote the real output**

```bash
cd ui && ./node_modules/.bin/tsc --noEmit; echo "exit=$?"
git diff --stat ui/package.json
grep -rn "className" ui/src/hub/ || echo "no className"
grep -rn "Sidebar" ui/src/ || echo "no Sidebar refs"
git diff | grep -n $'—' || echo "no em-dashes"
```

Expected: tsc `exit=0` with no output; empty `git diff --stat` for
`ui/package.json`; and the three fallback messages printed.

- [ ] **Step 2: Confirm all eleven destinations are reachable**

home, meetings, library, insights, dictionary, snippets, style, transforms,
scratchpad, settings, help. Trace each through the group definitions and the
pane switch in `App.tsx`. Name any that cannot be reached.

- [ ] **Step 3: Confirm no shipping feature regressed**

Dictation, transforms, snippets, scratchpad, and meeting recording. Say how you
checked each.

- [ ] **Step 4: Report**

State which criteria you verified and quote the command output for the checks in
Step 1. If a criterion was not met, say so explicitly. Do not claim a check
passed without having run it.
