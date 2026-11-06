# CRM-04 acceptance record: pipelines, stages, deals, board and list

Date: 2026-11-06. Scope: PRD v2.5 §5A.4 CRM-04 ("Pipeline stages and deals with a validated Kanban and list view") and companion PRD §5 (5.-02 configurable stages and probability, weighted value and stale-deal indicators; entities `pipelines`, `pipeline_stages` and `opportunities`; a move API; and the acceptance test "Kanban drag writes actual stage transitions once; reload preserves it").

Design: [ADR 0009](../decisions/0009-crm-pipelines-and-deals.md). Reference study: [Twenty and v1 notes](../research/twenty-crm-reference.md#crm-04-pipelines-stages-deals-and-the-board).

**Out of scope, unchanged:**
- tasks, notes and the unified timeline (CRM-05); CSV import, export and merge (CRM-06);
- Social Studio, scheduler, AI, email and calendar sync, automation;
- custom objects and deal custom fields;
- CRM outbox producers;
- the soft follow-ups from #9–#12.

## What a user can do

- **Pipelines** (`/workspaces/:tenantId/crm/pipelines`, plus `/pipelines/:pipelineId` when there are several). The sidebar has a "Pipelines" entry under CRM.
  - The first owner, admin or member to open it gets the default pipeline (New, Contacted, Qualified, Proposal, Won, Lost).
  - The header shows the deal count, open value, weighted value and stale count. A pipeline switcher appears when there is more than one pipeline.
- **Board.**
  - One column per live stage, in order. Each header shows the stage colour, name, count, summed amount and probability.
  - Cards show the deal name (a link to the deal), company or person, amount, expected close date and a calm **Stale** badge.
  - Drag a card to another column (pointer, via `@dnd-kit/core`), or focus a card and press **Shift+← / Shift+→**. Arrows move focus between cards; Enter opens the deal.
  - Moving to Won or Lost asks for an optional reason. A refused move snaps back with the reason shown, and a stale conflict offers Reload.
  - The columns scroll sideways inside the board; the page never does.
- **List.**
  - The same query in a table: deal, stage badge, amount, linked to, owner, expected close plus stale badge. Columns hide progressively with the card width.
  - Sort by name, amount, close date, created or updated, in either direction. Pages hold 20 deals.
- **Toolbar** (URL state, shareable): Board or List; search across deal, company and person names; stage; owner (anyone, nobody, a member); stale only; amount range; sort; clear filters.
  - An empty pipeline ("No deals yet") and an empty filter result ("No matching deals", with Reset filters) are different states.
  - A viewer who arrives before any writer sees "No pipeline yet".
- **New deal** dialog: name, stage, amount (USD), expected close, owner, and a company and/or person picked from the workspace. At least one link is required.
- **Deal page** (`/workspaces/:tenantId/crm/deals/:id`).
  - Inline title, stage select (through the move API, with the reason prompt), inline amount and expected close.
  - Owner select. The closing reason is shown for won or lost deals.
  - Company and person pickers, with clear only while the other link remains.
  - A stale notice, archive and restore, and an activity list from the audit ledger ("moved it from New to Contacted", "updated the amount").
- **Related deals** card on company and person records: stage badge, amount and stale badge, plus a **New deal** button that pre-links the record for writers. It is hidden for roles that cannot read deals (today every role can).
- **Pipeline settings** (`/workspaces/:tenantId/crm/settings/pipelines`; sidebar "Pipeline settings" next to CRM fields).
  - New, rename, make default, archive and restore pipelines.
  - Add stages (name, type, probability, colour token), edit them (name, probability, colour), move them up or down, archive and restore them.
  - Owners and admins edit; others see a read-only notice. Full-width page; short dialogs.

## Security and data rules verified

- FORCE RLS on all three tables. Without tenant context the runtime role sees nothing.
- Composite FKs keep a deal's stage inside its pipeline and tenant, and keep its company and person in the tenant. Raw inserts with another tenant's stage or company fail.
- SQL guards, tested directly:
  - immutable deal pipeline (no cross-pipeline move), and immutable stage key, kind and pipeline;
  - a closed reason only on Won or Lost stages;
  - the owner must be a workspace member;
  - there is no DELETE grant.
- Archiving a stage or pipeline that still has deals is refused (409 `stage_has_deals`), so no deal is ever orphaned. The last open stage and the default pipeline cannot be archived.
- **Two tenants, both directions:**
  - **Services and SQL** (`tests/integration/crm-deals.test.ts`): get, move, update stage, list by foreign pipeline id, create with a foreign company, raw select, update and insert.
  - **HTTP** (`tests/e2e/crm04.spec.ts`): A's user against B's deal and workspace, and B's user against A's (403 for the foreign workspace, 404 for foreign ids in one's own workspace).
- **Permissions:**
  - Viewers get 403 for creating, updating and moving deals and for pipeline/stage writes (services and API).
  - Members get 403 for pipeline and stage settings.
- **Concurrency:**
  - A stale move or update returns 409 and changes nothing.
  - A same-stage move writes nothing.
  - Exactly one audit row is written per real transition.
  - Board moves are queued, so quick consecutive moves never race.
- **Weighted value:** open stages only. A missing amount or probability contributes nothing. Won and Lost are excluded. Unit- and integration-tested.
- **Stale:** open, with an expected close before today in Europe/Berlin. Won deals with past dates are never stale. Unit-tested across the UTC/Berlin day boundary.
- **Erasure** keeps the deal, sets its person link to NULL and bumps its version, on fresh and upgraded databases. No row or audit metadata keeps the erased person's id.
- **Audit metadata** for deals holds field names and stage ids only, never amounts, names or reasons (asserted).
- **No CRM outbox events** are emitted.

## Commands and results (this branch, 2026-11-06)

RESULTS_TABLE

## Migration notes

- `0015_crm_pipelines_deals` (generated; one index statement moved before the FKs that need it): creates the three tables, with checks and indexes.
- `0016_crm_pipelines_policies` (hand-written):
  - RLS, grants and erasure-owner policies (opportunities, plus stages for the guard);
  - three guard triggers;
  - `CREATE OR REPLACE erase_contact`: 0014 plus unlinking the person from deals.
- Additive, and idempotent under the harness's double-apply. `tests/integration/crm04-upgrade.test.ts` seeds a database at 0014 (post-CRM-03) with a person, a company, a custom field value and a saved view. It then upgrades, checks that they survive, lazily seeds the pipeline, creates and moves a deal, and erases the person.
- No backfill: existing workspaces get their default pipeline on first use by a writer.
- Rollback before deploy: drop the three tables and restore `erase_contact` from 0014. No production data exists, and no production Neon, R2 or Vercel settings were touched.

## Deviations and limitations (documented)

- The **default pipeline is created lazily** by the first writer, not at workspace creation (ADR 0009 §4).
- **One currency (USD)**. The column exists, but the API accepts only USD so totals never mix currencies.
- **No saved views for deals yet.** Board and list state is in the URL and shareable; extending `crm_saved_views` to opportunities is a follow-up.
- **No reordering within a column.** A moved card goes to the end of its new column.
- **Board limit:** the board renders up to 500 cards per pipeline (totals still count every match); the list paginates everything.
- **Stale** uses Europe/Berlin because there is no per-workspace time zone yet; dates are still displayed as calendar dates.
- **No deal custom fields** (CRM-03 definitions cover people and companies).
