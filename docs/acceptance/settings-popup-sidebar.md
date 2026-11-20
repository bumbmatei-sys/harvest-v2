# Settings pop-up and sidebar regroup acceptance

One feature PR (founder structure of 20 Nov 2026, `docs/prd/public-mode-social-discover-navigation.md` sections 2 and 2b). No migration, no new dependency, no server route. Nothing here approves any HC-02 gate, activation or deployment.

## What was built

**Settings pop-up** (opened from the existing profile menu: a new Settings item beside the ministry switcher, Your profile page link, theme menu and Sign out).

| Section | Group | Who | Content |
| --- | --- | --- | --- |
| Profile | You | everyone, only while the member-profile routes are on (non-production) | Display name, bio, language, up to three https links and visibility (members, unlisted, private) through `/api/communities/[slug]/profile` (GET and PUT with the version check); a community picker when the person belongs to several. "Private" is whole-profile wording (no per-field privacy). |
| Account | You | everyone | Email, name, language and city through the existing `/api/account/profile` and `AccountProfileForm`. |
| Ministry details | Ministry | owner, admin | Ministry type (the existing `MinistrySettingsForm`, `inline` variant with its own Save) and a link to Appearance. |
| Connections | Ministry | owner, admin, while Social is on | The social accounts board of `/social/accounts`, embedded (`AccountsBoard embedded`). |
| CRM | Ministry | owner, admin | Links to CRM fields and Pipeline settings. |

Not shown because they have no screen yet: Privacy and data, Billing (and the kit's notifications, appearance and display pages). Members, viewers and any page without an open ministry see only You.

Deep link: `?settings=profile|account|ministry|connections|crm` on any shell page. An unknown or forbidden value opens the first available section. Opening, switching sections and closing rewrite the URL with `history.replaceState` (no server round trip). The Planner's "Social accounts" button, the composer's dashed "+" beside Post to and its empty-state button open Connections through `SettingsLink`, which still falls back to `/social/accounts`. Keyboard: Radix traps focus and closes on Escape (focus returns to the profile menu button); in the section list the arrow keys, Home and End move and open sections (one tab stop). Below 768px the pop-up is a full-screen sheet and the list is a scrolling tab row with 44px targets. Copy: no helper paragraph under fields; messages in `SettingsDialog`.

Server: `shellSettings` (`src/server/shell-settings.ts`) tells the shell which communities the person can edit a profile in (`joinedCommunities`, one member-path query, only while the routes are on) and hands over the fixed public test credential the Social accounts page already used. The three AppShell callers (workspace layout, `/profile`, `/workspaces`) pass it.

**Sidebar regroup** (`src/lib/navigation.ts`, the single registry; no second nav system).

- Operations: Office (Mail, Calendar, Docs, Sheets planned; Files live, moved from Ministry), People (the CRM group, label People: People, Organizations, Pipelines, Tasks, Imports), Connect (Follow-up live; QR codes and links, Responses, Forms planned), Ministry (Campaigns, Events live; Volunteers, Ministry page, Livestream planned), Giving (Overview, Donations, Fundraising, Pledges, Donors, Funds, Giving page, all planned so the group is hidden). The Settings group is gone; `socialAccounts`, `crmFields`, `pipelineSettings`, `appearance` and `ministrySettings` stay in the registry (breadcrumbs, mode, pop-up link targets) but in no sidebar group.
- Public: Discover as a pinned header-less first row (planned), Social media (Planner live; Inbox, Auto-DM, Ads, Analytics planned), Newsletter (Campaigns, Audience, Sign-up forms, Analytics, planned), Website (Link in bio, Blog, Website builder, planned), Community (Communities live; Live planned), Courses and products (Courses, Products, Coaching, Coupons, planned).
- Every group header and every row has its own icon, enforced across the whole registry by `tests/unit/navigation.test.ts` (rows and headers together; the pinned Discover group has no header).
- The legacy single sidebar (`HARVEST_SHELL_MODES=disabled`) keeps its Ministry grouping and loses only the Settings group; the origin/main parity fixture was reduced by exactly that group.
- Every built route stays reachable: sidebar rows, the pop-up links, and the unchanged pages (`/settings`, `/appearance`, `/crm/settings/*`, `/social/accounts`, `/profile`).

## Verified

- `npx tsc --noEmit`, `npm run lint` (source guards included): clean.
- Unit: `npx vitest run --project unit`: 104 files, 1355 tests passed (new: `settings-sections.test.ts`, extended `navigation.test.ts` with group order, hidden unbuilt groups, pinned Discover, no Settings group in any sidebar, group-header icons, Settings routes still resolving). Integration `community-joining.test.ts` passed (7). No integration test covers `joinedCommunities` directly; the browser spec exercises it.
- Browser: new `tests/e2e/settings-popup.spec.ts` (one test, passed): sidebar groups and hidden rows, nine built routes answer 200, open from the profile menu, sections for owner, admin, member and viewer, saving the profile through the real route and the https validation error, arrow, Home and End keys, focus trap, Escape and focus return, deep link and fallback, CRM link navigation, Planner button, Public sidebar, 360px sheet (360x800, tab row scrolls, 44px targets, no horizontal scroll), axe (wcag2a, 2aa, 21aa, 22aa) and no page overflow for all five sections in light and dark at 1280 and 360, each after a page-ready wait (control visible, no skeleton, no busy region). Updated specs: shell-slice2, campaigns (link count 15 to 10, flag off 17 to 12), ministry-audience, pr01b, social-publish-screens.
- Screenshots (device scale 2, light and dark, 1280 and 360, five sections, 20 files) were opened and checked; none blank or loading.

## Not verified or not built

- Founder confirmation point: members and viewers no longer have a UI path to the read-only Ministry settings, Appearance, CRM fields and Pipeline pages (the routes still answer by URL and enforce their own permissions). "Every built route stays reachable" therefore holds for staff (owner, admin) only.

- Home (pinned) is not in the registry: there is no Home page, and a planned entry at the ministry root would claim the neutral path that decides the mode. Add it with the page.
- Privacy and data and Billing sections: not built (no screen). Notifications and appearance preferences of the kit are not adopted.
- Profile section is hidden in production (the routes answer 404 there) and needs a community membership; avatar upload stays parked.
- The Discover row, Giving, Newsletter, Website and Courses and products groups are planned registry entries, tested hidden; no screen was built for them.
- No real provider, message, payment or migration is involved. Mobile behaviour was checked in a desktop Chromium with a 360px viewport, not on a device.
- No independent review yet.

## Provenance

Five approved kit items, none copied (see `docs/ui-sources.md`, "Settings pop-up"): chat-app `settings-dialog.tsx` (4 of 40 lines, 10%, by `scripts/ui-identical.sh`), admin-dashboard `sidebar-nav.tsx` (4 of 43, 9%), `account/page.tsx` (4 of 149, 2%) and `notifications/page.tsx` (4%), chat-app `user-avatar.tsx` (existing file reused). Recorded in `kitChatAppReferences` and `adminDashboardReferences`.
