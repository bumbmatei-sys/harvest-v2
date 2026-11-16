# Three-mode shell and right-hand pane: design spec

Status: DRAFT proposal, 16 Nov 2026. Documentation only. Nothing here is approved or built. Approves no deployment, activation or provider call.

## Summary (10 lines)

1. One sidebar, three modes: **Operations**, **Public**, **Assistant**. A switcher at the top of the sidebar picks the mode; each mode shows its own full sidebar.
2. Recommendation: add a required `mode` field to every registry entry (`src/lib/navigation.ts`). The active mode is derived from the current URL via the matching entry; a manual choice only applies on neutral pages (home, profile, settings).
3. Routes do not change. The ministry switcher stays in the profile menu. Permissions, audience filtering and feature gates stay exactly as today.
4. Entries whose module is not built are hidden, never linked. A separate "coming soon" row is opt-in per entry and not a link.
5. Switcher: three icon+label segments at the top of the sidebar (desktop); icon-only in the rail; a segmented control at the top of the drawer on phones (44px targets).
6. Pane: any allow-listed page opens beside the current page. Recommended architecture: the same route rendered client-mounted inside the pane through a dedicated embed route group, URL state `?pane=<id>`, same origin, same cookies, no iframe.
7. Pane header: title, open full page, close. Remembers its last page per user in localStorage (never required). Shortcut proposed: Alt+P toggles, Alt+click on a sidebar icon opens that item.
8. Assistant mode owns chat and history in its sidebar; the pane can also host the assistant. This spec defines the frame and context contract only. No AI runtime, no data leaves without permission, actions need approval.
9. Delivery in 8 small PRs; the first two (registry `mode` + resolver, then switcher UI) change no routes and need no migration.
10. Founder decisions needed are in section 13, each with a recommended default.

## 1. Goal and non-goals

Goal: a shell where internal work, outward-facing publishing and the assistant are separated by mode, any page can sit beside another page, and the assistant is a first-class place rather than a modal.

Non-goals: new routes or URL renames; building any listed module that does not exist; the AI runtime, model routing, Composio plugins or tool execution; replacing the ministry switcher; changing permissions or audiences; theming beyond existing tokens; email/calendar/Files provider work (Zernio layer is separate); any deployment or production activation.

Design source: the pane, the sidebar item icon and the two-icon mode switch come from the Eden reference screens (layout and information architecture only: `15-ai-assistant/ai-018` shows the chat pane beside the Publish composer with `?pane=chat` in the URL and an "Open in Pane" affordance on the sidebar item; `14-social-scheduler/social-031` is the same page without the pane; `16-ui-system/shell-026/027` the sidebar). Visual style is Studio Admin through the shared shadcn components (floating sidebar, existing tokens). No Eden visuals, branding or copy are reproduced, and no image is copied into this repo.

## 2. Today (verified in the checkout)

- `src/lib/navigation.ts`: `navEntries` with `id, group, label, icon, path, match, sectionMatch?, permission?, audiences?, audienceLabels?, feature?`. Groups are `crm | workspace | settings`. `resolveNavigation` filters by feature, permission (`can(role, ...)`) and audience; `sectionLabel` feeds the breadcrumb.
- `src/components/app-shell.tsx`: floating `Sidebar` (`collapsible="icon"`), one `nav`, the account menu with the ministry switcher at the bottom, header with breadcrumb, `NotificationsMenu`, `<main id="main-content">`, full-width content (`p-4 lg:p-6`).
- `src/components/ui/sidebar.tsx`: shadcn sidebar, `Ctrl/Cmd+B` toggles it, cookie `sidebar_state`; `useIsMobile` uses `max-width: 1023px`.
- `src/app/workspaces/[tenantId]/layout.tsx` (server) loads the session and workspaces and renders `AppShell`.
- Built entries today: people, companies, pipelines, tasks, imports, campaigns, follow-up, files, communities (feature-gated), CRM fields, pipeline settings, appearance, ministry settings. Existing page routes under `/workspaces/[tenantId]/`: `crm/*`, `contacts/*`, `campaigns/*` (incl. `connect/*` QR, forms, landing, preview, present), `connect/follow-up/*`, `communities/*`, `files`, `settings`, `appearance`.

## 3. Mode model

Three modes: `operations | public | assistant`.

### Option A (recommended): `mode` on each registry entry

Each `NavEntry` declares `mode`. The resolver returns groups for one mode. The current mode is the mode of the entry whose `match` fits the pathname; on pages that match no entry (workspace home, profile, `/workspaces`), the mode comes from the last explicit user choice (localStorage, default `operations`).

Pros: one source of truth; the registry already owns `match`, permission, audience and feature, so the new dimension reuses the same tests; entries added by later modules cannot forget a mode (the type requires it); breadcrumb and switcher agree. Cons: a page that logically belongs to two modes (for example Files, a campaign page that also publishes social posts) needs one owner; cross-mode links are normal navigations that switch the mode.

### Option B: route-based (path prefixes per mode)

A table `prefix -> mode`. Pros: no change to entries. Cons: a second matcher that can disagree with `match`; today's routes are not grouped by mode (`/campaigns`, `/files`, `/communities` are siblings), so prefixes cannot express it without renaming routes, which is forbidden. Rejected.

### Option C: user-chosen mode only (state, no derivation)

Pros: trivial. Cons: opening a deep link or the back button can show a sidebar that does not contain the current page. Rejected as the sole rule; kept only as the fallback for neutral pages.

Rules (Option A):
1. Navigating to an entry's route sets the mode to that entry's `mode`.
2. Clicking a mode only changes the visible sidebar (and remembers it as the neutral-page default); it does not navigate. Exception: the Assistant mode's first item is the assistant home, so choosing Assistant on a neutral page may open it. Recommended default: choosing a mode never navigates; the sidebar's first item is the obvious next click.
3. The mode is not stored in the URL; it is a function of the URL. This keeps deep links stable and the server-rendered sidebar correct on first paint (the resolver is pure and can run in the layout for the initial mode).

## 4. Navigation registry changes

Types (proposal, names indicative):

- `NavMode = "operations" | "public" | "assistant"`; `NavEntry.mode: NavMode` (required).
- `NavEntry.status?: "live" | "planned"` (default `live`). `planned` entries are never rendered as links.
- `NavEntry.pane?: "allow" | "deny"` (default `deny`; see section 8) so the pane allow-list lives next to the route it describes.
- `NavEntry.paneId?: string` stable key used in `?pane=`.
- Groups are scoped to a mode: `NavGroupId` extends (for example `people`, `connect`, `office`, `publishing`, `audience`, `commerce`, `chat`); `groups` becomes `groupsByMode: Record<NavMode, readonly Group[]>`.
- Labels use new keys in `ComponentsAppShell` messages (catalogue-only, provider-neutral: no vendor names in user copy).

Resolver:
- `resolveNavigation({ tenantId, role, audience, pathname, features, mode })` returns `{ mode, groups }`; it still filters feature, then permission, then audience. Order of filters is unchanged so existing tests keep their meaning.
- New `resolveMode({ pathname, entries, fallback })` and `modeAvailability({ role, audience, features })` (a mode with zero visible entries is hidden from the switcher; the Assistant mode needs at least its home entry visible, which is gated by a feature flag until the runtime exists).
- `sectionLabel` is unchanged.

Audience/permission interplay: filtering happens per entry before grouping; an empty group disappears; an empty mode disappears from the switcher. Example: a viewer in a church sees Operations (people read-only, if `crm:read`) but may see no Public entries, so the Public segment is hidden. The server still enforces access on every route; the sidebar is presentation only (as today).

Entries not yet built: stay in the registry with `status: "planned"` and are filtered out by default. Optional, per entry, a non-interactive "Coming soon" row (`aria-disabled`, no `href`, no focus) behind one dev/preview flag, only if the founder asks to advertise modules. Never a link that 404s. Recommended default: hidden.

## 5. Proposed entry list per mode

Legend: **exists** = page built in this checkout; **planned** = module specified in a PRD/plan but not built; **not started** = no spec or code located. "Route" is the current or intended route below `/workspaces/[tenantId]`; no existing route changes. Intended routes for unbuilt modules are placeholders for their own design specs.

### Operations (internal)

| Entry | Route | State |
| --- | --- | --- |
| People | `/crm/people` | exists |
| Organizations | `/crm/companies` | exists (copy uses "Organizations") |
| Deals (pipelines) | `/crm/pipelines` | exists |
| Tasks | `/crm/tasks` | exists |
| Imports | `/crm/imports` | exists |
| Harvest Connect: QR and links | `/campaigns/[id]/connect` | exists, per campaign; no top-level list yet (planned) |
| Responses | per campaign/Connect | exists in part (forms, intake); central list planned |
| Follow-up cases | `/connect/follow-up` | exists |
| Forms and questionnaires | `/campaigns/[id]/connect/forms` | exists per campaign; standalone builder planned |
| Campaigns | `/campaigns` | exists |
| Events | `/events` | planned (docs/prd 07-events reference) |
| Church profile | `/profile` (ministry) | not started (route to be designed) |
| Volunteers | `/volunteers` | not started |
| Livestream | `/livestream` | not started |
| Giving (donations/finances) | `/giving` | planned (provider undecided; CLAUDE.md payment correction) |
| Email inbox | `/mail` | planned (Zernio layer) |
| Calendar | `/calendar` | planned (Zernio layer) |
| Files | `/files` | exists |
| Docs | `/docs` | not started |
| Spreadsheets | `/sheets` | not started |
| Members and roles | `/settings` (members section) | exists in part |
| CRM fields, pipeline settings | `/crm/settings/*` | exists |
| Ministry settings | `/settings` | exists |
| Appearance | `/appearance` | exists |

Settings entries stay in a final "Settings" group of Operations (owner/admin entries gated by permission as today).

### Public (outward-facing)

| Entry | Route | State |
| --- | --- | --- |
| Composer | `/social/compose` | planned (HC social scheduler, Zernio) |
| Planner / calendar | `/social/planner` | planned; the same planner holds scheduled blog articles |
| Unified inbox | `/inbox` | planned |
| Auto-DM (Instagram, Facebook) | `/inbox/auto-dm` | planned, provider-supported only |
| Blog articles | `/articles` | planned; written in Harvest, scheduled in the planner, sent via the provider layer to external blog platforms (native articles/external distribution are "Post-launch" in CLAUDE.md; this spec only reserves the slot) |
| Website builder | `/website` | not started |
| Link in bio | `/link-in-bio` | not started (docs/prd 11) |
| Newsletter | `/newsletter` | planned (docs/prd 12) |
| Communities | `/communities` | exists (feature-gated; public pages `/communities/:slug` unchanged) |
| Courses and products | `/products` | planned (docs/prd 10; checkout provider undecided) |
| Discover | `/discover` (settings/opt-in at `/discover/manage`, placeholder) | partial (`src/app/discover` public route exists; owner-side entry planned) |
| Coupons | `/coupons` | not started, paid, later |

### Assistant

| Entry | Route | State |
| --- | --- | --- |
| New chat | `/assistant` | planned |
| History (chat list, in the sidebar) | `/assistant/[chatId]` | planned |
| Approvals | `/assistant/approvals` | planned (CRM-08 foundation: read tools + approvals) |
| Plugins | `/assistant/plugins` | not started (Composio, later) |
| Settings (permissions, audit) | `/assistant/settings` | not started |

Open conflict to note (Section 13): the "Communities" route `/workspaces/[tenantId]/communities` and the public `/communities/:slug` coexist today; nothing here changes either.

## 6. Switcher UI

Desktop (>=1024px, expanded sidebar): directly under the brand row, a three-segment control: icon + short label per mode (Operations, Public, Assistant). It is a `role="tablist"` with `aria-controls` the nav; arrow keys move, Home/End jump; the selected tab has `aria-selected`. Rendered with shared shadcn `Tabs`/`ToggleGroup` primitives; no new component library.

Collapsed icon rail: the three segments stack as icons with tooltips (name + keyboard hint), same behaviour as today's collapsed items. The selected mode's items show as the icon rail.

Tablet (768 to 1023px): the sidebar is the off-canvas drawer (`useIsMobile` is `max-width:1023px`), so tablet and phone share one behaviour: the same segmented control at the top of the drawer.

Phone (<768px): recommended default is the segmented control at the top of the drawer (a persistent, predictable location, thumb-reachable because the drawer opens from the left and the control is the first element). Alternative: a bottom sheet from a header button; trade-off: one more tap and a second overlay stacked on the drawer. Targets are 44px (`min-h-11`), per CLAUDE.md.

Keyboard: `Ctrl/Cmd+Alt+1/2/3` selects Operations/Public/Assistant (proposal; verify no browser or OS conflict). `Ctrl/Cmd+B` keeps toggling the sidebar. Focus moves to the first item of the sidebar after a mode change only when the change came from the keyboard. Live region announces "Public menu" on mode change.

A11y: the nav keeps `aria-label`; its label includes the mode name. Active entry has `aria-current="page"`. Colour is never the only selected-state cue (underline/pill + `aria-selected`). Reduced-motion: no animated slide between modes.

## 7. Sidebar per mode

Each mode renders its own groups (section 5), with the existing collapsible group labels and the existing item style. The top of the sidebar is: brand row, mode switcher; the bottom is unchanged (profile menu with the ministry switcher, theme toggle, trigger). The `Workspaces` link remains at the top of Operations only; in Public and Assistant it is not repeated (the profile menu covers it).

Collapsed rail: items become icons with tooltips (as today); each mode remembers nothing extra. Group labels hide in the rail as today. The Assistant sidebar shows the New chat button and the chat history list; in the rail it shows only New chat and a history icon that opens the pane.

Open-in-pane affordance: an icon button at the right edge of each sidebar item, visible on hover and on keyboard focus within the item (always visible at 44px on touch, because there is no hover; on phones it is hidden because the pane falls back to a sheet, see section 10). It is shown only for entries with `pane: "allow"`.

## 8. The pane

### 8.1 Behaviour

- Beside `SidebarInset`'s content, a resizable right column (default 40%, min 320px, max 60%). Below 1280px the pane is an overlay (see 8.6).
- Header: title (from the registry label), "Open full page" (navigates the main area to the pane's route and closes the pane), close. Optional "Swap" (exchange main and pane) is out of scope, noted in open questions.
- Collapsible: closing keeps the last page; the toggle reopens it.
- URL state: `?pane=<paneId>` on the main URL, plus optional `&paneq=<encoded safe query>` for a few whitelisted params (a record id). Reload, deep link, back and forward reproduce the pane. Opening the pane uses `router.push` once (a back step closes it); resizing and in-pane navigation use `replace`.
- The pane's own navigation (links inside it) is kept inside the pane when the target is allow-listed; otherwise the link opens in the main area.

### 8.2 Architecture options

| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| 1. Parallel + intercepting routes (`@pane` slot) | A `@pane` parallel slot in the workspace layout; intercepting routes mirror each allowed page | Native Next.js, server rendering, state in the URL, back/forward correct | Needs a mirror route file per allowed page (`(.)`, `(..)` conventions are brittle with dynamic segments); soft vs hard navigation differences; hard to render the same page twice (main + pane) with different params; today's layout loads everything once, so duplication of session/workspace fetches |
| 2. iframe of the real route | `<iframe src=".../route?embed=1">` | Perfect isolation, no component work | Second app shell inside (must be suppressed), duplicated JS and session work, focus/keyboard trap issues, scrolling and mobile viewport problems, shortcuts and a11y are worse, CSP `frame-ancestors`/`X-Frame-Options` must be relaxed for the same origin (none is configured in `next.config.ts` per my reading; unverified), and the pane cannot share state with the main page |
| 3. Client-mounted route components (recommended) | An "embed" route group renders the same page content component without the shell; the pane fetches that route's RSC payload or client component with the same `tenantId` and renders it in a container | Same origin, same cookies, no second shell, shared state and permissions, one code path per page (page content exported as a component used by both the full page and the pane) | Each allow-listed page must be a pure content component with no dependency on shell-level layout; routes that read `searchParams` need an explicit `paneq` mapping |

Recommendation: option 3, with option 1 reserved if a page needs server rendering in the pane. Pilot with three consumers (the assistant, People list, Tasks) before declaring the abstraction shared (CLAUDE.md: two real consumers). Reject iframe.

### 8.3 Auth, cookies, CSP, tenant scoping

- The pane is the same origin and the same session; no new cookie. Requests carry the existing session cookie. No token is passed through URL or postMessage.
- Tenant scoping: the pane is always for the current `tenantId` in the main URL. A pane target for another tenant is refused (the `paneId` carries no tenant; the tenant comes from the shell). Switching ministry closes the pane and clears the stored page.
- Server enforcement is unchanged: every route and API still enforces `can(...)` and tenant RLS; the allow-list is presentation. A denied page in the pane shows the same access-denied state.
- CSP: no `frame-ancestors` change is needed (no iframe). Any in-pane content must not load new third-party origins; the assistant frame (section 9) renders text only. Unverified: a global CSP may exist outside the files I read.
- CSRF/embedding: pane requests are normal same-origin `fetch`es with the existing checks.

### 8.4 Allow-list

Only entries with `pane: "allow"`; default deny. Proposed allow:

- Allow: Assistant (chat), People and Organizations lists and record pages (read), Tasks, Follow-up cases, Calendar, Email inbox, Unified inbox, Planner (read), Files, Responses, Docs/Sheets viewers.
- Deny: editors and builders that need full width or leave unsaved state (website builder, form builder, landing editor, composer's full editor, imports wizard), settings and billing, destructive or consent screens, anything under `/crm/settings/*`, the pane itself.
- Rule: a page may be allowed only if it works at 320px to 600px width, handles being mounted twice in one window, and has no full-page-only dependency.

### 8.5 Persistence

`localStorage` key per user and tenant (for example `harvest.pane.v1.{userId}.{tenantId}`) stores `{ open, paneId, width, paneq }`. Wrapped in try/catch; the shell renders correctly without it; never required, never shared across devices. URL state wins over storage on load. Switching ministry or role change clears an entry that is no longer visible to the user.

### 8.6 Mobile fallback

Below 1280px the pane is a full-height right sheet (overlay) with the same header; below 768px a full-screen sheet. It traps focus, closes on Escape, restores focus to the opener, and keeps `?pane=` in the URL so Back closes it. On phones the per-item pane icon is hidden; pane opening is via the item's overflow action or the shortcut-equivalent button in the header.

### 8.7 Keyboard

Proposal: `Alt+P` toggles the pane (reopens the last page); `Alt+click` or `Alt+Enter` on a sidebar item opens that item in the pane (Eden uses an Alt-click hint in the same place); `Esc` closes the pane when focus is inside it. `Ctrl/Cmd+Alt+arrow` moves focus between main and pane (optional). Shortcuts are listed in a help dialog and are disabled while typing in an input. Unverified: conflicts with browser or assistive technology shortcuts must be tested.

## 9. Assistant frame (host contract)

This spec defines the frame, not the AI runtime. See `docs/prd/AI-assistant-architecture.md` for the runtime requirements (provider-agnostic, tool registry, memory) and CRM-08 for the existing read tools and approvals.

Host contract between shell and assistant UI (TypeScript shape, indicative):

- Props in: `tenantId`, `role`, `audience`, `surface: "page" | "pane"`, `context?: AssistantContext`.
- `AssistantContext` (what the shell may offer; never sent automatically): `{ route: string; entryId: string; recordRef?: { kind: string; id: string }; selection?: { kind: string; ids: string[] } }`. Ids and labels only; no field contents.
- Events out: `onOpenFullPage()`, `onClose()`, `onRequestContext()`.

Rules (binding for the frame):
1. **No context is sent unless the user grants it** for that message ("Include this page" toggle, off by default, visible state before sending). Selection and record contents are never auto-attached.
2. Context passes ids; the server re-fetches under the user's own permissions and tenant context. The assistant can never see more than the user.
3. Tool calls that read data follow the existing permission gates; any write or outbound action (schedule a post, send a message) requires an explicit approval card, with the audit row written by the existing approval foundation. No outbound message or webhook in tests or preview.
4. Chat history belongs to the user and tenant; stored server-side per the architecture PRD (application-controlled, not a provider's memory). The frame only lists and opens it.
5. The frame works the same in the Assistant mode page (`surface: "page"`) and in the pane (`surface: "pane"`).

## 10. Empty, loading and error states

- Mode switch: instant, no spinner (resolver is pure).
- Pane loading: skeleton in the pane body, header already visible; no layout shift in the main area.
- Pane empty (nothing opened yet): an empty state with the allowed pages as a short list.
- Pane error / access denied: the same page error component inside the pane with "Open full page" and "Close"; main content is untouched.
- Stale stored page (no longer allowed or permitted): pane opens to the empty state, storage is cleared.
- Assistant frame: empty (no chats), loading history, history error, "assistant unavailable" (feature off) with no dead controls.
- A `planned` entry reached by a typed URL is a normal 404 for the page; the sidebar never links to it.

## 11. Responsive and light/dark

Breakpoints: phone <768px (drawer, full-screen pane sheet); tablet 768 to 1023px (drawer, right sheet pane); 1024 to 1279px (sidebar visible, pane overlay); >=1280px (side-by-side pane). 44px targets below 1024px, full-width layouts, no horizontal page scroll. All colours through existing semantic tokens (sidebar, card, border); no hardcoded colours; verified in light and dark. The main area's minimum useful width is protected: opening the pane at 1280px leaves at least 640px for the main page, otherwise the pane becomes an overlay.

## 12. Migration plan (small, independently reviewable PRs)

Each PR names the shared systems reused, records light/dark and responsive evidence, and gets independent review. No migration, route or permission change in any slice.

1. **Registry modes (no UI).** Add `mode`, `status`, `pane` fields and the per-mode groups to `navigation.ts`; classify existing entries; `resolveMode`, `modeAvailability`. Tests: unit for the resolver (every entry has a mode; filters by role/audience/feature per mode; empty mode hidden; planned entries never returned; neutral-page fallback; deep links per route resolve to the expected mode). Existing `tests/unit/navigation.test.ts` stays green.
2. **Switcher + per-mode sidebar** in `AppShell` (desktop, rail, drawer). Persist the neutral-page mode in localStorage. Tests: e2e at 360, 390, 768, 1280, 1440 (switch modes, deep link lands in the right mode, rail tooltips, drawer, keyboard), axe on each, light/dark screenshots viewed, 44px target assertions.
3. **Planned entries and flags.** Add `status: "planned"` entries and the optional coming-soon rendering behind a flag; unit tests that no planned entry ever yields an href; e2e that a viewer/role matrix sees only allowed items.
4. **Pane host (shell only).** Right column, header, URL state, localStorage, sheet fallback, shortcut, with an empty-state page only. Tests: unit for URL/state reducer and storage failure; e2e for open/close/back/forward/reload at all five widths, focus trap and restore, axe.
5. **First pane consumers.** Extract content components for People list, Tasks and Follow-up (existing pages become thin wrappers); allow-list entries. Tests: e2e pane vs full page parity, permission denial in the pane, tenant switch closes the pane.
6. **Assistant mode shell.** Sidebar (new chat, history placeholder), page route and pane consumer using a stub provider; the frame contract and context toggle; no runtime. Tests: unit for context builder (ids only, off by default), e2e for the toggle and empty states, a test asserting no network call carries context without the toggle.
7. **Mode entries per module** as each module ships (one PR per module adds its entry and its pane decision).
8. **Cleanup.** Remove the old single-group sidebar path, update `docs/design-system.md` shell section, component registry and acceptance records.

Rollback: slice 2 behind a build-time/runtime flag so the old sidebar can be restored without a revert until the founder accepts it.

## 13. Open questions for the founder (recommended default for each)

1. Does choosing a mode navigate anywhere? Default: no; it only swaps the sidebar.
2. Mode names in copy: "Operations", "Public", "Assistant" exactly? Default: yes; confirm Christian-terminology wording does not prefer alternatives.
3. Where do Events, Giving and the Church profile sit if they are used publicly (public event pages, donation pages)? Default: Operations owns management; public pages are separate routes.
4. Files and Calendar are Operations; the Planner is Public. Cross-links between them are plain navigations that switch the mode. Default: accept.
5. Blog articles: one slot in Public and the same planner as social posts. Default: reserve the slot now, build when the Post-launch gate lifts.
6. Hide vs "coming soon" for unbuilt modules. Default: hidden.
7. Pane default width and breakpoint (40% at >=1280px). Default: as written; ask for a one-screen prototype review.
8. Shortcuts: Alt+P toggle, Alt+click open in pane, Ctrl/Cmd+Alt+1..3 for modes. Default: as written, pending a conflict test.
9. Should the pane also allow editors in read-only form (for example a landing preview)? Default: preview only, never the editor.
10. Assistant plugins (Composio): who approves each plugin and per-tool permission? Default: owner/admin approval per plugin, per-tool opt-in, every call audited; to be specified in the assistant runtime spec.
11. Per-user vs per-ministry default mode (for example giving a volunteer-role user Operations only). Default: per-user only; role filtering already hides empty modes.
12. Do "Settings" entries belong to Operations or to a mode-independent area (profile menu)? Default: Operations' last group.

## 14. Risks

- The registry becomes the single point of failure for the sidebar; mitigated by the resolver tests in slice 1.
- Rendering the same content twice (main and pane) can double-fetch and duplicate focus targets; mitigated by content components and the allow-list rule.
- Pane + 1280px width leaves little room for dense tables; mitigated by overlay fallback and the minimum main width rule.
- Three modes may feel heavy for a small church with few entries; mitigated by hiding empty modes, and by keeping Operations the default.
- Keyboard shortcuts may conflict with browsers, screen readers and the existing `Ctrl/Cmd+B`.
- Planned entries multiply the registry before modules exist; mitigated by `status` and a test that no planned entry produces a link.
- Scope creep into module building or the AI runtime; this spec forbids both.

## 15. Assumptions I could not verify

- Intended routes for unbuilt modules are placeholders; none exists in `src/app` today (verified by listing `src/app/workspaces/[tenantId]`). `/discover` and `/communities` public routes exist but their owner-side entries do not.
- I did not find a global Content-Security-Policy or `frame-ancestors` setting in `next.config.ts` or `src/proxy.ts` (the proxy matcher covers `/workspaces/:path*`); one may exist elsewhere (hosting config).
- Next.js intercepting-route behaviour with dynamic segments and the current App Router version was not tested here.
- I did not measure the extra JS and fetch cost of mounting a page in the pane.
- The Eden screenshots were read as layout references only; I did not verify every listed screen (shell-011, products-012/013/034, ai-016..022 were not all opened).
- I did not check whether `Alt+P`, `Ctrl/Cmd+Alt+1..3` conflict with browsers or assistive technology.
- Zernio's email/calendar/files tools are described in the task as available through the provider layer; their availability and scopes for Harvest tenants were not verified.
- The CRM-08 foundation (read tools + approvals) is described from the task and the architecture PRD; I did not re-read its code.
- Current open PRs on origin/main were not reconciled beyond `git fetch`.
