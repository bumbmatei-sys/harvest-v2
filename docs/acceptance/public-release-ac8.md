# AC8 / public-release follow-ups after the Phase 1 exit gate

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
- This docs branch starts from main `527f16bce5e81b5ec8bdf0806809ed804551e3f6`.
  The older gate does not validate all subsequent changes. CRM-03 (#10), the
  #9 drain implementation, #11 Company People and outbox producers are outside
  this task; no readiness claim about an unmerged PR is made here.

## Public-release checklist

| Item | Status | Evidence / remaining acceptance | Proposed owner / due |
| --- | --- | --- | --- |
| Historical Phase 1 staging deployment, two-tenant UI/API/SQL isolation and persistence | **done** for the tested SHA/surfaces | E1 **Gate outcomes**; RLS as non-owner `harvest_app`, two real safe-mail identities, independent same-SHA redeploy. Not a current-head/public-release sign-off. | Engineering; preserve evidence. |
| Historical private file-object and signed-grant isolation; public quarantine | **done** for the tested SHA | E2; exact-byte downloads, conditional PUT replay rejection, tenant denials and persistence. 60-second download URLs are bearer grants, not session-bound. No working public delivery or malware protection was proved. | Engineering; preserve evidence. |
| Real malware scanner | **deferred**, mandatory before beta/launch | [PRD §11.-04a](../prd/PRD-v2.7-companion.md), E2: `skipped`; private scan flag false, public files quarantined. [Spike](../research/malware-scanner-spike.md) recommends managed EU attachmentAV, pending approval, adapter/async worker implementation and contract tests. Set private-scan policy, handle existing files and record real clean/infected/isolation results before closure. | Engineering + product owner; beta/launch gate. |
| Narrower R2 provider credentials | **deferred**, public-release prerequisite | E2 **Credential scope**: existing `R2_DEV` has broader access. [Policy draft](../setup/r2-staging-credential-scope.md) limits Object Read & Write to `harvest-v2-staging`, with no account/bucket-admin grant. Later authorized token/secret cutover and redacted scope/compatibility proof required; no rotation in this PR. | Storage operator; before external release. |
| Persistent sign-in email configuration | **blocked** on approved release configuration and delivery proof | E1/E2: successful test delivery only on temporary deployments; final `RESEND_API_KEY` absent, fresh OTP requests intentionally fail, test sessions invalidated. [Email setup](../setup/email.md) describes the adapter. Approve sender on the existing verified domain, scope the provider credential, configure only an authorized target and separately authorize delivery verification. A rendering sign-in page is insufficient. | Product owner + mail operator; before inviting users. |
| Scheduled worker, external-effect contract, replay and monitoring | **deferred** | E1 proves a local operator drain, not continuous hosting. [Jobs setup](../setup/jobs.md) describes database-only handlers and future provider contracts. Implement scanner scheduling, external-I/O fencing, retry/DLQ visibility, queue-age alerts and a runbook in later work; leave #9/outbox producers untouched here. | Engineering/operations; before real async effects. |
| File abuse controls and storage lifecycle | **deferred** | [Storage setup](../setup/storage.md#processing-and-malware-checks) explicitly defers workspace/upload quotas, rate controls, orphan/abandoned-intent cleanup, deletion, retention and quarantine tools. Define policy and verify tenant-safe cleanup/review before exposing uploads broadly. | Engineering + privacy owner; before public uploads. |
| Release-candidate regression and human acceptance | **blocked** on a selected release SHA and human evidence | [Companion universal gates](../prd/PRD-v2.7-companion.md#universal-acceptance-gates) require external unassisted use and cross-tenant/provider coverage. E1/E2 are historical. [PR 01b](pr01b.md) and [round 2](pr01b-round2.md) retain owner visual/task review. Run the authorized candidate's CI and applicable two-tenant E2E later; capture human workflow/visual acceptance, including Studio white-card decision. No gate rerun in this task. | Engineering + external pilot + product owner; release candidate. |
| Operational recovery, privacy and data handling | **deferred** | Companion §1 **Observability/Privacy**, §25 **Neon operating assumptions**, §27 **Privacy, security and safety**, and [jobs operational limits](../setup/jobs.md#validation-and-operational-limits) require alerting, backup/recovery drills, purpose-specific consent, sensitive-data review, event retention/export/erasure and connection revocation. Consent/contact erasure has bounded [acceptance evidence](pr01b-followups.md); that does not prove file/job/provider lifecycle or a recovery drill. Define owners and record release-specific evidence. | Operations + privacy owner; before public handling of those data. |
| Published-content abuse and provider-specific safety | **deferred** to the relevant public module | Companion §27 requires moderation/reporting, abuse handling, copyright/provider-terms review, media-import SSRF controls and AI/provider data safeguards where those features ship. Record acceptance with each public slice; the private-file gate does not cover them. | Product + engineering; before exposing each affected feature. |
| Release dependency/license review | **blocked** on release-candidate review | [PRD v2.5 §7](../prd/PRD-v2.5.md) calls license review a release gate. Existing [UI sources](../ui-sources.md) and [license inventory](../third-party-licenses.md) are evidence, not current-candidate approval. Reconcile the chosen scanner/SDK/service terms and pinned dependencies before release; this spike adds no dependency. | Maintainer; release candidate. |
| AC8 product-owner approval | **blocked**; not supplied by this docs/spike | PR 01 AC8 and PRD v2.5 §10. Record explicit owner acceptance of actual release workflows, the selected SHA, evidence links and accepted remaining scope after prerequisites above are met. The draft PR and historical PASS do not substitute for that decision. | Product owner; final release gate. |

Later modules retain their own release gates. Companion §29 preserves F0 →
F1 → F2 → F3 → F4; §28's social publishing, bio, AI, outreach, mail/calendar,
connected files and commerce journeys are **deferred to their planned slices**,
not silently counted as Phase 1 completion. Hide unfinished surfaces per §2.
This checklist does not reopen CRM work or require implementing later releases
as part of this follow-up.

## Validation and scope of this PR

Documentation and one CI safety exemption only. The
[Foundation CI workflow](../../.github/workflows/ci.yml) excludes this exact
`docs/exit-gate-followups` branch from its Neon job, which otherwise creates
and deletes a hosted CI branch on every PR. Existing local PostgreSQL
migration/RLS, lint, typecheck, unit, build and browser jobs remain enabled.
No CI deployment job is added. Validation results and exact head SHA are
recorded in the draft PR body; CI status is a snapshot, not release approval.

No staging gate rerun, production access, deployment, merge, outbound email,
secret update, cloud provisioning/deletion, scanner purchase or app feature
change is part of this work.
