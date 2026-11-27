# Kit PR 1 — Primitives top-up and global toast: acceptance record

Plan: `docs/plans/shadcnuikit-adoption.md` section 7, row PR 1.

## Founder approval (gate, section 2)

Approved 2026-11-16 ("Approved all"). Recorded in `src/lib/ui-provenance.ts` and the table in `docs/ui-sources.md`.

| Area | Kit item | Decision |
| --- | --- | --- |
| Global toast | `toast1` (free), https://shadcnuikit.com/components/sonner-toast | Approved with `sonner` as the only new dependency. Not chosen: `toast2`, `toast10`. |
| Spinner | `spinner1` | Approved. Not chosen: `spinner2`, `spinner10`. |
| Scroll area | `scroll-area1` | Approved. Not chosen: `scroll-area2`, `scroll-area4`. |
| Bottom drawer | `drawer1` (visual reference only) | No stock drawer and no `vaul`; built as a bottom variant of the existing Sheet. Not chosen: `drawer2`, `drawer6`. |
| Toggle group, kbd | none | Hand-written stock primitives. |

## What changed

- New primitives in `src/components/ui/`: `spinner.tsx` (role=status with catalogue label, sizes, decorative mode, no rotation under reduced motion), `scroll-area.tsx` (radix, token scrollbars, focusable named viewport when content is plain text), `toggle-group.tsx` (radix, single = radiogroup, multiple = pressed buttons, 44px items below 1024px), `kbd.tsx`.
- Bottom sheet: `SheetContent side="bottom"` now has a height cap (`85dvh`), rounded top, grab handle, safe-area padding and a 44px close target. The other three sides are unchanged (class table extracted as `sheetSideClasses`, unit-tested).
- Global toast: `src/components/ui/sonner.tsx` wraps `sonner` (theme tokens only, no `next-themes`, catalogue label for the live region and the dismiss button, 44px action and dismiss targets on phones, polite live region, `closeButton`, three visible toasts). Mounted once in `src/app/layout.tsx` inside the existing `NextIntlClientProvider`. `src/lib/toast.ts` exposes `notify.success / error / info / dismiss` with an optional single action, description, id and duration; callers pass catalogue text.
- Source guard: `scripts/source-guards.ts` rejects raw string literals as the title, `description` or `label` of `notify.*` and `toast.*` calls (tests added).
- Catalogue: `ComponentsUiSpinner`, `ComponentsUiToaster`, and the `/dev/ui` copy.
- Dependency: `sonner` 2.0.8 only (`npm install sonner@2`; the lockfile diff is the one package entry). Recorded in `docs/third-party-licenses.md`.
- `/dev/ui`: new "Primitives" and "Toast" groups, a bottom sheet example in "Overlays", and the four kit-derived example files with provenance headers; the busy button uses the Spinner.

## Real consumers

| Primitive | Consumer | Why |
| --- | --- | --- |
| Toast | `src/components/ministry-settings-form.tsx` | The inline "Ministry type saved." alert becomes a toast. Failures stay inline (`Alert` with the server message) next to the form. No behaviour or permission change. |
| Spinner | same form (Save button while saving) | Decorative spinner inside the existing "Saving…" label. |
| Scroll area | `src/components/crm/tasks/notifications-menu.tsx` | The notification list (`max-h-80`) moves from a raw `overflow-y-auto` to `ScrollArea`; rows stay focusable links. |
| Bottom sheet, toggle group, kbd | showcase only | No existing mobile panel clearly needs a bottom sheet, and no screen needs a toggle group or key hint yet; PRs 4 to 8 are the first consumers. |

## Verification

- Unit (full project, after the last change): 57 files, 805 tests pass, including the new `tests/unit/ui-primitives.test.ts`, the provenance and token-leak tests, source-guard tests and copy rules. `npx tsc --noEmit`, `npx tsx scripts/check-source.ts` and `eslint` on changed files are clean; `npm run build` succeeds.
- E2E run locally (Chromium, real Postgres): `tests/e2e/ui-showcase.spec.ts` with `HARVEST_UI_SHOWCASE=1` (axe at 360, 390, 768, 1280 and 1440 in light and dark with a toast visible, 44px checks for actions, toggle items, toast action and dismiss, bottom sheet close and bounds at 360, toast Undo, keyboard scrolling of the focusable scroll area, toggles, bottom sheet focus return); `tests/e2e/ministry-audience.spec.ts` (toast appears in the Notifications region, no inline copy of it); `tests/e2e/crm05.spec.ts` (notifications popover).
- Not run: the other e2e shards, the PWA check, a CI run. The browser-evidence screenshots under `docs/screenshots/` were not regenerated.
- Bundle: the repository's Next build output prints no per-route first-load JS, so no before/after figure is recorded. `sonner` is about 70 kB unminified, 14.6 kB gzipped; it loads on every route through the root layout (the Toaster is global).

## Not done

- No visual change to existing screens beyond the two consumers above; CopyLink and other ad-hoc success messages still use inline text (candidates for later PRs).
- The 12 future palettes are not in the registry; toast, scrollbars and toggles use only existing semantic tokens, so they inherit them.
- Tier of `spinner1`, `scroll-area1` and `drawer1` recorded as free without a per-item price flag (see `docs/ui-sources.md`). Closed 26 Nov 2026: confirmed Free on the kit pages (see follow-ups).
- No merge, deployment or production activation.

## Follow-ups

- Move the Toaster from the root layout into the workspace layout (or mount it lazily on the first `notify` call) before more public-page weight accrues.
- Closed 26 Nov 2026 (Kit leftovers, `docs/acceptance/kit-leftovers.md`): the kit's category Markdown pages list `spinner1`, `scroll-area1` and `drawer1` (and `toast1`) as Free. Original note: tier of `spinner1`, `scroll-area1` and `drawer1` could not be proven from public pages (the site states 559 of 564 components are free and 5 are pro, without naming them). They are recorded as free on that basis; the founder accepted the licence and public-repository consequences (CLAUDE.md, 16 Nov).
- `kit-bottom-sheet-example.tsx` carries the standard provenance header (the provenance test requires it) although `drawer1` is reference-only; its record in `src/lib/ui-provenance.ts` and `docs/ui-sources.md` says no kit code was used.
- Guards added in review: nested `action`/`cancel` labels and spreads in toast options are checked; `sonner` may be imported only by `src/lib/toast.ts` and `src/components/ui/sonner.tsx` (`checkSonnerBoundary`, wired into `scripts/check-source.ts`).
