# Harvest Connect implementation slices

## Current-state reconciliation — 2026-11-07

The HC-01/HC-04 baseline and evidence below are historical, not a current implementation checklist. CRM-01–08 foundation, CW-01 campaigns and HC-02 are now merged (PRs #25, #22 and #28 include migrations 0025–0026). HC-03 is open as draft PR #29 with migration 0027: QR lifecycle administration and a published-only database resolver. It is not merged or deployed. See [HC-02 acceptance](../acceptance/hc-02.md), [HC-03 acceptance](../acceptance/hc-03.md) and [closeout review](../reviews/hc-03-closeout.md). Follow the live GitHub head/checks, not historical migration reservations or statements that CRM-05 is unmerged.

HC-05 intake, HC-06/07 verified claims/CRM association and later Communities/follow-up remain future work. The [five activation decisions](../decisions/hc-02-activation-gates.md) remain unapproved; technical review is not collection or launch approval. Historical review checkboxes record the scope of their original slice only.

Historical HC-01 baseline: 2026-11-06; the original proposal below contained no HC-02+ implementation. Current status is in the reconciliation above.

Source of truth: [Connect PRD](harvest-connect-qr-to-discipleship.md), especially §§15–19. Architecture: [ADR 0011](../decisions/0011-harvest-connect.md). Privacy: [threat model and inventory](../security/harvest-connect-threat-model.md). Evidence: [acceptance](../acceptance/harvest-connect.md).

The HC-01–HC-20 IDs, scope and acceptance intent below preserve PRD §15 and the existing Craft church-features organization. Dependencies and module mappings are HC-01 planning annotations, not new Craft tickets or a replacement roadmap. Craft is not edited by this PR; no live Craft reconciliation is claimed. HC-FIN slices in PRD §21 remain a separate finance workstream and are not renumbered into HC-01–HC-20.

## Start and dependency rules

**Next recommended after CRM-05 merge: HC-02 migrations, after reconciling the final CRM tip and migration journal; then HC-03 QR admin.** Do not branch implementation from Claude's `feat/crm-05-tasks-activity` or reserve its migration numbers. [CRM-05 #15](https://github.com/bumbmatei-sys/harvest-v2/pull/15) is draft/unmerged at the HC-01 baseline (`e5d9752`); neither its implementation nor its B1 erasure fix is signed off here.

For the requested **can-start-before-CRM-done?** column, “CRM done” means the current prerequisite: CRM-05+ identity/consent/erasure integration merged and verified. It does **not** mean waiting for every future CRM feature. No HC slice requires CRM-06 CSV/import/export/merge or CRM-07 sync to finish. **Yes** permits work on the stated independent slice after its other dependencies; **No** means it waits for that current CRM gate, directly or transitively. This is dependency analysis, not authorization to implement HC-02+ in HC-01.

Campaigns, Forms, Communities, Courses and church directory are canonical module dependencies, not assumed delivered. Settle their minimal contracts before a dependent slice; never create duplicate canonical entities to bypass a dependency. HC-04's public-resource presentation can start independently; production QR integration still needs HC-03. HC-09/10 and HC-17 can use their own module prerequisites without response-to-CRM access.

## Slice index from PRD §15

| Slice and PRD scope | Depends on | Can-start-before-CRM-done? | Primary modules touched | Done when |
| --- | --- | --- | --- | --- |
| **HC-01 — This PR:** architecture, privacy threat model, processing inventory | Merged PRD §15; existing CRM/auth/tenancy contracts | Yes | Documentation; CRM/Campaigns/Forms/Communities integration contracts | ADR, threats and J1–J8 inventory reviewed for consistency; pending signoffs and decisions explicitly listed |
| HC-02 — Tenant migrations, unique constraints, RLS/access tests | HC-01; merged/verified CRM-05+ tip; canonical Campaigns/Forms contracts | No | Drizzle, CRM consent/erasure, tenancy, Campaigns/Forms | Tenant-composite references, uniqueness, minimal scrub hooks and fresh/upgrade tests fail closed across tenants |
| HC-03 — Campaign QR admin, publish/disable/rotate, short URL | HC-02; Campaigns/events and publishing permissions | No | Campaign admin, QR/source resolver, permissions | Organizer can preview/download, publish, rotate and revoke an owned QR/short URL |
| HC-04 — Mobile public landing and starter resources | HC-01; approved public resources and campaign/locale contract; HC-03 for QR integration | Yes | Public Campaigns/Forms presentation, resources, localization | Guest resource path works without identification and passes low-bandwidth/mobile checks |
| HC-05 — Minimal response forms, separate purposes, consent records | HC-02, HC-04; published Forms/notice contract and reviewed intake policy | No | Forms, restricted pending responses, CRM consent, outbox | No implied opt-in; validated versioned evidence and idempotent submission with scrub/cancel hooks |
| HC-06 — CRM association and contact dedupe under verified identity | HC-05; merged/verified CRM-05+ identity/erasure; HC-07 verified claim | No | Canonical CRM contacts/identifiers/consent, response association, case uniqueness | Verified authorized claim associates once; retries create no duplicate contact or intended case |
| HC-07 — Invitations, one-use claim, existing-account handling | HC-02, HC-05; existing auth, verified delivery and notifications contract | No | Auth/claims, jobs/outbox, notifications/provider adapter | Replay/expiry/anti-enumeration pass; verification yields an authorized claim for HC-06 without enrollment |
| HC-08 — Free-account onboarding and privacy preferences | HC-07; HC-06 for linked-response completion | No | Free identity/profile, purpose preferences, onboarding | Account activates and preferences work while choosing no community |
| HC-09 — Discoverability schema, moderation, directory listing | HC-01; canonical Communities identity/admission and moderation baseline | Yes | Communities schema, directory publication/moderation | Only approved, owner-discoverable eligible public/free entries are returned |
| HC-10 — Filters/search, recommendation labels and cards | HC-09; reviewed taxonomy/locales | Yes | Community discovery/search, directory UI | Responsive accessible filters work and organizer suggestions are clearly optional |
| HC-11 — Explicit join, approval, leave/notification settings | HC-08, HC-09; canonical membership/admission and notification preferences | No | Communities memberships/roles, auth, notifications | Explicit join/request/leave works with authorization and cross-community isolation tests |
| HC-12 — Community welcome and beginner course entry | HC-11; approved resources and Community/Courses entry contract | No | Communities welcome, Courses/resources | New member sees only the chosen community journey and can access starter content |
| HC-13 — Follow-up request, lifecycle and counselor assignment | HC-05, HC-06; screened staff and case/assignment policy | No | Restricted cases, campaign operations, CRM operational links, notifications | Request creates a scoped case; guarded states and assignment access/reassignment tests pass |
| HC-14 — Withdrawal, queued-message cancellation, DSAR hooks | HC-05–HC-08, HC-11, HC-13 and their initial scrub hooks; extend to HC-18–HC-20 as added | No | CRM erasure/consent, cases, memberships, jobs/outbox, rights handling | Revocation/erasure propagates across rows, queued/retried/replayed work and authorized recipients |
| HC-15 — Aggregate campaign metrics and privacy-safe funnel | HC-03–HC-08, HC-11, HC-13–HC-14; reviewed aggregation policy | No | Campaign analytics/rollups, operational dashboards | Manager sees aggregate funnel/readiness with cohort suppression and no personal religious details |
| HC-16 — Crowd/load tests, security review, release readiness | HC-02–HC-15; legal/privacy/security/safeguarding decisions and PRD §16 evidence | No | QA, abuse/performance, monitoring/runbooks, cross-module release gate | Applicable launch gates pass with evidence and actual signoffs; pilot is not labeled a full launch |
| HC-17 — Verified church directory/location search (P1) | HC-01; canonical Church Directory verification/moderation and location policy | Yes | Church profiles/directory, map/search | Only eligible verified churches appear; device location is unused without permission |
| HC-18 — User-authorized referral and liaison inbox (P1) | HC-13–HC-14, HC-17; recipient agreements and disclosure scope policy | No | Cases/referrals, Church Directory, recipient grants, notifications | Only selected approved church gets explicitly authorized fields; revocation and onward-sharing denial pass |
| HC-19 — Staff-assisted mobile intake (P1) | HC-05–HC-07, HC-13–HC-14; screened staff and device/session policy | No | Assisted Forms, staff permissions/audit, restricted intake | Staff captures affirmative choices under auditable expiring sessions without impersonating an account |
| HC-20 — Secure offline queue, sync and conflicts (P2) | HC-19; approved encryption, device revocation, retention and sync policy | No | Staff device/local queue, sync/idempotency, erasure/revocation | Duplicate/loss/conflict and lost-device scenarios pass; revoked/expired local data cannot sync |

HC-07 verifies and consumes the one-use claim; HC-06 performs the CRM association. Agree the handoff contract before either implementation, then integrate in that order: no circular runtime dependency or invitation-side unverified contact creation. HC-06's done-when includes case uniqueness, while HC-13 owns the case lifecycle and assignment behavior.

Dependencies do not defer basic privacy: each producer includes erasure/withdrawal hooks when introduced. HC-14 proves/completes cross-module propagation. Later P1/P2 slices extend those hooks and rerun applicable HC-16 gates; passing P0 does not sign off future referral/offline behavior.

## Pilot versus full release

PRD §17 permits campaign QR + public resources + optional response before full Communities. A pilot still needs real Campaigns/Forms boundaries, reviewed minimal purposes, response isolation/rights hooks and abuse controls. It must not offer a fake community handoff or claim the full QR-to-community journey is complete. HC-09–HC-12 and the rest of PRD §16 are required for full launch. HC-06 remains behind verified CRM identity/erasure and secure claims even if a restricted pilot response exists earlier.

## Founder review from PRD §18

Matei's HC-01 brief confirms the working name **Harvest Connect** and its role as Harvest's outreach organizer, integrated with CRM. The remaining §18 recommendations below are recorded for Matei's review, not silently adopted as founder answers. Mandatory privacy constraints in the PRD/brief continue to apply while wording and implementation decisions remain open.

| Decision still requiring review | PRD §18 recommended default / constraint | Status |
| --- | --- | --- |
| Guest starter resource access | Always available without signup | Matei review pending; required privacy baseline |
| Free community account requirement | Account to join/post; public previews may be browsed as guest | Matei review pending |
| Default QR result | Welcome and three next steps, without a compulsory form | Matei review pending |
| First featured community | Organizing ministry, labeled and optional | Matei review pending |
| Newsletter consent | Separate opt-in, unchecked | Matei review pending; required privacy baseline |
| Pastoral contact request | Separate opt-in, unchecked | Matei review pending; required privacy baseline |
| Partner-church referral | Person selects church and approves recipient-specific disclosure | Matei review pending; required privacy baseline |
| Geolocation | Optional search or explicit device permission only | Matei review pending; required privacy baseline |
| Response classification / decision counts | Only safeguarded, lawfully collected aggregate self-reports; never inferred | Matei and legal/privacy review pending |
| Discoverable free communities | Owner opt-in plus moderation/safety eligibility | Matei review pending; eligibility criteria unresolved |
| Mass-crusade fallback | Short URL, paper/counselor-assisted intake and safe low-bandwidth resources | Matei review pending; assisted/offline controls remain prerequisites |
| AI use in counseling | Human-reviewed assistance only; no autonomous pastoral judgments | Matei review pending; required privacy baseline |
| Campaign fundraising architecture | Campaign Finance tab, separate from General Fundraising | Matei review pending; campaign scope required by brief |
| Money segregation | Ledger-level purpose/fund attribution with restricted-fund treatment | Matei and finance review pending |
| Donation solicitation on response page | Outside response form; optional contextual CTA disabled by default | Matei review pending; no finance implementation in HC-01 |

PRD §19's additional technical/policy questions and §21.10's finance questions remain unresolved unless repository evidence explicitly settles them. Existing Better Auth email OTP settles the current email-auth baseline, not phone claims, delivery/provider capability, controller roles, launch countries/ages/languages, sensitive fields, retention, church verification, licensed resources, offline devices or finance policy. The [threat-model review register](../security/harvest-connect-threat-model.md#pending-review-and-release-gates) tracks the legal/security owners; no signoff is inferred from a recommended default.
