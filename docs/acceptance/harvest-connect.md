# Harvest Connect acceptance record

Date: 2026-11-06. Scope: **HC-01 only — organize and architecture**. Implementation/release acceptance stub for later HC slices; no application behavior is delivered here.

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

## Explicitly outside this PR

No app UI or feature code; no HC-02+ schema generated/applied beyond conceptual ADR naming; no CRM-06 or CRM-05 branch changes; no Eden switcher, Soft FU or Connect finance code. No secrets printed or committed; no production Neon/R2/Vercel actions, deployment, merge, main force-push, Cursor CloudAgent or outbound messages to people. Delivery stops at the draft PR.
