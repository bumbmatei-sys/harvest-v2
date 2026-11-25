# Docs: trash retention and page style save flush

Follow-up to Docs slice 1 (`docs/acceptance/docs-slice1.md`, "Trash purge" was deferred). Nothing is activated: the purge job is registered but hard-off (`DOCS_TRASH_PURGE_ENABLED = false` and `HARVEST_DOCS_TRASH_PURGE_ENABLED` must be `1`), nothing is sent outside the database, no webhook, no HC-02 gate changes. Docs itself still answers 404 in production.

## Retention rule

A doc stays in the trash for 30 days (no earlier decision in the PRD or plan; `docs/plans/docs-module.md` left "retention" to this follow-up). After that the worker purges it for good. Restoring a doc clears `deleted_at`, so a restored doc is never purged.

## Done

- **Migration `0102_docs_trash_purge`.** `public.docs_purge_trash(p_limit)`: SECURITY DEFINER, fixed `search_path`, `REVOKE ALL ... FROM PUBLIC, harvest_app`, `GRANT EXECUTE` to `harvest_worker` only; refuses any session that is not `harvest_worker`; `p_limit` 1 to 200 (the job uses 100). Each doc is locked (`FOR UPDATE SKIP LOCKED`) and re-checked, so a restore that lands first wins. Per doc: favourites, pages and the doc row are deleted, and comments, shares, page shares, links, page history, attachments and notifications are cleared when those tables exist (Docs slice 2 tables, looked up with `to_regclass`; they are not on `main` yet).
- **Policies.** `docs_purge_*` on `docs`, `doc_pages`, `doc_favorites` and `audit_logs`: `TO PUBLIC USING (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.docs_purge', true) = 'on')`, switched on only inside the function's own transaction. The doc lock policy has `WITH CHECK (false)`. The worker role has no table privilege.
- **Audit: count only.** One `audit_logs` row per ministry per run, action `docs.trash.purge`, no actor, no target, metadata `{count}`. No title, id or content of a purged doc is kept. `audit_system_actor` now lists the action (`src/db/schema.ts`).
- **Job.** `docs_trash_purge` in the worker registry (daily, 03:07 UTC), leased and run like the other retention jobs.
- **Contacts.** No foreign key points at `contacts`, so `erase_contact` and `merge_contacts` are unaffected.
- **Style save flush.** A style change now goes through the shared save: the header status shows Saving, then Saved, and an error or conflict shows as for text. A style change not yet confirmed is held (`pendingStyle`) and sent with the next save, and on `pagehide` it is sent with the text and title through a keepalive request. When the tab is only hidden (`visibilitychange`) the normal save runs, so the version stays in step. The pending-fields rule is `pendingPageFields` in `src/lib/docs.ts`.

## For Docs slice 2 (#225, #229)

Every table that points at `docs` or `doc_pages` with a restrictive or no-action foreign key needs the same two policies the purge uses (a `SELECT` and a `DELETE` policy with the gate above) so the purge can clear it; until then the function leaves that doc in the trash and carries on with the others (the integration test covers this). Attachment rows are removed with the doc; deleting the stored file objects is not part of this change.

## Evidence

- Integration `tests/integration/docs-trash-purge.test.ts` (5): 30-day rule with pages and favourites, restored and younger docs kept, per-ministry isolation, audit count only, bounded batches and argument limits, worker-role-only access, a blocked doc left in the trash while the batch continues.
- Unit `tests/unit/docs.test.ts`: `pendingPageFields`.
- E2E `tests/e2e/docs.spec.ts`: a style toggled twice and the page reloaded at once keeps both, and the status shows the save.
- `docs.test.ts`, `erasure.test.ts`, `rls.test.ts`, `worker-role.test.ts`, `crm-imports.test.ts`, `cf04-lease.test.ts` integration, `tsc`, lint and source guards pass; a second `drizzle-kit generate` reports no schema changes.
