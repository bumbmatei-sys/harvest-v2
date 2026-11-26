# Cloudflare production (CF-08): prepared, not activated

Status 26 Nov 2026: **code and runbook only.** No production Cloudflare resource exists, nothing has been deployed, no
DNS has changed and no migration has been applied. Founder decision 26 Nov: finish all Cloudflare work before launch,
but do not switch production. Every step below that creates, deploys or changes something needs the founder's go for
that step.

Staging, the rehearsal and the measured numbers: [cloudflare-staging.md](cloudflare-staging.md).

## Gates (all must be approved before the cut-over)

| Gate | Where | State |
| --- | --- | --- |
| HC-02 privacy and security activation decisions (five) | `docs/decisions/hc-02-activation-gates.md` | UNAPPROVED. Moving hosting enables no real-data intake and no real invitation delivery |
| Cloudflare as a data processor: DPA and sub-processor review, data location of Workers, Hyperdrive, R2 and logs | PRD `docs/prd/cloudflare-infrastructure-migration.md` | Open |
| Production migrations: production at the migration `main` needs, run by the approved job as `harvest_owner`, Neon restore point first | `docs/setup/production-migrations.md` | No production migration job exists yet |
| Real email sender: verified sending domain, production key | `docs/setup/email.md` | Open. The real provider path has only been bundled, never sent from Workers (staging uses the synthetic mailbox) |
| Founder go for the exact `main` commit, and for the cut-over time | this page | Not given |
| Repository private before any marketing (kit licence) | `CLAUDE.md` | Open |

## What the code does

| Piece | File | Notes |
| --- | --- | --- |
| Production settings (IDs and names, no secrets) | `cloudflare/production.json` | Placeholders on purpose: origin `production.example.invalid`, Hyperdrive all zeros, sender `example.invalid` |
| Config generator | `scripts/cf-prepare-production.ts` | Fails closed: refuses the placeholders, `workers.dev`, test hosts, anything named or equal to a staging resource, and a `cloudflare/staging.json` whose production guards do not name the same origin and Hyperdrive. No `resend` alias, no `MAILBOX`, no routes, `workers_dev` and preview URLs off, placement `aws:eu-central-1`, minified, no source maps |
| Tests | `tests/unit/cf08-prepare-production.test.ts` | Placeholders, staging values and test hosts refused; a filled config is production-only |
| Workflow | `.github/workflows/cf-production.yml` | Manual, `main` only, and only when `main` is exactly the approved `expected_sha` |

The workflow has three jobs:

- **build** (no environment, no secrets): `npm ci`, `scripts/cf-build.sh`, the production config, then
  `wrangler deploy --dry-run --outdir` to bundle without uploading. The bundle, the static assets and a `no_bundle`
  config are uploaded as an artifact.
- **deploy** (`cloudflare-production` environment): a fresh runner with a sparse checkout of `cloudflare/tooling` and
  `cloudflare/production.json` only, the pinned tooling installed with install scripts off (esbuild and workerd rebuilt),
  the artifact downloaded and checked (production name and origin, no staging, no mailbox, no alias, no routes), then
  `wrangler deploy` with the token on that step only. Optional smoke check.
- **rollback** (`cloudflare-production` environment): `wrangler rollback` to the previous Worker version, then the
  optional smoke check.

Checked locally on 26 Nov with fixture values (not real ones): the generated config bundles with the real email provider
(28.5 MB, 6.6 MB gzip) and the `no_bundle` config deploys in a `--dry-run`.

## Resources to create (founder, by hand, when approved)

| Resource | Name | Settings |
| --- | --- | --- |
| Neon compute for the `prod` branch | `br-twilight-dust-bak1tfvb` (`docs/setup/neon-project.json`) | Size for the staging tail (below). Roles `harvest_owner`, `harvest_app` (and `harvest_worker` when jobs are enabled) |
| Hyperdrive | `harvest-production-app` | `harvest_app` on the `prod` endpoint, **caching disabled** (as staging) |
| R2 bucket | `harvest-production-files` | Private, no public access, no `r2.dev` URL; location hint Europe |
| Worker | `harvest-production` | Created by the first `wrangler secret put` or the first deploy |
| Worker secrets (names only) | `BETTER_AUTH_SECRET`, `FILE_GRANT_SECRET`, `RESEND_API_KEY` | New production values, each 32+ characters where generated; the two app secrets must differ. Never reuse staging or local values |
| GitHub environment | `cloudflare-production` | Required reviewers; deployment branches `main` only; secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Cloudflare API token | production only | Permission **Account → Workers Scripts → Edit** for this account only. No zone or DNS permission (the config has no routes); no other accounts. Optional client IP filter is not practical with GitHub runners |

The app refuses to start (503, `private, no-store`) if any secret is missing, too short, the two app secrets are equal,
or a QA sign-in binding is present. It answers 421 on any origin other than `BETTER_AUTH_URL`.

## Neon sizing

Staging used 0.25 CU. With 20 concurrent requests and the Worker next to the database, p95 was 5.7 s and p99 8.3 s
(cloudflare-staging.md). Before the cut-over:

1. Set the `prod` compute to at least 1 CU with autoscaling up to 2 CU (start point; adjust from the re-run), and turn
   off scale-to-zero, or accept a cold start on the first request.
2. Point a temporary staging-shaped run at a production-sized copy: branch `prod` to a throwaway branch, give it the same
   compute, and run `tests/cf07/load-staging.ts` against staging bound to it. Record p50, p95 and p99 at 1 and 20
   concurrent. Delete the throwaway branch afterwards. Do not run load against real production data.

## Cut-over runbook

Before the day:

1. All gates above approved; record the approved `main` SHA.
2. Fill `cloudflare/production.json` (origin, Hyperdrive ID, sender) and the production guards in `cloudflare/staging.json`
   with the same origin and Hyperdrive ID, in a reviewed PR. The generator refuses to run until both agree.
3. Record the current state: DNS records for the production hostname (and their TTL), the current host's deployment,
   provider callback and webhook URLs (email, social, OAuth), and health baselines. Lower the hostname's TTL to 60 s a
   day ahead.
4. Neon: create restore point `prod-pre-cutover-<YYYYMMDD>`; apply production migrations with the approved job.
5. Create the resources in the table above and set the Worker secrets.
6. Run **Cloudflare production** with `action=deploy`, `expected_sha=<approved SHA>`, `smoke=false`. The Worker is
   deployed but not reachable (no route, no `workers.dev`).

Cut-over (founder):

7. Cloudflare dashboard → Workers → `harvest-production` → Settings → Domains & Routes → Add → Custom domain → the
   production hostname. If the hostname still has a DNS record pointing at the old host, Cloudflare refuses: delete that
   record first, then add the custom domain at once (the gap is the time between the two clicks).
8. Run the workflow again with `action=deploy`, `smoke=true` (same SHA), or check by hand:
   `/sign-in` 200 with `cache-control: private, no-store`, `/manifest.webmanifest` 200, sign in with a founder account,
   open the ministries page and one module page, light/dark, phone width, `Worker Startup Time` in the dashboard.
9. Watch Workers logs and Neon for 30 minutes: 5xx, `worker_configuration_invalid`, `worker_page_scope_failed`,
   connection counts.

Rollback:

- **Bad Worker version:** run the workflow with `action=rollback` (same approved SHA): `wrangler rollback` to the
  previous version, then the smoke check. Rehearsed on staging 26 Nov (cloudflare-staging.md).
- **Back to the old host:** remove the custom domain from the Worker and restore the DNS record recorded in step 3. With
  a 60 s TTL most visitors return within minutes. Sessions created on Cloudflare stay in the same database.
- **Database:** only if a migration is at fault, restore from the Neon restore point (step 4) by the production
  migrations runbook. Data written after the restore point is lost; decide with the founder.

## Not part of CF-08 code

- Background jobs, cron and queues (CF-04) stay disabled; enabling any production schedule is a separate decision.
- No real email, social or webhook delivery is activated by moving hosting.
- File malware scanning: production requires a scan verdict for private files (`docs/setup/storage.md`); no real scanner is
  wired.

## Founder checklist (by hand, only when approved)

1. If the production domain's DNS is not on Cloudflare yet: Cloudflare → Add a domain → follow the nameserver change
   at the registrar, well before the day (a custom domain needs the zone in this account). Copy the existing records first.
2. Cloudflare → My Profile → API Tokens → Create Token → Custom token: Account → Workers Scripts → Edit; Account
   resources: this account only. Name it `harvest-production-deploy`. Copy it once.
3. GitHub → Settings → Environments → New environment `cloudflare-production`: add required reviewers; Deployment
   branches → Selected branches → `main`; add secrets `CLOUDFLARE_API_TOKEN` (the new token) and `CLOUDFLARE_ACCOUNT_ID`.
4. Neon → `prod` branch: set the compute size; create the restore point before migrating.
5. Cloudflare → Hyperdrive → Create `harvest-production-app` with the `harvest_app` login on the `prod` endpoint; turn
   caching off. Copy the ID into `cloudflare/production.json` and `cloudflare/staging.json` (PR).
6. Cloudflare → R2 → Create `harvest-production-files`, private, Europe.
7. Set the Worker secrets: `wrangler secret put BETTER_AUTH_SECRET --name harvest-production` (and `FILE_GRANT_SECRET`,
   `RESEND_API_KEY`), or in the dashboard.
8. Email provider: verify the sending domain; put the sender in `cloudflare/production.json`.
9. Lower the production hostname's DNS TTL to 60 s a day before.
10. On the day: run the workflow (`smoke=false`), then attach the custom domain (cut-over step 7), then run it with
   `smoke=true`.
