# HC-06 delivery plan after PR #44

Planning update, 9 November 2026. Proposed delivery split for founder review; no feature implementation, merge, deployment or production activation is included in this update.

The [HC-06 specification](hc-06.md) retains its complete domain requirements. This plan proposes replacing its original single-PR delivery assumption with smaller increments. It does not relax acceptance criteria or silently enable an incomplete association workflow.

## Verified starting point

- PR #44 merged as `51fcbd65fb2b516253f4144537c40d8f14e685f9`. Its reviewed head `36f519339d0d130ed493924c46dbf7e22b8d8998` passed all three required CircleCI checks, including browser and Neon migration/cleanup checks.
- People and Organizations now share the searchable icon-only filter popover, staged edits, chips and existing URL/saved-view persistence. Import/Export/Add controls have matching responsive heights. This implements presentation for existing field contracts, not new source or purpose predicates.
- HC-07 creates short-lived verified account claims and reserves `association_consumed_at`; it does not associate responses with CRM contacts. Existing response association guards must be deliberately extended.
- Canonical contact identifiers already enforce tenant-scoped identity uniqueness. CRM has saved views and shared server predicates for list/export/count. Durable associated-response subject rights and the proposed canonical source-event ledger are missing.
- The migration journal ends at `0030_connect_landing`. Reconcile the live journal before each schema change; 0031 is only the next candidate.
- PR #43 remains open as a separate infrastructure task. PR #38 is also open; #42 is superseded and #16 parked. Do not treat these as merged dependencies or block independent product planning on #43.

Repository anchors: `src/server/connect-invitations.ts`, `src/db/schema.ts`, existing Connect migrations/rights services, canonical contact identifiers/merge services, People query/export services, and shared CRM filter components. Verify exact paths and owning boundaries again in each implementation PR.

## Proposed sequence

| Slice | Customer-visible result | Planning allowance | Dependency |
| --- | --- | --- | --- |
| HC-06A | Accurate minimal contact source history for real manual/import activity | 1 PR | Merged #44 |
| HC-06B1 | Restricted association, consent-provenance and durable-rights persistence/services | 1 PR | A |
| HC-06B2 | Atomic verified claim → canonical contact service with concurrency/retry protection | 1 PR | B1 |
| HC-06B3 | New immutable notice and existing claim-screen/HTTP integration | 1 PR | B2 |
| HC-06C | Authorized source and distinct purpose segmentation in existing CRM filters | 1 PR | A contracts; B for full acceptance |
| HC-06D | Integrated acceptance and any specific closeout fixes | 0–1 PR | A–C |

Track **six ordered tickets**, with **4–6 actual PRs** provisionally: B2/B3 may combine if small enough for review, and D requires a PR only for actual changes. Never manufacture an evidence-only PR to meet the estimate. New association behavior remains unavailable until B1–B3 and their rights paths are complete; every intermediate PR ships its own security/lifecycle coverage. This is not a calendar commitment or a new launch-wide estimate. The earlier 41–61 PR planning band predates #44 and needs a later reforecast, not mechanical adjustment.

### HC-06A — Canonical source history: first proposed implementation

Detailed first-PR scope, code anchors, rollback semantics and acceptance: [HC-06A implementation plan](hc-06a-source-history.md).

Add a minimal tenant-scoped source-event ledger with controlled service/database writers, composite integrity, FORCE RLS and a narrowly scoped source-visibility capability. Use actual current manual creation and CSV import paths; importing an existing contact records an import event without pretending it created the contact. Never infer historical acquisition from an identifier, timestamp or name. Existing unproven origins display Unknown.

Expose minimal authorized source column/detail using the existing CRM layouts and shadcn components. Avoid private answers, tokens, arbitrary payloads and religious labels. Connect-specific references may be prepared in the shared contract, but this slice does not associate campaign responses.

Include idempotency, merge re-parenting, contact erasure and expiry/retention handling from the first writer. Do not defer lifecycle safety to D.

Acceptance: real manual/import operations record truthful events; retries do not duplicate them; cross-tenant or unauthorized readers cannot infer source identities through rows/counts/pickers; merge and erase leave no dangling or sensitive source records. Validate fresh and populated upgrade paths and responsive/light-dark/keyboard presentation.

### HC-06B — Verified claim association with durable rights

Introduce a new immutable preset/notice explaining automatic organizer CRM contact creation after an eligible verified campaign claim. Preserve existing v1/v2 promises and existing responses; no backfill and no extra CRM approval checkbox. Use the live verified session and recipient address inside the owning tenant, never names, caller-selected identifiers or global matches.

Atomically perform claim consumption, create/reuse, Connect source event, exact immutable form/notice consent provenance, durable subject binding and bounded completion outcome. Preserve existing contact details. Roll back failed association cleanly; account creation and free resources stay independent. A contact grants no newsletter/follow-up permission, membership, enrollment or religious status.

Ship response receipt/authenticated subject withdrawal, erasure, retention and existing CRM merge integration alongside the new boundary. Distinct purposes remain independent. Canonical consent precedence must respect occurred and recorded times and prevent stale grants from resurrecting withdrawn permissions. Response erasure must not erase an unrelated pre-existing contact/account; contact erasure scrubs linked data. Preserve existing expiry instead of inventing indefinite retention.

Test replay, expiry, identity conflict, concurrent claims/manual creation, merge/erase races and source pause/archive/rotation after lock waits. Document lock ordering and revalidation. If B is split into gated schema/service and integration PRs, keep new behavior unavailable until the complete transaction and durable rights path are present. Privacy/security tests accompany each boundary.

### HC-06C — Source and permission segmentation

Reuse the merged shared popover; add authorized named campaign/link/form/date pickers, Include/Exclude, any/first/latest recorded source and explicit Unknown. Campaign/link/form/date conditions within one group must match the same event. Included groups form a union; any matching excluded source removes the contact; unrelated field predicates remain ANDed. Distinguish newsletter and follow-up permission using effective canonical consent, not a generic marketing flag.

Extend one server predicate across rows/count/pagination, saved views, export preview/file and existing matching-set selectors. Version state additively and preserve existing view meanings. Invalid, inaccessible or revoked source rules fail closed; a saved/shared view never grants source access. Enforce live permissions at every server boundary, including counts, exports and pickers. Do not add outbound messaging or new AI/webhook projections.

Acceptance includes multi-origin contacts, same-event correlation, include A/exclude B, Unknown, saved-view round trips, permission revocation and exact list/export/count agreement.

### HC-06D — Integrated acceptance and closeout

Exercise the complete synthetic journey for new/existing contacts and account-only claims, retry/concurrency, source filters, purpose withdrawal, receipt rights, merge/erase and tenant denial. Verify migrations on fresh and populated databases and capture realistic responsive/light-dark/keyboard evidence. Obtain fresh independent exact-head review and required CI on each final PR head. Run a closeout PR only for specific discovered fixes; attach evidence to prior slices when no code change is needed.

## Boundaries and decisions

- Reuse Studio Admin, shadcn, canonical CRM identifiers, shared list/detail layouts and merged filters. Do not wait for or build a universal engine solely as a prerequisite.
- Exact source visibility requires an explicit server-enforced capability policy; review the concrete mapping and new immutable notice wording before activation. Keep private response/consent details restricted.
- HC-13 owns case assignment/lifecycle; HC-08 owns full onboarding. A persistent global Do not contact control remains an unresolved separate request, not an implicit addition here.
- All five [HC activation decisions](../decisions/hc-02-activation-gates.md) remain unapproved. Use synthetic engineering data; production intake and real invitation delivery stay disabled.
- Creator audiences, public Discovery, native articles, community storefronts and external blog distribution remain Post-launch. Core groups and courses/products remain launch scope. Zernio supplies the social API; social UI remains original Studio Admin. Optional themes are not launch blockers.
- After HC-06, resume the already queued CW-02 onward campaign/onboarding and CRM follow-up work, refining the next ticket against actual merged outcomes.

## Review point

The immediate proposed implementation is **HC-06A**, on a separate branch from current main. Review the delivery split and A's acceptance before starting it. Reconcile main/open PRs and migration numbering at that point. No CI pipeline is triggered for this planning-only update.
