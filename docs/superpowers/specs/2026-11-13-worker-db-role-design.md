# Dedicated database role for background workers (design)

Date: 13 Nov 2026. Status: implemented in this branch (migration 0044). Approves no activation and no deployment.

## Problem

The community email worker functions (0042: `community_email_enqueue`, `community_email_claim`, `community_email_complete`) and the Connect retention functions (0043: `connect_retention_sweep`, `connect_retention_record_failure`, `connect_retention_health`) are granted to the web role `harvest_app`. Code running as that role could read recipients' addresses across ministries through the claim function, mark any delivery sent, and falsify the retention health signal. Independent reviews #72 and #73 asked for a dedicated role.

## Design

- Role `harvest_worker`: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, no memberships, no table or sequence privileges, EXECUTE on exactly the six functions.
- Migration `0044_worker_db_role` revokes the six functions from `PUBLIC` and `harvest_app` (always) and grants them to `harvest_worker` only when that role already exists. It never creates a role: roles are provisioned outside migrations and the restricted-owner tests run with a NOCREATEROLE owner. If the role exists but is privileged (superuser, BYPASSRLS, CREATEROLE, CREATEDB, INHERIT, or any membership) the migration fails, mirroring 0001 for `harvest_app`. The web-facing definers (`community_email_prefs_save`, `community_email_unsubscribe`, `community_purge_notifications`) stay with `harvest_app`.
- Both worker scripts read `WORKER_DATABASE_URL` (never `DATABASE_URL`) and call `requireWorkerRole`, which refuses unless `current_user` is `harvest_worker`, not superuser and without BYPASSRLS.
- Test harness: `tests/database.ts` pre-creates the role as root (NOLOGIN), sets a random login password after migrating and exposes `workerPool` (max 1) and `workerURL` on the fixture, like `pool` and `appURL`.
- Provisioning for real environments: `docs/setup/worker-role.md` (founder-run, with a verification query set) and `scripts/neon-dev-worker-role.ts` for the dev branch only.

## Out of scope

No UI, no new worker behaviour, no change to the purge scripts or the Connect dispatcher (they keep running as `harvest_app`), no scheduling, no email provider.
