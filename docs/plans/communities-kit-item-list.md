# Communities UI kit item list — approval gate (chat, profile, events, email)

Planning document, 17 Nov 2026. Documentation only. **Nothing is built, installed or copied**: no kit source, registry JSON or downloaded content is in this repository. This list exists for the founder approval gate in [`shadcnuikit-adoption.md`](shadcnuikit-adoption.md) section 2 and supports [`../superpowers/specs/2026-11-17-communities-c11-chat-design.md`](../superpowers/specs/2026-11-17-communities-c11-chat-design.md).

Method: public pages of shadcnuikit.com were fetched on 17 Nov 2026 with plain requests (no credentials, scratch directory outside the repository). Item names and free/premium status come from the existing [catalog map](shadcnuikit-catalog-map.md) (all chat, mail and calendar blocks are premium). Preview link = category page + `#` + name with a hyphen before the trailing number; the anchors were confirmed present in the fetched pages. Studio Admin could not be inspected from this environment (no GitHub access to its repository, demo host unreachable), so its rows are founder-supplied URLs and **unverified until the pinned-commit audit**.

Rules that apply to every row: the license/public-repository question and plan/seat question in `shadcnuikit-adoption.md` come first; every adopted file is converted (messages catalogue, semantic tokens, no sample data or vendor strings, full width, 44px phone targets); permissions and data stay in Harvest services; **no row is approved until the founder fills the decision column**.

## Verified pages

| Page | URL | Result |
| --- | --- | --- |
| Chat app (full template page) | https://shadcnuikit.com/dashboard/apps/chat | 200 |
| Mail app | https://shadcnuikit.com/dashboard/apps/mail | 200 |
| Event calendar app | https://shadcnuikit.com/dashboard/apps/calendar | 200 |
| Profile page (Profile V1) | https://shadcnuikit.com/dashboard/pages/profile | 200 |
| User profile page (Profile V2) | https://shadcnuikit.com/dashboard/pages/user-profile | 200 |
| Chat blocks | https://shadcnuikit.com/blocks/application-ui/chat-ui | 200 (chat-ui-1 to 10) |
| Mail blocks | https://shadcnuikit.com/blocks/application-ui/mail-app | 200 (mail-app-1 to 8) |
| Calendar blocks | https://shadcnuikit.com/blocks/application-ui/event-calendar | 200 (event-calendar-1 to 4) |
| `/blocks/application-ui/mail`, `/calendar`, `/profile`, `/blocks/dashboard-ui/profile` | | 404 (wrong paths; the real ones are above) |

The two profile pages are **full template pages under `/dashboard/pages/`, not registry blocks**: there is no `profile` category in the block registry, so they have no registry item name to install. They would be adopted as a pattern (header card, tabs, activity list), re-composed by hand, not installed.

## Candidates

| # | Area | Candidate (registry name or page) | Preview link | Free / premium | What we would use it for | Alternative | Harvest component reused or extended | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Chat: channel and message layout | `chat-ui10` (omnichannel chat with list, header and side panel) | https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-10 | Premium | Overall channel list + message pane + thread side panel structure for `ChatLayout` | Studio Admin `/dashboard/chat` (MIT, pinned audit pending) | `CommunityShell`, `Sheet`, `Tabs`, `ScrollArea`, `Skeleton` | **Use Studio Admin first**; take kit layout details only for gaps after the audit |
| 2 | Chat: conversation list and DM list | `chat-ui4` (shared inbox with timeline) or `chat-ui5` (support desk list) | https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-4 | Premium | "People you can message" and conversation rows with unread badges and mute menu | Studio Admin chat list | `Item`, `Avatar`, `Badge`, `DropdownMenu`, `EmptyState` | **Compose from shared** components, using Studio Admin's list as reference |
| 3 | Chat: message bubbles | `bubble1` to `bubble7` (kit-shipped `ui/bubble`) | https://shadcnuikit.com/dashboard/apps/chat (live example) | Free primitive family (per catalog map) | Message bubble, grouped consecutive messages, reply preview, reaction row | Studio Admin message component | `Avatar`, `Badge`, `Button` | **Use kit** primitive if the founder approves and the license question is cleared; otherwise Studio Admin |
| 4 | Chat: composer | prompt/composer within `chat-ui4`/`chat-ui10` (no separate registry item verified) | https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-10 | Premium | Composer with emoji and send, mention picker trigger | Studio Admin composer; shared `Textarea` + `Popover` + `Command` | `Textarea`, `Field`, `Command` (mention picker) | **Compose from shared**; do not copy a premium block for a textarea |
| 5 | Chat: message scroller / virtualised list | `message-scroller` (kit-shipped `ui` primitive) | https://shadcnuikit.com/dashboard/apps/chat | Free primitive (per catalog map) | Stick-to-bottom behaviour and "jump to latest" for the message list | Hand-written scroll anchor over `ScrollArea` | `ScrollArea` | **Evaluate after the Studio Admin audit**; use only if Studio Admin lacks equivalent scroll behaviour |
| 6 | Chat: attachments (later slice) | `attachment1` to `attachment5` | https://shadcnuikit.com/dashboard/apps/chat | Free primitive family | Attachment chips in messages after the scanner gate | Shared files UI from forum attachments | `src/components/files/*`, forum attachment list | **Defer** with the attachments slice |
| 7 | Member profile page | Profile V2 page `/dashboard/pages/user-profile` | https://shadcnuikit.com/dashboard/pages/user-profile | Template page (not a registry item) | Layout reference for the community member profile (header, badges, about, activity tabs) | Profile V1 `/dashboard/pages/profile`; Studio Admin account/user pages | `RecordLayout`, `Tabs`, `Avatar`, `Badge`, `MemberList`, `activity-timeline` | **Compose from shared**, looking at the kit page for composition only; nothing to install |
| 8 | Member profile: edit own profile and settings | `form-layout1` (account settings with sticky save bar) | per `shadcnuikit-adoption.md` §6 | Premium | "My settings" (visibility, notifications, DM opt-out) | Studio Admin settings pages | `Field`, `sticky-save-bar`, `AccountProfileForm` | **Compose from shared** (`StickySaveBar` already exists) |
| 9 | Events calendar (C14, third) | `event-calendar1` (month, week, day, agenda, drag reschedule) | https://shadcnuikit.com/blocks/application-ui/event-calendar#event-calendar-1 | Premium | Community events calendar views | `event-calendar2` (also planned for campaigns); Studio Admin calendar; shared calendar built on `react-day-picker` | `Tabs`, `Calendar`, `Sheet`; the social scheduler calendar if built first | **Decide when C14 starts**; prefer one calendar for scheduler, campaigns and events (reuse the item chosen for the scheduler) |
| 10 | Events: RSVP and event detail | no single item; compose | n/a | n/a | Event detail sheet, RSVP buttons, capacity badge | Studio Admin event/detail pages | `Sheet`, `Badge`, `Button`, `StatusBadge` | **Compose from shared** |
| 11 | Email / inbox screens (later) | `mail-app4` (sales inbox with contact panel), `mail-app1`, `mail-app6` | https://shadcnuikit.com/blocks/application-ui/mail-app#mail-app-4 | Premium | Pattern reference for a future Harvest Studio unified inbox and, if wanted, community notification email settings; **not** for community chat | Studio Admin email page (visual reference only, per `studio-admin-adoption.md`) | `ListPage`-style layout, `Tabs`, `ScrollArea`; channel capability model stays in the Harvest integration layer | **Out of scope for C11.** Re-raise with the social inbox slice; use Studio Admin first |

## Founder decision sheet

| # | Approve / swap / other | Date |
| --- | --- | --- |
| 1 to 11 | _blank: to be filled by the founder_ | |

## Summary for the founder

- Nothing from the kit is needed to start C11: Studio Admin's chat plus shared Harvest components cover rows 1, 2, 4. Rows 3 and 5 (free primitives from the kit) are the only kit items worth approving early, and only after the license question in the adoption plan.
- The profile "pages" are templates to look at, not installable items.
- Calendar and email rows are for later slices; deciding them now would pre-empt the scheduler/inbox and C14 work.
