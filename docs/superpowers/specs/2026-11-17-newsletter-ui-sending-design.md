# Newsletter — UI, sending and analytics on NL-01 — design

Status: **DRAFT for founder and independent review**, 17 Nov 2026. Documentation only. No sender, UI, migration, webhook, subscriber collection or activation is added. All HC-02 decisions remain UNAPPROVED; production migrations 0031+ remain unapplied. Communities, social and link in bio retain their earlier founder priority.

References: house style `2026-11-11-communities-pr4b-forum-design.md`; `docs/acceptance/newsletter-nl01.md`; `src/{lib,server}/newsletter.ts`; `src/server/newsletter-route.ts`; canonical `mayContact`/consent ledger/CRM import and erasure services; `src/server/mail/{port,registry,zernio-adapter}.ts` (Office mail, not newsletter sending); existing provider/worker-role boundaries, shared UI registry and kit catalog; HC-02 activation register and 16 Nov launch scope exception.

## Scope

**In:** audience/list/subscriber/segment management UI over NL-01, campaign draft/editor/preview, reviewed sending pipeline, unsubscribe/preferences, delivery outcomes and aggregate analytics. **Newsletter has analytics, not an inbox.** Reply email belongs in the separate Operations Office inbox when its connection/permissions exist. Social has its own unified social inbox; Communities has its own chat/DMs.

**Out:** generic marketing automation/AI agent, a duplicate CRM/contact importer, inferred consent, sales/paid newsletters, per-person faith/engagement profiles, live sending from this design, external-vendor frontend and direct provider SDKs outside the newsletter port's adapter. No promotion inferred from a community membership, social interaction or Connect response.

## What NL-01 actually provides

Migration 0056 supplies audiences, lists, canonical-contact subscribers, per-list subscription markers, pinned shared-CRM-view segments and immutable import provenance. Subscribers contain **no copied name/email/phone**. Suppression is sticky. Effective state combines stored state, list/global suppression and current `mayContact(...,'newsletter','email')`.

The canonical ledger has an email-grant requirement, broad outstanding withdrawals across channels and two-clock ordering. A later email grant does not clear an outstanding withdrawal on another channel. Segment membership does not subscribe anyone or grant a purpose. Imports use the existing CRM pipeline and provenance; newsletter has no separate CSV parser/contact creation/consent-import flow. Segment version/privacy/source-rule invalidation fails closed.

Owner/admin manage; member read and viewer denial are NL-01 engineering defaults, not an approved privacy policy. Provenance stays owner/admin-only. Production routes/services are unconditionally off before auth; no environment value turns collection on. NL-01 has **no sender, provider contract, campaign model, outbox delivery, webhook, double opt-in, preference centre, templates, analytics or UI**.

Known activation gaps remain: merge-safe suppression/membership/provenance transfer, retention/rights handling, age/notice policy, broader CRM contact visibility and denied/security-event retention. Controlled erasure is already hooked before CRM rekeys ids; do not regress import rollback, saved-view deletion or erasure with new FKs.

## UI and shared sources

Owner routes under `/workspaces/[tenantId]/newsletter/`: Overview, Audiences/lists, Subscribers, Segments, Campaigns/editor and Analytics. There is **no Inbox route/tab**. Use existing typed navigation/AppShell; do not create another shell. These route registrations are work for the reviewed UI implementation, not this document.

| Area | Proposed source / preview | Harvest reuse / alternative |
| --- | --- | --- |
| Overview/analytics cards | catalogued free [`stat-card1`](https://shadcnuikit.com/blocks/dashboard-ui/stat-cards#stat-card-1), dependencies/anchor checked before adoption | existing semantic status/summary patterns; no fake metrics |
| Audiences/lists/subscribers/campaign reports | [`tables19`](https://shadcnuikit.com/blocks/dashboard-ui/tables#tables-19); free `tables1`–`tables7` alternatives if appropriate | configured `ListPage`, shared filters/pagination/empty states; no table engine clone |
| Campaign/editor fields | [`form-layout1`](https://shadcnuikit.com/blocks/dashboard-ui/form-layouts#form-layout-1), pinned MIT Studio Admin form patterns | `EditorShell`, `Field`, inputs, `StickySaveBar`, `ConfirmDialog`, restricted `RichTextEditor`/`RichTextView` |
| Email preview composition | appropriate `mail-app6` detail pattern, [preview](https://shadcnuikit.com/blocks/application-ui/mail-app#mail-app-6) | trusted Harvest email renderer in a labelled preview, no inbox/sidebar/thread controls |
| Future public signup | [`newsletter1`](https://shadcnuikit.com/blocks/marketing/newsletter-sections#newsletter-1) candidate | canonical consent/notice flow only after its gate; not an ad-hoc email form |

Source fit, anchors, dependencies and the exact item per area are audited before implementation; no invented standalone email-builder registry item. Premium kit blocks are used wherever they fit; the licence is settled (founder, 17 Nov). Record converted files/item/licence in provenance. If no source covers an area, return to the founder. This draft includes no UI source or premium assets.

All owner pages remain full width, concise/catalogued, supplier-neutral, light/dark and 44px accessible. The catalogue uses ministry terminology. A zero/empty state distinguishes no data from an unavailable connection or suppressed count; it never shows sample analytics as real results.

## Subscriber and segment flows

List/subscriber pages call NL-01 bounded UUID keysets and show **effective** state. Never report one 100-row page as a total. A totals endpoint must use the same predicate/consent/role rules or explicitly show “loaded results”; do not count in the browser and label it audience size.

Contact pickers reference authorized canonical CRM contacts; no hidden join exposes contact methods to a role lacking that permission. Existing shared-view/pinned-version rules and source restrictions remain. Tag edits, state transitions and suppression require current versions. A stale edit preserves the user's input and requires reload/review.

Import UI opens the canonical CRM import workflow, then adds NL-01 provenance for already-applied rows. CSV rows, donor/member lists, grants from other purposes and a checkbox do not manufacture newsletter consent. Show why a suppressed/uncontactable subscriber cannot be selected; do not offer a casual unsuppress/reset button. A later grant or import replay never clears suppression.

Campaign recipient selection names lists and optional pinned segments, deduplicates by canonical subscriber/contact within the ministry, and displays current estimates as estimates. Segment/view edits after review invalidate the campaign's recipient review rather than silently widening it. At delivery, evaluate actual current eligibility again.

## Campaign data and editor

Propose ministry-scoped `newsletter_campaigns`, immutable `newsletter_campaign_revisions`, recipient-selection references, `newsletter_deliveries` and minimal authenticated delivery-event metadata. Composite FKs bind every list/segment/subscriber/connection to the ministry; FORCE RLS and restricted-owner/worker tests apply. No migration number reserved.

A campaign revision contains subject (≤150), optional preheader (≤200), approved sender/reply-to identity references, trusted content definition and text fallback. No arbitrary HTML/scripts/iframes/remote embeds. Start with the existing constrained rich-text schema adapted for email-safe output; allow only rendering nodes with tested escaped HTML/plain-text generation. An external image must pass the existing authorized ready/scanner rules; no tracking pixel by default. Links are validated HTTPS (any required mail links are explicit reviewed components), never raw user HTML.

Draft → reviewed → scheduled → sending → sent/partial/failed/cancelled is a proposed lifecycle with per-recipient states. Edits after review create a new revision and invalidate old recipient/sender review. Freeze a revision before first dispatch. Publish/send is an explicit final action showing sender, recipients/eligibility, schedule/timezone and the exact preview. Save draft or wizard completion never sends. Limit scheduled delivery to 60 days from review.

Test/preview uses a local synthetic mailbox/fake provider. No real test email outside tests. Production-disallowed actions return an honest unavailable state before any provider call. The founder's future activation is a separate PR, not an environment switch introduced here.

## Sending through the newsletter port

The 20 Nov founder decision selects Amazon SES behind the Harvest-owned newsletter port. The fake provider exercises delivery and verification while the live adapter stays hard-off. Ministries use their own verified domains. Harvest generates ownership, SPF, DKIM, bounce-domain and required DMARC instructions and rechecks their status. Confirm the sender and reply-to separately by delivering a one-time challenge to each address. A reply-to can be on any external domain. Harvest hosts no ministry mailboxes and requires no ministry AWS accounts.

Provider separation: the Zernio `MailProvider` stays for per-admin Office mail (Operations), and Resend stays for sign-in and community mail. Neither is used for newsletter bulk sending; the existing `MailProvider` send/reply/draft/label operations are not a bulk-newsletter contract. Do not call a direct vendor SDK outside the adapter, reuse the app's authentication mail sender, or silently send bulk campaigns from an admin's Office mailbox.

The sending acceptance record tracks the SES contract and hosted evidence still required for domain provisioning, quotas, signed SNS events, one-click header and plain-text behavior, and reputation monitoring. [Sending acceptance](../../acceptance/newsletter-sending.md)

Proposed worker flow:
1. Atomically claim a bounded, due, reviewed campaign revision/recipient with a lease and immutable delivery ID echoed in a provider tag. Recheck campaign state, current list/segment definition versions and connection/sender eligibility.
2. Resolve the canonical live contact. Under the existing contact/subscriber lock order, evaluate current global/list state and suppression and call `mayContact(tx,tenantId,contactId,'newsletter','email')`. A stored subscribed marker or historical consent FK is insufficient. Deduplication across multiple lists must survive retries and reviewed CRM merges.
3. Immediately before each provider submission, re-evaluate eligibility/withdrawal and obtain the current recipient method only in memory. Provider calls run outside database transactions; never log/store the email in jobs, audit, webhook bodies or a duplicate subscriber record. Persist only ids, consent/provenance/version references and fixed outcomes required by the reviewed delivery contract.
4. After authorization, a timeout leaves the delivery unknown. Never resubmit an unknown delivery. A signed SNS notification can use the echoed delivery tag to attach the provider message ID. Acceptance and delivery are separate evidence flags. After 48 hours, mark unresolved attempts for operator review and keep accepting authenticated reconciliation until the 90-day purge.
5. Authenticated replay-safe callbacks reconcile accepted/delivered/bounced/complained/unsubscribed outcomes idempotently and monotonically. Revoke/disable/withdrawal prevents undispatched work and retries. Complaints/hard bounces apply the reviewed suppression policy; ordinary delivery callbacks never grant consent or unsuppress.

Callback bodies are bounded and signature-verified in memory; normalize to delivery ID, provider message reference, fixed event type and time, then discard addresses/raw text before persistence, audit or logs. Uniform acknowledgements must not reveal subscribers.

The exact authorization fence and in-flight semantics require independent review: withdrawal cancels work not yet submitted, while an already accepted remote message may be impossible to recall. Do not claim atomic consent withdrawal across a database and an external provider. Tests pause before submission and verify a fresh withdrawal/erasure/disablement wins; no database transaction is held over network I/O.

Worker-only claim/complete/failure/health functions follow the existing restricted worker-role pattern. The web role cannot drain sends, read recipient methods through a claim function or falsify health. Logs and CLI output use counts and fixed codes. Unresolved delivery alerts include ministry IDs and age in seconds. Run separate bounded domain rechecks and 90-day delivery purges under the worker role. Install schedules only with separate authorization. Live monitoring, quotas and domain provisioning remain activation work.

## Unsubscribe, preferences and merge/erasure

Implement a reviewed public flow before live sending. GET never mutates (email scanners/prefetchers follow links). A signed, limited token authorizes a list-only unsubscribe POST or a separate explicit all-newsletters withdrawal; it never authorizes a grant, profile/contact read or suppression reset. RFC 8058 one-click POST, expiry/key rotation, uniform invalid-token answers, abuse limits and no identifying URL fields are tested. Token previews expose no recipient methods.

List-only unsubscribe changes that list's additional restriction; all-newsletters withdrawal records the canonical newsletter-purpose withdrawal and prevents delivery across lists. **Propose an NL-02 withdrawal-propagation hook** that also leaves affected stored subscription markers unsubscribed, so a later broad consent grant cannot silently reactivate old lists. NL-01 does not implement that hook. Explicit, versioned resubscription needs a valid current grant and must still respect sticky suppression and outstanding other-channel withdrawals.

Double opt-in/public signup is a separate reviewed acquisition slice: current notice/purpose, canonical contact association, verified address and abuse controls. Newsletter/link-in-bio/community forms must reuse it once real; none may create their own email/consent table or default-checked purpose. No policy or legal basis is selected here.

Before collection/sending, complete merge-safe suppression/transfer and queued-delivery reconciliation. Merging contacts must not lose a suppression or send twice under old/new identities. Erasure cancels undispatched recipients and preserves only reviewed non-identifying counts/evidence; maintain NL-01's purge-before-rekey behavior and CRM import rollback/shared-view deletion. Keep campaigns, templates and active subscribers as needed. Purge individual delivery evidence at 90 days and retain campaign/day counters indefinitely. Keep suppression data scoped to a versioned keyed address digest, reason and time. The digest is personal data. A fresh verified opt-in can clear an earlier unsubscribe for the relevant scope. Hard bounce and complaint blocks remain sticky.

## Analytics, never an inbox

Overview and per-campaign reports distinguish selected, currently eligible, skipped, queued, attempted, provider accepted, delivered, failed, bounced, complained and unsubscribed. Missing provider evidence is “unavailable/pending”, not zero delivery or 100% success. Reconcile repeated/out-of-order events once, and define denominators consistently for partial campaigns and retries.

Open/click tracking is optional and off by default pending notice/privacy review. Label unreliable/bot-inflated events accurately; do not infer unique human readers or profile individual faith interests. Prefer aggregate campaign/day metrics, suppression for small cohorts, owner/admin access and reviewed retention. Campaign revisions store authored subject, preheader and content. Delivery and analytics storage exclude recipient-rendered messages, provider payloads and raw IP or user-agent data.

Replies go to the configured legitimate reply-to route and, when available, the separately authorized Operations Office mailbox. Do not add threads, reply composers or inbox navigation to Newsletter. Social and community message content never enters newsletter analytics.

## Testing and delivery slices

Unit/integration: rendering/escaping/plain text, safe links/headers, NL-01 effective states and two-clock/broad-withdrawal semantics, pinned-segment invalidation, two ministries/direct RLS/restricted owner, duplicate recipients, versions/frozen revision, concurrent withdrawal/erasure/merge/claim, sticky suppression/import replay, canonical unsubscribe scopes, GET prefetch safety, signed/replayed callbacks, partial/unknown provider outcomes, review-token expiry, 90-day purge, anonymous analytics persistence, worker/app grants, failure health and no real network. Include CRM import rollback, shared-view deletion and erasure regressions.

Browser: lists/subscribers/segment invalidation; draft/review/preview/schedule/cancel with fake delivery; effective suppression and stale edits; aggregate status/analytics; public token unsubscribe with no login and no GET mutation. No inbox. Axe/keyboard/overflow, light/dark 360/768/1280, 44px targets, synthetic screenshots and fresh non-author review.

| Slice | Delivers | Exit |
| --- | --- | --- |
| NL-02 safeguards | reviewed newsletter provider contract (domain auth, bounce/complaint webhooks), merge/withdrawal/erasure hooks, public preference/token design | consent/lifecycle/race tests; collection/sending still disabled |
| NL-03 UI | existing NL-01 administration and campaign draft/preview composition | real bounded APIs, privacy/role matrix, screenshots |
| NL-04 delivery | immutable revisions, worker/outbox/receipts, fake provider pipeline | correlation/reconciliation/withdrawal/worker tests; no live send |
| NL-05 analytics | verified aggregate outcome reports and unavailable states | denominator/event-replay/privacy tests, no inbox |
| separate activation | provider/domain/monitoring/privacy evidence and reviewed notices | founder approval recorded separately; no automatic activation |

All five HC-02 gates remain UNAPPROVED. SES registration, DNS and mailbox delivery, production quotas, SNS certificate provisioning and retries, and received MIME and DKIM evidence need hosted verification before activation. PR #165 merges only after #157, #159, #161 and #162, with the 0073 snapshot regenerated from the 0072 snapshot and verified by a second Drizzle generate.
