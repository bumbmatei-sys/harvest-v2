# Production migrations runbook (0031–0034 and onward)

Status: prepared 11 Nov 2026. **Nothing here is authorized to run.** Applying migrations to staging or production needs Matei's explicit approval for that environment and that run. Applying the schema does not activate any feature: Harvest Connect intake and invitation delivery stay hard-disabled, and the five HC-02 activation decisions (`docs/decisions/hc-02-activation-gates.md`) are separate.

## What is pending

| Migration | PR | Change | Notes |
|---|---|---|---|
| `0031_hc06a_contact_sources` | #45 | `contact_source_events` (contact source history) | FORCE RLS; SECURITY DEFINER writers; a writer policy bound to the migrating role |
| `0032_hc06b_association_foundation` | #46 | Verified claim → CRM association tables and functions | Largest (975 lines); 18 SECURITY DEFINER functions; must follow 0031 |
| `0033_workspace_audience` | #52 | Nullable `workspaces.audience` + check | Additive, one statement |
| `0034_user_profiles` | #54 | Owner-only `user_profiles`; backfills existing accounts as onboarding-skipped | Backfill runs before RLS is enabled |

All four are additive (new tables, columns, functions, policies); none drops or rewrites existing data.

**Do not assume production is at 0030.** `docs/setup/neon.md` records that staging and prod had not been migrated when the project was provisioned (4 Nov). The first step below finds out what is actually applied. The migrator applies every pending migration from the first unapplied one, so prod may receive far more than these four.

## How the migrator behaves

- `npm run db:migrate` runs `scripts/migrate.ts`: Drizzle's migrator over `drizzle/`, using the direct (unpooled) owner connection in `DATABASE_URL_UNPOOLED`.
- Drizzle applies **all pending migrations in one transaction** and records each in `drizzle.__drizzle_migrations`. A failure rolls everything back: no half-applied state.
- "Pending" is decided by comparing each migration's timestamp with the newest recorded `created_at`. Never renumber or re-date merged migrations.
- The script refuses to run outside CI unless given `--dev`, which only accepts the dev endpoint. **There is no production migration job yet**; see "Missing piece" below.
- Run as the migration owner **`harvest_owner`**, never as a Neon admin role: 0031/0032 create SECURITY DEFINER functions owned by the migrating role and a policy granted to the migrating role (`current_user`). The restricted-owner path is what `tests/integration/hc0{3,5,7}-migration-owner-upgrade.test.ts` exercise.

## Missing piece before any run

A small, separately reviewed change is needed to run the migrator against staging/prod: either a manual CircleCI job from `main` with its own restricted context holding the staging/prod owner URL (mirroring `neon_review`), or an explicit, documented flag in `scripts/migrate.ts` that checks the target endpoint against `docs/setup/neon-project.json`. Neither exists today. Recommendation: the CircleCI job, restricted to `refs/heads/main`, one job per environment, no PR code.

## Procedure (per environment: staging first, then prod)

1. **Approval.** Record Matei's approval for this environment and the exact `main` commit.
2. **Find the applied state** (read-only, owner connection):
   ```sql
   select count(*), max(created_at) from drizzle.__drizzle_migrations;
   ```
   Compare with `drizzle/meta/_journal.json` on that commit (entries count and the last `when`). Write down which migrations will apply. If the schema `drizzle` does not exist, nothing has been applied and the run will create the whole schema.
3. **Restore point.** In Neon, create a branch from the environment branch named `<env>-pre-migrate-<YYYYMMDD>` (instant copy-on-write). This is the rollback.
4. **Check roles.** `harvest_app` exists with no superuser, BYPASSRLS, CREATEROLE, CREATEDB, INHERIT or memberships (0001 refuses otherwise); `harvest_owner` owns the existing public tables.
5. **Apply** with the approved job (see "Missing piece"), as `harvest_owner`, from the approved `main` commit. Expect `Drizzle migrations applied successfully`.
6. **Verify** (owner connection):
   ```sql
   -- every journal entry is recorded
   select count(*) from drizzle.__drizzle_migrations;
   -- new tables have RLS on and forced
   select relname, relrowsecurity, relforcerowsecurity from pg_class
    where relname in ('contact_source_events','connect_response_subjects','connect_consent_origins','connect_claim_completions','user_profiles');
   -- runtime role: user_profiles has no delete
   select has_table_privilege('harvest_app','public.user_profiles','select,insert,update') as rw,
          has_table_privilege('harvest_app','public.user_profiles','delete') as can_delete;   -- expect true, false
   -- 0033 column and check
   select column_name, is_nullable from information_schema.columns where table_name='workspaces' and column_name='audience';
   -- 0034 backfill: every pre-existing account has a skipped row
   select (select count(*) from users) as users, (select count(*) from user_profiles where onboarding_skipped_at is not null) as skipped;
   ```
   Expect RLS true/true on every listed table, `rw = true, can_delete = false`, `audience` nullable, and `skipped = users` immediately after the run.
7. **Smoke test** the deployed app on that environment: sign in, open a ministry, open `/account/welcome` with an existing account (no onboarding redirect), CRM People list loads. No real messages, no intake.
8. **Record** the result (commit, migrations applied, verification output, restore-branch name) in the PR or acceptance record, then delete the restore branch only after Matei agrees.

## Rollback

There are no down migrations. If step 5 fails, the transaction rolled back and the database is unchanged: fix forward in a new PR. If a problem appears after a successful run, prefer a forward-fix migration; restoring the `<env>-pre-migrate-*` branch loses every write made after the migration, so it is a last resort that needs Matei's decision.

## Order

Staging, smoke test, then prod. Never prod first, never skip a migration, never apply 0034 without 0031–0033 (the migrator enforces order).
