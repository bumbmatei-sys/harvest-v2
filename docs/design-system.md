# HARVEST V2 — MASTER UI/UX DESIGN SYSTEM & REUSABLE APPLICATION ARCHITECTURE

**Status:** Implementation Specification
**Priority:** Phase 0 — Before building individual modules
**Objective:** Build one consistent, beautiful, reusable application architecture inspired by Eden.so, using shadcn/ui, 21st.dev, and AI coding agents.

---

## Mandatory architectural rule — reuse is the reason for this work

**The primary purpose of adopting Studio Admin is to implement a reusable Harvest application system, not to reskin independent screens.** Studio Admin supplies the consistent visual reference; Harvest must own the reusable implementation. Every new or redesigned module must compose existing shared primitives, AppShell, page templates, resource-list/detail patterns, creation wizard, EditorShell, form engine, and theme tokens wherever the capability fits.

**Before creating a new dashboard, list, form, wizard, editor, settings page, or inbox view:** inspect the existing component registry and relevant consumers; extend an appropriate shared abstraction rather than cloning a page or building a parallel module-specific implementation. Configure the shared system with typed domain-specific steps, fields, actions, permissions, and state; keep authorization, tenancy, data fetching, persistence, and business workflows in their owning services. **Do not force unrelated workflows into one giant component**: where reuse is inappropriate, document the concrete difference and use smaller composable primitives.

**Enforcement / PR acceptance:** each UI PR must name the shared system(s) reused or introduced, show at least two representative real consumers before declaring a new abstraction universal, identify any deliberate exception and why, and include responsive light/dark and behavior/regression evidence. Reject copy-pasted dashboard shells, duplicated creation flows, hardcoded theme styles, or a separate component library merely to reproduce a Studio Admin screenshot. Preserve existing working logic and avoid speculative abstractions without real consumers.

**Theme boundary:** Studio Admin's default appearance is the initial baseline. The 12 founder-selected future palettes and optional Harvest Gold must change semantic theme tokens through the same registry, **not** fork layouts, widgets, navigation, wizards, or editors.

## 1. Core Objective

Harvest must function and feel like **one unified application**, even though it contains Social Studio, CRM, AI Chat, communities, courses, coaching, products, newsletters, campaigns, and ministry management.

The goal is to avoid developing individual dashboards, creation forms, editors, onboarding experiences, and settings pages independently.

**Build shared systems once, then configure and extend them across all Harvest modules.**

Every new feature should reuse existing components and patterns unless there is a justified need for something new.

## 2. Technology Stack

- **Frontend:** Next.js, React, TypeScript
- **Base components:** shadcn/ui
- **Styling:** Tailwind CSS
- **Component discovery:** 21st.dev MCP
- **Database:** Neon PostgreSQL
- **Forms:** React Hook Form + Zod
- **Icons:** Lucide
- **Testing:** Playwright, component tests, accessibility tests
- **Development:** Claude Code / Codex

Use high-quality existing libraries for tables, calendars, drag-and-drop, file uploads, editors, and other complex UI interactions.

Do not introduce competing design systems without explicit justification.

## 3. Harvest Design System

### Approved visual baseline and future selectable themes (8 November 2026)

**Studio Admin is the mandatory baseline for the complete authenticated application**, not just dashboards: shell/sidebar/header, navigation, CRM lists and details, settings, tables, analytics, editors, forms, creation wizards, responsive views and Harvest Studio's unified inbox. Match Studio Admin's default semantic colors, surfaces, typography, spacing, borders, radii and light/dark behavior first, adapting its patterns to Harvest's existing shadcn architecture and permission-aware workflows. See [adoption plan](plans/studio-admin-adoption.md).

**Founder-selected optional themes are a committed future product requirement, not discarded design research.** After the Studio Admin baseline is stable, add all **12 named palettes** in [the theme specification](design/theme-candidates.md) as user-selectable options in Harvest's existing theme registry and picker, including appropriate light/dark variants. Preserve Studio Admin as the default. Harvest Gold is also a future optional theme; the founder has not selected it as the default. Theme selection changes tokens, not navigation architecture, component contracts or permissions. No competing per-theme layout systems. Do not claim themes are implemented until actually shipped.



Establish a centralized design system covering:

- Color palette, semantic colors, and light/dark themes
- Typography, weights, sizing, and line heights
- Spacing, grids, padding, and margins
- Border radii, shadows, and elevation
- Buttons, inputs, dropdowns, and form controls
- Icons and navigation patterns
- Dialogs, drawers, popovers, and tooltips
- Animations and transitions
- Loading, empty, success, and error states
- Responsive breakpoints
- Accessibility and keyboard navigation

All UI components must use centralized design tokens.

21st.dev components must be adapted to Harvest's established styling and interaction standards.

Create a component showcase so developers and agents can preview reusable components.

## 4. Shared Application Shell

Build one `AppShell` used across every authenticated Harvest module.

Include:

- Collapsible sidebar
- Workspace switcher
- Global search and command palette
- Module navigation and subnavigation
- Contextual page headers and breadcrumbs
- Notifications
- Account and workspace settings
- Global AI assistant entry point
- Mobile navigation
- Permission-aware menus

Modules provide configuration for the shell rather than implementing their own navigation systems.

## 5. Shared Page Templates

Build reusable templates for:

| Template | Usage |
|---|---|
| Dashboard | Social Studio, CRM, Campaigns, Communities |
| Resource List | Contacts, products, events, members |
| Resource Detail | Contact profiles, courses, campaigns |
| Kanban | Deals, tasks, outreach follow-up |
| Calendar | Social posts, appointments, events |
| Editor | Courses, products, newsletters, coaching |
| Settings | Account, workspace, module settings |
| Analytics | Social, email, sales, event reporting |
| Form | Registrations, applications, surveys |
| Onboarding | Workspace and resource creation |
| Public Landing Page | Storefronts, courses, communities, campaigns |

Templates must support typed configuration and composition without embedding domain-specific business logic.

## 6. Universal Creation Wizard Engine

Create **one reusable creation/onboarding engine** for the entire platform.

All creation experiences must share:

- Same layout and styling
- Step indicator
- Back / Next / Finish buttons
- Conditional steps
- Step validation
- Draft autosave
- Resume later
- Review screen
- Error handling
- Responsive dialog or full-screen wizard
- Idempotent backend creation

Each module provides a configuration defining its steps, fields, permissions, validation schemas, and completion behavior.

Examples:

**Community:** Basics → Access & Pricing → Channels → Appearance → Review

**Course:** Basics → Access & Pricing → Curriculum → Appearance → Review

**Coaching:** Basics → Access & Pricing → Scheduling → Appearance → Review

**Product:** Basics → Access & Pricing → Delivery → Appearance → Review

**AI Assistant:** Basics → Model & Instructions → Knowledge → Tools & Permissions → Review

**Campaign:** Type → Basics → Location & Dates → Leadership → Features → Budget → Follow-Up → Review

**Event:** Basics → Venue & Schedule → Registration → Team → Review

**Newsletter:** Basics → Audience → Design → Settings → Review

Reuse common steps such as Basics, Appearance, Access & Pricing, and Review. Specialized steps remain modular.

**Never create a separate wizard engine for every module.**

## 7. Universal Editor Architecture

After creation, resources should open in a consistent editing interface.

Create a shared `EditorShell` with:

- Header and breadcrumbs
- Save status and autosave
- Editing navigation
- Main editor workspace
- Settings panels
- Preview mode
- Validation feedback
- Publish controls
- Unsaved-changes protection

Specialized editors can supply their own internal content.

Examples include the course curriculum editor, community manager, newsletter editor, product editor, and campaign configuration interface.

## 8. Universal Resource Lifecycle

Implement consistent UI patterns for:

**Create → Configure → Edit → Preview → Publish → Manage → Analyze**

Support draft, published, archived, and other domain-specific states as appropriate.

Do not force every resource to share identical backend lifecycles merely because the UI is similar.

## 9. Shared Access, Pricing & Entitlements

Create reusable components and backend services for:

- Free access
- One-time purchases
- Recurring subscriptions
- Memberships
- Private or invitation-only access
- Coupons and promotions
- Content gating
- Enrollment and access permissions

Communities, products, courses, coaching, and memberships should reuse these systems where appropriate.

Server-side authorization must enforce all access restrictions.

## 10. Shared Form Builder & Renderer

Create one reusable form engine for:

- Public signup forms
- Newsletter subscriptions
- Coaching applications
- Volunteer applications
- Event registrations
- Surveys
- CRM forms
- Evangelistic response forms
- Campaign registrations

Support field types, conditional logic, validation, multi-step flows, consent fields, submissions, and integrations.

Separate the internal form builder from the public-facing form renderer while sharing field definitions.

## 11. Shared Components & Resource Views

Build common components for:

- Data tables with sorting, filtering, pagination, and saved views
- Kanban boards
- Calendars
- File uploads and media libraries
- Rich-text editing
- Search and filters
- Activity timelines
- Team and contact selectors
- Pricing editors
- Publish checklists
- Status indicators
- Notifications
- Confirmation dialogs
- Empty, loading, and error states

The same resource-list system should support CRM contacts, social posts, events, products, and community members through configuration.

## 12. Shared Public-Facing Design System

Build reusable layouts for:

- Community landing pages
- Course sales pages
- Product storefronts
- Coaching booking pages
- Campaign landing pages
- Event registration pages
- Donation pages
- Public forms

Support responsive design, workspace branding, custom domains, accessibility, SEO, and appropriate privacy/consent controls.

Public pages may have a different visual presentation from the administrative dashboard but must use shared design foundations.

## 13. Central Component & Template Registry

Maintain a searchable internal registry of:

- Components
- Dashboard templates
- Page templates
- Wizard configurations
- Editor layouts
- Forms
- Public page templates

Document each component's purpose, configuration, supported states, dependencies, accessibility behavior, usage examples, and source license.

Coding agents must search the registry before generating a new component.

## 14. Module Integration Contracts

Every Harvest module must register its:

- Navigation and routes
- Required permissions
- Feature flags and plan requirements
- Dashboard widgets
- Search capabilities
- Notifications
- Analytics events
- AI assistant tools, if supported
- Settings pages

Modules should integrate through shared contracts while maintaining independent domain services.

## 15. Shared Data & State Standards

Use consistent conventions for:

- Server-side loading
- Client-side caching
- Data mutations and optimistic updates
- Pagination and filtering
- Error handling and retries
- Draft persistence
- Conflict resolution
- Permission-denied states
- Unsaved changes
- Loading and empty states

Avoid duplicating data-fetching and state-management logic across modules.

## 16. AI Agent Design Rules

Every coding agent must follow these rules:

1. Search existing components before generating new ones.
2. Extend or compose existing components where appropriate.
3. Never duplicate entire dashboard implementations unnecessarily.
4. Use established design tokens.
5. Adapt imported 21st.dev components to Harvest's design system.
6. Document third-party component licenses.
7. Keep business logic outside generic UI components.
8. Avoid oversized universal components with excessive conditional logic.
9. Build complete functionality, not decorative mock interfaces.
10. Add tests and documentation for reusable components.
11. Preserve consistency across desktop, tablet, and mobile.
12. Explain why a new component is necessary when an existing one appears suitable.

## 17. Testing & Quality Assurance

Implement:

- Component tests
- Wizard navigation and validation tests
- Form submission tests
- Accessibility and keyboard navigation tests
- Responsive layout tests
- Visual regression tests
- Light/dark mode testing
- Permission and error-state testing
- End-to-end workflows for shared components

A shared component change must be tested against representative modules that use it.

## 18. Implementation Order

**Phase 0A — Design Foundation**

Create design tokens, themes, navigation, shared components, documentation, and component showcase.

**Phase 0B — Page & Resource Templates**

Implement dashboards, lists, detail pages, Kanban, calendars, editor shells, settings, and public layouts.

**Phase 0C — Shared Engines**

Build creation wizards, forms, resource lifecycles, access/pricing, publishing controls, and template registry.

**Phase 0D — Reference Implementations**

Validate the architecture using three different modules:

- Social Studio
- CRM
- Communities

These reference implementations should prove that the shared UI systems are reusable before broad module development begins.

Do not require all three full business modules to be completed in Phase 0; implement only the representative workflows needed to validate the shared systems.

Then continue with the established Harvest development roadmap.

## 19. Required Documentation

Create:

- `docs/design-system.md`
- `docs/component-registry.md`
- `docs/page-templates.md`
- `docs/creation-wizard-engine.md`
- `docs/form-engine.md`
- `docs/editor-architecture.md`
- `docs/resource-lifecycle.md`
- `docs/module-contracts.md`
- `docs/frontend-architecture.md`
- `docs/third-party-ui-licenses.md`

Document architecture decisions and update these files as the system evolves.

## 20. Definition of Done

Phase 0 is complete when:

- All reference modules share one application shell.
- Common pages reuse shared templates.
- Community and course creation use the same wizard engine.
- Different resource types reuse the editor shell.
- Access and pricing components work across multiple resource types.
- Public pages use shared layout foundations.
- New components are registered and documented.
- Responsive, accessibility, and visual regression tests pass.
- No redundant dashboard or wizard infrastructure is introduced.
- Shared UI components support real data and functional backend workflows in the reference implementations.

---

## Final Principle

**Harvest must be built as one unified platform, not a collection of disconnected SaaS applications.**

Use shadcn/ui as the foundation, 21st.dev as a component source, and shared templates and engines as the core of the frontend architecture.

Build the reusable system first, validate it with real modules, and then scale it across the complete Harvest platform.

**Build once. Reuse everywhere. Maintain consistency.**
