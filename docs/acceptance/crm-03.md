# CRM-03 acceptance record: custom fields, saved views, filters and the grid

Date: 2026-11-05. Scope: PRD v2.5 §5A.4 CRM-03, companion PRD §5. Design: [ADR 0008](../decisions/0008-crm-fields-and-views.md), building on [ADR 0007](../decisions/0007-crm-companies-and-links.md). Reference study: [Twenty and v1 notes](../research/twenty-crm-reference.md#crm-03-fields-saved-views-filters-and-the-grid). Out of scope (unchanged): pipelines/deals (CRM-04), tasks/notes/timeline (CRM-05), CSV import/export/merge (CRM-06), Social Studio, scheduler, AI, email and calendar sync, workflow automation, custom objects, computed and formula fields, and CRM outbox producers.

## What a user can do

- **Fields settings** (`/workspaces/:tenantId/crm/settings/fields`, sidebar "CRM fields"): tabs for People and Companies. Owners and admins can create a field (label; key generated from it and editable before creation; type text, number, date, yes/no, select, multi-select or relation to people or companies; description; required; options). They can edit the label, description, required flag and options, and archive or restore a field. Key, type and relation target are fixed after creation. Everyone else sees the list read-only, with a notice. The page is full-width; its dialog is a short form.
- **Record pages**: a **Custom fields** card on every person and company. Text, number and date use the same inline editor as built-in fields (Enter or blur saves, Escape cancels). Select and yes/no use a native select that saves on change. Multi-select uses a checkbox popover. A relation uses the server-searched record picker, with a clear button. Required fields show a marker and cannot be cleared. Viewers see values read-only. The activity timeline names changed custom fields (field names only, never values).
- **Lists** (People and Companies) share one view bar:
  - **Views menu**: grouped built-in, workspace and personal views. *Save as new view* (only me or everyone in the workspace), *Update view* (own or workspace views, shown only when the list differs from the view and marked "Edited"), *Reset*, and *Delete* with confirmation. All are explicit; nothing auto-saves.
  - **Search** and a two-step **filter builder**: pick a field, then a condition and a value suited to its type. Chips show and remove each filter; *Clear filters* removes them all.
  - **Sort**: any built-in or scalar custom field, ascending or descending.
  - **Columns**: show or hide, move up or down, and comfortable or compact density.
  - **States**: an empty workspace and an empty filter result look different, and the latter offers *Reset view*.
- **Built-in views**: People: All people, Email subscribers, Unsubscribed, No email decision, No company. Companies: All companies, With people, No domain.
- **Grid keyboard**:
  - One Tab stop. Arrows move (right from the last column wraps to the next row); Home and End jump.
  - Enter or F2 edits an editable cell; Enter on Name opens the record.
  - While editing: Enter or blur commits, Tab commits and moves, Escape cancels.
  - Editable cells: email and phone (people), domain (companies), and custom text, number, date, yes/no and select.

## Security and data rules verified

- Three new tables force RLS. Without tenant context the runtime role sees nothing (integration test).
- Values carry composite FKs to `(tenant_id, field_id, object_type)`, the record and the related record. A value can therefore never join another tenant's or another object type's rows, even through direct SQL as the runtime role (trigger and FK tests with positive controls).
- Saved-view RLS hides another member's personal view even from raw queries in the right tenant, and blocks forging `owner_user_id`.
- **Two-tenant isolation in both directions**:
  - Services and SQL (`tests/integration/crm-fields-views.test.ts`): foreign field ids, values, relation targets, filters on foreign ids, views and view ids.
  - HTTP (`tests/e2e/crm03.spec.ts` plus `tests/e2e/crm.spec.ts`): unknown or foreign view ids fall back to the default view.
- **Viewers**: denied creating or changing definitions, values and views, through both the services and the API (403).
- **Members**: may edit values and save views, but not definitions (owner and admin only).
- **Optimistic concurrency**: custom values use the parent record's version. Stale writes return 409 and change nothing. Built-in and custom edits share the version. Saves on one record are serialized, so quick consecutive edits never race.
- **Filters**: every operand family runs server-side. One unknown field, operand or value (including an archived field) rejects the whole state. The page then shows the default view with a notice, never part of the view. CRM-02 links (`?company=`, `?email=`, `?marketing=`, `?people=`, `?domain=`) still work.
- **Erasure** deletes the person's custom values, relation values pointing at them, and saved-view filters that name them, before re-keying. This is tested on a fresh database and on an upgraded post-CRM-02 database.
- **No CRM outbox events** are emitted. Activity reads the audit ledger only.

## Commands and results (this branch, 2026-11-05)

Database-backed tests used `TEST_DATABASE_URL` against a local PostgreSQL 16 (embedded-postgres refuses to run as root in this container), as for CRM-01/02. CI uses its own PostgreSQL service and did not run here unless stated in the PR.

| Command | Result |
| --- | --- |
| `npm run lint` | exit 0; ESLint clean; "Source guards: no hard-coded JSX copy, feedback, or component colors." |
| `npm run typecheck` | exit 0 |
| `npm test` (unit) | 11 files, **129 passed** (includes `crm-fields.test.ts`, 16) |
| `TEST_DATABASE_URL=… npm run test:rls` (integration) | 16 files, **149 passed** (includes `crm-fields-views.test.ts`, 20, and `crm03-upgrade.test.ts`) |
| `npx drizzle-kit check` / `npx drizzle-kit generate` | "Everything's fine" / "No schema changes, nothing to migrate" |
| `npm run build` (`next build --webpack`) | exit 0; `/workspaces/[tenantId]/crm/settings/fields` compiled |
| `npx playwright test` (all 9 tests, 8 specs) | Full run: **7 passed, 2 failed** (`crm`, `foundation`). Both were test defects, fixed (see below). Reruns: `crm` **passed**, `foundation` ×2 **passed**. `crm03` passed in the full run and in two separate runs. |

Browser runs used the same uncommitted local Playwright config as CRM-01/02 (Chromium at `/opt/pw-browsers/chromium`) against `scripts/e2e-server.ts`. `npm run test:rls:neon` was **not** run (no Neon credentials; not authorized).

Test-only fixes made during verification:
- `crm.spec.ts`: follows the new view bar (filter builder, sort field and direction, "Clear filters"), the `grid` role, `%7E`-encoded filter URLs, and the grid focus model (focus lands on the cell, with an inset ring).
- `foundation.spec.ts`: axe ran while the workspace form's pre-hydration disabled button was still fading in (computed opacity 0.59), which axe reports as low contrast. The test now waits for the button to be enabled and fully opaque. The page itself is unchanged by CRM-03.

## Defects found and fixed while testing

1. **Generated migration order**: drizzle-kit emitted the composite FK before the unique index it references ("no unique constraint matching given keys"). The index statement now comes first in 0013, with a comment.
2. **PL/pgSQL `IF NOT CASE … THEN`** parsed the CASE's `THEN` as the IF's. The type check now computes into a variable first.
3. **Racing inline saves**: a second custom-field edit made while the first was still saving sent the old record version and got a false "record changed" notice. `RecordProvider` now queues saves per record (found by the browser test).

## Migration notes

- `0013_crm_fields_views` (generated, one statement reordered): creates `crm_field_definitions`, `crm_field_values` and `crm_saved_views` with checks, unique indexes and composite FKs.
- `0014_crm_fields_views_policies` (hand-written): forced RLS and policies (view visibility uses `app.user_id`), column-scoped grants, erasure-owner policies, three guard triggers, and `CREATE OR REPLACE erase_contact` (adds value and view-filter cleanup; otherwise identical to 0012).
- Additive, and idempotent under the harness's double-apply. `tests/integration/crm03-upgrade.test.ts` seeds a database at 0012 (post-CRM-02) with people, a company and a link, then upgrades, adds fields, values and a view, and erases.
- Rollback before deploy: drop the three tables and restore `erase_contact` from 0012. No production data exists. No production Neon, R2 or Vercel settings were touched.

## Deviations (documented)

- **Built-in views are code-defined** (`system:*`), not seeded rows: identical in every tenant, read-only, and needing no backfill (ADR 0008 §6).
- **Definitions need `crm:fields_write`** (owners and admins), stricter than `contacts:write`, because a schema change affects every member.
- **Columns** from a stored view that no longer exist (archived field) are omitted silently, unlike filters, which reject the view. A missing column cannot change which records are shown.
- **Required** is enforced on clearing and is shown on records. It is not enforced at record creation, because the create forms are unchanged in CRM-03.
- **Grid inline editing** covers email, phone, domain and scalar custom types. Name, multi-select and relation are edited on the record page (Enter on Name opens it).
- **Filters** combine with AND; relative date operands are deferred.
- Not touched, per the brief: the Company People tab's sideways-scroll follow-up and FU-8-1…7.
