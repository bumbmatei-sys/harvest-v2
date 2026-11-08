# Shared UI registry — Phase 0A

Search this inventory and the source before introducing UI. This slice extends existing systems; it does not deliver universal wizard, editor or form engines.

| System | Contract and consumers | States / accessibility | Provenance |
| --- | --- | --- | --- |
| `AppShell` | children, workspaces, selected, email, brandTheme, defaultOpen; CRM and Campaigns/Connect workspace layouts | Permission-filtered navigation, current route, sign-out errors, collapse persistence, mobile Sheet focus trap, skip link, localized labels | Harvest composition; Studio Admin floating/header/spacing reference |
| `ui/sidebar` | SidebarProvider, Sidebar, SidebarInset, trigger, groups; AppShell | Expanded/icon/offcanvas; keyboard toggle, mobile drawer; one shared implementation | Existing shadcn, MIT |
| Theme registry | Existing persisted Harvest/Studio IDs, light/dark; shell, CRM, Connect and offline page | Pre-paint initialization, validated storage override, system mode; both historical IDs now render approved neutral baseline | Studio Admin neutral tokens; old palettes archived in design/legacy-palettes.json |
| `ui/*` | 35 existing shadcn controls; forms, lists and editors | Focus, disabled, validation, loading, menu/dialog keyboard semantics | Existing docs/ui-sources.md and licenses |
| CRM ListPage / RecordLayout | Typed list configuration / detail composition; People and Organizations | URL filters, empty/search/page-empty states, permissions, pagination; server predicates unchanged | Harvest |
| Connect LandingEditor / PublicFrame | Private draft editor and guest layout | Save/publish/conflicts, unsaved navigation, optional purposes, resources without identity | Harvest; no lifecycle moved to generic UI |
| Theme controls / AppearanceForm | Existing workspace and personal preference APIs | Hydration-safe controls, owner/admin write restriction | Harvest |

Global command/search, a universal creation wizard, EditorShell, generalized form engine and internal showcase remain subsequent bounded work. Do not render inert production controls for them. No new runtime dependencies in this slice.
