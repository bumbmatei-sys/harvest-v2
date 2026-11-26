# Cloudflare staging (CF-07c)

The permanent staging copy of the whole app on Cloudflare Workers. Founder approval 26 Nov 2026 (kept, synthetic data
only, separate from production). Nothing here deploys production: that is CF-08 and needs separate founder approval.

## What exists

| Resource | Name | Notes |
| --- | --- | --- |
| Worker (whole app) | `harvest-staging` | https://harvest-staging.bumbmatei-bee.workers.dev, `HARVEST_ENV=staging`, minified, no source maps |
| Worker (synthetic mailbox and seed helper) | `harvest-staging-mailbox` | `tests/cf03/harness-worker.ts`; the app's `MAILBOX` binding uses its `Mailbox` entrypoint, so sign-in codes for `<uuid>@example.invalid` users never leave Cloudflare; no real email |
| Neon branch | `cf-staging` | schema-only start, all migrations through 0114 applied by the owner; `harvest_app` login for Hyperdrive |
| Hyperdrive | `harvest-staging-app` | `harvest_app` on the `cf-staging` endpoint, **caching disabled** |
| R2 | `harvest-staging-files`, `harvest-staging-mailbox-codes` | private |

IDs and names live in `cloudflare/staging.json` (no secrets). Worker secrets (`BETTER_AUTH_SECRET`, `FILE_GRANT_SECRET`,
a synthetic `RESEND_API_KEY`, the helper's `HARNESS_TOKEN`) were generated for staging only and set on the Workers; deploys
keep them. Rotate by setting new values with `wrangler secret put` (and redeploying the helper for its token).

## One-time GitHub setup (founder)

1. Cloudflare: My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** (account: Bumbmatei@gmail.com's Account).
2. GitHub: Settings → Environments → `cloudflare-staging`. **Deployment branches: `main` only** (this, not the job's
   `if`, is what keeps the secrets off other branches). Optionally required reviewers.
   Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. The workflow exposes them only to its Deploy and Roll back steps.

## Deploy, roll back

Actions → **Cloudflare staging** → Run workflow (from `main`) → `deploy` or `rollback`.

- `deploy`: `npm ci`, `scripts/cf-build.sh` (pinned tools in `cloudflare/tooling`, OpenNext build, checked cookie patch), `tests/cf07/prepare-staging.ts`, `wrangler deploy` with static assets, then a smoke check (`/sign-in` and `/manifest.webmanifest` 200, `private, no-store`).
- `rollback`: `wrangler rollback` to the previous Worker version, then the same smoke check.

## Hosted check

`tests/cf07/run-staging.ts` against the staging origin with the helper origin and token (see the script header). Passed on
26 Nov: OTP sign-in, signed-out redirect, 50 concurrent rendered pages from two users without cross-user leaks, private
cache, no edge cache hit.

## Before any Cloudflare production resource exists (CF-08)

`cloudflare/staging.json` sets `CF07_PRODUCTION_ORIGIN` and `CF07_PRODUCTION_HYPERDRIVE_ID` to placeholders, so the
staging/production guards compare against nothing real yet. Replace them with the real production origin and
Hyperdrive ID before production is created, and give production its own token: the staging token can edit any Worker
on the account.

## Load profile (26 Nov, `tests/cf07/load-staging.ts`)

Run from Chicago against staging (Neon `cf-staging` at 0.25 CU, the smallest size), two synthetic users, a mix of
`/workspaces`, `/sign-in` and `/api/workspaces`. No 5xx in any run.

| Setup | Concurrency | Requests | p50 | p95 | p99 | Requests/s |
| --- | --- | --- | --- | --- | --- | --- |
| Worker in the visitor's colo (Chicago) | 1 | 60 | 1716 ms | 1849 ms | 1860 ms | 0.7 |
| Worker in the visitor's colo (Chicago) | 20 | 400 | 1777 ms | 3869 ms | 5012 ms | 11.1 |
| Placed next to the database (`aws:eu-central-1`), warm | 1 | 40 | 649 ms | 1018 ms | 1032 ms | 1.7 |
| Placed next to the database, warm | 20 | 400 | 627 ms | 5666 ms | 8296 ms | 13.0 |

Reading: each page makes several sequential queries, so distance to the database dominated; the placement hint cuts the
median by about two thirds. Under 20 concurrent requests the tail grows, consistent with the 0.25-CU staging compute and each
page holding its connection for the whole transfer (CF-07a). These are staging numbers, not production promises.

## Before CF-08 (production)

- Size the production Neon compute and Hyperdrive for the measured tail, then re-run the load profile against the production-shaped setup.
- Keep `placement` next to the production database.
- Replace the placeholder production origin and Hyperdrive ID in `cloudflare/staging.json` (below) and use a separate production token.
- Production deploy job: split into a **build** job without secrets that uploads `.open-next` and the generated config as an artifact, and an environment-protected **deploy** job with a fresh checkout and only the pinned tooling, so the token never shares a filesystem with the app's install scripts or build plugins.

## Limits to watch

- **Startup:** 624 ms minified (unminified it failed the 1 s limit). Bundle growth moves this; check `Worker Startup Time` on every deploy.
- **Size:** 6.55 MB gzip (Workers Paid, 10 MB limit).
- **Source maps** are not uploaded (62 MiB > 60 MiB limit).
