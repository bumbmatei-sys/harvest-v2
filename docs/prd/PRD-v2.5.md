# HARVEST v2.5 — SOCIAL STUDIO + TWENTY-INSPIRED CRM PRD
## Product requirements, Neon architecture, design system and AI-assisted implementation roadmap

**Date:** 4 November 2026  
**Status:** Proposed implementation baseline; founder decision: zero clients, clean greenfield application.  
**Source basis:** Harvest v1 source audit and PRD, Eden public documentation as of November 2026, and founder's stated scope/priorities.  
**Key changes in v2.5:** Founder confirmed **shadcn/ui + Postiz-inspired original screens + Zernio API**, and chose **Twenty CRM** as the CRM feature/UX reference. No unreviewed AGPL code is to be merged into proprietary Harvest. The prior v2.3 release order remains unchanged. Added a formal rebuild rationale and decision guardrails.

**Prior release-order decision:** Founder-requested release sequence is **1 → 4 → 5 → 3 → 2**: foundation → broad creator beta (especially social + Link in Bio, AI agents) → ministry expansion → community/newsletter/AI Chat MVP completion → full commerce. A thin shared commerce and contact data foundation precedes finished storefronts; this is dependency scaffolding, not a reordered product launch. Postiz is a UI reference, not a default copied dependency.  
**Confidence:** Planning-grade estimates; not validated against end-to-end performance in a live deployment.

## 1. Executive decision

Build a **new** Harvest creator-and-ministry SaaS on **Neon PostgreSQL** and keep Harvest v1 as a read-only design/feature reference. There are **zero paying clients**, so do not build Firebase compatibility, dual-write, or a routine historical customer-data migration. Inventory and preserve any founder data, ministry records, financial logs, consent records or personal information before retiring the old project.

**Product priority and required order:** (1) technical foundation and unified CRM spine; (2) broad creator beta led by **Social Studio: planner + Link in Bio**, then custom AI, memberships/courses essentials and automation foundations; (3) church/ministry functionality, including outreach, events and check-in; (4) complete communities, newsletters, full AI Chat and forms; (5) mature products, payments, storefronts and commerce. Some small primitives (contact records, forms, entitlements and purchase placeholders) must exist early to make earlier releases real, but full commerce is deliberately last. Do not claim later modules are complete when only dependencies are implemented.

**Explicit exclusions:** Eden Discover/trending content research, creator tracking/competitor feeds, browser extensions, and copying Eden trademarks/assets/source code. Eden is a benchmark for independently built functionality and user experience, not an asset source.

**Quality rule:** No module is “done” based on screenshots, stubbed buttons, mock metrics, or merely existing routes. Done means persisted records, real workflows, permissions, empty/error/loading states, audited external actions, automated tests and verified usability.

## 1A. Why Harvest is being rebuilt from scratch

**Decision:** Create Harvest v2 as a new, independently structured product on Neon PostgreSQL. Archive v1 as a read-only reference for requirements, workflows, tests, approved assets and useful algorithms. This is a deliberate product and engineering reset—not a claim that the existing code has no value.

### 1A.1 What prompted the reset

- **Observed product experience:** The founder reports that most existing workflows are non-functional, unfinished or clunky despite the repository's very large size. This founder-observed usability problem is the principal reason for rebuilding; it should not be confused with a completed production QA audit of every route.
- **Code volume does not equal delivered value:** The earlier audit estimated roughly 195,000 lines of TypeScript/TSX application code and 289,000 lines of test code. Large volumes of code and tests can coexist with fragmented user journeys, unimplemented integrations and inconsistent interaction patterns. These counts are approximate and not a measure of defects.
- **Fragmented feature development:** v1 accumulated pages, screens, feature gates, stubs and integrations without sufficient proof that critical paths work end-to-end. V2 will define a feature as complete only after a real workflow succeeds with persisted data, permission checks, errors and automated regression coverage.
- **Different technical foundation:** The target architecture is a Neon/PostgreSQL-native, relational, workspace-scoped SaaS. Extending a Firestore-oriented architecture and its assumptions would add transitional complexity rather than optimize for the intended product.
- **Changed product priorities:** The intended platform is now social/creator-first, with Postiz-inspired Social Studio and Link in Bio, Zernio integration, Twenty-inspired CRM, AI and later ministry capabilities. Refactoring all existing UI and data contracts to match this plan could cost more than selectively rebuilding the needed functionality.
- **No customer migration burden:** There are zero clients. Therefore there is no paying-customer downtime, legacy tenant compatibility or customer cutover requirement. Still inventory any founder-owned records, financial records, assets, API configuration, security logs and consent data before decommissioning v1.
- **Design consistency and development velocity:** A single shadcn/ui design system, reusable blocks, established application patterns and shared service contracts should reduce duplicate UI work and make the platform easier to maintain and test. Prebuilt screens accelerate frontend delivery but do not replace backend work or external integration testing.

### 1A.2 Why not continue repairing v1?

A repair strategy remains valid if a bounded audit shows that the core architecture, important workflows and test fixtures can be salvaged cheaply. However, the current decision favors a greenfield v2 because the reported breadth of broken functionality, the Firestore-to-Neon architectural change, the redesigned product scope and the absence of clients together make a staged replacement more attractive. **This is a reasoned decision, not a proved quantitative claim that a rebuild is always cheaper.** Reassess after the first implementation milestone using actual delivery speed and defect rates.

### 1A.3 What must be preserved—and what must not be copied blindly

**Preserve:** v1 source in a tagged, read-only repository; original product requirements; Eden research/screenshots for lawful visual reference; functioning independently tested domain logic; permitted media/branding; relevant security lessons; useful tests rewritten against the new contracts.

**Do not carry forward by default:** Firestore-shaped schema assumptions, unused routes, non-functional UI, mocks presented as real features, duplicate business logic, unreviewed dependency trees, insecure authorization patterns, or AGPL-licensed code incorporated into a closed-source product without a licensing plan.

### 1A.4 Rules that make the rebuild worthwhile

1. **One working journey at a time:** A feature ships only when its full path works from UI through Neon and external providers, with correct permissions and recoverable failures.
2. **Platform spine first:** Tenant isolation, authentication, unified contact identity, jobs, audit logs and design tokens precede feature expansion.
3. **Reuse components, not technical debt:** Favor tested shadcn/ui patterns, approved blocks, API adapters and reference implementations. Prefer independent implementations for Postiz/Twenty application UX unless the specific imported code's license permits the intended use.
4. **No phantom progress:** A route, screenshot, passing mocked unit test or CRUD scaffold alone is not evidence of production readiness.
5. **Measurable checkpoints:** After each release measure successful user journeys, critical bugs, provider integration reliability, rework rate and time-to-fix. Stop or revise the greenfield plan if these measures do not improve on v1.

**Definition of success:** Harvest v2 has less unnecessary complexity, demonstrably working end-to-end workflows, a consistent user experience, trustworthy multi-tenant isolation and a codebase a solo developer can maintain with AI assistance.

## 2. Target customers, user journeys and outcomes

Primary early customer: Christian creator, teacher, author, ministry media team, small nonprofit, church communications team or faith-based business that needs to **sell, communicate, publish, organize community, and use AI in one workspace**. The platform remains general enough that a church can use the creator features without being forced through ministry-only flows.

**Social-first north-star journey:** Sign up → create workspace → connect a social account through Zernio → draft content → preview by platform → schedule and confirm publication → create Link in Bio landing page → add social links, signup, courses and product CTA blocks (if available) → track views/clicks → manage leads in one workspace. Custom AI-assisted drafting and automations follow, then ministry workflows, then full community/email/chat and commerce depth.

**Secondary journey:** A customer purchases a course → receives a valid entitlement → is enrolled or offered membership → receives an opt-in onboarding sequence → accesses lessons and a community → the creator sees customer status and revenue without duplicating records.

**Later ministry journey:** Publish church location/map → create evangelistic outreach → volunteers register via form → check-in → consented CRM follow-up → church/community invitation and course enrollment.

**KPIs for pilots:** first-product publish rate; first successful test checkout; buyer entitlement correctness; creator time-to-first-newsletter; scheduling success rate; AI Chat successful task completion; community member activation; cross-module contact deduplication; P0 end-to-end success; errors per 1,000 provider operations; zero critical tenant isolation vulnerabilities.

## 3. Product scope and release priorities

| Code | Module | First meaningful release | V1 quality bar |
|---|---|---|---|
| CORE | Authentication, orgs/workspaces, roles, billing, files, activity/audit, notifications | Foundation | Secure tenant isolation, real persistence, exports, accessible responsive UX |
| CRM | **Twenty-inspired CRM**: contacts, companies, deals, pipelines, tasks, custom objects/fields, saved views, activity timeline, workflows | Core identity in Foundation; full CRM in iterative slices | Unified contact identity across newsletters, social, products and ministry; isolated tenant data; independently built UI |
| SHOP | Digital products, bundles, storefront, checkout, coupons, taxes, orders, customer portal | Final major phase (thin entitlement schemas earlier) | Tested end-to-end purchase, refunds/failed payments, accurate entitlements |
| LEARN | Courses, lessons, enrollments, progress, gated delivery | Creator MVP+ | Access follows entitlements; upload/media delivery and progress persisted |
| COMM | Free/paid communities, channels, feeds, posts, comments, roles, membership | After ministry expansion | Invitations, access rules, moderation, notifications and chat persist |
| EMAIL | Lists, signup forms, broadcasts, editor, sequences, segments, analytics | After ministry expansion (simple consent collection early) | Consent/unsubscribe, provider callbacks, retries and suppression enforced |
| CHAT | AI Chat, multi-conversation history, streaming, attachments, workspace knowledge | After ministry expansion (AI gateway may be scaffolded earlier) | Resumable chat, tool safety, tenant-safe retrieval, quotas, usage telemetry |
| AGENT | Custom AI builders, persona, knowledge sources, allowed actions | First release after foundation | Scoped tools, approval gates, audit trail, cost and access limits |
| SOCIAL | Account linking, composer, queues, calendar, publish, analytics and failure recovery; **Link in Bio integrated as a Social Studio tab** | First functional release after foundation | Real provider publishing, token expiry handling, job idempotency, preview and approval; live bio page and tracked clicks |
| FORMS | Public/embedded forms, applications, quizzes, submissions, spam control | Creator MVP | Entries create/associate contacts; secure public form publishing |
| AUTO | Triggers/actions for checkout, email, community, content, CRM, scheduling | Beta | Idempotent job execution, retries, audit logs and error visibility |
| CHURCH | Church/campus directory, public maps, service times, ownership | Third release phase, ahead of full CHAT/EMAIL/COMM | Consent-aware location controls and maps |
| OUTREACH | Campaigns, volunteer signup, follow-up, outreach dashboards | Ministry expansion | Form→CRM→assignment workflow works end to end |
| EVENTS | Events, recurring sessions, registration, QR check-in, attendance | Ministry expansion | Mobile check-in, offline degradation/recovery and permissions |
| GIVING | Donation pages, campaigns, pledges and donor records | Ministry expansion | Ledger-appropriate reconciliations, receipts and access controls |
| BIBLE | Scripture references, devotional publishing and discipleship resources | Ministry expansion | Licensed/public-domain text policy, safe permissions |

**Scope precision:** Eden’s public Help Center enumerates store/selling, email, communities, scheduling, Eden AI, custom AI, teams and API/webhooks. This document scopes to the founder's selected modules and includes necessary enablers, not an assertion that all Eden features have been manually explored in a paid account.

## 4. Product-level functional requirements

### 4.1 Creator profile, products, commerce and courses — P0/P1

- Public creator page builder with reusable, reorderable blocks: headline, links, product, bundle, text, video, signup, testimonial, booking link, forms and sections.
- Product types: downloadable files, courses, memberships and bundles in first waves; coaching packages, call booking, affiliate programs, order bumps and advanced pricing in later waves.
- Product editor: metadata, images, draft/published states, price/currency, inventory or enrollment constraints, SEO, access policy, discounts.
- Checkout: payment provider hosted or embedded checkout, webhook signature verification, idempotent order state machine, refunds, failed payments, tax/accounting integration boundaries, customer invoices/receipts where supported.
- Entitlement engine: granular access by buyer and product version; purchased courses/community access granted exactly once; revocations and subscription expiry enforced.
- Courses: sections, lessons, video/files, drip optional later, enrollment, learner progress, previews and course analytics.
- Acceptance: test buyer can pay; entitlement is granted only after verified payment event; a refund/reversal updates access according to configured policy; cross-tenant items cannot be purchased/administered by unauthorized users.

### 4.2 Communities — P0/P1

- Workspace can create multiple free/paid communities with distinct branding, visibility, membership rules, roles and access tiers.
- Channel/chat with threads, replies, attachments, mentions, unread counters and notification preferences; library/forum posts with pinned resources and moderation.
- Community event calendar, announcements, member profiles, invites and welcome onboarding. Public/community roles separated from staff roles.
- Real-time messaging, abuse/reporting tools, attachment policy and rate limits.
- Acceptance: membership purchase/invite gates every read/write server-side; removed members lose access; moderators can resolve reports; message history persists and pagination works.

### 4.3 Newsletter and email — P0/P1

- Lists/audiences, double opt-in where required, consent ledger, imports with provenance, segments, sign-up pages/embeds, template/block editor, test sends, broadcasts and scheduled campaigns.
- Sequences: welcome, product onboarding, course drip and membership lifecycle triggered from domain events; suppression, unsubscribe and bounce handling.
- Analytics include provider-delivered/open/click data labeled appropriately, without overstating accuracy.
- Acceptance: unsubscribed recipients are excluded even after imports; tenant cannot export another tenant's audience; failures/retries surfaced visibly.

### 4.4 AI Chat — P0/P1

- ChatGPT-style threads: streaming, markdown, attachments, searchable history, conversation rename/delete, stop/regenerate, selected AI model where offered, quota/credits and cost visibility.
- Workspace knowledge: user-selected documents, courses, products and permitted community content; retrieval with cited sources and per-user access checks.
- Tools/actions: draft product, newsletter and social content; retrieve CRM/contact summaries only when authorized; propose rather than immediately send/publish. Explicit confirmation for external or financial side effects.
- Privacy: no automatic cross-tenant retrieval; prohibit secrets being exposed through prompts; log tool calls without recording unnecessary sensitive prompt content.
- Acceptance: a general member cannot query private workspace CRM; file ingestion status visible; failed model calls retry safely; model usage is tracked per tenant and plan.

### 4.5 Custom AI builders — P1/P2

- Assistant name, avatar, public/private scope, system instructions, allowed knowledge collections, model, allowed tool list, share/embed options and usage limits.
- Knowledge sync/reindex, source citation, permissioned user contexts, chat analytics and audit trails.
- Admin Copilot connects to domain services; read tools may be automatic with authorization, write/publish/message actions require per-action approval and auditable confirmation.
- Acceptance: tool registry rejects unauthorized tenant/resource access; assistant cannot bypass domain authorizations by prompt-injection or role spoofing.

### 4.6 Social Studio — social scheduling, publishing and Link in Bio (first functional release)

- Social account OAuth/linking, token storage, capabilities matrix by platform; unified composer with channel-specific media and text validation.
- Drafts, approvals, content calendar, publishing queue, schedule/timezone handling, retries, API rate limiting, results and error state, basic analytics and account disconnect/revocation.
- Use a dedicated Zernio provider adapter for account connection, post publishing, scheduling, analytics and supported inbox flows; verify coverage, provider cost and workspace account limits before committing. Do not port v1 preview-only success responses as real publication.
- **Link in Bio belongs inside Social Studio**, sharing its left navigation, creator identity, media assets, and analytics. Offer a drag-and-drop block editor (links, headings, social icons, images, featured posts, newsletter opt-in, community/course/product CTAs), live preview, publish/unpublish, mobile-first themes, domain/slug management, per-block visibility, UTM and click/view analytics. Bind product and membership blocks to the internal entities when those modules ship; avoid inventing purchasable objects early.
- **Postiz reference strategy:** use its open-source scheduler screens to study route architecture, composition patterns and interaction states. Postiz uses AGPL-3.0; direct source/component reuse or a fork can trigger significant network-use/source-availability obligations. For a proprietary Harvest, independently implement equivalent UI with shadcn blocks. Obtain legal review before importing Postiz code or distinctive assets. Postiz does not eliminate the need for a Neon-native Harvest data model, Zernio adapter, access controls or link-in-bio implementation.
- Acceptance: publish or queue a real supported test account post; schedule runs once across retries; provider errors are recoverable; tokens remain encrypted/server-side; client sees actual publication outcome.

### 4.7 CRM and forms — foundation / P1

- Contact with unified per-tenant identity and timeline of purchases, community memberships, form submissions, course enrollments, newsletter subscriptions and social-source leads when authorized.
- Pipeline stages, deals, tasks, assignees, activities, tags, custom fields, saved views and CSV export with policy checks.
- Public forms/quizzes/applications with conditional field visibility, published version and consent purpose; embed/code or shareable links, abuse protection.
- Acceptance: an existing email/phone match resolves within same tenant without merging two unrelated people automatically; duplicate webhooks do not create duplicate contacts; every public endpoint is rate-limited and verified.

### 4.8 Shared automations, team workspaces and billing — P1/P2

- Event-driven workflows: product.purchase→grant access→CRM activity→opt-in email; member.join→welcome; form.submit→contact; scheduled.post→provider publish; assistant.request→draft→human approve.
- Durable job status, dedupe keys, retries, dead-letter queues and replay without duplicate charges/sends.
- Billing plans/seats/limits: feature flags, usage meters, credit consumption, fair-use protections and cancellations; team invites and role matrix.
- Acceptance: all chargeable/provider operations are idempotent; plan downgrades prevent new over-quota creation while retaining lawful access to prior data.

## 5. Ministry expansion — AFTER creator platform beta

Deliver in prioritized vertical slices using the shared CRM, event, membership, forms and commerce primitives:

1. Church/campus records, directories, coordinates, verification/claiming, map display, service times, pastoral contact and public/private location controls.
2. Outreach campaign organizer, teams, volunteer roles, forms, signups, locations, rosters and scoped collaboration across organizations.
3. Events, session registration, attendance, ticketing and QR check-in; consented contact and volunteer follow-up workflows.
4. Follow-up pipelines, pastoral care permissions, prayer requests and sensitive-data retention controls. Do not turn religious engagement into coercive scoring.
5. Donations, fundraising, churches/networks, discipleship journeys and Bible/publishing capabilities, subject to financial/privacy/legal review.

## 5A. Confirmed implementation stack: Social Studio and CRM

### 5A.1 Social Studio (locked founder decision)

- **UI system:** shadcn/ui, Tailwind, source-owned reusable dashboard shell and components.
- **Screens and workflow inspiration:** Postiz (post composer, channel selection, content calendar, scheduling queue, previews, status, media, analytics), but **not a copy-paste source dependency**. Re-create appropriate flows with independently written Harvest components and original branding.
- **Integration:** Zernio API through a server-side provider adapter for accounts, post publishing/scheduling, statuses, analytics, inbox and other specifically verified supported endpoints. Never assume feature availability without provider checks. Zernio access tokens are stored encrypted server-side; never in client bundles.
- **Link in Bio:** a first-class Social Studio submodule, shared media library and analytics; editor supports ordered blocks, links, creator profile, newsletter/form CTAs, and product/community references that become actionable once those modules are enabled. Publish to a public tenant-scoped route; support vanity/custom domains as a separately tested enhancement.
- **Minimal UI routes:** `/social/calendar`, `/social/compose`, `/social/posts`, `/social/accounts`, `/social/analytics`, `/social/inbox` (only after endpoint validation), `/social/link-in-bio`, `/social/settings`.
- **Quality gates:** connected platform OAuth lifecycle, scheduled delivery in correct timezone, idempotent publish requests, transparent failure state, retry safety, authorization, preview fidelity, and live link-page clicks/analytics.

### 5A.2 Twenty-inspired CRM: intended parity and differentiation

**Reference:** https://github.com/twentyhq/twenty (Twenty CRM), and official documentation. Reproduce useful **feature patterns and UX capabilities**, not Twenty's code, protected brand, or vendor-specific assets. Twenty is based on React/TypeScript, NestJS, PostgreSQL, Redis and an Nx monorepo. Harvest remains Next.js/Neon/Drizzle and does **not** adopt Twenty's runtime or entire repository. A separate Twenty server connected by REST/GraphQL is a possible alternative, but is *not* the default architecture because it adds a second tenancy/identity boundary and CRM data synchronization complexity.

**Core CRM objects (P0):** `contacts`, `contact_identifiers`, `companies`, `company_contact_links`, `opportunities`, `pipelines`, `pipeline_stages`, `tasks`, `notes`, `activities`, `tags`, `contact_tags`, `saved_views`, `custom_field_definitions`, `custom_field_values` (or validated JSONB with indexed projection), `imports`, `dedupe_matches`, `contact_consents`. All rows require tenant/workspace boundaries where applicable. The CRM should be the *one* identity source for subscribers, customers, attendees, members and social leads.

**UX requirements:**

1. Contacts and companies: table/list, filter, sort, search, group, bulk edit, import/export, inline-edit cells, detail drawer/page, relationship links, custom field panels.
2. Opportunities: multiple pipelines; stage columns and list/table modes; drag-and-drop with optimistic state reconciliation; weighted values, expected close dates, owners; conversion and loss reasons.
3. Saved views: user-owned and workspace-shared views; configurable columns, filters, ordering, grouping, Kanban/list presentations; role-based access to sensitive fields.
4. Activity timeline: deduplicated, chronological events from social leads, form submissions, emails, purchases, community joins, church events, outreach and tasks; enforce source-level permissions.
5. Tasks: assignments, reminders, due dates, status, priority, contact/company/deal relationships, activity logging and notifications.
6. Custom metadata: configurable contact/company/deal fields, field types and validation; schema migrations not required for every user-created field.
7. Data operations: CSV import mapping and preview, conflict/deduplication strategies, bulk actions, GDPR-aware data export/deletion, audit history and controlled archival.
8. Extensions (P1/P2): custom objects, email/calendar synchronization, workflow builder, lead scoring, API/webhooks, reporting dashboards, and AI-assisted CRM queries/actions with explicit authorization and confirmation.

**Suggested routes:** `/crm/contacts`, `/crm/contacts/[id]`, `/crm/companies`, `/crm/companies/[id]`, `/crm/opportunities`, `/crm/pipelines/[id]`, `/crm/tasks`, `/crm/views`, `/crm/imports`, `/crm/settings/fields`, `/crm/settings/pipelines`, `/crm/automations` (when automation engine exists).

**Functional acceptance tests:** Create a contact → associate company → create opportunity → progress stage → schedule task → display timeline; import CSV and deduplicate by verified tenant-scoped identifiers; changing a saved view affects only intended viewers; a public signup creates/updates one contact and stores consent provenance; social leads and later commerce events attach to that contact without exposing another tenant's records; standard member cannot see restricted fields.

**Phasing within your locked 1 → 4 → 5 → 3 → 2 order:**

- **Foundation (old Phase 1):** contacts, company basics, membership/consent, reliable tenant-scoped data models, list/detail screens, primitive activity log; do not mislabel this as full Twenty parity.
- **Social/creator phase (old Phase 4):** pipeline/deals/tasks, saved views, imported leads, Zernio social lead linkage, CRM timeline, social-to-contact workflow.
- **Ministry phase (old Phase 5):** outreach, church affiliation, volunteer/event signals and sensitive follow-up permissions as CRM extensions, not a duplicate CRM.
- **Communities/email/chat phase (old Phase 3):** enrich the timeline with opt-in email activity and community engagement, and provide permissioned AI CRM tools.
- **Commerce phase (old Phase 2):** purchases, subscriptions, customer lifetime history, entitlements and payment outcomes in unified contact records.

### 5A.3 Code reuse and licenses (implementation gate)

- **Twenty main application:** predominantly **AGPL-3.0**, with some enterprise-only files under a commercial license. Importing its main React application/source into a proprietary network SaaS is not the chosen approach; a license review is required before any direct reuse.
- **Twenty `twenty-ui` and named SDK/application-tooling packages:** currently **MIT-licensed**, according to the upstream repository's LICENSE. Specific files, dependency chains, distributions, version and notices must still be reviewed and recorded; MIT licensing of one package does **not** convert the broader Twenty repository to MIT.
- **Postiz:** public source under **AGPL-3.0**. Treat as UI/UX reference. If an actual Postiz source component is proposed, pause for legal analysis rather than introducing it silently.
- **Harvest:** retain original brand assets and original app code for similar workflows; reuse only appropriately licensed components and preserve notices where required.
- Record all third-party code, UI blocks, versions, licenses and attribution in `docs/ui-sources.md` and `docs/third-party-licenses.md`. License review is a release gate, not a post-launch task.

### 5A.4 CRM implementation PR batches (add to existing roadmap)

- CRM-01: Contact/company schema, unique keys, scope constraints, RLS policies, audit events and seed data.
- CRM-02: Contacts/companies shadcn data tables, profile pages, inline editing, search and paging.
- CRM-03: Custom fields, saved views, reusable filtering and data grid.
- CRM-04: Pipeline stages and deals with a validated Kanban and list view.
- CRM-05: Tasks, ownership, notifications and unified activity timeline.
- CRM-06: CSV import/export, mapping, deduplication and rollback/error reporting.
- CRM-07: Zernio/form/contact association events with privacy/consent controls.
- CRM-08: Workflow triggers, API/webhooks, AI-readable tools with approval gates; incremental based on phase readiness.

These CRM batches are additional scoped PR packages; they can be split or consolidated after the first working vertical slice. **Do not interpret the prior 64-PR sketch as exhaustive**.

## 6. Neon-first technical architecture

| Layer | Chosen direction | Notes |
|---|---|---|
| Application | Next.js + React + TypeScript | App Router, server actions/routes where appropriate; strict server authorization |
| Database | Neon PostgreSQL | Separate dev/staging/prod; pooled connections; migrations in CI |
| ORM | Drizzle | SQL-visible schema, transactional boundaries, typed queries |
| Auth | Evaluate Neon Auth/Better Auth against production needs | Select one and test OAuth, MFA, sessions and member auth; do not confuse Neon database with full app backend |
| Authorization | DB RLS + centralized permission checks | tenant/workspace derived from server-verified membership; tests of direct query context |
| Files | S3-compatible object storage | signed uploads/downloads, processing jobs, malware checks for exposed uploads |
| Jobs | Durable workflow/queue service | retries, locks/idempotency, timezones, scheduled jobs, webhook handlers |
| Search | Postgres full text + pgvector where useful | isolated document embeddings; citation-aware retrieval |
| AI | Provider-neutral LLM gateway + tools registry | model routing, quota, consent and action approval |
| Payments | Stripe or viable region-specific PSP | webhook-led entitlements, accounting boundaries |
| Email | Transactional + marketing provider adapters | unsubscribe/suppression and event callbacks |
| Social | Provider adapter; Zernio (founder-selected) | validate API coverage, monthly cost and limitations before commitment |
| Observability | Structured logging, metrics, tracing, error tracking | privacy redaction; per-job diagnostics |

**Relational core:** users, workspaces, workspace_members, roles, contacts, contact_identifiers, contact_consents, activities, products, prices, orders, order_items, entitlements, subscriptions, courses, lessons, enrollments, communities, community_members, channels, messages, forms, submissions, audiences, campaigns, sends, social_accounts, social_posts, social_jobs, chat_threads, chat_messages, ai_assistants, knowledge_sources, automation_definitions, automation_runs, webhook_events, files and audit_logs. Introduce ministry tables only when that phase arrives.

**Multi-tenant security:** Add tenant_id to tenant-owned rows; server derives effective tenant; database policies and unique constraints include tenant scope; verify pooled-connection RLS context resets; service accounts use narrow privileges; public tenant/creator pages do not permit arbitrary private-resource reads.

**Operational non-negotiables:** encrypted secrets, signed webhooks, job idempotency, email consent, financial reconciliation, accessible mobile UI, backups and restore drills, data export/deletion, incident procedures and secure defaults for sensitive ministry content.

## 7. Design system and template-first strategy

### 7.1 Official recommendation

**Locked choice: shadcn/ui + Tailwind + one curated, license-checked collection of shadcn-compatible application blocks**, with TanStack Table for grids, a tested rich-text editor for content, and specialized libraries only where needed (calendar, charts, drag/drop, charts, real-time messaging). Choose and customize **one** dashboard shell and unify all modules under it. Copy components into the codebase only after reviewing maintainability, dependency health, accessibility and license.

**Alternative evaluated, not selected:** Meta Astryx is a legitimate option, not an inferior one. Its current React/StyleX beta includes 150+ accessible components, CLI/MCP agent tooling, themes and official templates including AI Chat, analytics, tables, forms, checkout and dashboards. Do not reopen the library choice unless a concrete blocking issue appears; the founder selected shadcn/ui for consistent source-owned primitives. Astryx's smaller external block ecosystem and beta maturity increase integration uncertainty; shadcn gives broad copyable source and community availability. Avoid running two design systems in parallel.

### 7.2 Blocks-first rules

- Social Studio should start from a shadcn-compatible, license-reviewed dashboard shell and calendar/composer blocks, with **Postiz as a UX and workflow reference**, with Harvest-owned React implementations and no copied AGPL app code by default. Reuse generic components only under compatible licenses.
- Build Link in Bio as a sub-navigation within Social Studio (`/social/link-in-bio`), not as an unrelated commerce or website-builder module. The published pages may be served from dedicated public routes/custom domains.

- Start with a dashboard shell, auth pages, settings, CRUD grids, sidebar, detail drawer, editor, forms, checkout, AI chat frame and calendar before writing custom equivalents.
- Registry/block provenance tracked in `/docs/ui-sources.md`: URL, license, version, dependencies, changed files, owner and date.
- Each reused block must pass keyboard accessibility, screen-reader semantics, responsiveness, performance and consistency audits.
- Replace all demo data and inert actions with typed domain services immediately. Treat visual shells as **not implemented** until persisted and tested.
- Maintain reusable primitives as code-owned components: `DataTable`, `EntityEditor`, `ConfirmAction`, `ActivityTimeline`, `FilePicker`, `RichTextEditor`, `MemberPicker`, `WorkflowStatus`, `EmptyState` and `ErrorState`.
- Allow Eden-inspired **information architecture and workflows**, not wholesale reproduction of source code, logos, protected assets or unique branding.

### 7.3 Where blocks save time—and where they do not

Visual shell, component consistency and CRUD/admin screens can be substantially faster with blocks; the degree varies with fit and customization. Blocks do **not** solve multi-tenancy, authorization, payment/entitlement logic, provider APIs, job durability, customer consent or data correctness. Budget architecture/integration/testing separately rather than applying a blanket 'AI makes all coding 10x faster' multiplier.

## 8. Founder-directed release order: 1 → 4 → 5 → 3 → 2

**Important:** These numbers refer to the five phases shown in PRD v2.2, *not* the numerical ordering of the feature matrix. The priority is deliberately **Foundation → broad creator/social beta → ministry → community/newsletter/chat → mature commerce**. Feature scaffolding may precede its full product release where later phases depend on it.

**Assumptions:** a technically capable solo full-time developer (35–40 focused hours/week) assisted by AI coding agents, managed Neon/Zernio integrations and licensed/compatible UI blocks. Estimates are directional; official social API access, payments, support and testing can extend them.

| New order | Old phase | Target | Core deliverables | Estimated elapsed from start |
|---|---|---|---|---|
| 1 | 1 | Foundation | Neon schema, auth, workspaces, RBAC/RLS, CRM identity/consent spine, UI system, environments, tests | Weeks 1–4 |
| 2 | 4 | Broad creator beta **first** | **Social Studio**: Zernio integration, social accounts, composer, publishing calendar, approvals, scheduling, analytics, **Link in Bio**; custom AI assistants, automation basics, membership/course prerequisites | Months 2–5 |
| 3 | 5 | Ministry expansion | Church directory and maps, outreach forms, registration, volunteers, events, QR check-in, CRM follow-up; giving as an optional later ministry slice | Months 5–9 |
| 4 | 3 | Eden-inspired platform completion | Communities, full newsletter suite, fully featured AI Chat, knowledge, forms and cross-module workflows; connect earlier custom agents | Months 9–13 |
| 5 | 2 | Commerce depth **last** | Products, creator storefront, checkout, subscriptions, orders, entitlements, bundles, courses monetization, affiliate/refund workflows | Months 13–17 |
| — | — | Reliability and advanced maturity | Security, performance, analytics, operations, provider expansions and complex automation | Months 17–24+ |

**Cross-phase dependency exceptions:** (a) Phase 1 includes CRM/contact identity, consent and domain data skeletons; (b) Phase 2 can support a simple bio-page product CTA without live checkout, and basic course/membership entities without monetization; (c) Phase 3 forms and registration do not depend on the later newsletter marketing suite; (d) custom AI agents in Phase 2 use a minimal shared AI gateway, while a full multi-conversation AI Chat workspace arrives in Phase 4; (e) payments/entitlements must be fully built and tested before claiming paid communities or products work, even though mature commerce is Phase 5.

**Earlier timeline revision:** the previous 3–5 month commerce-led MVP no longer applies. The realistic first sellable offering is a **social scheduling + Link in Bio + AI assistant beta around month 4–5** if integrations go smoothly. A feature-rich all-modules product is **roughly 13–24+ months**, with the full described scope depending on weekly capacity and quality requirements. Reusing prebuilt blocks accelerates UI layout but not backend workflow reliability.

## 9. Phase-ordered PR roadmap (each PR separately tested)

| Group | Illustrative PR slices | Exit gate |
|---|---|---|
| Phase 1 / PR 01–08 | Repo/CI; Neon/Drizzle; auth; workspaces/RLS; UI system; files; contacts/consent; job/webhook primitives | Tenant-isolation E2E, production-like staging deploy and persistent data |
| Phase 2 / PR 09–22 | Zernio adapter; social connection; composer; media; calendar/queue; publishing statuses; analytics; approvals; **Link in Bio schema/editor/themes/publishing/analytics**; custom AI assistant creation/tools; basic automations/course models | Publish real test post and see success/failure; live bio page and analytics; safe AI tool permissions |
| Phase 3 / PR 23–34 | Church locations/maps; ministry profile; outreach campaign; dynamic registration forms; volunteer roles/roster; event schedule; QR generation/check-in; CRM follow-up; reporting; mobile/offline recovery | Outreach signup → check-in → permissioned follow-up completes end to end |
| Phase 4 / PR 35–48 | Community spaces/members/posts/moderation; newsletter composer/audiences/sends; streaming AI Chat/history/attachments; knowledge retrieval; email consent; cross-module flows | Community, newsletter and AI Chat E2E tests pass against real providers |
| Phase 5 / PR 49–64 | Product catalog; creator pages; checkout; payment webhooks; orders; entitlements; paid access; refunds; subscriptions; bundles; advanced courses | Full purchase → delivery → refund/renewal paths pass and reconcile |
| Additional | Compliance, advanced automations, integrations, hardening, accessibility and analytics | No outstanding P0 reliability/security issues |

PR numbers indicate **illustrative work packages**, not a guarantee of 64 PRs. Mature quality can require significantly more and should never be traded for satisfying a numerical target.

## 10. Engineering and product definition of done

1. Feature has a public/admin workflow spec with success, error, empty and unauthorized states.
2. Database persistence with properly indexed tenant-qualified relations; no fake data in production workflow.
3. Unit/integration tests for domain invariants; Playwright tests for critical flows; provider sandbox/smoke tests where available.
4. UI is responsive, accessible and consistent with Harvest's selected design system and original brand.
5. Events, costs and errors are measurable; long-running operations show transparent status and can be retried safely.
6. Money, subscriber consent, private ministry data and AI tool writes go through explicit audited services and permission gates.
7. Release tested in staging with seed tenants and separate permissions; verified with a human using the product.
8. Product owner signs off on *actual task completion*, not screenshots or test counts.

## 11. Practical solo-developer operating system

- Keep one product backlog grouped by vertical customer journey, each linked to a PRD requirement and acceptance test.
- One **architecture/spec agent**, one **implementation agent** per branch and one **independent review/test agent**; avoid a dozen agents touching the same files.
- Build a complete small slice, deploy to staging, exercise it in the browser, fix usability, then begin the next slice.
- Keep source-of-truth contracts in `/docs/architecture`, `/docs/decisions`, `/docs/api`, `/docs/ui-sources` and `/docs/acceptance`.
- Weekly real-user check: invite a creator/church staff tester to attempt end-to-end tasks without coaching; prioritize friction observed rather than generating new pages.
- Measure velocity after the first 4 weeks and **reforecast** the timeline using completed testable slices, not model output speed.

## 12. Risks, decisions and explicit next steps

| Risk | Mitigation |
|---|---|
| Prebuilt blocks create inconsistent UI | shadcn/ui as the sole foundational component system; one dashboard shell; design-token and component audit |
| Fast AI-generated code replicates v1 dead-end features | No mocks counted as done; require production-like workflow tests |
| Payments, email and social providers delay release | Provider adapter contracts and sandbox test access in first 2–3 weeks |
| Tool calling leaks contact/private ministry information | Scoped tools, per-resource policy checks, consent, mandatory approval on writes |
| Recurring costs per workspace become excessive | Usage metering, quotas, provider pricing benchmark before integration |
| The word “everything” creates an unbounded scope | First ship creator MVP; separately gate advanced Eden parity and ministry |
| Dual UI frameworks slow maintenance | Founder selected shadcn/ui; avoid parallel design-system foundations |
| No clients means no product validation | Start interviewing testers within first month; run paid pilot trials early |

**Decisions to lock in week 1–2:** (a) shadcn/ui already selected; (b) auth implementation; (c) payment and mail provider; (d) social integration capabilities/cost; (e) whether early communities use realtime managed service; (f) pricing/plan packaging; (g) optional native mobile versus responsive web app (recommended web first).

**Immediate next action:** Archive v1; scaffold Harvest v2 and Neon staging with the locked shadcn/ui stack; implement the core Twenty-inspired contact/company screen, then the first Social Studio journey with Zernio and a live Link in Bio page; then follow the founder-defined order: ministry → communities/newsletters/AI Chat → full commerce.

## 13. Sources and evidence notes

- Harvest archive uploaded by founder, referenced in v2.1: static code audit; no production runtime verification.
- Eden Help Center: https://eden.so/help/ (creator store, email, communities, scheduling, AI, custom AI, integrations; current publicly documented categories).
- Eden creator page blocks: https://eden.so/help/store/your-creator-page/
- Eden communities: https://eden.so/features/communities/
- Postiz source and AGPL-3.0 license: https://github.com/gitroomhq/postiz-app
- Zernio API docs: https://docs.zernio.com/
- shadcn official blocks: https://ui.shadcn.com/blocks
- Astryx official: https://astryx.atmeta.com/ and https://astryx.atmeta.com/templates ; https://github.com/meta/astryx
- This is a revised proposed PRD, not a license to reproduce Eden's proprietary materials or a claim to have inspected its private backend. Actual scope and timelines require feedback from target users and implementation progress.

## 14. Additional source and decision record (v2.4)

- Twenty core repository and architecture: https://github.com/twentyhq/twenty
- Twenty upstream mixed-license declaration (AGPL, MIT subpackages, enterprise): https://github.com/twentyhq/twenty/blob/main/LICENSE
- Postiz upstream AGPL license: https://github.com/gitroomhq/postiz-app
- Founder selections: shadcn/ui primary component library; Postiz UX reference; Zernio API social backend; Twenty CRM UX/functionality reference; Link in Bio inside Social Studio; creator/social-first order maintained.
- Timeline note: adding a deeper Twenty-inspired CRM adds implementation effort unless features are staged. The earlier Month 2–5 social beta remains an aspiration only if CRM P0 stays bounded; full Twenty-level CRM parity should not be assumed within the Foundation month.
