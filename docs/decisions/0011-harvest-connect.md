# ADR 0011: Harvest Connect as the outreach organizer

Date: 2026-11-06. Status: proposed for HC-01; product, legal/privacy and security review pending. This records architecture requirements, not implemented behavior or launch approval.

Source of truth: [Harvest Connect PRD v1.1](../prd/harvest-connect-qr-to-discipleship.md), merged in [PR #17](https://github.com/bumbmatei-sys/harvest-v2/pull/17) at `e5d9752`. Delivery plan: [HC-01–HC-20 slices](../prd/harvest-connect-slices.md). Privacy design: [threat model and processing inventory](../security/harvest-connect-threat-model.md). Evidence: [HC-01 acceptance](../acceptance/harvest-connect.md).

## Product and privacy spine

**Harvest Connect is Harvest's outreach organizer for churches and crusades: campaign QR → free resources → optional response, verified free identity, chosen community and requested follow-up, using Harvest's CRM.**

Resource access, response submission, account invitation/creation, community membership, pastoral contact, recipient-specific church referral and newsletter marketing are separate choices. Opt-ins start unchecked. A scan creates no contact, religious classification, subscription or membership. An invitation does not enroll its recipient. Partner churches never receive a shared crusade roster. Religious-response details never become public profile attributes or advertising audiences.

## Canonical modules and current baseline

The baseline is `origin/main` at `e5d9752`. [ADR 0003](0003-rls-tenancy.md) and the [companion PRD](../prd/PRD-v2.7-companion.md) require one authoritative CRM contact identity per workspace; a shared platform account is a different concept. Reuse the following owners rather than building Connect copies:

| Owner | Connect reuse and boundary | Baseline / dependency |
| --- | --- | --- |
| Campaigns and events | Campaign, night/venue, QR source, organizer settings and campaign dashboard | Canonical planned module; reconcile its contract before HC-02, never create a second campaign system |
| Forms | Published versioned response forms, approved presets, validation and notice text | Planned module; define the minimal reusable contract before response implementation |
| CRM | `contacts`, `contact_identifiers`, `contact_consents`, tenant dedupe and erasure | Present in [schema](../../src/db/schema.ts); association and erasure integration wait for CRM-05+ |
| Free authentication | Existing `users` and verified sessions; optional account claim and lifecycle | [Better Auth email OTP](0002-better-auth-email-code.md) exists; phone verification and Connect claim tokens are not delivered |
| Communities and courses | Approved directory, explicit membership/admission, welcome and beginner content | Planned dependencies; never emulate community membership with CRM tags or workspace membership |
| Notifications and jobs | Transactional invitations, assignment/status notices, suppression, retries and delivery idempotency | [Jobs/outbox primitives](../setup/jobs.md) exist; real Connect handlers, permission checks and provider delivery remain future work |
| Campaign budgets and finance | Campaign-designated drives, gifts, expenses and ledger rollups owned by campaign finance | Planned integration under PRD §21; campaign scope and independent finance permissions are mandatory |

The existing CRM consent ledger permits `marketing`, `outreach_follow_up`, `event_administration`, `account_communications` and legacy evidence. Its notice-version allowlist and lack of recipient-specific referral scope are not sufficient for all Connect purposes. HC-02 must reconcile extensions with that ledger and published Forms notices; do not silently map church sharing or sensitive-response permission to generic marketing. Unverified pending intake needs restricted, expiring evidence until HC-06 can associate it with a contact.

General Fundraising remains a separate experience. Shared payment infrastructure must preserve campaign/fund attribution; general gifts do not enter campaign totals without an authorized ledger transfer. Donor access and pastoral access are independent. A donation never implies a response or follow-up permission; donation solicitation is outside the response form. HC-01 names these boundaries only; no finance implementation is authorized.

## Association and authorization model

| Association | Meaning | What it must not grant |
| --- | --- | --- |
| Workspace → campaign → response source → response | Workspace owns campaign and published QR/form source; response is limited to its chosen purposes | Cross-workspace contacts, a partner-church roster or routine access to response details for every campaign role |
| Free identity → voluntary community membership | A verified `users` identity explicitly joins or requests admission to a community | A paying workspace, workspace staff privileges, access to origin responses or another community's memberships |
| Follow-up assignment → approved counselor / selected church | Current permission and assignment authorize minimal case fields; a church recipient also needs the person's specific referral authorization | Campaign-wide case access, onward sharing or marketing permission |

Repository tenant columns are `tenant_id`; PRD `workspace_id` names express the same ownership boundary, not a new tenant namespace. Campaign/source/contact references must use tenant-composite keys or verified parent ownership, with FORCE RLS and transaction-local context through the non-owner runtime role. Workspace RLS alone is insufficient: cases and referrals additionally enforce assignment/recipient scope. Public QR resolution exposes only published metadata and resources through a constrained public access path, never a privileged raw-table query.

Community participation across workspaces is permitted only through community authorization; it does not copy the account into every workspace's CRM. A selected referral transfers only its approved envelope to its named recipient; it does not grant access to the originating contact. Reassignment requires current eligibility and permission and revokes the former counselor's access.

PRD §9 names such as `campaign_response_links`, `campaign_responses`, `response_account_claims`, `followup_cases` and `church_referrals` are conceptual extension points. HC-02 must reconcile the canonical Campaigns/Forms/Communities schema, settled CRM tip and migration journal before allocating names or migration numbers. This ADR applies no schema.

## CRM integration contract for HC-06

1. A submission records a purpose-scoped response, source, immutable form/notice version, minimal evidence and idempotency key. Contact methods awaiting verification are restricted staging data with expiry, not a searchable parallel people database. Public-resource-only visits create no CRM record.
2. HC-06 associates eligible responses with canonical workspace contacts only after verified identity and an authorized claim/association. Email text, normalized names, attendance, a social message or a matching address alone cannot prove ownership or authorize a global merge. An existing account confirms association; conflicts require a safe resolution path rather than silent relinking.
3. Reuse tenant-scoped CRM identifier uniqueness and dedupe. Retries must yield one authorized contact association and one case per intended request, not duplicate people, invitations or assignments. No cross-workspace matching or automatic merging; CRM-06 import/export/merge is outside this work.
4. A follow-up case is a purpose-scoped workflow with guarded operational statuses (`requested`, `assigned`, `attempted`, `connected`, `withdrawn`, etc.). It is not a raw CRM tag of “converted”; `connected` describes contact progress, not a religious judgment. CRM tasks/timeline may project permitted operational metadata only after capability checks, without making the confidential case visible to all CRM readers.
5. Special-category response classifications and counseling content, if ever approved, live in restricted purpose-specific records. Never put them in generic tags, custom fields, contact notes, generic task bodies, event payloads, search, exports or public profiles. No collection by default; legal basis and additional safeguards remain review gates.
6. Producer and outbox writes share an authorized transaction. Events carry minimal scoped references and schema/dedupe metadata; recipients and sensitive bodies are resolved at execution under live permissions. Generic events, diagnostics and analytics contain no raw contact methods, religious-response text or prayer notes.

## Withdrawal, erasure and durable payloads

The CRM-05 **B1 lesson carried into HC-01** is that deleting a contact or note is insufficient if durable outbox/job payloads still identify the person. [CRM-05 PR #15](https://github.com/bumbmatei-sys/harvest-v2/pull/15) is an unmerged dependency at this baseline; this ADR does not certify its fix. Reconcile with its final erasure implementation after merge, without editing its branch.

- Extend the existing controlled `erase_contact` path for Connect associations and personal data, preserving its tenant/actor checks, re-keying and minimal audit semantics. Scrub response/contact-method tables, claims, cases/referrals, notifications, outbox events, jobs and replay/dead-letter payloads; dependent IDs, dedupe material and fingerprints also require review. Unclaimed guest responses need an equivalent verified rights-request path and expiry, not an exemption because `contact_id` is null.
- Keep durable events reference-only where possible. A restricted reference is still personal data if linkable: remove/re-key it and scrub derived data on erasure. Erasure may require a narrowly authorized database path because normal runtime grants prohibit payload edits; never loosen normal job/audit immutability to let arbitrary callers redact records.
- Withdrawal immediately blocks new assignments and queued contact for that purpose/recipient. Workers must recheck current permission, erasure and assignment immediately before disclosure/send; retries, replay and stale leases cannot resurrect revoked work. Test revocation racing dispatch; reconcile an already accepted external send rather than promising recall.
- Cancel/invalidate pending claims and deliveries; propagate to providers, authorized church recipients, caches, search and approved offline queues. Document completion/failure and recipient retention duties. Redact materialized exports or expire their access according to the reviewed policy; do not promise deletion of a recipient's independent lawful records without confirmation.
- Preserve only reviewed minimal non-identifying audit/financial records where a retention obligation applies. Contact erasure does not silently delete the platform account or unrelated memberships, and account-wide requests must fan out to the relevant owners. Backup expiry and restore suppression must prevent deleted data becoming active again.

HC-02 must reserve the erasure relationships before collecting personal data. Each producer slice must include its own scrub/cancellation hooks; HC-14 completes propagation and DSAR coverage rather than deferring all deletion until then. Fresh/upgrade and two-tenant tests must show no surviving identifying payload and no send after withdrawal/erasure, including retry and replay. These are future acceptance requirements, not HC-01 test results.

## Explicit non-goals

PRD §1.3 excludes all of the following from the initial release:

- Detecting or asserting whether someone is Christian or genuinely converted.
- Inferring religious belief from attendance, location, activity or AI analysis.
- Capturing detailed counseling/prayer notes by default.
- Giving all partner churches a shared responder roster.
- Compulsory newsletter subscription, account creation or default community enrollment.
- Geolocation without permission.
- Replacing face-to-face pastoral care with autonomous AI.

PRD §0.1 also excludes content research/competitive discovery, browser extensions, ERP, religious advertising profiles and unconsented sharing. Community Discovery remains in scope for later slices. HC-01 excludes app/UI code, HC-02+ migrations, CRM-06, Eden switcher, Soft FU and Connect finance code, deployment and production infrastructure.

## Dependency and release gates

- **Early pilot:** campaign QR + guest resources + optional minimal response can pilot before full Communities. Collecting responses still requires reviewed purpose/consent, tenant isolation, retention/erasure and abuse controls; no mocked community handoff or unverified CRM association. Resource-only access requires no identity. Restrict unavailable actions and describe the pilot accurately.
- **Next after CRM-05 merges:** reconcile the settled CRM tip and canonical module contracts, then HC-02 migrations/access tests, then HC-03 QR admin. Do not preallocate migration numbers against Claude's branch.
- **HC-06:** waits for the merged and verified CRM identity/erasure prerequisite (CRM-05+), HC-05 intake and the HC-07 verified claim contract. Existing email OTP does not by itself authorize linking a response.
- **Full QR → community:** requires working free identity/claims, Communities/discovery, explicit membership lifecycle and the remaining PRD §16 gates. Advanced courses can follow; public resources remain independently available.
- **Review:** [founder choices](../prd/harvest-connect-slices.md#founder-review-from-prd-18), legal/privacy, safeguarding and security decisions remain pending. No pilot or production signoff is asserted by HC-01.
