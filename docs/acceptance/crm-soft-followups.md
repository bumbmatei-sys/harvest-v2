# CRM soft follow-ups (server-side pass)

Branch `crm-soft-followups`, from main `b040dba`. Spec `docs/superpowers/specs/2026-11-13-crm-soft-followups-design.md`, plan `docs/superpowers/plans/2026-11-13-crm-soft-followups.md`. No migration, no UI change, no new message string.

## Done

- **CRM-07 N1.** Simultaneous redelivery with the same external id now stores one row; the others return `{ stored: true, duplicate: true }` with the winner's id (no second audit or outbox row). Before: 409 "stale".
- **CRM-07 N2.** A withdrawal racing `recordAssociation` returns `consent_withdrawn` and stores nothing. Before: a 500 from the insert guard. The service now locks the person row before reading consent, as the guard does.

Evidence: `tests/integration/crm-associations-races.test.ts` (both failed on main before the change; both pass after).

## Skipped, with reasons

| Item | Reason |
| --- | --- |
| CRM-07 N3, N4 | Live in the SQL erasure/merge functions; need a migration and (N4) a product rule. |
| CRM-07 N5 | Display wording on the timeline: UI. |
| CRM-05 F1 | Product decision (ADR 0010 section 8); needs its own design and a migration. |
| CRM-05 N1 to N7, CRM-06 N1 to N8 | Listed by id only; the review text (`v2-15-r1-REVIEW.md`) is not in the repository. |
| Import row, delivery and outbox retention | Needs DELETE grants (migration) and retention periods decided by the founder. |
| Pending approval cap | The refusal needs a new error message (user-visible copy) and the limit is a product choice; the approval screen does not exist yet. |
| First endpoint receives the outbox backlog | Changes delivery semantics; founder decision. |
| CRM-08 approval TTL and concurrency | Already on main with tests. The "parked" wording in older notes is stale. |

## Decisions and limits

1. **No migration.** Both fixes are in the service. 0046 stays unused by this branch.
2. **N1 uses `ON CONFLICT DO NOTHING` on the existing partial unique index** rather than a savepoint or catching 23505, because a failed statement would abort the surrounding transaction. If the winner's row cannot be re-read (erased in between) the old 409 `stale` is kept.
3. **N2 relies on the row lock plus READ COMMITTED**, not on mapping the guard's generic exception. The guard stays the authoritative backstop; a withdrawal that commits after the lock is taken waits for this transaction, which is the same ordering as before.
4. **The lock is taken for every association write** (also when the person is found by identifiers). It is the same lock the guard takes a moment later, so it adds no new contention class; concurrent writes for one person already serialize on it.
5. **F1 and the N-items above stay open** and are recorded in the CRM-07 "Parked follow-ups" list; they are not silently dropped.
6. **Unit project:** two unit tests (`hc05-http` and `jobs` CLI setup redaction) fail only in this sandbox worktree because `node_modules/tsx/dist/cli.mjs` is missing there. They do not touch this change.

## Commands and results (local)

- `npx vitest run --project integration` on `crm-associations-races`, `crm-associations`, `crm08-events`, `crm08-ai-tools`: 37 tests, all pass.
- Non-root user: `crm07-upgrade`, `crm-associations-races`, `crm-associations`: 18 tests, all pass.
- `npx vitest run --project unit`: 435 pass, 2 sandbox-only failures (decision 6).
- `npx tsc --noEmit -p .`, `eslint --max-warnings=0` on the two changed files, `scripts/check-source.ts`: clean.
- Not run: CI, Neon, independent review (the coordinator does these).
