# Free courses and products — proposed design

Status: proposal, 17 Nov 2026. Documentation only: nothing in this design is approved or built. No deployment, collection, provider integration or activation is authorized. All five HC-02 decisions remain **UNAPPROVED**.

## Summary (10 lines)

1. Courses, downloads, workshops and links to canonical communities are proposed PUBLIC-mode product types.
2. All access is free until the founder opens an LLC; V1 has no price fields, checkout or coupons.
3. One canonical product references one canonical course, download bundle, workshop or community; attaching it elsewhere never copies it.
4. Existing account identity and shared entitlements govern free enrolment and access, without granting ministry membership.
5. Courses contain ordered lessons, rich text, private R2 file references and privacy-friendly click-to-load video embeds.
6. Progress belongs to the learner, survives loss of one grant, and is never exposed through public discovery.
7. Public catalogue metadata is sanitized; private content and hidden resources remain inaccessible without authorization.
8. Communities C13/C16 and Discover consume canonical resources through shared access and listing contracts.
9. Authoring uses the existing editor-mode design; coaching, booking, AI generation and paid access are deferred.
10. C1–C4 server slices precede separate UI slices; founder choices and legal/privacy reviews remain open.

## 1. Goals, boundaries and evidence

Propose a complete free author → publish → enrol → learn/download workflow for churches, ministries and missionaries. Reuse the application shell, identity, files, audit and community infrastructure; use “ministry” in user-facing wording and `workspace` internally. PUBLIC is the product placement, not a claim that lesson content is public.

Non-goals: payment processing, price/currency columns, coupons, subscriptions, coaching or calendar booking, AI course generation, certification, quizzes, gamification, automatic CRM enrolment, newsletter subscription, real messages, deployment or activation. Future selling requires separate design and legal/provider decisions under [ADR 0012](../../decisions/0012-payment-provider-separation.md). No donation or SaaS-billing adapter is reused for selling.

Authority: [launch scope exception](../../prd/professional-v1-launch-scope.md#scope-exception-16-nov-2026), [Communities C13/C16](../../prd/harvest-communities.md), [ADR 0013](../../decisions/0013-communities-architecture.md), [editor mode](2026-11-16-shell-editor-mode-design.md), [Live embed rules](2026-11-16-community-live-design.md#5-youtube-url-validation-and-the-embed).

Checked at main `4f554ed`: `src/db/schema.ts` has canonical `entitlements` and `discover_listings`, both constrained to `community` today; `src/server/communities.ts::communityAccess` requires active membership and the union of valid same-ministry grants (or a community staff role). `src/lib/community-listing.ts::listingFor` checks publication, listed visibility, owner opt-in and eligibility; `discoverEligible` currently returns true, pending billing. These are existing contracts to extend, not generic course support already built. No new duplicate entitlement or discovery engine is proposed.

Read-only visual research in `bumbmatei-sys/harvest-agent`, `docs/prd/screenshots/`: personally inspected `10-products/products-013`, `034`, `041`, `056`, `059`, `064` and `05-communities/comm-057` WebP files. They show a type picker, item sidebar with type-specific steps, a form beside a preview, ordered lessons/welcome content, a questions inbox and call-type configuration. Only interaction structure informs this proposal. No screenshots, imagery, branding, wording or code are copied. In particular, reference AI and paid/booking controls are not V1 requirements. Studio Admin and Harvest shadcn components remain the visual contract; Claude owns implementation of shell and screens.

## 2. Canonical product types and relationships

| Type | Canonical target and delivery | Proposed V1 |
| --- | --- | --- |
| Course | One course with ordered sections/lessons | Free enrolment and protected learner access |
| Download | One versioned collection of existing private file ids | Free grant, then authorized short-lived downloads |
| Workshop | One workshop referencing a community Live event | Free enrolment plus existing community membership/access; no bypass of Live's member-only rule |
| Community link | Reference to an existing community in the same ministry | Redirect to its canonical join/access flow; never create a second community |
| Coaching | Booking, availability and calendar integration | Deferred; disabled ports alone do not implement booking |

`products` owns the catalogue identity and editorial state. `courses` owns curricula, `community_live_events` owns Live lifecycle, `communities` owns membership. A product is not a new copy of those resources. Enforce one product per canonical course target in a ministry; Discover uses `course` for course-backed products and `product` for downloads/workshops, avoiding duplicate search hits. A community-link product does not create a second Discover listing for that community.

Community classroom/product shelves contain links to those canonical ids. V1 links are same-ministry only; cross-ministry licensing/distribution is deferred. Linking or displaying a resource never grants access. A separately enrolled learner retains an independent grant after leaving a community. Conditional included access requires an active qualifying community membership and grant on every check; removing that link ends only its conditional grant. Reject cyclic bundle/access dependencies; no bundles in V1.

Workshops initially use existing community Live membership checks and the Live visibility window. Product enrolment alone cannot reveal a member-only event. The detail page must disclose the community requirement before enrolment. A public workshop player or independent workshop replay would require a separately reviewed change to Live; it is not implicitly added here.

## 3. Proposed data model and isolation

Indicative names, finalized in C1 after a schema audit; no migration is included here.

| Relation | Principal fields and invariants |
| --- | --- |
| `products` | tenant/id, kind, canonical target, globally unique public slug, title, sanitized summary, cover file id, visibility listed/unlisted/hidden, draft/published/archived, discover opt-in, creator, version, timestamps; no price fields |
| `courses` | tenant/id, welcome rich-text document, curriculum version; product reference is unique and same-tenant |
| `course_sections`, `course_lessons` | tenant/course/id, stable position, title, validated rich-text JSON, draft/published state, content version; references cannot cross tenants/courses |
| `product_files`, `lesson_files` | tenant/resource/file composite references, position and published revision; canonical R2 `files` remain storage owner |
| `course_enrolments` | tenant/course/user, enrolment timestamp and status, notice version; unique per learner/course, not a duplicate person |
| `course_progress` | tenant/course/lesson/user, lesson revision, completed timestamp; unique per learner/lesson; no viewing heartbeat history |
| `community_product_links` | tenant/community/canonical resource, display position and optional conditional inclusion; same-tenant FK and no copied curriculum |
| `course_questions`, `course_answers` | tenant/course/lesson, author, plain text, held/published/hidden/deleted state, moderator and timestamps; separate restricted moderation history |

Every new table enables and **FORCEs RLS**. Composite foreign keys bind tenant and target id; polymorphic product targets require a constrained same-tenant ownership trigger or concrete FK columns with an exactly-one-target check. Never trust a client tenant/resource pair. Staff reads/writes use existing `withTenant` and named permissions; learner reads use verified `withUser` plus a grant-aware predicate. User-owned progress is visible only to that user and explicitly authorized course staff, not other learners or ordinary ministry viewers. Ministry membership is never created by enrolment.

Public visitors have no table grants: narrow sanitized published-only resolvers expose metadata. Definers use `SET search_path = pg_catalog, pg_temp`, fully qualified references, revoke PUBLIC, restrict execution, and authorize tenant/resource before returning fields. Every table and definer is tested with `testDatabase({migrationOwner:true})`; FORCE RLS must hold for the restricted migration owner as well as the app role. Optimistic versions and transaction-bound audit rows protect staff edits; audit metadata holds ids/states/versions, not lesson questions or personal data.

## 4. Shared entitlement and enrolment contract

Proposed `resolveResourceAccess(userId, resourceType, resourceId)` returns a decision and source ids to server callers; it is not a public grant-enumeration API. Resolve target ownership, publication/archive policy, revocation, validity windows and all applicable grants at read time. The union rule remains: revoking one source cannot revoke an independent valid grant. A learner's own grant can be read without exposing other subjects or grant reasons.

Extend the existing entitlement resource/source checks and `entitlements_guard` for courses/products; a new `free_enrolment` source and conditional `community_included` source are proposed. Existing community behavior and paid-source refusal must remain unchanged. Store source linkage to enrolment/community link for idempotency and revocation; enforce same-tenant ownership in the database. Never use a UI flag as proof of access.

Authenticated free enrolment locks/validates the published target and creates enrolment plus grant atomically, idempotently, with audit. A forged user id is ignored; the server takes identity from the session. Repeated clicks/retries produce one effective grant. No anonymous email-only account or enrolment is silently created. Community-link products invoke canonical joining, including rules/application requirements; enrolment cannot bypass them. Downloads authorize each request and issue short-lived private-object URLs only after access checks; expiry limits but cannot retract a URL already issued.

Progress is an idempotent explicit completion action, not proof of watching. Preserve it when access ends, subject to retention/erasure; deny further content reads and progress writes until access returns. New lesson revisions do not silently erase completion: show the completed revision and disclose updated content. No automatic course-completion certificate or claim of assessed competency.

## 5. Lessons, files and video privacy

Use a bounded rich-text JSON schema with an allowlist of nodes/marks, escaped text, safe links and server validation; no raw HTML, scripts, arbitrary iframe or remote import. Validate file ownership and ready/published attachment state; never make the underlying R2 bucket public. File authorization must cover lesson attachment routes, not just product pages. Malicious uploads, executable content and malware handling remain file-service gates; a private object is not automatically safe.

Reuse Live's pure URL-to-id validator and canonical `youtube-nocookie` embed builder for lesson videos. HTTPS exact-host allowlist, 11-character id, no pasted HTML, no server fetch, no autoplay. Click-to-load with a local placeholder and a disclosure before any iframe/image/provider request; route-scoped CSP admits only the canonical embed host. No provider thumbnail fetch. Previews use sample content, no tracking, sends, grants or downloads. A published preview lesson, if later supported, needs an explicit public-content projection; default none.

## 6. Catalogue, detail and Discover

Proposed public catalogue/detail routes are finalized with routing owners before UI implementation. Signed-out visitors see only published sanitized title/summary/cover/type/ministry, prerequisites and a sign-in-to-enrol action. Never expose learner names, enrolment counts, file keys, lesson bodies, questions, private Live ids or grant state. Sign-in must preserve a safe same-origin return path.

Listed resources may appear in the ministry catalogue; unlisted resources require their canonical link and are excluded from search/Discover; hidden resources reveal nothing to unauthorized visitors. Discover additionally requires owner opt-in, current eligibility and publication. Delisting/unpublishing invalidates projection and caches in the same transaction or a transactionally queued idempotent operation with fail-closed public resolution. Draft/archived targets never remain publicly resolvable from a stale listing. Default: hidden draft, Discover opt-in off.

Extend `discover_listings` as a projection, not catalogue ownership. Communities keep their canonical listing; course/product type filters are added only when real targets exist. No speculative tabs, prices or access badges. Authenticated access badges come from the same access contract; public search never joins personal grants. No fake subscription eligibility claim: document the current `discoverEligible` placeholder until billing replaces it.

## 7. Privacy, questions and retention

Collect the account id, enrolment time, notice version and explicit completion marks needed for delivery. Do not collect religious classification, detailed watch history or prayer/pastoral notes. No hidden newsletter or outreach opt-in; enrolling, downloading and asking a question never change the consent ledger. CRM linking is a separate explicit, disclosed, permissioned action to a canonical same-ministry contact; no contact is created automatically. Existing consent-purpose notices and `mayContact` remain authoritative for any later marketing workflow.

Questions are opt-in per course, off by default. Enrolled learners can submit bounded plain text to a private held queue; authors can read their own submissions. Authorized course moderators can answer, hide, redact and audit without copying community roles globally. Publish an anonymized question/answer to other enrolled learners only after explicit author agreement; never auto-post into a community forum. No AI reading or answering of questions in V1. Rate limits, reports and safeguarding escalation are required before collection.

Retention, adult-account/minors rules, international access and deletion of learner progress/questions need privacy/legal review before real collection. Proposed operational default: retain progress only while the account remains plus a reviewed recovery period; do not choose a legal period here. Erasure deletes identifying progress/enrolment/question content, revokes grants, invalidates caches and cleans file access links; any minimal audit retention requires an approved policy. Content ownership and learner deletion are separate so deleting one learner does not delete the ministry curriculum. All HC-02 gates remain UNAPPROVED.

## 8. Permissions and editor mode

Proposed capability keys, not implemented or approved:

| Capability | Proposed default |
| --- | --- |
| `products:read` | Ministry owner/admin/member; viewer gets sanitized editorial metadata only |
| `products:manage`, `products:publish` | Owner/admin only |
| `courses:author` | Owner/admin; delegated instructor role deferred |
| `courses:moderate_questions` | Owner/admin; explicit scoped delegation later |
| `courses:read_learners` | Owner/admin only, audited; no public roster |
| Learner enrol/read/progress/question actions | Authenticated subject with the required resource access; no ministry role needed |

Server services and RLS enforce each action. Product management grants no right to inspect unrelated CRM, community private content, prayers or donor data. Community moderators have no course-authoring permission merely by role.

Configure existing editor-mode context and shared `EditorShell`, forms, rich-text editor, file picker, publish checklist and preview contract; never fork AppShell/navigation. Proposed steps: course Basics → Lessons/welcome → Access → Page → Publish; download Basics → Files → Access → Page → Publish; workshop Basics → Canonical Live event/date → Access/prerequisites → Page → Publish; community link Select community → Page/display → Publish. No Knowledge/AI or Coaching steps in V1. Autosave/resume and optimistic conflict handling reuse the campaign/editor approach after its contract exists. Preview renders public content with sample visitor/learner state, never real people; click-to-field and phone-first behavior follow the shell spec. Claude owns screens, navigation, messages and preview implementation in separate UI PRs.

Publish checklist checks ownership, safe content, ready files, required lessons/event, declared prerequisites, current visibility and privacy notices. No “Test checkout” or nonfunctional purchase button.

## 9. Future paid seam

Resource identities, enrolments, grant resolution and content delivery remain stable. Future commerce adds distinct offers/prices/orders and provider-domain ledgers referring to canonical product ids; it does not retrofit monetary values into V1 lessons or free grants. Confirmed, idempotent server-side payment events may later issue a new independent grant source; browser redirects never do. Existing free grants keep their disclosed access terms. Coupons, refunds, tax, receipts and provider selection need separate designs and written decisions. Nothing here selects a provider or opens paid functionality.

## 10. Dependency-ordered slices and acceptance

| Slice | Proposed bounded delivery | Required evidence |
| --- | --- | --- |
| C1 | Canonical data + entitlement extension, free enrolment/access, no UI | Restricted-owner migration/upgrade tests; tenant/resource/source integrity; union/revocation/idempotency; community regression |
| C2 | Authoring services, versioned lessons/files, lifecycle and publish checklist | Owner/admin vs member/viewer; hostile rich text/URLs; file ownership; optimistic conflict; audit rollback |
| C3 | Sanitized public catalogue/detail server, Discover and C13/C16 canonical links | Listed/unlisted/hidden/draft/archive; signed-out denial; stale projection/cache; cross-ministry links refused; no enrolment by GET |
| C4 | Learner delivery, progress and separately reviewed held questions | Self-only progress, removed access, revision semantics, erasure, question disclosure/moderation and abuse controls |
| UI after server contracts | One separate PR per editor, catalogue/detail, learner and community consumer | Claude-owned shell reuse; real workflows; mobile/tablet/desktop, light/dark, keyboard/axe, no preview effects |

Every implementation PR has a draft, fresh independent review, acceptance record, lint/typecheck/unit/integration/build evidence, and explicit CI/Neon/browser limitations. Migrations use the journal's next candidate at implementation time, preserve snapshots/prevId and monotonic journal times. No migration number is reserved by this design. Production migrations 0031+ remain unapplied. Activation requires the separate unresolved privacy/security and operational gates.

## 11. Threat model

| Threat | Proposed control and negative test |
| --- | --- |
| Guessed lesson/file ids, cross-tenant target substitution | Composite references, grant-aware FORCE RLS, authorized file delivery; two tenants/two resources and direct SQL tests |
| Revoked/expired access cached in a URL or projection | Check current grant on each new request, short URL lifetime, fail-closed resolver and cache invalidation tests |
| Forged enrolment or duplicate grant, membership bypass | Session identity, atomic unique keys and canonical join; concurrent retry tests |
| Stored XSS, embed SSRF or provider tracking before consent | Strict rich-text/URL schemas, no fetch, click-to-load, CSP, hostile payload and no-network tests |
| Religious/learner inference or question exposure | Minimal data, self-only progress, private held questions, no public roster/counts; response field allowlists |
| Abuse, unsafe content or copyright infringement | Reporting, moderation, upload controls and ministry takedown procedure; launch gates require operational ownership |

## 12. Founder questions with recommended defaults

- Which V1 types? Recommend course, download, community link and community-bound workshop; defer coaching, AI generation and booking.
- Does free enrolment grant lasting access? Recommend independent access while the ministry keeps the resource available, with clearly disclosed archive/removal terms; conditional community inclusion remains conditional.
- Can workshops be public? Recommend no: preserve community Live membership/window rules; separately specify independent public workshops if needed.
- Who may author or inspect learners? Recommend owner/admin only initially; instructor delegation must be scoped and audited before adding it.
- Are learner questions needed at first launch? Recommend off by default and private-held first, optional anonymized publication with agreement; no automatic forum cross-posting.
- Should enrolment create CRM contacts? Recommend never automatically; a separate explicit association only, with no marketing opt-in.
- Retention/minors/content-removal obligations? Recommend adult accounts and minimum collection pending qualified legal/privacy review; no retention period or legal basis is approved here.

## 13. Unverified assumptions

No implementation, migration, runtime tests, browser prototype, provider API or legal review was performed for this proposal. The inspected screenshots establish visible structure only, not reference-product behavior or licensing rights. R2 malware handling, exact shared rich-text attachment authorization, public route naming, future instructor delegation, production billing eligibility and editor autosave/preview readiness require their owning slices to verify. Shell PR #111 is active at this snapshot; this document neither modifies it nor assumes its UI is merged. Live L1 server is a separate requested task and is not claimed built here. No founder answers have been fabricated.
