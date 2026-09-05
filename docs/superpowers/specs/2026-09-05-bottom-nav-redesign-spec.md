# Bottom Navigation Redesign, Implementation Spec

**For the implementing model.** This spec is self-contained. Do not guess at any
token, icon, or file path: every name you need is listed here and has been
verified against the real repo. If something you want is not in these lists, it
does not exist, so build it or pick from what is here.

Repo: WhimprFlow. All paths are relative to the repo root.

---

## 1. Hard stack constraints

This app does **not** use Tailwind, shadcn/ui, Radix, CSS modules, or styled
components. Verified: `ui/package.json` has exactly five runtime dependencies
(`@tauri-apps/api`, `react`, `react-dom`, `react-markdown`, `remark-gfm`), there
is no `tailwind.config`, no `postcss.config`, no `components.json`, and
`grep -rc className ui/src/hub/*.tsx` returns zero across every file.

Therefore:

- **Add no new dependencies.** Not one.
- **Write no `className` attributes.** Every style is an inline `style={{ ... }}`
  object, the same as every existing component in `ui/src/hub/`.
- **Invent no colors.** Every color comes from the token list in section 3.
- **No em-dashes** anywhere: not in code, comments, strings, or user-facing copy.
  This is a project-wide rule and it is enforced by tests elsewhere in the repo.

Read `ui/src/hub/SnippetsPane.tsx` before you start to absorb the house style for
inline-styled components.

---

## 2. What you are building

Replace the left sidebar with a floating bottom-center navigation bar.

The app is really two products in one shell: a meeting notetaker and a dictation
tool. The current flat list of eleven destinations hides that. The new structure
makes it explicit with four top-level groups, each opening a second-level pill
tab strip when it has more than one child.

### Current state

`ui/src/hub/Sidebar.tsx` (123 lines) renders a vertical left sidebar with eleven
destinations in two arrays, `MAIN` (9 items) and `BOTTOM` (settings, help). It
exports the `Page` union type, which is imported by `ui/src/hub/App.tsx:5`.

`ui/src/hub/App.tsx:213-215` lays out the shell:

```tsx
<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
  <Sidebar page={page} setPage={setPage} />
  <main style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
```

Pane switching is a chain of `{page === "..." && <SomePane />}` at
`App.tsx:218-227`.

### Target grouping

| Group | Icon | Children (in order) |
|---|---|---|
| Home | `home` | Home (no second level) |
| Notes | `meetings` | Meetings, Library, Insights |
| Flow | `mic` | Scratchpad, Snippets, Style, Transforms, Dictionary |
| Settings | `settings` | Settings, Help |

All eleven original destinations survive. None are removed.

---

## 3. The only tokens that exist

From `ui/src/hub/theme.ts`, imported as `import { theme } from "./theme"`:

```
Surfaces:  pageBg, sidebarBg, cardBg, cardBgSubtle, track, hover
Borders:   border, borderStrong
Text:      textStrong, textBody, textMuted, textFaint
Accent:    accent, accentDeep, accentBright, accentSoft, accentSoftHover, accentSoftBorder
Elevation: shadow, shadowSoft, shadowHover
Banner:    bannerFrom, bannerVia, bannerTo
```

From `ui/src/tokens/values.ts`, imported as `import { font } from "../tokens/values"`:

```
font.ui, font.mono
```

There is no `theme.bg`, no `theme.red`, no `theme.primary`, no `theme.muted`.
A previous attempt in this codebase referenced `theme.bg` and `theme.red` and
neither compiled. Use `theme.pageBg` for a page ground.

### The only icons that exist

From `ui/src/hub/icons.tsx`, used as `<Icon name="home" size={18} style={{ color: ... }} />`:

```
home, meetings, library, insights, dictionary, snippets, style,
transforms, scratchpad, settings, help, search, sort, plus, close,
mic, edit, trash, check
```

There is no `arrowRight`, no `chevron`, no `menu`. A previous attempt referenced
`arrowRight` and it did not compile. Every icon the four groups need already
exists, so you do not need to author SVGs.

---

## 4. Visual design

The design language is borrowed from a shadcn registry component (`tabs-9`):
pill-shaped triggers inside a rounded container, with the active pill filled.
Reproduce the look with inline styles. Do not install anything.

### Bottom nav bar

- Fixed, horizontally centered, floating clear of the window edge. Roughly 16 to
  20px of gap beneath it.
- Container: rounded, in the region of 18 to 22px radius, so it reads as a
  rounded rectangle rather than a full stadium. Background `theme.cardBg`,
  a `1px solid ${theme.border}` hairline, and `theme.shadowHover` for lift.
- Four icon buttons, evenly spaced, each a tap target of at least 40x40px.
- Icon only, no visible text label.
- Active group: icon in `theme.accentDeep` on an `theme.accentSoft` filled pill.
- Inactive: icon in `theme.textMuted`, transparent background. On hover, background
  `theme.hover`.
- Transition on background and color, around 120ms ease, matching the existing
  `NavItem` in `Sidebar.tsx:37-60`.
- The bar must sit above page content. Use a z-index above the panes but below
  any modal layer already in the app.

### Tooltips

Every icon needs a tooltip naming its group, appearing on hover above the bar.
Build it inline, no library. A `title` attribute is not sufficient on its own
because the delay is too long and it cannot be styled, but do also set `title`
for accessibility. Tooltip styling: `theme.textStrong` background is too heavy,
use `theme.bannerVia` as the ground with `#ffffff` text at around 11.5px in
`font.ui`, small radius, `theme.shadow`.

### Second-level pill tabs

When the active group has more than one child (Notes, Flow, Settings), render a
horizontal pill strip at the **top** of the pane area.

- Strip container: `theme.cardBgSubtle` ground, rounded around 14px, small padding.
- Each pill: `rounded-full` equivalent, so radius 999. Around `6px 14px` padding,
  13px text in `font.ui`.
- Active pill: `theme.accent` background, `#ffffff` text. Note `#ffffff` as a
  literal is established repo convention for text on a filled accent, it is used
  in `App.tsx`, `TransformsPane.tsx` and `DictionaryPane.tsx`.
- Inactive pill: transparent background, `theme.textMuted` text, `theme.hover` on
  hover.
- Home has one child, so it renders no strip.

### Content clipping, do not skip this

The floating bar overlays the scroll container, so without a fix the last row of
content is permanently unreachable underneath it.

In `App.tsx`, the `<main>` scroll container must gain bottom padding equal to the
bar height plus its bottom gap plus breathing room. Derive it from the same
constants you use to size and position the bar, do not hardcode a second magic
number that can drift out of sync. Define the bar height and gap once as module
constants and use them in both places.

---

## 5. The ask bar becomes a floating action button

`ui/src/hub/OatmealAskBar.tsx` currently takes a `stickyBottom` prop and, when
true, pins itself to the bottom of the meeting view. It is wired at
`ui/src/hub/LibraryPane.tsx` around line 1748 (meeting detail) and around line
589 (library-wide, already `stickyBottom={false}`).

A bottom-center nav bar collides with a bottom-sticky ask bar. Resolve it:

- In the meeting detail context, the ask bar collapses to a circular floating
  action button anchored **bottom right**, clear of the nav bar, using the `mic`
  or `search` icon (pick whichever reads better; both exist).
- Clicking it expands the full ask bar and Q&A feed as a panel anchored bottom
  right, above the nav bar.
- Clicking outside it, or a close affordance using the `close` icon, collapses it
  back to the button.
- The expanded panel must not cover the nav bar.
- Collapsed state must not lose the Q&A history. `meetingQAHistory` state lives in
  `LibraryPane.tsx` and is keyed by meeting id; do not move it into the component.
- If there are unread or existing answers for the current meeting, the collapsed
  button should carry a small count or dot so the user knows history is there.

**Do not change** any of the following, they were reviewed and ruled on
deliberately:

- The raw try/catch error handling in `handleMeetingAsk` and
  `handleGlobalLibraryAsk` that writes into `QAItem.error`, and its explanatory
  carve-out comments. It intentionally does not use `useAction`.
- The `QAItem` interface shape.
- `ui/src/hub/AnswerMarkdown.tsx` and how answers are rendered.
- The library-wide ask bar's placement at the top of the library list.

---

## 6. Files

**Create:**
- `ui/src/hub/BottomNav.tsx`: the floating bar, its tooltips, and the group
  definitions. Export the group type and the group list so `App.tsx` can drive
  pane switching from it rather than duplicating the mapping.
- `ui/src/hub/PillTabs.tsx`: the reusable second-level pill strip. It must be
  generic over its items, not hardcoded to one group, because three groups use it.

**Modify:**
- `ui/src/hub/App.tsx`: swap `Sidebar` for `BottomNav`, add the pill strip above
  the pane content, add the bottom padding to `<main>`, and track which child is
  active within each group so switching groups returns you to the child you were
  last on rather than resetting.
- `ui/src/hub/OatmealAskBar.tsx`: the collapsed and expanded behavior.
- `ui/src/hub/LibraryPane.tsx`: only what the ask bar change requires.

**Delete:**
- `ui/src/hub/Sidebar.tsx`, once nothing imports it. The `Page` union type it
  exports is imported by `App.tsx`, so move that type to `BottomNav.tsx` (or a
  small shared types module) and update the import before deleting.

Removing dead code in place is correct here. The repo convention about archiving
rather than deleting applies to documents and project files, not to a source
module being replaced.

---

## 7. Acceptance criteria

1. `cd ui && ./node_modules/.bin/tsc --noEmit` exits 0 with no output.
2. `ui/package.json` is byte-identical to before. No dependency added.
3. `grep -rn className ui/src/hub/` returns nothing.
4. All eleven destinations are reachable: home, meetings, library, insights,
   dictionary, snippets, style, transforms, scratchpad, settings, help.
5. No `Sidebar` import survives anywhere: `grep -rn Sidebar ui/src/` is clean.
6. Scrolling any pane to the very bottom leaves the last element fully visible and
   not covered by the floating bar.
7. Every nav icon shows a tooltip on hover naming its group.
8. In a meeting with existing Q&A history, collapsing and reopening the ask panel
   preserves that history.
9. No em-dash on any added line. Check with
   `git diff | grep -n $'—'`, which must return nothing.
10. Dictation, transforms, snippets, scratchpad, and meeting recording all still
    work. These are shipping features and regressing them is not acceptable.

---

## 8. Reporting back

State plainly which acceptance criteria you verified and how, quoting the actual
command output for criteria 1, 3, 5 and 9. If you could not meet one, say so
explicitly rather than describing it as done. Do not claim a criterion passed
without running its check.
