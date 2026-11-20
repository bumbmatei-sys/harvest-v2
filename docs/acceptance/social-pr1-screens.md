# Social PR 1 screens (Publish) acceptance

Screens for the Publish server in `docs/acceptance/social-publish.md` (migration 0069). Non-production only. Owner and admin only. No provider call leaves the process: the screens use the fake provider and nothing is sent to a person.

## What was built

| Screen | Route | Notes |
| --- | --- | --- |
| Composer | `/workspaces/[tenantId]/social/compose` | Tabs (Create, Queue, Calendar), posting-schedule switcher, Drafts button with count; Post, Article (disabled: "connect a blog to use this") and Story; platform rings; text with emoji; media strip; media accepted or rejected per account; "Each platform" cards with custom text, which files an account takes, reel or short switch and option rows; right-hand preview; Save draft, Schedule (set time with zone, or next free slot) and Publish now with a review step; per-destination results with retry. |
| Queue | `/social/planner?view=queue` | Scheduled posts per schedule (or all), each destination with its own status; reschedule, duplicate, cancel, details. |
| Calendar | `/social/planner?view=calendar` | Month (the Events calendar, extended; Monday first) and week (Monday first; a day agenda on phones); filters for account, platform and status; drafts column (xl) or sheet; drag a post or a draft, or use the date and time field. |
| Accounts | `/social/accounts` | Cards with availability, health, capabilities (supported, needs an eligible account, not available), enable and health check; explicit unavailable state; "Add test account" (non-production fake provider only, no sign-in flow, no credential field). |

Navigation (typed registry, `src/lib/navigation.ts`): the Public sidebar has a **Social media** group (share icon) with one row, **Planner** (calendar-days icon); Compose, Calendar and Queue are tabs inside the Planner page (`/social/compose` still opens the Compose tab and highlights Planner). Inbox, Auto-replies and Analytics stay planned and hidden. **Social accounts is not a Public sidebar row**: it is reachable from the "+" beside "Post to" and from the labelled "Social accounts" button in the Planner header; the registry entry sits in Operations > Settings only until the founder's Settings pop-up (profile menu at the bottom of the sidebar, with a Connections section that lists the social accounts) is built in its own PR, after which that row should be removed. Every row in every mode has its own icon (unit test). Behind the `social` feature and the `social:schedule` / `social:connect` permissions. No new shell.

## Founder requirements

1. **Rings.** Every account logo is an SVG ring that fills with the share of the limit used (normal, warning from 85%, danger over, with a "!" mark). A kit hover card (`components/ui/hover-card.tsx` of the premium admin template) shows the platform, the numbers ("About 140 / 280") and what is left or over; it opens on hover, keyboard focus and tap. The number is always written, so colour is never the only signal. Counts come only from `platformCharacterCounters` in `src/lib/social/characters.ts` (the function the server validates with).
2. **Media.** Drag-and-drop and picker; images, multi-image carousels, GIFs, videos, documents; reorder (drag or arrow buttons), remove, alt text; large-file upload through the server's multipart routes with progress and cancel; SHA-256 computed in 8 MiB slices; per-account accepted or rejected with the server's reason and an item counter; reel or short switch where the account's media rules have one; cover frame picker for video where the destination takes a frame. Nothing is converted.
3. **Article tab.** Shown, disabled, with the note "Article: connect a blog to use this."
4. **Schedules.** Default and per-platform schedules (create, change, archive), next free slot, queue per schedule, publish now with a review step, partial results with per-destination retry, move by drag and by date and time field.
5. **Accounts.** Health, capabilities, explicit unavailable state; connect is the fake provider only.

## Reviewer notes from the server review

1. **Non-production gate.** `src/server/social-publish-gate.ts` is the only addition on the server side. It opens when `NODE_ENV` and `VERCEL_ENV` are not `production` and Communities are on (the switch the other Public mode screens use); there is no new environment switch. When open, the Publish routes and the connections routes use ONE in-memory fake provider that accepts a fixed synthetic credential; the vendor adapter is never built on this path. `SOCIAL_INTEGRATION_ENABLED` and `ZERNIO_LIVE_NETWORK` stay the literal `false`, `getSocialSender` still throws, the source guards pass, and `tests/unit/social-publish-gate.test.ts` proves the gate is closed in production (including a production `VERCEL_ENV`). The module lives outside `src/server/social/` because the boundary guard forbids environment reads there. **Reviewer: please check this gate specifically.** The legacy `/social/posts` routes are untouched and stay hard-off.
2. **Cancel.** The server cancels only scheduled or failed deliveries without a provider record. The screens never say everything was cancelled: after Cancel the draft is re-read and the message is "N of M destinations cancelled. K already sending or sent were left as they are" (or "All destinations cancelled" only when that is true). Per-destination state is shown in the post dialog.
3. **TikTok.** The composer needs a privacy choice and an explicit confirmation of the preview and consent before the document carries the TikTok block; the confirmation is never restored from a saved draft; the review step shows privacy and "preview checked and consent given".
4. **Counter locale.** `characters.ts` now uses `Intl.Segmenter("en")` so server and browser agree; a test covers it. Counts the server marks `estimate` read "About 140 / 280" and the popup says the platform may count differently.
5. **Later, not built:** the signed media URLs must live long enough for providers to fetch large videos; social uploads have no per-ministry cap and no abandoned-upload cleanup yet.

## Not built, or limits

- Restored drafts show attachments as placeholders (the draft stores file ids, not names or thumbnails; no file read route exists).
- Subtitle tracks and a cover image upload are not in the composer (the cover frame is).
- A media inspector does not exist in the HTTP layer, so uploads cannot be confirmed end to end here; the browser spec answers the three media routes itself and seeds ready files, everything else is the real server.
- Platform logos are ported marks (see `docs/ui-sources.md`); LinkedIn, Slack, Google Business Profile, SMS and RCS use neutral marks. Use of the marks is subject to each platform's brand guidelines.
- Week view (desktop, 768px and up): posts that overlap in time collapse into the first post plus a "+N" button that opens a list of all of them (rows are 44px high). On phones (under 768px) the week is a day agenda: a strip of seven 44px day buttons and the selected day's posts as full-width rows with an Open button; drag and drop is not offered there (use Open, then Change time). The month grid starts on Monday like the week.
- Per-ministry rate and quota messages, analytics tab, inbox and Auto-DM are later slices.

## Verified

Rework run (20 Nov, final head): `tsc` and `lint` clean; unit 1276 of 1276 pass (includes the new unique-icons and group-icon tests); integration `social` project 47 of 47 in 4 files; browser `social-publish-screens` passes (3.3 min), `shell-slice2`, `kit-pr2-shell` and `campaigns` pass (11 passed, 2 skipped in the combined run), `kit-pr7-communities` failed once on a join redirect timing and passed on rerun. Screenshots (light and dark, 1280 and 360, scale 2): `/tmp/social-pr1-shots-v3`. The older bullets below predate the rework and keep their original counts.

- `npx tsc --noEmit` clean; `npm run lint` clean (zero warnings, source guards).
- Unit: 99 files, 1273 tests pass, including the new `social-publish-gate.test.ts` (gate closed in production, fake provider only, sender still throws, counter locale), `social-screens.test.ts` (SHA-256 against node, rings from the shared counter, document building, TikTok confirmation, catalogue keys), the provenance and source-guard tests.
- Integration: `tests/integration/social-publish.test.ts` 9 of 9 still pass with the routes now taking the gate's dependencies.
- Browser: `tests/e2e/social-publish-screens.spec.ts` passes (one long flow, real Publish routes with the fake provider): accounts and capabilities, ring numbers and popup on hover and keyboard focus, over-limit state, media upload (answered by the test), reorder, alt text, accepted and rejected media per account with reasons, options rows including explicit unavailable rows, save draft, drafts panel, review step, publish results, schedule by time and next free slot, queue reschedule by date and time field, duplicate, cancel message, month and week calendar, drag of a draft onto a day with confirm, post dialog with the date and time field, filters. Axe (wcag2a, 2aa, 21aa) clean and no horizontal scroll in light and dark at 1280 and 360 for every audited page and overlay; 44px targets measured at 390.
- Screenshots (device scale 2 at 360): `/tmp/social-pr1-shots`.

## Not verified

- Dragging a posted item in the week view (the date and time field path is tested; native drag from a draft to a month day is).
- Real upload to storage and the confirm step (no media inspector); large multipart upload is exercised only by the server's own tests.
- A real platform's counting of characters (estimates are labelled as such) and any real provider behaviour.
- Reel and cover-frame picker interaction with real video files (the test files are not decodable video).
