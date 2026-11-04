# Neon setup

Provisioned on 2026-11-04 using the environment's `NEON_API_KEY`, under Matei's one-time authorization for harvest-v2 only.

## Project

- Name: `harvest-v2`
- Project ID: `cool-wind-15257108`
- Region: `aws-eu-central-1` (Frankfurt)

| Branch | Branch ID | Purpose |
| --- | --- | --- |
| `dev` | `br-quiet-silence-bazwnzz2` | Local development and the requested real-database isolation check |
| `staging` | `br-super-cloud-bac2tkho` | Staging |
| `prod` | `br-twilight-dust-bak1tfvb` | Production |

`prod` is the initial branch; `dev` and `staging` were created from it before any application migrations. All three branches report ready. Only the project named `harvest-v2` was created or modified.

## Local credentials

The dev branch's `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) were written only to `/workspace/harvest-v2/repo/.env.local`, with file mode `0600`. The file is ignored by `.gitignore`. Neither connection strings nor API keys belong in documentation, commits, PR descriptions, or command output. API keys remain in the environment.

The dev database is `harvest` and the provisioned owner role is `harvest_owner`. Use the direct URL for migrations. The foundation must provide a restricted application role without `BYPASSRLS` for tenant operations and the isolation test; owner credentials alone do not prove RLS isolation.

Future sessions must reuse this project and these branches. Do not create another project or modify another Neon project.

## Verification and blockers

The supplied checkout has a local `feat/pr01a-foundation` branch containing documentation only. At the start of this session, GitHub had only `main` and no pull requests or foundation branch. A writable checkout of latest `main` (`98249af`) was pulled before creating the follow-up branch, because the supplied workspace's `.git` is mounted read-only.

No `package.json`, Drizzle configuration, migrations, application code, or RLS test exists in either checkout. No migrations were applied and no real-database isolation assertion was run.

| Requested check | Result on 2026-11-04 |
| --- | --- |
| `pnpm run lint` | Blocked: `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` |
| `pnpm run typecheck` | Blocked: `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` |
| `pnpm run test` | Blocked: `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` |
| `pnpm run test:rls` | Blocked: `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` |
| Drizzle migrations against dev | Blocked: no Drizzle configuration or migrations |
| Real Neon dev cross-tenant isolation and pooled context reset | Blocked: foundation schema, policies, restricted role, and test are absent |

Restore or provide the existing foundation implementation, then run its migrations against dev and rerun all four checks. Fix only failures in that implementation. Do not treat provisioning as verification of tenancy.

No email was sent, nothing was merged or deployed, and no Vercel environment was changed.

References: [Neon project API](https://neon.com/docs/reference/api/projects/create-project), [connection URI API](https://neon.com/docs/reference/api/projects/get-connection-uri).
