# UI source register — PR 01a / PR 01b / PR 01c

Owner: Harvest v2 maintainers. Reviewed 2026-11-04. No AGPL source, competitor application code, logos, copy or imagery is included in the product.

| Source | Version/date | License | Dependencies | Changed files | Adaptations |
| --- | --- | --- | --- | --- | --- |
| [shadcn Button registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, Radix Slot, class-variance-authority, clsx, tailwind-merge | `src/components/ui/button.tsx` | Local utility alias; individual Radix package import |
| [shadcn Input registry](https://ui.shadcn.com/r/styles/new-york-v4/input.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, clsx, tailwind-merge | `src/components/ui/input.tsx` | Local utility alias |
| [shadcn Label registry](https://ui.shadcn.com/r/styles/new-york-v4/label.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, Radix Label, clsx, tailwind-merge | `src/components/ui/label.tsx` | Local utility alias; individual Radix package import |
| [shadcn Card registry](https://ui.shadcn.com/r/styles/new-york-v4/card.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, clsx, tailwind-merge | `src/components/ui/card.tsx` | Local utility alias |
| [shadcn Alert registry](https://ui.shadcn.com/r/styles/new-york-v4/alert.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, class-variance-authority, clsx, tailwind-merge | `src/components/ui/alert.tsx` | Local utility alias |
| [shadcn Input OTP registry](https://ui.shadcn.com/r/styles/new-york-v4/input-otp.json) | New York v4 registry via shadcn CLI 4.23.0, retrieved 2026-11-04 | MIT | React, input-otp, lucide-react, clsx, tailwind-merge | `src/components/ui/input-otp.tsx`, `src/app/sign-in/page.tsx` | Local utility alias; six numeric slots, one-time-code autofill, native paste, linked label/status/error and invalid slot styling |
| [shadcn Field registry](https://ui.shadcn.com/r/styles/new-york-v4/field.json) | New York v4 registry via shadcn CLI 4.23.0, retrieved 2026-11-04 | MIT | React, Label, Separator, class-variance-authority, clsx, tailwind-merge | `src/components/ui/field.tsx`, `src/app/sign-in/page.tsx`, `src/components/workspace-form.tsx` | Local utility alias; replaces manually spaced label/input groups |
| [shadcn Empty registry](https://ui.shadcn.com/r/styles/new-york-v4/empty.json) | New York v4 registry via shadcn CLI 4.23.0, retrieved 2026-11-04 | MIT | React, class-variance-authority, clsx, tailwind-merge | `src/components/ui/empty.tsx`, `src/app/workspaces/page.tsx` | Local utility alias; workspace empty state with Harvest copy |
| [shadcn Button Group registry](https://ui.shadcn.com/r/styles/new-york-v4/button-group.json) | New York v4 registry via shadcn CLI 4.23.0, retrieved 2026-11-04 | MIT | React, Radix Slot, Separator, class-variance-authority, clsx, tailwind-merge | `src/components/ui/button-group.tsx`, `src/app/sign-in/page.tsx` | Local utility alias; individual Radix package import; named sign-in action group |
| [shadcn Separator registry](https://ui.shadcn.com/r/styles/new-york-v4/separator.json) | New York v4 registry via shadcn CLI 4.23.0, retrieved 2026-11-04 | MIT | React, Radix Separator, clsx, tailwind-merge | `src/components/ui/separator.tsx` | Local utility alias; individual Radix package import; dependency of Field and Button Group |
| [Geist fonts](https://github.com/vercel/geist-font) | npm geist 1.9.0 (package-lock.json) | OFL-1.1 | next/font/local | `src/app/layout.tsx`, `src/app/globals.css` | Self-hosted sans font; no runtime Google Fonts request |
| Harvest-owned forms and screen composition | 2026-11-04 | Private repository code | shadcn primitives above, Better Auth client, Next App Router | `src/app/sign-in/page.tsx`, `src/app/workspaces/*`, `src/components/workspace-form.tsx` | Original content and composition |
| [Local design specification](design/DESIGN.md), local reference screenshots, read-only v1 `docs/prd/screenshots/16-ui-system` | 2026-11-04 | Visual reference only; no imported application source/assets | None | `src/app/globals.css`, sign-in typography and spacing | Neutral surface/text tokens, 10px controls, 16px cards, Geist and restrained layout; Harvest gold with dark text |

PR 01b adds the selectable theme system, sidebar shell and contact screens. This foundation uses CSS variables for primitives so those additions do not require brand-specific conditionals. MIT and OFL notices are preserved under `docs/licenses/`; the full dependency inventory is in [third-party-licenses.md](third-party-licenses.md).

## PR 01b sources

Owner: Harvest v2 maintainers. Retrieved/reviewed 2026-11-04. Registry revision is pinned by the source-owned files committed with package-lock.json.

| Source | Version/date | License | Dependencies | Changed files | Adaptations |
| --- | --- | --- | --- | --- | --- |
| [Official shadcn sidebar](https://ui.shadcn.com/r/styles/new-york-v4/sidebar.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/sidebar.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn sheet](https://ui.shadcn.com/r/styles/new-york-v4/sheet.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/sheet.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn separator](https://ui.shadcn.com/r/styles/new-york-v4/separator.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/separator.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn tooltip](https://ui.shadcn.com/r/styles/new-york-v4/tooltip.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/tooltip.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn skeleton](https://ui.shadcn.com/r/styles/new-york-v4/skeleton.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/skeleton.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn table](https://ui.shadcn.com/r/styles/new-york-v4/table.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/table.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn badge](https://ui.shadcn.com/r/styles/new-york-v4/badge.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/badge.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn select](https://ui.shadcn.com/r/styles/new-york-v4/select.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/select.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn dialog](https://ui.shadcn.com/r/styles/new-york-v4/dialog.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/dialog.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn textarea](https://ui.shadcn.com/r/styles/new-york-v4/textarea.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/textarea.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn tabs](https://ui.shadcn.com/r/styles/new-york-v4/tabs.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/components/ui/tabs.tsx` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Official shadcn use-mobile](https://ui.shadcn.com/r/styles/new-york-v4/use-mobile.json) | New York v4, 2026-11-04 | MIT | React, radix-ui, lucide-react, CVA, clsx/tailwind-merge as applicable | `src/hooks/use-mobile.ts` | Local import aliases; 1024px sidebar breakpoint, stable skeleton and external-store media hook; one main landmark; semantic overlay/surface tokens |
| [Lucide](https://github.com/lucide-icons/lucide) | Exact npm version in lockfile, 2026-11-04 | ISC | React | shell and contacts components | Standard line icons; Wheat icon with Harvest text |
| [Inter / Fontsource](https://github.com/fontsource/font-files/tree/main/fonts/google/inter) | Exact npm version in lockfile, 2026-11-04 | OFL-1.1 | CSS/webfonts | `src/app/layout.tsx`, `src/app/globals.css` | Self-hosted Latin 400/500/600 for Harvest |
| [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css) | Exact npm version in lockfile, 2026-11-04 | MIT | Tailwind | `src/app/globals.css` | shadcn animation utilities; reduced-motion override |
| Read-only v1 `docs/prd/screenshots/06-crm/crm-001`, `crm-007` and `16-ui-system/shell-027` on main | Viewed 2026-11-04 | Layout/feel reference only | None | App shell, contacts list and dialog | No code, image, text or logo copied or redistributed |

## Round 2 registry additions

Added with `npx shadcn@latest add` (New York v4, 2026-11-04), MIT: [radio-group](https://ui.shadcn.com/r/styles/new-york-v4/radio-group.json), [pagination](https://ui.shadcn.com/r/styles/new-york-v4/pagination.json), [avatar](https://ui.shadcn.com/r/styles/new-york-v4/avatar.json), [dropdown-menu](https://ui.shadcn.com/r/styles/new-york-v4/dropdown-menu.json), [empty](https://ui.shadcn.com/r/styles/new-york-v4/empty.json), [alert-dialog](https://ui.shadcn.com/r/styles/new-york-v4/alert-dialog.json), [input-group](https://ui.shadcn.com/r/styles/new-york-v4/input-group.json), and [field](https://ui.shadcn.com/r/styles/new-york-v4/field.json). Files are the corresponding `src/components/ui/*.tsx`. They use the existing React, Radix, Lucide and CVA dependencies. Adapted the CLI's bare `cn` import to `@/lib/utils`; no new runtime dependency is required. Existing primitives were preserved when the CLI prompted for replacement. DropdownMenuContent exposes Radix's optional portal container so account-menu content stays inside its navigation landmark, including the mobile sheet. Button's destructive foreground now reads a semantic token for contrast in both color modes. The account composition follows the official shadcn NavUser pattern.

[Round 2 visual reference mapping and consent/erasure behavior](acceptance/pr01b-round2.md).

## PR 02 file uploads

Retrieved 2026-11-04 from the official MIT-licensed New York v4 registry. The existing shadcn MIT notice applies.

| Source | Dependencies | Changed file | Adaptation |
| --- | --- | --- | --- |
| [shadcn progress](https://ui.shadcn.com/r/styles/new-york-v4/progress.json) | React, local cn, Radix Progress | src/components/ui/progress.tsx | Local utility alias; individual Radix package import; pass value to accessible root |
| [shadcn table](https://ui.shadcn.com/r/styles/new-york-v4/table.json) | React, local cn | src/components/ui/table.tsx | Local utility alias |
| [shadcn badge](https://ui.shadcn.com/r/styles/new-york-v4/badge.json) | React, local cn, Radix Slot, class-variance-authority | src/components/ui/badge.tsx | Local utility alias; individual Radix package import |
| [shadcn native-select](https://ui.shadcn.com/r/styles/new-york-v4/native-select.json) | React, local cn, Lucide icons | src/components/ui/native-select.tsx | Local utility alias |

Round 2 reuses the existing official Empty, Alert and Field components for the
file empty state, viewer/progress/result notices and upload form fields.

Upload control, file list and Files page are Harvest-owned compositions of these and existing shadcn primitives. No additional application block or competitor source was copied.

## Round 3 registry additions

Added via `npx shadcn@latest add item calendar popover --yes`, New York v4, 2026-11-04 (MIT): [Item](https://ui.shadcn.com/r/styles/new-york-v4/item.json), [Calendar](https://ui.shadcn.com/r/styles/new-york-v4/calendar.json), [Popover](https://ui.shadcn.com/r/styles/new-york-v4/popover.json). Components live in `src/components/ui/`; `cn` imports use `@/lib/utils`. Existing Button and Separator were preserved. Calendar uses react-day-picker/date-fns (MIT, exact versions in package-lock.json); Popover uses the existing Radix package. The form supplies an accessible popover name and numeric day labels matching visible content. The date/time form is a Harvest composition of Calendar, Popover, Button, Field and Input. RadioGroupItem's border reads muted-foreground to meet 3:1 contrast in all four palettes. See [round 3 evidence](acceptance/pr01b-round3.md).

## 01b follow-up adaptations

The workspace switcher and static brand header reuse the existing official SidebarMenu, SidebarMenuItem, SidebarMenuButton, DropdownMenu, Avatar and Tooltip components. TooltipContent now exposes Radix Portal’s optional `container` prop, matching the existing DropdownMenuContent adaptation, so workspace tooltip text remains inside the named sidebar landmark. No new component or dependency was added. The navigation landmark excludes footer controls. See [the follow-up acceptance record](acceptance/pr01b-followups.md).

## CRM-01/02 (People and Companies)

Owner: Harvest v2 maintainers. Reviewed 2026-11-05.

| Source | Version/date | License | Dependencies | Changed files | Adaptations |
| --- | --- | --- | --- | --- | --- |
| shadcn Command, from [`shadcn-ui/ui` `apps/v4/registry/new-york-v4/ui/command.tsx`](https://github.com/shadcn-ui/ui/blob/8a3536678a528cc012b9e62484290e79d0be410f/apps/v4/registry/new-york-v4/ui/command.tsx) | commit `8a3536678a528cc012b9e62484290e79d0be410f` (2026-11-04) | MIT (existing notice in `licenses/shadcn-ui-MIT.txt`) | `cmdk` 1.1.1 (MIT), existing Dialog and Lucide | `src/components/ui/command.tsx` | Only the import aliases changed (`cn` → `@/lib/utils`, dialog → `@/components/ui/dialog`). It was copied from the registry's source repository because `ui.shadcn.com` is blocked by this environment's egress policy, so `npx shadcn add command` could not run. The content is the same New York v4 registry file. |
| shadcn Tabs (existing file) | — | MIT | — | `src/components/ui/tabs.tsx` | Inactive trigger text changed from `text-foreground/60` to the semantic `text-muted-foreground` to meet AA contrast on Harvest surfaces (axe `color-contrast`), as earlier PRs did for the radio border and destructive foreground. |
| Harvest-owned CRM compositions | 2026-11-05 | Private repository code | Existing shadcn Table, Card, Badge, Avatar, Button, Input, Textarea, Dialog, DropdownMenu, Popover, Command, Tabs, Item, Empty, Alert, Pagination, Skeleton, Field and InputGroup | `src/components/crm/*`, `src/app/workspaces/[tenantId]/crm/**`, `src/components/contact-form.tsx` | Original compositions: view bar, inline field, record title, record picker, activity timeline, skeletons. |
| Twenty CRM (`twentyhq/twenty`, commit `8b622440`) | read 2026-11-05 | AGPL-3.0 (front-end and server packages read) | None | None | **Behaviour reference only.** No code, styles, copy, icons or assets were copied, translated or renamed. See [research notes](research/twenty-crm-reference.md). `twenty-ui` (MIT) was not used. |
| Harvest v1 (`bumbmatei-sys/Harvest-agent`) | read 2026-11-05 | Private | None | None | Workflow lessons only (one CRM per tenant, no email-only identity, filter/export agreement, server-side erasure checks). No Firestore models or code. |

## CRM-03 (custom fields, saved views, filters, grid)

Owner: Harvest v2 maintainers. Reviewed 2026-11-05.

| Source | Version/date | License | Dependencies | Changed files | Adaptations |
| --- | --- | --- | --- | --- | --- |
| shadcn Checkbox, from [`shadcn-ui/ui` `apps/v4/registry/new-york-v4/ui/checkbox.tsx`](https://github.com/shadcn-ui/ui/blob/8a3536678a528cc012b9e62484290e79d0be410f/apps/v4/registry/new-york-v4/ui/checkbox.tsx) | commit `8a3536678a528cc012b9e62484290e79d0be410f` (2026-11-04) | MIT (existing notice in `licenses/shadcn-ui-MIT.txt`) | existing `radix-ui` package, Lucide | `src/components/ui/checkbox.tsx` | Only the `cn` import alias changed (`@/lib/utils`). Copied from the registry source repository for the same reason as Command (CRM-02): `ui.shadcn.com` is blocked by this environment's egress policy. |
| Harvest-owned CRM-03 compositions | 2026-11-05 | Private repository code | Existing shadcn Table, Card, Badge, Button, ButtonGroup, Input, InputGroup, NativeSelect, Checkbox, RadioGroup, Label, Dialog, AlertDialog, DropdownMenu, Popover, Command, Tabs, Empty, Alert, Field, Separator, Textarea | `src/components/crm/{list-state,list-toolbar,view-menu,filter-builder,columns-menu,record-grid,list-page,list-parts,custom-fields,field-settings}.tsx`, `src/app/workspaces/[tenantId]/crm/settings/fields/page.tsx` | Original compositions. No new npm dependency. |
| Twenty CRM (`twentyhq/twenty`, commit `4635b83e`) | read 2026-11-05 | AGPL-3.0 | None | None | **Behaviour reference only** (operand sets, view visibility, update-view button group, cell focus/hotkeys). No code, styles, copy, icons or assets were copied, translated or renamed. See [research notes](research/twenty-crm-reference.md#crm-03-fields-saved-views-filters-and-the-grid). |

## CRM-04 (pipelines, deals and the board)

Owner: Harvest v2 maintainers. Reviewed 2026-11-06.

| Source | Version/date | License | Dependencies | Changed files | Adaptations |
| --- | --- | --- | --- | --- | --- |
| [`@dnd-kit/core`](https://github.com/clauderic/dnd-kit) | 6.3.1 (npm, exact pin) | MIT (checked in the published `package.json` and `LICENSE`) | `@dnd-kit/accessibility` 3.1.1 (MIT), `@dnd-kit/utilities` 3.2.2 (MIT), `tslib` 2.9.1 (0BSD) | `src/components/crm/deals/deal-board.tsx` | Used as a library, not copied: `DndContext`, `useDraggable`, `useDroppable`, `DragOverlay` and `PointerSensor`. Screen-reader instructions and announcements are Harvest i18n messages. The keyboard stage move (Shift+←/→) is Harvest's own handler using the same move API. No sortable preset, and no AGPL board widget. Twenty also uses dnd-kit (`@dnd-kit/react`), but nothing was taken from its board code. |
| Harvest-owned CRM-04 compositions | 2026-11-06 | Private repository code | Existing shadcn Card, Badge, Button, ButtonGroup, Dialog, AlertDialog, DropdownMenu, Popover, Command (RecordPicker), NativeSelect, RadioGroup, Label, Input, InputGroup, Textarea, Field, Table, Empty, Alert, Skeleton | `src/components/crm/deals/*`, `src/app/workspaces/[tenantId]/crm/{pipelines,deals,settings/pipelines}/**` | Original compositions. No new shadcn registry files. Stage colours map to existing theme tokens (`muted-foreground`, `primary`, `success`, `warning`, `destructive`). |
| Twenty CRM (`twentyhq/twenty`, commit `4635b83e`) | read 2026-11-06 | AGPL-3.0 | None | None | **Behaviour reference only**: opportunity fields, the "By Stage" kanban grouping, the SUM aggregate in column headers, card fields, drop handling and its race note. No code, styles, copy, icons or assets were copied, translated or renamed. See [research notes](research/twenty-crm-reference.md#crm-04-pipelines-stages-deals-and-the-board). |

## HC-03 (campaign QR links)

Owner: Harvest v2 maintainers. Reviewed 2026-11-07.

| Source | Version/date | License | Dependencies | Changed files | Adaptations |
| --- | --- | --- | --- | --- | --- |
| Harvest-owned HC-03 compositions | 2026-11-07 | Private repository code | Existing shadcn Card, Badge, Button, Dialog, AlertDialog, DropdownMenu, Field, Input, NativeSelect, Alert, Empty | `src/components/connect-admin/*`, `src/components/connect/landing-view.tsx`, `src/app/workspaces/[tenantId]/campaigns/[campaignId]/connect/**`, `src/app/s/**` | Original compositions. No new shadcn registry files. The QR is drawn as inline SVG paths from the same renderer as the downloads (no injected markup). |
| Local Eden reference screenshots `docs/design/reference/26-editor-publish-checklist.jpg` and `28-editor-publish-share-links.jpg` | viewed 2026-11-07 | Visual reference only | None | None | Layout/feel only: a "Before you publish" checklist and share rows with a monospace link, copy and open actions. No code, copy, icons or assets copied; no vendor name in the product. |
| [`qrcode`](https://github.com/soldair/node-qrcode) | 1.5.4 (exact pin) | MIT | see [third-party licenses](third-party-licenses.md#hc-03-additions-2026-11-07) | `src/server/connect-qr.ts` | Library use for the module matrix only (error correction Q). |
