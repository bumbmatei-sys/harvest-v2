# HC-05 readiness and decision brief

Date: 2026-11-07. Baseline: merged `main` at `b1da5a4` (HC-03 #29). **Planning only: no implementation or activation approved by this brief.**

Goal: make the optional response step ready to implement as one bounded PR. Resource access remains free and requires no identity. Sources: [Connect PRD J2 and §§5, 10–11](harvest-connect-qr-to-discipleship.md), [slice plan](harvest-connect-slices.md), [HC-02 acceptance](../acceptance/hc-02.md), [HC-03 acceptance](../acceptance/hc-03.md), [activation register](../decisions/hc-02-activation-gates.md).

## What exists and what is missing

| Exists on merged main | HC-05 still needs |
| --- | --- |
| Canonical campaigns; published QR/short links and resource landing | Optional public form and constrained submission path |
| Canonical Forms, immutable published versions/notices, offered purposes and explicit retention | Minimal approved preset/definition, notices and safe public projection; no general Forms builder |
| Restricted pending responses/contact methods and append-only purpose evidence | Narrow intake capability; no broad table grants or contact-reading API |
| Owner/admin withdrawal, erasure, expiry recheck and purge hooks | Usable guest rights procedure, scheduling/operational ownership and end-to-end intake/rights tests |
| Tenant-composite references, FORCE RLS, transactional audit/outbox primitives | Public abuse controls and idempotent submission under concurrency |

`src/lib/connect-public.ts` currently fixes `acceptsResponses: false`; `resolve_connect_link` returns only locale/public title. HC-05 must deliberately extend this boundary, not make private Forms or pending rows public. HC-03 link settings/form attachment are immutable after creation; any per-link form switch is an explicit HC-05 design item, not an assumed existing editor.

## Founder input and proposed field configuration

Matei selected **pastoral follow-up only** for the first HC-05 form in this session; account invitations and newsletters follow later. This selects product scope only: the wider purpose mapping, legal basis/notices and the other activation decisions remain unapproved.

Matei asked whether admins can choose form fields. **Yes: proposed HC-05 design is a small owner/admin settings panel over an approved preset.** It can enable permitted fields, set an optional preferred-name field and select supported contact channels within platform policy. Contact data is required only when necessary for the selected request/channel; switching fields cannot imply another purpose. The guest sees exactly the published immutable version and its notice. Changing fields creates/reviews/publishes a new version, never mutates submitted evidence. Define the narrow authorized link-attachment/switch operation explicitly because HC-03 link settings are currently immutable.

Admins cannot add arbitrary sensitive/free-text fields, collect birth date/address/religious classifications by default, require identity for resources, pre-check consent, bypass retention/access rules or enable an unsupported channel. The exact allowed field set/channel support remains to be agreed; a general drag-and-drop/conditional Forms builder stays outside this PR. Initial countries and age/minor policy have not been supplied.

## Five decisions: recommendation is not approval

All five remain **UNAPPROVED**. Record actual decisions in the activation register with date, approver and evidence.

| Gate | Recommended product/engineering direction | Matei can decide | Additional review required before real data |
| --- | --- | --- | --- |
| Purposes | Keep `account_communications`, `outreach_follow_up`, `newsletter` separate; all unchecked. Exclude church referral and religious-response classification | First-purpose scope selected: pastoral follow-up only; invitations/newsletters later. Broader mapping still needs review | Privacy/legal: bases, notices, controller/recipient roles and any sensitive-data conditions; a field name is not a legal basis |
| Pending access | Keep owner/admin-only metadata and rights operations; no general CRM/member/counselor access to addresses | Accept this product access boundary for HC-05 | Security/privacy: verify staff procedure, eligibility, live authorization and no disclosure through logs/search/exports |
| Erasure | Review the existing coarse tombstone rather than silently changing inherited erasure semantics | Choose retained tombstone or full deletion after review | Privacy/legal: small-cohort linkability, necessary retained fields and obligations; engineering: resulting erasure and replay tests |
| Retention | No invented duration. Agree launch-specific durations and a hard platform maximum, then enforce and purge | Name the launch context and accountable owner; approve a reviewed policy | Privacy/legal: durations and maximum; engineering: scheduled sweep, failure monitoring, expiry and restore behavior. Current `1..36500` is a technical bound, not policy |
| Contact protection | Recommend application-layer authenticated encryption for pending contact methods, with key management and no plaintext diagnostics | Endorse this engineering direction and operational ownership | Security: review encryption/normalization/lookup design, key access/rotation/recovery and erasure. If declined, require an explicit reviewed alternative; zero app grants alone are not a decision |

Inputs for review: initial countries, age/minor policy, launch languages, responsible controller/ministry and privacy contact, expected venue traffic, supported contact channels, and who can actually fulfill each offered purpose. English is the only implemented locale. The proposed admin field selector must offer only reviewed, supported channels; email/phone availability has not been chosen. Do not add a date-of-birth field to resolve the minors question by default.

## Proposed bounded HC-05 implementation PR

Proposed title: **HC-05: optional response intake and purpose-scoped consent evidence**. Recheck main, open PRs and the migration journal before allocating a migration; this brief reserves none.

| Boundary | Proposed acceptance |
| --- | --- |
| Public UX | QR/short URL → resources or optional form → honest pending receipt → resources. Preferred name optional; only the contact field required by the chosen supported purpose/channel. Separate unchecked opt-ins, accessible labels/errors, notice/privacy and rights links. Pastoral follow-up only; English first, light/dark/mobile/44px targets |
| Setup | Define a minimal owner/admin operational path to provision, review and publish the first approved preset and immutable notice/version using canonical Forms. Include the small owner/admin approved-field settings and narrow authenticated provisioning/publishing path needed by the first form, not a general builder. Synthetic fixture SQL is not a production setup path |
| Availability | Show a form only for an eligible published link, published immutable form/notice and nonarchived campaign, with current expiry/policy checks. Resource-only and static-preview paths keep working without identification; unavailable forms fall back safely |
| Public projection | Return only the reviewed preset, offered choices and notice/retention information needed by the guest; allowlist fields explicitly. Internal ownership is derived server-side from the code; never trust caller-supplied tenant, campaign, contact or form ownership |
| Intake | Strict size/schema/contact validation. Revalidate source/form/notice atomically at submission, including races with pause/rotation/expiry/retirement. Server-assigned time/retention and subject-origin evidence bind exactly to what was presented. No implied consent or grant for an unoffered purpose |
| Persistence | One authorized transaction for response, contact method and evidence plus any reviewed minimal audit/outbox writes; rollback all on failure. Preserve FORCE RLS and restricted grants. No contact, CRM consent, membership or case creation |
| Retry safety | Reuse the campaign-scoped submission key. Define same-request replay and changed-body conflict behavior; retries must not duplicate responses, evidence or future work. A key alone must not read/update another guest response or leak its existence. No email-based deduplication or identity association |
| Abuse | Bounded bodies, persistent multi-signal limits, honeypot and reviewed adaptive challenge policy. Account/contact enumeration stays indistinguishable. Validate crowd/shared-Wi-Fi behavior; IP alone cannot be the visitor identity. Set thresholds from launch/load evidence, not invented universal values |
| Rights | Define and review safe guest proof: a narrowly scoped withdrawal/erasure credential or verified staff procedure. A response ID or matching email alone is insufficient. Reuse the existing rights definers, allow purpose-specific withdrawal, and test erasure/purge plus durable-reference scrubbing. Guest rights never authorize an HC-07 identity claim. Existing definers require a live owner/admin tenant actor: guest proof needs a narrowly reviewed bridge/capability, not owner impersonation or broader grants |
| Events | Add only necessary versioned reference-only contracts, if needed for the agreed handoff, in the write transaction. No raw addresses, names, prayer text, religious categories or sensitive evidence in generic events/logs. No delivery handler or send in HC-05 |
| Activation | Keep real collection disabled until the five decisions, notices, guest-rights procedure, operational retention sweep and safe fulfillment plan are approved and implemented. A test fixture or application flag cannot stand in for those approvals |

Do not advertise that an invitation was sent, newsletter subscription activated or counselor assigned. HC-05 records pending intent only. A purpose must stay unavailable to real visitors until its downstream fulfillment path and accurate copy are ready; otherwise the confirmation would promise an outcome the product cannot provide.

The scheduled retention sweep also needs an explicit reviewed execution identity/capability: current purge hooks require a live owner/admin actor. Do not forge `app.user_id`, borrow owner credentials, or grant a general worker broad pending-table access. Define and test that operational bridge before real collection; a dormant purge function is not a running retention policy.

## Required evidence for that implementation PR

- Public-resource flow creates no personal rows; no checked choice means no submission/consent side effect.
- Two-tenant and forged-parent tests under `harvest_app`; public capability exposes no pending data and cannot bypass source publication or form/notice ownership.
- Concurrent identical retries yield one response; conflicting retries fail safely; failure/paused/expired/rotated/retired-source races leave no partial writes or delivery.
- Evidence binds to the presented immutable version; altered/retired/unoffered purpose input is denied and must prompt safe re-presentation rather than silent substitution.
- Withdrawal affects only its purpose; erasure and expiry stop eligible work and remove identifying durable payloads. Exercise guest and owner/admin rights, not just admin-seeded happy paths.
- Real Playwright guest journey through both link kinds, resources, form validation, retry and rights instructions; mobile/light/dark/keyboard/contrast and shared-Wi-Fi/abuse checks. Preserve screenshots and separate author results from fresh review evidence.
- Run repository checks appropriate to changed code/schema; document fresh/replay/populated restricted-owner migration evidence if a migration is needed. No production/provider tests without authorization.

## Sequence and exclusions

Current work: this brief and decisions. Then one scoped HC-05 PR with synthetic fixtures until activation prerequisites are satisfied. A separate fresh session reviews implementation. No merge/deploy without explicit founder approval.

HC-07 subsequently owns verified delivery and one-use identity claims; HC-06 consumes that verified claim for canonical tenant CRM association. HC-06 must also settle notice-ledger transfer, pending-method removal and merge-move before erasure. This order follows the dependency contract; it does not authorize a combined HC-05/06/07 PR. HC-08 onboarding and HC-13 counselor cases remain separate.

Excluded: real sends, phone verification, automatic CRM matching, newsletter delivery, religious classifications/free-text prayer notes, referral, Communities, finance, analytics, general Forms builder, CW-02+, assistant runtime and parked switcher #16.

## Planning review

A separate fresh review session checked this brief against HC-05/J2, the PRD and HC-02 boundaries: no blocking inconsistency or invented approval. Its two clarifications (first-form provisioning and narrowly authorized guest/purge execution) are included above. Documentation checks cover relative links, table shape and whitespace. No application tests, database/provider actions, migrations or implementation changes were needed or run for this planning-only change.

**Ready:** documented scope and existing foundations. **Blocked for activation:** actual decisions and required evidence above. **Next input:** Matei confirms the proposed allowed-field/channel choices and supplies launch context; privacy/legal/security reviewers resolve their assigned policy questions. No gate is checked off by publishing this planning brief.
