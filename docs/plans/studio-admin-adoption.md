# Studio Admin visual adoption roadmap for Harvest V2

**Decision (founder, 2026-11-08; updated):** Studio Admin is the sole primary visual reference for Harvest's authenticated shell, pages, dashboards, forms, editors, and Harvest Studio unified inbox. Shadboard is not a design reference. Premium, restrained, professional UI is the target; avoid playful theme presets. **Match Studio Admin's actual default color palette, surfaces, typography, borders, spacing and dark mode as closely as feasible.** Harvest gold must not dominate the default theme; keep it for a later optional separate theme. **All 12 founder-selected palettes in `docs/design/theme-candidates.md` are approved future selectable themes, deferred until the Studio Admin baseline is implemented—not canceled.**

**Scope of this PR:** planning only. No application UI, providers, routes, auth, database, or production behavior changes. Do not infer that the source template's example social-media imagery implements platform integrations.

## Reference and license

- Upstream Radix/shadcn edition: https://github.com/arhamkhnz/next-shadcn-admin-dashboard
- Demo: https://studio-admin.arhamkhnz.com
- Upstream README advertises Next.js 16, Tailwind 4, shadcn/ui, MIT, responsive sidebar/content layouts, CRM, finance, analytics, productivity, academy, e-commerce, logistics, file manager, chat, email, calendar, Kanban, tasks, invoices, user/role management and auth screens.
- Inspect exact upstream files, commit, dependencies, copyright and MIT notices before copying source. Preserve license attribution in Harvest's existing provenance records. Do not copy brand marks, third-party imagery or mock personal data.
- Upstream's RBAC and multitenancy are **planned** rather than a replacement for Harvest's working permissions. Email/chat pages are presentation examples; platform connectors, send permissions, rate limits and channel coverage require independent verification.

## Verified Harvest baseline (read current main again before implementing)

- `package.json`: Next.js 16, React 19, Tailwind 4, shadcn, Radix, Lucide, Zod, next-intl. React Hook Form and TanStack Table are not currently installed; don't introduce either without a specific approved consumer.
- `src/components/app-shell.tsx`: existing permission-aware navigation, workspace switcher, sidebar, mobile navigation, notifications, theme controls. **Keep the component's contracts and logic; redesign presentation only.**
- `src/components/ui/`: canonical shadcn primitives; avoid parallel primitive libraries.
- `src/components/crm/list-page.tsx`, `list-toolbar.tsx`, `record-grid.tsx`, `record-layout.tsx`: working list/detail and filter composition; adapt styling without weakening server-authoritative filters or exports.
- `src/components/connect-admin/landing-editor.tsx`: working draft/preview/save/publish/unsaved-change semantics; preserve these while adopting a premium editor layout.
- `src/lib/theme-registry.ts`, `src/lib/theme.ts`, `src/app/globals.css`: preserve workspace-specific theme mechanics and light/dark behavior while making Studio Admin's default visual palette the target; defer Harvest gold to a separate optional theme. Do not silently discard existing workspace brand values.
- Read `docs/design-system.md`, `docs/plans/design-system-foundation.md`, `AGENTS.md`, `CLAUDE.md`, module PRDs and acceptance records before implementation.

## Why this adoption exists: reusable systems, not screen-by-screen copying

The founder's primary architectural goal is **build once, reuse across Harvest**. Studio Admin is the visual specification for the shared systems; copying its pages individually would defeat the purpose. Implement the existing Harvest AppShell, shared page templates, resource lists/details, creation wizard, EditorShell, form engine, inbox composition and semantic theme registry as configurable, reusable systems. Before adding a screen, inspect and reuse existing shared patterns; extend them only for real consumer needs. No module-specific duplicate dashboards, sidebar shells, wizards or styling forks.

For each implementation PR, document (1) the shared primitive/template/engine reused or introduced, (2) the real module consumers, (3) why any exception cannot be composed from shared parts, (4) regression/responsive/light-dark checks. Prove newly generalized systems with at least two real consumers before declaring them universal. Keep backend authorization and domain workflows separate from UI composition. The 12 founder-selected future themes and optional Harvest Gold must reuse the same semantic tokens and layouts.

## Visual direction and acceptance

One coherent Studio Admin-inspired system across every module, not one dashboard style plus unrelated internal pages. Use restrained neutral surfaces, deliberate hierarchy, precise spacing, legible typography, consistent border radii, subtle active states and compact but touch-accessible controls. Avoid playful gradients, cartoonish icons, Neo Brutalism/Soft Pop presets, excessive decorative cards or per-module styling forks.

**Shell:** desktop collapsible sidebar, grouped module navigation, workspace switcher, context header, breadcrumbs, global actions, account menu, notifications; mobile drawer and compact header. Preserve workspace-scoped routes, permission-filtered links, keyboard/focus behavior, localization, and theme bootstrapping.

**Shared pages:** page header/actions, searchable resource list, filters/saved views, data grid, details/profile, settings, analytics, calendar, Kanban, invoice, tasks, empty/loading/error states. Use typed composition, not hardcoded domain data in generic templates.

**Create/edit:** one consistent modal/drawer/full-page creation treatment; a single config-driven multi-step wizard and editor shell delivered incrementally, with actual consumer workflows, validation, draft/resume, permission checks and domain-specific completion.

**Mobile:** explicitly test 360px and 390px phone widths, tablet 768px, desktop 1280px and 1440px; no horizontal page overflow, legible dense tables with intentional overflow/alternate card view, usable drawers and keyboard, visible focus and touch targets around 44px where practical. Both light and dark modes.

## Screen-to-module adaptation map

| Studio Admin source/pattern | Harvest consumer | Boundary |
| --- | --- | --- |
| Sidebar, navbar, layout controls | Shared AppShell for all authenticated modules | No replacement of tenancy/auth/permissions |
| CRM dashboard, user/profile pages, data grids | CRM contacts, companies, pipelines | Existing server predicates and privacy remain authoritative |
| Finance dashboard, invoice, analytics | Fundraising, donations, budgets | No simulated financial transactions or assumed provider support |
| Analytics/productivity dashboards | Campaigns, Social Studio, workspace home | Real metrics only, empty state for unavailable data |
| Academy/products | Courses, products, coaching, communities | Existing domain modules and entitlement services |
| Logistics, tasks, Kanban, calendar | Crusade operations, teams, volunteers, social scheduling | Preserve scheduling and workflow contracts |
| File manager | Shared media library | Respect workspace isolation, storage authorization |
| Email/chat pages | Harvest Studio unified inbox | Visual reference only until channel APIs and capabilities are proven |
| Settings, users/roles, authentication | Workspace settings and account screens | Keep Better Auth and existing server authorization |
| Form/page structures | Creation wizard, editors, public forms | Build reusable composition; no mock production submissions |

## Harvest Studio unified inbox: special treatment

Founder prefers Studio Admin's social-media-inclusive inbox visual presentation. **Verify actual upstream page(s) and supported channel icons/filters in source before asserting which platforms are included.** Build a channel-neutral conversation UI with three responsive regions: conversation list + filters, active thread + composer, contact/CRM context. Adapt to two-column and single-column mobile views.

Model channel capabilities independently: read, reply, attachments, templates, windows, identity, assignment, delivery state, and provider errors. Distinguish UI presentation from connected accounts and actual provider support (Instagram, Facebook, WhatsApp, email, SMS and others only when verified). Keep workspace scoping, consent, auditability, CRM linking, and no unsupported send controls. Do not implement messaging or connect credentials in the visual-foundation PR.

## Ordered, reviewable delivery

1. **Source audit and visual inventory (documentation):** pin upstream commit, inspect actual shell, email/chat, dashboard, list, detail, form, mobile source; screenshot/route matrix and license/dependency register. Identify exact candidate files and Harvest counterparts. No visual implementation until this audit.
2. **Foundation + showcase:** register existing components and tokens, make Studio Admin's colors and styling the default design target using Harvest's existing theme infrastructure, create internal showcase; no wholesale global CSS replacement. Preserve old gold token values for a later optional theme. Add the 12 founder-selected optional palettes in a later dedicated workstream after baseline stabilization, preserving the Studio Admin shell and layout across all themes.
3. **Shell proof-of-concept:** adapt existing AppShell and mobile drawer; preserve permissions, workspace switching, route selection, next-intl, notifications, themes. Verify 360/390/768/1280/1440 widths and both themes.
4. **Shared page primitives:** header, actions, section panels, list/toolbar/grid, detail tabs, status and settings composition. Migrate one CRM list and one Connect/other page as real consumers before wider rollout.
5. **Unified inbox UI prototype:** verified Studio Admin inbox visual treatment wired to typed mock *presentation* fixtures in internal/dev-only showcase; define capability contracts. Integrate live providers only in separately approved, security-reviewed PRs.
6. **Dashboard and specialized views:** finance, campaign, academy, analytics, calendar/Kanban where real data exists. Avoid placeholder fake business metrics in production.
7. **Creation/editor foundations:** shared wizard and editor shell, first two real module consumers, tests for draft/publish/unsaved state and domain-specific authorization.
8. **Module rollout:** migrate remaining screens in bounded PRs, each with visual comparisons, regression tests and provenance records.

These are **workstreams**, not a promise of exactly eight PRs. Break larger workstreams into smaller PRs as needed.

## Definition of done for each visual PR

- Existing workflows and backend authorization unchanged unless separately approved.
- Upstream source/commit/license and exact adapted files recorded in `docs/ui-sources.md` and relevant license records.
- No duplicate runtime design system, no unverified upstream code. Remove the nonfunctional OpenShadcnBlocks registry aliases and retire its selected-source instructions; retain the generic shadcn CLI because Harvest uses it for verified primitives.
- Responsive screenshots for phone/tablet/desktop; keyboard/focus and axe checks; no overflow.
- Tests/lint/typecheck/build and targeted CRM/Connect E2E where relevant; independent code review before merge.
- No deployment, merge, payment processing, outbound messaging, or production intake activation implied by a design approval.

## Immediate next step

Perform the pinned upstream source audit and produce a file-by-file mapping for shell and email/chat pages first. This plan authorizes documentation of design direction, **not** a wholesale frontend rewrite or new external integration.
