# Link in bio: acceptance

Draft PR "Link in bio with Message me". Plan and decisions: `docs/plans/link-in-bio.md`. Migration `0094_link_in_bio`. Nothing is activated: development-only, "Message me" synthetic-only and hard-off in production. No merge, deploy, secret, real outbound message or automatic email.

## What works

- **Editor** (Public > Website > Link in bio, owners and admins; `/workspaces/:id/link-in-bio`): profile (name, short bio, photo through the existing scanned upload path), links and blocks (add, edit, reorder by drag or Move up/down buttons, show/hide, remove; up to 20), social icons (up to 8), design (ministry brand colours; light, dark or match the device; filled or outline buttons), publish (address with live availability, reserved words and uniqueness, checklist, publish, publish changes, unpublish with confirmation), a phone-framed live preview that uses the public renderer, and a save bar with a version check and conflict recovery.
- **Blocks:** link (https only, optional icon), Message me, featured event (owner-written card), featured community (resolved on every read; omitted when unpublished or hidden), newsletter sign-up (embeds the merged hosted sign-up form; omitted when retired).
- **Public page** `/l/<handle>`: server-rendered, one readable column, no JS needed for links, light/dark, noindex only through the 404 (unpublished, missing and production answer the same 404). Links carry `rel="nofollow noopener noreferrer ugc"` and show their host. Hidden blocks and drafts never reach the browser.
- **Clicks:** daily aggregate per block, no cookies, no personal data, same-origin POST with `keepalive`, never blocks navigation; owners see "clicks in 30 days".
- **Message me:** name, email, message, fixed consent line ("Your details go to [ministry]. You can ask them to delete them.", never pre-ticked), honeypot, one-second minimum fill time, signed ten-minute single-use proof, database rate limits (5/min per visitor per page, 20/min per visitor, 60/min per page, 600/min overall), synthetic addresses only, 90-day retention, purge on listing. Creates or reuses the CRM person by email, creates no consent and sends no email. Owner Messages screen: reply (opens their own mail program), mark handled, view person, delete.
- **Safety:** FORCE RLS on all six tables; anonymous access only through SECURITY DEFINER functions with a fixed `search_path`, revoked from PUBLIC; erase removes messages and merge moves them; a published address cannot change; photos must be ready files of the page.

## Evidence

- Unit `tests/unit/link-in-bio.test.ts`; integration `tests/integration/link-in-bio.test.ts` (restricted migration owner); e2e `tests/e2e/link-in-bio.spec.ts` (editor and public page with axe at 360/768/1280, light and dark, overflow check); navigation counts in `tests/unit/navigation.test.ts` and `tests/e2e/campaigns.spec.ts`.
- Screenshots: `docs/screenshots/link-in-bio/` (editor, public, messages; phone, tablet, desktop; light and dark). Runtime and visual evidence is author-executed; an independent review is still required.

## Deferred

- Messages in the unified social inbox (see plan decision 3); CRM source record for a message; storage cleanup of replaced photos (rows are retired, objects remain); small-cell suppression and a click-analytics notice; custom domains; courses and products cards; event cards from real Events; a revision history; production activation (all HC-02 decisions stay UNAPPROVED).

## Decisions needed

1. Public path `/l/<handle>` (versus `/bio/`). 2. Messages screen now, unified inbox later. 3. Whether a message should write a CRM source event. 4. Click-count notice and suppression policy before activation. 5. Migration order: 0094 is reserved here; on rebase keep the journal entry last with a `when` above every other entry and re-chain the snapshot `prevId`.
