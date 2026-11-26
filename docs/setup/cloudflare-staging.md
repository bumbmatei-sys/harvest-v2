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
26 Nov (and again after the rollback rehearsal below): OTP sign-in, signed-out redirect, 50 concurrent rendered pages from two users without cross-user leaks, private
cache, no edge cache hit.

## Browser smoke (26 Nov, `tests/cf07/browser-staging.ts`)

The local Playwright suite cannot target staging: it starts its own server and seeds the local database. This separate
script drives a real Chromium against staging (skips by default and in CI; refuses any origin that is not a
`harvest-staging` `workers.dev` host). Same environment variables as the hosted check, plus optional
`CF07_SCREENSHOTS=<dir>`.

Passed 7 of 7 steps on main `9106d1b` (15:06 UTC) and again on main `8d15567` after the rehearsal (15:36 UTC):
sign-in page, OTP sign-in through the form with the synthetic mailbox, ministries page, CRM People module page, dark mode
(theme attribute, `dark` class and a different background from light), phone width 390 px with no horizontal scroll on
three pages, and a signed-out module page landing on sign-in. Every page 200, `private, no-store`, no edge cache hit, no
private material in the HTML, no uncaught page errors.

## Rollback rehearsal (26 Nov)

All three runs from `main` through **Cloudflare staging**; the job smoke check passed each time and the hosted check was
run by hand after each change of version.

| Step | Run | Result | Live version afterwards |
| --- | --- | --- | --- |
| `deploy` main `8d15567` | 45847100501 | success, 5 min 16 s | `5746daa3` (main 8d15567) |
| `rollback` | 45848077892 | success, 37 s | `c3117142` (main 9106d1b, the previous deploy) |
| `deploy` main `8d15567` again | 45848717246 | success, 4 min 20 s | `2039f864` (main 8d15567) |

After the rollback: `/sign-in` 200, `/manifest.webmanifest` 200, `cache-control: private, no-store`, and
`tests/cf07/run-staging.ts` passed (OTP sign-in, 50 concurrent pages, no cross-user leak). After the final deploy the
hosted check and the browser smoke both passed again. A rollback restores the previous Worker version only, never the
database: `wrangler rollback` takes under a minute, a fresh deploy about five.

Note: main `8d15567` includes migration 0115 (#280); the `cf-staging` branch is at 0114. Applying 0115 to staging needs the
owner's approval; the checked pages do not use it.

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

Done on staging: whole app on Workers, hosted check, browser smoke, load profile, deploy and rollback rehearsal. The
production workflow, the fail-closed config generator and the cut-over runbook are prepared separately in
`docs/setup/cloudflare-production.md` (draft PR #284); nothing there is activated. Remaining, in order:

- [ ] Approve the gates in cloudflare-production.md (HC-02 decisions, Cloudflare DPA and sub-processor review, production migrations, real email sender, founder go for the exact commit).
- [ ] Production migration job and run (`docs/setup/production-migrations.md`), Neon restore point first.
- [ ] Size the production Neon compute and Hyperdrive for the measured tail, then re-run the load profile against a production-sized throwaway branch.
- [ ] Create the production token (Workers Scripts Edit only), the `cloudflare-production` GitHub environment, Hyperdrive, R2 bucket and Worker secrets.
- [ ] Replace the placeholder production origin and Hyperdrive ID in `cloudflare/staging.json` and `cloudflare/production.json` (the generator refuses until both agree).
- [ ] Send one real sign-in email from Workers to a founder-controlled address (staging only ever used the synthetic mailbox).
- [ ] Deploy with `smoke=false`, attach the custom domain at the cut-over, deploy or smoke again, watch logs for 30 minutes.

## Limits to watch

- **Startup:** 624 ms minified (unminified it failed the 1 s limit). Bundle growth moves this; check `Worker Startup Time` on every deploy.
- **Size:** 6.55 MB gzip (Workers Paid, 10 MB limit).
- **Source maps** are not uploaded (62 MiB > 60 MiB limit).
