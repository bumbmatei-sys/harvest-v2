# Kit PR 5 — CRM screens polish: acceptance record

Plan: `docs/plans/shadcnuikit-adoption.md` section 7, row PR 5 ("Done when": CRM server filters, exports and the deal board are unchanged; existing `crm*.spec.ts` and the filter specs pass; screenshots attached).

## Founder approval (gate, section 2)

Approved 2026-11-16. The founder owns the licence and public-repository consequences (CLAUDE.md). Recorded in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`.

| Area | Kit item | Tier | Decision | Harvest pieces kept |
| --- | --- | --- | --- | --- |
| People and Organizations lists | `tables19`, https://shadcnuikit.com/blocks/dashboard-ui/tables#tables-19 | premium | Visual reference: chips, bulk bar, phone card layout | `ListPage`, shared filter popover and chips, saved views, keyboard `RecordGrid` |
| Person and organization record | `tables21`, https://shadcnuikit.com/blocks/dashboard-ui/tables#tables-21 | premium | Visual reference: copy buttons, mailto and tel links, cleaner edit mode | `RecordLayout`, inline per-field editing, permission-gated consent controls |
| Timeline and tasks | `todo-app6`, https://shadcnuikit.com/blocks/application-ui/todo-app#todo-app-6 | premium | Visual reference: timeline, status tracker, note composer | `activity-timeline` data and paging, CRM tasks panel |
| Deals board | `kanban-board3` | premium | Optional reference only | **Not used. The deal board is unchanged.** |

**Kit-derived vs reference-only.** The four registry JSON files were fetched with plain `curl` into the session scratch directory outside the repository to read them. **No kit code was copied.** The Harvest files that carry the provenance header (`list-row-summary.tsx`, `copy-button.tsx`, `contact-actions.tsx`, `status-tracker.tsx`, `activity-timeline.tsx`, `task-rows.tsx`) are hand-written or restyled Harvest source on Harvest primitives; the kit's `vaul` drawer, sample data, copy and table engine are not used. No token was printed, stored or committed.

## What changed

New shared pieces (catalogue strings only, theme tokens only, 44px targets below 1024px):

- `CopyButton` (`src/components/copy-button.tsx`, helper `src/lib/copy-text.ts`): icon button that copies a value, confirms with the existing toast and swaps to a check for a moment; clipboard API with a textarea fallback, never throws. `mailtoHref` and `telHref` helpers (a `tel:` number keeps only digits and `+`).
- `StatusTracker` (`src/components/status-tracker.tsx`, `src/lib/status-tracker.ts`): read-only segmented progress through ordered steps; one `aria-current="step"`, done / current / upcoming also as text for screen readers; every label from 640px, only the current one plus "Step n of m" below. The caller owns the data; nothing here moves a record.
- `RowSummary` (`src/components/crm/list-row-summary.tsx`): the phone card layout of a list row: consent status badge and tappable email, phone, domain and people-count links (44px), shown only while the list card is narrower than its first extra column.
- `ContactActions` (`src/components/crm/contact-actions.tsx`): email and phone in the person header as mailto and tel links with copy buttons.
- `consentTone` (`src/lib/crm-consent-tone.ts`) maps consent states onto the PR 3 `StatusBadge` tones; `dealTrackerSteps` (`src/lib/crm-deal-tracker.ts`) turns a pipeline's stages into tracker steps.

Where they are used (data, permissions, filters, exports, saved views, server contracts unchanged):

| Screen | Change |
| --- | --- |
| People list | Phone card summary under each name (status, email, phone); email-marketing cell uses `StatusBadge` |
| Organizations list | Phone card summary (domain, people count) |
| Person record | Header quick actions; copy buttons beside email and phone; consent badges on `StatusBadge` (grid, preferences card, history); timeline and note composer restyled; task rows on `StatusBadge` |
| Organization record | Copy button beside the domain; timeline and composer restyled |
| Deal record | Stage progress tracker above the record (open stages in order, plus the closing stage for a won or lost deal) |
| Timeline (person, organization, deal) | Smaller rail, right-aligned time, note panel with icon Edit and Delete buttons (44px on phones, previously 28px), grouped note composer (textarea and Add note in one frame; the Ctrl+Enter hint is read by screen readers and shown as keys from 640px instead of a sentence) |
| Tasks panel | Overdue and priority shown as `StatusBadge`; checkbox, dialog and permissions untouched |
| `/dev/ui` | New group "CRM pieces" (tracker, copy button, row summary) |

Copy: new strings in `Crm`, `Timeline`, `Deals`, `ComponentsCopyButton`, `ComponentsStatusTracker` and `UiShowcase`; no vendor names; "Organizations" kept.

## Deviations from the request

- **No bulk bar.** The kit's bulk selection bar needs a bulk action. No server-side bulk action exists on People or Organizations (the only list-wide action, export, takes the filter query), and the rules forbid changing server contracts. Adding selection with no action would be dead UI, so it is not added. The existing filter chips are kept as they are.
- **Edit mode stays inline, per field.** The kit's contact record has a whole-record edit mode. Harvest saves each field on its own (Enter, Tab or blur, with a version check per request), and the existing specs depend on that. A form with a sticky save bar would change the save semantics, so `StickySaveBar`, `FormSection` and `useHarvestForm` were not applied to the record pages. What changed in edit mode: copy and link actions sit beside the value without covering it (the edit pencil no longer floats over long values). Founder decision below.
- **`StatusTracker` has one real consumer** (the deal record) plus the showcase. No other CRM screen has an ordered status that is not already a control. The tracker is read-only; stage changes keep using the existing stage control.
- **Task status tracker.** Tasks are open or done only, so the kit's five-step tracker was not applied to tasks.
- **Deal board** untouched (`kanban-board3` not used).

## Dependencies

None. `package.json` and `package-lock.json` are unchanged (no `vaul`, no kit packages, no `@base-ui/react`).

## Tests

- Unit: new `tests/unit/crm-kit-pr5.test.ts` (copy helper with an injected clipboard, mailto and tel targets, tracker helpers, deal tracker steps, consent tones, `StatusTracker` and `RowSummary` markup). Provenance, showcase-registry, token-leak and copy-rule tests pass with the new records and group.
- E2E added: `tests/e2e/kit-pr5-crm.spec.ts` (People, Organizations, person, deal and organization pages at 360/390/768/1280/1440 in light and dark: axe wcag2a, wcag2aa and wcag21aa, no horizontal overflow, phone card links and header actions 44px below 1024px, mailto and tel targets, one current tracker step; copy to the clipboard with no write request; note composer with Ctrl+Enter, edit and delete; a viewer sees the contact actions and notes but no composer, no note actions and no consent controls) and a "CRM pieces" case in `tests/e2e/ui-showcase.spec.ts`. The first showcase case also expects the three new provenance records.
- Screenshots: `docs/screenshots/kit-pr5/` (360 and 1280, light and dark).

- Ran locally (Chromium, one worker, 16 Nov 2026, local PostgreSQL through `TEST_DATABASE_URL`, `HARVEST_UI_SHOWCASE=1`): `kit-pr5-crm` (2 tests), `crm`, `crm-filters`, `crm03`, `crm04`, `crm05`, `crm06`, `crm07`, `crm08`, `pr0a-consent-controls`, `studio-foundation` and all four `ui-showcase` tests: 20 tests, all pass (the showcase CRM test was re-run alone after a hydration race in the test's first click was fixed by retrying the click until the toast shows). Unit project: 62 files, 881 tests pass. `npx tsc --noEmit`, `npx tsx scripts/check-source.ts`, eslint on every changed `.ts` and `.tsx` file, and `npm run build` pass.
- Fixed while testing: the first header actions carried the address in their accessible name and made `crm.spec.ts` ambiguous; the header links are now named "Email" and "Call" and the list summary links are named by their visible text.

## Not verified

- No CI run, no real-device test, no screen-reader pass. Clipboard behaviour was exercised in Chromium with clipboard permission granted; browsers without the async clipboard API use the textarea fallback, which has no automated test.
- `first-load JS` per route was not measured (no new dependency; the new components are small).
- Existing screenshot files rewritten by the e2e runs (`docs/screenshots/crm-filters/`) were reverted. The other e2e specs (Connect, Communities, files, offline, and so on) were not run; none render a changed piece.

## Decisions needed

1. Keep per-field inline editing on records (recommended), or switch records to a whole-record edit mode with the sticky save bar (changes save semantics and the existing specs)?
2. Is a bulk bar wanted at all? It needs a real bulk action first (assign owner, add to list, export selected) and a server contract for it, which belongs in its own PR.
3. Should the deal tracker also appear on the deals board cards (compact)? Left out because the board is out of scope.
