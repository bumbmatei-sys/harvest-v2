# HC-02 policy pack (approved by the founder, 27 Nov 2026)

Drafted 27 Nov 2026 by the engineering team. **Status: APPROVED by the founder on 27 Nov 2026 as an engineering-drafted policy, not legal advice.** The founder ticked all 16 lines of the [checklist](#16-founder-approval-checklist) on 27 Nov, and the approval is recorded in [the gate register](hc-02-activation-gates.md). Scope: EU/EEA, UK and US (the founder answered "US and Europe" on 27 Nov; engineering reads Europe as the EU/EEA and the UK). GDPR stays the baseline (engineering framing), with the US additions in [§10a](#10a-us-additions). **Approving the policy activates nothing:** each gate stays hard-off for real data until its "Still to build" items are built, reviewed and separately approved for activation.

> **Not legal advice.** These are best-practice drafts written by the engineering team, based on our reading of the EU GDPR and the UK GDPR as of November 2026, with US pointers in §10a. Nobody with legal qualifications has reviewed them. The founder chose on 27 Nov to approve engineering-drafted policies instead of hiring a lawyer for now ([decisions log](founder-decisions-2026-11.md#founder-decisions-27-nov-launch-gates)). A qualified privacy review is still recommended before any real personal data is collected. Article numbers below are pointers for that review, not conclusions.

Approving a policy here does not approve a merge, a deployment, a production migration, real collection, real sending or real payments. Each of those still needs its own explicit founder approval. Production stays hard-off.

Sources read: [gate register](hc-02-activation-gates.md), [decision sheet](hc-02-decision-sheet.md), [HC-02 acceptance](../acceptance/hc-02.md), [retention jobs](../acceptance/hc-retention.md), [rights-request runbook](../runbooks/connect-rights-requests.md), [Connect PRD](../prd/harvest-connect-qr-to-discipleship.md), [Communities PRD](../prd/harvest-communities.md), [Community Live design §15](../superpowers/specs/2026-11-16-community-live-design.md#15-decisions-and-open-questions), [C23 release gate](../acceptance/communities-c23-release-gate.md), [newsletter sending](../acceptance/newsletter-sending.md), [key groundwork](../acceptance/hc-dec5-keys.md).

## 0. Who is responsible for what

- **The ministry is the controller** for the people it reaches: Connect guests, CRM contacts, community members' activity in its communities, newsletter subscribers, donors and prayer requests. It decides why and how their data is used.
- **Harvest is the ministry's processor** for that data (GDPR Art. 28). Harvest acts only on the ministry's instructions. This needs a written data processing agreement (DPA) between Harvest and each ministry, with a list of sub-processors.
- **Harvest is the controller** for its own data: user accounts and sign-in, Harvest SaaS billing, platform security logs, Harvest staff review of Discover listings and takedown reports, and the platform's own service emails.
- **Churches with their own data protection law.** Some churches can apply their own rules under GDPR Art. 91 (for example the Catholic KDG and the Protestant DSG-EKD in Germany). If a ministry uses such rules, it may need extra terms in its DPA. Flag this at onboarding; do not decide it for the ministry.

## 1. Why religious data needs extra care (applies to every gate)

Information that shows a person's religious beliefs is special-category data (GDPR Art. 9(1); the same in the UK GDPR). Examples in Harvest: asking for pastoral follow-up after an outreach event, joining a prayer team, a prayer request, a pastoral note. Joining a community alone must not be turned into a religious label (already a rule: C23 item 14.2).

Processing special-category data needs **both** an Art. 6 lawful basis **and** an Art. 9(2) condition. Two Art. 9 conditions can fit Harvest:

| Condition | When it fits | Conditions that must all hold |
| --- | --- | --- |
| **Explicit consent, Art. 9(2)(a)** | Default for Connect guests, prayer requests and anyone who is not already a member | A clear, separate statement the person actively agrees to (unchecked box), naming the purpose; recorded with time and notice version; as easy to withdraw as to give (Art. 7(3)); no service made conditional on it |
| **Not-for-profit religious body, Art. 9(2)(d)** | A ministry's own records about its members, former members, or people in regular contact with it | (1) the ministry is a foundation, association or other not-for-profit body with a religious aim; (2) processing is part of its legitimate activities, with appropriate safeguards; (3) it is only about members, former members or people in regular contact connected with its purposes; (4) the data is not shared outside the ministry without the person's consent |

**Rule.** Harvest products rely on **explicit consent** for every flow that captures religious or pastoral data from guests or the public (Connect follow-up, prayer requests). Art. 9(2)(d) is available only to the ministry as controller, only for its own member records, and never for Harvest's own purposes (Harvest is a company, not a religious body). Harvest does not choose 9(2)(d) on a ministry's behalf; the onboarding notice tells ministries that the default is explicit consent. Harvest never infers religious beliefs, never uses faith data for ads or audience targeting, and never shares it across ministries.

Explicit consent is already how the code works: purposes are separate, unchecked and independently withdrawable (`src/lib/consent-purposes.ts`, HC-DEC1 acceptance `docs/acceptance/hc-dec1.md`).

## 2. Gate 1: purposes (HC-DEC1)

**Policy.** A guest can say yes to three separate things: account messages, pastoral follow-up and the newsletter. Each is its own unchecked box. Saying yes to one never means yes to another. Each can be withdrawn on its own at any time. Referrals to another church and event invitations come later, each as its own box. We never offer a generic "marketing" box on a Connect form, and we never record a religious "decision" label.

**Lawful basis and reasoning.**

| Purpose (code name) | Art. 6 basis | Art. 9 condition | Reasoning |
| --- | --- | --- | --- |
| Account messages (`account_communications`) | Art. 6(1)(b), steps the person asked for before an account exists; consent recorded as evidence | Art. 9(2)(a) where the context shows faith (for example, the form was at an outreach event) | The guest asks for an account or sign-in link. Messages are limited to that. |
| Pastoral follow-up (`outreach_follow_up`) | Art. 6(1)(a) consent | Art. 9(2)(a) explicit consent | Asking a ministry to follow up after an outreach shows religious interest. Explicit consent is the safest condition and matches the code. |
| Newsletter (`newsletter`) | Art. 6(1)(a) consent | Art. 9(2)(a) if the newsletter is from a religious body and signing up reveals belief | Electronic marketing also needs consent under ePrivacy rules (EU Directive 2002/58 Art. 13; UK PECR reg. 22). Double opt-in is already built. |

**Retention.** Consent records last as long as the consent and the contact exist, plus the erasure tombstone period (Gate 3). Withdrawal is kept as evidence that it happened.

**Access.** Owners and admins see consent rows. See the CRM contact visibility gap in §9.

**Rights requests.** Withdrawal per purpose: the person, or staff on their behalf with evidence (runbook step 3). Withdrawal stops follow-up cases at once (HC-14).

**Encryption.** Not needed for the purpose list itself. The evidence references notice versions, which hold no personal data.

**What the code already does.**
- One purpose registry with drift guards: `src/lib/consent-purposes.ts`, `tests/unit/consent-purposes.test.ts`, `tests/integration/consent-purposes-drift.test.ts`.
- Form versions must offer at least one purpose and reference an immutable notice version: `drizzle/0026_hc02_connect_intake.sql` (HC-02 §1).
- A grant must come from the person, never from staff: HC-02 §1 item 3.
- One send-time check `mayContact` and email-only newsletter permissions: `drizzle/0047_consent_gate.sql`, `docs/acceptance/hc-dec1b.md`.
- Withdrawal moves open follow-up cases to `withdrawn`: `drizzle/0052_hc14_withdrawal_propagation.sql`, `docs/acceptance/hc-14.md`.

**Still to build.**
- Notice text per purpose in each ministry's notice (Harvest supplies a template; the ministry publishes it).
- A Harvest default notice template in plain English with the Art. 13 items: who the controller is, purposes, basis, recipients, transfers, retention, rights, the right to complain to a supervisory authority, and how to withdraw.
- Referral and event purposes later (HC-18), each its own box.

**Text the founder approves (Gate 1).**
> I approve Gate 1 as drafted: three separate, unchecked, independently withdrawable purposes (account messages, pastoral follow-up, newsletter), explicit consent for pastoral follow-up under Art. 9(2)(a), no generic marketing purpose and no religious label on Connect forms, and referrals and events added later as separate opt-ins. I understand this is an engineering best-practice draft, not legal advice.

## 3. Gate 2: who sees pending responses (HC-DEC2)

**Policy.** Until a guest has verified their contact details, only the ministry's owner and admins can see that a response exists. Nobody can see the guest's name or contact details in the app at that stage. Pastors and volunteers see a person only once a case is assigned to them (HC-13), and only that case.

**Lawful basis and reasoning.** Data minimisation (Art. 5(1)(c)) and security (Art. 32). Fewer people with access means less risk to sensitive data.

**Art. 9.** Pending responses can show religious interest, so access stays narrow.

**Retention.** As Gate 4.

**Access.**

| Role | Pending response metadata | Names and contact details | Assigned follow-up case |
| --- | --- | --- | --- |
| Owner, admin | Yes, audited | No (no application read grant) | Yes |
| Assigned counselor (member) | No | No | Only cases assigned to them |
| Other members, viewers, guests | No | No | No |
| Harvest staff | No | No | No |

**Rights requests.** Follow the [runbook](../runbooks/connect-rights-requests.md). Only owners and admins act on pending responses. Verify proportionately; never reveal to an unverified requester whether a response exists.

**Encryption.** As Gate 5.

**What the code already does.**
- Owner/admin-only column grants on `campaign_responses`; no grant on contact methods: HC-02 §2.
- Audited owner/admin read of pending metadata: `drizzle/0045_pending_access.sql`, `drizzle/0046_pending_access_paging.sql`, `docs/acceptance/hc-dec2.md`.
- Assignment-scoped counselor access enforced by row-level security: `drizzle/0048_followup_cases.sql`, `docs/acceptance/hc-13.md`.

**Still to build.**
- Restricted CRM contact visibility (today every ministry role can read every contact and consent row; see §9).
- Logging of denied attempts (403) and an audit retention period (§9).
- An operational rights-request register (the runbook is documentation only).

**Text the founder approves (Gate 2).**
> I approve Gate 2 as drafted: owners and admins only see pending responses, nobody sees pending names or contact details in the app, and counselors see only follow-up cases assigned to them. I understand this is an engineering best-practice draft, not legal advice.

## 4. Gate 3: what we keep after erasure (HC-DEC3)

**Policy.** When a guest is erased, we delete their name, contact details and anything that links back to them. We keep only a coarse record: which campaign, link and form version, and the day. We keep that record for 90 days, then delete it. Any count below 5 is hidden, so a small group cannot reveal a person.

**Lawful basis and reasoning.** The tombstone supports simple campaign counts, a legitimate interest of the ministry (Art. 6(1)(f)). It holds no name, contact detail, exact time or reusable id. Because a coarse record in a tiny group might still point to someone, we limit it in time and hide small numbers. Art. 17 erasure is honoured for everything that identifies the person.

**Art. 9.** The tombstone holds no religious answer. A count of "follow-up requests" for a campaign is aggregate only and hidden below 5.

**Retention.** Tombstones: 90 days. Redacted consent evidence: deleted with its tombstone. Small-group threshold: fewer than 5 hidden.

**Access.** Owners and admins see aggregate counts only (HC-15). No one sees individual tombstones in the app.

**Rights requests.** Erasure: an owner/admin uses the existing erasure operation (runbook step 4). Response-only erasure and whole-contact erasure are different scopes.

**Encryption.** Not needed for the tombstone (no personal content).

**What the code already does.**
- Erasure scrub and re-keying into a day-level tombstone: `drizzle/0026_hc02_connect_intake.sql` (`erase_connect_response`), HC-02 §3.
- Tombstone expiry, small-group helper and retention sweep: `drizzle/0043_connect_retention.sql`, `src/lib/connect-retention.ts`, `scripts/connect-retention.ts`, `docs/acceptance/hc-retention.md`.
- Suppressed campaign counts: `drizzle/0054_hc15_campaign_metrics.sql`, `docs/acceptance/hc-15.md`.

**Still to build.**
- Schedule the sweep daily and the health check hourly, with an alert channel (hc-retention "Activation gates").
- Provision the worker role (`docs/setup/worker-role.md`).

**Text the founder approves (Gate 3).**
> I approve Gate 3 as drafted: after erasure we keep only campaign, link, form version and day for 90 days, then delete it, and we hide any count below 5. I understand this is an engineering best-practice draft, not legal advice.

## 5. Gate 4: retention (HC-DEC4)

**Policy.** We keep data only as long as we need it. Unverified Connect responses are deleted after at most 30 days; a ministry can choose shorter. Everything else follows the table below. A daily job deletes what has expired, and an alert fires if it fails.

**Lawful basis and reasoning.** Storage limitation (Art. 5(1)(e)). Short fixed periods are easier to defend and to test. The three periods once marked "proposed" (24-month review, 12 months, 3 years) were approved as written by the founder on 27 Nov; they are part of Gate 4, which the founder approved with the checklist on 27 Nov. The "Status" column below records where each value came from; every value in the table is approved policy as of 27 Nov.

| Data | Retention | Status | Where enforced |
| --- | --- | --- | --- |
| Unverified Connect responses | At most 30 days; shorter per form | Engineering default | `drizzle/0043_connect_retention.sql` trigger and sweep |
| Erasure tombstones | 90 days | Engineering default | same |
| Hosted CRM form responses | 90 days for new responses | Founder, 23 Nov | founder decisions log, "Hosted forms server defaults" |
| Verified CRM contacts and consents | While the relationship is active; flagged for review after 24 months without any activity | Founder, 27 Nov | Not built |
| Follow-up cases | Closed cases deleted 12 months after closing | Founder, 27 Nov | Not built |
| Newsletter delivery records | 90 days, then anonymous daily totals | Founder, 20 Nov | `drizzle/0073_newsletter_sending.sql` purge |
| Newsletter click records | 90 days, then anonymous daily totals | Founder, 26 Nov | #299 |
| Newsletter hard bounce and complaint blocks | While needed to stop sending to that address | Founder, 20 Nov ("minimum necessary") | `docs/runbooks/connect-rights-requests.md#newsletter-suppression` |
| Community applications (declined, withdrawn) | 90 days | Engineering default | C23 item 5.4 |
| Community chat and DMs (deleted items) | 30 days | Engineering default | C23 item 7.7 |
| Community posts, replies and channel messages after leaving or account deletion; DMs after leaving | Kept, shown as "Former member" (DMs are deleted on account deletion) | Founder, 27 Nov (G2) | §11 |
| Prayer requests | 30 days after closed, at most 90 days after submission; prayer wall 180 days | Founder, 27 Nov (G7) | §12, not built |
| Audit log rows | 12 months | Founder, 27 Nov | Not built |
| Rights-request register | 3 years after the request closes | Founder, 27 Nov | Not built |
| Retention run log | 90 days | Engineering default | `drizzle/0043_connect_retention.sql` |

**Art. 9.** Special-category data gets the shortest workable periods (Connect pending, prayer).

**Access.** Retention jobs run as the dedicated worker role, never as the app role (`drizzle/0044_worker_db_role.sql`, `docs/acceptance/worker-db-role.md`).

**Rights requests.** A person can ask for earlier deletion at any time (Art. 17); retention periods are a maximum, not a promise to keep data.

**Encryption.** Not applicable to the periods themselves.

**What the code already does.** The 30-day maximum, the sweep, tombstone expiry, run log and health check: `docs/acceptance/hc-retention.md`. Newsletter 90-day purge: `docs/acceptance/newsletter-sending.md`.

**Still to build.** Verified-contact review flag, follow-up case deletion, audit retention, rights-register retention, prayer retention job, and the schedulers and alerts for all of them.

**Text the founder approves (Gate 4).**
> I approve Gate 4 as drafted, including the retention table in §5 and the three periods I chose on 27 Nov (24-month review for inactive verified contacts, 12 months for closed follow-up cases and audit rows, 3 years for the rights-request register). I understand this is an engineering best-practice draft, not legal advice.

## 6. Gate 5: protecting contact details (HC-DEC5)

**Policy.** Contact details and sensitive answers are encrypted by the application before they are saved. Keys live in a managed key service, not in the app's settings. Keys are rotated. Only the parts of the app that must read the data can decrypt it, and every decryption is logged.

**Lawful basis and reasoning.** Security of processing (Art. 32) and data protection by design (Art. 25). Database encryption at rest alone does not protect against a compromised application or a leaked database copy.

**Art. 9.** Prayer requests and pastoral answers use the same envelope encryption with their own key purpose.

**Retention.** Keys outlive the data they protect only as long as needed to read it. A retired key is destroyed once no stored data uses it (after re-encryption).

**Access.** Decryption only through the single audited opener. No Harvest staff member has routine access to keys. Key administration needs two people.

**Encryption and key-management plan.**
1. **Algorithm.** AES-256-GCM envelopes with associated data binding each value to its row (already built).
2. **Key service.** A managed key service in the EU, in the same region as the database (internal note: AWS KMS in `eu-central-1` is the natural fit, since the database runs in `aws-eu-central-1`; this is a proposal, not a selection).
3. **Envelope keys.** The key service holds the master key. The app asks it to unwrap data keys; master keys never leave the service.
4. **Separate keys per purpose.** Intake, invitations, fingerprints, capabilities, prayer. A leak of one does not open the others.
5. **Rotation.** Master keys rotate every 12 months. New data uses the new key; a bounded job re-encrypts old envelopes; the old key is retired when nothing uses it.
6. **Protected search.** Fingerprints and lookup hashes need a dual-key lookup during rotation (design still open).
7. **Audit.** Every decrypt writes a durable, insert-only audit row with counts and purpose only, never the value.
8. **Recovery.** A written runbook for key loss and backup restore, rehearsed once before real data.
9. **Review.** An independent security review of the key design before real addresses are stored.

**What the code already does.**
- AES-256-GCM envelopes, version 2 with key id: `src/server/connect-intake-crypto.ts`.
- Provider-neutral key provider with a local test key and a hard-disabled managed stub: `src/server/connect-key-provider.ts`.
- One audited opener, fail-closed; rotation over an injectable store: `docs/acceptance/hc-dec5-keys.md`.
- Source guard that only the audited wrapper imports the raw opener: `tests/unit/connect-crypto-guard.test.ts`.

**Still to build.** Key service setup, durable audit table, production rotation store migration, acceptance of version 2 envelopes on the intake path, protected search design, recovery runbook and rehearsal, independent security review (all listed in `docs/acceptance/hc-dec5-keys.md` "Activation gates").

**Text the founder approves (Gate 5).**
> I approve Gate 5 as drafted: application-level AES-256-GCM encryption, a managed key service in the EU, separate keys per purpose, yearly rotation, audited decryption, a rehearsed recovery runbook and an independent security review before real addresses are stored. I understand this is an engineering best-practice draft, not legal advice.

## 7. Rights requests (all gates)

The ministry, as controller, answers requests from its people. Harvest, as processor, helps (Art. 28(3)(e)). Harvest answers requests about Harvest accounts itself.

| Right | Article | How it works in Harvest |
| --- | --- | --- |
| Be informed | 13, 14 | Notice on every form, sign-up and community join |
| Access and copy | 15, 20 | Self-serve download of your own data (founder, 27 Nov: built before launch; not built yet). Staff-assisted access has no export workflow yet; never use a broad CRM export as an answer |
| Correct | 16 | Profile and CRM edit |
| Erase | 17 | Self-serve account deletion (founder, 27 Nov: built before launch; not built yet); Connect response and contact erasure (built) |
| Restrict | 18 | Staff mark the contact; no automated sending (needs a field; not built) |
| Object | 21 | Withdrawal of a purpose; newsletter unsubscribe (RFC 8058, built) |
| Withdraw consent | 7(3) | Per purpose, as easy as giving it (built for Connect and newsletter) |

**Steps.**
1. Log the request in the restricted register: reference, date received, type, handler. No request text or identity documents in logs.
2. Verify proportionately (runbook step 2). A signed-in person's own account is enough for their own data.
3. Confirm the scope: withdrawal, erasure of one response, erasure of the whole contact, or access.
4. Act through the existing operations, never ad hoc SQL.
5. Answer within one month; this can be extended by two more months for complex requests, with a reason given within the first month (Art. 12(3)).
6. Record the outcome and the date in the register.
7. If refusing, say why and mention the right to complain to a supervisory authority (Art. 12(4)).

## 8. Children

**Policy.** Adults only (18+) at launch, with age confirmation at sign-up and community join (founder, 27 Nov). No youth programmes, rosters or profiles. If a ministry learns a user is under 18, it closes the account and erases the data. A minors programme is a later decision with its own review (Art. 8 and national ages of digital consent, which range from 13 to 16).

**Code.** Adult (18+) confirmation on joining a community: C23 item 4.1. Connect forms do not yet ask for age; a forms-level adults-only notice is still to build.

## 9. Gaps outside the five gates that block real data

From the [gate register](hc-02-activation-gates.md#activation-prerequisites-outside-the-five-decisions):
- **CRM contact visibility.** Every ministry role can read every contact and consent row. Policy: viewers and members without CRM access see no contacts; consent evidence text is owner/admin only. Not built.
- **Audit retention and denial logging.** Policy: 12 months for audit rows; log denied attempts with route and reason code only. Not built.
- **Rights-request register.** Not built.

## 10. International transfers

Product copy never names vendors. Internal docs may name infrastructure providers. Transfer mechanisms below are what we expect to use; each must be checked against the provider's current DPA before real data.

| Provider type | Internal name | Data | Location | Transfer mechanism to check |
| --- | --- | --- | --- | --- |
| Database | Neon | All application data | `aws-eu-central-1` (Frankfurt) | EU hosting; provider DPA; US parent: EU-US Data Privacy Framework (DPF) or SCCs; UK addendum |
| Edge hosting, files, workers | Cloudflare (Workers, R2) | Requests, uploaded files | Global edge; placement `aws:eu-central-1` for workers | DPA with SCCs and DPF; check R2 bucket location |
| Sign-in email | Resend | Email address, sign-in code | US | DPF or SCCs; UK addendum |
| Community and newsletter email | Amazon SES | Recipient address, message body | `us-east-1` (N. Virginia), founder 27 Nov | AWS DPA with SCCs (EU module 2 or 3 as fits the role) or the provider's DPF certification; UK addendum or IDTA |
| Social scheduler and inbox | Zernio | Connected accounts, posts, DMs | To verify | To verify before activation |
| SaaS billing | Dodo Payments | Billing contact, payment | To verify | To verify |
| Donations and sales (planned) | Stripe | Donor and buyer payment data | EEA entity for EEA accounts; US processing | Stripe DPA, SCCs, DPF |
| Live video embeds | YouTube | Viewer's device data when the embed loads | US | Embed loads only after the viewer acts (to build); DPF |
| Staging previews | Vercel (if still used) | Synthetic data only | US | Synthetic only; no real data |

**US email delivery (founder, 27 Nov: US audience first).** The main database stays in the EU (Frankfurt) for now, but SES runs in `us-east-1`. Every community and newsletter email therefore sends the recipient's address and the message content to a US processor for delivery, and delivery events come back from the US. This is a restricted transfer under GDPR Chapter V (Art. 44 onward) for EU and UK recipients. Engineering best practice, not legal advice:
- rely on the provider's EU-US Data Privacy Framework certification (Art. 45 adequacy decision) where it covers the service, and on the SCCs in the provider's DPA (Art. 46(2)(c)) as the fallback; for UK recipients, the UK extension to the DPF or the UK addendum to the SCCs;
- record a short transfer risk assessment for the SCC route;
- send only what delivery needs: address, subject, body, unsubscribe headers and the delivery tag; no CRM notes, consent evidence or pastoral data in message content beyond what the recipient asked for;
- name the US processing in the ministry DPA sub-processor list and in the privacy notice ("email delivery is handled by a provider in the United States").

**Rule.** Keep primary data in the EU. Use only providers with a signed DPA and a valid transfer mechanism. List them as sub-processors in the ministry DPA, and tell ministries before adding one.

## 10a. US additions

**Scope.** The founder's answer on 27 Nov was "US and Europe". Engineering reads "Europe" as the EU/EEA and the UK; Switzerland and other European countries are not assessed yet. The rest of this section is engineering framing, not a founder decision: GDPR stays the baseline for everyone, because it is the stricter frame, and the rules in §1 to §15 apply to US users too. The points below are added on top for the US. They are pointers for a qualified review, not legal advice, and each is checked before real US data. This section was added on 27 Nov, after the checklist walkthrough, to record the "US and Europe" answer; its wording was not one of the 16 ticked lines.

- **Commercial email (CAN-SPAM Act, 15 U.S.C. 7701 onward; FTC rule, 16 CFR Part 316).** Newsletter and community emails can promote courses, products or events, so treat every one as covered: accurate From, reply-to and subject lines; the sending ministry's valid physical postal address in each email; a clear unsubscribe that works for at least 30 days after sending and is honoured within 10 business days, with no fee, sign-in or extra details asked. Harvest's explicit opt-in (Gate 1) already goes further than the US opt-out model; keep opt-in for everyone. The rule that a commercial email says it is an ad is waived only for recipients who gave prior affirmative consent, so the recorded opt-in is what earns that exemption. Never sell or pass on an address after it unsubscribes. Service messages (sign-in codes, community decision emails) are mostly exempt but must not be misleading.
- **State privacy laws.** About 20 states have broad consumer privacy laws (for example California, Colorado, Virginia, Connecticut, Oregon and Texas). Who they cover differs: some exempt nonprofits and some do not, and thresholds vary. Most treat religious beliefs as sensitive data that needs opt-in consent (a few, such as California, give a right to limit or opt out instead), which the explicit consent default (§1) already meets. Before real US data, check which laws reach Harvest (as a business and as a processor) and each ministry, and whether the ministry DPA's processor terms meet them.
- **Consumer health data.** Prayer requests can include health details. Washington's My Health My Data Act and similar state laws set their own consent and notice rules for health data. Check them before prayer requests (§12) go live for US users.
- **Breach notification.** Every US state has its own breach-notification law, with its own triggers and deadlines. Add the US route to the §15 steps before real US data.
- **Children.** Adults only (§8) is meant to keep Harvest a general-audience, adults-only service. The US children's privacy law (COPPA, under 13) still applies if Harvest knows it holds a child's data, so the §8 close-and-erase rule must hold, and the Connect forms' adults-only notice (used at events where children may be present) is still to build.
- **Texting (TCPA and state laws such as Florida's).** The consent model has an SMS channel. Marketing texts need prior express written consent, quiet hours and a working opt-out. No SMS sending is in launch scope; any texting feature needs this review first.
- **Data location.** Unchanged: primary data stays in the EU (§10). Nothing above requires US data location.

**Still to build.** A sending ministry's postal address in newsletter and community email footers (not found in the code on 27 Nov); a check that every unsubscribe path takes effect within the 10-business-day limit; the state-law and health-data review above.

## 11. G2: public community contributions after leaving or deleting an account

**Policy (founder, 27 Nov).**
- **Leaving a community:** their forum posts, replies, channel messages and DMs stay, but are anonymised. Their name and photo are removed and the author shows as "Former member".
- **Deleting the whole account:** their forum posts, replies and channel messages stay as "Former member". Their DMs are deleted.

Before leaving, they can delete their own posts. They can also ask the ministry to delete specific posts at any time.

**Reasoning.** Keeping a discussion readable is a legitimate interest of the community (Art. 6(1)(f)). Removing the name and photo limits the impact on the person. The text itself can still mention the person, so this is pseudonymisation, not full anonymisation. A specific request to delete a post is handled as an erasure request (Art. 17), and the ministry should agree unless it has a strong reason not to.

**What the code already does.**
- Account deletion clears the author on posts, replies and chat messages (`ON DELETE SET NULL` on `author_id`: `drizzle/0038_community_forum.sql`, `drizzle/0057_community_chat.sql`), so the name and photo no longer join.
- Volunteered profile fields are erased after leaving; leave reasons are deleted with the person: C23 items 13.1 and 13.2, `src/server/community-joining.ts` (`leaveCommunity`).

**Still to build.**
- On **leaving** a community, detach the author from that community's posts and replies (today the author link and name stay).
- Show "Former member" (today the post page falls back to a generic label from `t("unnamed")`).
- Clear the author from mentions and reactions, or show them as "Former member" too.
- On leaving: detach the author in that community's channels and in DMs started through it; show "Former member" in the chat and DM screens (already the fallback label there).
- On account deletion: the `chat-erasure` hook deletes the person's DMs (`docs/runbooks/communities.md`, `docs/setup/feature-flags.md`). Not built: today DM text outlives the account (`author_id` becomes null) until the 30-day purge removes deleted messages only.

## 12. G7: prayer requests in Community Live

**Policy (founder, 27 Nov).** Prayer requests are encrypted. Only the host team can read them. A request is deleted 30 days after it is closed, and at most 90 days after it was submitted, whichever comes first. Prayer-wall items are kept 180 days. Anonymous requests hide the author from other members; the host team can still see who wrote it, through an audited read, with a clear notice at submit (founder, 16 Nov).

**Lawful basis and Art. 9.** Consent (Art. 6(1)(a)) and explicit consent (Art. 9(2)(a)), captured with its own box at submit. A prayer request often includes health or family details, which are also special-category data. The notice says who can read it and for how long. The prayer wall needs a separate yes, because it is visible to more people.

**Access.** Host team: the community owner, admins and moderators (V1 prayer team, founder 16 Nov). Members see only wall items. Harvest staff: no access. Founder confirmed on 27 Nov that the host team is the owner, admins and moderators.

**Encryption.** A separate key purpose for prayer content (§6). Titles and bodies encrypted; only state and dates in clear.

**Code.** Nothing yet: Community Live L1 stores no prayer data (`docs/acceptance/community-live-l1.md`); L2 to L5 are parked. The retention job, encryption and audited reads must ship with the prayer feature, before any real data.

## 13. Records of Processing (Art. 30)

Harvest keeps this as processor (Art. 30(2)) and offers it to each ministry as a starting point for its own record (Art. 30(1)).

| Activity | Controller | People | Data | Purpose | Basis (Art. 6 / Art. 9) | Retention | Recipients |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Harvest accounts and sign-in | Harvest | Users | Name, email, sign-in codes, sessions | Provide the service | 6(1)(b) | While the account exists | Database, sign-in email provider |
| Harvest SaaS billing | Harvest | Account owners | Billing contact, plan, invoices | Billing | 6(1)(b), 6(1)(c) | Statutory accounting periods | SaaS billing provider |
| Connect intake | Ministry | Guests | Name, contact method, chosen purposes | Follow up as asked | 6(1)(a) / 9(2)(a) | 30 days unverified | Database, email provider |
| CRM | Ministry | Contacts | Contact details, notes, tasks, consents | Ministry relationships | 6(1)(a) or (f) / 9(2)(a) or (d) | Active, 24-month review | Database |
| Follow-up cases | Ministry | Guests | Case state, assignee | Pastoral follow-up | 6(1)(a) / 9(2)(a) | 12 months after closing | Assigned counselor |
| Newsletter | Ministry | Subscribers | Email, delivery and click records | Send newsletters | 6(1)(a) | Delivery and clicks 90 days | Email provider |
| Communities | Ministry | Members | Profile, posts, chat, applications | Run the community | 6(1)(b) / 9(2)(a) or (d) where faith is revealed | See §5 | Members of that community |
| Prayer requests | Ministry | Members | Request text | Prayer | 6(1)(a) / 9(2)(a) | 30/90/180 days | Host team |
| Discover review | Harvest | Ministry staff | Listing public fields, review state | Platform safety | 6(1)(f) | While listed, plus audit period | Harvest staff |
| Giving takedown reports | Harvest | Reporters (anonymous), ministries | Reason, short note | Stop impersonation | 6(1)(f) | Audit period | Harvest staff |
| Donations and sales (planned) | Ministry | Donors, buyers | Payment status, amount, receipt | Receive gifts and sell | 6(1)(b), 6(1)(c) | Statutory periods | Payment provider |
| Social scheduler and inbox | Ministry | Social contacts | Messages, handles | Manage social accounts | 6(1)(f) | To set | Social provider |

## 14. DPIA outline (Art. 35)

A DPIA is likely needed: Harvest processes religious data, sometimes about people met once at an event, with new technology and across many ministries. Outline:

1. **Description.** Flows in §13, data map, providers in §10.
2. **Necessity and proportionality.** Purposes, bases, minimisation (no religious labels, no inferred data), retention (§5), rights (§7).
3. **Risks to people.** Exposure of faith, outing someone to family or employer, unwanted contact, a leak of prayer content, a staff member misusing access, a cross-ministry leak.
4. **Measures.** Row-level security per ministry, owner/admin-only pending data, encryption (§6), small-group suppression, audited reads, retention jobs, adults only, staff least privilege.
5. **Residual risk and sign-off.** Founder sign-off; qualified review recommended. If high risk remains after measures, prior consultation with a supervisory authority (Art. 36).
6. **Review.** Before launch and after any new sensitive feature (prayer, referrals, minors).

## 15. Breach notification

Steps.

1. **Detect and contain.** Anyone who suspects a breach tells the founder at once. Revoke keys or sessions, disable the affected route by its hard-off switch, keep logs.
2. **Assess within 24 hours.** What data, which ministries, how many people, special-category or not, likely harm.
3. **Tell ministries.** As processor, Harvest tells each affected ministry without undue delay (Art. 33(2)); the draft DPA promises within 24 hours of confirming.
4. **Supervisory authority.** For Harvest's own data, Harvest notifies the lead authority within 72 hours of becoming aware, unless the breach is unlikely to risk people's rights (Art. 33(1)). For ministry data, the ministry notifies; Harvest provides the facts.
5. **People.** If the risk is high (likely for faith or prayer data), affected people are told in plain language without undue delay (Art. 34).
6. **Record.** Every breach goes in a breach log, even ones not reported (Art. 33(5)).
7. **Learn.** A short review and a fix within two weeks.

Breach and system alerts go to the founder's mailbox for now (founder, 27 Nov; the address is not written in the repository). The owner of the breach log and the lead supervisory authority are still to be chosen.

## 16. Founder approval checklist

**All 16 lines ticked by the founder on 27 Nov 2026** (engineering-drafted policy, not legal advice). Evidence: a line-by-line walkthrough in the coordinating Claude chat, 08:54 to 09:00 Berlin; the founder answered "Agreed" to the first line and "Approve" to each of the other fifteen, in checklist order. The approval is recorded in the [gate register](hc-02-activation-gates.md) table.

- [x] I understand these are engineering best-practice drafts, not legal advice, and that a qualified review is recommended before real data.
- [x] **Gate 1 (purposes):** approve the §2 text.
- [x] **Gate 2 (pending access):** approve the §3 text.
- [x] **Gate 3 (erasure tombstones):** approve the §4 text (90 days, fewer than 5 hidden).
- [x] **Gate 4 (retention):** approve the §5 text and table, including the three periods chosen on 27 Nov (24 months, 12 months, 3 years).
- [x] **Gate 5 (encryption):** approve the §6 text and key plan.
- [x] Explicit consent (Art. 9(2)(a)) is the default for religious and pastoral data; Art. 9(2)(d) only for a ministry's own member records (§1).
- [x] Rights-request steps (§7).
- [x] Adults only at launch (§8).
- [x] CRM contact visibility, audit retention and denial logging policies (§9).
- [x] Transfer rule: primary data in the EU, signed DPAs, sub-processor list, and US email delivery under the DPF or SCCs (§10).
- [x] G2 policy (§11): posts, replies and channel messages stay as "Former member" on leaving and on account deletion; DMs stay as "Former member" on leaving and are deleted on account deletion.
- [x] G7 prayer policy, host team = owner, admins and moderators (§12).
- [x] Records of Processing table (§13).
- [x] Do a DPIA from the §14 outline before launch.
- [x] Breach steps (§15).

After the approval, only "Draft" and "(proposed)" labels were removed (§1, §6, §7, §9, §10, §13, §14, §15, and the Gate 4 status note); no other approved wording changed. §10a was added afterwards and is marked as such.

Still open after approval (not decided on 27 Nov): the owner of the breach log and the lead supervisory authority (§15), and the US reviews in §10a.

Approval of these lines does not approve real collection, sending, payments, a deployment or a production migration. Real data stays hard-disabled until each "Still to build" item for that gate is built, reviewed and separately approved for activation.
