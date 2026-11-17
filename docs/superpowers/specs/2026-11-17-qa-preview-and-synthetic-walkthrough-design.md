# QA-1..QA-5 — preview deployments, synthetic data and a nightly walkthrough — design

Status: DRAFT 17 Nov 2026. Documentation only: no code, migration, workflow, secret or deployment is added by this document. The founder request of 17 Nov (test the app with synthetic data regularly) is the only decision recorded here; everything else is a proposal with a recommended default. Nothing here approves a build, a deployment, production activation, a production migration or any of the five HC-02 privacy/legal gates, which all stay UNAPPROVED. The Studio Admin and shared-kit rules do not apply: this slice has no product UI (QA-2 adds at most a gated, test-only helper route, no screen).

References:
- `docs/setup/neon.md`, `docs/setup/production-migrations.md`, `docs/setup/feature-flags.md`, `docs/setup/worker-role.md`, `docs/setup/ci-final-review.md`;
- `.github/workflows/ci.yml` (jobs `quality`, `database`, `browser` x4, `pwa`, `neon`), `playwright.config.ts`, `scripts/e2e-server.ts`, `scripts/neon-ci.ts`, `tests/e2e/helpers/session.ts`, `tests/database.ts`;
- `src/server/auth.ts` (Better Auth, email OTP only), `src/server/email.ts`, `src/server/community-live.ts` (`communityLiveEnabled`), `.env.example`;
- house style: `docs/superpowers/specs/2026-11-17-communities-c11-chat-design.md` (shortened).

## Summary

1. Every pull request (and a long-lived `qa-preview` branch) gets a Vercel preview deployment wired to a dedicated Neon branch, `vercel-preview`, that holds the schema only and fake data only (QA-1).
2. A deterministic seed script fills it with clearly fake ministries, people, communities, members, posts and chat messages; it refuses any target that is not that branch (QA-1).
3. A test-only sign-in shortcut lets the founder and Playwright sign in as a seeded persona without real email. It is impossible to enable in production by construction, audited, unit-tested and source-guarded (QA-2).
4. A nightly Playwright walkthrough runs the key journeys against the preview with screenshots as artifacts and a failure report (QA-3).
5. A rehearsal applies every pending production migration (0031 through the current last journal entry, 0056 on `main` today) in order to a fresh Neon branch that mimics production, never to production (QA-4).
6. A phone checklist lets the founder click through a pilot rehearsal (QA-5).
7. Five slices, one PR each, all non-production by hard gate. Five open questions with defaults (section 11), one of them an open founder decision about Live and chat on previews.

## 1. Goals and non-goals

**Goals:** regular, repeatable testing of the whole app with synthetic data on a deployed, phone-reachable URL; catching migration problems before any production run; zero risk to real people's data.

**Non-goals:** deploying or activating anything in production; changing the production Vercel project's settings; load testing; visual regression baselines; real email, storage, payment or social provider calls; applying migrations to staging or production (still needs Matei's approval, `docs/setup/production-migrations.md`); approving any HC-02 gate.

## 2. Verified starting point

Read from the repository on `main` at the time of writing:

- Auth is Better Auth with `emailOTP` only (`emailAndPassword` disabled). The code is sent by `sendSignInCode` through Resend (`RESEND_API_KEY`, `EMAIL_FROM`). Rate limits, a database cooldown (`otp_cooldowns`) and an HMAC-hashed stored code apply. Sessions write an `auth.sign_in` audit row.
- The e2e suite signs in through the real OTP endpoints and reads the code from a JSONL mailbox file (`HARVEST_E2E_MAILBOX`, `HARVEST_E2E_MOCK_EMAIL=1`). A file mailbox does not work on Vercel (serverless, no shared filesystem), so previews need a different test channel (QA-2).
- `scripts/e2e-server.ts` starts `next dev` against a disposable embedded Postgres, a storage mock and mock email. CI browser tests run in four shards on GitHub-hosted runners (free, the repository is public).
- The Neon migration check (`neon` job, `scripts/neon-ci.ts`) runs only from `main`, creates a temporary `ci/<run>-<attempt>` branch from `dev`, applies migrations as owner and deletes only that branch. It needs repository secrets `NEON_API_KEY` and `NEON_PROJECT_ID`.
- `docs/setup/neon.md` lists branches `prod`, `staging`, `dev` in project `harvest-v2` (`cool-wind-15257108`). The `vercel-preview` branch (`br-shy-hall-baslhh18`, branched from `dev`) comes from the founder's request and is **not listed in the repository**: see section 10.
- `next.config.ts` swaps the `resend` module for `tests/e2e/resend-mock.ts` at build time, only under `next dev` with `HARVEST_E2E_MOCK_EMAIL=1`. The e2e mock mail is therefore a build-time module swap, not a runtime switch, and is absent from every deployed build.
- There is no `vercel.json`, no `VERCEL_*` reference in `src` or `.env.example`, and no repository evidence that a Vercel project is connected. Whether previews already build is **not verified** here.
- `docs/setup/neon.md` records that staging and prod were not migrated at provisioning; the current applied state of production is unknown, so QA-4 assumes nothing about it.

## 3. QA-1 — preview deployments on a test Neon branch, and the seed script

### 3.1 Environment and branch

- Preview environment variables (Vercel scope **Preview only**, never Production): `DATABASE_URL` (pooled, `harvest_app`), `BETTER_AUTH_SECRET` (a random value unique to previews, never reused from dev or prod), `BETTER_AUTH_URL` (section 3.3), `RESEND_API_KEY` and `EMAIL_FROM` set to **inert placeholders** (a fake key and an `example.test` sender), the QA flag of section 4, and `HARVEST_COMMUNITIES=enabled` where the Communities modules must show. `S3_*` left unset so uploads fail closed, or pointed at a local-style mock if QA-3 needs uploads (open question). `DODO_PAYMENTS_API_KEY` unset. No `NEON_API_KEY` and **no `DATABASE_URL_UNPOOLED` (the owner connection) in the Vercel Preview scope**: the preview runtime is `harvest_app` only. Migrations and seeding run from a GitHub Actions job (QA-1 deliverable) that holds the owner string as a secret and runs from `main`, like the `neon` job. Also set a `QA_SIGN_IN_SECRET` (section 4.3), separate from `BETTER_AUTH_SECRET`.
- The `vercel-preview` branch must stay **free of real data**. It was branched from `dev`, which per `docs/setup/neon.md` holds synthetic verification data (users on `example.test`-style addresses), so it is **not empty**. QA-1 therefore first resets the branch to schema-only (drop and recreate the `public` data, or recreate the Neon branch from a point that has the schema and no rows, then run `db:migrate`) before the first seed, and records that in `docs/setup/neon.md` together with the branch id (QA-1 deliverable; today the file lists only `prod`, `staging`, `dev`). After that the branch is disposable and the seed script is idempotent.
- Roles: the app connects as `harvest_app` (no ownership, no BYPASSRLS), exactly as in production. The preview never gets owner credentials at runtime.

### 3.2 Secrets handling

- No secret enters the repository, a PR description, a log line or this document. Values are set in Vercel and GitHub settings only. Docs name variables, not values.
- The Neon API key available today is **project-scoped**. Recommendation: create a separate, narrower credential for QA automation (a branch-scoped or least-privilege Neon API key if the plan allows it; otherwise a dedicated Neon role/connection string for `vercel-preview` only), so a leak cannot touch `prod`. Vercel receives only database connection strings for `vercel-preview`, never the Neon API key.
- Who sets what: **Matei** (project owner) creates the Vercel preview variables and any GitHub secrets, and approves who may do so. A session can write the runbook and the checks but never holds the values.
- Deployment Protection (Vercel authentication) stays on for previews; the founder's phone signs in to Vercel once. Bypass tokens for the nightly job are a GitHub secret (open question 3).

### 3.3 `BETTER_AUTH_URL` and preview URLs

Better Auth checks the request origin against its base URL, and preview URLs differ per deployment. Options: (a) one stable alias, a long-lived `qa-preview` branch with a fixed Vercel branch domain used for the nightly run and the founder's phone, with `BETTER_AUTH_URL` set to it; (b) derive the base URL from the deployment's own URL at runtime for per-PR previews. **Recommendation: (a) first**; (b) only after a small, reviewed change proves how Better Auth accepts a dynamic origin, which is **not verified**. The production URL is never listed as an allowed origin for previews.

### 3.4 Seed script (`scripts/qa-seed.ts`)

- Creates, through the same service functions the app uses where practical: 3 fake ministries (a church, a nonprofit, an evangelist), 12 fake users with names such as "Test Person 01" and emails on the reserved `*.invalid`-style domain of section 4, 2 communities with membership applications, 40 posts and replies, a few reports and holds, and a CRM contact list.
- Deterministic: a fixed seed value and stable UUIDs derived from names, so two runs produce identical data and tests can name entities.
- Idempotent: upserts by stable id; a `--reset` option truncates only the seeded ministries (by the fake-name prefix), never the schema.
- Safety rules, enforced in code before any write: (1) refuse unless `DATABASE_URL` points at a hostname and branch recorded in an allow-list file that names `vercel-preview` only; (2) refuse if `NODE_ENV=production` or if `VERCEL_ENV=production`; (3) refuse if the target contains any user whose email is not on the accepted synthetic domains, a short explicit list (`qa.harvest.invalid` for seeded personas, `example.test` for leftovers inherited from `dev`) so the check detects a polluted branch without failing on the branch's own origin; the reset step above removes the inherited rows anyway; (4) never read `.env.local`; (5) print counts, never connection strings.
- Synthetic only: no real names, emails, phone numbers, photos or text copied from any real source, including the repository's own `dev` branch contents beyond what it already holds.

## 4. QA-2 — test-only sign-in shortcut

### 4.1 How sign-in works today

A visitor posts an email to `/api/auth/email-otp/send-verification-otp`; Better Auth generates a 6-digit code, stores its HMAC hash and calls `sendSignInCode` (Resend); the visitor posts email and code to `/api/auth/sign-in/email-otp`. There are no passwords and no social providers. A preview with inert Resend credentials therefore cannot be signed in to at all, which is the problem to solve.

### 4.2 Alternatives

| Option | How | Verdict |
| --- | --- | --- |
| A. Fixed code | Accept `000000` for seeded users | Rejected: a global known code is a backdoor if the gate ever fails |
| B. Test inbox table | Store the sent code in a new table, read it from a helper route | Works, needs a migration and a table that must never exist with data in production |
| C. Derived code for test addresses | In the gate, `generateOTP` and `sendVerificationOTP` are overridden **only for addresses on the reserved synthetic domain**: the code is an HMAC of the address under a QA-only secret, nothing is sent, and a gated helper returns it | **Recommended**: no migration, no network, the normal rate limits, cooldown, hash and audit row still run, real addresses keep the normal path |
| D. Session minting route | A route creates a session directly | Rejected: bypasses the OTP policy that QA should exercise |

### 4.3 Recommended design (option C)

**Gate predicate, exact.** `qaSignInMode(env)` is a pure function of environment variables only. It never reads a request header: no `Host`, no `X-Forwarded-Host`, no origin. It returns `"preview"`, `"local"` or `null`:

```
preview  :  env.HARVEST_QA_SIGN_IN === "preview"
         && env.VERCEL_ENV === "preview"
         && env.VERCEL_TARGET_ENV === "preview"
         && databaseHostAllowed(env.DATABASE_URL)      // same allow-list file as the seed script
local    :  env.HARVEST_QA_SIGN_IN === "local"
         && env.NODE_ENV !== "production"
         && env.VERCEL_ENV === undefined
         && databaseHostAllowed(env.DATABASE_URL)      // refuses prod, staging and dev hosts; localhost test databases only
null     :  everything else (missing, empty or unknown values included)
```

Resolution of the `NODE_ENV` contradiction: a deployed Vercel preview builds and runs with `NODE_ENV=production`, so `NODE_ENV` is **not** one of the ANDed conditions in preview mode (it is in local mode only, where it keeps a developer machine honest; local mode also refuses prod and staging database hosts). The preview mode is anchored on the platform's own `VERCEL_ENV`, an explicit flag, and the database allow-list. Vercel documentation (searched 17 Nov, the page itself was not fetchable from this session) states `VERCEL_ENV` is one of `production`, `preview` or `development`, and `VERCEL_TARGET_ENV` carries the name of a custom environment. It does not say what `VERCEL_ENV` is for a custom environment such as `staging`, so that is **not verified**: the design requires `VERCEL_TARGET_ENV === "preview"` as well, and the database allow-list, so a future custom `staging` environment cannot pass even if it reports `VERCEL_ENV=preview`. Matei also keeps the flag out of the Production scope and any custom environment.

**Fail-closed assertion.** On first use of the auth handler (and at module load where the platform allows), `assertQaSignInSafe(env)` throws and logs `qa_sign_in_misconfigured` (no values) if the flag is set while `VERCEL_ENV === "production"`, or while `NODE_ENV === "production"` with no `VERCEL_ENV` (a self-hosted production build). The auth handler then refuses every request with 503 until the variable is removed. A set flag in a production-like environment is a loud failure, never a silently inactive flag.

- **Build-time exclusion is a requirement.** Like the existing `resend` alias in `next.config.ts` (principle: production can never bundle the test mailer, and real app code has no email test bypass), the test OTP generator and test sender are reached only through a preview-only module alias, enabled only for a preview build (build flag set from `VERCEL_ENV=preview`). The alias target holds the test path; `auth.ts` carries no test branch. A production bundle therefore does not contain the code. If the alias cannot be made reliable on Vercel, a runtime-gated fallback is **not** allowed by this design: it would be an explicit exception needing the founder's decision, recorded in the PR. The build mechanism itself is **not verified**.
- **Scope.** Only addresses ending in the synthetic domain (`@qa.harvest.invalid`, reserved, undeliverable) take the test path; any other address takes the unchanged code and fails closed because the Resend credentials are inert.
- **Derived code with a time bucket.** The code is `HMAC(QA_SIGN_IN_SECRET, address || bucket)` reduced to 6 digits, where `bucket = floor(sent_at / 600 s)` and `sent_at` is the issuance time stored in `otp_cooldowns.sent_at` for that address by the existing cooldown reservation. Both `generateOTP` and the helper read that stored value, so they agree by construction and cannot straddle a bucket boundary. Better Auth stores the hashed code at send time and compares the submitted code with the stored one; it does not recompute at verification, and the 600 s expiry, the 5-attempt limit, the 60 s cooldown and the hourly and daily caps come from the stored row and the unchanged limiter, as in production. The helper returns nothing for an address with no current reservation. `QA_SIGN_IN_SECRET` is a separate secret, never `BETTER_AUTH_SECRET`.
- **No network.** The test path never calls Resend or any provider.
- **Helper route** `GET /api/qa/otp?email=`: 404 when `qaSignInMode` is null; requires a shared-secret header (`x-qa-secret`) compared in constant time (`timingSafeEqual` on equal-length digests); accepts only synthetic-domain addresses; `Cache-Control: no-store`; excluded from indexing (`X-Robots-Tag: noindex`, not in any sitemap, `Disallow` for `/api/qa/` where a robots file exists). The nightly job **calls the helper** (it holds the header secret) rather than recomputing the code, so the HMAC key never leaves the deployment and there is one implementation; `QA_SIGN_IN_SECRET` (the HMAC key) and the helper's header secret are set by Matei in Vercel; the HMAC key never leaves the deployment. The nightly job needs only the `x-qa-secret` header value and the deployment-protection bypass token, both as GitHub secrets.
- **Rate limits and pacing.** Production limits stay unchanged: `send-verification-otp` 3 per 60 s per IP, `otp_cooldowns` 60 s per address with 5 per hour and 20 per day. The e2e helper's spoofed `x-forwarded-for` does not work on Vercel (the edge overwrites it). The walkthrough therefore uses a fresh synthetic address per run and per persona (a run id in the local part), at most one send per address, and spaces sends at least 25 s apart per runner IP so the IP bucket never trips; the 30 requests per minute general limit is respected by the same pacing. No higher limit for the synthetic domain is proposed by default (it would be a code path that is easy to widen); if pacing proves too slow, a documented, flag-gated higher limit for the synthetic domain only is an option for a later reviewed change.
- **Audit.** The sign-in audit row for a test-path sign-in carries a `qa_test_sign_in` marker; a log line `qa_sign_in` has no address or code.
- **Tests.** Unit tests: the full gate table (every combination of flag value, `VERCEL_ENV`, `VERCEL_TARGET_ENV`, `NODE_ENV`, database host, including a custom `staging` and a header-spoofing case proving headers are ignored); the fail-closed assertion; time-bucket expiry; the constant-time helper header check; domain restriction. Integration: real addresses never take the test path; the helper 404s when off. A source guard in `scripts/source-guards.ts` fails CI if `HARVEST_QA_SIGN_IN`, `QA_SIGN_IN_SECRET` or the helper route are referenced outside the gate module, the helper route and its tests, and if a workflow or `.env.example` sets the flag to a value.
- **Production impossibility is layered:** the environment-only gate with the allow-list, the fail-closed assertion, build-time exclusion from production bundles, no flag in the Production scope, the source guard, and the 404.

## 5. QA-3 — nightly Playwright walkthrough

- A new workflow `.github/workflows/qa-nightly.yml` (cron plus `workflow_dispatch`) installs Chromium and runs `tests/qa/walkthrough.spec.ts` against the stable preview URL with `baseURL` from a repository variable. It reuses `playwright.config.ts` conventions (single worker, retries 1) with a separate project and no local web server.
- Journeys: sign up and sign in through QA-2, create a ministry, create a community, a second persona joins (application and approval), post, comment, file a moderation report and see it in the queue. Each journey cleans up only the entities it created (fake-name prefix), or the nightly reseeds.
- Modules whose flag is `NODE_ENV`-gated with no production switch by design (`communityLiveEnabled`, and the planned C11 chat flag) stay **off on a deployed preview**, because a deployed preview has `NODE_ENV=production`. The walkthrough therefore contains no Live or chat steps, and previews cannot exercise those modules until a separate, reviewed preview-positive gate exists per module (open founder decision 5, section 11). The local e2e suite still covers them.
- Permissions: the workflow declares `permissions: contents: read, issues: write` and nothing else.
- Evidence: screenshots at each journey end and Playwright traces on failure, uploaded with `actions/upload-artifact` (7-day retention, as `browser` does). The step summary lists passed and failed journeys.
- Failure reporting: the run fails visibly; a failure opens or comments on a single GitHub issue labelled `qa-nightly` (issue creation uses the workflow's own `GITHUB_TOKEN`). No chat or email notification is added without an explicit decision.
- Safety: the workflow holds no Neon API key and no production value; only the preview URL, an optional Vercel bypass secret and the QA secret needed to read the derived code. It makes no outbound calls beyond the preview.

## 6. QA-4 — migration rehearsal on a production-like branch

- Goal: show that every pending migration, 0031 through the last journal entry (`0056_newsletter_nl01` on `main` at the time of writing), applies in order on a copy shaped like production, and that the verification queries of `docs/setup/production-migrations.md` pass.
- Start point: Neon branching normally copies data as well as schema, and schema-only branching is plan-dependent and **not verified** here. The rehearsal is therefore restricted to a branch of `staging` or `dev` at a **known migration state** (check `drizzle.__drizzle_migrations` against the journal first, as in the runbook), which hold no real data. **Never branch `prod` once it holds real data**, and never for this purpose without Matei's explicit approval and a stated verification that the copy contains no personal data. The schema state production is believed to be at is not verified (section 2); if production's state is needed, the runbook's read-only query on the owner connection answers it without a copy.
- Mechanism: extend the existing `scripts/neon-ci.ts` pattern, not a new tool: a temporary `qa/<run>-<attempt>` branch, `npm run db:migrate` as `harvest_owner`, the verification SQL from the runbook, the worker-role grant check from `docs/setup/worker-role.md`, then deletion of that branch in an `always()` step. Triggered by hand from `main` like the `neon` job.
- Output: a table of applied migrations, timings and the verification results in the step summary, to be pasted into the runbook as rehearsal evidence. This is evidence for the founder's go/no-go; it does not authorize the production run.

## 7. QA-5 — pilot rehearsal checklist (phone)

A short checklist in `docs/setup/qa-pilot-rehearsal.md`, written for a phone: open the preview alias, sign in as a named seeded persona using the QA-2 helper, create a ministry, create and publish a community, invite a second persona on another browser profile, post, comment, file and decide a report, sign out. Each step lists the expected result and a place to note a failure. Live and chat are not part of it (section 5). It uses only synthetic data, states that nothing real is sent, and ends with how to report problems. It is a checklist, not a test plan, and carries no sign-off.

## 8. Data safety rules

1. Synthetic data only, everywhere in this slice: fake names, the reserved undeliverable domain, no real contact details, no copied production rows.
2. Never run the seed, a test or a rehearsal against `prod`, `staging` or `dev` except the temporary rehearsal branches of QA-4; the `vercel-preview` branch is the only seed target.
3. No real outbound email, SMS, webhook, payment or social call from any preview or workflow; Resend stays inert, storage unset or mocked, payments unset.
4. No secrets in the repository, logs, artifacts or screenshots; screenshots are taken from synthetic data only.
5. HC-02 gates stay UNAPPROVED; Connect intake and invitation delivery stay hard-disabled in previews.

## 9. Cost, CI minutes and risks

- GitHub Actions: the repository is public, so hosted minutes are free; the nightly run is one job (about 10 to 20 minutes). Neon: one small always-available branch plus short-lived rehearsal branches (the plan's default 0.25 CU and auto-suspend apply; cost is **not verified** and is a Matei decision). Vercel: preview builds per PR consume the plan's build minutes, which may be a cost; limiting previews to labelled PRs is an option.
- Risks: a deployed preview has `NODE_ENV=production`, which keeps NODE_ENV-gated modules off and defeats a `NODE_ENV` clause (mitigated by the environment-only predicate, the allow-list and tests); a leaked project-scoped Neon key (mitigated by a narrower credential); previews drifting from the `vercel-preview` branch schema (mitigated by a documented migrate-and-seed step per release); flaky nightly runs training people to ignore them (mitigated by a single issue and retries of one).

## 10. What is NOT verified

- Whether a Vercel project is connected to this repository, which environments exist, and whether preview builds currently succeed.
- That the `vercel-preview` branch exists with id `br-shy-hall-baslhh18`, that it is empty of real data, and that it is migrated to the current schema: the branch is not in the repository's Neon records.
- How Better Auth handles a dynamic per-preview origin; what `VERCEL_ENV` reports for a custom environment; whether a preview-only build flag can be set reliably on Vercel; whether schema-only Neon branching is available on the plan.
- The current applied migration state of staging and production.
- Whether a branch-scoped Neon API key is available on the current plan.
- Cost and build-minute impact.
- Nothing here has been run; no code, workflow or setting exists yet.

## 11. Open questions (recommended defaults)

5. **OPEN FOUNDER DECISION: preview-positive gates for NODE_ENV-gated modules.** Live and chat are off on previews by design. Options: keep them local-test-only (they are covered by the local e2e suite), or add, per module and in a separate reviewed PR, a preview-positive gate with the same environment-only predicate as QA-2. Recommendation: keep them local-only for now, decide after C11 lands; do not fold this into QA-2. (Listed first below for visibility; numbered 5 to keep the question numbers stable.)

1. **Stable alias or per-PR previews for the nightly run?** Default: one stable `qa-preview` alias (section 3.3); per-PR previews for manual use only.
2. **QA-2 option?** Default: option C (derived code for the reserved synthetic domain, gated helper route), not a fixed code.
3. **Where does the Vercel bypass secret for Deployment Protection live?** Default: a GitHub secret set by Matei, scoped to the nightly workflow; protection stays on.
4. **QA-4 start point?** Default: a schema-only copy of `staging` once it is confirmed to be at a known migration; use `prod` structure only with Matei's explicit approval.

## 12. PR slices

| PR | Content | Tests |
| --- | --- | --- |
| QA-1 | Preview runbook `docs/setup/qa-preview.md` (variables, scopes, branch rules), the `vercel-preview` branch recorded in `docs/setup/neon.md`, the schema-only reset, a GitHub job (from `main`, owner secret) for migrate and seed, `scripts/qa-seed.ts` with allow-list and refusals | Unit: refusals (production, polluted branch, wrong host), determinism, idempotency against the disposable test database |
| QA-2 | `qaSignInEnabled` gate, synthetic-domain test path in `auth.ts`, gated helper route, audit marker, source guard | Unit: full gate table; integration: real addresses unaffected, helper 404 when off; source-guard test |
| QA-3 | `qa-nightly.yml`, `tests/qa/walkthrough.spec.ts`, issue-on-failure step | Dry run with `workflow_dispatch` against the local e2e server; artifact upload verified |
| QA-4 | Rehearsal mode in the Neon check, runbook section and evidence template | Run by hand from `main` on a temporary branch; verification queries green; branch deleted |
| QA-5 | `docs/setup/qa-pilot-rehearsal.md` | Founder click-through; no automated test |

Order: QA-1, QA-2, QA-3, then QA-4 and QA-5 in either order. Each PR is reviewed by a separate fresh session. Migration numbers: none of these slices adds a migration (next free candidate remains 0057 or later, not a reservation).

## 13. Acceptance criteria

- `qaSignInMode` is derived from environment only, returns null for a custom `staging` environment, and the fail-closed assertion refuses the auth handler when the flag is set in a production-like environment.
- The seed script cannot run against anything except the allow-listed `vercel-preview` target, and two runs give identical data.
- `qaSignInEnabled` is false for every production-like environment in a table test, and a source guard fails CI on any other reference.
- A seeded persona signs in on a preview using the header-protected helper with no email delivered and no network call; a real address still fails closed.
- The nightly job produces screenshots and a failure issue on a forced failure.
- The rehearsal applies the whole pending list in order on a temporary branch and the runbook verification passes, with the branch deleted.
- No secret appears in the diff, logs or artifacts; no HC-02 gate, activation or production change is claimed.
