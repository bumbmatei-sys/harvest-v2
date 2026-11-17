# Fundraising pledge campaigns — proposed record-keeping design

Status: proposal, 17 Nov 2026. Documentation only; nothing here is approved or built. This approves **no payment provider, no live funds, no deployment and no activation**. The founder's donations workaround is still to come. All five HC-02 gates remain **UNAPPROVED**; production collection/delivery remain hard-disabled and production migrations 0031+ unapplied.

## Summary (10 lines)

1. OPERATIONS → Giving would contain Fundraising campaigns and Giving records; these entries stay hidden until built.
2. A campaign has a goal in integer cents and one currency; pledges record intentions, not money.
3. Only gifts confirmed by the ministry contribute to recorded progress; Harvest makes no independent confirmation claim.
4. Immutable gift ledger rows are the sole money record; corrections append compensating rows rather than editing history.
5. CRM timeline entries point to the gift record by id with amount null, so reporting cannot count a gift twice.
6. Signed-out pledge pages collect minimum information with abuse controls and never accept card or bank credentials.
7. External giving links require an exact-host allowlist and a separate founder decision; no provider call is proposed.
8. Donor details have restricted permissions and audits; public breakdowns require complementary small-group suppression.
9. Tenant isolation, currency consistency, idempotency and correction concurrency are mandatory server invariants.
10. F1 data/server, F2 public pledge server and F3 gift recording precede Claude-owned UI; legal retention and the workaround remain open.

## 1. Goals, non-goals and authority

Propose honest pledge tracking and ministry-entered giving records, with public campaign information and clear separation between intended support and gifts a ministry says it has confirmed. User-facing text says “ministry”; internal ownership remains `workspace`. “Giving records” describes record keeping, never accounting software or an independently reconciled bank balance.

Non-goals: card processing, accepting card data, holding or moving funds, live provider calls, payout routing, bank imports, checkout, recurring collection, tax-deductibility claims, charitable receipts, automated financial confirmation or payment webhooks. A pledge page is not a donation checkout. No third-party donations can pass through an unapproved arrangement. No code, migrations or screens are included in this proposal.

Read-only reference: `bumbmatei-sys/harvest-agent/docs/prd/PRD.md` §17, including AdminFundraising, CampaignWidget, PublicCampaign, CampaignProgress and `/campaign/[id]`, `/pledge/[id]`. Preserve its money-record and wording invariants, not its Firestore model, code, branding or copy. Its existing external providers and email-based donor matching are historical behavior, not provider approval or adequate identity proof for V2.

V2 sources: [Campaign Creation Wizard](../../prd/harvest-campaign-wizard.md), [delivery plan](../../plans/professional-v1-first-eight-prs.md), [ADR 0012](../../decisions/0012-payment-provider-separation.md), payment correction in `CLAUDE.md`, [scope exception](../../prd/professional-v1-launch-scope.md#scope-exception-16-nov-2026), [three-mode shell](2026-11-16-three-mode-shell-design.md), [editor mode](2026-11-16-shell-editor-mode-design.md). The current founder direction supersedes historical live-donation language: no paid functionality before an LLC and no donation provider/workaround is selected here. Dodo is SaaS billing only; commerce and donation domains keep separate future adapters, ledgers and webhook identities.

Checked at main `4f554ed`: `src/server/campaigns.ts` implements CRM/outreach campaign CRUD and idempotency, not gifts or pledges. `crm_associations` in `src/db/schema.ts` requires a consent event and has constrained sources/kinds/purposes; it is not already a finance timeline contract. No `PAY-DEC6` identifier or dedicated CW implementation plan was found by repository search; the wizard PRD's CW-09/CW-10 and ADR 0012 establish the relevant config-only/provider gates. Do not invent a resolved PAY-DEC6 decision.

## 2. Domain and lifecycle

A fundraising campaign belongs to one ministry, with a title, goal in cents, a supported single currency, draft/published/closed/archived lifecycle, visibility and optional link to the canonical outreach campaign. A ministry-wide fundraiser has no outreach campaign id. A campaign-specific gift is not automatically counted in a second ministry-wide fundraiser. Ministry-wide reporting may aggregate each ledger row once, grouped by currency.

A **pledge** is an intention: amount/currency, optional supporter contact association, submitted timestamp, proposed fulfilment date and pending/accepted/cancelled state. Public submission creates pending, not a gift. Staff acceptance still creates no money. Pledges may be anonymous to the public; anonymity to the public is not anonymity from authorized ministry staff, and the form must say so. No public supporter directory.

A **gift record** states that an authorized ministry actor confirmed an amount, date and designation outside Harvest. Its evidence is a minimal reference or attestation, not uploaded bank/card details. Record wording: **“confirmed by the ministry”**. Public and staff giving surfaces must never label gifts “verified” or “payment received” or imply Harvest established that funds arrived. The underlying record stores the actor and time so the ministry's statement is attributable.

Progress sums net eligible confirmed ledger entries in the campaign's currency, never pledges, pending records or CRM activities. Pledge intentions have a separate clearly labelled sum/count subject to privacy suppression; no misleading combined “raised” figure. A progress percentage must not reveal a suppressed exact amount. Do not clamp underlying totals to the goal or discard over-goal gifts; display policy is separate.

Suggested lifecycle: draft → published → closed → archived; unpublishing removes public access. Once any pledge, giving draft or confirmed gift exists, currency is immutable; changing it requires a new campaign. Goal changes are versioned and audited; they never rewrite past entries. Closed campaigns reject new public pledges but authorized corrections remain possible. No reopening or public publication is authorized by this design.

## 3. Proposed data model and money invariants

Indicative names; F1 must audit existing schema before fixing them. No migration number is reserved.

| Relation | Fields and invariants |
| --- | --- |
| `fundraising_campaigns` | tenant/id, optional canonical campaign id, public slug, title/summary, lifecycle, visibility, goal_cents bigint, currency, publish dates, version, creator/timestamps; composite same-tenant campaign FK |
| `fundraising_pledges` | tenant/id/campaign, amount_cents positive bigint, currency, optional canonical contact id, minimum private supporter fields if no contact, status, idempotency key/fingerprint, notice version, timestamps; currency matches campaign |
| `giving_record_drafts` | tenant/id, optional campaign/pledge/contact references, proposed cents/currency/date, version, actor; explicitly excluded from progress |
| `giving_ledger_entries` | tenant/id, campaign or ministry-wide designation, optional pledge/contact link, signed amount_cents bigint, currency, entry kind gift/reversal, correction-of id, confirmation actor/time, gift date, safe evidence reference, idempotency key/fingerprint, timestamps; immutable monetary fields |
| `giving_contact_links` | Restricted same-tenant identity link where deletion rules require financial rows to outlive contact association; never a second person model |
| `giving_external_links` | tenant/id, approved host-rule id, HTTPS URL, label, enabled state, version; unused until workaround/host policy confirmed |
| CRM timeline projection | tenant/contact, giving_record_id (or canonical `invoiceId` if F1 establishes invoices as the ledger owner), kind, timestamp, **amount null**; no separate money total |

Use signed 64-bit integer cents in the database; API monetary values are validated bounded integer strings to avoid JavaScript precision loss. No floats, silent rounding or currency conversion. V1 supports only explicitly listed two-decimal currencies so “cents” is accurate; reject others until a minor-unit design is reviewed. Each ledger entry matches its campaign currency; ministry totals are separate per currency, never a sum across currencies.

The gift ledger is the canonical money record, playing the invoice role in the older application's model. Do not add a competing invoice money table later: if an existing/new canonical invoice contract is chosen in F1, use that ledger and point to its id. The CRM projection has no amount (or amount null if the shared shape contains that field). Report queries read only the canonical ledger. The current consent-gated `crm_associations` cannot be repurposed by inventing marketing consent: propose an explicit restricted giving-reference contract in the shared timeline, reviewed separately with CRM ownership. Until that contract exists, omit the timeline entry rather than misuse a consent purpose.

Confirmed gifts are append-only. Correction is a transaction inserting an exact reversal of the original and, if needed, a replacement positive gift with its own id, actor and explanation code. Uniqueness prevents two reversals of the same entry; lock the original and enforce reversal currency/designation/amount equality. A correction to a correction follows the same explicit chain; reject cycles and ambiguous partial reversals in V1. No arbitrary negative gift inputs. Database privileges/triggers refuse updates/deletes of money fields even under direct app-role SQL. Duplicate idempotency keys replay the same result; changed payloads conflict.

Pledge-to-gift links document association without making a pledge confirmation. Partial or multiple gifts may refer to a pledge; record their allocations once and forbid allocation above the net eligible gift. Over-fulfilment is allowed and shown honestly. Pledge edits never alter ledger entries; unlinking an erroneous pledge association requires an audited correction path without rewriting money.

## 4. RLS, permissions and sensitive identities

All new tables have ENABLE and **FORCE RLS**, tenant composite primary/foreign keys, no anonymous table grants and no cross-tenant target references. `withTenant` authorizes a verified session before transaction-local tenant context is set. Named capability checks occur on every service and definer, not just navigation. Definers use `SET search_path = pg_catalog, pg_temp`, fully qualified names, revoke PUBLIC and minimum execution grants. Restricted migration-owner tests are mandatory.

Proposed keys/defaults, not implemented or approved:

| Capability | Default proposal |
| --- | --- |
| `fundraising:read`, `fundraising:manage`, `fundraising:publish` | Owner/admin; member/viewer get no donor data or management |
| `giving:record` | Owner/admin can prepare and confirm ministry attestations in V1 |
| `giving:correct` | Owner/admin, with explicit correction explanation and audit |
| `giving:read_donors` | Owner/admin only; audited reads, no implicit access from ordinary CRM read |
| `giving:export` | Owner only initially; audited, limited and permissioned again at download |
| Public pledge submission | No ministry role, only the narrow published campaign action with abuse checks |

A future delegated finance role and two-person confirmation require a separate permission decision. Ministry viewers/members must not see donor identity, private pledge text or giving history through CRM, search, exports or error differences. Existing broad CRM contact visibility remains an unresolved HC-02 prerequisite: linking a donor to an existing CRM record does not make that record private. Do not create donor-specific sensitive fields in broadly readable contacts.

Supporters link to a canonical same-ministry CRM contact only through a disclosed, authorized association. No automatic merge by matching email and no cross-ministry contact lookup; matching an email is not identity proof. A public pledge need not create a contact. Recommended default: private pledge identity until a staff-reviewed explicit CRM association; never duplicate a canonical person when linked. Giving records and pledges create no outreach/newsletter consent and no hidden opt-in. Any later marketing workflow must independently pass the existing purpose-specific consent gate.

## 5. Public pledge pages and external links

Proposed public routes retain the intent of `/campaign/[id]` and `/pledge/[id]`, with exact V2 naming coordinated before implementation. A signed-out visitor sees published safe campaign metadata, ministry name, goal/currency, eligible suppressed progress and an honest record-keeping notice. Draft, hidden, archived or unpublished campaigns return a uniform not-found response. Unlisted is direct-link only and never indexed. Donor identities and private pledge status are never returned by public GETs.

Collect intended amount, currency fixed by campaign, optional name/contact method, optional fulfilment date and notice acknowledgement. No card numbers, bank credentials, identity document, religious response or free-form sensitive narrative. Recommend contact details optional; anonymous intentions are allowed with lower abuse quotas and are not confirmed gifts. Separate disclosures explain who can see supporter details, that a pledge moves no money, and how to request deletion. No checkbox for marketing is bundled with submission.

Before activation: bounded server validation, body/request size limits, per-campaign/global abuse quotas and IP-based rate limiting with a reviewed short-lived minimised storage policy, honeypot and timing checks, CSRF/origin protection, generic errors and idempotent submissions. Do not expose pledge lookup by sequential id or email; any future private supporter link needs a random expiring hashed token and a separate identity/privacy design. Honeypots supplement rather than replace rate limits. Public pages must not leak target existence or donor identities through errors or counters.

External giving links remain absent until the founder provides the workaround and approves supported destinations and notices. Proposed validation: HTTPS only, exact canonical host allowlist per supported destination, no userinfo, IP literal, nonstandard port, javascript/data scheme, lookalike host or arbitrary redirect URL. Revalidate on every read and write; no server fetch/preview/unfurl and no redirect following. Do not claim that an allowed host establishes recipient ownership or charity legitimacy; a staff review and impersonation/takedown process are still needed. External navigation uses safe link attributes and a clear notice that Harvest does not process the gift. No “0% fees” or eligibility claims without evidence.

## 6. Campaign wizard, Connect and future payment boundary

CW-09 continues to own configuration of currency, budget, goal and toggles only. A future fundraising campaign references that canonical campaign/configuration; do not copy it into incompatible goal records without an explicit precedence/version rule. Recommended default: canonical fundraising campaign owns fundraising goal after initialization, and CW-09 reads/updates it through the same service once that integration is separately built. No claim that CW-09 budget UI or fundraising integration already exists.

Harvest Connect campaigns can supply the parent campaign id, not donor identities, religious response state or consent grants. A gift never creates a follow-up case or unlocks private Connect data. CW-10 live fundraising and PAY-DEC6/provider eligibility remain gated; the proposed pledge record-keeping server is not a live gift processor.

Future donation adapters may append distinct provider-confirmed domain events to a reviewed donation ledger contract, with signed webhook identities, replay keys and reconciliation. No adapter, network call or webhook route exists in these slices. SaaS billing events must never create gifts; commerce purchases must never become donations. The founder's workaround may change external-link design and must be recorded before implementation of those links.

## 7. Audit, reporting, export and rights

Create/update/publish/close, pledge acceptance/cancellation, gift confirmation/correction, donor reads, exports and permission changes write transaction-bound audit records. Metadata contains ids, states, changed field names, versions and reason codes; no names, contact methods, bank details, free text or pledge/gift amounts in general audit/outbox logs. The restricted ledger is the money evidence. Failed transactions write no success audit. Denial/security logging requires a separately specified safe sink and retention policy; do not claim existing denied attempts are audited.

Staff financial totals are exact, complete ledger aggregates scoped to authorized ministry/campaign and currency, never a capped page sum. Public progress and any donor-level breakdown require small-group and complementary suppression: reuse `connect_suppress_small`/the HC-15 family-suppression approach where suitable, not just per-cell suppression. Suppression counts distinct supporters, never gift, pledge or submission rows; repeat gifts from one person remain one supporter. Unknown or unresolved identities cannot establish a safe cohort and require conservative family suppression. Counts 1–4 return no value; 0 is safe only when other released values cannot reconstruct a hidden cell. Suppress complementary totals, percentages, date/comparison/difference cells and amounts when they could reveal a donor or small cohort. If a safe joint release cannot be proven, suppress the whole family. No public donor ranking, gift-size histogram or live incremental donor feed. Repeated observations can still reveal changes; privacy review must settle update cadence and permitted aggregates before activation. Public financial amounts are not automatically safe because a count helper exists.

Export is a purpose-limited, audited, owner-authorized job reading the canonical ledger, with currency and integer cents explicit, correction chains preserved and a defined as-of cutoff. Contact data requires the additional donor-read permission; neutralize CSV formula injection, keep files private, use short-lived downloads, recheck authorization, bound lifetime and delete exports under a reviewed policy. No email delivery or tax receipt generation in these slices.

**LEGAL decision, unresolved:** distinguish donor personal data, pledge intentions, financial evidence and records the ministry may be required to retain. No retention duration, lawful basis, accounting compliance or right to keep identifying records is chosen here. Propose detachable personal links, restricted evidence and documented erasure workflows so legal review can choose deletion/pseudonymization without changing monetary history. Immutable money fields do not justify immutable personal data. Contact/account erasure must remove or redact donor identity and shared-text references according to that future decision; any legal hold needs authority, scope, expiry and audit. Backups, exports and correction evidence are included in the review. No real data until it is settled.

## 8. Operations placement and editor steps

Proposed OPERATIONS → Giving entries: **Fundraising campaigns** and **Giving records**. Keep reserved entries hidden until complete, permissioned and separately activated; this document changes no navigation or messages. Claude owns all UI/shell work.

Campaign editor uses existing editor-mode context, shared forms, autosave/resume when available, version conflicts, publish checklist and inert same-render-path preview. Steps: Basics → Goal/currency → Pledge form/privacy → Page → Publish. External giving is omitted until the workaround is specified, never a dead placeholder. Giving record entry is a short permissioned form/dialog, not a new multi-step shell. Preview uses synthetic totals/supporters, never live donations or real donor data; no submission, provider call or ledger write. Phone-first, keyboard and responsive light/dark evidence belong to separate UI PRs.

## 9. Proposed slices and tests

| Slice | Delivery | Required acceptance evidence |
| --- | --- | --- |
| F1 | Tenant-safe campaign/pledge/ledger model, permissioned server contracts, config relationship, no public activation | Restricted-owner migration/upgrade/RLS tests; two tenants; role/direct-SQL denial; cents/currency bounds; audit atomicity; no payment network path |
| F2 | Sanitized public campaign/pledge server and abuse protection, behind disabled collection gate | Draft/hidden/unlisted handling; minimum response fields; no enumeration; rate limits/honeypot/CSRF; idempotency; no contact/consent creation; no card path |
| F3 | Staff gift preparation/confirmation, correction ledger, progress, restricted export/timeline contract | Concurrent reversal and duplicate prevention; exact totals; cross-currency rejection; amount-null CRM references; suppression 0/1–4/5 and complements; erasure/retention decision coverage |
| UI later | Claude-owned campaign editor, public pledge form and giving records | Shared shell/components, no vendor wording, end-to-end success/denial/failure paths, five responsive widths, light/dark, keyboard/axe and viewed evidence |

Every implementation slice has its own draft PR, independent fresh review and acceptance record; lint/typecheck/unit/integration/build and CI evidence are required. Migration numbering follows the current journal/open PRs at implementation time, including monotonic `when` and snapshot `prevId`; never renumber merged files. Trusted-main Neon verification is needed for migrations. F2 stays disabled until privacy/abuse/legal decisions and the founder's explicit collection authorization; a merge is not activation.

## 10. Threat model

| Threat | Proposed control and test |
| --- | --- |
| Fake pledges and automated goal inflation | Pledges never count as gifts; rate limits, pending state, honeypot, quotas and flood tests |
| Fraudulent staff confirmation/correction | Named capability, attributed attestation, immutable ledger, compensating correction, audit and concurrent-write tests; Harvest still cannot establish truth |
| Donor enumeration and religious inference | No public roster/status lookup, generic errors, restricted identities, no hidden CRM creation; field allowlist and small-cohort tests |
| Cross-tenant ids or unauthorized exports | Composite FKs/FORCE RLS, scoped definers, permission recheck and private downloads; two-tenant/direct-SQL tests |
| Charity impersonation and malicious external links | No legitimacy badge, exact-host validation, recipient review/takedown process; hostile URLs and changed-host rejection |
| Double counting, currency mix or precision loss | One money ledger, amount-null CRM pointers, per-currency sums, integer strings and reconciliation/property tests |
| Sensitive identity retained forever in immutable evidence | Detachable identity, minimised metadata, reviewed redaction/legal holds and export/backup rights procedures |

## 11. Founder questions and recommended defaults

- What is the donation workaround? Still pending; recommend no external links until documented and reviewed. This design supplies no substitute.
- Who can confirm gifts? Recommend owner/admin initially with explicit ministry attestation; consider independent second-person confirmation before delegated finance roles.
- How much supporter identity is required for a pledge? Recommend optional minimum contact detail, private to authorized staff; no automatic CRM contact or marketing opt-in.
- Which currencies? Recommend an explicit two-decimal allowlist, one currency per campaign and no conversion; other minor units need a separate design.
- Should public pages show exact gift totals? Recommend no until privacy review defines a safe release; suppress whole families when small cohorts or observations permit inference.
- Can a gift support several campaigns? Recommend one designation per ledger entry in V1; later allocations must conserve cents and not duplicate ministry totals.
- Which records survive erasure, and for how long? LEGAL decision: recommend minimising identifiers and separating them from monetary entries, with no assumed retention period.
- Is a public pledge page wanted before external giving links? Recommend yes as a separately authorized, clearly labelled intention-only workflow after privacy/abuse review; never present it as checkout.

## 12. Assumptions not verified

No implementation, migration, runtime tests, browser flow, provider eligibility, legal analysis, charity status, funds-flow arrangement or production data was verified for this proposal. Reference §17 describes the older app, not V2 completion. Exact V2 invoice/timeline ownership, the unlocated PAY-DEC6 record, financial export infrastructure, operational abuse handling, jurisdiction/currency list, public route naming and the founder's workaround require follow-up in their owning slices. No code or branding was copied. This proposal selects no processor and authorizes no collection, messages, funds, deployment or activation.
