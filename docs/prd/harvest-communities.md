# Harvest Communities — Product Requirements Document (PRD)

**Version:** 1.1  
**Status:** Proposed / implementation-ready specification, subject to architecture review  
**Date:** 11 November 2026  
**Document type:** Standalone module PRD / companion to Harvest v2.5 and implementation PRD v2.7  
**Owner:** Harvest product team  
**Reference experiences:** Skool (community discovery, engagement, classroom, gamification), Eden (creator commerce, products in communities, chat, posts, events, and shared customer access)  
**Priority:** Harvest's creator/community release (F3), with prerequisite platform components delivered earlier; community commerce fully enabled when payments/commerce infrastructure is ready (F4).

> **Scope contract:** This document specifies Harvest's own community product. Recreate useful product patterns independently; do not copy proprietary assets, branding or restricted source code. Actual features and integration readiness require implementation verification. This document extends—not replaces—the master PRD, shared-UI architecture specification, Harvest Connect and Campaigns requirements.

---

## 1. Vision and goals

Build an integrated **community, learning and commerce platform** that enables a church, ministry, evangelist, coach, nonprofit or creator to host free and paid communities under their Harvest workspace. Members should be able to discover communities, join by an appropriate admission path, participate in discussions and chat, attend events, take courses, purchase associated products and receive relevant, consent-aware communications without creating separate accounts for separate Harvest products.

**Product principles**

1. **One identity, many communities:** A free Harvest account can belong to multiple communities across workspaces; membership in a community does not automatically make the user an administrator of its owner workspace.
2. **Visibility, entry requirements and monetization are independent:** A private community can be free, paid, application-based or invitation-only. A public-facing community page does not imply access to members-only content.
3. **Communities are connected to the rest of Harvest:** Use the shared Products/Courses/Coaching/Newsletters/CRM/Events/Forms/AI platforms; do not fork these into community-specific copies.
4. **A single creation, editing and publishing experience:** Reuse Harvest's `CreationWizard`, `EditorShell`, `AccessPricingEditor`, `ResourceTable`, `CalendarView`, `MediaPicker`, `PublishChecklist` and global theme; add specialized community panels only where necessary.
5. **Community members have meaningful privacy and control:** Consent for marketing is separate from membership; religious beliefs or pastoral requests are treated as sensitive data; communities cannot export cross-workspace personal information.
6. **A polished, useful product—not superficial mock interfaces:** Every claimed feature needs real persistence, permissions, empty/error states, responsive UI and end-to-end tests.

**Outcomes:** Reduce friction from discovery to membership; improve healthy engagement and learning; create ethical revenue opportunities for hosts; provide pastor-led discipleship in suitable communities; give each owner actionable insights without unnecessary sensitive-data collection.

**Non-goals:** Building a separate CRM, payment gateway, newsletter service, school LMS database or video-conferencing service inside Communities; launching a broad competitive-content discovery engine; automatically enrolling evangelistic responders without consent; making gamification a measure of spiritual maturity.

---

## 2. Personas and access contexts

| Persona | Needs | Default scope |
|---|---|---|
| Free Harvest user | Discover free communities, join, learn, participate, manage memberships | Own identity + authorized community content |
| Paying member | Access paid benefits and products, manage billing, see entitlements | Purchased or assigned access |
| Community owner | Create and brand communities, set admission rules, manage content and sales | Own community within workspace |
| Community admin | Manage content, people, membership and settings as delegated | Explicitly granted community permissions |
| Moderator | Review reports, manage posts and safety, respond to members | Moderation, not payment/finance administration by default |
| Contributor / teacher / pastor | Host lessons, events and discussions, offer optional follow-up | Assigned channels, cohorts, members, permissions |
| Applicant / guest | Explore a public listing, apply, redeem invite or purchase membership | Public metadata and own application only |
| Campaign participant | Explore recommended discipleship communities after Harvest Connect | Explicitly chosen connections only |
| Platform operator | Address abuse, billing incidents, abuse reports | Audited limited-access support tooling |

### 2.1 Two different kinds of membership

- **Workspace membership** is for the organization owner and team operating Harvest.
- **Community membership** is for audience members, who must *not* inherit workspace administrative privileges.
- A user may be a paid member of community A and a free member of community B, in entirely different workspaces.
- Owner-to-member impersonation, private direct-message access, member exports and financial reporting require separate elevated privileges and audit events.

---

## 2A. Explicit product decisions — answers for the AI coding agent (normative)

These are **final target product requirements**. Treat these decisions as authoritative when earlier documents are ambiguous.

| Agent question | Harvest decision |
|---|---|
| Who creates communities? | **Both organizations and individual creators.** A church, ministry, nonprofit, or individual creator can create a community under their own Harvest workspace; sole-person workspaces are supported. A free member account by itself does not automatically grant creator/owner privileges. Creator eligibility, billing onboarding and plan limits are separate from identity. |
| How do people join? | **Open free**, **free with application form and approval**, **invitation-only**, **paid one-time**, **paid subscription**, and combinations such as *approved application → checkout*, or *paid access gifted by invitation*. Make visibility, admissions and pricing independent settings. |
| Which communities appear in public discovery? | **Only published, explicitly opted-in, Listed communities that pass Harvest eligibility and safety review.** Owner controls opt-in and metadata; Harvest controls platform eligibility and removal. Private, unlisted, suspended or draft communities must never appear, including in search, feeds, recommendations, sitemap or cached previews. |
| What can users do inside? | **Feed/posts/discussions, channels and chat, member directory (privacy-aware), events/calendar, classroom/courses, digital resources, member profiles, notifications, product shelf/commerce, and optional gamification.** Owners toggle relevant tabs and can gate them by tier. |
| Community roles? | **Owner, Admin, Moderator, Teacher/Pastor/Contributor, Member, Guest/Applicant** plus separately delegated **Billing Manager** capabilities. Owner can configure everything; admin handles delegated operations; moderators manage posts/reports and membership applications but no finance by default; members participate according to permissions. Always enforce capabilities server-side. |
| Moderation & safety? | Community rules, reporting, report queue, content hide/remove, warning, mute, suspension, ban, appeals, audit log, spam prevention, blocking, privacy controls. **Launch policy: adult accounts only (18+) unless a separately approved minors program is implemented.** Do not collect DOB unnecessarily; use age attestation where appropriate. Future minors support requires jurisdiction-specific guardian consent/verification, safeguarding processes, restrictions on adult-minor DM, and privacy/legal review; do not silently enable it. |
| What to borrow from Skool? | **Community Discovery browsing, clean community/feed layout, classroom, event calendar, member profiles, course progress, engagement points/levels and leaderboards** (gamification optional, off by default for discipleship contexts). |
| What to borrow from Eden? | **Single creator/store resource model, community channels and messaging, event experiences, shared sign-in, free/paid memberships, product shelf with included/paid items, selling courses/coaching/downloads from within communities, and consistent creation/editor journeys.** Reimplement these patterns in Harvest's own shadcn-based design; do not copy proprietary source/assets. |

**Terminology:** Public/Private refers to *listing and access exposure*, Free/Paid refers to *pricing*, and Open/Apply/Invite refers to *admission*. Do not collapse these into a single community type. The directory may show a public **listing** for a paid or approval-only community without exposing its member content.

**Community owner governance:** Individual creators and organizations both remain tenants/workspaces. Members join communities without joining the owner workspace; cross-workspace products require explicit permissions and entitlements. Free Harvest member accounts can browse, purchase and join, while creation rights are plan/configuration governed.

---

## 3. The three independent access dimensions

Do **not** implement a single mutually exclusive `community_type = public|private|paid|free` field. These concepts are orthogonal.

### 3.1 Visibility

| Setting | Discover directory | Public landing page | Content visible before joining |
|---|---|---|---|
| **Listed** | Yes, based on moderation and optional filters | Yes | Only deliberately public previews |
| **Unlisted** | No | Accessible with share link | Public previews only |
| **Hidden / private** | No | Minimal invitation or restricted preview only | No member content; avoid indexing and title leaks where necessary |

Optional `show_in_discovery` is valid only when visibility permits; any visibility change must purge search/cache indexes and invalidate public sitemaps. Distinguish *listing privacy* from *member content access*.

### 3.2 Admission policy

| Policy | User journey | Access grant |
|---|---|---|
| **Open join** | Click Join / sign up | After valid authentication and rules acceptance; payment if required |
| **Application required** | Complete configurable form | After moderator approval and any required payment |
| **Invitation only** | Redeem personalized, limited, expiring invitation | On verification, rules acceptance and any explicitly configured payment requirement |
| **Restricted entitlement** | Own qualifying course, product, tier or sponsored grant | Automatically upon qualifying entitlement and acceptance of community rules |

Application and invite policies may be configured as separate **allowed paths** (e.g. application for the public, admin invites that bypass applications). Use explicit precedence and do not allow guessed URLs or shared screenshots to bypass admission.

### 3.3 Pricing and membership plans

- Free membership
- One-time payment / lifetime access, with clear meaning for refunds and community closure
- Monthly subscription
- Yearly subscription
- Freemium (free base + paid tier within one community)
- Multiple tiers with different channel/course/product access
- Time-limited trial or campaign-sponsored access, if enabled by billing policy
- Access bundled with another Harvest product, course, coaching offer or campaign
- Manually granted complimentary access with administrator identity, reason and expiry

A community can be **listed + paid + application required**, or **hidden + free + invite only**, etc. Payment and member data must not be inferred from UI toggles; access is always enforced server-side through an entitlement service.

### 3.4 Admission / payment state machine

`visitor → authenticated → [application_pending | invited | checkout_pending | eligible] → active_member → [past_due | suspended | cancelled_pending_end | expired | removed | banned]`.

Rules:

- For **application + paid**, approval happens before checkout. Never charge rejected applicants; create a limited checkout opportunity after approval.
- For **invite + paid**, show any required price before redeeming; an invite never silently bypasses a price unless configured as a free grant.
- A successful payment webhook, not a front-end return URL, creates paid access. On uncertain payment state, show `Processing`, not an active entitlement.
- Cancelling a subscription preserves access through the paid-through date when policy requires; refunds, chargebacks and disputes trigger explicitly defined entitlement changes.
- Pending or rejected applicants cannot read member-only content; banned users cannot rejoin via invite or purchase without authorized reinstatement.
- If the same user is eligible through several grants, effective access is the union of *valid* grants; ending one grant must not revoke access provided by another valid grant.

---

## 4. Community creation wizard (shared Harvest engine)

**Entry points:** Workspace → Communities → `New Community`; global `+ Create` → Community; optional Store → New Product → Community. All should call the same workflow, not duplicate code.

**Step 1 — Basics:** name (required), unique community handle/slug, short description, category, primary language, cover image/icon, who it's for, community rules draft. Workspace owner is automatically the first owner.

**Step 2 — Visibility & Joining:** Listed/Unlisted/Hidden; Open/Application/Invitation/Entitlement or combination of explicitly allowed paths; searchable metadata; join form settings; membership request approvals; invite policy and optional cap.

**Step 3 — Pricing & Benefits:** Free, one-time, monthly, yearly, freemium or tiers; currency; available benefits; trials or promotional price when supported; optional bundled products; payment connector checks. Allow create-as-draft if checkout is not ready.

**Step 4 — Spaces & Features:** Enable and initialize Feed, Channels/Chat, Classroom, Products, Events, Members, Resources, Announcements, Challenges/Gamification, and optional pastor-led Discipleship. Recommended starter channels include Welcome, Introductions, Questions, Announcements; all editable later.

**Step 5 — Branding & Landing Page:** Logo, cover, accent from workspace theme, public description, benefits, testimonials (only with permission), SEO preview, join CTA, onboarding welcome message and rules.

**Step 6 — Review & Create:** Preview as guest, applicant, free member, paid member and admin; verify access rules and payment readiness; choose `Create Draft` or `Create & Publish` if all publication checks pass. No welcome emails, public links or charges until explicitly authorized.

**Common mechanics:** Back/Next, step validation, autosave/resume, conditional steps, conflict-safe slug reservation, mobile full-screen wizard, keyboard navigation, reliable retries. Use shared `CreationWizard` infrastructure; community-specific steps are composed plug-ins.

### 4.1 After creation

Open the community `EditorShell`, with a checklist: write rules, add moderators, add welcome post, configure price/checkout, test admission, publish landing page, set up first event, attach first product, configure member welcome. Support `Preview as` without impersonating or exposing real member secrets.

---

## 5. Required pages and navigation

### 5.1 Owner / admin routes (canonical illustrative routes)

| Route | Function |
|---|---|
| `/w/:workspace/communities` | Community list, filters, drafts, create, plan limits |
| `/w/:workspace/communities/new` | Shared creation wizard |
| `/w/:workspace/communities/:id/overview` | Health, activity, pending approvals, revenue metrics where authorized |
| `/w/:workspace/communities/:id/content` | Posts, channels, moderation and pinned content |
| `/w/:workspace/communities/:id/members` | Members, applications, invitations, roles, bans, exports if authorized |
| `/w/:workspace/communities/:id/classroom` | Courses included, purchased and promoted; curriculum shortcuts |
| `/w/:workspace/communities/:id/products` | Product catalog, included/for-sale benefits, merchandising |
| `/w/:workspace/communities/:id/events` | Event management and registration |
| `/w/:workspace/communities/:id/analytics` | Acquisition, retention, engagement, conversions, revenue |
| `/w/:workspace/communities/:id/settings/*` | General, access, plans, branding, integrations, notifications and safety |

### 5.2 Member and public routes

| Route | Function |
|---|---|
| `/discover/communities` | Community tab in unified Discover: publicly listed, approved, opted-in communities |
| `/discover` | Unified discovery of communities, courses and products (plus type/filter tabs) |
| `/discover/courses` | Listed published courses and enrollment |
| `/discover/products` | Listed published products/offers and checkout |
| `/c/:slug` | Public landing / membership join page, subject to visibility policy |
| `/c/:slug/apply` | Application form and status |
| `/c/:slug/join` | Join, invite redemption, rules acknowledgment, checkout as appropriate |
| `/c/:slug/home` | Member home, welcome, featured content |
| `/c/:slug/feed` | Activity feed and forum categories |
| `/c/:slug/chat` | Channel conversations and threaded replies |
| `/c/:slug/classroom` | Courses, progress and gated content |
| `/c/:slug/products` | Included offers and products for sale |
| `/c/:slug/events` | Community schedule and RSVP |
| `/c/:slug/members` | Member directory respecting profile privacy |
| `/c/:slug/resources` | Library/files/guide pages |
| `/c/:slug/about` | Rules, admins, benefits, links |
| `/me/communities` | My Communities, invitations, pending requests, plans and notifications |

Routing implementation may vary, but **one canonical route schema** must be chosen; redirect legacy `/community/*` patterns instead of maintaining duplicate implementations. Do not expose private content in server-rendered metadata, prefetch payloads or route-specific error messages.

### 5.3 Shared visual patterns

Use the Harvest `AppShell` for owners and a consistent branded `CommunityShell` for members with responsive left rail / mobile bottom navigation. Use shared `ResourceTable`, `ResourceDetail`, `CalendarView`, `EditorShell`, forms and access/pricing panels. Allow selective advanced 21st.dev components after design-token and license review.

---

## 6. Community experience and engagement features

### 6.1 Feed and forum (Skool-style)

- Posts: text, image, video/link embeds, documents where permitted; composer with preview, drafts, optional scheduling and edit history.
- Categories/tags, pinned/featured posts, announcements, post sorting (new/top/unanswered), search and filters.
- Threaded comments/replies, reactions, mentions, bookmarks, following, unread states and notifications.
- Optional polls with response rules; anonymous polls only when privacy-safe and supported.
- Moderation: hide/delete, report, edit history, rate limits, banned terms, content review queue, member mute/suspend/ban and appeal handling.
- Rich previews must sanitize untrusted HTML/URLs; attachment virus scanning, size/type limits, signed URLs and permission checks.
- Post permissions configurable by role/tier/channel (who may post, comment, react, share externally).

### 6.2 Chat and channels (Eden-style)

- Channel creation with name, description, order, emoji/icon, access eligibility (all, tier, role, cohort/tag, invite-only).
- Real-time text chat, threaded replies, rich attachment support as approved, mentions, pinned messages, unread badges, read-state syncing, mute preferences.
- DMs and small-group conversations **only when both members opt into direct messaging**, with blocking/reporting and moderator boundaries; admins do not silently read private DMs.
- Rate limits, spam controls, offline/reconnect behavior, notification aggregation, message retention.
- Turn channels on/off per community; no channel should leak into global search to non-members.

### 6.3 Member directory and profiles

- Community-specific profile: display name, optional bio/avatar, local language, profile links, roles/badges and joined date.
- User-controlled visibility (private directory presence when policy permits), optional messaging permissions.
- Filter by role, interests or cohort where shared voluntarily; no bulk access to private contact information.
- Member onboarding: welcome modal, community rules acknowledgment, optional introductions prompt, notification settings, first recommended course and upcoming event.

### 6.4 Classroom, courses and discipleship (Skool-inspired)

- Show `Included`, `Unlocked by tier`, `Available for purchase` and `Coming soon` clearly.
- Reuse Harvest's canonical Course/Lessons service for curriculum, documents, video, quizzes if implemented, completion and progress.
- Membership/tier/achievement gates may unlock content; **do not gate essential free discipleship resources behind gamification or payments**.
- Course progress survives community departure where the person owns the course separately; community-included access ends with the qualifying grant.
- Cohorts, group assignments, learning paths and pastor-led discipleship can be enabled as optional templates; sensitive pastoral notes remain in restricted CRM/discipleship services, never the public feed.

### 6.5 Events and live sessions

- Community event calendar, descriptions, timezone, RSVP, capacity, waitlist, reminders, attachments, recurring sessions if supported.
- Join via external Zoom/Google Meet/Teams link or provider integration, respecting host permissions and meeting security.
- Public vs members-only events; paid-event checkout uses canonical Events/Commerce services.
- Links to Google/Microsoft calendars through Harvest's integrations where supported, including consent and permission checks.
- Attendance and replays where permitted; replays may have separate entitlements.

### 6.6 Gamification and challenges

- Optional points for constructive engagement, levels, member badges and time-limited challenges.
- Community-specific leaderboards and opt-out/privacy controls; anti-spam/rate limiting; moderators can remove manipulated activity.
- Optional level-based course unlocks but never make pastoral care, faith-response help or essential onboarding dependent on points.
- Default **off** for sensitive discipleship communities; owners can opt in with clear messaging.

### 6.7 Notifications and moderation

- In-app notifications, optionally email and mobile push when infrastructure exists: mentions, replies, announcements, purchases, membership changes, event reminders and admin decisions.
- Channel/community-level mute controls, digest settings, quiet hours where supported, unsubscribe for non-transactional mail.
- Moderation policy, member reports, restricted evidence handling, escalation process, retention and appeals.
- For minors, require appropriate safeguarding controls; do not enable unsolicited adult-to-minor DMs. Launch with an explicit age policy and jurisdictional consent requirements.

---

## 7. Products and commerce inside communities (first-class requirement)

**Foundational requirement:** A host creates a course, coaching offer, digital download, workshop, event, newsletter subscription, membership or other supported product **once** in Harvest's Products catalog and can then attach it to one or more communities. No duplicate products, orders, payment credentials or incompatible copies of the same lesson.

### 7.1 The Community Products tab

Host-facing actions: `Add Existing Product`, `Create Product` (opens shared creation wizard and returns), `Edit Display`, `Include with Membership`, `Sell to Members`, `Remove from Community`, `Feature`, `Announce`, `Preview as Member`.

For each attached product, the host configures:

- `Included`: access while the person has the qualifying community membership/tier.
- `For sale`: product displayed with price and checkout; separate purchase grants durable product entitlement under its terms.
- `Members-only offer`: price/availability may differ from the public storefront if supported by shared pricing rules.
- `Only for`: eligible tiers, cohorts, tags or roles; visible locked with upsell CTA or hidden, per policy.
- `Bundle`: community access included with a product, or product access included with community plan; avoid circular eligibility definitions.

**Member-facing sections:** `Included for You`, `Your Purchases`, `More from This Creator`, `Recommended Next`. Product cards show title, cover, access state, price/currency and clear CTA: `Open`, `Continue`, `Get`, `Upgrade`, `Buy`, or `Renew`.

### 7.2 Entitlement semantics

- `community_included` grant is **conditional**: valid while the membership/tier condition remains valid.
- `product_purchase` grant is independent: purchasing a course keeps its contractual access even if community membership later ends.
- An `admin_grant` is explicit, recorded and may expire.
- A `bundle` records its source and revocation rules.
- Payment refunds and chargebacks must follow product terms and provider events, not blanket deletion of unrelated grants.
- Product removal from a community ends conditional inclusion according to a clearly disclosed policy; separately purchased rights survive.
- A free course linked from a community should not be silently treated as a paid product.
- If a user already owns the product, avoid a duplicate purchase and show `Open` instead.

### 7.3 Embedded commerce workflows

- Inline product card / side panel / checkout transition that preserves community context and returns after checkout.
- Use canonical Products/Orders/Payments systems and a provider adapter; **never collect card numbers directly** inside custom community forms.
- Member-level purchase history and course progress use the global account; creator reporting is scoped to owning workspace.
- Upsells may appear in contextual locations but should never obscure core community participation or manipulative spiritual content.
- Sales analytics record attribution `community_id`, `product_id`, `campaign_id` when relevant, with appropriate privacy and consent.
- Discount codes, trials, tax/VAT handling, invoices/receipts, refunds, webhook retries and disputes belong to the shared commerce platform.

### 7.4 Commerce dependencies and release gating

Because Harvest's confirmed rollout places full commerce after community functionality, build **a thin entitlement model and Free/Manual grants early**. Render product shelf and included free content as soon as supported. Hide purchase CTAs until checkout, tax, legal, subscription and webhook tests pass. Do not fake selling functionality in preview demos.

### 7.5 Examples

1. A **free Bible study community** includes a free Foundations Course, while optionally selling a separate in-depth course.
2. A **paid creators' community** includes workshops with monthly membership and sells coaching sessions separately.
3. A **private invitation-only ministry team** grants all invited members certain resources, while a leadership tier sees extra private channels.
4. A **paid course** bundles membership in a companion discussion community; after qualifying purchase the buyer can enter both with the same account.

---

## 8. Member acquisition and joining workflows

### 8.1 Listed + free + open

Directory → Landing page → Join → Authenticate/create free Harvest account → Accept rules → Active membership → Welcome / introductions / featured course. No payment or manual approval.

### 8.2 Listed + free + application

Directory → Apply form → Optional authenticated identity → Confirmation / status → Admin review → Accept/reject/request information → If approved, secure join link → Rules → Active membership. Never expose other applications, reviewer notes or answers through predictable IDs.

### 8.3 Hidden + invitation-only

Host sends a one-time, expiring invite to a verified account/email → Member opens invite → Account verification → View community name/terms and price if applicable → Accept rules/checkout if needed → Join. Revoke, resend, expiry and duplicate redemption must be supported.

### 8.4 Listed + paid + open

Public offer and terms → Sign up / log in → Checkout → Verified payment webhook → Entitlement active → Join community. Failed/pending checkout does not grant access.

### 8.5 Application + paid

Application → Review → Approval → Payment link / checkout → Confirm payment → Member access. Approval must never trigger automatic payment without explicit buyer action.

### 8.6 Freemium upgrade

Member enters for free → Sees locked premium features and pricing → Upgrade → Payment → Immediate tier access after confirmation → Downgrade/cancel follows period and access rules without losing free-community identity or content ownership.

### 8.7 Product bundle and grant

Member buys eligible course/product or receives a campaign-sponsored grant → Entitlement service resolves qualifying community benefits → Member accepts community rules → Entry granted. If product bundle entitlements expire, reassess *all* remaining grants before revoking.

### 8.8 Applicant management

Admin queue: pending, requested-info, approved, rejected, withdrawn, expired. Features: form preview, safe reviewer notes, assignee, decision history, permissions, bulk decisions where appropriate, email notifications, decision templates and appeals/reapply policy. Applications may contain sensitive information and must have purpose-specific retention.

### 8.9 Free Harvest community discovery

- Free accounts get `Discover Communities`, intentionally separate from the excluded content-research/competitor-discovery features.
- Show listed communities with description, cover, languages, category, country/region optional, type, free/paid plan, member count only if allowed and meaningful.
- Filters: free/paid, faith/discipleship/creator topics, languages, location (optional), community size and format (online/local), and verified partner flag where applicable.
- Rankings: relevance, recently active, recommended, newest, with abuse-resistant moderation and no misleading popularity promises.
- Do not list Hidden/Unlisted communities; do not allow membership lists, private titles or content to be indexed.
- `My Communities` shows Joined, Pending, Invited, Purchased, and Hosted, with cross-workspace safe navigation.

---

## 8A. Unified Harvest Discover — Communities, Courses and Products (required)

**Decision:** The free Harvest account must include a **single unified Discover destination**, inspired by Eden's commercial discovery and Skool's community discovery. This directory is for Harvest communities and sellable/learnable resources—not social-media content discovery, competitor research or browser extensions (those remain excluded).

### 8A.1 Information architecture and routes

- `/discover`: unified landing with search, `All`, `Communities`, `Courses`, and `Products` tabs, personalized/recent categories, featured collections and saved items. Each result card clearly identifies its resource type.
- `/discover/communities`: community listings (free and paid, if listed).
- `/discover/courses`: published standalone courses, including free and paid courses and courses accessible via a community membership.
- `/discover/products`: digital downloads, coaching offers, memberships, workshops, and other eligible Harvest catalog offers. Provide resource-type filters; do not promise physical merchandise unless the commerce module supports it.
- `/discover/search?q=...`: cross-type results with facet counts and pagination; avoid showing unlisted, invitation-only, private or unpublished resources unless their owners explicitly authorize a *public landing page* AND separately opt in to listing.
- `/me/library` or `/me/access`: separate user-centered location for joined communities, enrolled courses, purchases, saved resources, invitations and pending membership requests. Keep purchases and entitlements canonical to the Commerce/Courses systems.

### 8A.2 Filters and sort

| Category | Required filters | Sorting |
|---|---|---|
| All | resource type, topic/category, language, price (free/paid), search | relevance, newest |
| Communities | free/paid, open/apply, topic, language, online/local, country/region (only when explicitly supplied), size band, verified organization | relevance, newest, activity (privacy safe) |
| Courses | free/paid, topic, language, level (beginner/intermediate/advanced), delivery format, duration range, enrollment availability | relevance, newest, price |
| Products | free/paid, type (download/coaching/membership/workshop/etc.), topic, language, price range, format | relevance, newest, price |

Filter chips are URL-synchronized, keyboard-accessible, mobile-friendly, and support reset. Never infer a user's precise location or religious denomination for targeting without an appropriate opt-in and transparency. The platform may highlight discipleship collections to users who **choose** that interest; do not infer religious conversion from private campaign responses.

### 8A.3 Who decides what appears?

1. **Creator chooses** whether an eligible published resource is `Listed`, `Unlisted`, or `Hidden` and separately toggles `Allow Harvest Discover`. Creators choose permitted public description, category, cover, locale, price visibility and previews.
2. **Harvest platform** approves eligibility, category integrity, fraud/spam policy and safety standards; can delist or suspend with auditable reasoning and appeal path. Explicit owner opt-in is necessary but not sufficient for listing.
3. **System** indexes only sanitized approved public listing metadata and honors delist, unpublish, ban, privacy, and pricing changes quickly; invalidate search indexes, caches, sitemaps, recommendations and feed entries.
4. **Members** choose the communities they join, courses they enroll in, and products they buy. Recommendations never grant memberships or trigger payment.
5. Default behavior for new resources: **Not listed** until deliberately published, opted in and approved; do not silently expose newly created private ministry communities.

**Avoid a cold-start trap:** Offer editorially curated safe featured collections and filters, not fabricated metrics or fake reviews. Favor relevance and explicit user preferences over addictive engagement ranking. Add fraud/quality controls before ranking by popularity.

### 8A.4 Result cards and destination pages

All cards contain only approved public metadata: cover, title, creator/workspace display name, type, category, language, free/starting price, availability, and a contextual CTA (`View`, `Join Free`, `Apply`, `Enroll Free`, `Buy`, `Explore`). Verified badges require actual platform verification. Ratings/reviews and member counts are omitted unless authentically collected and permitted.

Destination routes use the same Harvest public-page design system but module-specific details:
- **Community:** benefits, public description, host, membership rules, pricing, admission route and safe preview; private content never leaked.
- **Course:** syllabus preview, educator, format, duration, free/paid access and enrollment action.
- **Product:** description, inclusions, price, delivery/booking details and secure checkout; membership-included benefit badges must resolve real entitlements.

### 8A.5 Cross-resource buying and access

- A free Harvest account can enroll in free courses and join eligible free communities without paying. Preserve account identity across all hosts and workspaces.
- Buying a course can grant access to a community **only when the owner explicitly configured that benefit**, and membership acceptance/rules may still be required.
- Community owners may attach existing products to a community's Products shelf as `included`, `for sale`, or `visible to certain tiers`. A product is authored and sold through the canonical Commerce catalog and is linked, never duplicated.
- Discovery results must expose real `available_to_user` access state (public sanitized version for anonymous visitors), not speculative purchase/access badges.
- Community links to courses/products are merchandising references, not an automatic right to access, export or resell another workspace's product.

### 8A.6 Discovery data structures (proposed)

Prefer a **read/search projection** derived from canonical `communities`, `courses`, `products` and `offers` rather than creating duplicate ownership or purchase tables:

- `discover_listings`: `id`, `workspace_id`, `resource_type`, `resource_id`, `status`, `owner_opt_in`, `platform_approval_state`, `category_id`, `primary_locale`, `published_at`, `indexed_at`, `search_text`, sanitized public metadata, `version`.
- `discover_categories`: stable taxonomy; product/community/course availability per category, localization, moderation metadata.
- `discover_moderation_reviews`: reviewer, decision, reason, timestamp, appeal status and tenant-safe audit reference.
- `discover_saved_items`: user ID, resource type/id, saved timestamp (private to the user).
- `discover_collections`: editorial collections with inclusion rules and provenance.
- Cross-module publication events: `community.published`, `course.published`, `product.published`, `offer.updated`, `listing.opted_in`, `listing.delisted` produce idempotent indexing jobs.

All public listing records require tenant-owned canonical resource references, a published resource state, owner opt-in and platform approval. Search result filtering occurs server-side, not only in the UI.

### 8A.7 APIs (proposed)

- `GET /api/discover?q=&type=&category=&locale=&price=&cursor=` — typed cross-resource results; sanitized for anonymous users.
- `GET /api/discover/communities?...`, `/courses?...`, `/products?...` — typed facet filtering.
- `GET /api/discover/collections` — approved curated collections.
- `POST /api/me/discover-saved` and `DELETE /api/me/discover-saved/:id` — user saved items.
- `PATCH /api/creator/listings/:resourceType/:id` — owner opt-in, public metadata, listing request; permission checked.
- `POST /api/platform/discover/reviews/:listingId/decision` — audited moderator decision.

### 8A.8 Acceptance criteria

1. A free user can open `/discover`, filter across all three tabs and access a free community/course without a second account.
2. A published, paid course can appear in search only after owner opt-in + approval; buying it creates the correct entitlement, while visiting its public page does not.
3. A private, unlisted, archived or suspended community is absent from search, pagination, cached results, sitemap, recommendations and public metadata endpoints.
4. The owner can opt out and the listing disappears from discovery within a bounded, tested indexing SLA; the direct landing page behaves according to visibility policy.
5. A community product card opens the canonical product/checkout and reports sales attribution to the originating community without duplicating orders.
6. A search query spanning two tenant workspaces returns only approved public metadata and never leaks membership, payment, pastoral or application data.
7. Empty results, failed search, permissions, loading, mobile filters and keyboard navigation are covered by automated tests.
8. Skool-style discovery can suggest topic-relevant **communities**; the unified Harvest directory additionally surfaces **courses and products** as first-class types, with no automatic enrollment.

---

## 9. Harvest Connect, evangelistic campaigns and ministry integration

- A campaign response QR landing page offers free resources immediately, followed by optional Harvest account creation and opt-in community recommendations.
- Offer the organizing ministry's discipleship community first where the member chooses to view it; do **not** auto-join, share personal responses or attribute a conversion without explicit consent.
- Optional referral to a participating church requires a user-selected destination and purpose-specific sharing permission; give pastors **only** authorized follow-up requests.
- Community moderators are not automatically allowed to see evangelistic response forms, religious commitments, prayer requests, private counseling notes or financial giving history.
- For ministry use, enable a restricted follow-up dashboard, assigned discipleship guides, group lessons and pastoral contact requests via Harvest Connect/CRM services.
- A user may participate in free communities without signing up to receive ministry marketing or joining a church.
- Campaign-owned social/newsletter promotion to a community uses existing Harvest services and their separate communication preferences.

---

## 10. Community-level permissions

Use **server-enforced capabilities**, not role names alone. Representative matrix:

| Capability | Owner | Admin | Moderator | Teacher/Pastor | Member | Applicant/Guest |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| View allowed member content | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Create ordinary posts | ✓ | ✓ | ✓ | configurable | configurable | — |
| Edit/delete own posts | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Moderate others' posts | ✓ | delegated | ✓ | optionally scoped | — | — |
| Manage applications/invites | ✓ | delegated | delegated | limited assigned | — | own status only |
| Manage channel access | ✓ | delegated | restricted | — | — | — |
| Create/edit lessons | ✓ | delegated | — | scoped | — | — |
| Configure prices/products | ✓ | delegated commercial admin | — | — | — | — |
| Financial reports/refunds | ✓ | specifically delegated | — | — | own purchases | — |
| Change owner or delete community | ✓ with reauth | — | — | — | — | — |
| View private pastoral cases | only if separately authorized | only if separately authorized | — | assigned only | own | — |

Owners may delegate capabilities; do not assume all administrators have access to member payment methods, private messages or pastoral cases. Maintain distinct community owner, workspace owner, billing manager and platform support privileges. Cache invalidation is required on role changes.

---

## 11. Community management and settings

**General:** name, slug, description, category, languages, cover, badges, archive and deletion.

**Visibility / admission:** listing, share links, open/apply/invite/entitlement admission, join forms, questions, approvals, invitation policy, eligibility, capacity/waitlist if enabled.

**Plans / benefits:** free/paid tiers, prices, trial terms, included courses/products, tier channel visibility, upgrade/downgrade and cancellation rules.

**Content:** categories, channels, forum permissions, welcome/featured posts, keywords, tagging, public previews, attachment limits.

**Members:** search, segmentation, invitation, import with consent, statuses, user roles, complimentary grants, restricted exports.

**Moderation:** reports, banned accounts, post/channel rules, spam thresholds, DMs, appeals and retention.

**Events:** calendar sync, RSVP defaults, host roles, recording access.

**Brand / discoverability:** domain (if supported), themes, thumbnail, SEO, preview, discovery opt-in.

**Notifications / email:** welcome, digest, announcement, transactional templates; consent and suppressions in shared email infrastructure.

**Analytics:** dashboards by plan and eligible role; exports follow permission, retention and privacy rules.

**Integrations:** Harvest CRM, newsletter, courses, products, forms, AI chat, automation, Google/Microsoft calendar when supported.

---

## 12. Shared AI and automations

### 12.1 Admin AI assistant

Allowed capabilities (opt-in, role-scoped): summarize recent community activity, draft welcome posts, suggest FAQs, identify unanswered questions, draft announcements, propose event agendas, outline courses, summarize aggregate engagement and suggest member-safe workflows. All suggested public posts, messages and marketing sends require human confirmation before execution.

Do **not** provide AI with private DMs, payment details, private pastoral notes, CRM data from other workspaces or applicant sensitive answers unless a specific authorized purpose and permission are implemented. Log tool use, redact prompts, rate-limit usage and prevent prompt-injection from member posts.

### 12.2 Automation triggers and actions

Possible triggers: `community.application_submitted`, `.application_approved`, `.member_joined`, `.member_left`, `.plan_changed`, `.post_created`, `.event_rsvp`, `.course_completed`, `.product_purchased`, `.member_reported`.

Possible actions: send transactional welcome, issue course entitlement, create CRM activity, notify moderator, tag consenting member, create assigned follow-up task, schedule reminder, add to newsletter only with separate subscription consent, prepare AI draft for approval.

Each trigger must carry tenant scope, actor/source, event ID and idempotency key. Actions are retriable, audited and respect consent/permissions at execution time—not just configuration time.

---

## 13. Data architecture (Neon PostgreSQL)

### 13.1 Domain tables

Use UUID PKs and typed statuses; most community records carry `workspace_id`, `community_id`, timestamps, and `created_by` where meaningful. Use separate user identity from workspace/team membership.

| Table | Key fields / purpose |
|---|---|
| `communities` | `id`, `workspace_id`, `owner_user_id`, `slug`, `name`, `status`, `visibility`, `category_id`, `primary_locale`, settings JSON, `version` |
| `community_categories` | Directory taxonomy and safe display metadata |
| `community_memberships` | `community_id`, `user_id`, `status`, `joined_at`, `left_at`, `primary_plan_id` (derived access remains in entitlements) |
| `community_roles` / `community_role_grants` | Per-community scoped permissions, explicit grantor and expiry |
| `community_plans` | Plan name, free/paid tier, billing product/price IDs, benefits, trial rules, status |
| `community_access_policies` | Independent visibility, admission, eligibility, invite and form requirements |
| `community_applications` | `user_id`/verified contact reference, state, application form, timestamps, reviewer, decisions; sensitive answers protected separately |
| `community_invites` | Invite token *hash*, invited identity, scope, free/paid grant, expiry, max uses, revocation, issuer |
| `community_channels` | Type chat/feed/announcement, access policy, ordering, archive state |
| `community_posts` / `community_comments` | Author, channel, content body safe representation, moderation state, pinned/featured flags, version |
| `community_reactions` / `community_bookmarks` | Actor, target and type, uniqueness scoped by target/actor |
| `community_messages` / `community_threads` | Channel messages, thread references, attachment IDs, deletion/moderation state |
| `community_reports` / `moderation_actions` | Reported subject, status, authorized reviewers, action audit |
| `community_member_profiles` | Public community profile preferences; private contact details remain in identity service |
| `community_events` | Link to canonical `events` rows, not duplicated event content |
| `community_course_links` | Link canonical courses and visibility/benefit policy |
| `community_product_links` | Link canonical products, position, included/for-sale mode, targeting policy, audience and analytics attribution |
| `community_achievements` / `community_points_events` | Optional gamification events, aggregate levels and anti-abuse audit |
| `community_analytics_daily` | Aggregated scoped metrics, retention and conversion counts with privacy thresholds |
| `community_notification_prefs` | Per-channel/community preferences and version |
| `community_rules_acceptances` | Rule version, timestamp and user acknowledgement |
| `discover_listings` / `discover_categories` | Sanitized public search projection across canonical Communities, Courses and Products; owner opt-in + platform approval |
| `discover_moderation_reviews` / `discover_saved_items` | Approval audit and personal bookmarks; never expose sensitive member data |

### 13.2 Cross-module references

Reuse `users`, `workspaces`, `contacts`, `forms`, `form_submissions`, `courses`, `course_progress`, `products`, `offers`, `prices`, `orders`, `payments`, `entitlements`, `billing_subscriptions`, `events`, `files`, `audit_events`, `outbox_events`, `jobs`, `consents`, and `automation_runs`. Where previous PRDs name similar objects differently, write an ADR and converge on **one canonical schema**, not duplicates.

### 13.3 Constraints and indexes

- Unique `(workspace_id, slug)` or globally unique public handle, whichever canonical URL design requires; document decision.
- Unique active `(community_id, user_id)` membership (using appropriate status handling).
- FK from `community_product_links` to canonical products; enforce permitted same-workspace product ownership or explicit cross-workspace distribution agreements.
- FK from membership/plan grants to entitlement sources; no opaque free-text access flags.
- Index posts/messages by `(community_id, channel_id, created_at DESC)`; index member lookups and application queues.
- Store invite tokens hashed; never store plaintext invitation secrets in database logs.
- Search indexing must exclude hidden/unlisted content and inactive members' private data.
- Tenant-safe authorization at request/service and DB layers, RLS where feasible, with adversarial two-workspace test fixtures.
- Personal, financial and sensitive pastoral data should be protected in their appropriate source services; minimize copying it into community tables.

---

## 14. API and service contracts (illustrative, finalize in OpenAPI)

**Identity / directory**

- `GET /api/discover` — unified eligible community/course/product search with typed filters, rankings and pagination.
- `GET /api/discover/communities`, `/courses`, `/products` — type-specific discovery views.
- Creator listing opt-in and moderated platform approval required before indexing.

- `GET /api/community-discovery?category=&locale=&price=&cursor=` — only listed, approved communities.
- `GET /api/communities/:id/public` — sanitized public metadata respecting visibility.
- `POST /api/communities` — create draft from validated wizard payload, owner only.
- `PATCH /api/communities/:id` — update settings with ETag/version and permission checks.
- `POST /api/communities/:id/publish` — publication checklist then publish.

**Admission / membership**

- `POST /api/communities/:id/applications` — apply, idempotency key, form/schema version.
- `POST /api/communities/:id/applications/:applicationId/decision` — audited approve/reject.
- `POST /api/communities/:id/invitations` — create restricted invitation with expiry.
- `POST /api/communities/:id/invitations/redeem` — verified token/identity, rules/price checks.
- `POST /api/communities/:id/join` — access evaluation and rules acceptance.
- `POST /api/communities/:id/leave` — membership/entitlement coordination.
- `GET /api/communities/:id/membership` — caller's eligibility, entitlements, pending state.

**Engagement / content**

- `GET /api/communities/:id/feed?cursor=&channel=` — authorized paginated posts.
- `POST /api/communities/:id/posts`, `POST /api/communities/:id/posts/:postId/comments` — moderation/role enforced.
- `GET /api/communities/:id/channels/:channelId/messages?cursor=` — channel-specific auth.
- `POST /api/communities/:id/channels/:channelId/messages` — rate limits and validation.
- `POST /api/communities/:id/reports` — report abuse, private to moderation.

**Content/commerce/events**

- `GET /api/communities/:id/products` — resolves purchaser-specific entitlements.
- `POST /api/communities/:id/products` — attach canonical product, not duplicate.
- `PATCH /api/communities/:id/products/:linkId` — visibility, included/for sale, tier gating.
- `GET /api/communities/:id/events` — canonical event references.
- `GET /api/communities/:id/analytics` — creator-only aggregates with role checks.

**All endpoints** must validate workspace/community boundary, actor permissions, state transitions, CSRF/session requirements as applicable, request size and rate limits. All mutation endpoints should support appropriate idempotency and generate audit/outbox events. Avoid uncontrolled cross-tenant `include`/join query patterns.

### 14.1 Canonical events

`community.created`, `community.published`, `community.application_submitted`, `community.application_approved`, `community.invitation_redeemed`, `community.member_joined`, `community.member_left`, `community.plan_changed`, `community.post_published`, `community.report_created`, `community.product_attached`, `community.entitlement_changed`.

Event envelopes: immutable event ID, schema version, `workspace_id`, `community_id`, actor, timestamp, source record ID, consent/visibility classification where needed. Use transactional outbox to avoid losing triggers when database transactions commit.

---

## 15. Nonfunctional requirements

**Security:** Auth required for member content; hidden community URLs reveal no existence beyond safe public metadata. Signed media URLs expire. Prevent IDOR, payment bypass, role escalation, invite replay, XSS, CSRF, unsafe embeds, mass assignment and SQL injection. Virus-scan uploads. Audit sensitive decisions. Strong rate limits for posts, invitations and applications.

**Privacy:** Provide separate membership, marketing and pastoral follow-up consents. Religious-belief and ministry-response data may be special-category personal data in the EEA; require lawful basis and applicable Article 9 condition, retention, transparency, access/export/deletion pathways and appropriate safeguards. Avoid inferred religious labels from joining a community. Member directories should not expose contact email by default. No ad targeting using sensitive pastoral/faith data.

**Performance SLO (initial targets, validate with load testing):** Core member pages p75 LCP <= 2.5s on a representative mobile profile, paginated feeds and channels, responsive optimistic UI where safe, idempotent events with eventual consistency surfaced. Set production throughput targets using measured usage rather than inventing capacity guarantees.

**Accessibility:** WCAG 2.2 AA target, keyboard navigable feed/forms/modal/wizard, captions/transcript hooks for video, accessible error messages, consistent focus indicators and readable contrast.

**Localization:** Unicode, date/time locale, timezone conversion, RTL support at design-system level, multilingual landing pages, forms and invitations. Language filters and safe translated content labeling.

**Reliability:** Error budgets, observability, provider retry/backoff, reconnect state for chat, dead-letter processing, reversible moderation, backups, disaster recovery, audit trails and maintenance-mode messaging.

**Financial integrity:** Payment webhook signatures, out-of-order handling, reconciliation of refunds/chargebacks, immutable financial events, invoice/tax ownership in commerce system, neither payment secrets nor invoice PII in chat events.

---

## 16. Analytics and success metrics

**Acquisition:** page views → Join click → sign up → application started/completed → approved → membership activated; attribution limited to consented/trusted sources.

**Engagement:** active members by week/month, meaningful posts/replies, unanswered questions, event participation, course progress, returning members, moderator response time.

**Retention:** 7/30/90-day cohorts, membership cancellations and reasons, dormant community alerts; distinguish lurkers from churned members.

**Commerce:** community-attributed product views → checkout → confirmed purchases, conversion by plan, upgrade/downgrade, refunds, net revenue and included-product use.

**Safety/quality:** report resolution time, moderation appeals, spam rates, invitation abuse, accessibility errors, app crashes and failed automation runs.

**Privacy constraints:** Do not expose individual members' sensitive course/faith activity in generalized analytics. Apply aggregation thresholds for small populations and community size; provide aggregated pastoral metrics, not surveillance dashboards.

---

## 17. Edge cases and required behavior

1. User has a Harvest account already from another workspace → join without new account and without workspace-admin access.
2. User applies twice → one active application, safe idempotent response.
3. Application approved but paid checkout fails → remains approved/payment pending, no member access.
4. Invite forwarded to unintended person → identity-bound invite refuses redemption.
5. Invite expired or already used → secure explanation and request new invite.
6. Member leaves free community and rejoins → membership restored according to policy, preserve owned content/progress and moderation status.
7. Member banned buys membership → payment must not bypass ban; refund/hold according to policy.
8. Subscription cancelled, but another product entitles access → retain access from other valid grant.
9. Product bought individually then removed from community → purchased entitlement persists.
10. Community tier downgraded → tier-only channels/files inaccessible promptly, without deleting historical audit.
11. Community hidden after listed → remove from discovery/search/index caches; private posts not retained in public CDN cache.
12. Owner deletes a public post with comments → preserve moderation/audit policy; show appropriate tombstone.
13. Realtime chat disconnects → message draft preserved, retry without duplicate messages.
14. Purchase webhook arrives before account reconciliation → deferred linkage via verified identity and idempotent processing.
15. Owner tries to attach a product belonging to another workspace → reject unless explicit supported distribution agreement.
16. A person is referred from Harvest Connect → joining community does not share their sensitive response/counseling details with moderators.
17. Several moderators decide same application simultaneously → optimistic locking, one authoritative final decision.
18. User deletes account → access removed, public contributions handled under documented deletion/anonymization policy.
19. Member is a minor → age policy and enhanced direct-messaging/privacy controls apply.
20. Community owner loses billing eligibility → access/publication transitions defined without deleting member-owned purchases.

---

## 18. Acceptance criteria (release gates)

### A. Creation and lifecycle

- [ ] Community owner can create a draft with the shared wizard, close, resume, edit and preview as different membership states.
- [ ] Community publishes only after required checks pass; unpublish/archive preserves legitimate records and purchased rights.
- [ ] Each module and view uses the shared Harvest design tokens and layout system.

### B. Visibility and joining

- [ ] Listed, Unlisted and Hidden behave differently in directory, search, public page, metadata and cached content.
- [ ] Free open join, form application, invitation-only, paid, paid-with-approval and qualifying-entitlement paths work in end-to-end tests.
- [ ] Rejected/unapproved users cannot access gated community content via direct URL or API call.
- [ ] An invite cannot be reused or redeemed by a different identity when identity-bound.

### C. Member experience

- [ ] Members can participate in authorized channels/feed, post/comment/react, receive notifications and manage own profile/privacy.
- [ ] Moderators can act on reported content and bans while lacking financial and private pastoral data by default.
- [ ] Course progress, events and member access respect tier/entitlement rules.

### D. Products and commerce

- [ ] Owner attaches one canonical Harvest product and chooses Included or For Sale.
- [ ] Member who owns product sees `Open`; member without access sees legitimate purchase/upgrade action only when checkout is live.
- [ ] Revoking community-included access does not revoke separately purchased products.
- [ ] Confirmed checkout, refunds, failed payment and chargebacks have tested entitlement behavior.
- [ ] Sales are attributed to community without duplicate orders or cross-workspace exposure.

### E. Harvest Connect and discovery

- [ ] Unified `/discover` supports Communities, Courses, Products, search, filters, published-only approved listings and secure user access.
- [ ] Both individual creators and ministry workspaces can host communities with correct tenant and billing boundaries.
- [ ] Explicit directory opt-in plus platform review determines discovery visibility; private/invite-only records never leak.
- [ ] Minors launch policy (18+ by default) and safety reporting are enforced; no unrestricted adult-to-minor messaging.

- [ ] Free account can browse listed communities without joining; hidden/unlisted communities remain excluded.
- [ ] Campaign QR participant can access resources and freely opt into a community without forced account signup or forced pastoral follow-up.
- [ ] Community owner cannot see campaign response/faith data without separate permission and purpose.

### F. Operational quality

- [ ] Two-workspace adversarial tests find no leakage in APIs, search, URLs, notifications, AI and media.
- [ ] All key flows work on representative mobile and desktop browsers; accessibility checks pass.
- [ ] Core actions are logged, retries are idempotent, errors are visible and no placeholder buttons are classified as complete.

---

## 19. Implementation plan and suggested PR slices

**Dependency note:** Keep the founder's agreed release order (Foundation → Social/AI → Ministry → Communities/newsletters/chat/forms → Commerce). Primitives such as entitlements, permissions, identity and forms must be built as shared services *before* shipping the full Communities module. The Community module should not wait for full monetization to support free membership, but paid flows cannot go live without the Commerce release gates.

| PR | Deliverable | Key dependencies | Exit test |
|---|---|---|---|
| C01 | Architecture ADR, feature flags, ownership boundaries | Foundation | Approved schema/contracts |
| C02 | Community tables, workspace isolation, migrations | Neon/auth | Two-tenant tests |
| C03 | Roles, permissions, lifecycle and entitlements integration | Auth/entitlements | Role escalation blocked |
| C04 | Shared community creation wizard definition | Harvest UI framework | Draft/resume/create tests |
| C05 | Public landing, discover index and visibility policies | Search/SEO | Private not indexed |
| C06 | Open join, rules acceptance, member dashboard | Identity | Free join E2E |
| C07 | Application forms, review queues and decisions | Shared forms | Apply/approve/reject E2E |
| C08 | Secure invitations, complimentary grants, redemption | Identity/notifications | Expiry/replay tests |
| C09 | Member shell, navigation, profiles and preferences | App shell | Mobile/a11y tests |
| C10 | Feed, posts, comments, reactions, categories | Media/moderation | Content E2E |
| C11 | Chat/channels, unread/realtime, attachments | Messaging infrastructure | Reconnect and auth tests |
| C12 | Moderation tools, reports, ban/mute controls | Permissions | Restricted moderation E2E |
| C13 | Classroom/course links and learning progress | Courses/entitlements | Tier + access tests |
| C14 | Events/RSVP and calendar linking | Events/calendar | RSVP E2E |
| C15 | Member notifications, onboarding and digest controls | Email/notifications | Opt-outs respected |
| C16 | Products shelf: canonical links and free included grants | Products/entitlements | Shared product access tests |
| C17 | Paid plans, checkout, product sales, refunds | Commerce/payments | Webhook/financial E2E |
| C18 | Freemium, tier gating, plan changes, bundles | Commerce | Downgrade/revoke tests |
| C19 | Gamification/challenges (optional) | Engagement | Anti-abuse tests |
| C20 | Discover recommendations and Harvest Connect integration | Campaigns/CRM | Consent boundary tests |
| C21 | Community analytics and aggregate reporting | Events/outbox | Reporting correctness |
| C22 | Admin AI/automation tools and safety approvals | AI/automation | Action approval E2E |
| C23 | Security/privacy/performance/a11y hardening | All | Release gate checklist |
| C24 | Documentation, migration guide, operational runbook | All | Independent review |

PR numbers are **suggested engineering slices**, not guarantees that exactly 24 PRs will suffice. Split large PRs by independently testable vertical slices.

### Minimum releasable version (first Communities release)

Ship: community create/edit, listed/unlisted/hidden, free open/application/invite joining, member roles, feed with comments, channels or simple discussion (choose one to finish thoroughly), basic moderation, member onboarding, free community discovery, course linking and product shelf in free/included mode. Add events if underlying service is ready. Gate paid plans, tiers, advanced chat, gamification and AI until their acceptance criteria pass.

### Full parity direction

Build toward the complete documented feature inventory—including paid memberships, multiple tiers, real-time channels, communities bundled with products, in-community upsells, course progress, events, moderation tools, advanced analytics and automations—without treating an empty screen as a shipped feature.

---

## 20. Handoff to Chief of Staff / coding agents

Before implementation:

1. Read master PRD v2.5, companion v2.7, shared UI/architecture specification, Harvest Connect v1.1 and current repository architecture files.
2. Compare proposed schema/API names with existing ones; produce an ADR for naming collisions, no parallel duplicate models.
3. Write `docs/prds/harvest-communities.md` from this PRD, list open product decisions and implementation prerequisites.
4. Break work into dependency-ordered small PRs with owner, files touched, DB migration, tests, screenshots and definition of done.
5. Build a **working free-member journey** before adding complex paid access; finish payments only after Commerce integration is verified.
6. Reuse established app shell, creation wizard engine, shared forms, pricing/access components and canonical products/CRM/events services.
7. Run Playwright end-to-end scenarios on desktop and mobile plus integration tests for visibility, permissions, entitlements and join flows.
8. Maintain a living coverage matrix: `specified → implemented → integrated → tested → production-ready`.

### Open decisions to resolve before paid production release

- Global handle vs workspace-scoped community slug.
- Supported payment provider(s) and country-specific tax/refund rules.
- Chat architecture and moderation policy, including age/safeguarding requirements.
- Plan and community limits by Harvest subscription tier.
- Whether communities are always represented as store products internally or simply share the commerce offer/entitlement system; **prefer one canonical offer relation rather than duplicate commercial entities**.
- Default policy for one-time/lifetime memberships when community closes.
- Data retention and export policies for applicants, departed members, chat content and pastoral interactions.

### Definition of success

A new user can create a free Harvest account, find a listed free community, join, participate, access included courses and products, and leave—without broken states or permission leaks. A host can create the community through the shared wizard, manage applications/invitations, and offer canonical Harvest products from inside it. A paying member can buy a qualified plan or product and obtain precisely the access purchased, with verified payment events and safe revocation. The same application shell, design tokens and shared services work for both creators and ministry communities.

---

## Reference documentation (product research, not implementation dependencies)

- Eden — Start a community: https://eden.so/help/communities/start-a-community/
- Eden — Join a community: https://eden.so/help/communities/join-a-community/
- Eden — Add products to your community: https://eden.so/help/communities/community-courses/
- Eden — Communities overview: https://eden.so/help/communities/
- Skool — Pricing types: https://help.skool.com/article/215-how-to-setup-pricing-for-the-group
- Skool — Member invitations: https://help.skool.com/article/14-how-do-i-invite-members-to-my-community
- Skool — Points and levels: https://help.skool.com/article/183-how-do-points-and-level-work

**Implementation requirement:** Treat vendor feature descriptions as inspiration and verify current behavior, API support and legal/licensing constraints independently. Harvest's own product decisions take precedence.
