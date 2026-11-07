# HC-03 closeout — 2026-11-07

PR: [#29](https://github.com/bumbmatei-sys/harvest-v2/pull/29), base `ec7ab89`. Reviewed implementation head: `fa0c29462009fad5bb4be1bb533d8a3c2450c7ca`; this closeout adds the delta described below. The final delivery SHA and CI readback belong in the PR body to avoid a self-referencing commit. No merge or deploy authorization is implied.

## Independent technical review

A separate fresh reviewer examined the complete implementation against `origin/main`, including migration/upgrade and FORCE RLS, public resolver allowlist, lifecycle permissions/revocation/concurrency, QR/export safety and API/UI boundaries. [Independent report](hc-03-independent.md): **MERGE-OK for bounded HC-03 technical scope; no blockers**. Reviewer independently executed 15 focused unit tests in three files. Parent runtime/visual checks are recorded separately below.

The reviewer found a P3 display defect: archive retires the current code but is not a rotation. The card now displays `codeGeneration - 1`, not the registry's retired-code count. The existing browser lifecycle asserts that one rotation followed by archive still displays “Rotated once”. The fresh reviewer inspected and accepted this delta separately. No migration, grants, schema, dependencies or collection behavior changed during closeout.

## Reconciled audit findings

1. `CLAUDE.md` now records CRM-08 and HC-02 as merged, HC-03 as draft, PR #16 as parked, and the live-head/migration rules. Current-state notices distinguish older HC-01/HC-04 evidence from today's implementation in the slice plan, ADR and acceptance/presentation records.
2. Review evidence is bound to `fa0c294` plus the independently reviewed display/test/docs delta. The PR description is reconciled at delivery, replacing the obsolete active review-head reference while retaining historical evidence in acceptance records.
3. [Activation decision register](../decisions/hc-02-activation-gates.md) makes the five outstanding HC-02 decisions, owners and required evidence explicit. **All remain UNAPPROVED.** Resolving documentation drift does not invent product, legal or security approval. Real-data HC-05/HC-07 activation remains blocked on actual decisions and implementation evidence.

Craft is reconciled at delivery to show HC-03 as open/reviewed, not “not started” or merged. CW-02+, parked switcher and unrelated CRM follow-ups are outside this change.

## Checks executed in this closeout session

| Check | Result |
| --- | --- |
| Full unit suite | 252 tests, 20 files passed |
| Focused integration: HC-02/03, campaigns, restricted migration/definer owner | 57 tests, 8 files passed; zero skipped |
| Actual restricted-owner fresh/populated upgrade and replay | Both cases passed, included above; also run separately |
| Lint and typecheck | Passed |
| Production webpack build | Passed; generated Next type-path and unrelated offline CSS changes restored |
| Browser lifecycle (including corrected archive count) | 1 passed, 12 clean axe scans, zero retries |
| Responsive mobile/tablet × light/dark | 4 passed, 40 clean axe scans, zero retries; 168 control measurements ≥44×44px |
| Personal visual assessment | All 40 responsive captures inspected; no visual blocker |

Tests use disposable local embedded PostgreSQL 18.6 and synthetic fixtures only. No live Neon, R2, production data or delivery provider was used. Browser tests run separately from database suites. The local browser is Debian Chromium 156.0.8078.79, selected through temporary Playwright executable symlinks; no repository browser configuration changed. The Playwright CDN download was denied by environment policy. An initial browser launch with the wrong executable symlink did not run a test; it was corrected before validation. The first sandboxed unit attempt hit tsx IPC EPERM; the full suite passed outside that socket-restricted sandbox. Early redirected test invocations did not produce complete result summaries and are not counted as evidence.

## Visual acceptance

[Persistent screenshot index](../screenshots/connect/hc-03/closeout/README.md): all 40 additional PNGs and four metrics JSONs are now committed with the closeout, replacing the local-only evidence gap. Inspected owner/member lower controls and create/publish/rotate/archive dialog tops/footers in both schemes at 390×844 and 768×1024. Labels wrap legibly, controls and focus outlines remain visible, and no horizontal clipping was observed. The tall mobile create dialog scrolls; its footer remains keyboard reachable and visible in the paired capture. Desktop live/admin publish views from the separately rerun lifecycle were also inspected. This completes the parent screenshot assessment, not physical-device or founder product approval.

## Boundaries

All five HC-02 decisions and wider legal/privacy/safeguarding/content launch gates remain unapproved. No real guest collection, outbound delivery, publication of a real campaign, deployment or merge was performed. Hosted PostgreSQL 17/Neon populated restricted-owner upgrade has not been independently rerun here; the existing exact-head CI evidence includes Neon migration success, not proof of that populated scenario. Physical camera/print tests are not claimed.
