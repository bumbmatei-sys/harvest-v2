# Link in bio: acceptance

Draft PR "Link in bio with Message me". Plan and decisions: `docs/plans/link-in-bio.md`. Migration `0094_link_in_bio`. Nothing is activated: development-only, "Message me" synthetic-only and hard-off in production. No merge, deploy, secret, real outbound message or automatic email.

## What works

- **Editor** (Public > Website > Link in bio, owners and admins; `/workspaces/:id/link-in-bio`): profile (name, short bio, photo through the existing scanned upload path), links and blocks (add, edit, reorder by drag or Move up/down buttons, show/hide, remove; up to 20), social icons (up to 8), design (ministry brand colours; light, dark or match the device; filled or outline buttons), publish (address with live availability, reserved words and uniqueness, checklist, publish, publish changes, unpublish with confirmation), a phone-framed live preview that uses the public renderer, and a save bar with a version check and conflict recovery.
- **Layout (25 Nov):** cover (gradient or scanned upload), overlapping round photo, subtitle, main action button, social icons, owner-built Details list with per-row hide, Home and Partnership tabs the owner can show, hide and reorder (per-block section choice). Blog tab: waiting on founder.
- **Blocks:** link (https only, optional icon), Message me, featured event (owner-written card), featured community (resolved on every read; omitted when unpublished or hidden), newsletter sign-up (embeds the merged hosted sign-up form; omitted when retired).
- **Public page** `/l/<handle>`: server-rendered, one readable column, no JS needed for links, light/dark, noindex only through the 404 (unpublished, missing and production answer the same 404). Links carry `rel="nofollow noopener noreferrer ugc"` and show their host. Hidden blocks and drafts never reach the browser.
- **Clicks:** daily aggregate per block, no cookies, no personal data, same-origin POST with `keepalive`, never blocks navigation; owners see "clicks in 30 days".
- **Message me:** name, email, message, fixed consent line ("Your details go to [ministry]. You can ask them to delete them.", never pre-ticked), honeypot, one-second minimum fill time, signed ten-minute single-use proof, database rate limits (5/min per visitor per page, 20/min per visitor, 60/min per page, 600/min overall), synthetic addresses only, 90-day retention, purge on listing. Creates or reuses the CRM person by email, creates no consent and sends no email. Owner Messages screen: reply (opens their own mail program), mark handled, view person, delete.
- **Safety:** FORCE RLS on all six tables; anonymous access only through SECURITY DEFINER functions with a fixed `search_path`, revoked from PUBLIC; erase removes messages and merge moves them; a published address cannot change; photos must be ready files of the page.

## Rework PR 1 (founder decision 25 Nov; kit items approved 27 Nov)

Migration `0132_bio_tabs_layout` (no columns; `bio_block_shown` learns the single-page layout, `bio_public_photo_scoped` stops serving a cover that is switched off).

- **Header** (`BioHeader`, layout from kit `profile-block2`): cover on or off (brand gradient without an image), a **required** profile photo placed left or centre (publishing is refused without one, in the editor checklist and on the server), name, a one-line short bio, and the social and website icons in one style for the page (outline or colour). Founder decision 27 Nov: nothing else in the header; the subtitle becomes the one-line bio when there is no bio, and the details list and the main action button are dropped (that information goes in blocks). Older pages are normalised on read.
- **Profile step** (`BioProfileStep`, kit `form-layout14`): label-left rows; cover and photo use the shared `EventCoverPicker` in a new small square variant.
- **Tabs** (`BioTabsEditor`, kit `dashboard-dropdown10`): tabs or a single page; up to six tabs, renamed, shown or hidden, reordered by drag (mouse, touch, keyboard) or Move up/down, removed (their blocks move to the first tab). The two first tabs keep their default names until renamed. On the public page the tab bar scrolls sideways and a touch swipe on the panel changes tab (shared `SwipeTabs`, `embla-carousel-react` 8.6.0, MIT, pinned). Panels out of view are `inert`.
- Unchanged: the address, privacy, rate limits, Report button, consent line and published-only reads. Pages saved before the rework read with the new defaults (tabs layout, cover on, centre, outline).
- Evidence: unit and integration (`tests/unit/link-in-bio.test.ts`, `tests/integration/link-in-bio.test.ts` "rework" describe, `tests/integration/ways-to-give.test.ts`), e2e `tests/e2e/link-in-bio.spec.ts` (tabs by keyboard and buttons, single page, colour icons, cover switch, photo position, axe at 360/768/1280 light and dark, 44px targets at 360, touch swipe). Runtime and visual evidence is author-executed.

## Evidence

- Unit `tests/unit/link-in-bio.test.ts`; integration `tests/integration/link-in-bio.test.ts` (restricted migration owner); e2e `tests/e2e/link-in-bio.spec.ts` (editor and public page with axe at 360/768/1280, light and dark, overflow check); navigation counts in `tests/unit/navigation.test.ts` and `tests/e2e/campaigns.spec.ts`.
- Screenshots: `docs/screenshots/link-in-bio/` (editor, public, messages; phone, tablet, desktop; light and dark). Runtime and visual evidence is author-executed; an independent review is still required.

## Deferred

- Messages in the unified social inbox (see plan decision 3); CRM source record for a message; storage cleanup of replaced photos (rows are retired, objects remain); small-cell suppression and a click-analytics notice; custom domains; courses and products cards; event cards from real Events; a revision history; production activation (all HC-02 decisions stay UNAPPROVED).

## Decisions needed

1. Public path `/l/<handle>` (versus `/bio/`). 2. Messages screen now, unified inbox later. 3. Whether a message should write a CRM source event. 4. Click-count notice and suppression policy before activation. 5. Migration order: 0094 is reserved here; on rebase keep the journal entry last with a `when` above every other entry and re-chain the snapshot `prevId`.
