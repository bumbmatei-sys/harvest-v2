# QA-1 and QA-2 on the Cloudflare app: fake-data seed and test sign-in shortcut

Launch roadmap Phase 1 (Foundation), gate "end-to-end tests and pilot users". Founder approved parallel work on 26 Nov.
Runbook: [docs/setup/qa-preview.md](../setup/qa-preview.md). No migration. No visual UI (no kit items). Synthetic data
only; all five HC-02 activation gates remain **UNAPPROVED**. Nothing was run against staging or any hosted database.

## Delivered

| Item | Where |
| --- | --- |
| Seed target and token gates (pure) | `src/server/qa-preview-gate.ts` |
| Seed data through the app's services | `scripts/qa-preview-seed-data.ts`, CLI `scripts/qa-preview-seed.ts`, `npm run qa:preview-seed` |
| Shortcut route | `src/app/api/qa/sign-in/route.ts` → `src/server/qa-shortcut.ts` |
| Request scope read by the standard OTP hooks | `src/server/qa-shortcut-scope.ts`, `src/server/auth-otp-hooks.ts` |
| Worker refuses the token outside preview/local | `src/server/worker-settings.ts` |
| Source guard (token, scope, route, CI and Worker config) | `scripts/source-guards.ts` |
| Local browser server opens the shortcut | `scripts/e2e-server.ts` (`HARVEST_ENV=test`, random token file next to the mailbox) |

## Acceptance

- [x] Seed creates ministries (3 audiences), people, CRM contacts with consent, communities with members, discussions,
  replies, chat and a private message, campaigns from the wizard with budget and fundraising settings, boards, a
  milestone, linked events, fundraisers with pledges and gifts, newsletter audiences, lists and subscriptions, and
  (with the synthetic key) a social test account and drafts.
- [x] Writes go through the service functions as the acting fake user; only the account row is inserted directly.
- [x] Deterministic and idempotent: a second run returns identical counts and adds no row, audit rows included.
- [x] Refuses production (`HARVEST_ENV`, `NODE_ENV`, `VERCEL_ENV`, `VERCEL_TARGET_ENV`), unknown stages, unlisted hosts,
  other databases, ports and parameters, a non-`harvest_app` login, an owner or superuser connection, and a database
  holding a non-synthetic account.
- [x] Only `@example.invalid` addresses, invented names, no real people.
- [x] Shortcut opens only on a preview, staging (founder decision, 26 Nov) or local Worker with the token, or the local Node
  test server; 404 otherwise, including staging without the token.
- [x] A production Worker with the token refuses to start (CF-03 production-safety test extended); staging with the token starts.
- [x] The seed accepts the `cf-staging` direct endpoint (host and database only, no credentials) and refuses its pooled host.
- [x] Rate-limited by the normal OTP limits (second attempt within 60 s: 429) and audited (`auth.sign_in` with
  `qa_test_sign_in: "shortcut"`); refused attempts logged without values.
- [x] Refuses non-`@example.invalid` and unknown accounts; never creates an account; never sends email.
- [x] Ordinary OTP sign-in unchanged: a normal request still sends its code.

## Evidence

Run locally on branch `feat/d-qa-seed` (embedded Postgres, as user `ubuntu`):

| Check | Result |
| --- | --- |
| `tests/unit/qa-preview.test.ts` (seed guard table incl. the cf-staging endpoint, token binding, Node and Worker gates incl. staging, hooks, route incl. staging without token 404, source guard) | 8/8 pass |
| `tests/unit/cf03.test.ts` (production Worker refuses `QA_PREVIEW_TOKEN`; staging accepts it) | pass |
| `tests/integration/qa-preview-seed.test.ts` (counts, rerun, audits, RLS isolation, role and pollution refusals, CLI) | 5/5 pass |
| `tests/integration/qa-shortcut.test.ts` (sign-in, cooldown 429, refusals, hidden cases, unchanged OTP) | 5/5 pass |
| `tests/e2e/qa-shortcut.spec.ts` (local browser server, webpack dev server) | 1/1 pass |
| `tsc`, `npm run lint` (eslint + source guards), full unit suite | clean; full unit run 1810/1811 under machine load average 18 (one 5 s timeout in `dm-view`, passes on rerun); affected files rerun: 10 files, 118 tests pass |
| Existing QA integration files (`qa-seed`, `qa-sign-in`) and `auth.test.ts` | pass (33 tests with the two new files) |

## Reuse and exceptions

- Reuses the CF-03 Worker settings, the shared request scope helper, Better Auth's OTP endpoints and limiter, the
  existing OTP hooks contract, and the existing services for every seeded record. No new table or UI.
- Exception: the account row is inserted directly, because only sign-in creates accounts.
- The Vercel-preview QA path (`qa:seed`, `/api/qa/otp`, `HARVEST_QA_SIGN_IN`) is untouched; the shortcut refuses to run
  where that path's settings are present.

## Not included / open

- Founder decision 26 Nov ("Yes, on staging"): the shortcut may run on the permanent staging Worker. Applied here; the
  `QA_PREVIEW_TOKEN` secret is not set by this PR. The coordinator sets it, and seeds staging, after review.
- Neither the seed nor the shortcut has been run against staging; both are exercised locally only.
- Social seeding needs the target's `HARVEST_CONNECT_TEST_KEY`; the fake social account is single-ministry by design.
- No reset option: the seed only adds; removal stays the schema-only branch reset.
