# Harvest v2 — PR 01 brief (Foundation)

## Context
v1 (`bumbmatei-sys/Harvest-agent`, Firebase/Firestore) is frozen and READ-ONLY. v2 rebuilds Harvest on Next.js App Router + TypeScript strict + Tailwind + shadcn/ui, Neon Postgres (separate dev/staging/prod branches), Drizzle ORM (migrations in CI), Better Auth, Dodo Payments. PR 01 lays the foundation: repo/CI/Neon/Drizzle/auth/tenancy/audit plus app shell/theme/contacts. Split into **PR 01a** and **PR 01b**, each its own PR.

## Preconditions (Matei must provide / confirm)
- Matei's go to start. Claude Code then creates the repo itself: `gh repo create bumbmatei-sys/harvest-v2 --private`. Never push to v1.
- Neon: Matei gave a one-time go (2026-11-04) for Claude Code to create the Neon project and its dev/staging/prod branches for harvest-v2. Never touch any other Neon project; never print connection strings.
- GitHub secrets set: `NEON_API_KEY`, `NEON_PROJECT_ID` (CI branch only) plus env var names below.
- Resend: reuse v1's existing Resend account and sending domain (key by env name only). No Google sign-in. Dodo Payments key (placeholder, unused).
- Studio tokens: `docs/design/DESIGN.md` in this repo (copied from v1 PR 593). The PRD is `docs/prd/PRD-v2.5.md`. This runs as a cloud Claude Code/Codex session started from Matei's phone; put NEON_API_KEY and RESEND_API_KEY in the cloud environment secrets, never in the repo.
- Visual inspiration: the v1 PRD screenshots in `bumbmatei-sys/Harvest-agent` at `docs/prd/screenshots/` on `main` (about 490 app screens; read with `gh api` or a shallow clone). Use them only for layout and feel, never copying code, logos or text. Local refs are in `docs/design/reference/`.

## Standing rules
- Pull latest before each work session. Never force-push.
- Feature branches + PRs only. Never merge or deploy without Matei's explicit go.
- Never print secrets/env values; env vars by name only. No Vercel env changes.
- Do not touch v1 Firebase/Firestore or v1 repo. No file deletions outside the new repo without explicit yes.
- Never @mention/notify the founder in ClickUp. Do not message Matei directly — report to Harvest Lead.
- No fake/mock data presented as real. Seed data only in dev/staging.
- Never copy third-party code, assets, logos, or text. Never mention any competitor by name in user-facing copy, user-visible commits, or changelog.
- No AGPL code (Postiz, Twenty main app). Record every UI source/block in `docs/ui-sources.md` (URL, license, version, deps, changed files, date) and `docs/third-party-licenses.md`.

## Scope

### PR 01a — repo, CI, Neon, Drizzle, auth, tenancy, audit
Ordered steps:
1. Create repo (after Matei's go), add `main` with README, then initialize Next.js App Router + TypeScript strict + Tailwind + shadcn/ui, feature branch `feat/pr-01a`.
2. GitHub Actions: lint, typecheck, unit tests (vitest), `drizzle migrate` against Neon CI branch, Playwright E2E. All required checks green.
3. Neon + Drizzle setup; separate dev/staging/prod branches; migrations run in CI only. `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (migrations).
4. Payments placeholder: adapter interface + env var names only (`DODO_PAYMENTS_API_KEY`), no integration. ADR 0005.
5. Better Auth: email one-time code (6 digits, stored hashed, expiry ~10 min, attempt limit ~5, resend cooldown, sent via Resend) only (no Google or other OAuth, no passwords). Users/sessions in Neon via Drizzle adapter. ADR 0002.
6. Schema: `users`, `workspaces`, `workspace_members`, `roles`. `tenant_id` on tenant rows + Postgres RLS.
7. RLS: app role without `BYPASSRLS`; policies use `current_setting('app.tenant_id', true)`; set via `SET LOCAL` inside the transaction from server-verified membership — never from client input. ADR 0003.
8. Isolation test: proves cross-tenant isolation AND pooled-connection context reset (after transaction, a reused connection has no tenant context and sees zero rows).
9. `audit_logs` (append-only) written for: sign-in, workspace create, member/role change, contact create/update. Sensitive writes audited and permission-gated.

### PR 01b — app shell, theme, contacts, docs
Ordered steps:
1. Branch `feat/pr-01b` off 01a. App shell with shadcn sidebar + light/dark toggle + brand theme switch. ADR 0004.
2. Design tokens: Harvest default theme; primary buttons wheat-gold `#C9963A` with dark text `#2D2519` (5.69:1). Never white on gold.
3. Optional "Studio" second theme via `data-brand-theme="harvest|studio"`, orthogonal to `data-theme="light|dark"` (or `class="dark"`). Components use CSS variables only — never check theme name.
4. Theme precedence: user localStorage `harvest-brand-theme` > workspace setting > harvest default. Inline pre-paint script prevents flash.
5. Studio token set copied from v1 `docs/design/DESIGN.md` §6 (font Geist; light page `#F7F7F5`, cards `#FFF`, sidebar `#F5F4F1`, text `#272523`/`#55524E`; dark page `#1A1A1A`, panels `#212121`; radius controls 10, cards 16; error red `#C0272E`; faintest grey `#696969`; Studio gold hover `#CEA04E`).
6. Schema: `contacts`, `contact_identifiers` (email/phone/social handle, unique per tenant), `contact_consents` (channel, status, source, timestamp, evidence).
7. Contacts screens: basic list + detail, incl. empty, error, unauthorized states. Indexed tenant-qualified persistence.
8. Docs: `docs/architecture.md` + ADRs `0001 Neon+Drizzle`, `0002 Better Auth`, `0003 RLS tenancy`, `0004 shadcn + theme tokens`, `0005 Dodo payments placeholder`. Plus `docs/ui-sources.md` and `docs/third-party-licenses.md`.

## Out of scope
Social/Zernio, Link in Bio, CRM pipelines/deals, companies, commerce, newsletter, AI, files, jobs, ministry. Any v1 changes. Any Neon project/branch creation. Any integration of Dodo Payments.

## Env vars (names only)
`DATABASE_URL` (pooled) · `DATABASE_URL_UNPOOLED` (migrations) · `BETTER_AUTH_SECRET` · `BETTER_AUTH_URL` · `RESEND_API_KEY` · `EMAIL_FROM` · `DODO_PAYMENTS_API_KEY` (placeholder, unused) · `NEON_API_KEY` + `NEON_PROJECT_ID` (CI branch, GitHub secrets only)

## Acceptance criteria (map to PRD §10 DoD)
1. Workflow spec for each flow with success, error, empty, unauthorized states.
2. Indexed, tenant-qualified persistence; no fake data presented as real.
3. Unit/integration tests (vitest) + Playwright E2E, green in CI.
4. Responsive, accessible, consistent UI across light/dark and both brand themes.
5. Errors measurable (surfaced/observable, not swallowed).
6. Sensitive writes audited and permission-gated.
7. Tested against the Neon staging branch with two seed tenants and separate roles (no app deploy in this PR; Vercel staging deploy only after Matei's go).
8. Product owner sign-off on actual task completion.

## Proof of done
- Real-UI Playwright screenshots of: sign-in, workspace, contacts list, contact detail — in light + dark AND both brand themes (`harvest`, `studio`).
- Full test output: CI run links + local output.
- Isolation test output (incl. pooled-connection reset case).
- Migration output (drizzle migrate in CI).
- Accessibility check (axe) output.

## Before you start
Read `PRD-v2.5.md` §1A, §6, §7, §10 (Harvest Lead supplies the file; commit it as `docs/prd/PRD-v2.5.md`). Where it says Stripe or "evaluate auth", this brief wins: Dodo, Better Auth.

## Report back
PR URLs, branches, commit SHAs, CI status, screenshot paths, test summaries, deviations, open questions, anything blocked. Explicit statement: **nothing merged, nothing deployed.** Report to Harvest Lead only.
