# Background worker role (`harvest_worker`) runbook

Status: prepared 13 Nov 2026. **Nothing here is authorized to run.** Each environment needs Matei's explicit approval, and nothing in this runbook activates a feature: community email stays test-mode only and Connect retention is not scheduled.

## What it is

`harvest_worker` is a login role for the background scripts only. It can execute exactly six functions and touches no table:

| Script | Functions |
|---|---|
| `npm run communities:send-email` | `community_email_enqueue(integer)`, `community_email_claim(integer)`, `community_email_complete(uuid, text, text)` |
| `npm run connect:retention` (and `-- check`) | `connect_retention_sweep(integer)`, `connect_retention_record_failure(text)`, `connect_retention_health()` |

Migration 0044 revokes those six from `harvest_app` and grants them to `harvest_worker` when the role exists. The scripts connect with `WORKER_DATABASE_URL` and refuse to run unless `current_user` is `harvest_worker`, not superuser and without BYPASSRLS. `DATABASE_URL` stays the web application login. The purge scripts and the Connect dispatcher still run as `harvest_app`.

## Social posting worker (test mode only)

Migration 0049 adds two more worker-only functions, `social_publish_claim(integer, integer)` and `social_publish_complete(uuid, uuid, uuid, text, text, text, integer)`, revoked from `harvest_app` and granted to `harvest_worker` when the role exists (re-run the grant block after creating the role later, as in step 3 below, with these two signatures). `npm run social:publish:test` runs them against an in-memory fake provider and refuses anything but `HARVEST_SOCIAL_PUBLISHER=test` on a local database. It cannot reach a provider and is not authorized to run anywhere else.

## Order of operations (per environment)

The role is created outside the migrations, so either order works; creating it first is simpler.

1. **Create the role** (admin connection, once per cluster or Neon branch; generate a strong password and do not paste it into chat or a ticket):
   ```sql
   CREATE ROLE harvest_worker LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
   ```
   Do not grant it membership in any role, and do not grant it anything on tables or sequences.
2. **Apply migration 0044** with the normal migration procedure (`docs/setup/production-migrations.md`, as `harvest_owner`). It grants the six functions if the role exists, and fails if the role is privileged.
3. **If the role was created after 0044 was applied**, run once as `harvest_owner`:
   ```sql
   GRANT EXECUTE ON FUNCTION public.community_email_enqueue(integer), public.community_email_claim(integer), public.community_email_complete(uuid, text, text),
     public.connect_retention_sweep(integer), public.connect_retention_record_failure(text), public.connect_retention_health() TO harvest_worker;
   ```
4. **Set `WORKER_DATABASE_URL`** in the worker's environment only (the scheduler that runs the scripts), with the same host options as `DATABASE_URL` but the `harvest_worker` user. Do not set it for the web deployment.
5. **Verify** (owner connection):
   ```sql
   select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit from pg_roles where rolname = 'harvest_worker';   -- all false
   select count(*) from pg_auth_members where member = 'harvest_worker'::regrole;                                           -- 0
   select p.oid::regprocedure as fn, has_function_privilege('harvest_worker', p.oid, 'execute') as worker, has_function_privilege('harvest_app', p.oid, 'execute') as app
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('community_email_enqueue','community_email_claim','community_email_complete','connect_retention_sweep','connect_retention_record_failure','connect_retention_health');
   -- expect six rows: worker = true, app = false
   select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
      and (has_table_privilege('harvest_worker', c.oid, 'select') or has_table_privilege('harvest_worker', c.oid, 'insert')
        or has_table_privilege('harvest_worker', c.oid, 'update') or has_table_privilege('harvest_worker', c.oid, 'delete'));   -- 0
   ```
6. **Smoke test** from the worker host with test data only: `npm run connect:retention -- check` with `WORKER_DATABASE_URL` set prints a health line and exits 0, or 1 until a run has succeeded. With `WORKER_DATABASE_URL` set to the application login it must print `connect_retention_failed` and exit 1.

## Local development

The existing local `.env.local` needs a `WORKER_DATABASE_URL` for the two scripts to run at all; `DATABASE_URL` alone is refused. Local Postgres: create the role as in step 1 with a local password, run `npm run db:migrate` (or the grant statement in step 3), then set `WORKER_DATABASE_URL=postgresql://harvest_worker:<password>@127.0.0.1:5432/<database>`. For the Neon `dev` branch only, `npx tsx scripts/neon-dev-worker-role.ts` does steps 1, 3 and 4 and saves the pooled URL to `.env.local` (it refuses any endpoint other than the dev endpoint in `neon-project.json` and never prints the password). The integration tests create the role themselves.

## Rotation and rollback

Rotate with `ALTER ROLE harvest_worker PASSWORD '<new>'` and update `WORKER_DATABASE_URL`. To disable the workers, `ALTER ROLE harvest_worker NOLOGIN`. Do not re-grant the six functions to `harvest_app`: that reopens the cross-ministry address read and the health-signal write that 0044 closes.
