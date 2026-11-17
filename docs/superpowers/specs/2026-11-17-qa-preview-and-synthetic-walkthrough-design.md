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
7. Five slices, one PR each, all non-production by hard gate. Four open questions with defaults (section 11).

## 1. Goals and non-goals

**Goals:** regular, repeatable testing of the whole app with synthetic data on a deployed, phone-reachable URL; catching migration problems before any production run; zero risk to real people's data.

**Non-goals:** deploying or activating anything in production; changing the production Vercel project's settings; load testing; visual regression baselines; real email, storage, payment or social provider calls; applying migrations to staging or production (still needs Matei's approval, `docs/setup/production-migrations.md`); approving any HC-02 gate.

## 2. Verified starting point

Read from the repository on `main` (`1d372c3`):

- Auth is Better Auth with `emailOTP` only (`emailAndPassword` disabled). The code is sent by `sendSignInCode` through Resend (`RESEND_API_KEY`, `EMAIL_FROM`). Rate limits, a database cooldown (`otp_cooldowns`) and an HMAC-hashed stored code apply. Sessions write an `auth.sign_in` audit row.
- The e2e suite signs in through the real OTP endpoints and reads the code from a JSONL mailbox file (`HARVEST_E2E_MAILBOX`, `HARVEST_E2E_MOCK_EMAIL=1`). A file mailbox does not work on Vercel (serverless, no shared filesystem), so previews need a different test channel (QA-2).
- `scripts/e2e-server.ts` starts `next dev` against a disposable embedded Postgres, a storage mock and mock email. CI browser tests run in four shards on GitHub-hosted runners (free, the repository is public).
- The Neon migration check (`neon` job, `scripts/neon-ci.ts`) runs only from `main`, creates a temporary `ci/<run>-<attempt>` branch from `dev`, applies migrations as owner and deletes only that branch. It needs repository secrets `NEON_API_KEY` and `NEON_PROJECT_ID`.
- `docs/setup/neon.md` lists branches `prod`, `staging`, `dev` in project `harvest-v2` (`cool-wind-15257108`). The `vercel-preview` branch (`br-shy-hall-baslhh18`, branched from `dev`) comes from the founder's request and is **not listed in the repository**: see section 10.
- There is no `vercel.json`, no `VERCEL_*` reference in `src` or `.env.example`, and no repository evidence that a Vercel project is connected. Whether previews already build is **not verified** here.
- `docs/setup/neon.md` records that staging and prod were not migrated at provisioning; the current applied state of production is unknown, so QA-4 assumes nothing about it.

## 3. QA-1 — preview deployments on a test Neon branch, and the seed script

### 3.1 Environment and branch

- Preview environment variables (Vercel scope **Preview only**, never Production): `DATABASE_URL` (pooled, `harvest_app`), `DATABASE_URL_UNPOOLED` (direct, owner; only if a build or seed step migrates, otherwise omit), `BETTER_AUTH_SECRET` (a random value unique to previews, never reused from dev or prod), `BETTER_AUTH_URL` (section 3.3), `RESEND_API_KEY` and `EMAIL_FROM` set to **inert placeholders** (a fake key and an `example.test` sender), the QA flag of section 4, and `HARVEST_COMMUNITIES=enabled` where the Communities modules must show. `S3_*` left unset so uploads fail closed, or pointed at a local-style mock if QA-3 needs uploads (open question). `DODO_PAYMENTS_API_KEY` unset. No `NEON_API_KEY` in Vercel at all.
- The `vercel-preview` branch must stay **empty of real data**: it is branched from `dev`, which per `docs/setup/neon.md` holds synthetic data only. QA-1 re-verifies that (section 3.4) instead of trusting it, then treats the branch as disposable: it can be reset from `dev` at any time, and the seed script is idempotent.
- Roles: the app connects as `harvest_app` (no ownership, no BYPASSRLS), exactly as in production. The preview never gets owner credentials at runtime.

### 3.2 Secrets handling

- No secret enters the repository, a PR description, a log line or this document. Values are set in Vercel and GitHub settings only. Docs name variables, not values.
- The Neon API key available today is **project-scoped**. Recommendation: create a separate, narrower credential for QA automation (a branch-scoped or least-privilege Neon API key if the plan allows it; otherwise a dedicated Neon role/connection string for `vercel-preview` only), so a leak cannot touch `prod`. Vercel receives only database connection strings for `vercel-preview`, never the Neon API key.
- Who sets what: **Matei** (project owner) creates the Vercel preview variables and any GitHub secrets, and approves who may do so. A session can write the runbook and the checks but never holds the values.
- Deployment Protection (Vercel authentication) stays on for previews; the founder's phone signs in to Vercel once. Bypass tokens for the nightly job are a GitHub secret (open question 3).

### 3.3 `BETTER_AUTH_URL` and preview URLs

Better Auth checks the request origin against its base URL, and preview URLs differ per deployment. Options: (a) one stable alias, a long-lived `qa-preview` branch with a fixed Vercel branch domain used for the nightly run and the founder's phone, with `BETTER_AUTH_URL` set to it; (b) derive the base URL from the deployment's own URL at runtime for per-PR previews. **Recommendation: (a) first**; (b) only after a small, reviewed change proves how Better Auth accepts a dynamic origin, which is **not verified**. The production URL is never listed as an allowed origin for previews.

### 3.4 Seed script (`scripts/qa-seed.ts`)

- Creates, through the same service functions the app uses where practical: 3 fake ministries (a church, a nonprofit, an evangelist), 12 fake users with names such as "Test Person 01" and emails on the reserved `*.invalid`-style domain of section 4, 2 communities with membership applications, 40 posts and replies, 200 chat messages once chat exists (C11), a few reports and holds, and a CRM contact list.
- Deterministic: a fixed seed value and stable UUIDs derived from names, so two runs produce identical data and tests can name entities.
- Idempotent: upserts by stable id; a `--reset` option truncates only the seeded ministries (by the fake-name prefix), never the schema.
- Safety rules, enforced in code before any write: (1) refuse unless `DATABASE_URL` points at a hostname and branch recorded in an allow-list file that names `vercel-preview` only; (2) refuse if `NODE_ENV=production` or if `VERCEL_ENV=production`; (3) refuse if the target already contains any user whose email is not on the synthetic domain (that detects a polluted branch); (4) never read `.env.local`; (5) print counts, never connection strings.
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

- Gate: one pure function `qaSignInEnabled(env)` next to `communityLiveEnabled`, true only when **all** hold: it is a non-production deployment, **and** an explicit preview-only flag `HARVEST_QA_SIGN_IN=preview` is set **and** the deployment is not the production Vercel environment (`VERCEL_ENV !== "production"`, and `VERCEL_ENV` is present as `preview` or the host is localhost). Missing, empty or unknown values mean off. Note that a Vercel preview build normally runs with `NODE_ENV=production`; the existing `NODE_ENV` clause would therefore keep the shortcut off on a deployed preview. The design resolves this by making the preview condition `VERCEL_ENV === "preview"` the positive test and `NODE_ENV` the guard only for local use; the exact boolean, and a test table covering every combination, are the QA-2 PR's first deliverable and are **not verified** here.
- Scope: only addresses ending in the synthetic domain (`@qa.harvest.invalid`, reserved, undeliverable) take the test path; any other address is handled by the unchanged code, which fails closed because the Resend credentials are inert.
- No network: the test path never calls Resend or any provider.
- Audit: the sign-in audit row for a test path carries a `qa_test_sign_in` marker so the data can be told apart; a log line `qa_sign_in` without address or code.
- Helper: `GET /api/qa/otp?email=` returns the derived code, returns 404 whenever the gate is off, accepts only synthetic-domain addresses, and sets `Cache-Control: no-store`. This is the only added route and renders no UI.
- Tests: unit tests of the gate (every combination of the three conditions, including production-like environments), of the domain restriction, and an integration test that real addresses never take the test path. A source guard in `scripts/source-guards.ts` fails CI if `HARVEST_QA_SIGN_IN` or the helper route is referenced anywhere outside the gate module, the helper route and its tests, and if the production workflow or `.env.example` sets it to a value.
- Production impossibility is layered: a code gate (above), no production env var (Matei confirms the Vercel Production scope never has the flag), a source guard, and the 404.

## 5. QA-3 — nightly Playwright walkthrough

- A new workflow `.github/workflows/qa-nightly.yml` (cron plus `workflow_dispatch`) installs Chromium and runs `tests/qa/walkthrough.spec.ts` against the stable preview URL with `baseURL` from a repository variable. It reuses `playwright.config.ts` conventions (single worker, retries 1) with a separate project and no local web server.
- Journeys: sign up and sign in through QA-2, create a ministry, create a community, a second persona joins (application and approval), post, comment, send a chat message once C11 exists, file a moderation report and see it in the queue. Each journey cleans up only the entities it created (fake-name prefix), or the nightly reseeds.
- Evidence: screenshots at each journey end and Playwright traces on failure, uploaded with `actions/upload-artifact` (7-day retention, as `browser` does). The step summary lists passed and failed journeys.
- Failure reporting: the run fails visibly; a failure opens or comments on a single GitHub issue labelled `qa-nightly` (issue creation uses the workflow's own `GITHUB_TOKEN`). No chat or email notification is added without an explicit decision.
- Safety: the workflow holds no Neon API key and no production value; only the preview URL, an optional Vercel bypass secret and the QA secret needed to read the derived code. It makes no outbound calls beyond the preview.

## 6. QA-4 — migration rehearsal on a production-like branch

- Goal: show that every pending migration, 0031 through the last journal entry (`0056_newsletter_nl01` on `main` at the time of writing), applies in order on a copy shaped like production, and that the verification queries of `docs/setup/production-migrations.md` pass.
- Production-like start: the schema state production is believed to be at is **not verified** (see section 2). The rehearsal branch is therefore created from the **`prod` Neon branch as a schema-only copy** only if the founder approves reading that branch's structure; otherwise from `staging`, or from `dev` reset to the last migration production is known to have. Never run any migration against `prod` itself.
- Mechanism: extend the existing `scripts/neon-ci.ts` pattern, not a new tool: a temporary `qa/<run>-<attempt>` branch, `npm run db:migrate` as `harvest_owner`, the verification SQL from the runbook, the worker-role grant check from `docs/setup/worker-role.md`, then deletion of that branch in an `always()` step. Triggered by hand from `main` like the `neon` job.
- Output: a table of applied migrations, timings and the verification results in the step summary, to be pasted into the runbook as rehearsal evidence. This is evidence for the founder's go/no-go; it does not authorize the production run.

## 7. QA-5 — pilot rehearsal checklist (phone)

A short checklist in `docs/setup/qa-pilot-rehearsal.md`, written for a phone: open the preview alias, sign in as a named seeded persona using the QA-2 helper, create a ministry, create and publish a community, invite a second persona on another browser profile, post, comment, chat (when C11 exists), file and decide a report, sign out. Each step lists the expected result and a place to note a failure. It uses only synthetic data, states that nothing real is sent, and ends with how to report problems. It is a checklist, not a test plan, and carries no sign-off.

## 8. Data safety rules

1. Synthetic data only, everywhere in this slice: fake names, the reserved undeliverable domain, no real contact details, no copied production rows.
2. Never run the seed, a test or a rehearsal against `prod`, `staging` or `dev` except the documented read-only branch copy; the `vercel-preview` branch is the only seed target.
3. No real outbound email, SMS, webhook, payment or social call from any preview or workflow; Resend stays inert, storage unset or mocked, payments unset.
4. No secrets in the repository, logs, artifacts or screenshots; screenshots are taken from synthetic data only.
5. HC-02 gates stay UNAPPROVED; Connect intake and invitation delivery stay hard-disabled in previews.

## 9. Cost, CI minutes and risks

- GitHub Actions: the repository is public, so hosted minutes are free; the nightly run is one job (about 10 to 20 minutes). Neon: one small always-available branch plus short-lived rehearsal branches (the plan's default 0.25 CU and auto-suspend apply; cost is **not verified** and is a Matei decision). Vercel: preview builds per PR consume the plan's build minutes, which may be a cost; limiting previews to labelled PRs is an option.
- Risks: a preview with `NODE_ENV=production` defeats the existing flag pattern (mitigated by the explicit `VERCEL_ENV` positive test and tests); a leaked project-scoped Neon key (mitigated by a narrower credential); previews drifting from the `vercel-preview` branch schema (mitigated by a documented migrate-and-seed step per release); flaky nightly runs training people to ignore them (mitigated by a single issue and retries of one).

## 10. What is NOT verified

- Whether a Vercel project is connected to this repository, which environments exist, and whether preview builds currently succeed.
- That the `vercel-preview` branch exists with id `br-shy-hall-baslhh18`, that it is empty of real data, and that it is migrated to the current schema: the branch is not in the repository's Neon records.
- How Better Auth handles a dynamic per-preview origin, and whether a Vercel preview build can honour `NODE_ENV` as the existing gate assumes.
- The current applied migration state of staging and production.
- Whether a branch-scoped Neon API key is available on the current plan.
- Cost and build-minute impact.
- Nothing here has been run; no code, workflow or setting exists yet.

## 11. Open questions (recommended defaults)

1. **Stable alias or per-PR previews for the nightly run?** Default: one stable `qa-preview` alias (section 3.3); per-PR previews for manual use only.
2. **QA-2 option?** Default: option C (derived code for the reserved synthetic domain, gated helper route), not a fixed code.
3. **Where does the Vercel bypass secret for Deployment Protection live?** Default: a GitHub secret set by Matei, scoped to the nightly workflow; protection stays on.
4. **QA-4 start point?** Default: a schema-only copy of `staging` once it is confirmed to be at a known migration; use `prod` structure only with Matei's explicit approval.

## 12. PR slices

| PR | Content | Tests |
| --- | --- | --- |
| QA-1 | Preview runbook `docs/setup/qa-preview.md` (variables, scopes, branch rules), `scripts/qa-seed.ts` with allow-list and refusals | Unit: refusals (production, polluted branch, wrong host), determinism, idempotency against the disposable test database |
| QA-2 | `qaSignInEnabled` gate, synthetic-domain test path in `auth.ts`, gated helper route, audit marker, source guard | Unit: full gate table; integration: real addresses unaffected, helper 404 when off; source-guard test |
| QA-3 | `qa-nightly.yml`, `tests/qa/walkthrough.spec.ts`, issue-on-failure step | Dry run with `workflow_dispatch` against the local e2e server; artifact upload verified |
| QA-4 | Rehearsal mode in the Neon check, runbook section and evidence template | Run by hand from `main` on a temporary branch; verification queries green; branch deleted |
| QA-5 | `docs/setup/qa-pilot-rehearsal.md` | Founder click-through; no automated test |

Order: QA-1, QA-2, QA-3, then QA-4 and QA-5 in either order. Each PR is reviewed by a separate fresh session. Migration numbers: none of these slices adds a migration (next free candidate remains 0057 or later, not a reservation).

## 13. Acceptance criteria

- The seed script cannot run against anything except the allow-listed `vercel-preview` target, and two runs give identical data.
- `qaSignInEnabled` is false for every production-like environment in a table test, and a source guard fails CI on any other reference.
- A seeded persona signs in on a preview with no email delivered and no network call; a real address still fails closed.
- The nightly job produces screenshots and a failure issue on a forced failure.
- The rehearsal applies the whole pending list in order on a temporary branch and the runbook verification passes, with the branch deleted.
- No secret appears in the diff, logs or artifacts; no HC-02 gate, activation or production change is claimed.
