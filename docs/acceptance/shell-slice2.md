# Shell slice 2: mode switcher and per-mode sidebar (acceptance record)

Spec: `docs/superpowers/specs/2026-11-16-three-mode-shell-design.md` (section 6 switcher, section 7 sidebar, section 13 decisions, slice 2). Editor-mode addendum: `docs/superpowers/specs/2026-11-16-shell-editor-mode-design.md` (the switcher must stay visible when editor mode arrives; not built here). Builds on slice 1 (`docs/acceptance/shell-slice1.md`, PR #102). No route, migration, permission or dependency change.

## Flag

`HARVEST_SHELL_MODES` (server, read in `src/server/shell-modes.ts`, passed to `AppShell` as the `modeSwitcher` prop by the ministry layout).

- Production: off unless `HARVEST_SHELL_MODES=enabled`.
- Development and tests: on. `HARVEST_SHELL_MODES=disabled` forces the old single sidebar anywhere; this is how flag-off parity is proved.
- Off: `AppShell` renders the previous single sidebar, label and markup (no tablist, no live region, no extra DOM).

## What changed

- `src/components/mode-switcher.tsx` (new): shared `Tabs` primitive, so tablist semantics, roving tabindex, arrows and Home/End come from the library. Expanded sidebar and drawer: segmented control (icon above label when three modes, icon beside label for two); icon rail: stacked icons, vertical tablist, tooltip "Public (Ctrl/Cmd+Alt+2)". 44px targets below 1024px. `aria-keyshortcuts` on each tab. `ModeSwitcherView` is the presentational part (also used by the development showcase to show all three modes).
- `src/components/app-shell.tsx`: `ModeNavigation` renders the switcher plus the groups of the shown mode from `resolveModeNavigation`. Nav `aria-label` is "Ministry navigation: {mode}". Polite live region announces "{mode} menu" on a user mode change. Ctrl/Cmd+Alt+1..3 select a mode and move focus to the first link of that sidebar (keyboard-initiated changes only). The "Ministries" link is shown at the top of Operations only; the ministry switcher stays in the profile menu. Choosing a mode never navigates.
- `src/lib/shell-mode.ts` (new): stored choice (`harvest.shell.mode`, try/catch, in-memory fallback when storage is blocked), `availableModes`, `displayMode`, `modeForShortcut`.
- `messages/en.json`: `modeSwitcher`, `modeTooltip`, `modeAnnouncement`, `workspaceNavigationMode`, one showcase label. Mode names reuse `modeOperations/modePublic/modeAssistant`.
- Showcase (`/dev/ui`, shell category): example with all three modes.
- Existing specs adjusted for the Public sidebar: `campaigns.spec.ts` (mobile nav link count 14 flag off, 13 flag on: Communities moves to Public), `community-editor.spec.ts` (selects Public first when the switcher exists), `kit-pr6-follow-up.spec.ts` (tab assertion scoped to `main`).

## Behaviour decisions made here

- Hidden modes: Assistant has no live entry (`modeAvailability`), so it is hidden, not shown disabled (spec decision 6: unbuilt modules are hidden). With fewer than two available modes the switcher is not rendered.
- Pages that own their path (every ministry page today, including Settings, Appearance and `/crm/settings/*`): the switcher shows the owning mode on arrival. Tapping another mode is a preview: the sidebar swaps, the page and breadcrumb stay, nothing is navigated. The preview belongs to that page only (`displayMode`) and ends on every navigation (cleared on pathname change, so Back does not restore it), which returns to the owning mode. Reason: least surprising, consistent with "choosing a mode only swaps the sidebar" and "a manual choice applies only on neutral pages".
- The last explicit choice is stored for the neutral-page default. No real ministry page is neutral today (there is no ministry home page), so the stored choice has no visible effect yet; it is covered by unit tests and by an e2e check that it is stored and that blocked storage does not break the shell.
- Three modes use a stacked icon-over-label segment because icon plus label side by side truncates in the 256px sidebar.
- Selected state uses `aria-selected` styling (the tooltip trigger overwrites `data-state` on the same element), plus bolder text and a bordered card segment, so colour is not the only cue.

## Reused shared systems

`Tabs`, `Tooltip`, `Sidebar` context (`useSidebar`), existing `NavigationGroup`/`NavigationLink`, `resolveModeNavigation`/`modeAvailability`/`resolveMode` (slice 1), message catalogue, semantic tokens only. Kit items used as visual reference only: `dashboard-shell8`, `dashboard-dropdown7` (no new kit item, no kit code copied). Eden's two-icon sidebar swap is the design reference; no Eden branding or copy.

## Tests run (all green)

- `tsc --noEmit`, eslint on changed files, `scripts/check-source.ts`, unit project (66 files, 972 tests; new `tests/unit/shell-mode.test.ts`).
- E2E, flag on: `shell-slice2` (new), `kit-pr2-shell`, `layout`, `studio-foundation`, `campaigns`, `ministry-audience`, `community-editor`, `kit-pr6-follow-up`, `hc03-responsive`, `kit-pr7-communities`: 21 passed, 2 skipped (flag-off parity; showcase).
- E2E, flag off (`HARVEST_SHELL_MODES=disabled`), same specs unchanged in meaning: 17 passed, 6 skipped (the flag-on tests). Includes the new flag-off parity test.
- E2E with `HARVEST_UI_SHOWCASE=1`: showcase test (three modes, arrows, Home/End, 44px, axe, no overflow, light and dark at 1280 and 360) passed.
- `shell-slice2` covers: tab order and selection, no navigation on choosing, owning mode on Settings/Appearance/CRM settings, preview then return, live region, arrows/Home/End, Ctrl and Meta+Alt shortcuts, Alt+3 ignored while Assistant is hidden, Ctrl+B still toggles the sidebar, icon rail tooltip and vertical tablist, five widths (360, 390, 768, 1280, 1440) in light and dark with axe (wcag2a/2aa/21aa), no horizontal overflow, 44px tabs and links in the drawer, drawer stays open on mode choice and closes on link, role matrix (owner, admin, member, viewer see Operations and Public, never Assistant; Imports hidden from viewers).
- No e2e hardcoded a navigation count except `campaigns.spec.ts` (updated).

## Screenshots

`docs/screenshots/shell-slice2/`: desktop 1280 (Operations and Public, light and dark), rail (Operations and Public, light), phone 360 drawer (Operations and Public, light and dark), and `showcase-three-modes-{1280,360}-{light,dark}.png` for the three-segment control with Assistant. Viewed during development.

## Deviations

- Spec section 7 lists a New chat button and chat history in the Assistant sidebar and section 6 a bottom-sheet alternative; neither is built (Assistant has no entries; recommended drawer-top control used).
- No light/dark rail screenshot in dark mode and no tablet (768) screenshot were saved; both widths and themes are asserted by the five-widths test.
- `resolveNavigation` (legacy three groups) still exists for the flag-off path; removal belongs to the cleanup slice.

## Not verified

- The real three-mode shell: Assistant cannot appear until it has a live entry, so three modes are only proved in the showcase component, not inside the real sidebar.
- Ctrl/Cmd+Alt+1..3: AltGr typing and text fields are now handled (the shortcut ignores AltGraph and input, textarea, select, contenteditable and role=textbox targets, without preventDefault; unit-tested). Conflicts with browser, OS and screen-reader shortcuts outside Chromium remain unverified.
- `aria-controls` on the tabs points at the navigation landmark, not a tabpanel (there is no panel).
- Safari and Firefox; real screen reader announcement of the live region.
- Production behaviour with the flag on (dev server only); CI not run on the PR yet.
- Behaviour on a neutral page with a selected ministry (none exists).

## Decisions needed

1. Accept hiding Assistant (and the switcher when only one mode exists) until it has a live entry, or show Assistant disabled with a tooltip.
2. Accept the preview-then-reset behaviour on pages that own their path, or make a mode tap on such a page do nothing.
3. When to switch `HARVEST_SHELL_MODES=enabled` in production (founder acceptance; this PR does not).
