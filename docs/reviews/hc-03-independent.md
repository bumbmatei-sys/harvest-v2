# HC-03 independent technical review

Reviewed source head: `fa0c29462009fad5bb4be1bb533d8a3c2450c7ca`.
Base: `ec7ab892a79ae527c2c9bb4e3ff29202bf0e7c7c` (`origin/main` at review start).
Reviewer: separate Codex review session; no repository source edits, no provider access or outbound delivery.

## Verdict

**MERGE-OK for the technical HC-03 scope, with no blocking finding.** This is an exact-head technical review verdict, not deployment, data collection, visual acceptance, or founder merge approval. The P3 display defect below is safe to fix before final closeout; any such delta needs review and its relevant verification recorded against the resulting head.

## Findings

**P3 — archived links overstate rotation count.** `src/app/workspaces/[tenantId]/campaigns/[campaignId]/connect/page.tsx:64` renders `link.retiredCodes` as the number of rotations. `src/server/connect-links.ts:30` counts every retired QR code; `connect_link_transition` retires the current QR on archive as well as on rotate. Consequently an unrotated archived link says it rotated once. Render `link.codeGeneration - 1`, or subtract archive retirement explicitly, while retaining the registry history count as a distinct metric. This affects descriptive UI only, not code revocation or access.

## Reviewed

- Entire 0027 SQL migration and its ordering, plus existing HC-02 ownership/grant/parent contracts. The temporary `hc03_backfill` owner visibility is retained through FK validation and dropped within Drizzle's migration transaction; final policies remain scoped. 0026 is unchanged.
- Actual restricted-owner fresh/populated regression structure, separate non-BYPASSRLS definer-owner coverage, existing upgrade/tenant/lifecycle/concurrency/permission tests. Admin fixture writes are separated from app-role access assertions.
- Service and route permission checks, authenticated actor derivation, same-origin mutations, tenant and campaign ownership checks, parameterized SQL, allowlisted schemas, safe error responses and private export responses.
- Lifecycle locking and live membership rechecks; published form/nonarchived campaign requirements; no campaign-active requirement per founder decision; rotation compare-and-swap, registry uniqueness and revocation; archived terminality and expiry.
- Resolver exact-format validation and explicit code lookup, tenant derivation, narrow public column allowlist, context cleanup, uniform unavailable states, dynamic public routes and no persistent route cache, preserved DB-independent starter resources.
- QR entropy construction, independent decoder coverage for matrix and PNG/SVG/PDF, palettes/contrast/quiet zones, SVG escaping, PNG metadata bounds and PDF string/xref generation.
- Admin UI control gating, source data rendering, public title versus private campaign label, preview/presentation/export routes, responsive test methodology and documented deferrals.

## Independently executed here

`npx vitest run --project unit tests/unit/hc03-connect-qr.test.ts tests/unit/connect-public.test.ts tests/unit/migrations.test.ts`

Result: **15 tests, 3 files passed**, no failures (1.03 s). Includes QR/export decoding, lookup allowlist/source guard, and migration journal/snapshot assertions.

No database or browser suite ran in this reviewer session, to avoid competing with the parent's disposable-DB/browser verification. Their results must be recorded separately with provenance; prior handoff partial-review claims were treated as supporting context rather than an inherited verdict.

## Remaining gates and limits

Parent must finish its own visual assessment and current runtime checks, verify final branch head and CI, and obtain explicit founder merge approval. Hosted PostgreSQL/Neon populated restricted-owner upgrade was not independently repeated here. Existing green Neon CI is a fresh migration signal, not proof of that populated restricted-owner scenario on hosted PG17.

All five HC-02 activation decisions remain unapproved. HC-03 has no public intake, CRM association, invitations, membership, analytics writes or real delivery. Privacy/legal/security/safeguarding release decisions, real guest collection, production deployment, physical camera/print QA and later HC slices are not certified by this review.

## Closeout delta review

Separately reviewed the working-tree delta against `fa0c294` after the parent applied the P3 correction:

- Rotation display now uses `link.codeGeneration - 1`; the schema enforces generation >= 1 and only rotation increments it, so archive no longer inflates the displayed count.
- Existing real-browser lifecycle test now asserts the archived card still says "Rotated once" after one rotation followed by archive. This targets the concrete user-visible regression without duplicating implementation mechanics.
- `CLAUDE.md` reconciles merged CRM-08/HC-02 and open draft HC-03, preserves the workflow/approval rules, leaves PR #16 parked, and points to current evidence.
- Four historical Connect documents receive explicit current-state notices while preserving original dated evidence.
- New `docs/decisions/hc-02-activation-gates.md` preserves all five decisions as unapproved, separates current implementation from required decisions/evidence, and grants no collection, legal, security or deployment approval.

**Delta accepted; no new blocker.** The P3 finding is resolved by inspection. Parent reports independently rerunning 57 focused integration tests in 8 files (including actual restricted-owner fresh/populated/replay) and all 252 unit tests in 20 files, all passing. I did not rerun those suites. Browser lifecycle assertion and responsive/visual QA were still executing at delta-review time, so their final outcomes and the final commit SHA/CI must be recorded by the parent. The new referenced `docs/reviews/hc-03-closeout.md` was not present yet at this checkpoint; parent must add that planned closeout record and validate its links before commit.
