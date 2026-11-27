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
| [`@dnd-kit/core`](https://github.com/clauderic/dnd-kit) | 6.3.1 (npm, exact pin) | MIT (checked in the published `package.json` and `LICENSE`) | `@dnd-kit/accessibility` 3.1.1 (MIT), `@dnd-kit/utilities` 3.2.2 (MIT), `tslib` 2.9.1 (0BSD) | `src/components/crm/deals/deal-board.tsx`, `src/components/board/kanban-board.tsx` (shared board since 26 Nov) | Used as a library, not copied: `DndContext`, `useDraggable`, `useDroppable`, `DragOverlay` and `PointerSensor`. Screen-reader instructions and announcements are Harvest i18n messages. The keyboard stage move (Shift+←/→) is Harvest's own handler using the same move API. No sortable preset, and no AGPL board widget. Twenty also uses dnd-kit (`@dnd-kit/react`), but nothing was taken from its board code. |
| Harvest-owned CRM-04 compositions | 2026-11-06 | Private repository code | Existing shadcn Card, Badge, Button, ButtonGroup, Dialog, AlertDialog, DropdownMenu, Popover, Command (RecordPicker), NativeSelect, RadioGroup, Label, Input, InputGroup, Textarea, Field, Table, Empty, Alert, Skeleton | `src/components/crm/deals/*`, `src/app/workspaces/[tenantId]/crm/{pipelines,deals,settings/pipelines}/**` | Original compositions. No new shadcn registry files. Stage colours map to existing theme tokens (`muted-foreground`, `primary`, `success`, `warning`, `destructive`). |
| Twenty CRM (`twentyhq/twenty`, commit `4635b83e`) | read 2026-11-06 | AGPL-3.0 | None | None | **Behaviour reference only**: opportunity fields, the "By Stage" kanban grouping, the SUM aggregate in column headers, card fields, drop handling and its race note. No code, styles, copy, icons or assets were copied, translated or renamed. See [research notes](research/twenty-crm-reference.md#crm-04-pipelines-stages-deals-and-the-board). |

## HC-03 (campaign QR links)

Owner: Harvest v2 maintainers. Reviewed 2026-11-07.

| Source | Version/date | License | Dependencies | Changed files | Adaptations |
| --- | --- | --- | --- | --- | --- |
| Harvest-owned HC-03 compositions | 2026-11-07 | Private repository code | Existing shadcn Card, Badge, Button, Dialog, AlertDialog, DropdownMenu, Field, Input, NativeSelect, Alert, Empty | `src/components/connect-admin/*`, `src/components/connect/landing-view.tsx`, `src/app/workspaces/[tenantId]/campaigns/[campaignId]/connect/**`, `src/app/s/**` | Original compositions. No new shadcn registry files. The QR is drawn as inline SVG paths from the same renderer as the downloads (no injected markup). |
| Local Eden reference screenshots `docs/design/reference/26-editor-publish-checklist.jpg` and `28-editor-publish-share-links.jpg` | viewed 2026-11-07 | Visual reference only | None | None | Layout/feel only: a "Before you publish" checklist and share rows with a monospace link, copy and open actions. No code, copy, icons or assets copied; no vendor name in the product. |
| [`qrcode`](https://github.com/soldair/node-qrcode) | 1.5.4 (exact pin) | MIT | see [third-party licenses](third-party-licenses.md#hc-03-additions-2026-11-07) | `src/server/connect-qr.ts` | Library use for the module matrix only (error correction Q). |

## Phase 0A — Studio Admin shell baseline

Pinned source: `arhamkhnz/next-shadcn-admin-dashboard` at `05b2b927f556e0dce18c9023afa23f8219f39c93`, inspected 2026-11-08. MIT, copyright 2024 Mohammed Arham Khan; full notice in `docs/licenses/studio-admin-MIT.txt`.

| Inspected source | Harvest adaptation |
| --- | --- |
| `src/app/globals.css` | Neutral light/dark semantic scale mapped to existing registry slots, Geist, 10px base radius; neutral OKLCH values represented as rounded sRGB hex for existing contrast tooling |
| `src/app/(main)/dashboard/layout.tsx` | 48px bordered header, 16/24px content gutters; retain full-width Harvest content |
| `src/app/(main)/dashboard/_components/sidebar/{app-sidebar,nav-main,nav-user}.tsx`, `src/components/ui/sidebar.tsx` | Floating variant on existing shadcn Sidebar, icon collapse and mobile Sheet; retain Harvest workspace/account/permission logic |
| `src/app/(main)/{chat,mail}/` | Inspected as future composition references only; no copied inbox, mock messages or provider capability claims |

Upstream dependencies inspected in package.json: Next/React/Tailwind/shadcn/Radix/Geist/Lucide overlap Harvest. Zustand, next-themes, table/form/chart engines and the rest of the template dependency graph are not imported. No upstream application, auth, telemetry, sample data, logos or imagery copied. Existing shadcn sidebar implementation retained rather than replacing it with upstream's current primitive stack.

## Communities PR 4b sources (rich text)

| Source | Version/date | License | Dependencies | Changed files | Adaptations |
| --- | --- | --- | --- | --- | --- |
| [Tiptap](https://github.com/ueberdosis/tiptap) (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`) | 3.33.1 (package-lock.json), added 2026-11-11 in #62 | MIT | ProseMirror (MIT) via `@tiptap/pm` | `src/components/rich-text/rich-text-editor.tsx` | Restricted extension set (headings 2–3, bold, italic, strike, lists, quote, link with http/https/mailto); JSON output re-sanitised on the server by `src/lib/rich-text.ts`; display uses a React renderer, never HTML |

## Shadcn UI Kit provenance

Plan: [shadcnuikit-adoption.md](plans/shadcnuikit-adoption.md). Kit PR 1 adopts four free items, Kit PR 2 two premium reference items, Kit PR 3 four reference items, two premium and two free, and Kit PR 4 four reference items, two premium and two free, plus one hand-written piece (the founder owns the licence and public-repository consequences, CLAUDE.md), all approved by the founder on 2026-11-16 ("Approved all" for PR 1 and 2; "Ok" to the recommended list for PR 3; "I approve them" for PR 4; requests in the PR descriptions). No registry JSON or token is in the repository: each adopted item is a small converted showcase example under `src/components/dev/`, and the primitives under `src/components/ui/` are hand-written (see below).

Rule (enforced by `tests/unit/ui-provenance.test.ts`): every kit-derived file starts with the header below **and** is listed in `kitProvenance` in `src/lib/ui-provenance.ts` (item name, free or premium, registry retrieval date, install date, founder approver and approval date, local changes, destination files). Add the same row to the table here and record new dependencies in `third-party-licenses.md`.

`/** Derived from Shadcn UI Kit item <name> (<free|premium>), registry retrieved <date>, approved <date> (<PR>). Local changes: docs/ui-sources.md. */`

| Registry item | Free/premium | Retrieved | Installed | Approved (founder) | Files | Local changes |
| --- | --- | --- | --- | --- | --- | --- |
| `toast1` | free | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/dev/kit-toast-example.tsx` | The kit demo (a button showing a toast with description and Undo action) kept as the showcase example with catalogue copy. The Sonner adapter `src/components/ui/sonner.tsx` and helper `src/lib/toast.ts` are Harvest-written: theme tokens instead of `next-themes`, catalogue strings, 44px action and close targets, polite live region with a catalogue label. Alternatives not chosen: `toast2`, `toast10`. |
| `spinner1` | free | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/dev/kit-spinner-example.tsx` | The demo (one small spinner) widened to the three Harvest sizes. Primitive hand-written. Alternatives not chosen: `spinner2`, `spinner10`. |
| `scroll-area1` | free | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/dev/kit-scroll-area-example.tsx` | The demo (fixed-height list with separators) kept with catalogue rows instead of version-tag sample data; focusable region viewport. Primitive hand-written. Alternatives not chosen: `scroll-area2`, `scroll-area4`. |
| `drawer1` | free | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/dev/kit-bottom-sheet-example.tsx` | **Visual reference only**; no kit code and no drawer library (`vaul` is not an approved dependency). Built on Harvest's own `Sheet` bottom side. Alternatives not chosen: `drawer2`, `drawer6`. |
| `dashboard-shell8` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/app-shell.tsx` | **Visual reference only** (Kit PR 2); no kit code copied. Harvest keeps `AppShell`, the floating sidebar and the typed navigation registry. Only the optional header slots (page actions, page search) follow the item. Not chosen: `dashboard-shell1`, `sidebar-layout`, `dashboard-shell2`, `dashboard-shell3`. |
| `dashboard-dropdown7` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/ministry-switcher.tsx` | **Pattern reference only** (Kit PR 2); no kit code copied. Ministry list with search, initials marks, role and member count, check on the current one, built inside the account menu's `DropdownMenu` (the kit item uses Popover and Command). Not chosen: `dashboard-dropdown1` to `dashboard-dropdown6`, `dashboard-dropdown8` to `dashboard-dropdown10`. |
| `tables14` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/data-table.tsx`, `src/components/communities/moderation-panel.tsx` | **Visual reference only** (Kit PR 3); no kit code copied and no TanStack Table (the kit item depends on it; no new dependency is approved). `DataTable` is a presentational shell on the existing `Table`, `Tabs`, `Checkbox`, `Skeleton` and `DropdownMenu`: toolbar slots, status tabs with counts, sortable headers (`aria-sort`), optional row selection with a bulk bar, loading, empty and error slots, a pagination slot and a card list below 768px. Kit demo data, CSV export and filters are not used. Not chosen: `tables5`, `tables7`. Kit PR 7 also uses it for the community moderation queue (`src/components/communities/moderation-panel.tsx`): the five moderation tables on the shell with type and appeal-state tabs; no row selection or bulk actions (no bulk moderation endpoint). |
| `empty-state15` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/empty-state.tsx` | **Visual reference only** (Kit PR 3); no kit code copied. `EmptyState` composes the existing `Empty`: icon, title, optional description, one primary action and an optional secondary one, compact and standard sizes. Not chosen: `empty-state1`, `empty-state2`, `empty1`. |
| `badge1` | free | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/status-badge.tsx` | **Visual reference only** (Kit PR 3); no kit code copied. `StatusBadge` wraps the existing `Badge` with a typed tone map (neutral, success, warning, danger, info, pending) on theme tokens and an optional dot; callers map statuses to tones with `defineStatusTones` (`src/lib/status-tone.ts`). Not chosen: `badge2`, `badge6`. |
| `alert-dialog1` | free | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/confirm-dialog.tsx` | **Visual reference only** (Kit PR 3); no kit code copied. `ConfirmDialog` wraps the existing `AlertDialog`: destructive or neutral tone, caller text, async confirm with a busy state (both buttons `aria-disabled`, dismissal blocked), inline failure message, optional focus-return target. Not chosen: `alert-dialog2`, `alert-dialog5`. |
| `stepper1` | free | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/stepper.tsx` | **Visual reference only** (Kit PR 4); no kit code copied and no `@base-ui/react` (the kit item depends on it). Hand-written numbered list: wizard layout (horizontal with connectors from 768px; compact "Step n of m" line with a progress bar below) and nav layout of buttons for editors (vertical from 1024px, scrollable bar below). `aria-current="step"`, done/current/upcoming as text, 28px indicators inside 44px targets on phones, no JS motion. Not chosen: `stepper2`, `stepper4`. |
| `form-layout20` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/wizard-layout.tsx` | **Visual reference only** (Kit PR 4); no kit code copied. `WizardLayout` is the step frame of the kit's three-step onboarding wizard (stepper, step heading and content, Back and Next) on Harvest's `Card`, `Button`, `Spinner` and `Stepper`: validate hook before Next, busy states, focus on the step heading after Back, Next or Finish. The kit's fields, copy, react-hook-form and zod 3 demo are not used. Not chosen: `onboarding-screen9`, `form-layout21`. |
| `form-layout1` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/form-section.tsx` | **Visual reference only** (Kit PR 4); no kit code copied. `FormSection`: named region with heading and optional actions, split layout, or a labelled fieldset for radio and checkbox groups. The kit's fields, avatar upload, save bar and copy are not used. Not chosen: `form-layout15`. |
| `field1` | free | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/dev/kit-field-example.tsx` | The kit demo (a labelled input in a field group) kept as the showcase example with Harvest's own `Field`, `FieldLabel`, `Input` and `FieldError` and catalogue copy, with the invalid state added. The `Field` primitive is Harvest's own and unchanged. Not chosen: `field2`, `field4`. |
| `tables19` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/crm/list-row-summary.tsx` | **Visual reference only** (Kit PR 5); no kit code copied. `RowSummary`: phone card layout under a People or Organizations row name (consent status badge, tappable email, phone, domain and people-count links, 44px), shown only while the list card is narrow. The lists keep `ListPage`, the shared filter popover and chips, saved views and the keyboard grid; the kit's table, side sheet, sample people, bulk bar and pagination are not used (no bulk action exists server-side). Not chosen: `tables5`, `tables7`. |
| `tables21` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/copy-button.tsx`, `src/components/crm/contact-actions.tsx` | **Visual reference only** (Kit PR 5); no kit code copied. `CopyButton` and `ContactActions` (email and phone as mailto and tel links with copy buttons in the person header; copy buttons on the email, phone and domain fields). The record keeps `RecordLayout`, inline per-field editing and the permission-gated consent controls; the kit's whole-record edit mode is not used. |
| `todo-app6` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/status-tracker.tsx`, `src/components/crm/activity-timeline.tsx`, `src/components/crm/tasks/task-rows.tsx` | **Visual reference only** (Kit PR 5); no kit code copied and no vaul drawer. `StatusTracker` (read-only segmented step bar, used for a deal's stage progress); timeline rail, right-aligned time, bordered note panel with icon actions and grouped note composer; task rows show overdue and priority as `StatusBadge`. The kit's attachments, links and sample tasks are not used. `kanban-board3` (optional reference) was not used: the deal board is unchanged. |
| `chat-ui4` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/connect-admin/follow-up-timeline.tsx`, `src/app/workspaces/[tenantId]/connect/follow-up/[caseId]/page.tsx` | **Visual reference only** (Kit PR 6); no kit code copied, no `@shadcn/react` message scroller, drawer or sample data. Follow-up case detail: thread-and-side-panel layout, state badge, details panel and a rail timeline of opened, assigned and state-changed events built only from the timestamps the case API returns. The kit's composer, internal note, attachments and reactions are not used (the case holds no notes and no server contract exists). Not chosen: `chat-ui5`. |
| `tables15` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/connect-admin/follow-up-queue.tsx` | **Visual reference only** (Kit PR 6); no kit code copied and no TanStack Table. Follow-up queue on the `DataTable` shell: state tabs (no counts, the case API returns no totals), state badge per row, case reference, link to the CRM contact, server cursor paging. The kit's row selection, bulk stage moves, search and client sorting are not used (no bulk server action exists). Not chosen: `tables14`. |
| `switch-card1` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/permission-card.tsx` | **Visual reference only** (Kit PR 6); no kit code copied, no react-hook-form, zod 3 or `Switch`. `PermissionCard`: label, state badge, optional description and meta line and an actions slot; display only (consent changes by recording an event, not by a switch). Used by the person page's contact permissions and the follow-up case's consent cards. |
| `tables9` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/communities/member-list.tsx` | **Visual reference only** (Kit PR 7); no kit code copied, no TanStack Table, no sample members. Member list: avatar mark with name, role badge (icon for hosts), status badge, status tabs with counts and name search for owners and admins, phone cards. The kit's featured switch, channel, reputation and trend columns are not used (no server contract or data). Not chosen: `tables5`. |
| `form-layout11` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/communities/create-community-dialog.tsx` | **Visual reference only** (Kit PR 7); no kit code copied, no react-hook-form or zod 3. New-community form with a visible address prefix and a suggested address; the editor's details step uses a `FormSection`. Cover dropzone, visibility, topic and invite fields are not used (the create API takes a name and an address only; no cover upload exists). Not chosen: `form-layout15`. |
| `product-list7` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/communities/discover-card.tsx` | **Visual reference only** (Kit PR 7); no kit code copied, no remote images or prices. Discover card with an initials band instead of a photo, host, free and open badges, a View link, and a segmented type switcher. Filtering stays server-side in the URL. Not chosen: `product-list1`. |
| `social-media-post1` | **premium** | 2026-11-16 | 2026-11-16 | 2026-11-16 | `src/components/forum/post-card.tsx` | **Visual reference only** (Kit PR 7); present in the registry. No kit code copied, no remote avatar or image, no share, save or edit menu. Forum feed card with author header, optional cover, excerpt and a replies and likes footer. Not chosen: `chat-ui3`. |
| `kanban-board3` | **premium** | 2026-11-26 | 2026-11-26 | 2026-11-26 | `src/components/board/kanban-board.tsx`, `src/components/campaigns/campaign-boards.tsx` | Founder decision 26 Nov: the kit item is richer than the CRM deal board (comparison below), so the shared board follows it. Written for Harvest: 17 of 185 lines identical (9%) in `kanban-board.tsx` against the item's `index.tsx` plus `components/ui/kanban.tsx`; 15 of 227 (6%) in `campaign-boards.tsx` (`scripts/ui-identical.sh`). Kept: column dot, count, totals, options menu; rounded cards with a per-card menu; initials avatar chip; red overdue date; `@dnd-kit/sortable` cards with `closestCenter`; board/list toggle with a table. Changed: no `tunnel-rat` and no kit `ui/kanban.tsx`; Harvest keyboard moves and i18n announcements (from the deal board) instead of the kit `KeyboardSensor` and English text; one `onMove` per drop, data and writes stay with the consumer; touch drag after a short press; 44px targets below 1024px; theme tokens. Not used: sample leads, dollar sums, channel marks, scope select, channel filter, duplicate, `date-fns`. The CRM deal board (`src/components/crm/deals/deal-board.tsx`) is the second consumer (follow-up PR): it keeps its stage dot, count, sums, probability, card fields, stale badge and close dialog, and gains no card menu or reorder. |

### Campaign boards: CRM deal board vs `kanban-board3` (26 Nov 2026)

Founder decision, 26 Nov: "If CRM board is most premium and in depth, use that one. If not, board 3 and update in CRM as well." Compared from the registry item source (retrieved 2026-11-26 through the proxy) and `src/components/crm/deals/deal-board.tsx` on main.

| Feature | CRM deal board | `kanban-board3` | Shared board (this PR) |
| --- | --- | --- | --- |
| Column header | Dot, name, count, amount sum, probability | Dot, name, count, value sum, options menu | Dot, name, count, meta slot, options menu |
| Add card per column | No (page-level New deal) | Yes (column menu) and toolbar button | Yes (column menu) and toolbar button |
| Per-column sort | No | By value, by due date | Not yet (needs a bulk reorder endpoint) |
| Card fields | Name, company/person, amount, close date, stale badge | Name, description, value, owner avatar, channel, due date (red when overdue), card menu (edit, move, duplicate, delete) | Consumer body (campaign: title, notes, milestone, assignee avatar, due date red when overdue), card menu (edit, move to column, delete) |
| Labels, priority, progress | No | No | No (campaign tasks have no labels or priority) |
| Empty column | Dashed "No deals" | Only a filter-empty message in list view | Dashed per-column message |
| Pointer moves | Across columns (dnd-kit core) | Across and within columns (dnd-kit sortable) | Across and within columns (sortable) |
| Keyboard moves | Arrows, Enter, Shift+←/→, i18n announcements | dnd-kit KeyboardSensor, English announcements | Deal-board keyboard plus Shift+↑/↓ within a column, i18n announcements |
| List view | Separate page mode | Board/list toggle with table | Board/list toggle with table |
| Filters / scope | Page-level CRM filters | Scope select, channel filter, overdue | Board select only (filters not included) |
| Phone layout | Columns scroll sideways, snap | Columns scroll sideways | Columns scroll sideways, snap; 44px targets |
| Light/dark | Theme tokens | Theme tokens plus fixed dot colours | Theme tokens only |

Result: `kanban-board3` is richer (column menu, per-column add, card menu, avatar, sortable cards, list view); the deal board is ahead only on keyboard accessibility and i18n, which the shared board keeps.


Tier note: the item JSON carries no price flag, and the component category pages show a badge for the first item only; the four items are recorded as free on the founder's statement for `toast1` and the absence of a premium marker on the others. Confirm on the item pages if the license position matters. `dashboard-shell8` and `dashboard-dropdown7` are premium by the founder's approval record (16 Nov 2026), who owns the licence and public-repository consequences.

### Kit PR 1: hand-written primitives and the `sonner` dependency

`ui.shadcn.com` is blocked, so these stock-style primitives were written by hand following the conventions of `src/components/ui/*` (radix-ui umbrella package, `cn`, `data-slot`, theme tokens, 44px targets below 1024px). They are Harvest source, not kit-derived files, and carry no provenance header.

| File | Basis | Notes |
| --- | --- | --- |
| `src/components/ui/spinner.tsx` | shadcn Spinner pattern (Lucide `LoaderCircle`) | `role="status"` with catalogue label, `decorative` mode for use inside labelled buttons, `motion-reduce:animate-none` |
| `src/components/ui/scroll-area.tsx` | shadcn Scroll Area on `radix-ui` | Token-colored scrollbars; `viewportClassName` and `viewportProps` for height caps and focusable named regions |
| `src/components/ui/toggle-group.tsx` | shadcn Toggle Group on `radix-ui` | Single (radiogroup) and multiple (pressed buttons); 44px items below 1024px; joined or spaced |
| `src/components/ui/kbd.tsx` | shadcn Kbd | `<kbd>` plus a group wrapper |
| `src/components/ui/sheet.tsx` (bottom side) | Existing Sheet | Height cap, rounded top, handle, safe-area padding, 44px close target; other sides unchanged |
| `src/components/ui/sonner.tsx`, `src/lib/toast.ts` | `sonner` 2.0.8 | See `toast1` above. The source guard rejects raw string literals in `notify.*` and `toast.*` calls |

New dependency: [`sonner`](https://github.com/emilkowalski/sonner) 2.0.8 (MIT, no runtime dependencies; peer dependencies are the existing React packages), founder-approved 2026-11-16; recorded in [third-party licenses](third-party-licenses.md#kit-pr-1-additions-2026-11-16). The kit's own `toast1` declares `sonner@2`.

### Kit PR 4: hand-written sticky save bar and the form dependencies

`StickySaveBar` (`src/components/sticky-save-bar.tsx`, helpers in `src/lib/sticky-save-bar.ts`) has **no kit item** and carries no provenance header: it is Harvest source written for this PR. Behaviour: exists only while a form is dirty or saving; sticks to the bottom of the content with phone safe-area padding; stops sticking while the on-screen keyboard is open (visual viewport more than 150px shorter than the window) and scrolls a focused control clear of the bar; polite live region ("Unsaved changes", "Saving"); Save and Discard at 44px below 1024px; optional guard on leaving a dirty form (links, Back/Forward, closing the tab) through the existing `useUnsavedChangesGuard`. The kit's `form-layout1` also contains a sticky save bar; it was not copied.

`src/hooks/use-harvest-form.ts` and `src/lib/form.ts` are Harvest source on the two new dependencies below; no kit code.

New dependencies (founder-approved 2026-11-16): [`react-hook-form`](https://github.com/react-hook-form/react-hook-form) 7.92.0 (MIT) and [`@hookform/resolvers`](https://github.com/react-hook-form/resolvers) 7.0.6 (MIT, supports zod 4 through its zod resolver; its only runtime dependency is `@standard-schema/utils` 0.3.0, MIT). Recorded in [third-party licenses](third-party-licenses.md#kit-pr-4-additions-2026-11-16). Only `zodResolver` and `useForm` are used.

### Registry access in agent sessions

`components.json` registers `@shadcnuikit` with `Authorization: Bearer ${REGISTRY_TOKEN}` (placeholder only; `.env.example` lists the variable name with no value). The real credential is injected by the network proxy and is never visible, printed or committed. `REGISTRY_TOKEN` is unset in agent sessions, so either run the CLI with a dummy value (`REGISTRY_TOKEN=proxy-injected npx shadcn@latest add @shadcnuikit/<name>`; the proxy overwrites the header) or fetch `https://shadcnuikit.com/r/<name>.json` with curl and copy the files by hand, then convert them (see the plan, section 6). Run raw output only in a scratch directory outside the repository. `ui.shadcn.com` stays blocked, so stock primitives are written by hand. CI runs no registry command and needs no secret. The token-leak guard in the same test fails on a token-like `Bearer` value, a non-empty `REGISTRY_TOKEN=` assignment or a committed kit registry index.

### Chart tokens

`--chart-1` to `--chart-5` exist in every palette in `src/lib/theme-registry.ts` (light and dark) and map to `bg-chart-N` and friends in `globals.css`. Each meets 3:1 non-text contrast against that palette's `--surface-card` and `--surface` (unit-tested). The 12 future palettes are not represented in the registry yet and must supply the same five tokens. No chart library is installed.

### Communities C11b chat

The chat UI is **modelled on** the founder-supplied premium Shadcn UI Kit chat app, the private repository `bumbmatei-sys/chat-app` (commit `66fd523`, premium; no secrets were copied), and wired to the real C11a server and Harvest's shared components. **In C11b only `src/components/ui/bubble.tsx` was copied from the kit** (about 92% matching text); it starts with `Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): components/ui/bubble.tsx` and is listed in `chatAppProvenance` (`src/lib/ui-provenance.ts`). The other nine files take the kit's structure and behaviour but were written for Harvest; a 50-character window comparison against the kit found no shared code. They start with `Layout and behaviour modelled on bumbmatei-sys/chat-app (...): <source>; code written for Harvest, no kit code copied` and are listed in `kitChatAppReferences`. A unit test enforces both headers in both directions. The founder accepted this result on 19 November 2026; the DM, profile and events screens will adopt real kit code from the start.

| Harvest file | Status | Kit source (`app/(auth)/chats/components/` unless noted) | Harvest notes |
| --- | --- | --- | --- |
| `src/components/ui/bubble.tsx` | **copied** | `components/ui/bubble.tsx` | Header added; the tinted variant uses a `primary` tint token instead of an oklch literal (source guard). Needs `@base-ui/react`. |
| `src/components/user-avatar.tsx` | modelled on | `components/user-avatar.tsx` | Initials or the channel emoji; no image or presence indicator. |
| `chat/channel-list.tsx` | modelled on | `chat-list.tsx`, `chat-list-item.tsx`, `chat-list-item-dropdown.tsx` | Search, unread filter and badges, mute marker, 44px options menu for roles that manage channels. |
| `chat/chat-header.tsx` | modelled on | `chat-header.tsx` | Back, mark, name and subtitle; the name opens channel info. |
| `chat/chat-layout.tsx` | modelled on | `chats-view.tsx` | Two panes on large screens, one pane on phones. |
| `chat/message-pane.tsx` | modelled on | `chat-content.tsx` | Real polling and the shared message scroller. |
| `chat/chat-message.tsx` | modelled on | `chat-bubbles.tsx` | Text bubbles, time line, action menu; no image, video, file or voice bubbles (attachments wait for the malware scanner). |
| `chat/chat-composer.tsx` | modelled on | `chat-footer.tsx` | Card composer, one 44px line growing to four, mention picker; no emoji, file or voice. |
| `chat/channel-info.tsx` | modelled on | `group-detail-drawer.tsx` | Channel info panel; leave group not offered. |
| `chat/member-profile-sheet.tsx` | modelled on | `user-detail-sheet.tsx` | Name, role and joined date only. |

Not used from the kit: status and stories, calls, contacts, lightbox, new-message dialog (adopted in C11c, see below), the zustand mock store, `motion` and `embla`. Harvest's Sheet, DropdownMenu, ScrollArea, Card, Avatar, Popover and ConfirmDialog stand in for the kit's base-ui Drawer and menus. The message scroller is adapted from Studio Admin (MIT, notice retained) and uses `@shadcn/react` 0.3.1. Message data comes only from the polling hook and the server; no client store holds messages.

The editor uses its existing Channels step, MemberList and StickySaveBar. Moderation uses the existing DataTable and ReportDialog. NotificationBell stays in CommunityShell. Copy comes from the locale catalogue and colours from theme tokens.


### Events C14 calendar

The founder's private premium kit repository `bumbmatei-sys/admin-dashboard` (commit `1631106`, `apps/calendar`; no secrets were copied or stored) is the first source for the Events month calendar. **Two files are copied**, one **modelled on**; nothing else in the Events screens has a kit source (they use Harvest's shared components: the community shell, EditorShell, WizardLayout, FormSection, StickySaveBar, DataTable, StatusBadge, EmptyState and ConfirmDialog). The share is the measured fraction of the file's non-blank lines of at least 12 characters (the header line included in the count) that also appear, identical after trimming, in the source file.

| Harvest file | Status | Kit source (`app/dashboard/(auth)/apps/calendar/`) | Identical lines | Harvest notes |
| --- | --- | --- | --- | --- |
| `src/lib/calendar-days.ts` | **copied** | `utils.ts` | 36 of 38 (95%) | Five day-bucketing helpers; only the `CalendarEvent` import changed. Colour, border-radius, agenda and add-hours helpers not copied. |
| `src/components/events/month-calendar.tsx` | **copied, heavily adapted** | `components/month-view.tsx` | 41 of 88 (47%) | Month grid, week and day computation and cell classes kept. Drag and drop, create-on-click, the overflow popover and the visibility hook removed. Cells are buttons that select a day (dots on phones, titled chips from 640px); a header with previous and next month links; raw palette colours replaced by theme tokens; weekday and outside-day text at full contrast (axe); today applied after mount. |
| `src/components/events/events-board.tsx` | modelled on | `components/agenda-view.tsx` | none copied | Upcoming list under day headings beside the calendar, with a list and calendar switch kept in the URL. |

**Approval record.** Source: premium kit repository `bumbmatei-sys/admin-dashboard`, commit `1631106` (`apps/calendar`). Approved by the founder on 2026-11-19 under the standing kit rule of 17 Nov ("if we can use a premium component from the ui kit, use it, that is why I paid for it"; `docs/decisions/founder-decisions-2026-11.md` section 3), with the licence settled on 17 Nov ("License settled, go ahead"). The same record is `adminDashboardProvenance` (`approvedBy: "founder"`, `approvedOn: "2026-11-19"`) in `src/lib/ui-provenance.ts`. This is the standing decision applied to these files, not a separate per-file request.

Not used from the kit calendar: week, day and agenda views, the event dialog, drag and drop (`@dnd-kit`), the colour palette classes and the current-time indicator. Times are shown in each event's own time zone; calendar maths runs on wall-clock dates in that zone, so a viewer's zone never moves an event to another day. The Harvest tests check both headers in both directions (`tests/unit/ui-provenance.test.ts`).

### Communities C11c private messages

The private message screens use the same founder-supplied premium chat app (`bumbmatei-sys/chat-app`, commit `66fd523`; no secrets were copied), per the founder's 17 Nov rule to use the kit wherever it fits. **Two files are adapted copies**: they were made by editing the kit file text in place and rewriting what depended on the mock store, and they start with `Derived from bumbmatei-sys/chat-app (...)`. The share of lines still identical to the kit file (trimmed lines of 12 or more characters) is stated so the claim is checkable: `chat/dm-new-message-dialog.tsx` from `new-message-dialog.tsx` (about 27%) and `chat/dm-list.tsx` from `chat-list.tsx` and `chat-list-item.tsx` (about 24%). Both are listed in `chatAppProvenance`; the unit test enforces the header in both directions. `ui/bubble.tsx` stays the only near-verbatim copy (97%).

The other new files are **modelled on** the kit and written for Harvest (a 50-character window comparison found at most 1% shared text): `chat/message-list.tsx` (moved out of `message-pane.tsx`, shared by channels and private messages), `chat/dm-message.tsx`, `chat/dm-pane.tsx` and `chat/dm-layout.tsx`. `chat/chat-view-tabs.tsx`, `chat/dm-api.ts` and `chat/dm-compose-dialog.tsx` have no kit source. Harvest's shared composer, header, scroller, `ReportDialog`, `ConfirmDialog` and `UserAvatar` are extended, not duplicated.

Not used from the kit: group mode and logo upload in the new-message dialog, the contact and chat stores, status and stories, calls, the lightbox, reactions and replies in private messages.

### Communities C09b member profile screens

The profile page is **modelled on** the founder-supplied premium Admin-dashboard template, the private repository `bumbmatei-sys/Admin-dashboard` (commit `1631106`, premium, `pages/profile`; recorded in `adminDashboardReferences` beside the Events files, under the same approval record; no secrets were copied). **No kit file is copied**: the kit files are fixture pages (contact details, transactions, release notes), so the two new files are Harvest code written to the same layout, and no line is claimed as derived. The compact member sheet from the chat screens is extended, not copied again: its header became `MemberSummary`, shared with the page, and the sheet gained a link to the full profile.

| Harvest file | Status | Kit source (`app/dashboard/(auth)/pages/profile/` unless noted) | Harvest notes |
| --- | --- | --- | --- |
| `src/components/communities/member-profile-view.tsx` | modelled on | `page.tsx`, `components/profile-card.tsx`, `components/latest-activity.tsx` | Profile card with post and reply counts, latest-activity timeline, Settings tab on the viewer's own page. |
| `src/components/communities/member-profile-settings.tsx` | modelled on | `components/complete-your-profile.tsx` | Rows that open the service owning each setting; no second copy of any preference. |
| `src/components/communities/chat/member-profile-sheet.tsx` | modelled on (chat-app, unchanged source) | chat-app `user-detail-sheet.tsx` | `MemberSummary` extracted; link to the full profile. |

Not used from the kit: contact details, skills, connections, the transaction table, download buttons and every fixture. Directory names link to the profile through the existing `MemberList`. Voluntary fields (bio, links, language, visibility) and avatar upload have no server support yet and are not built.

### Social Publish screens (Planner: Compose, Calendar, Queue; Social accounts)

Layout and flow follow the founder's first Harvest version (private repository `bumbmatei-sys/harvest-agent`, read-only; his own code) and the Eden reference screens, built with the premium kit (admin-dashboard commit `1631106`, no secrets copied) under the founder's standing kit rule of 17 Nov ("if we can use a premium component from the ui kit, use it", `docs/decisions/founder-decisions-2026-11.md`, "Paid Shadcn UI Kit"). **Approval basis, stated plainly:** the standing rule plus the Social screens PR, which names the exact blocks below (hover-card, attachment, calendar week and month views and the current-time hook); no per-item founder approval of these specific files was given before they were chosen, so they await review with this PR. Chosen kit items and the date: all on 20 Nov 2026. Measurements below use `scripts/ui-identical.sh` (non-blank lines, whitespace-trimmed, longest common subsequence against the kit file at commit `1631106`; the denominator is the Harvest file's lines, header included). The v1 component code is not ported, only its layout and the platform logo marks.

| Harvest file | Status | Source | Identical lines | Notes |
| --- | --- | --- | --- | --- |
| `src/components/ui/hover-card.tsx` | **copied** (kit) | admin-dashboard `components/ui/hover-card.tsx` | 37 of 39 (94%) | The platform ring's popup (limit and characters written) on hover, focus and tap. State variants changed to Radix `data-[state=...]`. |
| `src/components/ui/attachment.tsx` | **copied** (kit) | admin-dashboard `components/ui/attachment.tsx` | 80 of 84 (95%) | Copied with 3 class-string tweaks, per the independent reviewer's count against the public registry item; I could not reach the registry to reproduce it (404), so that figure is the reviewer's. Against the kit repo copy the script gives 190 of 191 (99%, only the header line added). The media cards inside the post card, with their upload states. |
| `src/components/social/week-calendar.tsx` (now `src/components/calendar/week-view.tsx`) | **derived** (kit) | admin-dashboard `apps/calendar/components/week-view.tsx` | 225 of 313 (71%) | The Calendar's week grid. Monday first; overlapping posts collapse into the first plus a "+N" Popover list; all-day section removed; dnd-kit replaced by native drag-and-drop on posts and quarter-hour cells. |
| `src/hooks/use-current-time-indicator.ts` | **copied** (kit) | admin-dashboard `apps/calendar/hooks/use-current-time-indicator.ts` | 37 of 42 (88%) | Current-time line of the week view. |
| `src/components/events/month-calendar.tsx` | copied (Events), **extended** | admin-dashboard `apps/calendar/components/month-view.tsx` | 68 of 144 (47%) | Optional message namespace, chip renderer, drag-and-drop day targets and a `weekStartsOn` option (Monday for the Calendar; Events stays Sunday-first). |
| `src/components/social/option-rows.tsx` | modelled on (kit) | admin-dashboard `pages/settings/notifications/page.tsx` | none copied | The bordered switch rows of the composer (first comment, auto repost, made with AI, link, TikTok consent). |
| `src/components/social/platform-logo.tsx` | **ported** (founder's v1) | harvest-agent `src/components/admin/social/PlatformLogo.tsx` | 2% of lines; 7 of 20 marks are the source's data | Real logo marks for every platform the provider lists, from Simple Icons 16.36.0 (CC0-1.0, the same release the source used); LinkedIn, Slack, Google Business Profile, SMS and RCS use neutral marks (Simple Icons no longer carries the first three). |
| `composer.tsx`, `composer-preview.tsx`, `destination-card.tsx`, `planner.tsx`, `social-nav.tsx` | layout from v1 | harvest-agent `SocialScheduler.tsx`, `PostPreview.tsx`, `MediaAttachments.tsx`, `PageHeader.tsx`, `shell-nav.ts` | none copied | Post to circles with a dashed connect circle, one text card with media and toolbar inside, option rows, preview tabs with an Each platform list; the Planner header and Compose, Calendar, Queue tabs; the three-column queue; the week grid with a drafts aside; the Social media sidebar group. |

Kit blocks looked at and not used: the kit kanban (`components/ui/kanban.tsx`, dnd-kit is not an approved dependency; the queue columns are Harvest cards), the event dialog, the agenda and day views, and recharts radial charts (the ring is hand-written SVG). Platform marks remain their owners' trademarks and are used only to name the network.

### Inbox screens (Social media > Inbox)

Built with the premium kit under the standing kit rule, with no per-item founder approval of these exact files (the PR names them for review). Sources: admin-dashboard `apps/mail` (`mail.tsx`, `mail-list.tsx`, `nav.tsx`, `nav-desktop.tsx`, `mail-display.tsx`) and `apps/chat` (`chat-header.tsx`, `chat-bubbles.tsx`) at commit `1631106`, and chat-app `chat-footer.tsx` at `66fd523`. **No kit file is copied**; all five Harvest files are **modelled on** the kit layout and written for Harvest. Measured with `scripts/ui-identical.sh` (trimmed non-blank lines unchanged from the kit file, Harvest file as denominator, best match per Harvest file; the matches are import and boilerplate lines), run 21 Nov 2026:

| Harvest file | Status | Kit source | Identical lines |
| --- | --- | --- | --- |
| `src/components/social/inbox/inbox.tsx` | modelled on | `apps/mail/components/mail.tsx` | 6 of 140 (4%) |
| `src/components/social/inbox/inbox-list.tsx` | modelled on | `apps/mail/components/mail-list.tsx` | 7 of 114 (6%) |
| `src/components/social/inbox/inbox-filters.tsx` | modelled on | `apps/mail/components/nav.tsx` (nav-desktop.tsx: 3 of 57, 5%) | 4 of 57 (7%) |
| `src/components/social/inbox/inbox-thread.tsx` | modelled on | `apps/chat/components/chat-bubbles.tsx` (mail-display.tsx: 4 of 185, 2%; chat-header.tsx: 3 of 185, 1%) | 9 of 185 (4%) |
| `src/components/social/inbox/inbox-composer.tsx` | modelled on | chat-app `app/(auth)/chats/components/chat-footer.tsx` | 5 of 84 (5%) |

Message rows reuse the existing kit-derived `src/components/ui/bubble.tsx`. The coloured platform marks are the networks' brand colours (`src/lib/theme-registry.ts`), drawn from the same Simple Icons paths as the Planner marks.

### Office Mail screens (Operations > Office > Email)

Built under the standing kit rule ("use anything that is PRO in the kit, if nothing suitable use free"; copying allowed with measured provenance). Source: the paid kit's mail app, admin-dashboard `apps/mail` (`mail.tsx`, `mail-list.tsx`, `nav.tsx`, `nav-desktop.tsx`, `mail-display.tsx`, `mail-display-mobile.tsx`, `account-switcher.tsx`) at commit `1631106`. No chat-app part was needed. **No kit file is copied**: the kit's mail app depends on `react-resizable-panels`, a template editor, a Zustand store and mock `Mail` objects, none of which fit (design 19 Nov: no mock data or fixture types, no Zustand for selection), so every Harvest file is **modelled on** the kit layout and written for Harvest. Measured with `scripts/ui-identical.sh` on 21 Nov 2026 (same method as the Inbox table above):

| Harvest file | Status | Kit source | Identical lines |
| --- | --- | --- | --- |
| `src/components/inbox/inbox-frame.tsx` | modelled on | `apps/mail/components/mail.tsx` | 4 of 46 (8%) |
| `src/components/office/mail/mail-workspace.tsx` | modelled on | `apps/mail/components/mail.tsx` | 6 of 142 (4%) |
| `src/components/office/mail/mail-list.tsx` | modelled on | `apps/mail/components/mail-list.tsx` | 7 of 98 (7%) |
| `src/components/office/mail/mail-folders.tsx` | modelled on | `apps/mail/components/nav.tsx` and `nav-desktop.tsx` | 3 of 46 (6%) |
| `src/components/office/mail/mail-thread.tsx` | modelled on | `apps/mail/components/mail-display.tsx` (mail-display-mobile.tsx: 5 of 94, 5%) | 4 of 94 (4%) |
| `src/components/office/mail/mail-composer.tsx` | modelled on | `apps/mail/components/mail-display.tsx` | 4 of 99 (4%) |
| `src/components/office/mail/mail-connect.tsx` | modelled on | `apps/mail/components/account-switcher.tsx` | 4 of 70 (5%), re-measured 22 Nov after the hook extraction |

The matches are import and boilerplate lines. `InboxFrame` is the layout the social Inbox already used, extracted so both inboxes share one frame (the Inbox now consumes it; its behaviour is unchanged). Reused, not rebuilt: AppShell and the contextual sidebar slot, `EmptyState`, `StatusBadge`, `ConfirmDialog`, the CRM `RecordPicker` for the person link, shared Field, Input, Textarea, Alert and Button primitives. Written for Harvest and not kit-derived: `person-link.tsx`, `mail.tsx`.

Mailbox marks (`src/components/office/provider-logo.tsx`, colours in `src/lib/theme-registry.ts`): Gmail is drawn from the Simple Icons Gmail outline (CC0-1.0) split into the brand colours; Outlook is a simplified envelope page and lettered tile in the brand blues drawn for Harvest. Both are simplified marks, remain their owners' trademarks, are subject to each owner's brand guidelines and are used only to name the connected mailbox. Product names live in `src/lib/office/mail.ts` and the logo registry, never in the message catalogue (source guard).

### Files screen (Operations > Office > Files)

One Files screen: the ministry's own uploads plus the person's connected Google Drive and OneDrive. Founder design (21 Nov): "Design of Admin Studio file manager, combined with the paid UI kit file-manager screens." Source: the paid kit, admin-dashboard at commit `1631106`: the `file-manager` dashboard page (`page.tsx`, `summary-cards.tsx` folder cards on top, `table-recent-files.tsx` recent files below, `storage-overview-card.tsx`) and `apps/file-manager` (`file-manager.tsx` list view with search and breadcrumbs, `file-upload-dialog.tsx`). The kit's `chart-file-transfer.tsx` and `user-upload-activity.tsx` are not used (no transfer or activity data exists), `project-detail/components/files-tab.tsx` was looked at and is a static mock list, and `bumbmatei-sys/chat-app` has no file-manager block. Pro first, otherwise free: every block used is premium. **No kit file is copied**: the kit's blocks run on mock data, a fixed 2 TB quota, a row menu of actions that are hard-off here (Download, Share, Delete, Move) and its own table state, so every Harvest file is **modelled on** the kit layout and written for Harvest on the shared `DataTable`, `EmptyState`, `StatusBadge`, Dialog, Breadcrumb and Card. Measured with `scripts/ui-identical.sh` on 22 Nov 2026 (Harvest file as denominator, best match per file):

| Harvest file | Status | Kit source | Identical lines |
| --- | --- | --- | --- |
| `src/components/files/files-screen.tsx` | modelled on | `file-manager/page.tsx`, `apps/file-manager/components/file-manager.tsx` | 5 of 195 (2%), 8 of 195 (4%) |
| `src/components/files/folder-cards.tsx` | modelled on | `file-manager/components/summary-cards.tsx` | 1 of 32 (3%) |
| `src/components/files/files-table.tsx` | modelled on | `table-recent-files.tsx`, `apps/file-manager/components/file-manager.tsx` | 4 of 56 (7%), 5 of 56 (8%) |
| `src/components/files/entry-icon.tsx` | modelled on | `table-recent-files.tsx`, `apps/file-manager/components/file-manager.tsx` | 1 of 22 (4%), 3 of 22 (13%) |
| `src/components/files/storage-overview.tsx` | modelled on | `file-manager/components/storage-overview-card.tsx` | 4 of 29 (13%) |
| `src/components/files/sources-dialog.tsx` | modelled on | `apps/mail/components/account-switcher.tsx` | 3 of 74 (4%) |

The matches are import and boilerplate lines. Source marks (`SourceLogo` in `src/components/office/provider-logo.tsx`, colours in `src/lib/theme-registry.ts` as `driveMarkColors`): the Harvest logo is the app's own; the Google Drive mark is three bars in the brand colours and the OneDrive mark two clouds in the brand blues, both **simplified marks drawn for Harvest**, so each remains subject to its owner's brand guidelines (clear space, no recolouring, no implied endorsement) and to brand-guideline review, exactly like the Gmail and Outlook marks above. They are used only to name where a file lives; product names stay out of the message catalogue (source guard).

### Office Calendar screen (Operations > Office > Calendar, 22 Nov 2026)

Founder design: "Studio Admin look and the Admin Studio calendar app screens", and (22 Nov) "take the calendar components straight from the admin-dashboard kit". Source: the paid kit `bumbmatei-sys/admin-dashboard` at commit `1631106`, `app/dashboard/(auth)/apps/calendar/` (pro kit; the free kit was not needed). Components were copied and adapted, not rewritten, where a copy works; every share below is measured with `scripts/ui-identical.sh` (Harvest file as the denominator) and recorded in `src/lib/ui-provenance.ts`.

| Harvest file | Status | Kit source | Identical lines | Harvest notes |
| --- | --- | --- | --- | --- |
| `src/components/office/calendar/event-form.tsx` | **copied, adapted** | `event-dialog.tsx` | 176 of 264 (66%) | The create and edit drawer: fields, order, date pickers, 15-minute time selects, all-day checkbox. Sheet for the kit drawer, lucide for remixicon, catalogue copy, calendar picker instead of the colour picker, time zone, attendees and meeting link added, every write removed: no `onSave`, no `onDelete`, the whole form and Save disabled. |
| `src/components/office/calendar/agenda-view.tsx` | **copied, adapted** | `agenda-view.tsx` | 45 of 66 (68%) | 30-day list under dated headings. Rows are Harvest buttons using the shared chip; the kit's `EventItem` is not used; console logging removed. |
| `src/components/social/week-calendar.tsx` | derived (Social), **extended** | `week-view.tsx` | 222 of 328 (67%) | Gains a `day` mode (one column, so the Day view shares the week grid), an optional all-day row, and an optional `onDropAt` (omitted for the read-only Calendar: nothing is draggable). The kit `day-view.tsx` is not copied separately: the Day view is this component in `day` mode. |
| `src/components/events/month-calendar.tsx` | copied (Events), **extended** | `month-view.tsx` | 68 of 146 (46%) | Gains `hideHeader` and the `OfficeCalendar.month` message namespace. |
| `src/lib/calendar-days.ts` | **copied** | `utils.ts` | 75 of 77 (97%) | Gains the kit's `getAgendaEventsForDay`, verbatim. |
| `src/components/office/calendar/calendar-workspace.tsx` | modelled on | `event-calendar.tsx` | 6 of 203 (2%) | Toolbar, view switch, source chips, social overlay, detail panel and live reads are Harvest's. |
| `src/components/office/calendar/calendar-connect.tsx` | modelled on | mail `account-switcher.tsx` | 4 of 70 (5%) | Same connect states as Email and Files. |

**Not copied, and why.** `event-item.tsx`, `draggable-event.tsx`, `droppable-cell.tsx` and `calendar-dnd-context.tsx` (drag and drop to reschedule is a write; every write is hard-off, so nothing is draggable); `events-popup.tsx` (Harvest's week grid already has the overlap popover and the month shows "+N more" and opens the day); the kit's colour classes (the event takes its calendar's mark instead). Dependencies were checked against `package.json`: `@dnd-kit/*`, `date-fns`, `react-day-picker`, `lucide-react` are present; `@remixicon/react` and a Drawer are not, so neither is added (lucide and the shared Sheet are used). No new dependency.

Calendar source marks (`CalendarLogo` in `src/components/office/provider-logo.tsx`, colours in `calendarMarkColors`) are simplified marks drawn for Harvest, flagged subject to each owner's brand guidelines like the Gmail, Outlook, Drive and OneDrive marks.

### Events week and day views (shared week grid, 26 Nov 2026)

Founder decision (26 Nov): give the Events calendar week and day views; "If the existing one is most premium and in depth, use that one. If not, event-calendar1 and update the other as well." Compared: Harvest's week grid (`src/components/calendar/week-view.tsx`, derived from the premium admin-dashboard kit `apps/calendar/components/week-view.tsx`, commit `1631106`, already approved and used by Social and Office Calendar) against Shadcn UI Kit item `event-calendar1` (premium, `@shadcnuikit`, preview https://shadcnuikit.com/blocks/application-ui/event-calendar#event-calendar-1). No registry token was in the environment and `shadcnuikit.com` is outside this session's allowed network, so `event-calendar1` was compared only from what is known of it (the same kit's calendar app that the admin-dashboard files come from). Nothing was fetched or copied from it.

| Feature | Harvest week grid (`week-view.tsx`) | `event-calendar1` (not inspected; see above) |
| --- | --- | --- |
| Week grid | Yes, Monday first, 24 hours, quarter-hour cells | Week view (same kit family) |
| Day grid | Yes (`mode="day"`, one column; used by Office Calendar) | Day view |
| All-day row | Yes (optional `allDay`; multi-day entries too) | All-day section |
| Overlapping events | Collapsed lead plus a "+N" Popover list (44px rows) | Side-by-side slivers in the kit week view |
| Current-time line | Yes (kit hook `use-current-time-indicator.ts`) | Yes |
| Time zone | Wall-clock positioning; Events pass each event's own zone (`toCalendarEvents`) and a `zoneLabel` replaces the viewer's GMT offset | Viewer's zone |
| Keyboard | Every event and "+N" is a button; the scroll region is focusable; prev/next/today are links. No arrow-key cell navigation | Not verified |
| Phone layout | Single-letter day headers, hour labels shrink, 44px chips and controls below `sm` | Not verified |
| Light/dark | Theme tokens only (card, muted, border, primary) | Kit palette classes |
| Drag and drop | Optional native drop on quarter-hour cells (Social); off for Events and Office | dnd-kit |

**Result.** The existing grid is at least as complete for what Harvest needs, already premium-derived and approved, so it is reused: it moves unchanged from `src/components/social/week-calendar.tsx` to `src/components/calendar/week-view.tsx` and gains one optional prop (`zoneLabel`). Social Planner, Office Calendar and Events now import the same component. **No new kit code**, no new provenance item and no new identical-line count (the move changes no kit-derived lines; the record in `src/lib/ui-provenance.ts` now names the new path). The Events list/month/week/day choice stays in the URL (`?view=week&date=YYYY-MM-DD`, `?view=day&date=…`, `?view=calendar&month=…`). Known limits: hour and day labels inside the grid use date-fns English formats, as in Office Calendar; the current-time line follows the viewer's clock.

**Screenshot fixes (26 Nov).** `week-view.tsx` renders "today" and the viewer's GMT offset only after hydration (`useHydrated`, as the month calendar already did), and gains an optional `openAt` hour: once in the page it scrolls the nearest scrolling ancestor so that hour's label sits wholly below the sticky day header (`gridScrollTop` in `src/lib/calendar-days.ts`). Social Planner moves its own scroll code onto it (same hour rule, `openingHour`); Events now opens the same way; Office Calendar passes no `openAt` and is unchanged. The Events week title no longer uses `formatRange` before hydration (Node's ICU puts thin spaces around the dash, Chromium plain spaces, which failed hydration). Now 217 of 355 lines identical to the kit file (61%). No new kit items.

### Settings pop-up (profile menu)

The Settings pop-up uses five items from the founder's private premium kit repositories, approved by the founder on 20 Nov 2026: `bumbmatei-sys/chat-app` (commit `66fd523`) `components/settings-dialog.tsx` (pop-up shell) and `components/user-avatar.tsx` (avatar block, already in the repository), and `bumbmatei-sys/admin-dashboard` (commit `1631106`) `pages/settings/components/sidebar-nav.tsx` (section list), `pages/settings/account/page.tsx` (profile form layout) and `pages/settings/notifications/page.tsx` (bordered link rows). **No kit file is copied.** The kit dialog and tabs are `@base-ui/react`, which the shared Harvest dialog is not, so every file is written for Harvest on its Radix Dialog, Field, Input, RadioGroup and Button, and starts with the modelled-on header. `scripts/ui-identical.sh` finds, per current file: 4 of 40 non-blank lines (10%) of `settings-dialog.tsx` identical to the kit dialog, 4 of 43 (9%) of `settings-nav.tsx` against `sidebar-nav.tsx`, and 4 of 149 (2%) and 6 of 149 (4%) of `settings-panels.tsx` against the account and notifications pages (imports and closing tags). Not used: billing, appearance and display pages, the kit's switch rows and fixture data, react-hook-form and zod.

| Harvest file | Status | Kit source | Harvest notes |
| --- | --- | --- | --- |
| `src/components/settings/settings-dialog.tsx` | modelled on | chat-app `components/settings-dialog.tsx` | Title, section list beside scrolling content; full-screen sheet below 768px. |
| `src/components/settings/settings-nav.tsx` | modelled on | admin-dashboard `settings/components/sidebar-nav.tsx` | Icon rows grouped You and Ministry, a scrollable tab row on phones, roving arrow-key focus. |
| `src/components/settings/settings-panels.tsx` | modelled on | admin-dashboard `settings/account/page.tsx`, `settings/notifications/page.tsx` | Account, Ministry details, Connections (the social accounts board embedded) and CRM link rows. 4 of 65 (6%) and 5 of 65 (7%) identical lines. |
| `src/components/settings/profile-panel.tsx` | modelled on | admin-dashboard `settings/account/page.tsx` | Profile editing (see below). 6 of 152 (3%) identical lines: imports and closing tags. |
| `src/components/user-avatar.tsx` | modelled on (existing) | chat-app `components/user-avatar.tsx` | Reused unchanged in the profile and account panels. |

#### Profile editing (You > Profile)

Kit blocks inspected first, 22 Nov 2026: admin-dashboard (commit `1631106`) `pages/settings/account/page.tsx` (a react-hook-form fixture: name, date of birth, language, one submit) and chat-app (commit `66fd523`) `components/settings-dialog.tsx` (Profile rows: avatar, display name, a "Private profile" switch). Neither fits a profile with reorderable links, three visibility choices, revision conflicts and hide/clear confirmations, so no block is copied or installed. `profile-panel.tsx` keeps the account page's shape (labelled fields in one form, one save action) and is written on the shared Harvest components: Field and FieldError, Input, Textarea, RadioGroup, `StickySaveBar` (save and discard, with its leave guard), `ConfirmDialog` (hide, clear and discard) and the shared toast helper. `scripts/ui-identical.sh` against the kit account page: 6 of 152 non-blank lines (3%), imports and closing tags. Not used: react-hook-form and zod (the rules live in `src/lib/profile-links.ts`, mirrored from the server and unit tested), the date and language pickers, the chat-app switches and fixture avatar. Link reordering uses move up and move down buttons, not a drag library.

### Social Auto-DM screens (rules list, rule editor, enable review, test mode, activity, templates, hours)

Layout and features follow the founder's first Harvest version (private repository `bumbmatei-sys/harvest-agent`, read-only; his own code: `SocialAutoDmView.tsx`, its tests and `auto-dm.ts`) and the Eden Auto-DM screens, with the improvements listed in `docs/acceptance/social-auto-dm-screens.md`. No harvest-agent code was copied: it is a different stack and data layer. Kit reference: admin-dashboard commit `1631106` (premium), under the founder's standing kit rule of 17 Nov.

| Harvest file | Status | Kit source | Identical lines | Notes |
| --- | --- | --- | --- | --- |
| `src/components/social/auto-dm/editor-parts.tsx` | modelled on (kit) | admin-dashboard `pages/settings/notifications/page.tsx` | 5 of 49 (10%), imports and closing lines | The bordered switch row; numbered step cards and card radios are Harvest-written. |
| all other `src/components/social/auto-dm/*` | existing Harvest components | none | not applicable | Built on Stepper (stepper1), EmptyState (empty-state15), StatusBadge (badge1), Sheet, Dialog, Tabs, StickySaveBar and the composer's option-row pattern; no new kit item installed. |

Kit blocks looked at and not used: `workflow-automation` (canvas editor; Auto-DM is a bounded rule, not a workflow graph) and the premium tables (Harvest lists are cards that stack on phones).

### Social Analytics screens

Premium kit repository `bumbmatei-sys/admin-dashboard` (commit `1631106`, no secrets copied), under the founder's standing kit rule of 17 Nov and his 20 Nov instruction that every analytics screen uses the kit's dashboard blocks, animated once per visit. Percentages are the share of the Harvest file's non-blank lines that are unchanged from the kit file, measured with `scripts/ui-identical.sh`; they are also recorded in `adminDashboardProvenance` in `src/lib/ui-provenance.ts`. The kit's own registry items `stat-card12`, `chart56` and `chart60` are not in the repository copy; the local dashboard pages (`finance`, `sales`, `ecommerce`) hold the same block families, so those files were the sources.

| Harvest file | Status | Kit source (`app/dashboard/(auth)/` unless noted) | Identical lines | Harvest notes |
| --- | --- | --- | --- | --- |
| `src/components/ui/chart.tsx` | **copied** | `components/ui/chart.tsx` (repository root) | 334 of 337 (99%) | Error text became a code; the recharts selectors that name raw hex colours were removed. |
| `src/components/social/analytics/count-up.tsx` | **derived** | `components/ui/custom/count-animation.tsx` | 8 of 14 (57%) | Takes a formatter; 0.4 s; the only file importing `motion`, loaded on demand. |
| `src/components/social/analytics/stat-card.tsx` | **derived** | `finance/components/kpi-cards.tsx` | 14 of 60 (23%) | Card, badge, figure and bar sparkline, rewritten around real readings. |
| `src/components/social/analytics/series-card.tsx` | **derived** | `sales/components/revenue-chart.tsx` | 10 of 61 (16%) | Titled card with the measure switch; area chart with gaps. Mostly shared imports. |

Everything else on the screen (platform table, ranked posts, heatmap, range picker, banners, post drawer, data hook, entrance hook) is written for Harvest on shared components and has no kit source. New dependencies: `recharts` 3.10.1 and `motion` 13.1.1, both approved (16 Nov and 20 Nov). Chart colours are the existing `--chart-1..5` tokens.

## CRM forms builder (21 Nov 2026)

Layout follows a reference form builder shown to the founder in screenshots (forms list with a template row, new-form template grid and "where do submissions go" picker, Build / Settings / Preview tabs, the add-question menu with submenus, a Start page and End page rail, the Settings sidebar). **No code, text, icon, colour or brand from that product is used**: the structure was rebuilt from Harvest's shared shadcn components and Studio Admin tokens, "Create task in list" became "Save to CRM", and the hosting-vendor branding toggle was left out.

Kit rule, founder 21 Nov 2026: "Use anything that is pro in the kit. If nothing is suitable then use free." Searched: the 22 premium `form-layout` blocks, `checkout`, `customer-reviews` and `review-card` (Shadcn UI Kit registry, retrieved 2026-11-21, fetched from `https://shadcnuikit.com/r/<name>.json`), and the founder's premium repositories `bumbmatei-sys/admin-dashboard` (1631106) and `bumbmatei-sys/chat-app` (66fd523), which contain no form builder, rating, signature or dropzone. Percentages are the share of the Harvest file's non-blank lines unchanged from the kit file, measured with `scripts/ui-identical.sh` (commands in `docs/acceptance/crm-forms-builder.md`).

| Block | Harvest file | Source used | Form | Identical lines |
| --- | --- | --- | --- | --- |
| Choice list (radio cards) | `src/components/forms/kit-radio-cards.tsx` | `form-layout20` (premium) | **derived** | 15 of 30 (50%) |
| Multiple choice (checkbox cards) | `src/components/forms/kit-checkbox-cards.tsx` | `form-layout20` (premium) | **derived** | 15 of 30 (50%) |
| Files (inert drop zone) | `src/components/forms/kit-drop-zone.tsx` | `form-layout15` (premium) | **derived** | 10 of 18 (55%) |
| Rating | `form-fields.tsx` | none (Harvest-written) | - | The premium review items only display stars; none is an input and no free item is either. |
| Signature | `form-fields.tsx` | none (Harvest-written) | - | No kit item is a signature pad. |
| Text, number, date, dropdown, checkbox, Yes/No | `form-fields.tsx` | shadcn primitives | - | Plain primitives; the premium form blocks are whole-page react-hook-form screens, not reusable fields. |

The free items first tried (`radio-group8`, `checkbox9`, `file-upload1`) were replaced by the premium ones above. Everything else (the field renderer, one-per-page form, builder canvas, add-question menu, settings sidebar, forms list and new-form flow) is written for Harvest on shared components (DataTable, EmptyState, Collapsible, Popover, DropdownMenu, Tabs, `useContextualSidebar`, `useUnsavedChangesGuard`). New dependencies, approved by the founder on 21 Nov 2026: `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2 and `@dnd-kit/modifiers` 9.0.0 (all MIT, `@dnd-kit/core` 6.3.1 was already installed).

### CRM reports screen

Route `/workspaces/[tenantId]/crm/reports`. Premium kit repository `bumbmatei-sys/admin-dashboard` (commit `1631106`, no secrets copied), `ai-analytics` dashboard page. Approval basis: the founder's 17 Nov standing kit rule, his 20 Nov decision that every dashboard and report uses the kit's dashboard blocks, and the 22 Nov CRM reports decisions (`docs/decisions/founder-decisions-2026-11.md`); there is no per-item approval, so the PR names the three files. Shared infrastructure reused unchanged: `src/components/ui/chart.tsx` (copied earlier for Social Analytics), Card, Table, Tabs, Badge, Alert, `EmptyState`, `AccessState`. Percentages are measured with `scripts/ui-identical.sh` against the kit commit and recorded in `adminDashboardProvenance`.

| Harvest file | Status | Kit source (`app/dashboard/(auth)/ai-analytics/components/`) | Identical lines | Harvest notes |
| --- | --- | --- | --- | --- |
| `src/components/crm/reports/report-stat-cards.tsx` | **derived** | `stat-cards.tsx` | 26 of 61 (42%) | Card, figure and tick-segment bar kept; real readings, withheld figures read "Fewer than 5" with no bar, chart tokens instead of palette colours. |
| `src/components/crm/reports/report-bars-card.tsx` | **derived** | `usage-by-model-card.tsx` | 10 of 65 (15%) | Titled card with a bar chart; horizontal bars, real data and a table carrying every figure. Mostly shared imports. |
| `src/components/crm/reports/report-period-tabs.tsx` | **derived** | `time-range-tabs.tsx` | 9 of 28 (32%) | Fixed periods, 44px targets below 1024px; generic over its periods since the newsletter analytics screen (7, 30, 90 days). |
| `src/components/crm/reports/report-trend-card.tsx` | **derived** | `hotel/components/campaign-overview.tsx` (path under `app/dashboard/(auth)/`) | 10 of 57 (17%) | Newsletter analytics daily and audience growth charts: titled card with a multi-line recharts chart, legend, gaps for withheld and no-data days ("No data yet" in the table), an optional slot above the chart (net change) and a table carrying every figure. Re-measured 27 Nov 2026 for audience growth; no new kit item. The kit's range select, download button, summary boxes and sample data are not used. Approval: founder's standing instruction "Use anything that is pro in the kit. If nothing is suitable then use free" (forms-builder discussion, Nov 2026) and his reminder on 24 Nov 2026 "don't forget to use the paid ui kit for charts"; no preview link was recorded. |

`reports-view.tsx` and the page have no kit source (Harvest composition). `recharts` is the dependency already approved for Social Analytics; `motion` is not used here.

## Event cover picker (22 Nov 2026)

The cover image control on the owner event form. Kit rule, founder 21 Nov 2026: pro first, otherwise free. Searched: the founder's premium repositories `bumbmatei-sys/admin-dashboard` (1631106) and `bumbmatei-sys/chat-app` (66fd523), and the already adopted `form-layout15` drop zone. Used as the model: the premium single-image drop zone of `app/dashboard/(auth)/apps/pos-system/components/add-product-dialog.tsx` (dashed rounded zone, icon circle, title, type and size hint, Select image button, dragging tint, focus ring, inline error line). **No kit code is copied**: measured with `scripts/ui-identical.sh` on 22 Nov 2026, 4 of 123 lines (3%) of `src/components/events/event-cover-picker.tsx` match, import and boilerplate only, so the file is "modelled on". `form-layout15`'s `kit-drop-zone.tsx` was not reused: it is inert (aria-disabled, its own dashed border, no input, no preview). The kit's `useFileUpload` hook (blob preview, no upload) is not used; upload, progress and verification use Harvest's `putFile` and the event cover routes. Everything else is shared Harvest components (Field, Button, Progress, Spinner, ConfirmDialog, toast helper, `useUnsavedChangesGuard` through the form). Record: `src/lib/ui-provenance.ts` (`adminDashboardReferences`). No new dependency.

## Newsletter sign-up forms (24 Nov 2026)

Public > Newsletter > Sign-up forms. Kit rule, founder 21 Nov 2026 ("Use anything that is pro in the kit. If nothing is suitable then use free"). Searched: the founder's premium repositories `bumbmatei-sys/admin-dashboard` (1631106) and `bumbmatei-sys/chat-app` (66fd523), read-only, plus the premium blocks already adopted for forms. **No new kit file was copied; no new provenance entry is needed.** The screen is composed from shared Harvest components that already carry their provenance:

- the forms builder (`FormEditor`, `BuildCanvas`, `FormSettingsPanel`, `PublicForm`, `FormField`: Harvest-written with the `form-layout20` and `form-layout15` derivations recorded above), extended with a newsletter variant rather than copied;
- the sign-ups counts use the premium `ai-analytics` `stat-cards` block through the existing `ReportStatCards` (derived, 26 of 61 identical lines, recorded above);
- `DataTable` (premium `tables14`), `EmptyState` (premium `empty-state15`), `FormSection` (premium `form-layout1`), `CopyButton` (premium `tables21`), `StatusBadge`, `Dialog`, `AlertDialog`, `DropdownMenu`, `Tabs`.

The QR code is the existing Connect renderer (`qrSvg`, `qrPng`) served by a new owner/admin route; the public sign-up page and confirm page are Harvest-written (no kit block fits a public sign-up). Nothing from the reference screenshots is used.

### Docs (Operations > Office > Docs, slice 1)

List and editor. Founder rule (24 Nov): "design of the reference, style of Studio Admin"; pro first, otherwise free (the founder's approval: "Use anything that is pro in the kit. If nothing is suitable then use free").

- **Kit blocks used (premium, bumbmatei-sys/admin-dashboard at `1631106`)**: `components/ui/custom/tiptap/` (`rich-text-editor.tsx`, `toolbars/editor-toolbar.tsx`, `toolbars/color-and-highlight.tsx`, `toolbars/headings.tsx`): the toolbar groups and the editor wiring, and `file-manager` (`summary-cards.tsx`, `apps/file-manager/file-manager.tsx`) for the list. **No kit file is copied**; every Harvest file is written for Harvest on the shared Toggle, DropdownMenu, Popover, Tooltip, DataTable, EmptyState, ConfirmDialog, Breadcrumb, Sheet and Tabs. Measured with `scripts/ui-identical.sh` on 24 Nov 2026: toolbar.tsx 0% and 5%, doc-editor-surface.tsx 8% (imports and boilerplate). Recorded in `src/lib/ui-provenance.ts`.
- **Not in the kit, free or Harvest-written**: the slash menu, block handles (Tiptap drag handle, MIT), banners, columns, table of contents, page tree, page styles panel and the Docs menu. `Toggle` (`src/components/ui/toggle.tsx`) is the shadcn toggle, free.
- **Engine**: Tiptap free core, MIT, approved for Docs: `@tiptap/extension-table`, `-text-style`, `-highlight`, `-text-align`, `-details`, `-drag-handle`, `-drag-handle-react`, `suggestion` (all 3.33.1). The kit's own Tiptap extensions (image placeholder, search and replace) are not used.
- **Slice 2 (collaboration)**: the right rail, side panels, share dialog, menu popover, templates, relationships, history and print view are written for Harvest on shared components (Tabs, Popover, Sheet, Dialog, DropdownMenu, Switch, NativeSelect, Badge, Alert); no kit file is copied, so no provenance entries are added. Tabs without panels drop `aria-controls` so axe stays clean.
- **Reference screenshots** (the founder's 22 images of a document editor) are the layout and flow reference only: no branding, copy, imagery or vendor names are reproduced.

### Ministry settings redesign (24 Nov)

Premium kit `bumbmatei-sys/admin-dashboard` (commit `1631106`), under the founder's standing instruction "Use anything that is pro in the kit". Modelled on, no kit code copied (identical lines by `scripts/ui-identical.sh`): `src/components/settings/settings-section.tsx` (1 of 15, 6%, from `pages/settings/layout.tsx`), `src/components/ministry-type-cards.tsx` (3 of 19, 15%, from `pages/settings/appearance/page.tsx`), `src/components/time-zone-combobox.tsx` (from the language combobox in `pages/settings/account/page.tsx`). Used by the Ministry settings page and the Settings pop-up ministry section. Listed in `src/lib/ui-provenance.ts` (`adminDashboardReferences`).

### Campaign wizard screens (25 Nov)

Founder approved the kit list on 25 Nov 2026: `stepper1` inside the shared EditorShell (autosave and resume); `form-layout1` and `form-layout11` for the step forms (type, name, goal, place, dates, budget); `tables9` member list plus an invite dialog for leaders and teams; `switch-card1` toggle cards for the tools (QR, registration, follow-up, communities); a summary card and `todo-app6` setup checklist for review and finish; stat cards and charts as in CRM reports for the campaign dashboard. Design is the PRD (`docs/prd/harvest-campaign-wizard.md`), style is Studio Admin.

**PR 1 (steps 1 to 3, drafts list, Activate) copies no kit code.** It composes the shared pieces that already carry their own provenance headers: `Stepper` (from `stepper1`), `WizardLayout` and `FormSection` (from `form-layout20` and `form-layout1`), `Field`, `ConfirmDialog`, and the EditorShell editing sidebar. New files are Harvest-written (`src/components/campaigns/*`). The remaining approved items are recorded with the PR that first copies from them, with the identical-line measurement.

**Campaign type artwork (25 Nov).** `src/components/campaigns/campaign-type-art.tsx` (`CampaignTypeArt`, `CampaignCoverPlaceholder`), used by `src/components/campaigns/type-cards.tsx`: original code-drawn artwork (inline SVG and CSS gradients, one line motif per type: stage and light beams, flight path over a globe, screen and seat rows, street map with a pin, modular blocks). Layout idea from ClickUp template gallery screenshots shared by the founder (a template card with coloured header art above a title and short description); no assets, visuals, branding or copy copied. The colours are the palette's semantic art tokens `--art-1..5-from/to/glow/ink` (each theme in `src/lib/theme-registry.ts` defines them; Harvest uses a gold-led family); card chrome and text stay on the theme tokens. No kit code, no new dependency, so `src/lib/ui-provenance.ts` is unchanged.

**Accent colours and `AccentIcon` (25 Nov).** `src/components/accent-icon.tsx` and the accent and artwork tokens in every palette of `src/lib/theme-registry.ts` (`ACCENTS`, `ART_SLOTS`, `PALETTE_EXTENSION_TEMPLATE`) are Harvest-written, with no kit code. The founder asked for a premium look led by the Harvest gold with only a few colours: `--accent-primary` (Harvest: Desert Sun) plus up to three supporting tones (Sage, Misty Blue, dark olive), Cream for soft fills, and five art families in the same earthy palette (founder palette, 25 Nov). All are semantic tokens that future themes remap; see the "Accent and artwork tokens" section in `docs/design-system.md`. The campaign wizard uses `--accent-primary` for the step chips, the accent line on the step card (`WizardLayout` reads `--accent-current`), the phone progress bar (`EditorStepBar`) and the selected type card. Drafts and campaign rows show `CampaignCoverPlaceholder` thumbnails.

### Courses and products screens (25 Nov)

Founder approved these kit items on 25 Nov 2026 (founder, in the task that started this work: "the course screens/pages are in the admin dashboard repo in my GitHub"): from premium `bumbmatei-sys/admin-dashboard` (commit `1631106`) the Courses app (list, course detail, modules, content, study progress; `app/dashboard/(auth)/apps/courses`), the academy progress cards (`app/dashboard/(auth)/academy`) and Products list, create and detail (`app/dashboard/(auth)/pages/products`); and from the registry `product-list7`, `product-details1` and the product-card set, plus `stepper1` and `form-layout1` inside the shared EditorShell (already adopted). Recorded as `kitApprovals` in `src/lib/ui-provenance.ts`. Design is the free courses and products proposal (`docs/superpowers/specs/2026-11-17-free-courses-products-design.md`) and the Eden type picker structure (read-only screenshots, never copied); style is Studio Admin.

**Read and used.** The checkout of `admin-dashboard` at `1631106` was read. **Registry items not read.** `product-details1` and the product-card set could not be read in this environment (no registry token), and `product-list7` was already adopted for Discover (Kit PR 7); no code from any of them is used here, only the admin-dashboard pages above as structural references. **No kit code is copied.** Every new file is Harvest-written on shared components and starts with the modelled-on header. Measured with `scripts/ui-identical.sh` (identical non-blank lines, imports and closing tags only):

| Harvest file | Kit source | Identical |
| --- | --- | --- |
| `src/components/catalog/catalog-list.tsx` | `pages/products/product-list.tsx` | 5 of 82 (6%) |
| `src/components/catalog/lesson-list-editor.tsx` | `apps/courses/components/course-modules.tsx` | 6 of 73 (8%) |
| `src/components/catalog/catalog-file-picker.tsx` | `pages/products/create/add-product-form.tsx` | 5 of 101 (4%) |
| `src/components/catalog/catalog-preview.tsx` | `pages/products/[id]/page.tsx` | 3 of 27 (11%) |

What the screens take from the kit: the product list's name cell with a thumbnail, status badge and row actions (on `DataTable`, with the type tab and search); the course modules card's numbered rows with a current marker (the lesson editor's ordered rows, and the learner's lesson list); the study progress card's titled progress bar (shown as "Your place", lesson n of m, because the server stores no completion yet); the course detail page's main column and side column with a sheet below 1024px; the product detail's cover, badges and side card. Not used: prices, stock, ratings and reviews, sales cards, instructor and avatar images, remote images and fixture data, `motion`, TanStack Table, drawer. **Type art.** `src/components/catalog/catalog-type-art.tsx` is original code-drawn artwork in the same family and tokens as `CampaignTypeArt` (`--art-1..5-*` from the palette registry; Desert Sun for downloads, Misty Blue for courses), with the structure of the Eden "new product" type picker (one illustrated card per type) as the only design input; no Eden asset, colour or copy is used.
| `src/components/catalog/course-learner.tsx` | `apps/courses/course-detail/page.tsx`, `components/study-progress.tsx`, `components/course-modules.tsx` | 5 of 70 (7%), 7 of 70 (10%), 6 of 70 (8%) |
| `src/components/catalog/catalog-public-page.tsx` | `pages/products/[id]/page.tsx`, `apps/courses/components/instructor-section.tsx` | 4 of 59 (6%), 7 of 59 (11%) |

**Course structure (27 Nov 2026, migration 0130).** `lesson-list-editor.tsx` and `course-learner.tsx` were extended with Harvest code only: optional level cards and bordered section groups around the same lesson cards, the course's own names for levels, sections and lessons, a video link field, and grouped headings in the learner's list. The lesson video player `src/components/catalog/lesson-video.tsx` is original Harvest code (a click-to-load facade on shared tokens), with no kit item. No new kit item was installed or used, so the identical shares above can only have fallen; they were not re-measured because the kit source was not in that session.

## Link in bio (24 Nov 2026)

Layout reference for the public page and editor preview: the founder named the OpenShadcnBlocks user-profile blocks (restriction lifted 22 Nov). The host was not reachable from the build environment (egress refused), so its licence could not be verified and **nothing from it was used**. Instead the premium kit's `user-profile` template page (`/home/user/admin-dashboard` @1631106, `app/dashboard/(auth)/pages/user-profile`: profile header with avatar, bio and social row) served as a **visual reference only**; no kit code, images or copy were copied, so no file carries a kit header and `kitProvenance` is unchanged. Controls are the existing free shadcn primitives. Social network marks reuse `PlatformLogo` (Simple Icons, CC0, already recorded above). Layout of the profile photo control reuses `EventCoverPicker` (already derived from the kit's `add-product-dialog`, recorded in its header).

Layout reference (25 Nov 2026): the public page and live preview follow the OpenShadcnBlocks `user-profile3` layout the founder pasted (cover banner, round photo overlapping it, name and subtitle, main action button, tabs, bordered divided list card), refined by the founder as a profile-page idea (social icon row, details list, Home and Partnership tabs; no third-party branding, visuals or copy). **No code copied; licence unverified** (the host is blocked from the build environment). Built from Harvest shared components (Tabs, Button, Card-style borders, `EventCoverPicker`, `PlatformLogo`) and Tailwind container queries.

### Ads screens (25 Nov 2026)

Founder approval 25 Nov 2026, under the kit item approval gate. Approved kit items: shared `DataTable` (`tables14`; `tables15` and `tables9` as alternates), `switch-card1` style for the per-row switch, `dashboard-dropdown7` for the columns picker, the stat cards used in Social Analytics and the CRM reports, `drawer1` for the right-side edit panel, `stepper1` and `form-layout1` inside the shared `EditorShell` for guided create, `social-media-post1` for the live ad preview, `badge1` (the shared `StatusBadge`) and the existing alerts. **No kit source was retrieved or copied.** Every Ads file is Harvest-written on the shared components and carries a header that says it is modelled on the named items; the record is `adsKitApprovals` in `src/lib/ui-provenance.ts`. The structure (a three-level Campaign, Ad set, Ad table with a totals row, a columns picker, per-row switches, an edit drawer, a guided create flow with a live preview) is taken from an ads manager; **no network branding, colour, icon or copy is used.**

| File | Relation | Reference | Notes |
| --- | --- | --- | --- |
| `src/components/ads/ads-table.tsx` | modelled on | `tables14`, `switch-card1`, `dashboard-dropdown7` | Builds on the shared `DataTable`, which gained an optional `totals` row (table) and summary block (cards). |
| `src/components/ads/ads-edit-panel.tsx` | modelled on | `drawer1` | Shared `Sheet`; every spend-affecting change asks first. |
| `src/components/ads/ads-summary.tsx` | reuse | Social Analytics `StatCard` | No new card. |
| `src/components/ads/ad-steps.tsx` | modelled on | `stepper1`, `form-layout1` | The step bodies sit in the shared `EditorShell` and `WizardLayout`; the goal, format and post pickers reuse `RadioCards` (which gained an `aria-label` on each radio so axe names them). |
| `src/components/ads/ad-preview.tsx` | modelled on | `social-media-post1` | A plain stand-in for a feed post: account, text, media, headline, button. |

**Ads overview, account health and rules (26 Nov 2026).** No new kit item: the founder's 25 Nov Ads approval (stat cards and charts as in Social Analytics and the CRM reports, `tables14`, `switch-card1`, `drawer1`, `badge1`) covers every piece, and no kit source was retrieved or copied.

| File | Relation | Reference | Notes |
| --- | --- | --- | --- |
| `src/components/ads/ads-overview.tsx` | reuse | Social Analytics `StatCard`, `SeriesCard`, `RangePicker`, `useEntrance` | Four stat cards and the per-day chart. `SeriesCard` became generic over its measure list and gained an optional value format; `StatCard` gained `upIsGood` so a rising cost reads red. No new card or chart. |
| `src/components/ads/ads-attention.tsx` | reuse | shared `Card`, `StatusBadge`, `EmptyState` | The needs-attention list; every line is text with a severity badge. |
| `src/components/ads/ads-account-health.tsx` | reuse | shared `Card`, `StatusBadge`, `Button` | One card per ad account with the eight named checks. |
| `src/components/ads/ads-rules.tsx` | modelled on | `tables14`, `switch-card1`, `drawer1` | Shared `DataTable`, `Switch`, `Sheet`, `Dialog` (as in the lead form dialog), `ConfirmDialog`. Listed in `adsKitApprovals`. |

## Discover screens (25 Nov 2026)

Founder approved the kit list on 25 Nov 2026: `product-category` (category tiles), the `product-card` set (result cards for communities, courses and products), `product-list7` (results grid, already referenced by the community Discover card), `product-quickview` (quick look), `switch-card1` (owner List in Discover card), `tables14` (shared DataTable, already adopted) with `drawer1` (staff review side panel), plus the shared filter popover pattern from CRM, the shared EmptyState and ConfirmDialog. Pro kit first, free shadcn only if nothing fits. The registry entries were read on 25 Nov from `https://shadcnuikit.com/r/{name}.json` (the paid kit checkout `/home/user/admin-dashboard` @ `1631106` holds no ecommerce blocks); nothing was committed from them.

Variants used: `select14` (searchable category dropdown with icons, chosen by the founder 25 Nov; it replaced the `product-category3` tiles, removed), `product-card1` (with `product-card2` and `product-card3` read for the badge and button row), `product-quickview2` (the compact dialog; `product-quickview1` read). Each is a **visual reference only: no kit code was copied**, so the identical-line share by `scripts/ui-identical.sh` stays low: `listing-card.tsx` 6 of 52 (11%), `quick-look.tsx` 5 of 40 (12%), `category-tiles.tsx` 2 of 24 (8%), `discover-browser.tsx` against `product-list7` 9 of 100 (9%), `list-in-discover.tsx` against `switch-card1` 5 of 90 (5%). All of it is imports and generic JSX shape. The kit's remote photos, ratings, wishlist, colour and size pickers, add to cart and sample data are not used: the public Discover data carries no cover image, rating or price beyond free, and Harvest never invents them.

| Registry item | Free/premium | Retrieved | Approved (founder) | Files | Local changes |
| --- | --- | --- | --- | --- | --- |
| `product-card1` | premium | 2026-11-25 | 2026-11-25 | `src/components/discover/listing-card.tsx` | Token-coloured category mark instead of a photo, type badge, name, summary, host, free badge, first joining route, Quick look, View and Report. Reused (26 Nov, C13/C16) by the community Classroom and Products tabs (`src/components/communities/community-shelf.tsx`): Quick look and Report are optional, an empty host line is left out, and an `action` slot replaces View with the free enrol, Continue or Open step. No new kit item. |
| `product-quickview2` | premium | 2026-11-25 | 2026-11-25 | `src/components/discover/quick-look.tsx` | Compact dialog with the public fields as a definition list, Report and Open page. |
| `select14` | premium | 2026-11-25 | 2026-11-25 | `src/components/searchable-select.tsx` | Shared searchable select with icons and an all row; Discover category filter. 26% identical lines (imports, trigger). |
| `product-list7` (second file) | premium | 2026-11-25 | 2026-11-25 | `src/components/discover/discover-browser.tsx` | Result count, type tabs with facet counts, search and grid on the server's approved listings. |
| `drawer1` (second file) | free | 2026-11-25 | 2026-11-25 | `src/components/discover/staff-review.tsx` | Right-hand Sheet (bottom sheet on phones) with the listing's public fields, the review actions and the ministry standing, around the shared DataTable (`tables14`, already adopted) with tabs Pending, Approved, Rejected, Suspended and Reports. No kit code copied (3 of 192 lines identical, 2%), no vaul drawer. |
| `switch-card1` (second file) | premium | 2026-11-25 | 2026-11-25 | `src/components/discover/list-in-discover.tsx` | Label, one line of text and a switch, with review status, category and language beneath; used in the community editor and My listings. |

The shared filter popover is Harvest's CRM pattern (an icon-only filter button with a popover), reimplemented in `src/components/discover/filter-popover.tsx` for three fields because the CRM filter builder is bound to CRM fields (`src/components/crm/filter-builder.tsx`); exception recorded here, not a kit item.

### Campaign wizard steps 4 and 5 (25 Nov)

Steps 4 and 5 and the invitation page copy no kit code. They compose shared shadcn components (`Switch`, `Dialog`, `Badge`, `NativeSelect`, `Field`, `Card`) in the shape of the approved `switch-card1` and a plain department card; the kit items stay approved for later screens.

## Ways to give logos (26 Nov 2026)

Founder request (26 Nov): show the real brand logo for every "Ways to give" method except bank transfer, which keeps its generic bank icon. The marks are used only to identify the ministry's own giving accounts; they remain their owners' trademarks and imply no endorsement, partnership or integration (Harvest still calls, fetches and processes nothing for these methods).

- **Source:** Simple Icons, npm `simple-icons@16.38.1` (https://simpleicons.org). The package tarball was downloaded with `npm pack` into a scratch directory outside the repository; its `LICENSE.md` is CC0 1.0 Universal and `package.json` declares `CC0-1.0`. Only the twelve SVG `path` strings and each icon's `hex` were copied into `src/components/giving/giving-logos.tsx` (provenance header in the file). `simple-icons` is **not** a dependency.
- **Logos taken (12):** PayPal, Wise, Venmo, Zelle, Revolut, Cash App, GoFundMe, Every.org, JustGiving, Patreon, Ko-fi, Buy Me a Coffee.
- **Left generic (9):** Bank transfer (bank icon, by decision). Donorbox, Givebutter, Tithe.ly, Pushpay, Planning Center Giving, Subsplash Giving, Givelify and Zeffy are not in Simple Icons 16.38.1, and their own press kits and logo terms could not be reached from the build environment (egress refused), so no mark could be verified; they show a generic link icon. No brand mark was drawn or guessed. Any of them can get its official mark later from the brand's press kit once its terms are checked.
- **Colour:** each mark sits on a neutral chip (`bg-muted`, the theme's `--surface-sunken`) and uses the brand's Simple Icons colour in a mode only where it meets 3:1 non-text contrast against that chip in every registered theme; otherwise it is drawn in the chip's text colour (`currentColor`). Values in `src/lib/theme-registry.ts` (`givingBrandFill`, `light-dark()` per mode), checked in `tests/unit/giving-logos.test.ts`.
- **Where shown:** the owner list (row chip) and the kind picker (shared `SearchableSelect`, now typed to take any icon component), the "What visitors see" preview, the public link-in-bio block and the embeddable `WaysToGive` component. Marks are `role="img"` with the method's kind name as the accessible name; in the kind picker they are decorative because the name is the option text.
- **Temporary:** GoFundMe (logo) and Donorbox (generic) are removed, with their entries in `givingLogos`, `givingGenericKinds`, `givingBrandFill` and `givingLogoProvenance.temporary`, by the PR that adds a payment provider for donations.

Record: `givingLogoProvenance` in `src/lib/ui-provenance.ts`. No kit items are used; Harvest's existing `Item`, `ItemMedia`, `SearchableSelect`, `Button` and `CopyButton` are reused.
