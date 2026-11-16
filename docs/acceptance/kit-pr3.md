# Kit PR 3 — Shared page pieces: acceptance record

Plan: `docs/plans/shadcnuikit-adoption.md` section 7, row PR 3 (Phase 0 inventory slices 3-4).

## Founder approval (gate, section 2)

Approved 2026-11-16 ("Ok" to the recommended list). The founder owns the licence and public-repository consequences (CLAUDE.md). Recorded in `src/lib/ui-provenance.ts` and the table in `docs/ui-sources.md`.

| Piece | Kit item | Tier | Decision | Not chosen |
| --- | --- | --- | --- | --- |
| `DataTable` shell | `tables14`, https://shadcnuikit.com/blocks/dashboard-ui/tables#tables-14 | premium | Visual reference: status tabs with counts, search, filters, sort | `tables5`, `tables7` |
| `EmptyState` | `empty-state15`, https://shadcnuikit.com/blocks/dashboard-ui/empty-state#empty-state-15 | premium | Visual reference: compact, title and one action | `empty-state1`, `empty-state2`, `empty1` |
| `StatusBadge` | `badge1`, https://shadcnuikit.com/components/badge | free | Visual reference | `badge2`, `badge6` |
| `ConfirmDialog` | `alert-dialog1`, https://shadcnuikit.com/components/alert-dialog | free | Visual reference | `alert-dialog2`, `alert-dialog5` |

**Kit-derived vs reference-only.** All four items are **reference only**: the four registry JSON files were fetched into a scratch directory outside the repository to read them, and no kit code was copied. Each Harvest component carries the provenance header only because the provenance test requires it for any listed file. Nothing from the kit demos (sample data, CSV export, assignee and billing filters, section wrappers, copy, colors, images) is used. `tables14` depends on `@tanstack/react-table`; it is **not** installed (no dependency is approved), so sorting, filtering and paging stay with the caller. No `motion`, `vaul` or other new dependency; no kit `data-table*` variant.

## What changed

New shared pieces (`src/components/`, all text and tones supplied by the caller):

- `data-table.tsx` (`DataTable`): presentational shell on the existing `Table`, `Tabs`, `Checkbox`, `Skeleton`, `DropdownMenu`. Slots: toolbar (`search`, `filters`, `actions`), optional status tabs with counts, sortable headers (`aria-sort`; the caller supplies `onSort` or an `href`), optional controlled row selection with a bulk-action bar (region, live count, clear), `empty` / loading / `error` slots, `pagination` slot, visible `note`. Below 768px (or `layout="cards"`) the rows render as a stacked card list (`ul`, one title, labelled `dl` lines, an actions area forced to 44px, a Sort menu replacing the header buttons). Table action buttons also reach 44px below 1024px. Columns hide by container query (`showFrom`), not viewport. Cells are plain React nodes, so server components can pass elements; functions are only needed for sort and selection handlers. No data fetching, no domain strings.
- `empty-state.tsx` (`EmptyState`): composes `Empty`: icon, title, optional description, one primary action, optional secondary; `compact` and `standard` sizes; optional heading level; solid or dashed surface.
- `status-badge.tsx` (`StatusBadge`) and `src/lib/status-tone.ts`: six tones (neutral, success, warning, danger, info, pending) on theme tokens, optional dot (decorative; the label is always text). `defineStatusTones({...})` is the typed, caller-owned status to tone mapping; unknown statuses fall back to neutral.
- `confirm-dialog.tsx` (`ConfirmDialog`) and `src/lib/confirm-flow.ts`: `AlertDialog` wrapper, destructive or neutral, caller text, async `onConfirm` (nothing = done, a returned string or a thrown error = inline failure and the dialog stays open). While running, both buttons are `aria-disabled` (not `disabled`, so keyboard focus stays on the confirm button), Escape and outside dismissal are blocked, a Spinner and `aria-busy` show, and a status region announces it. Cancel gets first focus; focus returns to the trigger, or to `returnFocusRef` when the opener no longer exists.
- Supporting: `src/lib/data-table.ts` (pure helpers), `src/hooks/use-media-query.ts`, catalogue `ComponentsDataTable` and `ComponentsConfirmDialog` (generic strings only).

Consumers swapped (data, permissions and behaviour unchanged; presentational parts only):

| Consumer | DataTable | EmptyState | StatusBadge | ConfirmDialog |
| --- | --- | --- | --- | --- |
| Workspace communities list (`src/app/workspaces/[tenantId]/communities/page.tsx`, new client `communities-table.tsx`) | yes | yes | yes | |
| Files list (`src/components/files/file-list.tsx`) | yes | yes | yes | |
| CRM company people tab (`src/components/crm/company-people.tsx`) | yes | yes (compact) | yes (Primary) | |
| Community invitations (`community-invites.tsx`) | yes | | yes | |
| CRM People and Organizations list empty state (`crm/list-page.tsx`) | | yes (solid, heading) | | |
| My communities (`src/app/account/communities/page.tsx`) | | yes (compact, four sections) | yes (invite expiry, applications, appeals, hosted) | |
| Erase contact (`erase-contact.tsx`) | | | | yes (destructive, busy) |
| Community editor leave guard (`community-editor.tsx`) | | | | yes (neutral) |
| Connect link actions: disable, rotate, archive (`connect-admin/link-actions.tsx`) | | | | yes |

Behaviour notes (not bugs, but visible): status colors changed from secondary or outline badges to tones (files: ready success, pending and uploaded pending, quarantined danger; communities: published success, archived pending); confirmation dialogs for erase and the Connect link actions now stay open with a spinner until the request finishes (before: the link-action dialog closed at once); the company people empty state shows the two existing actions as a primary and a secondary button; on phones the files, communities, invitations and company people tables are card lists. The `/dev/ui` showcase gets a "Page pieces" group (`page-parts-examples.tsx`) with ready, loading, empty and error states, selected rows, sorting, search, filter, tabs, pagination slot, both empty sizes, all tones and three confirmation dialogs (async, neutral, failing).

## Tests

- Unit: `tests/unit/page-pieces.test.ts` (sort cycle, layout resolution, selection helpers, card parts, tone map and fallback, StatusBadge tones, EmptyState props, DataTable table and card layouts, `aria-sort`, tabs, selection and bulk bar, slots, ConfirmDialog closed render, confirm flow outcomes). Provenance, token-leak, showcase-registry and copy-rule tests pass unchanged. Static-markup tests cannot exercise the busy state of an open dialog (portals), so that is covered in the browser.
- E2E added in `tests/e2e/ui-showcase.spec.ts`: "page pieces" (tabs with counts, sort `aria-sort` cycle, search and empty, selection and bulk bar, loading, empty and error with retry, confirm focus order, busy state with both buttons `aria-disabled` and focus kept, Escape blocked while busy, failure message, neutral confirm, then 360/390/768/1280/1440 in light and dark: card list below 768px and table above, no horizontal overflow, 44px controls below 1024px, axe wcag2a/2aa/21aa with a selected row). The existing showcase test now also expects the four new records and the new group. Screenshots: `docs/screenshots/kit-pr3/`.
- Consumer specs run locally (Chromium, one worker, 16 Nov 2026, last run on the final DataTable): `community-editor`, `community-joining` (invitations table, my communities), `crm` (both tests, including the company People tab), `files`, `layout`, `studio-foundation`, `ui-showcase` (both tests, with `HARVEST_UI_SHOWCASE=1`): pass. Earlier in the same session, before the final DataTable tweaks, also passed: `account-onboarding`, `community-applications`, `crm03`, `crm04`, `crm-filters` (both; the first run reported a transient axe `document-title` on one page and passed on re-run), `hc03-connect-links`, `hc03-responsive` (4 projects), `pr01b` (erase flow). Not run: other specs that do not touch a swapped consumer.
- E2E updated, none weakened: `tests/e2e/crm.spec.ts` (company People tab): below 768px the table is a card list, so that test now locates the card list, keeps the in-card, truncation and full-width-shell checks for the name, asserts that a long role wraps without clipping instead of truncating, and adds a 44px check for the actions button.
- `npx tsc --noEmit`, `npx tsx scripts/check-source.ts`, eslint on changed files, the full unit project (59 files, 839 tests) and `npm run build` pass.

## Not done

- No TanStack Table, `motion`, `vaul` or other dependency; no kit `data-table*` variant; no server-side sort, filter or paging contract (callers keep their own; none of the swapped consumers needed one).
- Controls not backed by a service are not shown (for example no export or assign actions in the shell).
- Other ad-hoc empty states, badges and confirmations (for example the CRM record grid, deals, imports, moderation panel, community applications) are not swapped yet.
- No CI run is claimed; no merge, deployment or production activation.

## Follow-ups and decisions

- The card layout is chosen by a client media query, so a phone briefly renders the table on first paint before switching; a CSS-only variant would need to render both layouts. Decide if that flash is acceptable.
- Sorting and tabs are controlled (state in the caller). A URL-backed variant for server lists (links for tabs) is a later extension once a list needs it.
- Remaining ad-hoc status pills and confirmations can move to the shared pieces module by module in PRs 5 to 8.
