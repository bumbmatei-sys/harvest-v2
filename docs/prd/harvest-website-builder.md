# Harvest Website Builder — Product Requirements Document

**Status:** Proposed detailed specification; founder-approved product direction, pending review of implementation details  
**Date:** 11 November 2026  
**Release:** Post-launch / Future Vision. Not part of the frozen Professional V1 launch unless separately authorized.  
**Owners:** Harvest product and engineering  
**Related:** [Professional V1 launch scope](professional-v1-launch-scope.md), [PRD v2.5](PRD-v2.5.md), [PRD v2.7 companion](PRD-v2.7-companion.md), [AI assistant architecture](AI-assistant-architecture.md), [design system](../design-system.md), [component registry](../component-registry.md).

> **Founder-approved decisions:** A full-package, multi-page website builder with custom domains; both visual drag-and-drop and AI-assisted creation/editing; both methods operate on the **same reusable, schema-validated block model**. Every AI-generated block is manually editable, and every visual edit remains legible to the AI. This is not a landing-page-only tool or two separate editors.

## 1. Purpose and positioning

Let churches, ministries, nonprofits, evangelists and missionaries build, publish and maintain professional websites directly within Harvest without coding. Support both users who prefer a visual editor and users who prefer prompting an assistant. Integrate authorized Harvest resources—events, forms, donations, campaigns, courses, communities, digital products and contact workflows—without duplicating their underlying records.

### Goals
- Publish complete, accessible, fast, responsive multi-page sites with custom domains and HTTPS.
- Offer intuitive drag/drop, inline text editing, reusable templates, blocks, sections and site-wide components.
- Let an AI assistant generate sites, pages and targeted edits using the exact same block schema and permissions as the manual editor.
- Connect live Harvest content through explicit, permission-aware data bindings and predictable public visibility.
- Preserve revisions, provide preview/approval, and publish safely with rollback.
- Reuse Harvest Studio Admin, shared shadcn components, design tokens and core engines rather than building an isolated product.

### Non-goals
- Arbitrary execution of user-supplied JavaScript or AI-generated executable code on public sites.
- A general-purpose hosting platform for arbitrary applications, custom server code or databases.
- Replacing the existing CRM, events, donations, courses or commerce engines.
- Automatic public disclosure of private CRM, ministry-response or religious-affiliation data.
- Shipping as part of Professional V1 without a separate scope decision.

## 2. Users and roles

- **Workspace owner/admin:** create sites, configure branding, manage domains, invite editors, publish and roll back.
- **Site manager/editor:** edit content and permitted layout, manage drafts; publish only with explicit permission.
- **Contributor:** propose page/content changes, no domain/security/publishing access.
- **Visitor:** browse published public pages, submit public forms and access linked Harvest resources according to their own access/entitlements.
- **AI assistant:** acts as an explicitly authorized helper for the current user, never as an independent super-admin; proposes structured edits, never silently publishes.

Capabilities must be checked server-side for site.read, site.edit, site.ai, site.publish, site.domains, site.settings and site.analytics. Use tenant-scoped authorization and existing role infrastructure.

## 3. Primary workflows

1. **Start a site:** choose organization and site, then choose a template, blank canvas or AI prompt. Set name, logo, colors, typography, locale and default pages.
2. **Build visually:** browse a categorized block library, drag blocks/sections into a page, reorder via keyboard or pointer, edit copy/images inline, adjust responsive settings and preview.
3. **Build with AI:** describe organization, goals, pages and design; assistant proposes a site plan, pages and block tree; user reviews a rendered preview and applies or rejects changes.
4. **Refine with AI:** select a block/section/page and ask “make this hero simpler,” “add an events section,” or “create a sermons page.” Assistant returns a typed patch with preview, diff and undo.
5. **Connect Harvest data:** add an Events, Courses, Giving, Campaign, Form or Community block, choose a permitted source and display style; the public renderer shows only public or authorized content.
6. **Launch:** validate links, forms, accessibility, SEO, DNS/domain, security and performance; preview draft; publish an immutable version; monitor and roll back when needed.
7. **Maintain:** schedule updates, manage navigation, redirects, site-wide sections, assets, analytics, revisions and contributor approvals.

## 4. Information architecture and screens

- `/sites` — site list, status, domains and create site.
- `/sites/new` — template/blank/AI setup wizard.
- `/sites/:siteId/overview` — site dashboard, publish state, recent edits and checks.
- `/sites/:siteId/editor/:pageId` — page canvas, block library, page tree, inspector, responsive preview, history and AI assistant.
- `/sites/:siteId/pages` — create, duplicate, nest, reorder, archive and manage pages.
- `/sites/:siteId/design` — brand kit, theme tokens, global components and templates.
- `/sites/:siteId/assets` — images, documents and media library.
- `/sites/:siteId/domains` — default subdomain, custom domains, DNS verification and TLS state.
- `/sites/:siteId/seo` — metadata, indexing, sitemaps, redirects and search previews.
- `/sites/:siteId/settings` — locales, access, analytics, integrations and policies.
- `/sites/:siteId/releases` — preview builds, publish history and rollback.
- Public site host routes must resolve tenant/site/domain safely, without relying on user-controlled host headers alone.

Use Studio Admin's shared app shell, floating sidebar, design tokens and existing reusable editor patterns. The editor may have a purpose-built canvas, but must reuse shared inputs, menus, dialogs, asset pickers, permission gates and form primitives.

## 5. Content and block system — single source of truth

### 5.1 Canonical page document
Represent pages as a **versioned typed document tree**, not generated HTML or opaque provider markup. Each node has:
- Stable `id`, `type`, `schemaVersion`, validated `props`, optional `children` and layout constraints.
- Responsive properties using a constrained token system (desktop/tablet/mobile) rather than arbitrary unsafe CSS.
- Optional binding to an explicitly approved Harvest public data source.
- Optional localization and accessibility metadata.
- Referential integrity and parent/child compatibility rules.

Pages also have path, title, status, SEO metadata, navigation metadata, draft revision and published revision. Schema migrations must be reversible or version-compatible and tested against older pages.

### 5.2 Block library
Initial families:
- **Structure:** section, container, grid, columns, spacer, divider, tabs, accordion.
- **Typography/media:** heading, rich text, image, gallery, video embed, icon, quote.
- **Navigation:** header, footer, menu, breadcrumbs, buttons, CTA.
- **Marketing:** hero, feature list, testimonials, staff/team, FAQs, contact, location/map, newsletter signup.
- **Harvest-native:** public events/calendar, courses, communities, campaigns, donation/giving CTA, forms, product listing, sermons/media resources when supported.
- **Utility:** social links, legal/policy page, search where indexed content is supported.

Each block definition supplies: stable type, props schema, editor controls, default content, preview renderer, public renderer, accessible keyboard behavior, responsive constraints, safe AI editing surface, serialization and migration tests. Use shared component registry; avoid duplicated bespoke block logic.

### 5.3 Visual editing
- Drag, drop, reorder, duplicate, delete, group, nest and move blocks with valid drop-target indicators.
- Keyboard-accessible alternative to pointer drag/drop, including move up/down and structural tree navigation.
- Inline rich text and media replacement, inspector for block properties and spacing/layout controls.
- Undo/redo and autosave with clear unsaved/conflict states; preserve user intent under concurrent edits.
- Reusable sections and site-wide header/footer; updates to global sections have impact previews.
- Templates/themes operate on the canonical schema and shared tokens, not hardcoded HTML.
- Responsive previews and per-breakpoint overrides within guardrails; no broken mobile layouts from unsupported nesting.

## 6. AI-assisted site building

The AI is an **editor of the canonical block tree**, not an HTML/code generator. Use the provider-agnostic Vercel AI SDK architecture specified in `AI-assistant-architecture.md`.

### 6.1 Supported actions
- Generate a site plan with sitemap and recommended pages.
- Create pages from a description, existing template or brand kit.
- Add/reorder/replace/update/delete blocks, edit copy, suggest images, modify theme tokens and SEO fields.
- Suggest or configure authorized Harvest-native content blocks.
- Explain a proposed change, identify missing prerequisites and request clarification for destructive/ambiguous actions.
- Support scoped edits (selected block, section, page or whole site) and conversation context.

### 6.2 Structured patch contract
- AI returns a **validated operation plan**, e.g. `createPage`, `insertBlock`, `updateBlockProps`, `moveBlock`, `deleteBlock`, `updateTheme`, `setBinding`.
- Each operation includes target IDs, expected revision, typed payload, and a human-readable explanation.
- Server validates schema, authorization, allowed source bindings, quotas and optimistic concurrency **before** staging.
- Render a preview/diff. Require explicit user application for changes; require heightened confirmation for destructive multi-page edits.
- Apply accepted operations as one auditable transaction where possible; keep undo and version restore.
- No automatic publish, domain changes, permission changes, payment setup or secret access via AI.
- Reject prompt injection from uploaded content, site text and retrieved sources; treat all such text as untrusted.

### 6.3 Reliability and cost
- AI model selection/fallback via existing provider adapters, not model-specific frontend logic.
- Track token usage, latency, failure rates, approximate cost and tenant limits.
- Recover from partial generation and malformed output; never leave half-applied site state.
- Reuse existing workspace-controlled memory and conversation storage, with consent/retention controls.
- Provide capability-aware fallback if a model lacks required structured-output or tool support.

## 7. Multi-page sites, navigation and localization

- Create unlimited pages within configurable plan and safety limits; support nested navigation and clean URL slugs.
- Page types: standard page, homepage, legal, resource/list/detail and optionally dynamic collection-backed pages after review.
- Manage global header/footer, menus, navigation order, active states, 404 and redirect behavior.
- Duplicate, hide from navigation, unpublish and archive pages without unintended broken links.
- Support locale-ready content model and language metadata; translation workflows may be phased, but must not require a schema rewrite.
- Define safe route resolution and canonical URL rules for slugs, domains, locales and reserved paths.

## 8. Domains, publishing and delivery

- Give each site a platform-managed preview/default hostname; exact naming and domain availability are deployment decisions.
- Support custom apex and subdomains, domain ownership verification, DNS setup guidance, automatic HTTPS and certificate renewal.
- Validate ownership and conflicts before attaching a domain; prevent domain takeover and cross-tenant reassignment.
- Draft/preview/published versions; preview access tokens must expire and not expose private data.
- Publishing is an explicit privileged action with a preflight report (domain, broken links, missing assets, public data bindings, accessibility and SEO warnings).
- Atomic version promotion, cache invalidation, safe rollback and observable publish status.
- Prefer static/cacheable public rendering where possible; dynamic blocks fetch only permitted public data with bounded caching and graceful errors.
- Enforce request quotas, asset size limits, abuse controls and tenant/site isolation; never expose private environment secrets to the public renderer.
- Hosting implementation should align with approved Vercel + Neon + Cloudflare R2 architecture, without committing to a provider-specific editor schema.

## 9. Harvest integrations

Bindings must use Harvest-owned typed contracts and existing access controls, not scrape admin UI or copy private records.

| Integration | Public website behavior | Guardrail |
|---|---|---|
| Events and campaigns | Public event lists, details, registration links and campaign landing content | Only published/public resources; registration uses approved forms |
| Courses | Public catalog and eligible course detail/CTA | Private lessons and paid content require entitlement |
| Communities | Public discovery/detail and join CTA | Never expose private community posts or membership |
| Giving/donations | Giving page, campaign CTA and approved checkout handoff | Stripe Connect eligibility/compliance gate; no custom payment collection |
| Forms and CRM | Contact, newsletter signup, volunteer registration and follow-up | Explicit-purpose consent; no public CRM search or private contact data |
| Digital products | Public product cards and authorized checkout links | Commerce/entitlement gates |
| Media/assets | R2-backed authorized public assets | Virus/type checks, signed private access and safe embeds |

Published sites must survive temporary upstream module outages with clear fallback UI. Consent decisions and data deletion must propagate to form/CRM integrations. No live donation processing before the separately approved payment and compliance gates.

## 10. Branding, SEO, analytics and accessibility

- Brand kit: logos, fonts via approved licensed assets, color tokens, imagery and reusable styles.
- Template catalog for churches, ministries, missionaries, nonprofit organizations and campaign microsites.
- SEO: editable page title/description, canonical URLs, social share previews, robots controls, sitemap, structured data where valid, redirects and image alt text.
- Analytics: pageviews, traffic sources, conversion events and published-site health; privacy-preserving by default, with configurable consent controls and no sensitive visitor data in URLs or analytics events.
- Accessibility: semantic headings, keyboard navigation, focus visibility, color contrast, form labels, alt text, reduced motion and WCAG 2.2 AA-oriented acceptance checks.
- Performance: optimized responsive images, lazy loading, caching, sensible script budgets and measurable Core Web Vitals targets set during implementation planning.

## 11. Security, privacy and compliance

- Enforce workspace/site ownership and capability checks on every API, page, asset, domain and publish operation; verify Neon RLS/tenant boundaries.
- No executable user JavaScript or arbitrary CSS injection in the first release; sanitize rich text and restrict embeds to allowlisted providers.
- Public pages must not render private ministry responses, prayer requests, contacts, giving records, email lists or private community content.
- CSRF protection, rate limiting, safe file uploads, SSRF protection for any remote fetches, CSP and secure domain resolution.
- Separate draft/private content from published/public snapshots; ensure search engines cannot index private previews.
- Audit edits, AI patches, approvals, publish actions, domain changes and restores.
- GDPR-aware forms and analytics; support consent withdrawal, data subject rights and retention policies already chosen for Harvest Connect and CRM.
- Backup/restore, deletion and export paths for site content, metadata and public assets.

## 12. Suggested data model (illustrative, subject to schema review)

- `sites(id, workspace_id, name, status, primary_domain_id, theme_id, created_by)`
- `site_pages(id, site_id, parent_id, slug, type, locale, nav_order, status)`
- `site_page_revisions(id, page_id, schema_version, block_tree_json, seo_json, created_by, created_at)`
- `site_releases(id, site_id, revision_manifest, status, published_by, published_at)`
- `site_domains(id, site_id, hostname, verification_state, tls_state, primary)`
- `site_themes(id, site_id, token_json, version)`
- `site_assets(id, site_id, r2_key, visibility, metadata)`
- `site_bindings(id, site_id, block_id, source_type, source_id, policy)`
- `site_ai_edit_sessions(id, site_id, actor_id, conversation_id, status)`
- `site_ai_change_sets(id, session_id, base_revision, operations_json, approval_state)`
- `site_redirects(id, site_id, source_path, target_path, status_code)`
- `site_audit_events(id, workspace_id, site_id, actor_id, action, metadata, created_at)`

Apply foreign keys, unique constraints, optimistic revision checks, domain uniqueness and RLS policies. Avoid duplicating authoritative CRM, course, event or payment data in the website schema.

## 13. Proposed API/service contracts

- `POST /api/sites`; `GET /api/sites/:id`; `PATCH /api/sites/:id`
- `GET/POST /api/sites/:id/pages`; `PATCH /api/sites/:id/pages/:pageId`
- `POST /api/sites/:id/pages/:pageId/changesets` (validated visual edits)
- `POST /api/sites/:id/ai/plan`; `POST /api/sites/:id/ai/changesets`
- `POST /api/sites/:id/ai/changesets/:changeSetId/apply`
- `POST /api/sites/:id/preview`; `POST /api/sites/:id/publish`
- `GET /api/sites/:id/releases`; `POST /api/sites/:id/releases/:releaseId/restore`
- `POST /api/sites/:id/domains`; `POST /api/sites/:id/domains/:domainId/verify`
- `GET/PUT /api/sites/:id/theme`; `POST /api/sites/:id/assets`
- `GET/POST /api/sites/:id/redirects`; `GET /api/sites/:id/analytics`

Contracts are proposed, not existing endpoints. All mutating calls require server-side authorization, schema validation, idempotency where appropriate and audit trails.

## 14. Acceptance criteria / end-to-end tests

- [ ] A church admin creates a site with Home, About, Sermons, Events, Ministries and Contact pages; navigation and mobile layout work.
- [ ] A contributor visually adds, reorders, edits and deletes blocks using pointer **and keyboard**, saves a draft and sees an accurate preview.
- [ ] AI generates the same type of editable blocks; user changes a block manually, then AI edits that same block without overwriting unrelated changes.
- [ ] AI returns an inspectable change set, respects selected scope, asks for confirmation, and never publishes automatically.
- [ ] Invalid AI block props, unauthorized tools and malicious prompt injection cannot bypass schema or role checks.
- [ ] A public Events block displays only eligible published events; an attempt to bind another tenant's/private records fails.
- [ ] Public contact/newsletter forms preserve independently recorded purpose-specific consent and honor unsubscribe/withdrawal.
- [ ] Custom domain verifies ownership, resolves to correct site, receives HTTPS, and cannot be claimed by another workspace.
- [ ] Publish creates a stable release; preview is private; rollback restores the previous working public version.
- [ ] A deleted/missing upstream resource renders a safe fallback without exposing private data or crashing the page.
- [ ] SEO sitemap/canonical/redirects work, and public pages meet agreed accessibility and performance gates.
- [ ] Cross-tenant API tampering, upload attacks, unsafe embeds, domain takeover and concurrent-edit conflicts have automated regression tests.
- [ ] End-to-end flow: prompt → generated multi-page site → visual edits → connected public events/form → preview → custom domain → publish → rollback.

## 15. Implementation slices / proposed PR sequence

These are **proposed reviewable PR slices**, not a commitment to the launch schedule. Each slice requires focused tests and independent review.

1. **WEB-01 — Architecture and block contracts:** ADR, site/page/revision models, canonical block registry, schema validation, tenancy and role tests.
2. **WEB-02 — Shared renderer and starter templates:** accessible public renderer, responsive token system, starter themes, layout primitives and preview harness.
3. **WEB-03 — Visual editor foundation:** canvas, block library, drag/drop plus keyboard reorder, inspector, inline editing and undo/redo.
4. **WEB-04 — Multi-page and global layout:** page tree, nested navigation, global header/footer, site settings and asset picker.
5. **WEB-05 — AI structured-edit engine:** model-independent operations, scoped prompts, validation, staged diffs, approvals, undo, cost limits and adversarial tests.
6. **WEB-06 — Harvest data bindings:** public events, courses, communities, campaigns, products, giving CTAs and forms with access checks.
7. **WEB-07 — Publishing and releases:** drafts, preflight, previews, atomic release, cache invalidation and rollback.
8. **WEB-08 — Domains and delivery:** DNS ownership, custom domains, HTTPS, routing isolation, operational runbooks.
9. **WEB-09 — SEO, analytics and localization foundations:** sitemap, redirects, metadata, privacy-aware metrics, locale model.
10. **WEB-10 — Hardening and full acceptance:** accessibility, performance, security, load tests, backup/restore and pilot site acceptance.

Dependencies: Phase 0 shared components/editor registry, core workspace/RLS/auth, R2 storage, public forms, approved commerce/payment handoff, and provider-agnostic AI service. Each integration may be released behind a capability flag until its owning module is production-ready.

## 16. Product success metrics

- Time to first complete published site; time to first custom-domain launch.
- Percentage of AI-generated blocks successfully edited manually; percentage of manual blocks successfully modified via AI.
- Site creation → first publish conversion and 30-day site maintenance activity.
- Publish/rollback success, broken links, accessibility defects, uptime and Core Web Vitals.
- Form submissions and relevant conversions (measured with consent and privacy controls).
- AI edit approval/rejection rates, error rate, latency and cost per accepted change.

## 17. Open implementation decisions (do not silently assume)

1. Final editor drag/drop library and document-state implementation after prototype and accessibility evaluation.
2. Initial template catalog, supported localization depth and optional dynamic page types.
3. Exact managed default-domain naming, DNS automation provider and infrastructure routing approach.
4. Public site hosting/rendering/cache architecture and plan quotas after cost/performance evaluation.
5. Whether site collaboration needs real-time presence/co-editing at initial release; optimistic conflict handling is mandatory.
6. Initial AI model/capability benchmark, image sourcing policy and asset licensing rules.
7. Approved analytics provider, retention and cookie/consent behavior by jurisdiction.

**Scope authority:** The approved Professional V1 launch freeze supersedes any older P0/P1 or release labels. This document preserves the full future website-builder vision but does **not** authorize implementation, deployment, domain purchases, paid services or production activation.
