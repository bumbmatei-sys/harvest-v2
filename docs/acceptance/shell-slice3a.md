# Shell slice 3a: editor mode, editing sidebar and community editor migration (acceptance record)

Spec: `docs/superpowers/specs/2026-11-16-shell-editor-mode-design.md` (sections 3, 4, 5, 7, 8, 10a, 11 and slice 3a). Builds on shell slices 1 and 2 (`docs/acceptance/shell-slice1.md`, `shell-slice2.md`). No migration, route, permission, API or dependency change. Autosave and the real preview column are not part of this slice (3b and later).

## Flag

`HARVEST_SHELL_MODES` (same flag as slice 2, read in `src/server/shell-modes.ts`, passed to `AppShell` as `modeSwitcher`).

- Off: `AppShell` does not mount `EditorProvider`, so `useEditorHosted()` is false and the community editor renders exactly as before (in-page `Stepper` nav, `xl` 22rem preview column, no step bar, no sidebar block). Proved by the flag-off parity test and the unchanged `community-editor` spec run with `HARVEST_SHELL_MODES=disabled`.
- On (development and tests; production only when `HARVEST_SHELL_MODES=enabled`): the editing sidebar, phone step bar and wider preview rules below apply.

## What changed

- `src/lib/editor-context.ts` (new, pure): `EditorContextData` (title, type label, status kind/label, back link, steps with state `done | attention | todo | disabled`, current step, steps label, optional open-page link, `dirty`), `editorStepState`, `editorStepViews`, `stepPosition` ("Step n of m" counts every listed step), `editorContextKey` (the context is plain data, compared by value).
- `src/components/editor/editor-context.tsx` (new): `EditorProvider` (mounted by `AppShell` only with the flag and a selected ministry), `useEditorContext(data, onStep)` (registers on mount and on data change, clears on unmount; a per-hook token keeps a late cleanup of one page from clearing the next page's context; handlers live in a ref so only data changes re-register), `useEditorSidebar()` (read by the sidebar), `useEditorHosted()`.
- `src/components/editor/editing-sidebar.tsx` (new): back link ("Back to {label}" as its accessible name), item name (truncated, full name in `title`), type label, Draft/Published badge, "Unsaved changes" text while dirty, numbered steps (`nav` named by the page, `ol`, `aria-current="step"`, state as icon plus screen-reader text: "Current step", "Done", "Needs attention", "Not started", "Unavailable"; disabled steps keep their place with `aria-disabled`), and Open page (new tab, `rel="noopener"`, only when the item has a public URL) at the bottom. Built on `SidebarMenuButton`, so the collapsed icon rail shows the back arrow and numbered markers with tooltips; the sidebar's open/collapsed state is not forced.
- `src/components/editor/editor-step-bar.tsx` (new): below 1024px a sticky "Step n of m" bar (current step name and progress) opens an "All steps" sheet (bottom sheet, the shared phone-first `Sheet` side) with every step's state, the back link and Open page. Choosing a step closes the sheet and moves focus to the step heading.
- `src/components/editor/editor-step-parts.tsx` (new): shared step indicator (number, check, alert mark), status text, and focus helper for the mobile drawer.
- `src/components/editor/editor-shell.tsx`: new optional `sidebar` prop (type label, status, back, open page, dirty) that makes `EditorShell` register the context. With a hosting shell it renders: step bar (below `lg`), header, form, preview aside (labelled "Preview", from 1280px; 22rem, 24rem from 1600px; the Preview sheet button stays below 1280px). Without a hosting shell, or without `sidebar`, the markup is the previous layout.
- `src/components/app-shell.tsx`: `ModeNavigation` shows `EditingSidebar` instead of the entry list while a context is registered and the shown mode is the owning mode. The logo row and the mode switcher stay. Tapping another mode previews that mode's entries (the page and editor stay, nothing navigates); returning to the owning mode brings the item sidebar back. `menuButton` moved to `src/components/shell-styles.ts` (shared, unchanged value).
- `src/components/wizard-layout.tsx`: new `focusOnStepChange` option (default off, so existing consumers are unchanged): focus moves to the step heading when the step changes from a separate step list.
- `src/components/communities/community-editor.tsx`: registers its context through `EditorShell` (`sidebar` prop), adds the `attention` state (`stepNeedsAttention`), the Open page link when published, `focusOnStepChange`, and "Go to {step}" buttons on missing Publish checklist items (`checklistStep`). Form, permissions, endpoints, save/discard, publish rules and test ids are unchanged.
- `src/lib/community-editor.ts`: `checklistStep`, `stepNeedsAttention` (pure).
- `messages/en.json`: new `EditorMode` block; `CommunityEditor.typeLabel`, `openPage`, `goToStep`. Provider-neutral; user-facing "ministry" is unchanged.

## Leave guard

The existing `useUnsavedChangesGuard` stays the one guard (the community editor already passes `guard={false}` to `StickySaveBar`). It listens at document level, so the sidebar back link, logo, links in a previewed mode's entry list and the breadcrumb all ask while dirty; browser reload and tab close use `beforeunload`; Back/Forward use the existing history guard. Step selection and mode switching never navigate, so they never ask. The context `dirty` flag is informational in 3a (it shows "Unsaved changes" in the sidebar).

## Phone and tablet (designed first)

Below 1024px there is no sidebar column and no in-page step list: the "Step n of m" bar leads the editor, the All steps sheet lists states, Preview is a sheet from its header button, and Back/Next are the form card's footer. The same editing sidebar is also what the drawer shows (44px targets). Verified at 360 and 390 first, then 768, 1280, 1440 (and a 1700 width check for the 24rem preview).

## Tests

- Unit: `tests/unit/editor-context.test.ts` (step state mapping, numbering and current, "Step n of m", value-comparable plain-data context, community attention and checklist links). Full unit project passes (73 files, 1014 tests).
- E2E `tests/e2e/shell-slice3a.spec.ts` (new, 6 tests flag on, 1 flag off): swap in and out, steps with state text, back link, Open page only when published, mode switcher visible and working while editing (preview of another mode, return), publish checklist links and disabled Publish, preview column width rules (352px at 1280, 384px from 1600), leave guard on every exit path, keyboard path, phone step bar and All steps sheet (focus to heading, Escape returns focus), drawer, rail tooltips, five widths (360, 390, 768, 1280, 1440) in light and dark with axe (wcag2a/2aa/21aa), no horizontal overflow, 44px targets in the phone surfaces, role matrix (owner, admin edit; member and viewer read-only with the sidebar), flag-off parity.
- `tests/e2e/community-editor.spec.ts`: one selector updated (leaving through the sidebar back link when it exists, otherwise the first Communities link as before). No assertion weakened.
- Existing specs run with the flag on and unchanged otherwise: see "Results" below. Shell specs also run flag off.

## Results

All run locally against the dev server (local Postgres), before the PR existed:

- `tsc --noEmit`, eslint on changed files, `scripts/check-source.ts`, unit project (73 files, 1014 tests), `npm run build`: green.
- E2E, flag on (30 passed, 3 skipped = flag-off parity and showcase): `shell-slice2`, `kit-pr2-shell`, `layout`, `studio-foundation`, `campaigns`, `ministry-audience`, `community-editor`, `community-forum`, `community-applications`, `community-moderation`, `community-moderation-b`, `community-joining`, `community-notifications`, `kit-pr7-communities`, `hc05-intake` (light and dark), `shell-slice3a`.
- E2E, flag off (`HARVEST_SHELL_MODES=disabled`; 11 passed, 12 skipped = the flag-on tests): `shell-slice2`, `kit-pr2-shell`, `layout`, `studio-foundation`, `campaigns`, `ministry-audience`, `shell-slice3a` (parity test), and earlier `community-editor`.
- `grep` of `tests/e2e` for hardcoded counts or text tied to the in-page stepper: every step selector goes through the "Community setup" nav (now in the sidebar at 1024px and wider, where those specs run); the only changed assertion target is the leave-link in `community-editor.spec.ts`.
- Not run: CI (no PR yet), `hc03-responsive` and `kit-pr6-follow-up` (slice 2 ran them; neither touches the editor).

## Screenshots

`docs/screenshots/shell-slice3a/` (all viewed): `desktop-1280-editing-{light,dark}.png` (editing sidebar with static preview), `desktop-1280-rail-light.png`, `tablet-768-{light,dark}.png`, `phone-360-step-bar-{light,dark}.png`, `phone-360-all-steps-{light,dark}.png`, `phone-360-drawer-light.png`.

## Deviations from the spec

- Autosave is not built (the campaign wizard's mechanism does not exist yet): manual Save draft stays; there is no Saved/Saving/Not synced status line. Gap recorded for 3b or the autosave slice.
- Preview is still a static slot (the community's existing Page/Join tabs fed from the unsaved form state, with a visible "Preview" label); it stays an `EditorShell` prop, not part of the registered context (a ReactNode is not plain data). The real preview column, device toggle and click-to-field are 3b.
- Back/Next on phone are the form card's footer (`WizardLayout`), not a separate fixed bottom bar, to avoid two sticky bars with `StickySaveBar`.
- The All steps sheet is a bottom sheet (the shared phone-first sheet side with a 44px close target) rather than a top sheet.
- The context carries `dirty` but the guard itself stays in the page's existing hook (one guard, no router patching).
- The steps nav keeps the page's own label ("Community setup") as its name so existing selectors keep working; the spec's example name "Steps" is not used.
- Focus on entering editor mode is not moved (normal navigation does not move it); focus moves to the step heading on step changes.
- The sidebar shows the item block once per mode; a second skip link was not added (per spec).

## Not verified

- Production with the flag on (dev server only); CI not run on the PR yet.
- Real screen reader announcement of step states and the sheet; Safari and Firefox.
- First paint with the flag on: the page registers its context in an effect, so the entry list shows for one frame before the item sidebar (and the editor is server-rendered without the in-page step list). No flash was measured.
- Browser Back/Forward guard in browsers without the Navigation API (existing fallback, unchanged).
- Behaviour when two editors are mounted at once (none exists).

## Decisions needed

1. Accept the editing sidebar being replaced by the previewed mode's entries when a user taps another mode while editing, or make the mode tap do nothing while an editor is open.
2. Accept a bottom All steps sheet and the in-card Back/Next footer on phones, or require the top sheet and a fixed bottom bar.
3. Whether the first-frame entry list before registration needs a server-side hint (for example rendering the editing block from the route) before the flag goes on in production.
