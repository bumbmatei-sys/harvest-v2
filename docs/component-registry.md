# Shared UI registry — Phase 0A

Search this inventory and the source before introducing UI. This slice extends existing systems; it does not deliver universal wizard, editor or form engines.

| System | Contract and consumers | States / accessibility | Provenance |
| --- | --- | --- | --- |
| `AppShell` | children, workspaces, selected, email, brandTheme, defaultOpen; CRM and Campaigns/Connect workspace layouts | Navigation rendered from `src/lib/navigation.ts` (permission- and audience-aware), current route, sign-out errors, collapse persistence, mobile Sheet focus trap, skip link, localized labels | Harvest composition; Studio Admin floating/header/spacing reference |
| `AudienceField` / `MinistrySettingsForm` | `src/components/audience-field.tsx` (shared ministry-type RadioGroup: Church, Ministry or nonprofit, Evangelist or missionary); consumers: ministry creation form and Ministry settings page | Required at creation; disabled read-only for members and viewers with the owner/admin notice; 44px rows below `lg`; no helper text | Harvest |
| Navigation registry | `src/lib/navigation.ts`: `navEntries`, `resolveNavigation({ tenantId, role, audience, pathname })`, `sectionLabel(pathname, audience)`; consumer: AppShell sidebar and breadcrumb | Items filtered by `can()` (shared `src/lib/permissions.ts`) and optional audiences; per-audience label overrides; groups with no items are omitted; no audience-specific entries ship yet | Harvest |
| `ui/sidebar` | SidebarProvider, Sidebar, SidebarInset, trigger, groups; AppShell | Expanded/icon/offcanvas; keyboard toggle, mobile drawer; one shared implementation | Existing shadcn, MIT |
| Theme registry | Existing persisted Harvest/Studio IDs, light/dark; shell, CRM, Connect and offline page | Pre-paint initialization, validated storage override, system mode; both historical IDs now render approved neutral baseline | Studio Admin neutral tokens; old palettes archived in design/legacy-palettes.json |
| `ui/*` | 36 shadcn controls in `src/components/ui/` (including `switch.tsx`, consumers below); forms, lists and editors | Focus, disabled, validation, loading, menu/dialog keyboard semantics | Existing docs/ui-sources.md and licenses |
| CRM ListPage / RecordLayout | Typed list configuration / detail composition; People and Organizations | URL filters, empty/search/page-empty states, permissions, pagination; server predicates unchanged | Harvest |
| Connect LandingEditor / PublicFrame | Private draft editor and guest layout | Save/publish/conflicts, unsaved navigation, optional purposes, resources without identity | Harvest; no lifecycle moved to generic UI |
| Theme controls / AppearanceForm | Existing workspace and personal preference APIs | Hydration-safe controls, owner/admin write restriction | Harvest |

Global command/search, a universal creation wizard and a generalized form engine remain subsequent bounded work (EditorShell and the question-form components are delivered with one consumer each; see the next section); the initial internal showcase is described below. Do not render inert production controls for them. No new runtime dependencies in this slice.

## Shared systems delivered after Phase 0A

Verified against `main` at `f047440` (12 Nov 2026). "Delivered" means present in `main`; one consumer means not yet proven reusable. Phase 0 items refer to [the inventory](plans/design-system-inventory-2026-11-12.md).

| System | Status | Path | Consumers | Phase 0 item |
| --- | --- | --- | --- | --- |
| `EditorShell` | Delivered (#58). Header with title/status/actions, step nav, centre settings, preview aside (sheet below `xl`); no autosave or publish logic | `src/components/editor/editor-shell.tsx` | One: `communities/community-editor.tsx` (Connect landing editor does not use it) | 0C EditorShell; needs a second consumer before it counts as universal |
| `useUnsavedChangesGuard` | Delivered (#58, extracted from Connect). In-app link, history and tab-close guard | `src/hooks/use-unsaved-changes-guard.ts` | `communities/community-editor.tsx`, `connect-admin/landing-editor.tsx` | 0C EditorShell / mutation conventions |
| Typed navigation registry | Delivered (#51); see the Navigation registry row above | `src/lib/navigation.ts` | `app-shell.tsx` | 0A AppShell; 0C navigation registration only |
| `RichTextEditor` / `RichTextView` | Delivered (#62). Tiptap editor with allow-listed formats (JSON out) and a matching renderer. Tiptap packages in `package.json`; license row not yet in `docs/ui-sources.md` | `src/components/rich-text/rich-text-editor.tsx`, `rich-text-view.tsx` | Editor: `forum/post-composer.tsx`. View: `app/communities/[slug]/(member)/posts/[postId]/page.tsx` | 0C rich text |
| `QuestionListEditor` / `QuestionFields` | Delivered (#60). Owner-side question builder and respondent renderer; local state, no conditional logic | `src/components/forms/question-list-editor.tsx`, `question-fields.tsx` | Editor: `communities/community-editor.tsx`. Renderer: `community-editor.tsx`, `application-actions.tsx`, `join-dialog.tsx` | 0C shared form builder plus public renderer (partial; Communities only) |
| `RulesListEditor` | Delivered (#60). String-list add/remove | `src/components/communities/rules-list-editor.tsx` | `communities/community-editor.tsx` | None yet; candidate for a shared list editor |
| `ForumCategoriesEditor` | Delivered (#62). Persisted, reorderable list with per-row save | `src/components/communities/forum-categories-editor.tsx` | `communities/community-editor.tsx` (Channels step) | None yet; candidate for a shared list editor |
| `CommunityShell` | Delivered (#62). Member layout: icon rail, bottom bar on phones; routes marked "soon" are disabled | `src/components/communities/community-shell.tsx` | `app/communities/[slug]/(member)/layout.tsx` | Module-specific; not a shared shell |
| `ui/switch` | Delivered shadcn primitive | `src/components/ui/switch.tsx` | `forum/post-composer.tsx`, `communities/community-editor.tsx`, `communities/forum-categories-editor.tsx`, `forms/question-list-editor.tsx` | 0A primitives |
| Shared CRM filters (#44) | Delivered; see the Shared CRM filters section below. `source-rule-editor.tsx` adds HC-06 source include/exclude rules inside the same panel | `src/components/crm/filter-builder.tsx`, `source-rule-editor.tsx`, `list-toolbar.tsx`, `list-page.tsx` | People and Organizations lists | 0C filters |
| CRM list/record parts | Delivered, CRM-specific: `record-layout.tsx`, `record-grid.tsx`, `record-picker.tsx`, `inline-field.tsx`, `view-menu.tsx`, `marketing-badge.tsx`, `deals/stage-badge.tsx` | `src/components/crm/` | CRM modules (`record-picker.tsx` also in deals and tasks) | Inventory B5 (status badges); not generic |
| Dev showcase | Delivered, dev-only; see Development showcase below | `src/components/dev/ui-showcase.tsx`, `src/lib/ui-showcase.ts` | `/dev/ui` | 0A registry |
| `ModerationPanel`, `ReportDialog`, `BannedWordsEditor` | **On unmerged PR #63** (`origin/c12a-community-moderation`); not in `main` | `src/components/communities/moderation-panel.tsx`, `report-dialog.tsx`, `banned-words-editor.tsx` (branch only) | Moderation page only | Inventory B1, B3, B4 |

Proposed, not delivered: shared `DataTable` + `EmptyState`, `StatusBadge`, `ConfirmDialog` (the leave-page AlertDialog is still written inline in `landing-editor.tsx` and `community-editor.tsx`), `ListEditor`, a neutral `useRequest` (`useCrmRequest` in `crm/request.ts` is still imported by non-CRM code), wizard engine, form engine. See inventory section 3.

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

## Shared CRM filters

`crm/filter-builder.tsx` is the bounded shared filter panel used through `ListToolbar` / `ListPage` by People and Organizations. It composes existing shadcn Popover, Tooltip, Command, fields, native selects, checkboxes and buttons. Draft conditions are local until Apply; Cancel/Escape/outside dismissal discard them. Active chips edit/remove conditions; after three chips, +N opens the same panel. Existing `MAX_FILTERS`, per-type operands, validation and URL/saved-view/server contracts remain authoritative. No Source fields are advertised before HC-06. Contact permissions currently means the existing email-marketing field only. No universal filter engine, new dependency, schema or source-provenance domain is introduced.

Controls use 44px phone/tablet targets and compact desktop variants. `stateToParams` emits an explicit empty search key with a view ID so clearing the final saved condition cannot silently reapply saved state. The original server fallback/permission policy is unchanged. Browser evidence and verification limits: [shared filter acceptance](acceptance/crm-filters.md). No external source was copied; ReUI is an interaction reference only.

## Personal account profile (HC-08)

`components/account-profile-form.tsx` (`AccountProfileForm`) is the single form for `/account/onboarding` (mode `onboarding`) and `/account/profile` (mode `profile`): name, language, optional city, and in onboarding the four-option path group. Composes shadcn Field, Input, Select, RadioGroup, Badge, Alert and Button inside `PublicFrame personal`. Only `Explore later` is selectable; the other three options are disabled with a "Coming soon" badge until their destinations exist. Server rules live in `server/account-profile.ts`; storage is the owner-only `user_profiles` table (migration 0034).
