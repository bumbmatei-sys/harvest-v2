# AC8 / public-release follow-ups after CRM-04

Status snapshot: 2026-11-06. **Public release is not approved by this document.**
AC8 means product-owner sign-off on actual task completion, as defined in
[PR 01 acceptance criterion 8](../pr01-brief.md#acceptance-criteria-map-to-prd-10-dod)
and [PRD v2.5 §10 item 8](../prd/PRD-v2.5.md#10-engineering-and-product-definition-of-done).
It is not the companion's launch scenario 8 (Outreach), nor a test-count gate.

`done` means the stated bounded scope has evidence. `deferred` means planned
work not implemented/verified; a launch prerequisite remains a gate even when
development deferral is approved. `blocked` means approval/configuration or
release evidence is missing. Roles below are proposed accountable owners, not
assignments or notifications.

## Evidence boundary

- **E1:** `/workspace/harvest-v2/exit-gate/RESULT.md`, **Gate outcomes**, **Mail
  safety and final usability**, **Corrections and verification limits**.
- **E2:** `/workspace/harvest-v2/exit-gate/STORAGE-RESULT.md`, **Limits and
  corrected harness attempts**, **Evidence**; supporting files include
  `storage-checks.json`, `storage-sql.json`, `storage-mail-safety.json`,
  `storage-session-cleanup.json`, `storage-bucket-safety-final.json`.
- Both reports describe the 2026-11-05 isolated staging gate at application SHA
  `8bf5644b8da851f242f56a158f6764129638b9ef`. They were read, not rerun. These
  absolute paths are local evidence pointers, not GitHub-hosted artifacts;
  obtain them from the exit-gate handoff when reviewing outside the workspace.
  Reports note a historical copy-location limitation; this PR relies on the
  supplied report contents and does not claim to reconcile every artifact copy.
- This follow-up starts from main `4b97e4007b28792d04259b7669593192a0b37178`
  after [CRM-04 #13](https://github.com/bumbmatei-sys/harvest-v2/pull/13).
  The older gate does not validate subsequent changes. The merged
  [jobs/webhooks #7](https://github.com/bumbmatei-sys/harvest-v2/pull/7),
  [drain fix #9](https://github.com/bumbmatei-sys/harvest-v2/pull/9),
  [CRM-03 #10](https://github.com/bumbmatei-sys/harvest-v2/pull/10) and
  [release follow-ups #12](https://github.com/bumbmatei-sys/harvest-v2/pull/12)
  supply bounded implementation/documentation evidence below, not current live
  staging or product-owner approval. Review follow-ups supplied in the handoff
  are checked against the linked source/tests; no missing review artifact is
  presented as a fresh verification result.

## Public-release checklist

| Item | Status | Evidence / remaining acceptance | Proposed owner / due |
| --- | --- | --- | --- |
| Historical Phase 1 staging deployment, two-tenant UI/API/SQL isolation and persistence | **done** for the tested SHA/surfaces | E1 **Gate outcomes**; RLS as non-owner `harvest_app`, two real safe-mail identities, independent same-SHA redeploy. Not a current-head/public-release sign-off. | Engineering; preserve evidence. |
| Historical private file-object and signed-grant isolation; public quarantine | **done** for the tested SHA | E2; exact-byte downloads, conditional PUT replay rejection, tenant denials and persistence. 60-second download URLs are bearer grants, not session-bound. No working public delivery or malware protection was proved. | Engineering; preserve evidence. |
| Real malware scanner | **deferred**, mandatory before beta/launch | [PRD §11.-04a](../prd/PRD-v2.7-companion.md), E2: `skipped`; private scan flag false, public files quarantined. [Spike](../research/malware-scanner-spike.md) recommends managed EU attachmentAV, pending approval, adapter/async worker implementation and contract tests. Set private-scan policy, handle existing files and record real clean/infected/isolation results before closure. | Engineering + product owner; beta/launch gate. |
| Narrower R2 provider credentials | **deferred**, public-release prerequisite | E2 **Credential scope**: existing `R2_DEV` has broader access. [Policy draft](../setup/r2-staging-credential-scope.md) limits Object Read & Write to `harvest-v2-staging`, with no account/bucket-admin grant. Later authorized token/secret cutover and redacted scope/compatibility proof required; no rotation in this PR. | Storage operator; before external release. |
| Persistent sign-in email configuration | **blocked** on approved release configuration and delivery proof | E1/E2: successful test delivery only on temporary deployments; final `RESEND_API_KEY` absent, fresh OTP requests intentionally fail, test sessions invalidated. [Email setup](../setup/email.md) describes the adapter. Approve sender on the existing verified domain, scope the provider credential, configure only an authorized target and separately authorize delivery verification. A rendering sign-in page is insufficient. | Product owner + mail operator; before inviting users. |
| Scheduled worker, external-effect contract and monitoring | **deferred** | E1 proves a local operator drain, not continuous hosting. [Jobs setup](../setup/jobs.md) and [#9](https://github.com/bumbmatei-sys/harvest-v2/pull/9) cover database-only handlers, fenced retries/DLQ/replay and dispatch isolation. Continuous scheduling, external-I/O fencing, operator visibility/alerts and a provider runbook still need release evidence. | Engineering/operations; before real async effects. |
| File abuse controls and storage lifecycle | **deferred** | [Storage setup](../setup/storage.md#processing-and-malware-checks) explicitly defers workspace/upload quotas, rate controls, orphan/abandoned-intent cleanup, deletion, retention and quarantine tools. Define policy and verify tenant-safe cleanup/review before exposing uploads broadly. | Engineering + privacy owner; before public uploads. |
| Release-candidate regression and human acceptance | **blocked** on a selected release SHA and human evidence | [Companion universal gates](../prd/PRD-v2.7-companion.md#universal-acceptance-gates) require external unassisted use and cross-tenant/provider coverage. E1/E2 are historical. [PR 01b](pr01b.md) and [round 2](pr01b-round2.md) retain owner visual/task review. Run the authorized candidate's CI and applicable two-tenant E2E later; capture human workflow/visual acceptance, including Studio white-card decision. No gate rerun in this task. | Engineering + external pilot + product owner; release candidate. |
| Operational recovery, privacy and data handling | **deferred** | Companion §1 **Observability/Privacy**, §25 **Neon operating assumptions**, §27 **Privacy, security and safety**, and [jobs operational limits](../setup/jobs.md#validation-and-operational-limits) require alerting, backup/recovery drills, purpose-specific consent, sensitive-data review, event retention/export/erasure and connection revocation. Consent/contact erasure has bounded [acceptance evidence](pr01b-followups.md); that does not prove file/job/provider lifecycle or a recovery drill. Define owners and record release-specific evidence. | Operations + privacy owner; before public handling of those data. |
| Published-content abuse and provider-specific safety | **deferred** to the relevant public module | Companion §27 requires moderation/reporting, abuse handling, copyright/provider-terms review, media-import SSRF controls and AI/provider data safeguards where those features ship. Record acceptance with each public slice; the private-file gate does not cover them. | Product + engineering; before exposing each affected feature. |
| Release dependency/license review | **blocked** on release-candidate review | [PRD v2.5 §7](../prd/PRD-v2.5.md) calls license review a release gate. Existing [UI sources](../ui-sources.md) and [license inventory](../third-party-licenses.md) are evidence, not current-candidate approval. Reconcile the chosen scanner/SDK/service terms and pinned dependencies before release; this spike adds no dependency. | Maintainer; release candidate. |
| AC8 product-owner approval | **blocked**; not supplied by this docs/spike | PR 01 AC8 and PRD v2.5 §10. Record explicit owner acceptance of actual release workflows, the selected SHA, evidence links and accepted remaining scope after prerequisites above are met. The draft PR and historical PASS do not substitute for that decision. | Product owner; final release gate. |

## Parked review follow-ups (#7 / #9 / #10 / #12 / #13)

These statuses apply to the precise scope in each row. A deferred safeguard is
still a release gate for the surface that needs it; documentation does not close it.

| Item | Status | Evidence / remaining acceptance | Proposed owner / due |
| --- | --- | --- | --- |
| #7 jobs/webhooks retention, export and erasure | **deferred** | [Jobs operational limits](../setup/jobs.md#validation-and-operational-limits) explicitly leave this policy open. Raw webhook audit is immutable, and dedupe keys persist; [jobs integration tests](../../tests/integration/jobs.test.ts) cover immutability, not privacy cleanup. Define tenant-safe retention/export/erasure, reconcile audit and dedupe requirements, then test cleanup before real provider/personal payloads. | Privacy + engineering; before real provider rollout. |
| #7 synthetic webhook production guard | **deferred** | [readSyntheticConnections](../../src/server/webhooks/synthetic.ts) disables the receiver without configuration but has no unconditional production-environment refusal. [Receiver](../../src/server/webhooks/receiver.ts) verifies configured capabilities; that is not proof of a production guard. Decide and test explicit production disablement before rollout; keep synthetic configuration local/test. | Engineering/security; before production provider rollout. |
| #7 Phase 2 system/worker identity | **deferred** | [Operator drain](../../src/server/jobs/service.ts) and [CLI](../../scripts/drain-jobs.ts) use the existing application role and asserted operator with owner/admin membership checks; [jobs setup](../setup/jobs.md#drain-retries-crashes-and-replay) documents the trusted CLI boundary. No unattended system principal or scheduler identity is implemented. Define scoped tenant authority, revocation and actor/audit semantics in Phase 2. | Engineering/operations; before unattended workers. |
| #9 reserved outbox/webhook prefix normalization | **deferred** for variants; exact lowercase reservation **done** | [enqueueJob](../../src/server/jobs/outbox.ts) rejects exact `outbox:` / `webhook:` prefixes, covered by [jobs integration tests](../../tests/integration/jobs.test.ts); [#9](https://github.com/bumbmatei-sys/harvest-v2/pull/9) also covers dispatch savepoints and drain continuation. The check is case-sensitive on raw input; [jobInput](../../src/server/jobs/primitives.ts) does not normalize keys. Define handling of whitespace/case variants (for example ` OUTBOX:` / `Webhook:`) and test before adding producers; no variant rejection claim is made. | Engineering; before new producer integration. |
| #10 shared-view edit ACL | **blocked — product decision needed** | [ADR 0008](../decisions/0008-crm-fields-and-views.md) and [saved-view integration tests](../../tests/integration/crm-fields-views.test.ts) permit another writable member to edit a shared view; viewer edits are denied. Decide whether shared views remain collaboratively writable or become creator/admin-managed. Record the decision before changing policies/service/UI; this pass changes no ACL. | Product owner + engineering; before approving shared-view semantics. |
| #10 validateFilter operand whitelist unit coverage | **deferred** for complete matrix; bounded coverage **done** | [Unit tests](../../tests/unit/crm-fields.test.ts) reject number `contains`, malformed values, unknown/archived fields and cover built-in views; [integration tests](../../tests/integration/crm-fields-views.test.ts) exercise invalid operands and whole-state rejection. [validateFilter](../../src/lib/crm-fields.ts) checks `operandsByType`. An explicit positive/negative per-type operand matrix (including boolean and multi-select) is still absent; value-schema tests alone do not close this FU. | Engineering; next filter hardening pass. |
| #10 erasure filter scrub structure | **deferred** for structural matching; bounded scrub **done** | [Current erase_contact replacement](../../drizzle/0016_crm_pipelines_policies.sql) removes filters by a person's UUID substring in serialized filter JSON. [Erasure integration test](../../tests/integration/crm-fields-views.test.ts) proves relation-filter removal and preservation of an unrelated select filter. Structure-aware field/value matching and false-positive tests remain open; current substring matching can remove unrelated text filters containing that UUID. | Privacy + engineering; before broad saved-view privacy sign-off. |
| #13 keep database restore trigger | **done** for invariant; service-only mutation isolation **deferred** | Keep [0017 guard_opportunity](../../drizzle/0017_crm_deal_restore_guard.sql). [Concurrency tests](../../tests/integration/crm-deals-concurrency.test.ts) cover service 409 refusals, raw-SQL refusals and restore/archive races. The trigger also covers a removed service-only check: no mutation currently kills that service check alone while leaving the trigger intact. Add an isolated service-boundary test later; do not remove the database guard to make a mutation fail. Restore remains refusal 409, with no relocation. | Engineering; next service mutation-coverage pass. |
| #13 consistent stage/pipeline lock order | **done** for the reported inversion | [CRM service](../../src/server/crm-deals.ts), [ADR 0009](../decisions/0009-crm-pipelines-and-deals.md) and [controlled concurrency regression](../../tests/integration/crm-deals-concurrency.test.ts) use stage → pipeline, with ordered multi-stage locks and revalidation after concurrent inserts. [HTTP tests](../../tests/unit/http.test.ts) cover sanitized 409 for wrapped/direct deadlock and serialization conflicts. Exact validation results belong to this draft PR's head. | Engineering; preserve regression. |
| Company erasure | **deferred** | [ADR 0009 erasure](../decisions/0009-crm-pipelines-and-deals.md) covers person unlinking from retained deals; company deletion/erasure is not available. Define company data lifecycle and dependent-record behavior before adding it. | Privacy + product + engineering; future scoped work. |
| No CRM outbox producers | **done** as a scope boundary; future producers **deferred** | [ADR 0009 activity](../decisions/0009-crm-pipelines-and-deals.md) and [CRM service](../../src/server/crm-deals.ts) use the audit ledger only. No CRM outbox producer is added by this pass. Producer semantics and the prefix/privacy/worker prerequisites above need separate approval and work. | Engineering; preserve boundary. |
| #12 current-candidate two-tenant staging live RLS | **blocked** on authorized staging evidence | E1/E2 remain historical at `8bf5644`; [#12](https://github.com/bumbmatei-sys/harvest-v2/pull/12) does not approve a later candidate. Local non-owner RLS tests and Neon CI migrations do not prove current live UI/API/SQL isolation. Run the selected candidate with two real safe-mail identities and the runtime role when separately authorized; attach same-SHA persistence and denial evidence. Scanner, narrower R2 credentials and persistent sign-in mail remain owner gates above. | Engineering + product owner; release candidate. |

Later modules retain their own release gates. Companion §29 preserves F0 →
F1 → F2 → F3 → F4; §28's social publishing, bio, AI, outreach, mail/calendar,
connected files and commerce journeys are **deferred to their planned slices**,
not silently counted as Phase 1 completion. Hide unfinished surfaces per §2.
This checklist does not reopen CRM work or require implementing later releases
as part of this follow-up.

## Validation and scope of this follow-up

The [Foundation CI workflow](../../.github/workflows/ci.yml) runs Neon migrations
on every PR and on main. The former draft-branch exemptions are obsolete and
have been removed. This job creates and deletes an isolated hosted CI branch;
it does not deploy the application or mutate production data. Local PostgreSQL
migration/RLS, lint, typecheck, unit, build and browser jobs remain enabled.
No CI deployment job is added. Validation results and exact head SHA are
recorded in the draft PR body; CI status is a snapshot, not release approval.

Local verification covers lint, typecheck, unit, disposable PostgreSQL migrations/RLS,
Drizzle check/generate, build and CRM-03/CRM-04 Playwright. The standalone Neon
RLS suite is skipped without credentials. Results and head SHA are recorded in
the draft PR; this document is not a claim that every command has already passed.

No staging gate rerun, production access, deployment, merge, outbound email,
secret update, manual cloud provisioning/deletion, scanner purchase, credential
rotation, shared-view ACL change, CRM outbox producer, CRM-05, CSV, Social Studio
or new product feature is part of this work.
