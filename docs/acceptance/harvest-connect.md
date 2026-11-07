# Harvest Connect acceptance record

## Current-state reconciliation — 2026-11-07

The HC-01/HC-04 baseline and evidence below are historical, not a current implementation checklist. CRM-01–08 foundation, CW-01 campaigns and HC-02 are now merged (PRs #25, #22 and #28 include migrations 0025–0026). HC-03 is open as draft PR #29 with migration 0027: QR lifecycle administration and a published-only database resolver. It is not merged or deployed. See [HC-02 acceptance](../acceptance/hc-02.md), [HC-03 acceptance](../acceptance/hc-03.md) and [closeout review](../reviews/hc-03-closeout.md). Follow the live GitHub head/checks, not historical migration reservations or statements that CRM-05 is unmerged.

HC-05 intake, HC-06/07 verified claims/CRM association and later Communities/follow-up remain future work. The [five activation decisions](../decisions/hc-02-activation-gates.md) remain unapproved; technical review is not collection or launch approval. Historical review checkboxes record the scope of their original slice only.

Historical delivery date: 2026-11-06. Scope of the evidence below: **HC-04 public landing and starter resources**. HC-01 architecture evidence below is historical; later-slice and production release gates remain pending.

Source of truth: [Connect PRD](../prd/harvest-connect-qr-to-discipleship.md), merged via [#17](https://github.com/bumbmatei-sys/harvest-v2/pull/17) at `e5d9752`. Architecture: [ADR 0011](../decisions/0011-harvest-connect.md). Privacy: [threat model and J1–J8 inventory](../security/harvest-connect-threat-model.md). Plan: [HC-01–HC-20 index](../prd/harvest-connect-slices.md).

## HC-01 documentation checklist

- [x] Product framing: church/crusade outreach organizer within Harvest, with canonical workspace CRM contacts.
- [x] Separate optional purposes, no automatic account/community/marketing enrollment and no shared church roster.
- [x] Reuse Campaigns, Forms, CRM contacts/identifiers/consents/dedupe, free auth, Communities, notifications and campaign-scoped budgets; distinguish present modules from planned dependencies.
- [x] Preserve all PRD §1.3 non-goals.
- [x] Define workspace → campaign → source, free identity → membership and assignment → counselor/church boundaries.
- [x] HC-06 requires verified authorized CRM association; follow-up cases are not “converted” tags; special-category content stays outside generic CRM fields/tags/events.
- [x] Carry the CRM-05 B1 lesson into contact erasure across response tables, claims, outbox/jobs, replay and derived payloads; account for unclaimed guests and revocation races.
- [x] Document five required threats (cross-church sharing, purpose creep, roster export, counselor over-access, QR enumeration), controls and future evidence.
- [x] Inventory minimal personal data, purpose, recipients and retention/rights questions for every journey J1–J8.
- [x] Preserve PRD §15 HC-01–HC-20 IDs/scopes and add dependencies, defined CRM readiness column, module owners and done-when criteria.
- [x] Record next sequence: CRM-05 merge and final CRM tip → HC-02 → HC-03; distinguish early pilot from full Communities-dependent launch.
- [x] Track PRD §18 founder review without inventing answers; list pending legal/security/safeguarding review.
- [x] Four documentation files only; no PRD rewrite, Craft changes, application/UI or schema changes.

## Verification and delivery evidence

Baseline: `e5d9752f29823d3b30ce84e8e063231834609c19`. Requested branch: `docs/hc01-connect-architecture`, target `main`, **draft PR only**. The supplied `/tmp/harvest-connect-hc01` Git metadata is on a read-only mount; an isolated checkout at `/tmp/harvest-connect-hc01-delivery` is used for commit/push. The supplied worktree and CRM-05 branch remain untouched.

| Check | Result |
| --- | --- |
| Markdown lint discovery | No Markdown lint script, configuration or dependency is present in the tracked repository; not applicable |
| `python3 /tmp/verify-hc01-docs.py /tmp/harvest-connect-hc01-delivery` | Passed: 28 relative file links, 6 heading anchors, table structure, whitespace and final newlines in all four files |
| HC IDs / J1–J8 / §18 coverage (same session-only checker) | Passed: HC-01–HC-20 once each with Yes/No readiness, J1–J8 once each, 15 remaining founder decisions plus the confirmed working name |
| `git diff --cached --check` and `git diff --cached --stat` | Passed; exactly four documentation additions, 278 lines; no application, migration, dependency or CI changes |
| Commit/push and post-push `git status --porcelain` | Delivery evidence is recorded in the PR/handoff with final head SHA and draft PR URL, avoiding a self-referencing commit |

The Python checker is a session-only validation aid outside the repository, not a new product test or dependency. No application lint/build/browser/database tests, migrations or delivery-provider calls are needed for these four documentation files; none are claimed run. Existing GitHub PR CI may run its configured checks, including its isolated Neon CI lifecycle; this PR adds no CI or production configuration change. No manual Neon, R2 or Vercel access is performed.

## Pending review and future acceptance

- [ ] Matei reviews the [remaining §18 decisions](../prd/harvest-connect-slices.md#founder-review-from-prd-18); required privacy baselines remain in force.
- [ ] Qualified legal/privacy review: purpose-specific lawful bases, any special-category condition, controller/recipient roles and agreements, notices, retention/DSAR, minors and transfer/DPIA requirements. **No legal signoff recorded.**
- [ ] Security review: public/tenant/assignment/recipient boundaries, erasure and queue races, providers, abuse, aggregation, devices and incident/restore handling. **No security signoff recorded.**
- [ ] Ministry/safeguarding review: community eligibility, screened staff, licensed resources, youth and escalation policy. **No safeguarding signoff recorded.**
- [ ] After CRM-05 merge, reconcile final schema/erasure behavior and migration order before HC-02; its B1 fix is not certified by HC-01.
- [ ] Future slices supply actual two-tenant, assignment/recipient, idempotency, claim, consent/erasure and accessibility evidence, plus crowd/load and runbooks for HC-16.
- [ ] Full QR → community release passes PRD §16 with working Communities and voluntary membership; an early limited pilot is not full-launch approval.

## Explicitly outside the historical HC-01 PR

No app UI or feature code; no HC-02+ schema generated/applied beyond conceptual ADR naming; no CRM-06 or CRM-05 branch changes; no Eden switcher, Soft FU or Connect finance code. No secrets printed or committed; no production Neon/R2/Vercel actions, deployment, merge, main force-push, Cursor CloudAgent or outbound messages to people. Delivery stops at the draft PR.

## HC-04 public landing and starter resources

Baseline: `3e38d45f26e5d3e4e77904ff0d372c7072dc770c`. Branch: `feat/hc-04-public-landing` → `main`, draft only. Design and handoff: [minimal public presentation contract](../decisions/hc-04-public-presentation.md). Architecture/privacy/dependency links at the top remain authoritative. HC-02 is skipped because it depends on merged/verified CRM-05+; HC-03 production QR publishing is also deferred.

The supplied worktree's Git metadata is read-only. Implementation, checks and screenshots run in `/tmp/harvest-connect-hc02`; an isolated checkout at `/tmp/harvest-connect-hc04-delivery` commits/pushes the same requested branch. No edits to CRM-05 or the switcher branch.

### Checklist

- [x] Mobile guest landing `/c/9f4c2a71d8e64b30a6f9c1057b2d8e43`, outside AppShell, with welcome and immediate resource access.
- [x] Three next-step cards; connection/account actions disabled and marked coming soon. No compulsory form, identification, sign-in, claim or invitation.
- [x] `/resources/start` and three individual original text guides: introductory readings, common questions and next steps; no external media/download prerequisite.
- [x] Exact opaque-code lookup exposes only the static public preview; unknown codes/resource IDs receive a safe general-resource fallback. Forged workspace hints are stripped.
- [x] English next-intl copy/metadata, existing unsupported-language fallback, English label. Existing app supports only English; additional reviewed catalogues remain future work.
- [x] Separate choices stay separate: no marketing/follow-up opt-in, response, classification, CRM contact, subscription, membership, shared roster or analytics from a view.
- [x] No tables/schema/migrations/dependencies added; no new RLS surface. Existing two-tenant suite rerun locally.
- [x] Native link fallback and no prefetch: navigation works with JavaScript/fonts/media blocked at 50 KiB/s download, 20 KiB/s upload and 150 ms latency.
- [x] Full Playwright suite: 14 passed; all new mobile/desktop/320px dark-mode axe checks clean; six final captures saved.
- [ ] Human ministry/content/localization review and legal/privacy/security/safeguarding release gates. No signoff asserted.

### Commands and proof

| Check | Result |
| --- | --- |
| `npm ci` | Passed; existing lockfile, no new npm dependencies |
| `npm run lint` | Passed: ESLint plus i18n/semantic-color source guards |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 13 files, 140 tests (including public lookup/allowlist boundary) |
| `npm run test:rls` | Passed: 19 files, 192 tests; disposable embedded local Postgres, no Neon |
| `npx drizzle-kit check` | Passed; no schema change, so generate not run; journal remains at `0017` |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed; includes all public routes; expected generated `public/offline.css` utility additions committed |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/hc04-playwright npm run test:e2e` | Passed: all 14 tests, new + existing suite, 5.8 minutes; zero retries |
| Local production guest smoke, database pointed at unreachable loopback port 1 | Passed: all five public pages return 200 without a database; zero API/non-GET/third-party requests, cookies or browser/server errors. [Evidence](../screenshots/connect/hc-04/production-smoke.json); session-only harness `/tmp/hc04-production-smoke.mjs` |
| `CHROME_PATH=/tmp/hc04-playwright/chromium-1248/chrome-linux64/chrome PLAYWRIGHT_BROWSERS_PATH=/tmp/hc04-playwright npm run test:pwa` | Passed: Lighthouse installability; accessibility / best practices 100; production offline fallback, static-only cache and axe |
| Relative Markdown links in acceptance/contract | Passed: 19 file links resolve |
| `git diff --check` / delivery staged review | Passed: only 23 intended slice files; no schema/journal, dependency, existing screenshot or generated Next type-path changes |

The new browser test covers guest landing → every guide → leave, keyboard skip link, 44px link targets, no horizontal overflow at 390/1440px plus 320px dark mode, axe checks, no identification controls, no auth/API calls or third-party requests, no cookies and no prefetched guides. Next.js retains hidden prior pages and streams metadata separately; test assertions inspect the visible main and wait for the document title before scanning. No application behavior is changed to mask test timing.

### Captures

Real browser captures, not mockups, at 390×844 and 1440×1000 (full page):

| Page | Mobile | Desktop |
| --- | --- | --- |
| Landing | [landing-mobile.png](../screenshots/connect/hc-04/landing-mobile.png) | [landing-desktop.png](../screenshots/connect/hc-04/landing-desktop.png) |
| Resources | [resources-mobile.png](../screenshots/connect/hc-04/resources-mobile.png) | [resources-desktop.png](../screenshots/connect/hc-04/resources-desktop.png) |
| Reading guide | [reading-mobile.png](../screenshots/connect/hc-04/reading-mobile.png) | [reading-desktop.png](../screenshots/connect/hc-04/reading-desktop.png) |

Accessibility results: [axe-results.json](../screenshots/connect/hc-04/axe-results.json). Existing suite screenshots outside `connect/hc-04` are generated during verification and excluded from the slice diff.

### Remaining and exclusions

Static preview only; no real campaign/QR is published or launch approved. Production resources and locales need ministry/content review; legal/security/safeguarding gates remain pending. Community links/discovery await their own canonical module. No second locale is claimed.

No migration number chosen: no schema change; preserve `0018`–`0021` for CRM-05 and start future Connect migrations at `0022` or higher only after rechecking branches/open PRs. No HC-02/03/05–20, CRM-05/06, Eden switcher, Soft FU, Connect finance, production Neon/R2/Vercel, merge, deploy, reviewer request or Cursor CloudAgent. Final head SHA and draft PR URL are recorded in the PR/handoff to avoid a self-referencing commit.

### HC-04 r1 review fixes — 2026-11-06

Review baseline: `6d6e3045c58c00ed1cac6bc4a3a87d9978fcc182`, draft [PR #20](https://github.com/bumbmatei-sys/harvest-v2/pull/20). The same feature branch was rebased onto latest main `708ed11` (merged CRM-05 #15). The shared catalogue retains main's entries plus Connect; offline CSS was regenerated. No changes relative to main in CRM code, schema, migration journal or dependencies; no CW-01 migration `0021` or CRM-06 work was imported. Fixes and verification run in `/tmp/harvest-connect-hc04-fix`.

- [x] B1: public skip link matches the shell's plain anchor with `focus:p-3`, fixed viewport placement and existing card tokens.
- [x] Required test 1: keyboard Tab focuses the skip link on landing, resource index, reading guide and both unavailable routes; its DOM rectangle must be at least 44px tall and fully within the viewport at 320, 375, 390, 768, 1024 and 1440px. Enter must focus main.
- [x] Required test 2: deterministic generated hex, UUID and Unicode inputs plus single-character mutations/deletions and prefix/suffix variants reject every sampled non-exact code. Includes uppercase, empty/whitespace, and generated publication-state variants such as `unpublished-preview`.
- [x] Required test 3: unknown, uppercase preview code, another tenant-shaped UUID, draft, unpublished, disabled and archived codes assert HTTP **404** and the same unavailable heading/resource fallback. Invalid resource IDs assert 404 too.
- [x] Required test 4: recursive source guard forbids `dangerouslySetInnerHTML` in every JS/TS source under `src/app/c`, `src/app/resources` and `src/components/connect`, including future nested components.

The original commands/captures above record initial delivery. Current r1 verification results are recorded below; existing screenshots are retained without committing suite-generated rewrites. Local database verification uses disposable embedded Postgres only. Neon credentials or a new Neon run are not claimed.

| r1 command / check | Result |
| --- | --- |
| `npm run lint` | Passed, including source guards |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 14 files, 149 tests |
| `npm run test:rls` | Passed: 21 files, 213 tests; disposable embedded local Postgres |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed; public routes included, generated offline CSS removes the unused `focus:absolute` utility |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/hc04-playwright npm run test:e2e -- tests/e2e/connect.spec.ts` | Passed: 9 tests, 33.3 seconds, zero retries |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/hc04-playwright npm run test:e2e` | Passed: all 21 tests, 10.9 minutes, zero retries; screenshots/evidence rewrites and `next-env.d.ts` restored |
| M5 / M6 mutation probes with `npx vitest run --project unit tests/unit/connect-public.test.ts` | Both rejected: each mutation caused its intended test to fail; original sources restored and all 149 unit tests passed afterward |
| Schema / dependencies / whitespace | No diff relative to main in `drizzle`, `src/db`, `package.json` or lockfile; `git diff --check` passed |

Initial browser runs exposed test setup issues on unavailable routes: the development 404 boundary renders after document load, and Next's error toolbar inserts a Tab stop. The geometry test waits for the heading and hides only `nextjs-portal`, following the existing browser-test convention. It uses real Tab/Enter presses and measures the actual public anchor; no application workaround or arbitrary delay was added.

### Parked r1 soft follow-ups

These remain acceptance items for later work; none is implemented by the r1 fix:

- A future DB-backed resolver must filter non-published rows under `harvest_app` and select only an explicit public column allowlist; today's publication field is a static constant, not a database publication gate.
- Future locale loading must take only `resolveLocale` output.
- Add a regression for normalized `/c/../../workspaces` reaching the existing sign-in redirect.
- Confirm intended indexing split: resource guides are indexable, landing is noindex.
- Unknown `/c/*` document title currently falls back to “Harvest”.
- Document responses have no CSP.
- Review the `badge.tsx` Radix umbrella import and approximately 315 KB shared client graph.
- E2E rewrites unrelated CRM/layout screenshots; keep those generated changes out of commits.
