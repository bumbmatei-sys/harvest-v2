# Kit PR 6 — Connect follow-up queue and case detail: acceptance record

Plan: `docs/plans/shadcnuikit-adoption.md` section 7, row PR 6 ("Done when": an assigned member, another member, a viewer and an owner each see exactly what the server allows; consent controls follow the permission keys; no contact details appear that CRM permissions would hide). Server: HC-13 (`docs/acceptance/hc-13.md`, migrations 0048 and 0050), unchanged.

**Approves nothing.** The five HC-02 activation decisions stay UNAPPROVED (`docs/decisions/hc-02-activation-gates.md`). Production intake and real invitation delivery stay hard-disabled, so no real case can exist in production. These screens send no message and no webhook; opening a case, assigning it or moving it only changes the case.

## Founder approval (gate, section 2)

Approved 2026-11-16. The founder owns the licence and public-repository consequences (CLAUDE.md). Recorded in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`.

| Area | Kit item | Tier | Decision | Harvest pieces kept |
| --- | --- | --- | --- | --- |
| Case detail layout (thread and side panel, events) | `chat-ui4` | premium | Visual reference only | `RecordGrid`, `Card`, `StatusTracker`, `StatusBadge` |
| Queue list | `tables15` | premium | Visual reference only | `DataTable` shell (tabs, phone cards), server cursor paging |
| Consent cards | `switch-card1` | premium | Visual reference only, display only | `ConsentForm`, `rowActions`, `consent-controls` |

**Kit-derived vs reference-only.** The three registry JSON files were fetched with plain `curl` (no `Authorization` header; the network proxy supplies the credential) into the session scratch directory outside the repository, found in the public `registry.json` listing, and read. **No kit code was copied.** The files that carry the provenance header (`follow-up-queue.tsx`, `follow-up-timeline.tsx`, the case page, `permission-card.tsx`) are hand-written Harvest source on Harvest primitives. The kit's `@shadcn/react` message scroller, `drawer`, `sonner` usage, `@tanstack/react-table`, `react-hook-form`, `zod` 3 and sample data are not used. No token was printed, stored or committed.

## What changed

New screens (typed navigation registry entry `followUp`, group Ministry, permission `followup:work`; viewers and unknown roles never get the nav item):

| Route | Screen |
| --- | --- |
| `/workspaces/[tenantId]/connect/follow-up` | Queue: state tabs, one row per case (cards on phones), cursor paging, "Open cases" for owners and admins |
| `/workspaces/[tenantId]/connect/follow-up/[caseId]` | Case detail: state badge, progress tracker, details, actions by role, follow-up consent cards, event timeline |

Everything shown is an id, a state or a timestamp the case API returns. **The case holds no name or contact detail, so none is shown**: the person is reached through "Open contact", the existing CRM person page, which applies CRM permissions itself. Assignee names come from the ministry member list (never a viewer), shown only to owners and admins; an assigned member sees "You".

| Role | Queue | Case detail | Controls |
| --- | --- | --- | --- |
| owner, admin | every case, nine state tabs, Open cases | any case | assign, reassign, unassign, every legal move; Close and Withdraw ask for confirmation |
| assigned member | only own open cases, five tabs | own open case; another member's case (or an unknown id) shows one "no access" state | the contact-progress moves the server allows (mark attempted, connected, no response) |
| viewer, unknown role | no nav item; access-denied page | access-denied page | none |

Controls come from `caseActions` (`src/lib/follow-up-ui.ts`), which reads the same transition tables the server uses (`followUpTransitions`, `counselorTransitions`); a unit test checks every state. The server still refuses anything else with its single 403, and the page shows the server's reason (stale, illegal move, consent not in effect, ineligible assignee) in catalogue text.

New and changed shared pieces (catalogue strings, theme tokens, 44px targets below 1024px):

- `PermissionCard` (`src/components/permission-card.tsx`): a consent or permission choice as a card: label, state badge (text, never colour alone), optional description and meta line, an actions slot. Display only; consent changes by recording an event, not by flipping a switch. Two real consumers: `PermissionRow` (the person page's contact permissions, refactored onto it) and `FollowUpConsent` (the case's consent cards). `/dev/ui` group "Permission cards".
- `PermissionRow` (`src/components/crm/associations/permission-row.tsx`): one purpose of the consent ledger with the record buttons a role may use; `ContactPermissions` now maps its rows through it.
- `permissionPreset` (`src/lib/consent-controls.ts`): the channel rules for the consent dialog, previously inline in `ContactPermissions`, now shared and tested.
- `FollowUpConsent`: follow-up consent (the `outreach_follow_up` purpose) per channel that has a record, from the CRM ledger's effective events; the grant button needs `contacts:attest_consent`, the withdrawal button `contacts:record_withdrawal`, both through the existing `ConsentForm`.
- Queue (`FollowUpQueue`) on the PR 3 `DataTable`, `EmptyState` and `StatusBadge`; detail on the PR 5 `StatusTracker`, `RecordGrid` and the PR 3 `ConfirmDialog`.
- `listAssignableMembers` (`src/server/follow-up-members.ts`): read-only member names for the assignment list, under the same tenant context as the CRM task assignee list; it touches no case. This is the only new server file. It adds no route and changes no contract, policy, permission, migration or state machine.

Side effect worth reviewing: the person page's consent row buttons were 44px only below 640px (`sm:`); they are now 44px below 1024px as the plan requires, on the person page as well.

## Deviations from the request

- **Pending-response metadata views: not done.** The server has the owner/admin read functions from migrations 0045 and 0046, but no API route or page-facing read exists for them, and this PR may not invent one. A route plus the screen is a separate PR.
- **No internal note composer and no full assignment history.** `chat-ui4`'s composer and note thread need a server contract that does not exist (the case holds no notes, by design, decision 9 in `docs/plans/hc-13-follow-up-cases.md`, and audit rows have no read API). The timeline shows only what the record proves (opened, last assigned, last state change) and says nothing it holds no timestamp for.
- **No bulk stage moves and no row selection.** `tables15`'s bulk bar needs a bulk server action; none exists, so, as in PR 5, selection with no action would be dead UI.
- **No counts on the state tabs.** The list API returns no totals by design (a count would be an existence signal).
- **Names.** No contact name is shown (see above), so a case is identified by a short reference derived from its random id.
- **`switch-card1`** is in the registry listing and was read; it is a settings form of cards with a `Switch`. Harvest shows the state as a badge because consent is an append-only ledger.

## Dependencies

None. `package.json` and `package-lock.json` are unchanged.

## Tests

- Unit: new `tests/unit/kit-pr6-follow-up.test.ts` (roles and tabs, queue URL state, tracker steps, events, the control matrix for every role and state against the server's transition tables, confirmation rule, consent presets, `PermissionCard` markup); `tests/unit/navigation.test.ts` updated (the nav item for owner, admin and member, not viewer; breadcrumb parity). Provenance, showcase-registry and copy-rule tests pass with the three new records and the new group.
- E2E added: `tests/e2e/kit-pr6-follow-up.spec.ts` seeds five real cases through the intake page, the CRM ledger and the open-cases endpoint (association through the local admin connection with the response guard briefly off, as the HC-13 integration fixture does; needs `TEST_DATABASE_URL`, which CI sets), then checks owner, admin, the assigned member, another member and a viewer: visible nav item, queue rows and tabs, controls, the identical 403 for another member's case and an unknown id, viewer refusal on pages and API, assignment from the detail page, member progress, confirmation before Withdraw, no controls on a withdrawn case, consent buttons by role (member: withdrawal only). Sweep at 360/390/768/1280/1440 in light and dark: axe wcag2a, wcag2aa, wcag21aa, no horizontal overflow, 44px targets below 1024px, phone cards below 768px, table from 1280px. Plus a "Permission cards" case in `tests/e2e/ui-showcase.spec.ts`.
- Screenshots: `docs/screenshots/kit-pr6/` (360 and 1280, light and dark; plus the member's queue at 360).
- Ran locally (Chromium, one worker, 16 Nov 2026, local PostgreSQL through `TEST_DATABASE_URL`, `HARVEST_UI_SHOWCASE=1`): `kit-pr6-follow-up`, `ui-showcase` (5), `pr0a-consent-controls` (2): 8 passed; `kit-pr5-crm`, `crm07`, `connect`, `hc03-connect-links`, `studio-foundation`, `crm`, `kit-pr2-shell`: 21 passed. Unit project: 63 files, 898 tests pass. `npx tsc --noEmit`, `npx tsx scripts/check-source.ts`, eslint on every changed `.ts` and `.tsx` file and `npm run build` pass.

## Not verified

- No CI run, no real-device test, no screen-reader pass.
- The consent buttons were exercised for visibility by role; recording a consent from the case page was not exercised end to end (the same `ConsentForm` is covered on the person page by `pr0a-consent-controls`).
- A counselor who records a withdrawal on a case, and the resulting case behaviour (HC-14 propagation is not built), was not exercised.
- `first-load JS` per route was not measured (no new dependency).
- The other e2e specs (Communities, files, offline, campaigns, hc05 to hc07) were not run; none render a changed piece except the person page's permission rows, covered above.
- Existing screenshot files rewritten by the e2e runs were reverted.

## Decisions needed

1. Pending-response metadata views: add a route and screen in a separate PR (the server functions exist)?
2. Internal notes and an assignment history on a case need a server contract and a privacy decision (decision 9 and 10 in `docs/plans/hc-13-follow-up-cases.md`); wanted?
3. A counselor still reaches every contact through the CRM link under ordinary CRM permissions (decision 3 in the HC-13 plan, "restricted-contact visibility"); this PR does not change it.
4. Bulk assignment (a bulk server action first), and a per-campaign queue filter (needs a manager-only projection, `campaign_id` is hidden by design).
