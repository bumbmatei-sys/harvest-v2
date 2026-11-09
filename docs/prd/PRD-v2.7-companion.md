> **Founder decisions that override this document (Matei, 4 Nov 2026):**

> **Latest founder decision (2026-11-09; overrides the 4 Nov Dodo selection for Professional V1):** **Stripe-first**, conditional on Stripe approval for Harvest's third-party creator-commerce and fundraising platform and eligible recipient countries; separate donations, purchases and platform billing. Do not assume Stripe supports third-party donation aggregation. Individual missionaries/influencers, Skool-style Communities + Discovery, Harvest-created product storefronts and reusable Eden-style wizards are V1. Zernio social priorities Facebook/Instagram/Threads/TikTok/YouTube; all eligible Auto-DMs; Blogs API WordPress/Shopify/Wix/Webflow. See [`professional-v1-launch-scope.md`](professional-v1-launch-scope.md) and [`../plans/professional-v1-first-eight-prs.md`](../plans/professional-v1-first-eight-prs.md). Historical Dodo decision remains below for provenance but is superseded for V1.

> **Professional V1 release classification (2026-11-09):** `docs/prd/professional-v1-launch-scope.md` is the founder-approved authority for initial paid launch scope and feature freeze. This PRD retains its detailed long-term requirements; any earlier P0/P1 labels, creator-first sequencing or broad modules conflicting with the six-system contract are **Post-launch / Future Vision** until explicitly approved. No features are deleted. Preserve consent, security and activation gates.

> - Auth is decided: Better Auth with email one-time code only via Resend (no Google sign-in, no passwords). Section 32 item 1 is closed.
> - Object storage is Cloudflare R2 (separate v2 bucket). Payments are Dodo, not Stripe.
> - UI uses shadcn components only; never hand-build anything shadcn provides.
> - Contact erasure anonymizes personal data and keeps anonymous consent records.
> - Follow-up decisions (Matei, 4 Nov 2026): erasure also removes contact/consent links and correlating metadata from the contact’s audit history; the retained erasure event has no contact ID. An unsubscribe remains effective unless superseded by a grant both recorded and occurred strictly after it. A backdated grant never overrides a withdrawal.
> - No per-tenant subdomains; subdomains only for the public website and Link in Bio. User-created courses and products are public across Harvest (PRD-v2.5 section 9.1). "No Discover" here means the trending-content research tool, not the course and product Discover page.
> - Virus/malware scanning of uploads: medium-high priority, **DEFERRED until beta/production launch** (Matei, 2026-11-04). No paid scanner during development. It is a launch gate; see section 11, requirement 11.-04a.
- Hosting (Matei, 2026-11-04): v2 runs on Vercel through beta. Avoid Vercel-only APIs (standard Next.js, no Edge Config/KV/Blob, storage via the S3 adapter) so a later move to Cloudflare Workers via OpenNext stays cheap. Revisit at beta using real hosting bills.
- AI assistant (Matei, 2026-11-04): provider-agnostic architecture built on the Vercel AI SDK, initial model Xiaomi MiMo-V2.6-Flash (pending capability check), switchable by config. Binding spec: [AI-assistant-architecture.md](AI-assistant-architecture.md). It overrides any AI section here that conflicts.

# HARVEST V2.7 — COMPANION IMPLEMENTATION PRD
## Detailed functional specification for the v2.5 master PRD

**Date:** 4 November 2026  
**Status:** Engineering proposal; revised to explicitly include Zernio Unified Inbox and Auto-DMs; specifications require product acceptance before production.  
**Companion to:** `Harvest_v2_Social_Twenty_CRM_PRD_v2.5` (master strategy). This document **extends**, rather than replaces, the prior PRD.  
**Founder decisions:** 0 clients; greenfield Neon PostgreSQL; shadcn/ui design system; independently built Postiz-inspired Social Studio with Zernio; Twenty-inspired CRM; Eden-style creator workflows; no Discover/competitive-research module, no browser extension, no ERP.  
**Release order remains:** **1 → 4 → 5 → 3 → 2**, translated into F0 Foundation → F1 Social Studio/AI agents → F2 Ministry → F3 Communities/newsletters/AI Chat/forms → F4 Commerce. Foundational data primitives may precede user-facing modules.  

## 0. How to use this PRD

- The master PRD defines *why*, sequencing, strategic scope and architectural choices. This companion defines *what a developer must implement*: routes, workflows, data, APIs, failure states, acceptance tests and PR batches.
- Each numbered requirement is **proposed** until confirmed by implementation review; don't confuse Eden, Twenty or Postiz inspiration with verified identical features.
- Source v1 repository can inform behavior but is **not** the codebase to extend. Do not copy AGPL application code into Harvest without a reviewed license strategy.
- Prototypes are not production: every provider-backed feature must be tested with provider sandbox/test accounts and realistic error conditions.
- The founder's zero-client status eliminates customer migration obligations, **not** security, financial, consent or founder-owned record preservation requirements.

## 1. Product architecture, delivery policy and global nonfunctional requirements

### Architecture boundaries
- **Web:** Next.js App Router, TypeScript, Tailwind, shadcn/ui (and approved prebuilt blocks), React Hook Form + schema validation, accessible light/dark theming.
- **Data:** Neon PostgreSQL, typed migrations/ORM, immutable migration history, primary-key UUIDs, organization/workspace foreign keys, tenant-safe indexes. Object bytes stay in object storage, not Neon.
- **Auth:** Established auth provider/Neon Auth after a feasibility spike; separate user, memberships and workspace roles; session rotation and MFA-ready account settings.
- **Services:** Vertical-slice modules under a monorepo with explicit service boundaries: identity, contacts, social, email, calendar, files, communities, courses, giving, commerce, automation, AI and ministry.
- **Integration:** Zernio behind a Harvest provider adapter. Keep internal IDs; store only provider account IDs and connection metadata, never expose Zernio API credentials to client JavaScript.
- **Workers:** Durable queue, idempotency keys, scheduled jobs, retry/backoff, dead-letter and replay. Webhook signature verification, raw-event audit, deduplication and out-of-order handling.
- **Security:** Workspace boundary must be verified at request and query layers; enable database RLS where suitable and test it with two independent tenants. Separate member-facing and admin permissions; prevent cross-workspace retrieval in AI.
- **Observability:** Structured traces, release-tagged logs, performance metrics, alerting, immutable audit events for sensitive actions, admin troubleshooting without unnecessary access to private content.
- **Privacy:** Consent and suppression are first-class. Sensitive faith/ministry records must never be exposed publicly or to cross-tenant AI. Include export, retention, deletion, and data-subject workflows.

### Global entities / constraints
`users`, `workspaces`, `workspace_members`, `roles`, `role_grants`, `workspace_settings`, `integrations`, `provider_accounts`, `audit_events`, `files`, `notifications`, `jobs`, `outbox_events`, `external_webhook_events`, `usage_counters`, `subscriptions`, `feature_entitlements`.

Standard columns on tenant-owned records: `id`, `workspace_id`, `created_at`, `updated_at`, `created_by`, `deleted_at` (only when appropriate), `version` for optimistic concurrency. Use typed status enums and unique constraints scoped to workspace/provider. External service state is **eventually consistent**; an API 200 response is not proof a scheduled social post or email was delivered.

### Universal acceptance gates
- [ ] All write requests are authenticated/authorized server-side and validated; public forms use dedicated scoped capabilities.
- [ ] Database writes, provider calls and webhooks are idempotent where repeats are likely.
- [ ] Empty/loading/success/error/offline/reconnect states and keyboard/mobile behavior are tested.
- [ ] Every primary flow has a Playwright end-to-end test using a real Neon test database; provider contract tests use documented sandboxes.
- [ ] No cross-workspace reads or writes through UI, direct URL, API, search, background workers, media URLs or AI tools.
- [ ] Provider failures produce a visible actionable status and an operator replay path; no silent data loss.
- [ ] At least one external user completes the feature journey without developer assistance before release candidate approval.

## 2. Information architecture and navigation

**Global shell:** Workspace switcher; overview; Social Studio (Planner, Calendar, Unified Inbox, Auto-DMs, Analytics, Link in Bio); CRM (People, Companies, Pipelines, Tasks, Activities); AI (Chat, Assistants, Knowledge); Email (Inbox, Campaigns, Audiences, Automations); Calendar; Files; Community; Courses; Products; Ministry (Churches, Outreach, Events, Volunteers, Discipleship, Giving); Settings (People/Roles, Integrations, Billing, Domains, Security, Usage). Use permissions and release flags to hide *entire unfinished surfaces*, not a sea of disabled buttons.

**Cross-module primitives:** contact picker; file picker; AI prompt action; saved audience/segment; calendar event picker; entitlement selector; publish/approval status; audit/activity side panel; consistent searchable tables; notifications; validated command menu.

## 3. Zernio provider contract: verified capabilities and boundaries

Zernio's public pages as consulted 4 November 2026 document: Gmail + Outlook email read/send/reply/attachments and `message.received` webhooks; Google and Outlook calendars including events, RSVP, free/busy and meeting links; Google Drive + OneDrive file listing/upload/download/share; Google/Microsoft contacts; social publishing/analytics/unified inbox, Instagram/Facebook comment-to-DM automation and eligible inbound-message keyword automation. Provider documentation is the live source of truth for endpoint details, rate limits and authentication.

**IMPORTANT Google Drive scope:** Zernio's Google integration uses `drive.file`: Harvest sees **only files it created and files the user explicitly selected** via Google Picker; no claim of full Drive crawling. **Microsoft admin consent:** Some Microsoft 365 tenants require administrator approval; surface `admin_consent_required` and the provider-supplied URL. Calendar synchronization, storage and mailbox operations are subject to OAuth scope, plan, and rate policies. Avoid promising multi-account cross-provider write parity without contract tests.

Suggested adapter shape (pseudocode): `connect(provider, scopes)`, `listMessages`, `sendMessage`, `listCalendars`, `createEvent`, `getFreeBusy`, `listFiles`, `uploadFile`, `shareFile`, `syncContacts`, `listConversations`, `listConversationMessages`, `sendInboxReply`, `createCommentToDmAutomation`, `listCommentAutomations`, `pauseCommentAutomation`, `handleWebhook`. Define provider capability matrix and return typed `unsupported` errors rather than assuming equivalence.

**References:** https://my.zernio.com/google ; https://my.zernio.com/microsoft ; https://my.zernio.com/email-api ; https://my.zernio.com/calendar-api ; https://my.zernio.com/files-api ; https://docs.zernio.com/ ; https://my.zernio.com/comment-to-dm ; https://my.zernio.com/social-media-dms . Validate the current published docs again when coding.

## 4. CORE — identity, workspaces, security and administration
**Release:** F0 / Release 1  
**Goal:** A reliable, tenant-safe foundation with no legacy Firebase compatibility.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/(auth)/sign-in` — login and recovery
- `/onboarding` — workspace creation wizard
- `/app` — overview and next-actions dashboard
- `/settings/workspace` — profile, branding, locale
- `/settings/members` — invitations and role changes
- `/settings/integrations` — provider account connections
- `/settings/billing` — plan and usage
- `/settings/security` — MFA and active sessions
- `/settings/audit` — audit viewer

### Primary user journeys
1. New user creates a workspace, invites a member and grants a safe role.
2. Member switches between two workspaces without seeing another workspace data.
3. Admin connects Google or Microsoft with explicit scope and can revoke it.

### Functional requirements
- **4.-01** Workspace owners can create/invite/archive; guests cannot administer permissions.
- **4.-02** Permissions are capability-based and evaluated on the server.
- **4.-03** Secrets remain server-side encrypted and rotated; connection status visible.
- **4.-04** Activity/audit records are append-only and filterable.
- **4.-05** Plans gate features without dropping existing customer data.

### Proposed Neon entities (illustrative, normalize during schema design)
- `users(email,identity_ref)`
- `workspaces(slug,timezone,plan)`
- `workspace_members(user_id,workspace_id,role)`
- `roles, role_grants`
- `integration_connections(provider,scopes,status)`
- `audit_events(actor,action,entity,ip,metadata)`
- `subscriptions, usage_counters`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/workspaces`
- `GET /api/workspaces/:id`
- `POST /api/workspaces/:id/invites`
- `PATCH /api/workspaces/:id/members/:memberId`
- `POST /api/integrations/:provider/connect`
- `POST /api/integrations/webhook/:provider`

### Edge cases, privacy and failure handling
- Expired invitation; duplicate member; owner leaving; revoked auth session.
- Two-tenant ID tampering; role escalation; provider connection expired.
- Rate limiting and brute-force account protection.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Two isolated workspaces cannot access each other by guessing IDs.
- [ ] Invitations expire, accept once, and create correct membership.
- [ ] Revoking a connection disables provider writes immediately.
- [ ] Every permission change appears in the audit log.

### Proposed implementation PR slices
- 1. Bootstrap Neon migrations, CI, lint and integration-test database
- 2. Auth/tenant resolver and database isolation tests
- 3. Workspace UI and team invitation flow
- 4. Provider connection management and audit log
- 5. App shell and design system primitives

## 5. CRM — Twenty-inspired customer and relationship management
**Release:** F0 foundation with iterative F1–F3 depth  
**Goal:** Use one authoritative contact identity across creator, ministry, and connected services.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/crm/people` — list/grid, saved views, imports
- `/crm/people/:id` — contact detail and activity history
- `/crm/companies` — organizations
- `/crm/companies/:id` — related people and deals
- `/crm/pipelines` — opportunities Kanban/table
- `/crm/deals/:id` — deal details and stages
- `/crm/tasks` — reminders and assignments
- `/crm/settings` — fields, stages, deduplication
- `/crm/segments` — dynamic contact audiences

### Primary user journeys
1. User imports contacts and merges duplicates with an explicit preview.
2. Sales user advances an opportunity and creates a follow-up task.
3. Newsletter subscriber, buyer and outreach participant resolve to one contact while retaining distinct consent histories.

### Functional requirements
- **5.-01** Twenty-inspired grid, bulk edits, saved filter views, relation fields, inline cells, detail pages and activity timeline.
- **5.-02** Configurable pipeline stages and probability, weighted value, stale deal indicators.
- **5.-03** Contacts may have several emails, aliases and external identifiers, normalized and workspace-scoped.
- **5.-04** Consent is purpose/provider/source-specific; unsubscribes always override segmentation.
- **5.-05** Custom fields typed (text, date, number, select, relation) and schema-validated.
- **5.-06** Activity creation events emitted via outbox to AI/context and automation consumers.

### Proposed Neon entities (illustrative, normalize during schema design)
- `contacts(name,emails,phones,consents,owner)`
- `contact_identifiers(source,external_id)`
- `companies, contact_company_links`
- `pipelines, pipeline_stages, opportunities`
- `tasks, notes, activities, timeline_events`
- `custom_field_definitions, custom_field_values`
- `saved_views, filters, tags, contact_tags`
- `contact_merge_log`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `GET/POST /api/crm/contacts`
- `PATCH /api/crm/contacts/:id`
- `POST /api/crm/contacts/merge`
- `POST /api/crm/imports`
- `GET/POST /api/crm/pipelines`
- `POST /api/crm/deals/:id/move`
- `GET /api/crm/contacts/:id/timeline`
- `POST /api/crm/tasks`

### Edge cases, privacy and failure handling
- Imports with duplicate emails, multiple people sharing an address, contact merges with child records.
- Filter injection, CSV formula injection, soft-deleted items, timezone changes.
- Respect sensitive ministry notes and access controls; do not infer religion from contact labels.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] 1000-row CSV import reports errors and matches deterministically.
- [ ] Kanban drag writes actual stage transitions once; reload preserves it.
- [ ] Removing marketing consent excludes contact from campaigns immediately.
- [ ] Contact timeline shows linked purchases, events and communication without exposing unrelated tenants.

### Proposed implementation PR slices
- 1. Contacts and company schema + permissions
- 2. Twenty-inspired tables and records built using shadcn
- 3. Pipelines, deals and assignment UX
- 4. Imports, custom fields, saved views and merge
- 5. Activity timeline and cross-module event subscribers

## 6. SOCIAL — Social Studio, publishing, analytics, inbox
**Release:** F1 / Release 2  
**Goal:** A cohesive Postiz-inspired publishing product backed by Zernio.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/social/accounts` — connect and health status
- `/social/planner` — list, queue and content stages
- `/social/calendar` — weekly/monthly scheduled posts
- `/social/compose` — media-rich platform-aware post editor
- `/social/posts/:id` — preview, status, failure and audit
- `/social/media` — shared asset library
- `/social/analytics` — channel/post performance
- `/social/inbox` — unified social DMs, comments and supported messaging channels, with email integration where authorized
- `/social/auto-dms` — keyword rules, eligible post/story triggers, templates, rule health and delivery logs
- `/social/auto-dms/:id` — rule editor, test conditions, exclusion keywords, delays, targeting and status
- `/social/approvals` — roles, requested changes, approvals
- `/social/settings` — posting hours, defaults, brand

### Primary user journeys
1. Connect channels through Zernio and verify capability matrix.
2. Create post, adapt captions per platform, upload assets, preview, submit for approval, schedule.
3. Zernio publish webhook updates actual status; failures produce retry and explanation.
4. Inbox aggregates supported inbound conversations, assigns owners, replies within platform windows, and links conversations to contacts only after verified association.
5. Set up comment-to-DM keyword rule for an eligible Instagram/Facebook account → preview message → enable rule → receive test comment → observe one compliant private reply → record outcome in Inbox/CRM.

### Functional requirements
- **6.-01** Original shadcn screens inspired by Postiz layout; do not import unreviewed AGPL code.
- **6.-02** Post previews enforce platform constraints and media types.
- **6.-03** Scheduled posts store intended timezone, UTC instant and provider references.
- **6.-04** Queue, draft, approval, scheduled, publishing, published and failed are distinct statuses.
- **6.-05** Disconnection disables future publishes and prompts reconnect.
- **6.-06** Analytics retain source timestamp and avoid invented figures.
- **SOC-INBOX-01** Unified Inbox offers workspace-scoped account/channel filters, thread lists, message views, read/unread, assignments, tags, attachments, conversation search and a contact-side panel where the provider supports each action.
- **SOC-INBOX-02** Sending honors provider-specific messaging windows, content restrictions, opt-outs, and human handoff. Disable unsupported replies rather than pretending to send.
- **SOC-INBOX-03** Incoming events are idempotent; ordered thread views reconcile delayed/out-of-order webhooks. Never merge unrelated people by display name alone.
- **SOC-ADM-01** Auto-DM rule manager supports Instagram/Facebook eligible comment keyword triggers, match modes (contains, word, exact), exclusions, and tested previews.
- **SOC-ADM-02** Where permitted by the Zernio account/platform, support Instagram Story replies and inbound DM keyword matching, optional public comment reply, and DM delays with safe provider limits.
- **SOC-ADM-03** Store rule enabled/paused state, scoped account/post target, template version, execution status, delivery error, deduplication identifier and consent/compliance metadata.
- **SOC-ADM-04** A rule is not claimed successful until the provider accepts execution; show actual delivery status where available. Replayed events cannot trigger duplicate automatic replies.
- **SOC-ADM-05** Explicitly disclose platform restrictions (e.g. Meta messaging windows and one-private-reply-per-comment restrictions), avoid unsolicited mass DMs, and support pauses and emergency disable.

### Proposed Neon entities (illustrative, normalize during schema design)
- `social_accounts(provider,provider_account_id,status)`
- `social_posts(body,status,author)`
- `social_post_targets(platform,account_id,scheduled_at)`
- `social_media_assets(file_id,metadata)`
- `social_publish_attempts(idempotency_key,provider_ref,status)`
- `social_inbox_threads, social_inbox_messages, social_inbox_assignments, social_inbox_events`
- `social_auto_dm_rules(workspace_id,account_id,trigger,conditions,template,status)`
- `social_auto_dm_executions(rule_id,provider_event_id,deduplication_key,outcome)`
- `social_metrics_snapshots`
- `social_approvals, content_labels`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/social/accounts/connect`
- `POST /api/social/posts`
- `POST /api/social/posts/:id/schedule`
- `POST /api/social/posts/:id/approve`
- `GET /api/social/calendar`
- `GET /api/social/analytics`
- `GET /api/social/inbox/conversations`
- `GET /api/social/inbox/conversations/:id/messages`
- `POST /api/social/inbox/conversations/:id/reply`
- `POST /api/social/inbox/conversations/:id/assign`
- `GET/POST /api/social/auto-dms`
- `PATCH /api/social/auto-dms/:id`
- `GET /api/social/auto-dms/:id/executions`
- `POST /api/webhooks/zernio`

### Edge cases, privacy and failure handling
- DST transition; provider disconnected; upload partially fails; duplicate webhook; draft concurrent edit.
- Provider rate limits and deleted accounts; message channel unsupported.
- Automation account loses permission; duplicate comment/reply webhooks; account disconnect mid-flow; exhausted messaging window; provider policy rejects template; contact identity collisions; human handoff while AI reply queued; repeated commenter; automation paused with pending execution.
- Publish events are retried carefully, never creating duplicate posts on uncertain outcomes.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] A scheduled test post publishes to supported connected sandbox/account and returns provider ref.
- [ ] Approval permissions prevent unauthorized publish.
- [ ] Failures appear in UI with provider reason and safe recovery.
- [ ] No double publishing on webhook replay.
- [ ] Two different tenant workspaces cannot see or reply to each other’s inbox threads; account ownership is checked server-side.
- [ ] A new supported DM appears once in the correct inbox, supports human reply where allowed, and syncs accurately after webhook replay.
- [ ] An Instagram/Facebook eligible comment keyword triggers the configured DM no more than once per rule/comment; excluded keywords do not trigger it.
- [ ] Auto-DM pause disables future sends; all blocked sends show actionable policy/error explanations.
- [ ] Inbound replies that identify a CRM contact require verified identifiers and approved permissions; no display-name-based auto-merge.

### Proposed implementation PR slices
- 1. Zernio connection/capability adapter
- 2. Post models, uploader and composer
- 3. Calendar and queue with scheduler and jobs
- 4. Approval pipeline and provider status reconciliation
- 5. Analytics, unified inbox, conversation ownership and provider policy restrictions
- 6. Auto-DM rule editor, Zernio comment-to-DM adapter, execution logs and webhook dedupe
- 6. Error handling, e2e publish and operator diagnostics

## 6A. Social Inbox + Auto-DMs — additional implementation specification

### Unified Inbox interaction model
1. The inbox shows an account/channel sidebar, searchable conversation list, thread view, customer context and a compact action panel for assignment, tags and status. Include accessible responsive/mobile views.
2. Filters: workspace, platform, connected account, unread, assigned-to-me, status, labels and date. Every filter is enforced server-side. Conversation deep links require workspace authorization.
3. Reply composer supports text and attachments only where the connected provider permits; expose per-channel capability indicators and explicit disabled reasons.
4. Add manual human takeover from AI/automation, assignment audit history, SLA/response indicators (without inventing provider delivery/read data), duplicate event suppression, and personal-data export/deletion policies.
5. Optional consolidated inbox can show Gmail/Outlook messages via Zernio but must visibly distinguish mailbox email from marketing newsletters and channel-specific DMs. Permission to view a social account does **not** imply permission to view an individual's Gmail/Outlook mailbox.

### Auto-DM rule builder and supported trigger types
1. Choose a connected eligible Instagram/Facebook account, rule name, eligible scope (post/reel/all supported posts) and condition. Support `contains`, `word`, `exact`, exclusions and provider-enabled typo tolerance; validate ambiguous substring matches in UI.
2. Configure private reply text, supported buttons/card format, optional public comment response, optional timing (bounded by official API limits), preview and safe test trigger.
3. Where supported, offer Instagram Story-reply keyword rules and inbound DM keyword matching (`alsoMatchInDms`). These are conditional capabilities and must be verified on connected account type and Zernio API version.
4. Dashboard shows rule owner, state, account, configured trigger, recent successes/failures, delivery status, matching count and created CRM contacts with source attribution. Distinguish accepted-to-send, sent and delivered/read when provider actually exposes each.
5. Rule execution should be driven by Zernio/provider webhooks with verified signatures, deduplication, idempotency and backoff. Provider limits take precedence over local automation desires.
6. Support pause/resume, permission revocation, disconnect behavior, audit trail, scoped edit permissions, manual inbox takeover and suppression lists.
7. Connect the flow to Link in Bio, lead-magnet downloads, CRM pipeline and newsletter consent collection—but **never assume a social DM constitutes email marketing consent**.

### Policy, security and provider validation
- Never promise unrestricted cold DMs, unsolicited broadcast messaging or access to private Instagram accounts. Meta policies, provider account type, approval state and messaging windows control availability.
- Verify exactly which message media, channel operations, auto-DM triggers, status callbacks and historical sync options Zernio exposes in staging. Display unsupported capability states rather than mock responses.
- Include provider outage/rate limit simulation; unauthorized workspace/account attempts; webhook replay; concurrent human/AI replies; duplicate contact identifiers; disconnect/reconnect; deletion/export tests.
- Public references: https://my.zernio.com/comment-to-dm ; https://my.zernio.com/social-media-dms ; https://my.zernio.com/instagram-mcp ; https://docs.zernio.com/changelog .

## 7. LINK IN BIO — first-class Social Studio submodule
**Release:** F1 / Release 2  
**Goal:** Live, branded, responsive landing pages connected to creators and CRM.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/social/link-in-bio` — pages and publication status
- `/social/link-in-bio/:id/edit` — block editor and live preview
- `/social/link-in-bio/:id/analytics` — visits and clicks
- `/u/:slug` — public hosted bio page
- `/social/link-in-bio/domains` — domain verification

### Primary user journeys
1. Create a page from a template; arrange and preview link, image, product, community, calendar and email signup blocks.
2. Publish page and link from social profile; visitor signs up via consent-aware form and CRM captures source.

### Functional requirements
- **7.-01** Drag reorder, theme tokens, responsive preview, draft vs published state, valid domain and slug.
- **7.-02** Blocks for unavailable modules show explicit config/waitlist state, never broken CTA.
- **7.-03** Accessible link labels and safe external redirects; bot-filtered click analytics.

### Proposed Neon entities (illustrative, normalize during schema design)
- `bio_pages(slug,domain,theme,published_version)`
- `bio_blocks(page_id,type,position,config)`
- `bio_page_versions(snapshot,published_at)`
- `bio_analytics_events(session_key,block_id,event)`
- `domains(hostname,verification_status)`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/bio/pages`
- `PATCH /api/bio/pages/:id/blocks`
- `POST /api/bio/pages/:id/publish`
- `POST /api/bio/pages/:id/domains/verify`
- `GET /api/bio/pages/:id/analytics`

### Edge cases, privacy and failure handling
- Slug collision, custom domain TLS provisioning, malicious link injection, embedded media CSP.
- Analytics track aggregated data with privacy controls; cookie/legal policy applies.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Public page survives refresh and displays only published version.
- [ ] Signup contact contains campaign source and consent.
- [ ] Broken domains or links show meaningful failure, not blank page.

### Proposed implementation PR slices
- 1. Bio page schema + public rendering
- 2. Editable template/block library
- 3. Custom domains and versioned publishing
- 4. Analytics and signup/CRM hooks

## 8. CUSTOM AI AGENTS and AI gateway
**Release:** F1 / Release 2  
**Goal:** Workspace-controlled assistants capable of safe, audited actions.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/ai/agents` — assistant gallery
- `/ai/agents/new` — creation wizard
- `/ai/agents/:id/configure` — persona, model, sources, tools
- `/ai/agents/:id/test` — preview chat with permission view
- `/ai/agents/:id/runs` — run history/cost
- `/ai/knowledge` — file and webpage sources
- `/ai/settings` — model limits, budget and policies

### Primary user journeys
1. Create a brand-writing assistant using selected knowledge documents.
2. Ask agent to draft a post; review the action before publishing.
3. Ask for CRM report; agent receives only caller-permitted contact fields.

### Functional requirements
- **8.-01** Model gateway supports streaming and provider fallback; token/cost ledger.
- **8.-02** Tools must be registered with schemas and workspace-scoped auth.
- **8.-03** Read-only operations default; sending email, deleting data, publishing, payments and invitations require confirmation and audit.
- **8.-04** Knowledge ingestion tracks source ownership, version and deletion.
- **8.-05** Prompt-injection defenses separate source text from instructions; reject credentials in context.

### Proposed Neon entities (illustrative, normalize during schema design)
- `ai_agents(instructions,model,owner,visibility)`
- `ai_agent_versions`
- `ai_knowledge_sources, ai_document_chunks, embeddings`
- `ai_tool_grants, ai_run_events`
- `ai_approvals, ai_usage_ledger`
- `ai_provider_connections`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/ai/agents`
- `POST /api/ai/agents/:id/test`
- `POST /api/ai/agents/:id/tools/:toolId/approve`
- `GET /api/ai/agents/:id/runs`
- `POST /api/ai/knowledge/ingest`

### Edge cases, privacy and failure handling
- Tool execution after role change, document deletion, runaway loops, malformed model JSON, provider outage.
- No global vector index leaking tenant documents; enforce document-level permissions.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Unauthorized agent cannot read another workspace document.
- [ ] Approval-gated tool cannot execute without current user approval.
- [ ] All model calls generate usage record and visible failure path.

### Proposed implementation PR slices
- 1. AI gateway + quota/usage service
- 2. Agent CRUD and versioned instruction editor
- 3. Knowledge ingestion and retrieval authorization
- 4. Tools registry + explicit approval flows
- 5. Evaluation dataset and red-team checks

## 9. CONNECTED EMAIL — Gmail / Outlook mailbox in Harvest
**Release:** F1 minimal connection, F3 full mail workspace  
**Goal:** Read, compose, search and relate connected provider email to CRM.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/connected/email` — unified mailbox/account switcher
- `/connected/email/:threadId` — thread detail, labels and attachments
- `/connected/email/compose` — compose/reply/forward
- `/connected/email/settings` — accounts, sync health and privacy
- `/crm/people/:id/activity` — contact-linked email activity

### Primary user journeys
1. Member connects Gmail or Outlook with email-only scope.
2. User reads and searches messages and sends/replies from their provider mailbox.
3. An opted-in CRM linkage records activity for a matched contact.

### Functional requirements
- **9.-01** Provider owns mailbox content; Harvest stores minimum metadata and selective cached content with explicit policy.
- **9.-02** Thread pagination, unread, labels/folders, attachments and reply-all; outbound server logs idempotency.
- **9.-03** Distinguish person-owned mailbox visibility from workspace-shared mailbox; do not expose all connected mail to every workspace member.
- **9.-04** CRM timeline emails require explicit matching and permissions, not address-only automatic disclosure.

### Proposed Neon entities (illustrative, normalize during schema design)
- `mail_accounts(workspace_id,provider_ref,owner_user,status)`
- `mail_threads(provider_thread_id,account_id)`
- `mail_messages(provider_message_id,thread_id,metadata)`
- `mail_message_contacts(contact_id,message_id,match_method)`
- `mail_sync_cursors, mail_webhook_events`
- `mail_drafts, mail_attachment_refs`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `GET /api/connected/email/threads`
- `GET /api/connected/email/threads/:id`
- `POST /api/connected/email/send`
- `POST /api/connected/email/reply`
- `POST /api/connected/email/threads/:id/actions`
- `POST /api/webhooks/zernio/email`

### Edge cases, privacy and failure handling
- Email scope revoked mid-send, provider quota, draft with attachments, duplicate webhook and synced deletes.
- Outlook organization admin approval and Google review constraints.
- Never use transactional mailbox as bulk newsletter sending service without policy/limits check.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Sender identity matches connected account; successful send has provider ID.
- [ ] Unauthorized member cannot view another member private mailbox.
- [ ] Incoming webhook dedupes; deletion/revocation purges access according to policy.

### Proposed implementation PR slices
- 1. Connect scopes and per-user mailbox permission
- 2. Mailbox list/thread/compose UI
- 3. Zernio mail adapter, send/reply and sync
- 4. CRM activity linking, privacy and observability

## 10. CONNECTED CALENDAR — Google Calendar and Microsoft Outlook Calendar
**Release:** F1 integrations, F2 ministry event bridge, F3 productivity depth  
**Goal:** Personal and shared scheduling with two-way provider calendars.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/calendar` — day/week/month/agenda views
- `/calendar/new` — event and invite editor
- `/calendar/availability` — free/busy and booking suggestions
- `/calendar/accounts` — choose enabled calendars
- `/events/:id/calendar` — sync ministry event
- `/calendar/settings` — timezone, reminders, sync status

### Primary user journeys
1. Connect Google/Outlook calendar and show visible calendars.
2. Create calendar event with guest invite and Meet/Teams link where supported.
3. Link Harvest event to calendar instance; attendee change reconciles without loops.

### Functional requirements
- **10.-01** Store IANA timezone and original local time with UTC date.
- **10.-02** Provider event IDs and sync origins prevent duplicate two-way writes.
- **10.-03** Free/busy is permission-controlled and avoids leaking private event titles to other users.
- **10.-04** Event reminders, recurring instances and RSVP where provider supports them.

### Proposed Neon entities (illustrative, normalize during schema design)
- `calendar_accounts, external_calendars`
- `calendar_events(internal_event_id,external_id,starts_at,ends_at,timezone)`
- `calendar_attendees, calendar_event_links`
- `calendar_sync_cursors, calendar_webhook_events`
- `availability_preferences, booking_holds`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `GET /api/calendar/events`
- `POST /api/calendar/events`
- `PATCH /api/calendar/events/:id`
- `POST /api/calendar/availability`
- `POST /api/calendar/events/:id/rsvp`
- `POST /api/calendar/link-ministry-event`

### Edge cases, privacy and failure handling
- DST, recurring exception, offline provider, edited event from two sides, deleted calendar.
- Microsoft admin consent; unsupported recurrence behavior returns typed error.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Events created from Harvest appear exactly once in selected connected calendar.
- [ ] Conflicting concurrent edit shows conflict policy, not silent overwrite.
- [ ] Free/busy returns only permitted detail.

### Proposed implementation PR slices
- 1. Calendar provider adapter and connection UI
- 2. Event CRUD/recurrence and timezone views
- 3. Availability and booking
- 4. Ministry events sync and conflict reconciliation

## 11. CONNECTED FILES — Google Drive / OneDrive integrations
**Release:** F1 foundation, F3 full shared file browsing  
**Goal:** Provider-aware file picker and secure document links across Harvest modules.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/files` — provider and workspace file libraries
- `/files/connected` — Drive/OneDrive picker
- `/files/:id` — preview, metadata, access and linked records
- `/files/upload` — add to Harvest or provider
- `/files/settings` — permissions, storage quotas and retention

### Primary user journeys
1. Connect Google Drive or OneDrive with requested files scope.
2. Select permitted Google file via Picker; attach it to newsletter, AI knowledge or course.
3. Upload file into provider and link metadata to internal entity.

### Functional requirements
- **11.-01** **Google Drive limitation:** only app-created or user-picked files (`drive.file`), not full-drive browsing.
- **11.-02** OneDrive may allow broader listing under approved permissions; tenant administrators can restrict access.
- **11.-03** Provide Harvest-owned object storage for internal files; external links do not count as durable Harvest copies.
- **11.-04** Anti-malware scanning, MIME validation, signed URLs and strict file-level ACL.
- **11.-04a** **Virus/malware scanning of uploads: medium-high priority, DEFERRED until beta/production launch (Matei, 2026-11-04).** No paid scanner during development. It is a launch gate: before beta, public files stay quarantined, and private files are downloadable after the magic-byte type check (`FILES_REQUIRE_SCAN_PRIVATE=false`). Options to revisit at launch: self-hosted ClamAV (free, needs a small always-on container), Cloudmersive (free tier rejected: 1 concurrent scan and 3.5 MB cap; paid from $19.99/mo), attachmentAV/Sophos (€49/mo, EU region). It must support concurrent scans for multiple users and run as a background job.

### Proposed Neon entities (illustrative, normalize during schema design)
- `files(storage_driver,key,size,mime,owner,classification)`
- `external_files(account_id,provider_file_id,scope_source)`
- `file_links(target_type,target_id,file_id)`
- `file_permissions, file_versions`
- `file_scan_results, file_sync_cursors`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `GET /api/files`
- `POST /api/files/upload`
- `POST /api/files/import-provider`
- `POST /api/files/:id/share`
- `GET /api/files/:id/download`
- `POST /api/webhooks/zernio/files`

### Edge cases, privacy and failure handling
- Revoked file access, user deletes external file, link expiry, oversized upload and partial sync.
- Externally shared link must not bypass Harvest private entitlement rules.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Google Picker-selected file usable without requesting all Drive access.
- [ ] Unauthorized user cannot download a private attachment through guessed URL.
- [ ] Provider file deletion is reconciled as missing with recovery UI.

### Proposed implementation PR slices
- 1. Unified file metadata and private storage
- 2. Zernio Drive/OneDrive adapter and picker
- 3. Upload/download/preview and cross-module attachment UI
- 4. Sync webhooks, ACL and recovery

## 12. CHURCH NETWORK MAP and church records
**Release:** F2 / Release 3  
**Goal:** Church, campus and partner directory with consent-aware public maps.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/ministry/churches` — directory and map
- `/ministry/churches/new` — registration and verification
- `/ministry/churches/:id` — profile, services and people
- `/ministry/network` — multi-church relationships and map
- `/public/churches` — public opt-in locator

### Primary user journeys
1. Authorized church manager adds a church and campus address.
2. Public visitor searches optional published churches and service times.
3. Church chooses partnership invitation and limited sharing.

### Functional requirements
- **12.-01** Geocoding and manual override, city/map filters, address verification.
- **12.-02** Private ministry/volunteer home addresses never rendered as public church locations.
- **12.-03** Multiple campuses and timezone/service schedules.

### Proposed Neon entities (illustrative, normalize during schema design)
- `churches, church_campuses`
- `church_locations(geo_point,visibility,verified_at)`
- `church_services, church_contacts`
- `church_network_memberships, location_change_requests`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/ministry/churches`
- `GET /api/public/churches`
- `POST /api/ministry/churches/:id/verify`
- `PATCH /api/ministry/churches/:id/locations`

### Edge cases, privacy and failure handling
- Bad geocode, duplicate churches, outdated locations, private partners, map-provider downtime.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Public map includes only opted-in verified locations.
- [ ] Private campuses cannot be queried through public APIs.

### Proposed implementation PR slices
- 1. Church schema and verification
- 2. Map + directory UI
- 3. Public locator and permissions
- 4. Network membership approval

## 13. OUTREACH CAMPAIGNS and FOLLOW-UP PIPELINES
**Release:** F2 / Release 3  
**Goal:** Plan evangelistic work and handle participant contact with explicit consent.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/ministry/outreach` — campaigns and status
- `/ministry/outreach/new` — campaign builder
- `/ministry/outreach/:id` — plan, location, teams and stats
- `/ministry/outreach/:id/signup` — public signup
- `/ministry/outreach/:id/follow-up` — assignments and pipeline
- `/ministry/outreach/:id/reports` — outcomes and reports

### Primary user journeys
1. Coordinator builds outreach, publishes signup and assigns volunteers.
2. Participant signs up; CRM record created only with appropriate consent and access.
3. Assigned follow-up worker logs an attempt and schedules next step.

### Functional requirements
- **13.-01** Configurable outreach stages and assignments with status history.
- **13.-02** Consent for ministry contact separate from marketing opt-in.
- **13.-03** Sensitive spiritual/health/prayer responses must be minimized with explicit access policy.
- **13.-04** Cross-church campaign sharing only with agreed scopes; record owner remains clear.

### Proposed Neon entities (illustrative, normalize during schema design)
- `outreach_campaigns, outreach_sessions`
- `outreach_locations, outreach_teams`
- `outreach_registrations, response_records`
- `followup_cases, followup_tasks`
- `followup_attempts, outreach_consent_records`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/outreach/campaigns`
- `POST /api/outreach/:id/registrations`
- `POST /api/outreach/:id/followups`
- `PATCH /api/outreach/followups/:id/stage`
- `GET /api/outreach/:id/metrics`

### Edge cases, privacy and failure handling
- Duplicate participants, signups without consent, unwanted contact, offline outreach location.
- Opt-out immediately suppresses follow-up communication as applicable.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Signup creates/links the right contact without duplicates.
- [ ] Only assigned ministry roles can view restricted response fields.
- [ ] Follow-up history is auditable and reversible where reasonable.

### Proposed implementation PR slices
- 1. Campaigns and teams
- 2. Registration/consent + CRM linking
- 3. Follow-up case pipeline
- 4. Reports and mobile-friendly field workflow

## 14. VOLUNTEERS, EVENTS and QR CHECK-IN
**Release:** F2 / Release 3  
**Goal:** Manage real event participation, teams and attendance.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/ministry/volunteers` — registry and skills
- `/ministry/volunteers/shifts` — shifts, invitations and assignments
- `/events` — calendar/list of public and private events
- `/events/new` — recurring event and registration setup
- `/events/:id` — event detail, tickets and roster
- `/events/:id/check-in` — check-in scanner and manual lookup
- `/events/:id/attendance` — exports and reconciliation

### Primary user journeys
1. Organizer sets event schedule, capacity, public registration and invite codes.
2. Attendee gets QR with short-lived opaque token, checks in at venue.
3. Volunteer coordinator assigns shifts and notifies opted-in helpers.

### Functional requirements
- **14.-01** Unique check-in per ticket/session with supervised override.
- **14.-02** Waitlist promotion, cancellation/refund linkage if paid later.
- **14.-03** Mobile scanner supports degraded connectivity with safely queued operations.
- **14.-04** Calendar integration syncs approved event instance without exposing attendee records.

### Proposed Neon entities (illustrative, normalize during schema design)
- `volunteer_profiles, volunteer_skills, shifts, shift_assignments`
- `events, event_sessions, event_tickets`
- `event_registrations, attendance_checkins`
- `checkin_devices, checkin_sync_attempts`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/events`
- `POST /api/events/:id/register`
- `POST /api/events/:id/check-in`
- `GET /api/events/:id/roster`
- `POST /api/volunteers/shifts`
- `PATCH /api/volunteers/assignments/:id`

### Edge cases, privacy and failure handling
- Duplicate scan, transferred ticket, no-show, network outage, timezone, overlapping shifts.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Two scans cannot count attendance twice.
- [ ] Only authorized check-in staff can mark attendance.
- [ ] Offline/reconnect reconciles exactly once.

### Proposed implementation PR slices
- 1. Events/registrations schema
- 2. Public registration and attendee QR
- 3. Check-in scanner and durable write pipeline
- 4. Volunteer shift planner and notifications
- 5. Reports and calendar sync

## 15. DISCIPLESHIP JOURNEYS and ministry AI copilot
**Release:** F2 / Release 3  
**Goal:** Structured learning/follow-up journeys with opt-in automation and safe AI assistance.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/ministry/journeys` — templates and sequences
- `/ministry/journeys/:id/edit` — stages and assignments
- `/ministry/journeys/:id/participants` — progress
- `/ministry/copilot` — ministry-focused agent surface
- `/ministry/resources` — notes, resources and scripture links

### Primary user journeys
1. Admin builds newcomer journey and chooses email/community/course activities.
2. Participant opts in; staff updates milestones and assigns mentor.
3. Copilot drafts outreach follow-up and proposes volunteer allocation for approval.

### Functional requirements
- **15.-01** Journey progress visible only to participant and assigned staff with least privilege.
- **15.-02** Scripture text licensing must be checked; text provenance in knowledge bases.
- **15.-03** Copilot tools read only permitted records; no silent spiritual profiling or sensitive inferences.

### Proposed Neon entities (illustrative, normalize during schema design)
- `discipleship_journeys, journey_steps, journey_enrollments`
- `journey_progress, mentorship_assignments`
- `ministry_ai_policy, ministry_ai_actions`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/journeys`
- `POST /api/journeys/:id/enroll`
- `PATCH /api/journeys/enrollments/:id/progress`
- `POST /api/ministry/copilot/requests`

### Edge cases, privacy and failure handling
- Unsubscribed participant, unsafe AI suggestion, duplicate enrollment, mentor removed.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Enrollment and milestones persist and can be safely exited.
- [ ] Copilot cannot send follow-up or change assignments without approval.

### Proposed implementation PR slices
- 1. Journey schema + designer
- 2. Enrollment/progress and mentorship
- 3. Ministry agent toolkit and evaluations

## 16. MULTI-CHURCH COLLABORATION and network governance
**Release:** F2+ extension  
**Goal:** Cross-workspace cooperation without losing data ownership.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/ministry/network/partners` — partner requests
- `/ministry/network/projects` — shared outreach projects
- `/ministry/network/projects/:id` — scoped collaboration dashboard
- `/ministry/network/permissions` — grant and revoke sharing

### Primary user journeys
1. Church A invites Church B to specific outreach project.
2. Church B accepts and sees only granted campaign/volunteer summary, not Church A CRM.
3. Either side revokes access; cached references are invalidated.

### Functional requirements
- **16.-01** No global supertenant merge; explicit resource grants and expiry.
- **16.-02** No implicit contact sharing; separate disclosure and participant consent for each recipient where required.
- **16.-03** Cross-tenant audit and resource owner.

### Proposed Neon entities (illustrative, normalize during schema design)
- `network_partnerships, shared_projects`
- `cross_workspace_grants(source_workspace,target_workspace,resource,scope)`
- `shared_project_members, cross_workspace_audit`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/network/invitations`
- `POST /api/network/projects`
- `POST /api/network/grants`
- `DELETE /api/network/grants/:id`

### Edge cases, privacy and failure handling
- Grant revoked while session open; organization removed; copied link after revocation.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Revocation removes access immediately.
- [ ] Cross-workspace data cannot be obtained through direct object identifiers.

### Proposed implementation PR slices
- 1. Partnership lifecycle and invitation
- 2. Scoped resource grants and isolation tests
- 3. Shared campaign UI and audit

## 17. COMMUNITIES and member experiences
**Release:** F3 / Release 4  
**Goal:** Free and gated community spaces linked to CRM and creator identity.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/community` — community overview
- `/community/:slug` — channel navigation and feed
- `/community/:slug/new` — post and media composer
- `/community/:slug/members` — roles, invites, bans
- `/community/:slug/settings` — visibility, rules and moderation
- `/community/:slug/events` — calendar and event links

### Primary user journeys
1. Owner creates community with public and member-only spaces.
2. Member joins through invite or valid course/product entitlement.
3. Moderator handles flagged post and sends notification.

### Functional requirements
- **17.-01** Role-based channel visibility and bans; rich posts and attachments.
- **17.-02** Entitlement changes may revoke access without losing historic moderation audit.
- **17.-03** Activity notifications; privacy-aware search and export.

### Proposed Neon entities (illustrative, normalize during schema design)
- `communities, channels, community_members`
- `community_posts, comments, reactions`
- `community_invites, moderation_flags`
- `community_entitlement_policies, community_notifications`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/communities`
- `POST /api/communities/:id/posts`
- `POST /api/communities/:id/members/invite`
- `POST /api/communities/:id/moderation`
- `GET /api/communities/:id/feed`

### Edge cases, privacy and failure handling
- Deleted or refunded entitlement, blocked member, private channel in global search.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Nonmember cannot read private content through URL/API.
- [ ] Moderation actions create audit entries.
- [ ] Member state survives subscription changes.

### Proposed implementation PR slices
- 1. Community schema and membership
- 2. Feeds/posts/comments
- 3. Moderation and notifications
- 4. Paid gating integration

## 18. FORMS, SURVEYS and conditional data capture
**Release:** F3 / Release 4, thin signup components earlier  
**Goal:** Universal form engine for marketing, ministry, onboarding and events.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/forms` — form library and metrics
- `/forms/new` — template builder
- `/forms/:id/edit` — schema, logic, styling
- `/forms/:id/submissions` — safe response table and exports
- `/f/:slug` — public and embedded form
- `/forms/:id/settings` — notifications, webhooks and consent

### Primary user journeys
1. Admin builds form with branching and consent fields.
2. Public visitor submits; CRM contact association and automation event emitted.
3. Owner exports submissions with correct field permissions.

### Functional requirements
- **18.-01** Field types: text, email, phone, date, choice, multiselect, file, consent, hidden attribution.
- **18.-02** Conditional requiredness validated server side, not only client side.
- **18.-03** CAPTCHA/rate-limit/honeypot and attachment validation.
- **18.-04** PII retention and delete/export policies by form.

### Proposed Neon entities (illustrative, normalize during schema design)
- `forms, form_versions, form_fields`
- `form_submissions, submission_files`
- `form_rules, form_destinations`
- `form_spam_events, form_consent_evidence`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/forms`
- `POST /api/forms/:id/publish`
- `POST /api/public/forms/:slug/submissions`
- `GET /api/forms/:id/submissions`
- `POST /api/forms/:id/hooks/test`

### Edge cases, privacy and failure handling
- Repeat submit, bot traffic, malformed branch, oversized upload, deleted field across version.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Public form only accepts published schema fields.
- [ ] Submission records schema version, source and consent evidence.
- [ ] CRM entry created once on duplicate webhook/retry.

### Proposed implementation PR slices
- 1. Form schema/versioned builder
- 2. Public renderer and validation
- 3. Submissions, export and CRM integration
- 4. Branching logic, anti-spam and tests

## 19. NEWSLETTERS, audiences and email automation
**Release:** F3 / Release 4  
**Goal:** Consent-first broadcasts and sequences distinct from user mailbox email.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/email/audiences` — lists/segments and subscribers
- `/email/campaigns` — draft/scheduled/sent list
- `/email/campaigns/new` — block-based email editor
- `/email/campaigns/:id/review` — test, preview and approval
- `/email/campaigns/:id/analytics` — delivery performance
- `/email/sequences` — welcome/nurture builder
- `/email/settings` — sending domain, suppression, consent

### Primary user journeys
1. Creator builds audience from opt-in form and tags.
2. Writes campaign using reusable blocks; previews on mobile and sends test.
3. Schedules to opted-in audience; delivery events update campaign report.

### Functional requirements
- **19.-01** Use appropriate bulk email provider when needed; Zernio Gmail/Outlook mailbox sending is not assumed to be compliant/high-volume marketing infrastructure.
- **19.-02** Hard suppression/unsubscribe applied before every send and queue retry.
- **19.-03** Per-recipient time, source and campaign consent evidence retained.
- **19.-04** Segmentation snapshot and throttling; avoid double sends on job retries.

### Proposed Neon entities (illustrative, normalize during schema design)
- `audiences, audience_memberships, segments`
- `email_campaigns, email_templates, email_blocks`
- `email_sends, provider_delivery_events`
- `suppression_entries, consent_evidence`
- `email_sequences, sequence_steps, sequence_enrollments`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/email/campaigns`
- `POST /api/email/campaigns/:id/test`
- `POST /api/email/campaigns/:id/schedule`
- `POST /api/email/subscribers/import`
- `POST /api/email/unsubscribe`
- `POST /api/webhooks/email-delivery`

### Edge cases, privacy and failure handling
- Bounce, provider complaint, spam complaint, unsubscribe mid-send, large audience throttling.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Opt-out recipient receives no campaign email.
- [ ] Campaign counts reconcile to provider delivery webhooks.
- [ ] User can unsubscribe via accessible working link.

### Proposed implementation PR slices
- 1. Audience and consent models
- 2. Block email editor and previews
- 3. Sender integration and deliverability
- 4. Scheduling, sequences and reporting

## 20. AI CHAT — full workspace assistant
**Release:** F3 / Release 4  
**Goal:** Conversation-centered AI with history, source permissions and tool use.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/ai/chat` — conversation and model selector
- `/ai/chat/:id` — history, attachments, tool results
- `/ai/chat/new` — new thread
- `/ai/settings/models` — policies and quota
- `/ai/chat/search` — past conversations

### Primary user journeys
1. User starts chat, streams response, uploads workspace-permitted file.
2. User requests draft campaign and previews proposed action; approves before dispatch.
3. Member searches only their accessible conversations and documents.

### Functional requirements
- **20.-01** Streaming cancellation, retry, history, thread rename/archives and attachment previews.
- **20.-02** Clearly distinguish answer sources, inferred statements and executed actions.
- **20.-03** Model/provider fallback without leaking system prompts, keys or tenant context.
- **20.-04** Encrypted storage of conversation content with deletion and retention controls.

### Proposed Neon entities (illustrative, normalize during schema design)
- `ai_conversations, ai_messages, ai_message_parts`
- `ai_attachments, ai_model_runs`
- `ai_tool_calls, ai_tool_approvals`
- `ai_conversation_shares`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/ai/chat/stream`
- `GET /api/ai/conversations`
- `POST /api/ai/conversations/:id/attachments`
- `POST /api/ai/tool-calls/:id/approve`
- `GET /api/ai/usage`

### Edge cases, privacy and failure handling
- Interrupted stream, model hallucination, prompt injection in retrieved file, deleted contact in context.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Conversations persist and can be resumed without duplicate response.
- [ ] Tool invocation respects member roles and explicit approvals.
- [ ] No retrieval of unauthorized data across tenants or private user mailboxes.

### Proposed implementation PR slices
- 1. Chat shell with streaming/history
- 2. Attachments and authorized knowledge retrieval
- 3. Tool-action cards and approval UI
- 4. Usage, quotas and evaluation suite

## 21. COURSES, MEMBERSHIPS and learning
**Release:** F1 thin essentials, F4 full monetized depth  
**Goal:** Course and membership access driven by durable entitlements.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/learn` — course catalog
- `/learn/courses/new` — course outline builder
- `/learn/courses/:id/edit` — lessons, drip schedule, media
- `/learn/courses/:id/students` — enrollments and progress
- `/learn/:slug` — learner view
- `/memberships` — tiers and benefits

### Primary user journeys
1. Creator authors course and privately previews it.
2. Student receives eligible access via free enrollment or later purchase and progress saves.
3. Community access is granted through defined membership/entitlement rule.

### Functional requirements
- **21.-01** Lesson sequencing, file protection, drafts, drip, progress and certificates.
- **21.-02** Thin v1 entitlement engine independent from checkout, with explicit free/manual grants.
- **21.-03** Revocation/refunds update course and community access consistently.

### Proposed Neon entities (illustrative, normalize during schema design)
- `courses, course_sections, lessons, lesson_assets`
- `course_enrollments, lesson_progress`
- `membership_plans, memberships, entitlements`
- `course_certificates, access_grants`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/learn/courses`
- `PATCH /api/learn/courses/:id`
- `POST /api/learn/enroll`
- `POST /api/learn/:id/complete-lesson`
- `GET /api/learn/:id/progress`
- `POST /api/memberships`

### Edge cases, privacy and failure handling
- Multiple devices, deleted media, expired membership, invalid purchase webhook.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Unauthorized learner cannot fetch protected lesson file.
- [ ] Lesson completion persists and is idempotent.
- [ ] Revoked membership reflects immediately.

### Proposed implementation PR slices
- 1. Course authoring models/editor
- 2. Learner progression and gated file delivery
- 3. Entitlement and membership policy
- 4. Reporting and advanced features

## 22. PRODUCTS, STOREFRONTS, PAYMENTS and GIVING
**Release:** F4 / Release 5; donation primitives earlier when needed  
**Goal:** Sell digital goods and manage accurate financial/entitlement states.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/products` — catalog and status
- `/products/new` — product type, pricing, media and fulfillment
- `/storefront` — public page/theme manager
- `/store/:slug` — public storefront
- `/checkout/:product` — checkout and payment confirmation
- `/orders` — paid/refunded/failed history
- `/customers/:id` — purchaser profile and access
- `/finance/giving` — donations, campaigns and statements

### Primary user journeys
1. Creator publishes product and customer completes hosted checkout.
2. Payment provider webhook confirms paid status and entitlements are issued once.
3. Refund leads to defined access revocation and auditable customer notification.
4. Donor makes one-time/recurring donation, receipt is generated from settled transactions.

### Functional requirements
- **22.-01** Use payment service provider; no card data stored in Harvest.
- **22.-02** Price/currency/tax clearly represented; distinguish donation from commercial product.
- **22.-03** Financial event ledger and reconciliation by provider IDs, not browser redirects.
- **22.-04** Fulfillment cannot run before verified payment, and should be retriable safely.

### Proposed Neon entities (illustrative, normalize during schema design)
- `products, product_variants, prices, coupons`
- `storefronts, storefront_pages, checkout_sessions`
- `orders, order_items, payment_attempts`
- `refunds, invoices, tax_records`
- `entitlements, fulfillment_jobs`
- `donation_campaigns, donation_transactions, donation_receipts`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/products`
- `POST /api/checkout/sessions`
- `POST /api/webhooks/payment`
- `GET /api/orders`
- `POST /api/orders/:id/refund`
- `POST /api/donations/campaigns`
- `POST /api/donations/checkout`

### Edge cases, privacy and failure handling
- Failed/partial payment, duplicate webhook, chargeback, currency mismatch, refunds and subscription proration.
- Cross-border donation tax/charitable status varies; do not claim tax deductibility without verification.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Replay webhook does not double charge or grant access twice.
- [ ] Refund and failed payment are correctly visible to purchaser and owner.
- [ ] Reported revenue matches settled payments, not checkout sessions.

### Proposed implementation PR slices
- 1. Product/order/price models
- 2. Checkout provider adapter and webhook accounting
- 3. Entitlement fulfillment and customer access
- 4. Storefront builder and coupon flow
- 5. Refund/finance reconciliation and giving

## 23. ADVANCED AUTOMATIONS and shared workflow engine
**Release:** F1 minimal, F3-F4 full  
**Goal:** Reliable cross-module workflows with explicit permissions and safe replay.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/automations` — workflow list
- `/automations/new` — trigger/condition/action builder
- `/automations/:id/runs` — execution logs and retries
- `/automations/templates` — starter flows
- `/automations/settings` — quotas, approvals and credentials

### Primary user journeys
1. Trigger: link-in-bio signup; action: create contact and optionally enroll in consented welcome sequence.
2. Trigger: outreach signup; action: assign follow-up owner and send internal notification.
3. Trigger: course purchase settled; action: grant enrollment and private community entitlement.

### Functional requirements
- **23.-01** Versioned workflows and permission-aware action execution.
- **23.-02** Durable queue, retry/backoff, dead-letter, causal trace IDs and rate limits.
- **23.-03** Human approval required for sensitive actions and external sends where configured.
- **23.-04** No infinite loops: causality/recursion guard and action budgets.

### Proposed Neon entities (illustrative, normalize during schema design)
- `automation_definitions, automation_versions`
- `automation_triggers, automation_runs, automation_steps`
- `automation_errors, automation_approvals`
- `outbox_events, idempotency_keys`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `POST /api/automations`
- `POST /api/automations/:id/test`
- `POST /api/automations/:id/enable`
- `GET /api/automations/:id/runs`
- `POST /api/automations/runs/:id/retry`

### Edge cases, privacy and failure handling
- User loses permission mid-run, duplicate trigger, provider outage and misconfigured step.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] Duplicate event executes side effect once.
- [ ] Failed job can be inspected and safely retried by authorized admin.
- [ ] Disabled workflow cannot start new runs.

### Proposed implementation PR slices
- 1. Event outbox + idempotent worker
- 2. Definition schema and simple builder
- 3. Cross-module actions and approvals
- 4. Run logs, debugging and templates

## 24. NOTIFICATIONS, ANALYTICS and support operations
**Release:** Cross-cutting F0–F4  
**Goal:** Operationally trustworthy notifications and reporting.  
**Dependencies:** CORE; workspaces; tenant-scoped identity

### Page / screen inventory
- `/notifications` — notification center
- `/analytics` — workspace overview
- `/analytics/reports` — saved reports
- `/settings/usage` — provider and AI usage
- `/support/diagnostics` — safe admin job status

### Primary user journeys
1. Member receives event/approval notification and navigates to correct object.
2. Admin views only verified analytics, filterable by dates and source.
3. Support logs job status without granting blanket access to personal data.

### Functional requirements
- **24.-01** Metric provenance and delayed provider updates are visible.
- **24.-02** Privacy-preserving aggregated analytics and verified source attribution.
- **24.-03** Notifications respect delivery preferences and per-role limits.

### Proposed Neon entities (illustrative, normalize during schema design)
- `notification_events, notification_preferences`
- `analytics_event_log, analytics_daily_rollups`
- `report_definitions, report_runs`
- `support_access_grants, operational_alerts`

### Service/API contracts (Harvest-owned endpoints; validate Zernio contracts separately)
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `GET /api/analytics/overview`
- `GET /api/usage`
- `POST /api/reports/run`

### Edge cases, privacy and failure handling
- Late analytics events, deleted entities, missing provider webhook, inaccessible notification target.

### Acceptance criteria (test against live adapters in sandbox)
- [ ] No fake dashboard data labeled as real.
- [ ] Report totals match known entity queries and source snapshots.

### Proposed implementation PR slices
- 1. Notification outbox and preferences
- 2. Metric event definitions and rollups
- 3. Usage dashboard and diagnostics

## 25. Data relationship map and integration topology

```text
User -> WorkspaceMembership -> Workspace -> ProviderConnection
Workspace -> Contact <- (NewsletterSubscriber, Buyer, CommunityMember, OutreachParticipant)
Contact -> Activities <- (Email, SocialConversation, FormSubmission, EventRegistration, Purchase)
Workspace -> SocialAccount -> SocialPost -> PublishAttempt
Workspace -> BioPage -> BioBlock -> BioClickEvent
Workspace -> CalendarAccount -> CalendarEvent [may link MinistryEvent]
Workspace -> ExternalFile [may attach to AI knowledge, post, course, email]
Workspace -> Course -> Lesson; CourseEnrollment -> Entitlement
Workspace -> Community -> Member; MembershipPlan -> Entitlement
Workspace -> Automation -> Run -> Steps; OutboxEvent -> Run
Workspace -> Church -> Campus; Outreach -> Registration -> FollowUpCase
Workspace -> Order -> PaymentAttempt -> Entitlement
```

**Shared record identifiers:** A contact is always workspace-scoped. External identity matching must preserve provider, account and external ID; email alone is not a safe global identifier. Cross-workspace church collaboration uses an explicit share grant, never moves records into a global shared tenant.

**Minimal proposed indexes:** `(workspace_id,created_at)` for all tenant lists; unique `(workspace_id,slug)` where public; `(provider,provider_account_id)` with appropriate scoping; unique `(workspace_id,provider,event_id)` for incoming webhooks; `(workspace_id,contact_id,event_at)` for contact timeline; `(workspace_id,status,scheduled_at)` for work queues.

**Neon operating assumptions:** Use pooled connections where appropriate, bounded transaction duration, migration checks in CI and recovery/backup drills. Neon is database infrastructure, not a replacement for scheduling workers, media storage, transactional email or external payments. Verify current Neon Auth/storage product constraints before selecting provider implementations.

## 26. Roles / permission policy — minimum viable matrix

| Action | Owner | Workspace Admin | Creator/Editor | Ministry Lead | Member | Guest |
|---|---|---|---|---|---|---|
| Billing & workspace deletion | Allow | Deny by default | Deny | Deny | Deny | Deny |
| Invite workspace admins | Allow | Policy-based | Deny | Deny | Deny | Deny |
| CRM contacts read | Allow | Allow | Scoped | Scoped | Deny | Deny |
| CRM sensitive ministry notes | Scoped | Scoped | Deny | Assigned only | Deny | Deny |
| Social drafting | Allow | Allow | Allow | Scoped | Deny | Deny |
| Social publish | Allow | Scoped | Approval required | Scoped | Deny | Deny |
| Connected private mailbox | Mailbox owner | Mailbox owner | Mailbox owner | Mailbox owner | Mailbox owner | Deny |
| Shared calendar events | Allow | Allow | Scoped | Scoped | Invited | Deny |
| AI knowledge retrieval | Entitled | Entitled | Entitled | Entitled | Entitled | Explicit only |
| Events check-in | Allow | Allow | Event-staff role | Event-staff role | Deny | Deny |
| Financial details/refunds | Allow | Explicit finance grant | Deny | Deny | Deny | Deny |

Never implement authorization by role name strings alone: evaluate explicit capabilities and resource ownership. This matrix is a starting point to approve before build.

## 27. Privacy, security and safety requirements

- Collect purpose-limited personal data. Worship/church membership, outreach interest, prayers and related notes may reveal sensitive religious information; implement strict access, consent and applicable-law review (including EU GDPR where relevant).
- Separate lawful basis and opt-in purposes for marketing email, outreach follow-up, event administration and account communications.
- Connected Google/Microsoft accounts: clear consent screen explaining scopes; per-user ownership; account disconnect; delete sync tokens through provider where possible; never persist raw refresh tokens if Zernio abstracts them.
- Retention policies per module; delete/export workflows include provider-side constraints, jobs and backups. Privacy deletion should prevent reimport via stale sync events.
- AI: no default model training on customer content; verify actual provider terms; sensitive-data filters, redaction, access checks at retrieval and tool invocation, prompt injection tests.
- Uploads: malware scanning, file limits, provider URL validation, signed/private download, content-type enforcement. Avoid SSRF from media imports.
- Financial: reconcile payment webhooks and immutable ledger entries, restricted finance roles; require legal review before issuing donation tax statements.
- Published content: moderation/reporting, abuse handling, copyright/trademark considerations and provider terms.

## 28. End-to-end launch scenarios / acceptance suites

1. **Social publish:** Member connects social provider -> writes platform-specific post -> approval -> schedule -> provider publishes -> status updates -> analytics arrives; retry/duplicate events do not duplicate post.
2. **Link in Bio:** Build/publication -> anonymous visit -> tracked click -> form submission -> contact created -> consent stored -> analytics displayed.
3. **Twenty-style CRM:** Import -> deduplicate -> pipeline update -> task assigned -> email or event linked -> permission restricted -> export correctly excludes unauthorized fields.
4. **Connected mailbox:** Connect Gmail/Outlook -> view thread -> send/reply -> new-message webhook -> related contact timeline (only with allowed access) -> disconnect.
5. **Calendar:** Connect Google/Microsoft -> list calendars -> create event with guests -> update from provider -> free/busy -> disconnect; no sync loops.
6. **Files:** Connect Google/OneDrive -> pick/upload allowed file -> attach to AI/course/email -> private permission check -> provider deletion shown as missing.
7. **AI assistant:** Create agent -> add knowledge -> ask question -> invoke read-only tool -> propose publish action -> user approval -> complete action -> audit & cost record.
8. **Outreach:** Create church/campaign -> public volunteer signup -> consented contact -> shift -> event QR check-in -> follow-up assignment -> opt-out stops messages.
9. **Community + learning:** Course enrollment -> entitlement -> private channel join -> post/comments -> refund/revoke -> access removed.
10. **Newsletter:** Opt-in -> segment -> send test -> schedule broadcast -> delivery webhook -> unsubscribe -> subsequent automation suppressed.
11. **Checkout:** Purchase -> payment provider confirms -> order and entitlement -> course unlock -> refund -> access policy applied.
12. **Tenant escape:** For every module run tenant-A vs tenant-B direct URL, ID, search, webhook, file URL and AI tool replay tests.

## 29. Release plan and critical dependencies

| Release | Ordered scope | Exit gate |
|---|---|---|
| F0 (1) | Neon + auth + workspaces + permissions + shadcn shell + CRM identity spine + jobs/audit | Secure two-tenant E2E; workspace onboarding; no placeholder UI |
| F1 (4) | Social Studio + Zernio (including Unified Inbox and Auto-DMs); Link in Bio; AI agent gateway; connected account foundation; automation basics; course/membership primitives | Published live social post + bio page + approved AI action; Google/Microsoft connection smoke tests |
| F2 (5) | Church network map; outreaches; volunteers; events/check-in; journeys; ministry copilot; collaboration permissions | Outreach registration→CRM→assignment→check-in→follow-up E2E |
| F3 (3) | Communities; newsletters; full AI Chat; forms; complete connected email/calendar/files; advanced automations | Real community access; consented campaign; AI chat; mailbox/calendar/files E2E |
| F4 (2) | Products, full storefronts/checkout, paid memberships/courses, commerce reporting; mature giving flows | Test purchase/refund/entitlement and reconciled records |

**Scheduling guardrail:** Release numbers are preserved exactly as the founder requested. The sequence includes thin dependencies early; for example, an outreach form can exist in F2 using the generic form primitive without shipping the full form builder until F3, and a membership in F1 can be manually granted without full checkout until F4.

**Planning envelope:** Using tested UI blocks and API integrations, the full scope may require 9–18 months of full-time solo founder + AI-assisted development, with significant contingency for OAuth approvals, provider SDK changes, security and user testing. This is a planning range rather than a promise or objective engineering estimate. Developer speed should be re-estimated after F0 and first real end-to-end Social Studio integration.

## 30. PR / issue management specification

**PR size policy:** One verifiable vertical slice per PR, typically 1–3 developer-days; avoid giant implementation PRs. A PR includes migration, service/API, UI, access rules, tests, screenshots and validation evidence where relevant. Split UI and backend only if feature is behind a release flag and is not advertised as live.

**Issue template:** ID; scope/release; user scenario; acceptance criteria; API and data contract; permission matrix; analytics/events; error states; accessibility; tests; dependencies; license/IP notes; rollback path.

**PR completion evidence:** CI; Neon migration applied in disposable database; test evidence; tenant-isolation test; browser journey; third-party provider sandbox status; no secrets in logs; screenshots/mobile proof; code-owner/reviewer approval.

**Suggested leadership metrics:** real journeys passing; weekly P0/P1 regressions; reopened tickets; provider publish success; send success; payment reconciliation; AI tool approval compliance; tenant escape incidents (zero tolerance); % modules with production traces; time spent fixing vs generating code.

## 31. Licenses, assets and design references

- **shadcn/ui** is selected as core UI framework; component/blocks licenses must still be checked individually.
- **Postiz** is referenced for social workflow and UI patterns. Do not ingest its AGPL-covered application source into proprietary Harvest without professional licensing review.
- **Twenty** is referenced for CRM UX, feature capabilities and data interaction. Validate licenses for any exact component/package before reuse; maintain provenance manifest. Independent design and implementation is default.
- **Eden** is a product functionality/UX benchmark, not a source code, protected asset or trademark source. Harvest branding and code must be original.
- External provider API features and prices may change. Lock versions and maintain compatibility tests.

## 32. Open decisions and initial engineering spikes

1. Select authentication implementation (Neon Auth vs independent provider) after current feature/security evaluation.
2. Choose durable job queue and hosting to handle scheduled social posts and webhooks reliably.
3. Verify Zernio: OAuth profile/account mappings, webhook signatures, unified inbox read/reply/assign semantics, Instagram/Facebook Auto-DM rules and webhook contracts, file upload constraints, Gmail mailbox quotas, Microsoft admin-consent behavior and provider-specific scopes with test accounts.
4. Choose transactional/bulk email provider for newsletters; keep separate from connected Gmail/Outlook mailboxes.
5. Select object storage, domain/SSL routing, geocoding/map provider, video hosting, payment provider and observability stack.
6. Decide first social channels and their post-type preview requirements.
7. Specify course video access and paid-community entitlements under subscription expiration.
8. Verify applicable privacy, nonprofit/donation and consumer commerce rules for target markets.
9. Validate mobile-first UX on 3 real user journeys before broad UI construction.
10. Establish feature flag and beta cohort process: founder workspace now, early external pilot users later.

## 33. References and traceability

**Master PRD:** Harvest v2.5, 4 November 2026. **Original inputs:** Harvest v1 repository and founder decisions from this conversation. **Provider docs (verified 4 Nov 2026):** https://my.zernio.com/google , https://my.zernio.com/microsoft , https://my.zernio.com/email-api , https://my.zernio.com/calendar-api , https://my.zernio.com/files-api , https://my.zernio.com/comment-to-dm , https://my.zernio.com/social-media-dms , https://docs.zernio.com/ . **Design references:** https://ui.shadcn.com/blocks ; https://github.com/gitroomhq/postiz-app ; https://github.com/twentyhq/twenty . All implementation details beyond documented provider capabilities are proposed requirements, not claims of delivered provider parity.
