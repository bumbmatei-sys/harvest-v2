# HC-06B1–B3 — Verified claims and durable response rights

Implementation date: 10 November 2026. Combined slice approved by the founder in this task. Based on merged HC-06A / PR #45 (`8417365`). This record does not authorize merge, production migration, intake, invitation delivery or deployment.

## Delivered behavior

- New immutable `connect-intake-v3` notices explain automatic organizer CRM contact creation after the existing affirmative verified claim. New invitation forms use v3; editing an existing v2 form preserves its preset. Published v1/v2 notices and responses retain their original no-association behavior, with no backfill or extra CRM approval prompt.
- The trusted service locks the live verified account and computes recipient proof from that exact email. One transaction creates the claim, creates/reuses a canonical tenant contact, consumes the grant, records Connect acquisition, projects only effective explicit newsletter/follow-up choices, binds durable subject rights, and records bounded completion. Existing names/identifiers are preserved. Submitted preferred name is opened only in the restricted server service.
- Account-only claims create/reuse a contact without granting messaging, membership, enrollment or religious classification. Association never invokes CRM merge. Same-flow replay returns generic success; conflicting concurrent work retries whole transactions at most three times. v3 continuation and completion expire at the original, capped ten-minute deadline.
- Minimal Connect source history reuses HC-06A and existing People layouts. Owner/admin capability checks protect source names, kind, route and immutable form version. No response answers, tokens or arbitrary payloads enter source history, AI tools or webhook payloads. Expired source evidence is hidden before cleanup.
- `/connect/rights` reuses PublicFrame and shadcn controls. A live verified subject sees only their response-scoped organizer/campaign summaries and user-bound opaque handles. Existing receipt rights also work after association. POST mutations are same-origin, bounded JSON, no-store/no-referrer, session-derived and generically acknowledged; quota refusal returns 429.
- Withdrawal propagates to the exact canonical purpose/channel and respects occurred/recorded-clock precedence. Response erasure redacts projected evidence, removes bindings/sources/origins/continuations/outcomes and preserves independent CRM contacts/accounts. A minimal unlinked canonical withdrawal retains only contact/channel/purpose suppression and original clocks, with no response/form/notice linkage, so erasure cannot revive stale grants. This is not a global Do not contact feature or a production retention-policy approval.
- Explicit CRM merge moves associated responses and distinct origins before source-contact erasure. Canonical contact erasure scrubs all linked evidence, including previously redacted projections. Account deletion removes user capabilities without deleting an independent organizer contact. Bounded retention cleanup includes associated responses.

## Persistence and concurrency

Migration `0032_hc06b_association_foundation` is additive. New tables FORCE RLS and deny application table access; private writers use fixed search paths and scoped capability functions. Tenant-composite foreign keys, cross-table provenance guards and deferred commit-time origin enforcement reject forged mappings. Migration/schema metadata show no Drizzle drift.

Claim order: live user → receipt advisory lock → source parents → response → invitation/claim → contact/consent. Contact acquisition/redaction uses NOWAIT across inverse contact→response merge/erasure paths; retries release the entire transaction. Identity/source/expiry checks rerun after waits. Subject operations hold the live user lock throughout capability use. Completion replay is session-bound and cannot authorize a new association.

## Validation provenance

All runtime/browser evidence below is author-executed. Independent source review is recorded separately; it is not independent runtime or visual verification.

- Full unit/integration suite: **728 tests across 72 files passed** before final narrow expiry/HTTP checks.
- Final targeted HTTP, source guard, v3 lifecycle, actual restricted-owner fresh/populated upgrade/replay and HC-02 compatibility suites: **60 tests passed**.
- Real two-connection races cover parallel confirmation, source disablement during receipt contention, user verification locks and membership-lock expiry. Other scenarios cover stale-grant suppression, response/contact/account erasure, exact original clocks, no-membership guests, truthful quotas, replay and independent purposes.
- Targeted browser journey: light/dark submit → verified claim → organizer source → rights withdrawal/erasure passed; axe and viewport checks passed on mobile/tablet/desktop. Full regression suite and expanded responsive matrix are being finalized.
- TypeScript, ESLint and Drizzle snapshot checks passed. Production build passed in an isolated source copy to avoid competing with the browser suite’s dev output. Hosted exact-head checks are being finalized.

## Remaining release gates

All five HC activation decisions remain unapproved. Production intake and real invitation transport remain hard-disabled. HC-06C source/permission segmentation, HC-08 full onboarding and HC-13 case lifecycle remain separate. No merge or deployment is authorized.
