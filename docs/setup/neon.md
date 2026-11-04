# Neon setup — Harvest v2 only

Provisioned on 2026-11-04 under Matei's explicit authorization. No other Neon project was changed.

| Resource | Value |
| --- | --- |
| Project | `harvest-v2` |
| Project ID | `cool-wind-15257108` |
| Region | `aws-eu-central-1` |
| PostgreSQL | 17 |
| Production branch | `prod` (`br-twilight-dust-bak1tfvb`) |
| Staging branch | `staging` (`br-super-cloud-bac2tkho`) |
| Development branch | `dev` (`br-quiet-silence-bazwnzz2`) |
| Database | `harvest` in each branch |
| Migration owner | `harvest_owner` |
| Application role | `harvest_app`, created using SQL, without ownership, memberships or BYPASSRLS |

Identifiers are also in [neon-project.json](neon-project.json). Connection strings and the dev auth secret are stored only in ignored `.env.local` with mode 0600. Neither staging nor prod credentials were saved locally. Staging and prod have not been migrated or deployed in this task.

## Exact provisioning and dev verification commands

`NEON_API_KEY` is injected privately by the environment. Never echo it or run shell tracing. The provisioner uses the Neon v2 REST API, reuses a uniquely named `harvest-v2` project, refuses ambiguous matches, creates `prod` as the root, then `staging` and `dev` from that clean root. It auto-selects the organization only when exactly one is accessible. It never modifies another project. POST failures are not automatically retried.

```sh
npm ci
npx tsx scripts/neon-provision.ts
npm run db:migrate -- --dev
npx tsx scripts/neon-dev-app-role.ts
npm run test:rls:neon
```

The explicit `--dev` exception is authorized for this foundation verification. It verifies the unpooled hostname against committed dev metadata. Normal migrations run in CI (`npm run db:migrate`), with a direct owner connection in `DATABASE_URL_UNPOOLED`. Do not use `drizzle-kit push` or run migrations at app startup. Re-running the migrator is idempotent. The app-role command refuses to overwrite an existing `DATABASE_URL`; it creates a random password and saves the pooled app-role URL without printing it.

The account rejected a custom suspend interval (HTTP 412); provisioning uses its default interval and a 0.25 CU compute. All three branches were created before the dev schema and synthetic verification data, so staging/prod did not inherit test records.

Neon connections use the official serverless WebSocket Pool with interactive transactions. Local PostgreSQL uses `pg`. Both run the same Drizzle transaction code. This environment can reach Neon over HTTPS/WebSockets, while direct PostgreSQL TLS handshakes time out. `DATABASE_URL` remains the pooled runtime connection, and `DATABASE_URL_UNPOOLED` targets the direct endpoint for migrations.

## Runtime environment

Configure `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, and `EMAIL_FROM` privately. `EMAIL_FROM` must use the existing Resend-verified sender/domain; this task does not provision a sending domain or send an email. The new Resend key is wired through the adapter but all verification uses a mocked provider. `DODO_PAYMENTS_API_KEY` is a placeholder only. No Vercel environment is touched.

## CI

The workflow always checks lint, types, unit tests, build, local migrations, PostgreSQL RLS, Playwright and axe. The Neon job needs repository secrets named `NEON_API_KEY` and `NEON_PROJECT_ID`; the latter is the project ID above. Secret values are not stored in this document. Cloud session secrets are not automatically GitHub Actions secrets.

Once those repository secrets exist, `scripts/neon-ci.ts` verifies the project name, creates a temporary `ci/<run-id>-<attempt>` branch from dev, privately passes its direct connection to the migration step, and deletes only that run's branch in an `always()` cleanup step. Dev contains synthetic test data only. If credentials are absent, the step summary explicitly reports Neon CI as blocked; the local migration/RLS jobs still run. No long-lived environment is migrated by a PR workflow.

## Isolation evidence

`npm run test:rls` uses a disposable local PostgreSQL cluster without Neon credentials. Its `max: 1` pool asserts the backend PID is unchanged and verifies missing tenant/user context and zero visible tenant rows after both commit and rollback. CI can use the explicit local `TEST_DATABASE_URL` service instead.

`npm run test:rls:neon` is an explicit dev-only opt-in. It validates project metadata and the `harvest_app` username, creates two labelled synthetic users/workspaces under unique identifiers, tests cross-tenant reads/writes and rejected membership hints, then verifies both PgBouncer context reset and deterministic physical-backend reuse using a direct app-role connection. These seed rows remain in dev because audit records are append-only. It sends no emails.

API documentation: [projects](https://api-docs.neon.tech/reference/createproject), [branches](https://neon.com/docs/manage/branches), [roles](https://neon.com/docs/manage/roles), [connection pooling](https://neon.com/docs/connect/connection-pooling). Roles created through the Neon console/API can inherit elevated membership; create the runtime role through the checked-in SQL migration instead.
