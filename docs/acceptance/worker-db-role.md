# Worker database role (migration 0044)

Date: 13 Nov 2026. Branch `worker-db-role`. Spec `docs/superpowers/specs/2026-11-13-worker-db-role-design.md`, plan `docs/superpowers/plans/2026-11-13-worker-db-role.md`, runbook `docs/setup/worker-role.md`. **Approves no activation, deployment or production migration.** Closes the "dedicated worker role" activation gate asked for by the reviews of #72 (community email) and #73 (Connect retention) in code; the role itself still has to be provisioned in each real environment.

## Delivered

- **Migration `0044_worker_db_role`** (no schema change): revokes the six worker functions from `PUBLIC` and `harvest_app`, and grants them to `harvest_worker` only if that role exists. It never creates a role, and fails if an existing `harvest_worker` is superuser, BYPASSRLS, CREATEROLE, CREATEDB, INHERIT or a member of any role.
  - Community email (0042): `community_email_enqueue(integer)`, `community_email_claim(integer)`, `community_email_complete(uuid, text, text)`.
  - Connect retention (0043): `connect_retention_sweep(integer)`, `connect_retention_record_failure(text)`, `connect_retention_health()`.
  - Unchanged for `harvest_app`: `community_email_prefs_save`, `community_email_unsubscribe` (web), `community_purge_notifications` and `connect_suppress_small`.
- **Scripts** `scripts/send-community-email.ts` and `scripts/connect-retention.ts` read `WORKER_DATABASE_URL` (never `DATABASE_URL`) and call `requireWorkerRole` (`src/server/worker-role.ts`): refuse unless `current_user` is `harvest_worker`, non-superuser, no BYPASSRLS. The email script's "local database only" test-mode guard now checks `WORKER_DATABASE_URL`.
- **Test harness** (`tests/database.ts`): pre-creates `harvest_worker` as root (NOLOGIN NOSUPERUSER NOBYPASSRLS ...) before migrating, then sets `LOGIN` with a random password; the fixture exposes `workerPool` (max 1) and `workerURL`. Every database test gets it; existing behaviour is unchanged.
- **Provisioning**: `docs/setup/worker-role.md` (founder-run runbook with verification queries), `scripts/neon-dev-worker-role.ts` (dev branch only, not run), `WORKER_DATABASE_URL` in `.env.example`.

## Evidence (local)

- New `tests/integration/worker-role.test.ts` (9): role attributes and no memberships; worker can execute and call all six; `harvest_app` is refused all six with SQLSTATE 42501 and keeps the three web-facing definers; worker has no privilege on any public table, view or sequence, cannot read `community_email_deliveries`, `users`, `campaign_responses` or `connect_retention_runs`, and cannot execute the web definers; the role check refuses the app login and the superuser; both real scripts exit 1 with no output for the app login in `WORKER_DATABASE_URL` or for a worker login only in `DATABASE_URL`, and run for the worker login; 0044 applies cleanly with an absent role (grants nothing) and is re-runnable; a privileged role is refused.
- New `tests/integration/worker-role-owner.test.ts` (1, run as the non-superuser `tester`): the same grants and denial with a NOCREATEROLE migration owner.
- Existing worker-function callers moved to the worker role: `community-email-db`, `community-email`, `hc-retention-db`, `connect-retention`, `hc-retention-owner`, `community-joining-definer-owner`. No assertion was weakened.
- Results of the final runs are in the PR description.

## Decisions

1. **The migration never creates the role** (roles are provisioned outside migrations; restricted-owner tests run with NOCREATEROLE). It revokes unconditionally and grants conditionally.
2. **Applying 0044 before the role exists is safe but disables the workers**: the six functions are then callable by nobody except the owner until the role is created and the one-line grant in the runbook is run. Chosen over leaving `harvest_app` grants in place, which would keep the exposure open. The scripts do not run in production today.
3. **A privileged `harvest_worker` makes the migration fail** (mirrors 0001 for `harvest_app`) rather than quietly granting to an over-privileged role.
4. **Revoked from `PUBLIC` as well** as `harvest_app`, so no later role inherits the grant by default.
5. **Only the six functions move.** The web-facing email definers (`prefs_save`, `unsubscribe`) must stay with `harvest_app`. The purge scripts and the Connect dispatcher keep running as `harvest_app`; moving them is a separate decision.
6. **Separate env var `WORKER_DATABASE_URL`**, no fallback to `DATABASE_URL`, so a mis-set environment fails closed. The existing local setup therefore needs `WORKER_DATABASE_URL` before the two scripts run again.
7. **Test fixture**: the role is created in every `testDatabase()` (not only restricted-owner runs) so the 0044 grant is exercised everywhere; creation tolerates a concurrent duplicate. The worker password is random per fixture like the app password, and the fixture shares the cluster-wide role, so two fixtures must not be open at once in different files (the integration project already runs files serially).
8. **No new role for the purge scripts, no scheduling, no UI, no change to worker behaviour or policy numbers.**
9. **Snapshot**: `drizzle/meta/0044_snapshot.json` copies 0043's schema with a new id, since 0044 changes no tables.

## Limits

- `harvest_worker` is still a single role for both workers. Splitting email and retention would limit the retention job from the address-bearing claim function; not requested.
- Runtime and Neon verification are author-executed locally only. Neon migration check not run; no real environment was touched.

## Activation gates (founder, outside the repository)

1. Approve the role for each environment (staging, then production).
2. Create `harvest_worker` (SQL in `docs/setup/worker-role.md` step 1) with a generated password, kept out of chat.
3. Apply migration 0044 after 0043 through the approved migration procedure, or run the one-line grant if the role is created afterwards.
4. Put `WORKER_DATABASE_URL` in the scheduler environment that runs `communities:send-email` and `connect:retention`, not in the web deployment.
5. Run the verification queries and the smoke test in the runbook.
6. The existing activation gates of `communities-c15b.md` and `hc-retention.md` (scheduling, provider, legal review, unsubscribe page) remain open and unapproved.
