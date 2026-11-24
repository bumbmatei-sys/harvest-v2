# Link in bio: plan (one PR, server and screens)

Status: implementation plan, 24 Nov 2026. Inputs: `docs/superpowers/specs/2026-11-17-link-in-bio-design.md` (draft, earlier), the founder decisions of 22 Nov (layout reference and "Message me", `docs/decisions/founder-decisions-2026-11.md`), the hosted forms server (`/f/:slug`), Connect landing pages, the CRM contacts model and the social inbox. This plan settles what the 17 Nov draft left open and records where the build deliberately differs from it.

## Decisions made in this plan (flagged for the founder)

1. **Public path `/l/<handle>`.** `/c/` is Connect, `/communities/` is Communities, `/f/` hosted forms, `/subscribe/` newsletter, so `/l/` ("link") is free. The 17 Nov draft proposed `/bio/:slug`; the founder asked for a short path. `bio` and `l` are reserved handles, as are all route names (list in `src/lib/link-in-bio.ts`, repeated in the database function `valid_bio_handle`, kept in step by a unit test).
2. **One page per ministry; the draft and the published copy sit on one row** (`bio_pages.draft`, `bio_pages.published`) instead of the draft's revision table. Publishing copies the draft atomically; the public address serves only the copy through a SECURITY DEFINER function with an explicit allow-list. A revision history can be added later without changing the public side.
3. **"Message me" lands in the page's own Messages screen, not in the social inbox.** The social inbox is a live pass-through to provider conversations (message text is never stored, items hang off a provider connection), so a stored first-party message does not fit it. Messages are stored like hosted form responses (90 days, purge on listing), shown newest first with Reply (opens the owner's own mail program; Harvest sends nothing), Mark handled, View person and Delete. Putting these into the unified inbox is a decision for the inbox work (see Deferred).
4. **CRM person: created or reused by email**, in the same transaction as the message, under the hosted-form rules (synthetic `@example.test` addresses only; match by normalised identifier; a name on an existing person is never overwritten; no consent grant, no newsletter, no automatic follow-up). Erasing the person deletes their messages; merging moves them (database trigger plus a patch of `merge_contacts_scoped`, the same technique as migration 0082). A CRM *source* record (`contact_source_events`) is not written: it would widen that table's contract and the source filters; the message row carries the provenance (`created_contact`) for now.
5. **Featured event** is an owner-written card (title, date text, https link). Events are member-facing in Harvest today and have no public projection; the card never reveals one.
6. **Featured community** stores the community id; the public page resolves name, tagline and slug on every read and omits the card when the community is no longer published or is hidden. **Newsletter sign-up** embeds the merged hosted sign-up form (`HostedSignup`) for one of the ministry's published forms and is omitted when that form is retired.
7. **Theme:** the ministry's brand theme plus light, dark or "match the visitor's device" (owner's choice, default match). Button style filled or outline.
8. **Click counts** are daily aggregates per block (`bio_clicks`: block, day, count) with no visitor data; rate limited per visitor and page (60/min) and per page (600/min) in a minute bucket that holds only a keyed hash. Shown to owners and admins as "clicks in 30 days"; labelled approximate. No small-cell suppression yet (the 17 Nov draft's threshold of five is not approved); owner/admin only.

## Hard gates (unchanged)

- Editor, owner API and public page are development-only (never when `NODE_ENV`, `VERCEL_ENV` or `HARVEST_ENV` is production), like Docs.
- "Message me" is synthetic-only and hard-off in production, exactly like hosted forms: `BIO_MESSAGES_PRODUCTION_ENABLED = false`; it needs `HARVEST_LINK_IN_BIO_MESSAGES=synthetic`, a 64-hex test key and a local `harvest_test` database; the SQL functions repeat the database-name check. Where it is off the block is not shown to visitors and the owner is told why.
- No email of any kind: no copy to the visitor, no notice to the owner. Tests assert no outbound `fetch` and no outbox row.
- No HC-02 decision is approved by this work; nothing here is activated.

## Server

Migration `0094_link_in_bio` (journal `when` above every entry; chain `prevId` to the latest snapshot on main when rebasing): `bio_pages`, `bio_files`, `bio_clicks`, `bio_messages`, `bio_quotas`, `bio_receipts`; FORCE RLS on all; app role gets owner/admin policies and column-limited grants; anonymous paths are SECURITY DEFINER functions with a fixed `search_path`, revoked from PUBLIC (`bio_public_page`, `bio_public_photo`, `bio_record_click`, `bio_submit_message`) plus `bio_transition`, `bio_photo_operate`, `bio_purge_expired`, `bio_handle_taken` for signed-in managers. `audit_logs.audit_system_actor` gains `bio.message.submit`.

Profile photo: the same private upload, verification and scan path as event covers (`communityUploadInput`, `inspectCommunityUpload`, scanner); the editor reuses `EventCoverPicker` with a message namespace prop. The public photo is a 302 to a one-minute signed address; unpublished pages answer 404.

## Screens

Operations editor in Public > Website > Link in bio (`/workspaces/:id/link-in-bio`, owners and admins): shared `EditorShell` + `WizardLayout` + `StickySaveBar`, steps Profile, Links and blocks, Design, Publish; a phone-framed live preview that uses the same renderer as the public page; sortable list with `@dnd-kit` plus Move up/down buttons; Messages screen at `/link-in-bio/messages`. Public page `/l/<handle>`: one narrow readable column, server-rendered, no JS needed for links, 44px targets, `rel="nofollow noopener noreferrer ugc"`, host shown under each link label.

Layout reference: OpenShadcnBlocks was not reachable from the build environment (the egress proxy refused the host), so no block could be verified or used. The premium kit at `/home/user/admin-dashboard` @1631106 (`user-profile` page: profile header, avatar, bio, social rows) was used as a visual reference only; no kit code or assets were copied (see `docs/ui-sources.md`), and free shadcn primitives provide the controls.

## Tests

Unit (`tests/unit/link-in-bio.test.ts`), integration with a restricted migration owner (`tests/integration/link-in-bio.test.ts`: roles, isolation, slug rules, publish/unpublish and the allow-list, clicks, message consent/rate limits/replay/no email, merge and erase, photo, function privileges), e2e with axe at 360/768/1280 in both schemes (`tests/e2e/link-in-bio.spec.ts`), navigation counts updated.
