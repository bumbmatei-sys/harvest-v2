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

Global command/search, a universal creation wizard, EditorShell, generalized form engine remain subsequent bounded work; the initial internal showcase is described below. Do not render inert production controls for them. No new runtime dependencies in this slice.

## Development showcase

Opt in with `HARVEST_UI_SHOWCASE=1 npm run dev`, sign in, then visit `/dev/ui`. The server rejects all production requests, even with the flag set, and returns 404 when not explicitly enabled. There is no production navigation link. The page uses the existing AppShell with no workspace fixtures or domain reads; all example interactions are local synthetic state.

Search/category metadata: `src/lib/ui-showcase.ts`; directly imported examples: `src/components/dev/ui-showcase.tsx`. IDs `actions`, `fields`, `overlays`, `feedback` map to the table below. This is initial high-use coverage, not a claim that every primitive or business composition is interactively demonstrated.

| ID | Contract / demonstrated states | Real consumer examples |
| --- | --- | --- |
| actions | Button variants, ButtonGroup, tooltip, local count/reset, disabled/busy; `responsive` text actions and `icon-responsive` icon actions are 44px below 1024px and 36px desktop | AppShell; shared CRM list toolbar; Connect create-link actions |
| fields | Field/Input/Textarea/NativeSelect/Checkbox/RadioGroup; local required-email validation, invalid/error association, read-only, disabled, optional choices | ContactForm; LandingEditor |
| overlays | Dialog/AlertDialog/Sheet/Popover/Command/DropdownMenu; local selection/removal, keyboard close/focus return | CRM filter builder; Connect link actions |
| feedback | Alert/Empty/Skeleton/Badge/Avatar; local retry/success, no records/results, permission example, selected contrast | CRM list/detail; Connect editor |

### Sizing rules

Keep peer controls aligned in the same action row; widths may differ with their labels. Use canonical variants rather than per-module height overrides. The shared People/Organizations toolbar uses `responsive` text actions and a matching 44/36px search group; Connect primary admin actions retain their existing 44px contract. Dense grid cells, active-filter chips, calendar cells, menu items and checkbox/radio indicators are not blanket resized by this pass; accessible labels, spacing and keyboard access must be checked for their own contexts. No claim of a universal 44px geometry audit of every control.

Primitive shapes remain shadcn-owned source. No new library or external UI source was imported. Business list/filter/editor compositions remain inventory references, not genericized demo implementations. New page/wizard/editor/form engines remain pending.
