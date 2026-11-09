# HC-06A — Canonical contact source history

Implementation plan, 9 November 2026. First HC-06 PR; planning only. Parent: [delivery sequence](hc-06-delivery-plan.md). Full domain contract: [HC-06](hc-06.md).

## Outcome

An authorized organizer can see whether a contact was created manually or acquired/touched by a successfully applied CSV import, with trustworthy dates and history. Existing contacts without recorded provenance show **Unknown**. This introduces the reusable source ledger that verified Connect association will write later.

Example: a person created manually and later enriched by an import keeps both events. An imported match does not overwrite their original source or pretend to create them. An import preview, failed row or skipped match does not create a source event.

## Verified code boundaries

| Responsibility | Existing code to extend |
| --- | --- |
| Manual contact creation | `src/server/contacts.ts:createContact` — tenant transaction, identifiers and audit |
| Person import application | `src/server/crm-imports.ts:applyPerson`, `commitImport` — chunked processing and per-row savepoints |
| Import rollback | `src/server/crm-imports.ts:rollbackImport`; latest `rollback_crm_import` in `drizzle/0024_crm_associations.sql` |
| Merge preview/confirmation | `src/server/crm-merge.ts`; latest `merge_contacts` in `drizzle/0024_crm_associations.sql` |
| Contact erasure | `src/server/contacts.ts:eraseContact`; latest `erase_contact` in `drizzle/0026_hc02_connect_intake.sql`, preserving its Connect scrub hook |
| Permissions and tenant context | `src/server/permissions.ts`, `src/server/tenancy.ts` — live membership checks and transaction-local identity |
| People list/detail reads | `src/server/contacts.ts:listContacts`, `getContact` |
| UI composition | `src/components/crm/list-page.tsx`, `record-layout.tsx`; People list and person detail route compositions |
| Existing regression suites | `tests/integration/crm-imports.test.ts`, `crm-import-export-isolation.test.ts`, `crm.test.ts`, `crm-associations.test.ts`, migration upgrade tests |

At planning baseline `51fcbd6`, no canonical contact-source ledger exists. The migration journal ends at 0030. Reconcile main and open migrations before choosing the next tag; never edit a merged migration.

## Bounded changes

### 1. Minimal shared persistence

Propose `contact_source_events` with an event ID, tenant/contact composite reference, explicit source kind, creation-versus-existing-contact outcome, server-derived occurrence/recording times and a stable writer idempotency key. CSV events carry a restricted composite import/row reference; manual events need no arbitrary payload. Final SQL names/constraints belong in the implementation review.

Only `manual` and `csv_import` writers ship in A. Do not fabricate campaign/link/form IDs, reserve misleading Connect events or add a nullable JSON bucket for future providers. B can extend the same ledger additively for verified Connect origins. No new runtime dependency.

Enable and FORCE RLS, tenant-composite integrity and indexed bounded reads. Deny direct application INSERT/UPDATE/DELETE on the ledger. Use narrowly scoped fixed-search-path database functions/triggers, following existing trusted-write patterns. These must derive/validate actual operation context and authority; a generic caller-selected kind/contact/import event API would allow fabricated history. Choose trigger versus definer placement after proving permissions and rollback behavior with the application role.

### 2. Atomic real writers

- Manual creation: one event in the same transaction as the canonical contact and identifiers. Failure rolls back the whole operation. Updates and company linking do not invent new acquisition events.
- CSV create/fill: one event for each successfully applied person row, inside its existing savepoint. Preserve whether it created or updated the contact. No event for preview, skipped/no-op, invalid/conflicting or failed rows; company-only imports stay unchanged.
- Use one stable import identity plus row number for retry deduplication; repeated chunk/finalize requests cannot append duplicates. A manual creation event is unique for that created contact; this does not introduce a general request-idempotency framework or change existing same-name creation rules.
- Source recording never changes consent, identifiers, contact deduplication rules or import matching behavior.

### 3. Lifecycle safety from the first writer

- Merge: re-parent all source events before erasing the losing contact, preserving independent origins and event keys/timestamps. Extend merge preview counts only for authorized readers. Audit event keys must not retain erased contact identifiers.
- Erasure: scrub/delete source linkage through the controlled erase path, preserving all current Connect/import/outbox cleanup. No raw cells, filenames, emails, actor profiles or source evidence survive in a new ledger tombstone.
- Rollback: the new ledger must not make every import-created contact appear to have unrelated children and therefore become undeletable. A removed contact loses its events. A reverted fill keeps an honestly labeled historical event marked reverted, excluded from active acquisition-source summaries; a kept row/contact retains its actual event. Include rollback outcome transitions in the controlled rollback transaction, preserving existing consent/version/child protection.
- Import cleanup: retain no copied filename/cells. Define FK behavior so scrubbing import rows does not leak data or unintentionally delete another contact's history. Reuse existing approved retention/erasure boundaries; introduce no new indefinite retention rule or automatic deletion period. Future Connect events must inherit their response expiry/scrub rules in B.
- Prove merge/erase/rollback interleavings and lock ordering; a source write must not resurrect an erased contact or attach to a stale losing record.

### 4. Minimal Studio Admin presentation

Propose a dedicated `contacts:sources_read` permission, initially owner/admin only, matching the current restricted Connect posture. Confirm this conservative mapping in the PR; do not grant it implicitly to members/viewers or via a saved view. Existing members can still create/import with their current permissions; trusted writers record provenance without granting source-read access.

Use the existing People column selector/grid composition for an optional **Source** column, and an existing record card/section for **Source history**. Show compact Manual / CSV import labels, date, created/updated outcome and a truthful reverted marker. Use a bounded ordered history with stable date/ID ordering; no unbounded list or N+1 queries. The source column must not be advertised as sortable/filterable until C provides server semantics. Existing saved views remain valid.

Distinguish no recorded origin (**Unknown**) from no permission: unauthorized callers receive no source payload, counts or source-column option. They must not see Unknown as a false statement about hidden history. Server access checks remain authoritative even if a client requests a hidden field. No new source CSV export column, AI projection, webhook field, permission-management UI or standalone source page.

Reuse semantic tokens, shadcn primitives, ListPage/record composition and existing loading/error patterns. Preserve aligned toolbar heights and the shared filter UI. Check narrow mobile, tablet and desktop in light/dark modes, keyboard access and 44px interactive mobile targets. Avoid routine helper paragraphs and decorative controls.

## Acceptance and validation

| Scenario | Required result |
| --- | --- |
| New manual contact; transaction failure | Exactly one truthful creation event, or no contact/event after rollback |
| Old contact without evidence | Unknown; no fabricated historical manual/import source |
| CSV create, fill, skip, conflict, partial failure, resumed chunk | Events only for successful applied person rows; stable row-level deduplication |
| Two imports touch one contact | Both events retained; original source not overwritten |
| Rollback removes/reverts/keeps | Events and labels follow actual row outcome; existing rollback protections remain intact |
| Merge then erase | Origins move atomically; erasure removes all sensitive linkage and preserves existing cleanup |
| Concurrent import/merge/erase | No orphan, resurrection, duplicate or stale association |
| Member/viewer, foreign tenant, direct SQL, revoked role | Denied or no source projection as appropriate, including counts/column metadata |
| Saved views, list pagination/count and existing CSV exports | Existing semantics unchanged; source summary query does not multiply contacts |
| Fresh DB and populated upgrade | New schema/guards install, existing records remain usable, old origins stay Unknown |

Extend meaningful integration coverage at the database/service boundary, including application-role denial. Add pure unit coverage only for nontrivial new formatting/validation. Run targeted CRM import/merge/erase/export regressions, migration checks and normal repository lint/type/build checks. Capture realistic responsive/light-dark/keyboard evidence. Obtain fresh non-author exact-head review and required CI on the final implementation head; avoid redundant pipeline runs. No tests or pipelines are run merely for this planning document.

## Excluded and subsequent work

B1 adds restricted association/consent/subject-rights persistence; B2 adds the atomic verified association service; B3 integrates the immutable notice and existing claim flow. C adds source Include/Exclude, same-event matching, first/latest/any/Unknown and distinct permission predicates. D verifies complete cross-slice flows and fixes specific findings. These remain separately tracked roadmap tickets.

No Connect association, new consent grants, source filters, outbound messaging, new major system, migration execution, merge, deployment or real-data activation in A's planning task. Five HC activation decisions remain unapproved. The proposal is one implementation PR; if actual permission/lifecycle work proves too large, update the split explicitly before expanding it.
