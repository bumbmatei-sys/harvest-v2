# Shared design system — foundation and adoption plan

Planning recommendation, 8 November 2026. The complete founder-authored [master specification](../design-system.md) is preserved separately. It is an implementation target, not a completion record. This document records how to adopt it in an existing application without duplicating working infrastructure.

## Recommended order

Do a focused foundation pass **before continuing HC-06**, then use HC-06 as a real CRM reference consumer. Do not wait until all Harvest Connect slices are complete, since each new UI would otherwise add more patterns to reconcile. Equally, do not attempt every calendar, wizard, pricing, entitlement and editor engine in a single foundational rewrite.

Recommended first delivery: inventory/registry, established tokens and interaction standards, component showcase, concise form-copy rules, and small shared patterns proven against existing CRM and Connect screens. Add only the page-template pieces immediately needed by those consumers. Build broader engines when their first real workflows can validate them. This staged order does not declare the master specification's full Phase 0 definition of done satisfied.

The recommendation is not approval to implement all Phase 0 work. Agree bounded implementation slices before coding; keep each PR reviewable and record its actual evidence. HC-06 implementation has not started.

## Existing foundations to reuse

Inventory observed at merged main `65894ff830065b7249b1a44a9249a07f937fe289`. Inspect current main before changing these paths.

| Area | Existing source | Adoption rule |
| --- | --- | --- |
| Primitive controls | `src/components/ui/` | shadcn remains the base; reuse before importing or creating controls |
| Themes/tokens | `src/app/globals.css`, `src/lib/theme-registry.ts`, `src/lib/theme.ts` | Consolidate the existing Harvest/Studio and light/dark foundations; do not add a competing palette |
| Authenticated shell | `src/components/app-shell.tsx` | Extend toward typed module configuration; do not create a second shell |
| CRM list/detail patterns | `src/components/crm/list-page.tsx`, `record-layout.tsx`, `list-toolbar.tsx` | Extract small domain-neutral composition points only after examining real consumers |
| Filter interaction | `src/components/crm/filter-builder.tsx` | Existing shadcn Popover/Command is the starting point for the icon-only ReUI-inspired design |
| Draft editor and preview | `src/components/connect-admin/landing-editor.tsx`, `src/components/connect/landing-view.tsx` | Candidate EditorShell consumer; keep publication, revision, consent and QR lifecycle in Connect |
| State conventions | `src/components/crm/list-state.tsx`, `request.ts`, `src/server/crm-list-view.ts` | Reuse URL state, validated server predicates and mutation/error conventions |
| Public pages | `src/components/connect/public-frame.tsx` | Reuse shared foundations while keeping public/authenticated presentation boundaries |
| Design/source records | `docs/design/DESIGN.md`, `docs/design/themes.md`, `docs/ui-sources.md`, `docs/third-party-licenses.md` | Preserve brand decisions and provenance; new docs link to these rather than creating conflicting authorities |

The inventory is not certification of a universal component registry, wizard, form engine, pricing service, global command palette or AI entry point. List missing capabilities honestly; do not show decorative controls for services that do not exist.

## First foundation slice

Requested selectable palettes and theme-delivery checks are in [the theme shortlist](../design/theme-candidates.md). Honey Glow Gold is only a possible official default; preserve the current default until Matei chooses.

1. Create `docs/component-registry.md` with real source paths, purpose, states, typed interfaces, consumers, accessibility and source-license evidence. Inventory before extraction. Make missing and candidate components distinguishable from delivered ones.
2. Document and consolidate existing spacing, typography, surfaces, elevation, responsive behavior, feedback and tokens in the relevant design records. Preserve Harvest branding, default Harvest/optional Studio themes and the existing gold action-color decision. Avoid a visual reset of working modules.
3. Establish concise UI copy as a shared rule: label and useful placeholder by default; no explanation below every field. Specifically remove routine welcome heading/message descriptions in a small reviewed Connect cleanup. Keep necessary consent/privacy notices, actionable validation and consequential guidance. Do not replace descriptions with a proliferation of info icons or tooltips.
4. Build a developer/agent component showcase for real registered controls and representative loading/empty/error/disabled/permission states. Keep it internal/dev-only under an explicit access contract; do not expose private data or an unauthenticated production admin demo.
5. Define small shared page header, list toolbar/filter, form-field, status and editor-layout composition contracts. Prove each extraction against at least two appropriate existing consumers before calling it universal. Shared field wrappers must make descriptions optional, not mandatory.
6. Verify representative existing CRM and Connect journeys, both themes, mobile/tablet/desktop, keyboard/focus, axe, overflow and 44px controls. Keep permission enforcement and business semantics in the owning services. Record screenshots and exact-head review evidence for code changes.

The QR text cleanup was requested before the architecture discussion and remains pending; no product file has been changed by these documentation additions. It belongs in a bounded copy/UI change, not a claim that the whole design system is complete.

## HC-06 integration

The [HC-06 plan](hc-06.md) remains the domain contract. Its source history, automatic verified CRM association, consent, rights, retention and concurrency rules must not move into a generic design component. Shared UI provides an icon-only filter trigger, popover layout, field pickers, rule rows, chips and state feedback; the CRM server remains authoritative for rows, counts, exports and tenant/role checks.

Use [ReUI Filters 10](https://reui.io/components/filters/c-filters-10) as the supplied interaction reference. No visible trigger text and no “Advanced filters” label. Adapt to Harvest's shadcn/token/accessibility patterns; do not copy the demo's client-side result/count semantics into CRM authorization.

## Subsequent shared-system slices

- Deliver the master specification's documentation set as the relevant architecture is settled; do not create empty files or mark engines implemented to satisfy a checklist. Prefer one canonical inventory and linked source/license records over two diverging registries.
- Generalize list/detail/editor/settings/public-page templates through typed composition with representative consumers. Preserve domain-specific lifecycle and publication gates; a common EditorShell must not silently enable autosave or publishing.
- Implement the creation wizard and form engines before building parallel module-specific versions. Reuse validation, conditional steps, autosave/resume, conflict handling and idempotency conventions, with domain-specific completion services and access controls.
- The specification selects React Hook Form + Zod for the shared form architecture. The current package does not install React Hook Form; do not claim it already exists or add it merely for this documentation change. Plan its adoption with a real form-engine slice rather than rewriting every existing simple form at once.
- Use 21st.dev as a discovery source when available, adapt to shadcn/Harvest, and verify exact component licenses before copying code. This document does not install a plugin, import third-party UI or authorize a second design system.
- Validate reference workflows in CRM, Social Studio and Communities as specified, without requiring full module completion or building fake dashboards. Community/course wizard and access/pricing reuse remain full Phase 0 goals; they are not prerequisites invented for a small CRM source-filter UI change.

## Boundaries

No database migration, dependency installation, token/palette change, UI implementation, production activation or outbound provider call is included in this documentation change. Production intake and real invitation delivery remain hard-disabled; all five HC-02 activation decisions remain unapproved. Payment/access architecture does not approve a gift provider, checkout, enrollment or finance activation. PR #16 stays parked. Merge and deployment remain with Matei.
