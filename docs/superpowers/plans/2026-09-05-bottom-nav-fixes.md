# Bottom Navigation, Review Fix Brief

Follow-up to `2026-09-05-bottom-nav-redesign-plan.md`. The implementation was
reviewed and does not block merge, but three items should land before it does.
Fix all three, then run the verification block at the end. One commit is fine.

Branch: `feat/bottom-nav`.

## Correction to the original spec

The original spec listed only `font.ui` and `font.mono`. That was incomplete.
`ui/src/tokens/values.ts:67-69` actually exports three:

```
font.ui    = '"Inter", "Geist", system-ui, sans-serif'
font.serif = '"Fraunces", "Newsreader", Georgia, serif'
font.mono  = '"JetBrains Mono", ui-monospace, monospace'
```

`font.serif` is real and Fix 2 needs it. Everything else in the spec's closed
token and icon lists still stands.

---

## Fix 1 (Important): restore a visible keyboard focus indicator

`ui/src/hub/BottomNav.tsx:142` and `ui/src/hub/PillTabs.tsx:47` both set
`outline: "none"` with nothing in its place. The buttons remain keyboard
reachable and activatable, but there is now no visual indication of where focus
is, across the app's entire primary navigation. The sidebar this replaced did not
do that, so it is a regression introduced by this branch.

Restore a visible focus state on both. Use `:focus-visible` semantics so it
appears for keyboard users without adding a ring on every mouse click. Since the
codebase is inline styles with no CSS file, track focus in component state via
`onFocus` and `onBlur` and apply a focus style, matching how hover is already
handled in these components.

Style it with existing tokens: a ring in `theme.accent` or a border in
`theme.accentSoftBorder` reads correctly against both the `theme.cardBg` bar and
the `theme.cardBgSubtle` pill strip. Do not introduce a new color.

While you are in these files, two cheap accessibility gaps to close:

- `BottomNav.tsx:127` sets `aria-label` but no `aria-current`. Add
  `aria-current="page"` to the active group button so the active state is not
  conveyed by color alone.
- `BottomNav.tsx:129-130` shows the tooltip on `onMouseEnter` / `onMouseLeave`
  only. Add `onFocus` / `onBlur` so keyboard users get the same tooltip. The
  spec already said the native `title` attribute alone is not sufficient.

## Fix 2 (Important): restore the wordmark and the Local badge

The "WhimprFlow" wordmark and the "Local" privacy badge lived only inside
`Sidebar.tsx` and were deleted along with it. Nothing in the spec or plan
authorized removing them. The badge in particular is a trust signal for a
local-first product and it currently appears nowhere in the app.

Restore both in a slim header row at the **top left of the app shell**, above the
pane area, visible on every screen.

Here is the original markup, recovered from `f1e56f1:ui/src/hub/Sidebar.tsx`.
Reuse this styling as-is so the brand treatment does not drift. Only the wrapping
container changes, since it is now a horizontal header rather than a sidebar
column:

```tsx
{/* Wordmark + Local badge */}
<div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px 20px" }}>
  <span
    style={{
      fontFamily: font.serif,
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: -0.3,
      color: theme.textStrong,
    }}
  >
    WhimprFlow
  </span>
  <span
    style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: theme.accentDeep,
      background: theme.accentSoft,
      border: `1px solid ${theme.accentSoftBorder}`,
      borderRadius: 999,
      padding: "2px 7px",
    }}
  >
    Local
  </span>
</div>
```

Adjust only the container padding to suit a header row. Keep the font, sizes,
weights, letter spacing, colors, and the badge's pill shape exactly as they are.

The header must not scroll away with the pane content, and it must not eat into
the `<main>` scroll area's height in a way that breaks the existing
`flex: 1, minHeight: 0` behavior at `App.tsx:240-244`.

## Fix 3 (Minor): delete dead code

- `ui/src/hub/BottomNav.tsx:78-85` `getGroupForPage` is never imported anywhere.
- `ui/src/hub/BottomNav.tsx:161` the `page?: Page` prop is never passed;
  `App.tsx:270` passes only `activeGroup`.
- `ui/src/hub/BottomNav.tsx:166` the fallback
  `activeGroup ?? (page ? ... : "home")` is therefore unreachable in two of its
  three branches. Once the prop is gone, simplify it to use `activeGroup`
  directly.

Delete all three. Do not delete anything else while you are in there.

## Not in scope, leave alone

- `PillTabs.tsx` uses `role="tab"` and `role="tablist"` without `aria-controls`,
  a tabpanel, roving tabindex, or arrow-key handling. Either implement the full
  ARIA tab pattern or drop the roles and let them be plain buttons. This is a
  real issue but it is a separate decision, so do not change it here.
- `theme.sidebarBg` in `theme.ts` is now referenced by nothing. Leave the token
  in place.
- Everything the original plan fenced off stays fenced off: the `QAItem`
  interface, `AnswerMarkdown.tsx`, the raw try/catch blocks and carve-out
  comments in `handleMeetingAsk` and `handleGlobalLibraryAsk`, and the
  library-wide ask bar at the top of the library list.

## Constraints

Unchanged from the original plan. Add no dependencies. No `className`. Only
tokens from `theme.ts` and `font` from `tokens/values.ts`. Only icon names from
`icons.tsx`. No em-dashes on any added line.

## Verify

```bash
cd ui && ./node_modules/.bin/tsc --noEmit; echo "exit=$?"
cd .. && git diff --stat ui/package.json
grep -rn "className" ui/src/hub/ || echo "no className"
grep -rn "getGroupForPage" ui/src/ || echo "no getGroupForPage"
grep -rn "WhimprFlow" ui/src/hub/ | head
git diff | grep -n $'—' || echo "no em-dashes"
```

Expected: tsc `exit=0` with no output; empty diff for `ui/package.json`; no
`className`; no `getGroupForPage`; at least one `WhimprFlow` hit in the shell;
no em-dashes.

Then confirm by tabbing through the app that the bottom nav buttons and the pill
tabs each show a visible focus indicator, and that the wordmark and Local badge
are visible on every pane.

Report the actual command output. Do not claim a check passed without running it.
