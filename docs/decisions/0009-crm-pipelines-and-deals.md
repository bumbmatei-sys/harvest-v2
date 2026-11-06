# ADR 0009: CRM pipelines, stages and deals

Accepted 2026-11-06 for CRM-04 (PRD v2.5 §5A.4 "Pipeline stages and deals with a validated Kanban and list view"; companion PRD §5, requirement 5.-02). Builds on [ADR 0007](0007-crm-companies-and-links.md) and [ADR 0008](0008-crm-fields-and-views.md). Twenty was studied for behaviour only ([notes](../research/twenty-crm-reference.md#crm-04-pipelines-stages-deals-and-the-board)).

## Decision

1. **Opportunities are a first-class object.** They are not a custom object, and not a CRM-03 field type. There are three tenant tables, each with key `(tenant_id, id)`:
   - **`crm_pipelines`**: name, `is_default` (a partial unique index allows at most one live default per tenant), position, `archived_at`, version.
   - **`crm_pipeline_stages`**: a stable **immutable key** (`^[a-z][a-z0-9_]{0,39}$`, unique per pipeline), name, **kind** (`open`, `won` or `lost`; immutable), optional probability 0–100, a **colour token** (`neutral`, `primary`, `success`, `warning`, `destructive`; these map to theme classes, never to raw colour values), position, `archived_at` and version.
   - **`opportunities`**: name, `pipeline_id`, `stage_id`, `amount numeric(14,2)`, `currency` (only `USD` for now; see below), `expected_close_date` (calendar date), `owner_user_id`, `company_id`, `contact_id`, position, `closed_reason`, `stage_changed_at`, `archived_at` and version.

2. **Integrity in the database.**
   - Composite FKs: `(tenant_id, pipeline_id, stage_id)` references the stage's `(tenant_id, pipeline_id, id)`, so a deal's stage always belongs to its own pipeline and tenant. Company and person FKs are also tenant-composite.
   - A guard trigger enforces:
     - provenance (`created_by` is the verified user);
     - immutable deal identity **and pipeline**, so a deal never moves across pipelines;
     - a live stage on insert or stage change;
     - a closed reason only on a won or lost stage;
     - a live (non-erased) person;
     - an owner who is a member of this workspace.
   - Stage and pipeline guards make key, kind and pipeline immutable, and refuse to archive a stage or pipeline that still has live deals.
   - FORCE RLS on all three tables. Column-scoped UPDATE grants. **No DELETE grants**: pipelines, stages and deals are archived, never deleted.

3. **Permissions.** These match the existing contacts and companies capabilities:

   | Permission | Who has it | What it allows |
   | --- | --- | --- |
   | `opportunities:read` | all roles | read deals and pipelines |
   | `opportunities:write` | owner, admin, member | create, update, move and archive deals |
   | `crm:pipelines_write` | owner, admin | pipeline and stage settings, because they change everyone's board |

   Unknown roles fail closed. A Related deals card appears on company and person records only for roles that hold `opportunities:read`.

4. **Default pipeline: created lazily, once.** When a member with `opportunities:write` first opens Pipelines (or creates a deal), Harvest creates the "Pipeline" with New → Contacted → Qualified → Proposal → Won → Lost. Probabilities are 10/25/50/75/100/0, and names come from `Crm.defaultStages.*`. A transaction-scoped advisory lock makes this happen exactly once. Existing workspaces need no backfill.

   A viewer who arrives first sees "No pipeline yet" rather than causing a write. *Deviation from "seed on workspace creation": the outcome is the same, and workspace creation (auth/onboarding) stays untouched.* New pipelines start with the same stages. New open stages are inserted before the first closed stage, so Won and Lost stay at the end.

5. **Archiving rules.** These are refusals, never silent moves:
   - A stage with live deals cannot be archived (409, `stage_has_deals`); the user moves those deals first.
   - A pipeline needs at least one open stage.
   - The default pipeline cannot be archived until another pipeline is made the default.
   - A pipeline with live deals cannot be archived.
   - Archived stages and pipelines keep their history and can be restored. Restoring a stage respects the 20-stage limit, as creating one does.
   - **Invariant: a live deal is always in a live stage of a live pipeline.** Restoring an archived deal whose stage or pipeline is archived is refused with **409 `{ reason: "parent_archived" }`** ("Restore the stage first" or "Restore the pipeline first"). Nothing is relocated silently; the user restores the parent, then the deal. The service locks the stage and then the pipeline `FOR SHARE` before checking. The deal guard (replaced in migration `0017`) re-checks the same thing in the database, so raw SQL cannot bypass it. Archiving a stage or pipeline takes those rows `FOR UPDATE` and re-reads live deals inside its guard. A racing archive and restore therefore serialize on the parent row: exactly one wins, and the other gets 409 (integration-tested over 12 rounds on a multi-connection pool).

6. **Moves and concurrency.**
   - **Parent lock order is stage → pipeline**, matching `updateStage`, the service restore check and the `0017` database restore trigger. Stage creation and reorder lock **all existing stages, including archived stages, in ascending stage ID order** before locking the live pipeline. Creation can shift archived/closed stage positions too. Pipeline-only edits do not acquire stage locks. No path may hold a pipeline lock and then acquire an existing stage lock.
   - After taking the pipeline lock, creation/reorder re-read the stage IDs. A stage inserted while the initial locking query waited causes a **409 `stale`**, rather than taking the new stage lock in reverse order. Reorder still requires exactly the live stage IDs. All locks and writes remain in the tenant transaction; no schema change is needed.
   - The controlled concurrency regression in [crm-deals-concurrency.test.ts](../../tests/integration/crm-deals-concurrency.test.ts) holds a stage share lock, waits until reorder/creation is blocked on it (observed through `pg_blocking_pids`), then restores a deal through the real `0017` trigger. Both operations finish with the new order; the former pipeline-first implementations deadlock. Remaining PostgreSQL deadlock/serialization aborts (`40P01`/`40001`, including wrapped errors) return a sanitized **409 `{ reason: "stale" }`** through [the HTTP boundary](../../src/server/http.ts), so clients can reload and retry. No automatic replay of mutations is introduced.
   - `POST /api/workspaces/:t/crm/deals/:id/move` takes `{ stageId, version, closedReason? }`. The record version must match (409 `{ reason: "stale" }` otherwise). The target stage must be live and in the same pipeline (400 for another pipeline, 404 for a foreign or archived stage).
   - Moving to the stage the deal is already in writes nothing.
   - Each real move bumps the version once, sets `stage_changed_at`, puts the card at the end of the target column, and writes **one** audit row (`opportunity.move` with the from and to stage ids). A repeated or stale drop therefore cannot record a second transition, which satisfies the companion acceptance test "Kanban drag writes actual stage transitions once; reload preserves it".
   - Moving to an open stage clears `closed_reason`; moving to Won or Lost can record an optional reason.
   - On the board, a drop applies optimistically. Moves are **queued**, so a quick second move carries the version the first returned (Twenty's board has a known race here). A refused move reverts the card, shows the error, and offers Reload on a stale conflict.
   - Shift+←/→ on a focused card uses the same path, giving keyboard parity with dragging.
   - **Column positions** come from one allocator, used for both create and move: MAX(position)+1 within the target stage, taken under a transaction-scoped advisory lock keyed on (tenant, stage). Concurrent appends to one column are serialized and always get distinct, increasing positions. Each transaction takes at most one such lock (after its deal row lock, if any), so allocators cannot deadlock. This is integration-tested with eight simultaneous moves and eight simultaneous creates on a 10-connection pool; the same test fails without the lock.

7. **Values.**
   - **Open value** is the sum of amounts in open stages.
   - **Weighted value** is Σ(amount × probability ÷ 100) over open stages. A deal with **no amount, or a stage with no probability, contributes nothing**; it is skipped rather than counted as zero-value noise.
   - Won and Lost never count toward open or weighted value.
   - Totals cover every deal matching the filters, not only the cards loaded on the board (the board renders up to 500 cards; the list paginates everything).
   - One currency (USD) for now: the column exists, but the API accepts only `USD`, so sums never mix currencies. Multi-currency is a later product decision.

8. **Stale deals.**
   - A deal is stale if it is in an open stage and its `expected_close_date` is before **today in `Europe/Berlin`**. The app has no per-workspace time zone yet, and display formatting stays UTC as before.
   - Stale shows as a calm warning badge, a board-level count, a filter and a notice on the deal page.
   - Nothing moves automatically.

9. **Erasure.** Deals are the organisation's business records, so erasing a person **keeps the deal**. `erase_contact` (replaced in migration 0016) sets the deal's `contact_id` to NULL and bumps its version before the person is re-keyed. A deal can therefore end up with no relation; its page explains this and offers to link a company or person. Deal audit metadata never contains person ids, amounts, names or reasons, only stage ids and field names. Companies cannot be deleted in Harvest yet, so they need no rule.

10. **Activity.** Deal history is read from the audit ledger (`opportunity.*`, plus `crm.pipeline_*` and `crm.stage_*` for settings). There are **no CRM outbox events**.

## Consequences

- Saved views (CRM-03) are not extended to deals yet. Board and list state is shareable through the URL (`mode`, `q`, `stage`, `owner`, `stale`, `min`, `max`, `sort`, `page`). Adding `opportunity` to `crm_saved_views.object_type` is a follow-up.
- Deal custom fields are not included. CRM-03 definitions are scoped to `person` and `company`.
- Cards are not reordered within a column. Order is position (append on move), then recently updated.
- Migrations: `0015` is generated by drizzle-kit, with the `(tenant, pipeline, id)` unique index moved before the FKs that reference it, as in 0013. `0016` is hand-written: policies, grants, guards and the erasure function. `0017` (review fix) replaces `guard_opportunity` with the restore check above; otherwise it is identical.
