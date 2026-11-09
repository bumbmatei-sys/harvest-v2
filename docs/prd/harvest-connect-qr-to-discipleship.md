# Harvest Connect — QR-to-Discipleship Product Requirements Document

> **Latest payment clarification (2026-11-09):** Dodo handles **Harvest platform subscriptions**. The provider for donations to churches, evangelistic organizations and individual missionaries is **undecided**, as is the provider for creator products; Stripe is a candidate, not an approved solution. Keep QR response/discipleship consent separate from giving. See [payment decision](../decisions/0012-payment-provider-separation.md).

> **Professional V1 Discovery/creator clarification (2026-11-09):** The Skool/Eden-style Discovery described here is a launch requirement. Public discovery covers opt-in communities by churches, missionary ministries, individual missionaries and Christian influencers; creators can sell Harvest-native courses, downloads and memberships inside communities through reusable shared product/checkout/entitlement systems. Never auto-enroll QR responders or expose sensitive CRM/religious decisions. Stripe-first donations/commerce require platform eligibility and proper recipient-of-funds approval. See [`../plans/professional-v1-first-eight-prs.md`](../plans/professional-v1-first-eight-prs.md).

**Document ID:** HARVEST-CONNECT-PRD-001  
**Version:** 1.1  
**Status:** Proposed / implementation-ready requirements, subject to product and legal review  
**Date:** 2026-11-06  
**Owner:** Harvest product team  
**Suggested repository path:** `docs/prd/harvest-connect-qr-to-discipleship.md`  
**Parent specifications:** Harvest Master PRD v2.5; Companion Implementation PRD v2.7  
**Type:** Standalone companion feature PRD — does not supersede the master roadmap

---

## 0. Executive summary

**Harvest Connect** is the path from a public evangelistic event to voluntary, ongoing Christian discipleship through Harvest. An organizer displays a campaign-specific QR code; a visitor opens a fast mobile response page, can receive immediate free resources, can optionally request follow-up, and can create a free Harvest account. The account leads to a **Skool/Eden-style community discovery page** where people can browse and choose free communities, courses, and local churches. Pastors and approved community teams can welcome members and conduct follow-up **only with appropriate access and permission**.

**Foundational principle:** QR response, free-account registration, community membership, pastoral follow-up, and newsletter marketing are **separate, optional decisions**. A QR scan or Gospel response must never automatically enroll a person, label their public profile with a religious decision, or share their details among participating churches.

This PRD covers: response forms, unique QR links, registration handoff, community discovery, optional church referral, CRM integration, follow-up pipeline, counselor operations, **campaign-specific fundraising, donations and budget integration**, analytics, permissions, privacy, accessibility, data design, proposed API contracts, error states, implementation slices, and testing. It defines a repeatable template for crusades, conferences, mission trips, street evangelism, and Sunday church events.

### 0.1 Why this belongs in Harvest

The system joins existing planned modules rather than creating competing versions of them:

| Existing / planned platform service | Reuse in Harvest Connect |
|---|---|
| Campaigns & Projects | Campaign, event night, venue, QR links, campaign dashboard |
| Forms | Public response pages, schema validation, consent controls |
| CRM (Twenty-inspired) | Contact identity, consent-aware source associations, assignments, deduplication |
| Authentication / free accounts | Passwordless invitation, login, verified identity, account lifecycle |
| Communities | Discover directory, membership, invitations, roles, posts, pastor moderation |
| Courses / Discipleship Journeys | Starter pack, Bible studies, lessons and progress |
| Church directory / maps | Optional church finder and user-authorized referrals |
| Notifications / Email / SMS | Transactional invitation and permitted follow-up communications |
| AI assistants | Optional drafts/summaries with strict permissions; not autonomous pastoral decisions |
| Analytics | Aggregate funnel and operational readiness dashboards |
| Campaign budgets / finance | Campaign-restricted donation drives, budgets, expenses, reconciliation and reporting |
| General Fundraising | Separate platform-wide campaigns, donor stewardship and donation management; shared payment infrastructure, distinct financial scope |

**Explicitly excluded:** Eden-style *content research and competitive discovery*, browser extensions, ERP, involuntary enrollment, automatic religious profiling for advertising, and unconsented contact sharing. **Community Discovery** is a different, included feature.

## 1. Goals, outcomes and non-goals

### 1.1 Product goals

1. Permit a person at a large event to access a safe, low-bandwidth mobile page in seconds via QR or short URL.
2. Offer free Bible resources immediately, including without creating an account.
3. Capture only information needed for the particular requested action, after clear notice and an appropriate lawful basis.
4. Make free account creation easy, without conditioning resource access or pastoral support on becoming a platform user.
5. Help new users discover relevant **free** communities and choose to join them.
6. Provide a controlled path for connecting to a local church or requesting a pastor/counselor contact.
7. Give campaign organizers operational metrics while protecting response details and religious information.
8. Scale from a local church gathering to mass crusade QR bursts and low-connectivity environments.
9. Keep records portable, editable and erasable, with verifiable consent and audit trails.
10. Give each crusade its own fundraising and donations workflow, automatically reflected in that campaign’s budget, without mixing funds or dashboards with general fundraising.

### 1.2 Proposed success measures (targets to validate with pilots, not promised outcomes)

| Metric | Definition | Target / measurement note |
|---|---|---|
| QR landing reliability | Successful page requests / attempts | SLO target 99.9% during campaign windows |
| QR page speed | p75 LCP on representative mobile devices | Target ≤ 2.5s under realistic 4G; low bandwidth fallback |
| Form completion | Valid submissions / form starts | Observe and improve; no assumed conversion rate |
| Account activation | Verified accounts / invitation recipients | Track cohorts, no fixed target until pilot |
| Community join | Users joining at least one free community / activated free accounts | Measure consentfully; do not publicly rank individuals |
| Follow-up first response | Median elapsed time from a *requested* contact to first recorded attempt | Campaign-configurable SLA; e.g., within 48h where operationally possible |
| Referral completion | Accepted, authorized referrals / referrals requested | Monitor anonymized aggregate only by default |
| Privacy incidents | Confirmed unauthorized disclosure of personal response data | Zero tolerance; alert and investigate |

### 1.3 Non-goals for initial release

- Automatically detecting or asserting whether someone is Christian or genuinely converted.
- Inferring religious beliefs from attendance, location, activity, or AI analysis.
- Capturing detailed counseling or prayer notes by default.
- Giving all partner churches access to one shared roster of people who responded.
- Compulsory newsletter subscription, compulsive free account, or default community enrollment.
- Geolocating people without their permission.
- Replacing face-to-face pastoral care with autonomous AI.

## 2. Personas and access roles

| Persona | Core need | Allowed access |
|---|---|---|
| Visitor / responder (guest) | Free content and optional connection | Their own submitted data / public resources; no campaign dashboard |
| Free Harvest member | Discover/join communities; manage preferences | Their account, memberships and chosen communities |
| Community pastor/leader | Welcome, disciple and moderate their members | Community-specific members and requested interactions; no blanket campaign roster |
| Approved follow-up counselor | Contact assigned people who requested contact | Minimal details for their assignment only |
| Church liaison | Accept user-authorized referral to their church | Only referred person and consented referral data |
| Campaign volunteer | Help attendees complete a response | Limited assisted-registration permissions; no broad export |
| Campaign director | Monitor aggregated campaign activity and operations | Aggregate trends, tasks and controlled operational reports; special-category data only if separately authorized and necessary |
| Data/privacy administrator | Handle requests, audit access, retention | Restricted audited administrative access |
| Platform administrator | Maintain service and troubleshoot | No routine access to sensitive ministry content |

### 2.1 Access boundaries

- Three distinct associations: **tenant workspace → campaign → response source**; **free Harvest identity → voluntary community membership**; **follow-up assignment → authorized counselor/church**.
- Members may join communities across workspaces where permitted. This **does not** grant the community's workspace access to the member's origin campaign, prior forms, or counseling notes.
- A campaign can partner with multiple churches; affiliation is not permission to read responder records.
- A free account is a platform identity, not automatically a paying ministry workspace.
- All sensitive actions are checked server-side; client visibility alone is never authorization.

## 3. End-to-end journeys and requirements

### J1 — Scan and access resources without signup

1. Organizer opens a specific campaign/event QR display page.
2. Visitor scans QR or enters short URL; localized mobile response page opens.
3. Visitor may choose **Explore free resources** without entering personal information.
4. Resource landing offers an introductory Bible reading plan, common questions and links to public/free communities.
5. No individual-level religious response is recorded solely from viewing the page. Use privacy-aware aggregate analytics if enabled.

**Acceptance:** Public resource navigation works without authentication, a phone number or an email address.

### J2 — Optional interest / follow-up response

1. Visitor chooses **I'd like someone to contact me** or **Send me an invitation to free Harvest**.
2. Form displays a purpose-specific explanation and collects the minimal fields needed (e.g., first name or preferred name; email or phone **only if** selected delivery method needs it).
3. An independent optional choice controls follow-up permission, and a separate optional choice controls newsletters/marketing.
4. Sensitive religious-response data is **not required** to obtain free resources or create an account; any optional response classification uses carefully assessed legal safeguards.
5. On submission, backend validates, rate-limits, logs applicable consent evidence and creates a pending response or verified contact association.
6. Confirmation page shows what happens next, gives resource links, and allows immediate opt-out/withdrawal where possible.

**Acceptance:** No opt-in is pre-checked; no marketing opt-in is implied by submission; users can submit only for the purpose they selected.

### J3 — Free account invitation and activation

1. If requested and an appropriate verified delivery path exists, send a short-lived, one-time, opaque invitation link (no personal/sensitive data embedded).
2. User verifies control of the email address or phone number by a supported secure method.
3. If user already has a Harvest account, sign in and let them confirm whether to associate the invitation with it.
4. New users set a basic profile: display name, language, optional city; omit a religious-status field.
5. User sees an onboarding choice: `Find a free community`, `Start a Bible course`, `Find a church`, `Explore later`.
6. The verified identity is linked to eligible response records only through an authorized, non-enumerable token flow.

**Acceptance:** Expired/replayed tokens fail safely; duplicate signups merge or link only after ownership verification; invitation abandonment never blocks resource access.

### J4 — Skool/Eden-style community discovery

1. Authenticated free user lands on `/discover/communities` (route proposed).
2. Directory lists **approved and discoverable communities**, defaulting to free memberships and language-matched results.
3. Filters: free/public/private, language, online vs local, city/region (voluntary), interests/topics, beginner Bible study, denomination (optional), events and courses.
4. Card: cover image, name, short description, language, free/paid status, available courses, moderators/pastoral contact, approved membership count when appropriate, and `View community` action.
5. A campaign's organizer community may appear as a **featured suggestion** labeled clearly as a recommendation, never as a compulsory membership.
6. Users choose `Join free`, `Request access`, or `View`, depending on community policy.
7. Show confirmation of permissions/community rules; users can leave and manage notification preferences.
8. Public browse previews can be available to guests; write/interact features require account and community authorization.

**Acceptance:** No unapproved communities appear in directory; discoverability can be switched off by owners; joining one community cannot leak membership in another.

### J5 — Discipleship welcome and course journey

1. After voluntary community membership, user sees a welcome page, available pastor/mentor contact options, beginner lessons and upcoming events.
2. Optional community-created `New Here` course path (e.g., introduction to Scripture, prayer, finding a church) is offered but **not automatically recorded as religious conversion**.
3. Community leader can publish lessons, questions, discussions and events using existing Community/Courses modules.
4. If the member requests personal care, create a scoped pastoral follow-up request; otherwise no counselor task.
5. User can manage notification frequency, mute/leave community, and access their data controls.

**Acceptance:** Discipleship is user-directed; only community members and authorized moderators can view private community content.

### J6 — Local church discovery and user-authorized referral

1. User clicks `Find a local church` and voluntarily supplies city or chooses a map area. Device location requires explicit permission.
2. List and map show **verified, actively participating** churches with service details, language, contact options, accessibility and website.
3. User selects a church and chooses whether to share contact information.
4. Harvest displays precisely which data will be shared and records specific authorization before creating the referral.
5. Church liaison receives only the authorized details, accepts/declines referral, and optionally records contact outcomes.
6. User receives status and may revoke future contact / manage deletion subject to applicable retention duties.

**Acceptance:** Referrals are never bulk-assigned to churches by geography without a user decision and a valid legal basis. Maps reveal church locations, not respondent locations.

### J7 — Counselor-assisted response at events

1. Authorized volunteer uses `Assisted signup` on a campaign-issued device with time-limited access.
2. Volunteer displays privacy and consent language to the individual and captures only their affirmative choices.
3. Volunteer may submit while offline if device policy permits encrypted local queue; otherwise supply printable short URL/QR and safe fallback.
4. Data syncs with visible pending/success/error status; deduplication is idempotent.
5. No volunteer can impersonate a person to create a permanent account without their own verification.
6. Assisted intake is auditable, including staff identity and device/session, without generating public lists.

**Acceptance:** Lost device can be revoked; data never remains indefinitely in an unencrypted local cache.

### J8 — Campaign/pastor follow-up

1. Admin sees counts of **opt-in follow-up requests**, pending assignments and SLA breaches.
2. Authorized follow-up coordinator assigns a case to a screened counselor or selected church liaison as permitted.
3. Counselor sees contact name, method, language, availability, consent scope and minimal context; any optional counseling notes require elevated policy and access.
4. Contact attempts and outcomes are recorded. Statuses: `requested`, `awaiting_assignment`, `assigned`, `attempted`, `connected`, `referred`, `closed`, `withdrawn`.
5. If contact preference is withdrawn, pending sends/assignments are disabled according to policy and lawful retention constraints.
6. Campaign organizers get aggregate progress without access to detailed counseling contents by default.

**Acceptance:** No auto-DM, newsletter, or pastoral contact runs merely because a QR was scanned or a form was submitted for a different purpose.

## 4. Page and screen inventory

| Proposed path / view | Audience | Main elements |
|---|---|---|
| `/c/[publicCode]` | Guest | Mobile QR landing, campaign identity, language selector, resource/response CTAs |
| `/c/[publicCode]/respond` | Guest | Short dynamic form, contextual privacy notice, distinct opt-ins, accessible validation |
| `/c/[publicCode]/thanks` | Guest | Welcome, immediate resources, optional account entry and follow-up status |
| `/resources/start` | Guest/member | Public starter Bible resources and guide |
| `/auth/invite/[token]` | Invited user | Verified one-use activation and replay/expiry handling |
| `/onboarding` | Member | Lightweight profile/preferences, optional path choice |
| `/discover/communities` | Guest/member | Free community directory, search, filters, featured suggestions |
| `/communities/[slug]` | Guest/member | Preview, rules, join/request access, courses, events |
| `/my/communities` | Member | Memberships, onboarding, notifications, leave controls |
| `/discover/churches` | Guest/member | Church directory/map, filters, safe location search |
| `/churches/[slug]` | Guest/member | Verified church profile and optional contact/referral request |
| `/my/follow-up` | Member | Request status, preferences, change/withdraw permissions |
| `/w/[workspace]/campaigns/[id]/connect` | Campaign manager | QR links, event nights, language variants, preview, configuration |
| `/w/[workspace]/campaigns/[id]/connect/analytics` | Campaign manager | Aggregate funnel, opt-in requests, capacity, errors |
| `/w/[workspace]/follow-up` | Follow-up coordinator | Queue, assignment, status, SLA, scoped reports |
| `/w/[workspace]/follow-up/[id]` | Authorized counselor | Individual permitted record, communication history, outcome |
| `/w/[workspace]/church-referrals` | Church liaison | Assigned/authorized referrals and acceptance |
| `/w/[workspace]/settings/consent` | Privacy administrator | Consent versions, retention policy, DSAR tooling, audit |

Routes are **proposals**, not statements about current Harvest v1 or v2 implementation. Final routes must follow repo routing and conventions.

## 5. Campaign QR and form builder specification

### 5.1 QR configurations

- Each QR code belongs to exactly one campaign and optionally one sub-event/night, venue, screen and language.
- Human-friendly short URL accompanies code for people whose devices cannot scan.
- Use unguessable public identifiers; do not place personal identifiers or secrets in QR URL.
- Allow branded logos, color contrast checks, printable PNG/SVG/PDF exports, projection display mode, and a test/preview mode.
- Track aggregate scan counts separately from personally identifiable form records; do not infer religious status from scans.
- QR links can be paused, expired, redirected to archive resources, or rotated; old links fail gracefully.
- Language is configurable and can be selected by visitor; translations need human review for doctrinal clarity and consent wording.
- Anti-abuse: WAF/rate limiting, honeypot, adaptive bot defense; do not block shared church Wi-Fi or high-volume venue traffic by naive IP-only limits.

### 5.2 Response form fields

**Default minimum:** optional preferred name; selected purpose; **only** the contact field needed if an invitation/follow-up is requested; language preference. Do not ask for birth date, full address, denomination, church membership, or testimony unless separately justified.

**Conditional fields:** email address or phone; preferred communication channel; optional city (for church finder); optional availability; optional free-text request (privacy warning and strict access); separate follow-up and newsletter permissions.

**Required controls:** accessible labels, clear error handling, progressive disclosure, language selector, no misleading required checkboxes, privacy link, delete/request-data link, and contact-method-specific consent.

**Campaign-configurable** only within platform policy: title, header image, organizer name, translated text, optional resource links, approved field presets, campaign-specific follow-up team, availability windows, retention period from policy; campaign admins cannot disable non-negotiable privacy safeguards.

### 5.3 Purpose separation

Treat these as independent actions / reasons for processing:

| Purpose | Example user choice | Required behavior |
|---|---|---|
| Access free public resource | `Read the starter guide` | No account or contact required |
| Create Harvest account | `Create my free account` | Identity verification and account-specific notice |
| Receive transactional invitation | `Send my sign-in link` | Limited to requested invitation; no marketing |
| Ask for pastoral contact | `I'd like someone to contact me` | Specific permission and safeguarded record handling |
| Request referral | `Share my details with this church` | Specific destination disclosed; no broad church access |
| Subscribe to newsletter | `Send me optional updates` | Separate, unbundled marketing permission and unsubscribe |
| Record optional response category | `I want to share this response` | Only if justified by explicit, appropriately designed privacy/legal controls |

## 6. Community Discovery product specification

This feature is **first-class free-account functionality**, independent of content-competitor discovery.

### 6.1 Directory taxonomy

- Topics: new believer questions, Bible study, prayer, family, youth/adults, evangelism, discipleship, ministries (editable taxonomy).
- Language and translated descriptions; country/region/city as optional self-declared data.
- Visibility: `public_directory`, `unlisted`, `private`.
- Access: `free_open`, `free_approval`, `paid` (paid not prioritized by default for crusade onboarding).
- Organization verification badge only after an actual review process (avoid unsubstantiated endorsements).
- Respect capacity and moderation/safeguarding requirements.

### 6.2 Discovery ranking v1

1. User-selected language and publicly known community eligibility.
2. Optional chosen region / online availability.
3. Campaign organizer's featured community, clearly marked as featured.
4. Quality/safety/moderation signals and freshness.
5. User-controlled filters and sort.

No targeting based on inferred sensitive belief data, protected traits, or unconsented response records. Explain results and provide simple sorting.

### 6.3 Join flow

- Public free: user explicitly clicks Join; create membership after permission checks.
- Approval: create request; notify moderators; avoid exposing sensitive intake questions in public feed.
- Invite-only: require valid invitation or configured eligibility; no visibility in public directory by default.
- Paid: link to commerce module, not part of initial response funnel.
- Leaving: immediate removal from community access, with appropriately scoped content retention policy and notification stop.

### 6.4 Community owner controls

Owners choose discoverability, admission policy, languages, moderation, leadership contact methods, `New Here` welcome material, courses/events display, and reporting. Community member lists are isolated from campaign responder lists.

## 7. Follow-up pipeline and church referrals

### 7.1 Follow-up case lifecycle

```
requested -> awaiting_assignment -> assigned -> attempted -> connected -> closed
                     |                |          |           |
                     v                v          v           v
                 withdrawn          reassigned  no_response  referred
```

Terminal states may include `withdrawn`, `closed`, `completed`, and `unable_to_contact`. Define a guarded transition table in code; never accept arbitrary status strings.

### 7.2 Case capabilities

- Assign/reassign by appropriate language, timezone, availability, church connection and counselor workload.
- Set campaign-specific SLA for first contact and configurable reminders; avoid notification spam.
- Case notes are permission-scoped, minimal and time-limited; users should not need to share private counseling details for follow-up.
- Record attempt metadata (channel, time, disposition) rather than message contents whenever possible.
- Escalate safeguarding/emergency issues to designated trained professionals, not AI; include emergency guidance for staff.
- Archive or close on withdrawal, completion or retention deadline.

### 7.3 Cross-church referral

- A church must opt into the network and designate a responsible liaison.
- Person selects church and approves a specific disclosure; referral envelope states church ID, disclosed fields, purpose, expiry and versioned permission evidence.
- Receiving church accepts/refuses; refusal returns case to coordinator without sharing elsewhere.
- Revocation stops future use/contact where applicable; obligations and retained audit entries follow applicable law.
- Counselors and churches must not bulk-export campaign contact records without special authorization and legal review.

## 8. Notifications and provider integrations

- Use Harvest notification service for invitation, event confirmation, approved counselor assignment and status updates.
- Zernio/connected email/SMS/WhatsApp adapters are optional **where provider functionality and policy permit**; verify exact API operations, template rules, opt-in, delivery receipts, quotas and webhook authentication before enabling.
- Use email/passwordless identity providers or other verified activation path; do not treat a social DM as equivalent to account identity verification unless securely implemented.
- Template catalog: `account_invite`, `requested_followup_ack`, `counselor_assignment`, `referral_status`, `community_join_welcome`, `withdrawal_confirmation`.
- Marketing flows use separate subscribers/permission; suppress unsubscribes, bounces and revoked consents.
- Retry transient failures using queues with backoff and dead-letter handling; never spam duplicates when providers timeout.

## 9. Proposed data model — Neon PostgreSQL

> Schema is conceptual: adapt naming to the canonical Harvest v2 schema and Drizzle conventions. Prefer explicit foreign keys, unique constraints, timestamps, tenant-scoped indexes and soft/deletion policies. Avoid duplicating canonical `users`, `workspaces`, `contacts`, `communities`, `memberships`, `campaigns`, `events` and `churches` tables.

### 9.1 New or extended tables

| Table | Key columns / relationships | Requirements |
|---|---|---|
| `campaign_response_links` | `id`, `workspace_id`, `campaign_id`, `event_id?`, `public_code`, `locale`, `status`, `expires_at?` | Unique public code; control publish/disable; no personal fields |
| `campaign_form_versions` | `id`, `campaign_id`, `form_definition_id`, `version`, `notice_version`, `published_at` | Immutable published consent/form versions |
| `campaign_responses` | `id`, `workspace_id`, `campaign_id`, `response_link_id`, `contact_id?`, `public_submission_id`, `purpose`, `submitted_at`, `status` | Minimize data; idempotent insertion; restricted access |
| `response_contact_methods` | `id`, `response_id`, `type`, `encrypted_value_ref`, `verified_at?` | Store securely; avoid duplicating PII unnecessarily |
| `consent_records` (extend existing) | `id`, `subject_ref`, `purpose`, `status`, `notice_version`, `captured_at`, `withdrawn_at?`, `source`, `recipient_scope?` | Immutable evidence + revocation events; clarify lawful basis separately |
| `response_account_claims` | `id`, `response_id`, `user_id?`, `token_hash`, `expires_at`, `consumed_at?` | One-time claim; hash tokens; no token in logs |
| `followup_cases` | `id`, `workspace_id`, `campaign_id`, `response_id?`, `contact_id?`, `status`, `priority`, `assigned_to?`, `due_at?` | Scope access; no assumption of religious decision |
| `followup_case_events` | `id`, `case_id`, `actor_id`, `event_type`, `metadata`, `occurred_at` | Audit state transitions; redact private content |
| `church_referrals` | `id`, `case_id?`, `referring_workspace_id`, `receiving_church_id`, `consent_id`, `status`, `expires_at?` | Scoped handoff; explicit user-approved destination |
| `community_discovery_profiles` | `community_id`, `directory_visibility`, `languages`, `region?`, `access_type`, `moderation_status` | Publish only approved/eligible communities |
| `campaign_connect_analytics_daily` | `campaign_id`, `date`, `locale`, `source_key`, aggregate counts | Aggregated; minimum cohort thresholds for small groups |
| `delivery_attempts` (reuse if exists) | `template`, `recipient_ref`, `provider`, `status`, `idempotency_key`, `attempts` | No duplicate sends; provider webhook validation |

### 9.2 Important constraints and privacy attributes

- Every campaign-linked row has an authoritative `workspace_id` or gets tenant authorization through an explicit verified parent relation.
- External free accounts live in shared platform identity; workspace membership is a separate row and never implied.
- Sensitive response categories, if ever collected, belong in a restricted logically separated table or purpose-specific record with additional controls, not a generic CRM `tags[]` field.
- Store hashed single-use invitation tokens, expire and revoke them, and use secure random generation.
- Set unique constraints on `(campaign_id, public_submission_id)` and each provider delivery idempotency key.
- Normalized foreign keys link community membership to a real `user_id`; never write membership before explicit choice.
- Delete/erase personal data with dependent-reference safety; preserve only lawfully required minimal audit/transaction data.
- Postgres RLS or equivalent database-enforced tenant isolation must be part of the architecture, tested with multiple workspaces; service credentials must not bypass all policy in normal request execution.

### 9.3 Suggested event contracts (internal)

Events, each with event ID, tenant scope, actor, dedupe key, timestamp and schema version:

`connect.qr_link_created`, `connect.response_submitted`, `connect.invitation_requested`, `connect.account_claimed`, `connect.community_join_requested`, `connect.community_joined`, `connect.followup_requested`, `connect.case_assigned`, `connect.referral_requested`, `connect.referral_accepted`, `connect.consent_withdrawn`.

Never send raw religious-response details, phone numbers or prayer notes in generic event buses or analytics payloads.

## 10. API contract proposals

> All endpoints are **Harvest-owned proposed APIs**, not assertions of existing repository routes. Validate versioning, authentication framework and naming during implementation.

| Operation | Example route | Authentication and safeguards |
|---|---|---|
| Resolve public QR link | `GET /api/public/connect/{code}` | Public; validate link active; cache safe metadata |
| Submit response | `POST /api/public/connect/{code}/responses` | Public; schema validation, consent/purpose check, abuse controls, idempotency key |
| Get public resources | `GET /api/public/resources/starter` | Public; no contact requirement |
| Request activation | `POST /api/public/connect/invitations` | Verify purpose, rate limit, avoid account enumeration |
| Claim invitation | `POST /api/connect/invitations/claim` | Verified account, one-time token, CSRF/nonce protection |
| List directory | `GET /api/discovery/communities` | Public or member; enforce discoverable only |
| Join free community | `POST /api/communities/{id}/join` | Authenticated; explicit action, eligibility check |
| Request church referral | `POST /api/me/church-referrals` | Authenticated or secure verified guest flow; explicit recipient & permission |
| Get my follow-up | `GET /api/me/followup-cases` | Subject-only secure access |
| Withdraw permissions | `POST /api/me/consents/{id}/withdraw` | Verified owner; effect propagated to queues |
| Configure QR campaign | `POST /api/workspaces/{wid}/campaigns/{cid}/connect-links` | Workspace+campaign editor scope |
| Campaign analytics | `GET /api/workspaces/{wid}/campaigns/{cid}/connect-metrics` | Authorized manager; aggregate only |
| Manage follow-up | `GET/PATCH /api/workspaces/{wid}/followup-cases/{caseId}` | Scoped counselor/coordinator; server enforced |
| Accept referral | `POST /api/churches/{churchId}/referrals/{rid}/accept` | Approved liaison with valid recipient scope |

### 10.1 Example public submission body

```json
{
  "submissionId": "client-generated-uuid",
  "purpose": "request_followup",
  "locale": "en",
  "preferredName": "Sample",
  "contact": {"channel": "email", "value": "example@example.org"},
  "choices": {
    "pastoralFollowup": true,
    "accountInvitation": false,
    "newsletterMarketing": false
  },
  "consentNoticeVersion": "campaign-2027-01"
}
```

Example only, not a provider-specific schema. The actual API **must not infer legal consent from these booleans alone**; it also needs time, purpose-specific evidence and an appropriate lawful basis / special-category condition. Do not expose private fields in the API response.

### 10.2 Failure and edge cases

| Situation | Expected behavior |
|---|---|
| Huge concurrent QR traffic | Autoscaling/caching, queue writes where suitable, meaningful error page and retries |
| Poor/no internet | Lightweight public HTML, delayed retry; staff-assisted offline queue only if securely implemented |
| Duplicate QR submissions | Idempotent response; no duplicate invitation, CRM identity or follow-up case |
| Same email used previously | Require account verification before link; avoid account enumeration |
| Unreachable email/phone | Visible correction path, no endless retries; no marketing fallback |
| Token expired/replayed | Safe expiry display and new verified request; old token cannot claim record |
| Person clicks resource-only | No CRM contact or religious status created |
| Marketing unchecked | No newsletter/subscriber marketing registration |
| Follow-up permission withdrawn | Cancel queued contact and restrict case; preserve only necessary audit records |
| Church declines referral | Notify relevant staff/user; offer user-controlled alternative, no silent reassignment |
| Community full / approval required | Explain status, show alternatives; no automatic membership |
| Attendee is a minor | Age-appropriate policy, guardian flows where legally required; no public youth roster |
| QR link disabled | Informative page with safe general resources and support link |
| Abusive staff access | Deny and audit; alert privacy administrator for suspicious patterns |

## 11. Security, privacy and safeguarding requirements

> **Legal review required.** Religious-belief data may be a special category of personal data under GDPR Article 9 and analogous laws. Do not assume ordinary newsletter consent is sufficient. Determine lawful bases, Article 9 condition, controller/processor relationships, cross-border transfers, retention, privacy notices, minors' rules and any DPIA with qualified counsel before production.

1. **Minimize collection.** A guest must be able to read free resources without identifying themselves. Do not collect unnecessary religious-status data.
2. **Granular choice.** Separate transactional/account invitation, pastoral contact, church referral and marketing communications; never pre-check opt-ins.
3. **Account control.** Account creation is optional, ownership-verified, and does not require membership in a specific church or community.
4. **Sensitive data isolation.** Explicit deny-by-default for religious-response notes; case-specific access and audited elevation.
5. **Tenant isolation.** Test request, database, cache, storage, background job, search index and AI tool boundaries.
6. **Encrypt data in transit/at rest.** Apply stronger application-layer controls for unusually sensitive fields, and documented key management.
7. **Audit access.** Immutable or tamper-evident logs for consent changes, record views/exports, assignments, referrals and admin overrides. Minimize logged PII.
8. **Retention and deletion.** Configurable legally reviewed limits; expired invitations, abandoned form drafts and offline queues are cleaned promptly; honor rights requests.
9. **Child safety.** Youth-specific moderation, age-appropriate consent, trained staff assignment and safety escalation. Do not present minors in public member directories by default.
10. **Abuse protection.** Rate limits, anti-enumeration, CAPTCHA only when needed, secure outbound links, webhook signatures and spam filtering.
11. **No sensitive ad targeting.** Never export or sync faith-response status to advertising audiences or AI training data.
12. **AI guardrails.** AI can draft neutral follow-up messages for human review but cannot decide spiritual status, assign church referrals without permission, or read private counseling records by default.
13. **Emergency escalation.** Product does not provide emergency mental-health or medical services; present emergency contact guidance and staff protocols.
14. **Transparency.** Clear in-language notices identifying controller(s), recipients, purposes, retention and withdrawal/contact paths.

## 12. Analytics, dashboards and reporting

### 12.1 Campaign organizer metrics

- QR link views/starts (aggregate), form starts/completions, invitation requests, verified accounts, community discovery visits, voluntary joins, follow-up requests, assignments and SLA distribution.
- Breakdown by campaign/night/language only when safe aggregation thresholds are met; avoid small-cohort deanonymization.
- Conversion funnel **must not count an anonymous QR scan as a religious response**.
- Report `requestedFollowup` only when purpose choice recorded, not by inferred spirituality.
- Exports aggregate by default; person-level exports require policy-specific access, reason, audit and legal review.

### 12.2 Community dashboard

- Eligible join requests, new members, welcome completion, course participation, approved pastoral contact requests; no automatic access to origin campaign response details.

### 12.3 Follow-up management dashboard

- Open cases, SLA pending, team workload, unreachable outcomes, closures and consent withdrawals; personally identifying rows restricted to permitted teams.

## 13. Design system, accessibility and localization

- Use **shadcn/ui** and the existing Harvest UI tokens; do not introduce a second component framework.
- Reuse approved blocks for mobile form, directory cards, dashboard tables and pipelines; customize to Harvest branding.
- WCAG 2.2 AA target; keyboard navigation, screen-reader labels, sufficient contrast, clear focus states, inline validation and reduced-motion support.
- QR slide: high contrast, short URL, test from audience distance, no third-party trackers on first visit.
- Mobile-first, progressive loading, low-bandwidth mode and offline fallback instructions.
- Locale-specific consent text and copy approved by appropriate human reviewers; right-to-left layout support should be designed even if initially deferred.
- Free community discovery must feel welcoming, neutral in navigation, and not show paywalls as the default next step for a crusade response.

## 14. Requirements by priority

### P0 — Essential launch slice

- Event/campaign QR generator and configurable public landing.
- Public free resources without registration.
- Minimal optional response form with separation of purposes and privacy notice.
- Safe submission/dedupe, consent audit, campaign association, and transactional invitation.
- Verified free account signup and response claim flow.
- Free community discovery directory, search/filter and explicit join/request access.
- Pastor/community welcome and basic first-run course link.
- Optional follow-up request, assignment queue and guarded statuses.
- Campaign aggregate dashboard and strict permission/tenant checks.
- End-to-end flows, basic deletion/withdrawal and accessibility tests.

### P1 — Important expansion

- Church finder, verified directory and user-approved church referrals.
- Assisted signup with dedicated volunteer view.
- More languages and richer localization.
- Follow-up reminders, SLA reporting and controlled notification templates.
- Community leader onboarding tools, safety/trust controls and advanced course journeys.
- Detailed, privacy-aware funnel and cohort analytics.

### P2 — Advanced crusade operations

- Secure offline counselor intake and sync.
- Multi-church shared campaign operations with data-sharing agreements and scoped permissions.
- Advanced allocation/translation support, optional pastoral mentorship matching.
- AI-assisted drafting and analysis restricted to approved summaries, with human confirmation.
- QR variants for multiple venues, media sources and campaigns with advanced reporting.

## 15. Implementation sequence / pull request slices

**Do not implement all features as one PR.** Suggested slices are dependent and should be reviewed independently.

| PR | Scope | Done when |
|---|---|---|
| HC-01 | PRD architecture decisions, privacy threat model, data processing inventory | Legal/security signoffs listed; open decisions tracked |
| HC-02 | Tenant-scoped DB migrations, unique constraints, RLS/access tests | Cross-tenant access tests fail closed |
| HC-03 | Campaign QR link admin + publish/disable/rotate + short URL | Preview, download, revoke work |
| HC-04 | Mobile public landing and public starter resources | Guest path fully usable, low-bandwidth tested |
| HC-05 | Minimal response forms, distinct purposes, validated consent records | No implied marketing, idempotent submission |
| HC-06 | CRM association and contact deduplication under verified identity | Same person doesn't create duplicate case/contact on retry |
| HC-07 | Invitation delivery, secure one-use claim, existing-account handling | Replay, expiry and anti-enumeration tests pass |
| HC-08 | Free-account onboarding and privacy preferences | Can activate without enrolling in any community |
| HC-09 | Community discoverability schema, moderation and directory listing | Only eligible public/free communities returned |
| HC-10 | Filters, discovery search, recommendation labels and card UX | Accessible responsive discovery tested |
| HC-11 | Explicit free join, approval flows and leave/notification settings | Authorization and membership lifecycle tests pass |
| HC-12 | Community welcome and beginner course entry | New member sees opted-in community journey |
| HC-13 | Follow-up request + case lifecycle + counselor assignment | Scoped case access and state tests pass |
| HC-14 | Consent withdrawal, queued-message cancellation and DSAR hooks | Revocations propagate across jobs |
| HC-15 | Campaign aggregate metrics and privacy-safe funnel | No personal religious details on manager dashboard |
| HC-16 | QR crowd/load test, security review, release readiness | Launch gates in §16 pass |
| HC-17 | Church directory, location search and verified profiles (P1) | No device location unless user grants permission |
| HC-18 | User-authorized referrals + church liaison inbox (P1) | Only selected church receives approved fields |
| HC-19 | Staff-assisted mobile intake (P1) | Staff sessions auditable and non-impersonating |
| HC-20 | Offline secure queue, sync and conflict tests (P2) | Duplicate/loss and lost-device scenarios passed |

For a solo AI-assisted development workflow, typical vertical slices should be small enough to review, test and roll back independently. The table is a dependency-oriented proposal, **not a promise of exact PR count or duration**.

## 16. Definition of done and launch gates

A P0 release **cannot** be marked complete until all of the following are true:

- [ ] Public QR page, public resources and short URL function on a realistic mobile device without user account.
- [ ] An organizer can create, preview, rotate and disable campaign-specific QR links.
- [ ] A guest can opt into a narrowly defined purpose; all other purposes remain off.
- [ ] Transactional activation succeeds; token replay, expiry, account enumeration and duplicate submission are tested.
- [ ] Free account can explore and join an eligible free community by explicit action; existing accounts work too.
- [ ] Community owner can publish approved discoverable information and manage admissions.
- [ ] Requesting pastoral follow-up creates an authorized, auditable assignment; no request creates no assignment.
- [ ] Counselors cannot see cases outside their assignment / rights; church partners cannot read campaign-wide response records.
- [ ] Withdrawing permission changes future notifications and work queue state correctly.
- [ ] Aggregated dashboards exclude raw response text and personal religion-related details by default.
- [ ] Appropriate legal/privacy review completed (lawful basis, Article 9, notices, retention, DSAR, minors, sharing agreements as relevant).
- [ ] WCAG-focused accessibility review, 4G/poor-connection tests, high-traffic load test, anti-spam and abuse tests pass.
- [ ] Error logging, monitoring, queue retry and incident response runbooks exist.
- [ ] No fake UI buttons, placeholder email sends, mock CRM persistence or simulated metrics are presented as finished.

### 16.1 Mandatory automated end-to-end tests

1. Guest scans QR → opens resources → leaves without data collection.
2. Guest requests invitation only → receives one transactional message → activates free account → chooses no community.
3. Guest requests follow-up only → counselor receives assignment → no newsletter subscription.
4. Guest chooses newsletter only → marketing preference stored separately → no counselor case.
5. Guest signs up twice/retries → exactly one canonical response association and no duplicate deliveries.
6. Existing account claims invite after verification → no account collision.
7. Free user joins two independent free communities → each membership remains isolated.
8. Campaign partner cannot query another church's referrals or members.
9. User withdraws contact permission with message queued → outgoing contact canceled or legally handled with status.
10. High-traffic QR simulation → correct idempotency, queue behavior and acceptable performance.
11. Minor/unsafe input flow → configured safeguarding restrictions.
12. Admin disables QR link → old links show safe resources but no active response submission.

## 17. Release dependencies and Harvest roadmap fit

The founder's agreed broad release order in the master PRD is preserved; **Harvest Connect is an integration feature that becomes releasable only when its dependencies work**:

- **Foundation:** Neon, authentication, workspaces, consent, CRM identity and permission engine.
- **Ministry/campaign services:** Campaign/event identification, QR and response admin, church directory, case management.
- **Communities and free-account discovery:** Must exist before the full QR-to-community launch. Campaign QR + public resource + optional response can be piloted sooner without pretending that community onboarding works.
- **Courses:** Starter lessons improve the journey; advanced course infrastructure can follow.
- **Notifications:** Confirm verified transactional invitation pathways and follow-up communications first.

Recommended productization: implement Harvest Connect as a **cross-module feature flag** initially available to authorized campaign workspaces; activate full pathway only after the Discovery and Communities dependencies pass acceptance.

## 18. Decisions requiring founder review

| Decision | Recommended default |
|---|---|
| Working feature name | Harvest Connect |
| Guest access to starter resources | Yes, always |
| Account requirement for free communities | Required to join/post, optional to browse public previews |
| Default result shown after QR scan | Welcome + three next steps, not a compulsory form |
| First featured community | Organizing ministry, clearly labeled and optional |
| Newsletter consent | Separate opt-in, unchecked |
| Pastoral contact request | Separate opt-in, unchecked |
| Partner-church referral | User selects church + approves recipient-specific disclosure |
| Geolocation | Optional search or explicit device permission only |
| Response classification / decision counts | Aggregate self-reports only if lawfully collected and appropriately safeguarded; not inferred |
| Which free communities can be discoverable | Owner opt-in plus platform moderation and safety eligibility |
| Mass-crusade fallback | Short URL, paper/counselor-assisted intake, safe low-bandwidth resources |
| AI use in counseling | No autonomous pastoral judgments; human-reviewed assistance only |
| Campaign fundraising architecture | Dedicated Campaign Finance tab scoped to each campaign; separate from platform-wide General Fundraising |
| Money segregation | Required ledger-level purpose/fund attribution; enforce restricted-fund treatment |
| Donation solicitation on discipleship QR page | Never part of the response form; separate optional donation CTA only in appropriate contexts, disabled by default |

## 19. Open technical / policy questions

1. What authentication system will Harvest v2 use for verified passwordless email and phone flows?
2. What exact communication channels does Zernio expose for Harvest's tenant/app model, and what consent/template constraints apply?
3. Who is controller or joint controller for campaign records versus church referral records, by jurisdiction?
4. Which countries, ages, and languages are in the first launch?
5. What published criteria determine whether a community is safe, free and eligible for Discovery?
6. What fields, if any, will record an explicit religious response, and what special-category legal condition supports each use?
7. What are the initial retention periods and deletion/DSAR implementation decisions?
8. Is there a verified, moderated church directory available at launch, or is it built incrementally?
9. Which onboarding resources are officially approved/licensed for use across partner ministries?
10. How will offline devices be provisioned, encrypted, revoked and securely cleared?
11. Which payment processor/merchant account and payout ownership model will support campaign donations?
12. Which jurisdictions, donation receipts, tax-deductibility requirements, currencies and restricted-fund policies apply?
13. Are sponsors/pledges and in-kind contributions required at first release, or after basic donation reconciliation?

All unresolved items must be tracked as engineering/product decisions. Do not fill them by guessing in AI-generated implementation.

## 20. Suggested AI coding-agent instructions

Copy this into your implementation issue or agent task:

> Implement Harvest Connect incrementally under `docs/prd/harvest-connect-qr-to-discipleship.md`. Use the Harvest master PRD v2.5 and companion v2.7 for canonical stack and architecture. First inspect existing repo routes, tables, auth, CRM, Campaigns, Communities, notifications and consent systems; report what exists versus what is missing. Do not duplicate canonical entities. Propose schema migrations and authorization boundaries before coding. Complete one HC-XX pull request at a time, with real database persistence, input validation, server-side tenant/role authorization, idempotency, unit/integration/end-to-end tests and accessible responsive UI. Public resources must remain available without identification. Account signup, community joining, pastoral follow-up, church referrals, and newsletters must remain separate opt-in flows. Do not invent Zernio API behavior, collect religious data without approved policy, conflate crusade fundraising with the general giving module, or declare a mocked workflow finished. Stop at outstanding legal/privacy decisions that require human approval.


## 21. Campaign fundraising, donations and budget integration (v1.1 addition)

### 21.1 Purpose, separation and relationship to Harvest Connect

Harvest offers **two separate fundraising experiences**:

1. **General Fundraising (platform module):** organization-wide giving pages, recurring ministry support, general fundraising campaigns and donor stewardship, available independently of any crusade. General gifts default to the authorized organization's general fund or another explicitly selected general fund.
2. **Crusade / Campaign Fundraising (Campaigns & Projects module):** each campaign has its **own** fundraising drives, donation pages, targets, donor commitments, financial reports and budget. Every campaign gift is attributed to exactly one campaign and the applicable designated fund; it automatically contributes to that campaign's recorded fundraising and budget summaries after payment reconciliation.

The two experiences reuse the **same payment provider adapter, payment records, donor identity and receipts infrastructure** but have distinct ownership, navigation, permissions, reporting and allocation rules. **Do not implement independent payment engines or duplicate canonical donations.** A campaign finance dashboard is a filtered, campaign-scoped projection of the shared financial ledger; general fundraising never implicitly absorbs campaign gifts.

**Critical user journey separation:** The QR-to-discipleship flow remains free and independent. A donation is never a requirement to respond to the Gospel, request pastoral contact, obtain free resources, create a free account or join a free community. Do not add donation opt-ins to pastoral follow-up consent. An optional `Support this crusade` link may be displayed on a *separate campaign information or donation page* subject to organizer settings; it must not compete with or interrupt a Gospel response form.

### 21.2 Personas and permission matrix

| Role | Campaign donations | Campaign budget | General fundraising |
|---|---|---|---|
| Public donor / guest | Donate on published page, obtain receipt and manage own payment via secure process | No access | Donate via separately published general giving page |
| Campaign finance manager | View, reconcile, export permitted campaign donations; manage fundraising drives | Read/write authorized lines; submit approvals | No access unless separately authorized |
| Campaign director | View campaign totals and fundraising targets; edit priorities where authorized | View totals, approve within policy | No automatic access |
| Campaign department lead | View assigned department budget and approved aggregated income, if permitted | Propose expenses, upload receipts | None by default |
| Workspace finance administrator | Scoped access to campaigns within workspace and their financial ledger | Manage budgeting and reconciliation | Workspace's general fundraising as authorized |
| Partner church / collaborator | View only explicitly granted aggregate campaign metrics | No underlying records or donor lists by default | No inherited access |
| Pastor / counselor / volunteer | None by default | None by default | None by default |

Enforce all rules server-side through workspace, campaign, permission and fund scope. Donor email or attendance never grants campaign finance access; campaign collaborators never inherit donor personally identifying information. Finance access and religious-response access are independent permission sets.

### 21.3 Crusade finance UI / page inventory

| Route (conceptual; adapt to canonical routing) | Purpose | Required UI |
|---|---|---|
| `/w/[wid]/campaigns/[cid]/finance` | Campaign financial overview | Budget vs actuals, funding progress, committed and received donations, expenses, available funding and alerts |
| `/w/[wid]/campaigns/[cid]/finance/budget` | Budget editor | Departments/categories, planned vs approved vs committed vs spent, variance, revisions, approval states |
| `/w/[wid]/campaigns/[cid]/fundraising` | Campaign drives | Campaign-specific goal, progress, channels, active drives, donation links, public visibility settings |
| `/w/[wid]/campaigns/[cid]/fundraising/[fid]` | Drive details | Published fundraising page, goal, transactions, permitted donor view, updates |
| `/w/[wid]/campaigns/[cid]/donations` | Transaction list | Filtered received/pending/refunded/failed gifts, donor permissions, receipts, reconciliation status, export |
| `/w/[wid]/campaigns/[cid]/expenses` | Cost management | Requests, purchase orders (if enabled), reimbursements, receipts, approval workflow, vendor details |
| `/w/[wid]/campaigns/[cid]/finance/reports` | Finance reporting | Fund-restricted summaries, budget forecast, downloadable CSV/PDF, audit trail |
| `/give/c/[publicCode]` | Public campaign donation page | Organization and specific crusade identity, purpose, optional amount, currency, recurring eligibility, secure checkout |
| `/w/[wid]/fundraising` | General fundraising | **Separate** navigation and dashboard for non-campaign giving, without accidental inclusion of crusade gifts |

Display a `Finance` or `Budget` tab in every crusade Campaign workspace. Within that tab, a `Fundraising` section shows amounts **received**, pledged, spent, and budget variance. The campaign overview may display aggregate fundraising progress with a link to authorized finance views.

### 21.4 Campaign-specific donation and budget journeys

**F1 — Create and publish a campaign fundraising drive**
1. A campaign finance manager opens Campaign → Fundraising → New Drive.
2. They choose name, description, goal, currency, designated fund, intended expenses, start/end dates, visibility and authorized payment account.
3. Validation ensures the fund belongs to the same workspace and is explicitly linked to that crusade; policy may require finance approval before publishing.
4. Harvest generates a campaign-branded public giving URL and optional **separate donation QR** that cannot be confused with the Gospel response QR.
5. Donations received via that drive are reconciled to the crusade's campaign/fund and appear in the campaign budget and finance dashboard.

**F2 — Give and receive a receipt**
1. A donor visits the campaign's giving page and selects a permitted amount/currency and recurring option only if supported.
2. They see the designated purpose, registered recipient/beneficiary and applicable fees/privacy disclosures.
3. A provider-hosted or provider-compliant checkout accepts payment; Harvest does not store raw card details.
4. A signed provider webhook is verified, idempotently recorded and reconciled before a donation is counted as **received**.
5. On provider confirmation, Harvest issues the legally appropriate acknowledgment; *tax-deductibility must not be claimed unless verified for the recipient and jurisdiction*.
6. Failed or pending payments are visible in finance operations but do not inflate received totals.

**F3 — Budget view reflects gifts and expenditure**
1. Authorized manager configures budget lines: venue, travel, production, printing, marketing, logistics, staff/volunteer support, follow-up resources, contingency, etc.
2. Each approved expense has a unique campaign and line allocation.
3. Incoming campaign-designated gifts contribute to `received` totals; pledged support contributes to a separate `committed` total until realized.
4. The overview shows (a) approved budget, (b) cash received, (c) verified spend, (d) open obligations/committed expenses, (e) remaining funding need.
5. Each total links to its underlying authorized ledger entries; no unverified provider payment is treated as available cash.

**F4 — Donors supporting the organization generally**
1. The organization publishes a general giving page outside any crusade.
2. Transactions have scope `general` and do not inherit `campaign_id`.
3. A finance admin sees general fundraising totals in the general giving module, *not* in a crusade budget.
4. Transfers between general and crusade funds require an explicit authorized allocation/transfer journal with provenance, if permitted by donation restrictions and local rules. Such transfers must not be counted as new donations.

**F5 — Refunds, disputes and chargebacks**
1. Provider events mark a gift as refunded, partially refunded, disputed or reversed.
2. A reversal journal entry adjusts net received and cash availability; it never deletes historical financial records.
3. Budget and campaign dashboards recalculate correctly without double-counting or silently rewriting earlier reports.
4. Authorized administrators can review webhook, receipt and reconciliation history.

**F6 — Sponsorship, pledges and in-kind support (P1)**
- Sponsorship commitments and pledges are tracked separately from collected gifts.
- In-kind equipment, venue donations and goods may be recorded as non-cash contribution entries with explicit valuation policy, not included in cash raised.
- Sponsor acknowledgments and public names require explicit permission, and donor/private information is not exposed to evangelism counselors.

### 21.5 Proposed data architecture (Neon / Drizzle)

Use canonical platform tables where available. New names below are **conceptual** and must be reconciled against the master schema, not duplicated automatically.

| Table / concept | Key fields | Rules |
|---|---|---|
| `fundraising_drives` | `id`, `workspace_id`, `campaign_id?`, `scope`, `fund_id`, `goal_minor`, `currency`, `status`, `public_code` | `scope=campaign` requires `campaign_id`; `scope=general` prohibits it; `fund_id` must be compatible |
| `funds` | `id`, `workspace_id`, `campaign_id?`, `purpose`, `restriction_policy`, `currency` | Explicitly designated/controlled funds; distinguish general versus restricted campaign allocations |
| `donations` | `id`, `workspace_id`, `drive_id`, `fund_id`, `campaign_id?`, `donor_contact_id?`, `amount_minor`, `currency`, `status`, `provider_payment_id`, `created_at` | Canonical donation record; unique provider transaction; privacy-scoped identity |
| `donation_events` | `id`, `donation_id`, `provider_event_id`, `type`, `payload_ref`, `received_at` | Unique provider event id, immutable audit, idempotent |
| `financial_ledger_entries` | `id`, `workspace_id`, `campaign_id?`, `fund_id`, `source_type`, `source_id`, `amount_minor`, `currency`, `direction`, `posted_at` | Append-only accounting events; reversals through offsetting records |
| `campaign_budgets` | `id`, `workspace_id`, `campaign_id`, `version`, `currency`, `approval_status` | Separate budget per campaign/version; enforce approver policy |
| `campaign_budget_lines` | `id`, `budget_id`, `department_id?`, `category`, `approved_minor`, `spent_minor?`, `owner_id?` | Prefer derive spent/received from ledger; do not trust client-maintained sums |
| `campaign_expenses` | `id`, `workspace_id`, `campaign_id`, `budget_line_id`, `vendor_id?`, `amount_minor`, `currency`, `status`, `evidence_file_id?` | Secure files and approval state; reconcile payments before reporting actual spend |
| `campaign_pledges` (P1) | `id`, `campaign_id`, `fund_id`, `contact_id?`, `pledged_minor`, `fulfilled_minor`, `due_at`, `status` | Commitments only; never counted as received cash |
| `fund_transfers` (P1) | `id`, `workspace_id`, `from_fund_id`, `to_fund_id`, `amount_minor`, `authorization_ref`, `policy_basis` | Explicit permissions, paired ledger postings; restricted funds cannot be moved improperly |

Suggested DB constraints: composite `workspace_id` and campaign ownership FK checks; unique `(payment_provider, provider_payment_id)`; unique `(payment_provider, provider_event_id)`; published drive must reference an enabled merchant account; `amount_minor > 0`; supported currency validation; unique public codes; immutable posted entries. **Never rely solely on a nullable `campaign_id` to isolate campaigns; validate all parent references.**

A donation should be counted once as a source receipt; any reallocation uses ledger postings, not another donation. Do not mix currencies by summation: display individually or convert with recorded FX rate/date and clearly disclosed policy.

### 21.6 API contracts (proposed; validate against codebase)

| Operation | Route | Permissions / properties |
|---|---|---|
| List campaign finance | `GET /api/workspaces/{wid}/campaigns/{cid}/finance` | Campaign finance reader; aggregates by fund/currency |
| CRUD campaign budget | `GET/POST/PATCH /api/workspaces/{wid}/campaigns/{cid}/budget` | Role/approval checks; optimistic concurrency |
| Create fundraising drive | `POST /api/workspaces/{wid}/campaigns/{cid}/fundraising` | Finance editor + validation |
| List campaign donations | `GET /api/workspaces/{wid}/campaigns/{cid}/donations` | Finance reader; redact donor PII by role |
| Record/approve expense | `POST /api/workspaces/{wid}/campaigns/{cid}/expenses` | Scoped expense proposer/approver; separation of duties |
| Public checkout session | `POST /api/public/campaign-giving/{code}/checkout` | Published drive, throttling, provider session, idempotency |
| Payment webhook | `POST /api/webhooks/payments/{provider}` | Verify signature, replay protection, transaction-safe posting |
| General fundraiser | `GET/POST /api/workspaces/{wid}/fundraising` | Separate general fundraising views; same shared adapter |
| Finance report/export | `GET /api/workspaces/{wid}/campaigns/{cid}/finance/report` | Finance role; audit log and controlled exports |

All money is represented in integer minor units, with explicit currency; provider metadata must not be trusted as the authoritative campaign/fund association without validating previously created checkout sessions. If receiving funds on behalf of third parties, review payment-provider rules and legal entity/KYC responsibilities before implementation.

### 21.7 Reporting rules and formulas

- **Received donations:** sum of confirmed posted campaign donation receipts, minus posted refunds/reversals, scoped to campaign/fund/currency.
- **Pledged:** unpaid valid commitments; excluded from received total.
- **Verified spend:** posted paid expenditure entries scoped to approved campaign budget lines.
- **Unpaid obligations:** approved but unpaid expense commitments; separate from spend.
- **Cash coverage:** received donations and other confirmed campaign receipts compared with paid expenses and reserved commitments; not necessarily equal to bank balance until payout reconciliation is complete.
- **Funding gap:** approved campaign budget minus eligible confirmed funding. Show separately from bank balance or available funds.
- **Fee visibility:** provider gross amount, provider fees, refunds, net amount and settlement status are separate fields; define which total is used for goals versus cash availability.
- **Recurring donations:** attribute each successful installment to the campaign until the drive closes or donation terms require another treatment; avoid projecting future installments as received.
- **Cross-campaign totals:** do not count shared donations twice.
- **Access:** campaign managers see permitted aggregates; donor-level data requires distinct finance scope; public page sees only configured published goals/progress, not private donor data.

### 21.8 Requirements by priority and suggested PR slices

**P0 (operational launch):** One campaign drive per campaign or multiple allowed by model; payment provider connection; secure public donation page; unique campaign attribution; verified webhook; receipts; campaign donation list; campaign budget categories, approved/actual tracking and overview; role checks; safe refunds; general fundraising separation; security and reconciliation tests.

**P1:** Multiple funds and drives, pledges, in-kind donations, department budgets, purchase approvals, campaign expense documentation, sponsor management, multi-currency reporting, general-to-campaign authorized transfers, audit exports.

**P2:** Fiscal sponsorship variants, donor portals, recurring crusade-specific campaigns, advanced forecasting, matching commitments, government/tax-compliant jurisdiction-specific reporting, cross-workspace co-organizer settlement models (subject to legal review).

| PR | Proposed implementation slice | Acceptance gate |
|---|---|---|
| HC-FIN-01 | Finance entity boundaries, accounting policy decisions, tenant/role rules | General/campaign isolation tests pass |
| HC-FIN-02 | Funds, donations, ledger schema + migrations + constraints | Unique provider events, fund/campaign FK checks, posting tests |
| HC-FIN-03 | Campaign budget schema, categories, editor, approvals | Budget edits persistent, scoped and auditable |
| HC-FIN-04 | Drive manager, public giving pages, donation QR | Each campaign generates own public giving URL; never replaces response QR |
| HC-FIN-05 | Checkout + payment webhooks + receipts | Duplicate/replayed event posts once; failure handled |
| HC-FIN-06 | Campaign donation reconciliation + finance dashboard | Correct gross/net/fees/refunds, budget rollup |
| HC-FIN-07 | General Fundraising isolation and money movement validation | General gifts excluded from campaign totals without authorized explicit transfer |
| HC-FIN-08 | Expenses, approvals, evidence, budget vs actual | Reconciled expenses correctly reduce available funding |
| HC-FIN-09 | Exports, audit trail, security/QA/hardening | Access, privacy, refund, reconciliation E2E tests pass |
| HC-FIN-10 (P1) | Pledges, sponsors, in-kind, restricted-fund allocations | Noncash/pledged values never inflate paid cash received |

### 21.9 End-to-end acceptance criteria

1. Given a published Crusade A donation URL, a successful $25 gift appears in Crusade A's fundraising and budget income after signed provider confirmation, and **never** appears in Crusade B's or general-giving totals.
2. Given a general ministry donation, it appears in General Fundraising and **not** any crusade's budget; a later authorized transfer produces documented ledger movement rather than a duplicated gift.
3. An unpaid, pending or failed payment is not included in received totals; webhook retries never duplicate transaction postings.
4. A full refund reduces Crusade A's net funding and is visible in reporting, while preserving immutable audit history.
5. A partial refund and provider fee yield mathematically consistent gross/net totals and settlements.
6. Campaign finance users can drill into approved budget lines and actual expenses; department leads cannot view private donor details without a separately granted role.
7. Restricted funds cannot be reallocated to another campaign or general fund without the applicable legal and policy approval; otherwise the system rejects the operation.
8. Multiple currencies are not silently summed as a single total.
9. QR response flow remains usable without donating, account creation or granting marketing consent; donor checkout never writes a person's religious response into marketing or donation profiles.
10. Payment links use approved recipient accounts; users cannot substitute tenant or campaign IDs in checkout/webhook callbacks.
11. Finance exports respect workspace/campaign security and record who accessed them.
12. Provider outages result in safe retries and reconciliation; no optimistic success is shown as a confirmed donation.

### 21.10 Open decisions requiring founder / finance review

- Choose payment provider(s), connected-account ownership and available donation currencies.
- Decide whether campaign gifts are tax-deductible anywhere, and who is the legal beneficiary and issuer of receipts.
- Define accounting treatment for provider processing fees, chargebacks and unsettled funds.
- Establish restricted-fund designation and permitted transfers.
- Decide whether budgets include income sources beyond charitable donations (ticketing, sponsorship or grants) and classify them separately.
- Define public display of fundraising goals versus private budget, donor acknowledgments, anonymized progress, and refund policy.
- Establish data retention, donor privacy notices, billing/tax reporting and financial reporting jurisdictions.
- Confirm whether donations can be made by an individual or whether every drive must be attached to an authorized charitable/legal entity.

**Implementation note for agents:** This section extends Harvest Connect's cross-module integration with Campaigns, Budget, Finance and General Fundraising. It does **not** convert the discipleship response form into a fundraising form. Implement only after reviewing canonical workspace/campaign/fund/payment schemas and policy decisions. Maintain finance role boundaries separately from counseling permissions.

---

**Document maintenance:** Record changes in version history. Keep this file separate from the master PRD; add it to the master PRD's companion document index. Any changes to consent, religious-data processing, church sharing, or minors' flows require renewed privacy/security review before deployment.
