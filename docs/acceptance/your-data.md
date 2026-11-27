# Your data: download my data and delete my account (founder decision, 27 Nov)

Self-serve access and copy (GDPR Art. 15 and 20) and erasure (Art. 17) for a signed-in person's own Harvest account, plus "Former member" on leaving a community (policy pack §11, G2). Part 1 (export, migration 0136) and part 2 (deletion, migration 0137) are stacked PRs.

## Part 1: download my data

## Built
- **Where:** `/account/profile`, section "Your data", button "Download my data" (44px, light and dark, 360 and 1280 wide).
- **Route:** `POST /api/account/data` (same-origin only, signed-in only). Returns `harvest-data-YYYY-MM-DD.json` as an attachment, `Cache-Control: private, no-store`.
- **Database (migration 0136, `0136_your_data_export`):** `account_export_requests` (FORCE RLS, no app grant) and the definer `public.account_export()` (pinned `search_path`, schema-qualified names, explicit flag clear list `public.account_self_reset()`, never `pg_settings`). Owner read policies are active only under `app.account_export` and pinned to `app.user_id`; the named-reference tables (ministries, communities, channels, DM conversations, courses, lessons, events) are readable only where one of the caller's own rows points to them. `community_definer_reset()` now also blanks the two account flags.
- **Contents:** account and profile; ministry memberships; community memberships (role, status, rules and adult confirmations, notification settings, join answers, community profile); community applications; posts, replies, channel messages and DMs the person sent (a DM counterpart appears by display name only); likes and reactions; course enrolments, progress and private notes; access grants; event answers; uploaded community files (metadata and a signed link valid for one hour; storage keys never included); Connect responses the person claimed, with purposes (when Connect intake is on).
- **Newsletters:** subscriptions are ministry contact records, not linked to a Harvest account; the export says so.
- **Limits:** 3 exports per person per rolling hour (429 with `Retry-After`); each list holds at most 5,000 rows and is named in `notes.truncated` if cut. Each export writes an audit row `account.export` (no tenant).
- **Sync only:** the export is generated in the request. A background job for larger exports is not built; the 5,000-row cap keeps the request bounded.

## Tests
- Integration `your-data-export` (4, migration-owner fixture so the owner policies are exercised): every section present; no other person's posts, replies, chat, DMs, notes, emails or event answers; rate limit and audit; no app-role access to the request log, flags blank afterwards, a self-set flag opens nothing.
- Unit `your-data` (2): link expiry clamp, file name.
- E2E `your-data.spec.ts`: download from the profile page, JSON shape, origin check, rate limit message, axe at 1280 and 360 in light and dark.

## Part 2: delete my account (migration 0137, `0137_account_deletion`)
- **Where:** `/account/profile` links to `/account/delete`: what is deleted, what stays, a typed confirmation (`DELETE`) and a destructive button (44px). Copy says "ministry".
- **Re-auth:** a sign-in within the last 15 minutes (the session's creation time), the same rule and helper as Harvest staff actions (`assertFreshSignIn`). A stale session sees "Sign in again", which signs out and returns to `/account/delete`; the API answers 401 `REAUTH_REQUIRED`.
- **Sole-owner blocker:** the screen, the service and the database (`public.account_delete_blockers()`, and again inside `public.account_delete` with the owner rows locked) refuse while the person is the only owner of any ministry, and list those ministries. Co-owned ministries keep their other owners. **Gap:** there is no in-app ownership transfer screen (the members API can make an existing member an owner, but nothing in the app exposes it) and no ministry deletion, so the copy says to contact Harvest support. Follow-up: an ownership transfer screen.
- **Route:** `POST /api/account/delete` (same-origin, signed-in, body `{ "confirm": "DELETE" }`, at most 1 KB). On success the session cookies are expired.
- **Mail and calendar:** before anything is deleted, every connection the person owns is disconnected at its provider through the provider's own `disconnect` (Harvest stores only an account reference; the provider holds the grant). Any failure, or a connection whose provider is not configured, stops the deletion with "Could not disconnect your mail and calendar" (fail closed). Then the rows, and their thread markers, contact links, calendar links and attempts, are deleted. Tests use a synthetic provider; no network call is made.
- **Database:** `account_deletions` (FORCE RLS, no app grant: user id, reference, time). The erase flag is unforgeable: each definer stores a random token in `account_erase_grants` (FORCE RLS, no app grant) and sets `app.account_erase` to it; `public.account_erase_active()` is true only for a grant of `app.user_id` created in the current transaction, and the row is deleted before the definer returns. A hand-set value, an old token or a deletion reference opens nothing. `public.account_delete(text)` is a definer with a pinned `search_path`, schema-qualified names and the explicit flag clear list; owner policies `account_erase_<column>` are active only under `app.account_erase` and only for the caller's rows (and rows with no person, which a detaching update produces). One transaction.

### Exactly what happens
| Data | Outcome |
| --- | --- |
| Forum posts, replies, channel messages | Kept, author detached: shown as "Former member" |
| Files attached to a post (or a post cover) | Kept with the post, uploader detached |
| Uploads never attached to a post | Row deleted; storage object deleted after commit (best effort, count logged if it fails) |
| DMs the person sent | Deleted (the `chat-erasure` hook). The other person's messages stay, in a conversation shown as "Former member" |
| DM participation, blocks, reactions, likes, channel membership and read state, notifications to the person, email delivery rows | Deleted |
| Community memberships, community profiles, applications, appeals, warnings, exit records | Deleted |
| Reports filed by the person, moderation history about or by them, invites they redeemed | Kept, person detached |
| DM report evidence snapshots | Kept until their 180-day retention ends (moderation evidence) |
| Course enrolments, progress, private notes; access grants; event answers | Deleted |
| Connect links between the account and responses | Deleted. The ministry's own response and contact records stay (HC-06: account deletion is not contact erasure) |
| Personal saved CRM views (shared views the person created stay) | Deleted |
| Mail, calendar and files connections | Disconnected at the provider, then deleted with their markers and links |
| Ministry memberships, personal document favourites, shares and notifications, CRM notification settings and notices, social approval notices, staff role, Discover reports | Deleted |
| Profile (city), export request log | Deleted |
| Sessions, sign-in methods, pending sign-in codes | Deleted: every device is signed out |
| Account row | Kept as a tombstone: name empty, email `deleted-<reference>@deleted.invalid`, no photo or language, not verified |
| Audit logs | Kept (append-only), plus one `account.delete` row with the reference |
| Newsletter hard-bounce and complaint blocks; ministry contact and newsletter records | Kept (they belong to each ministry; `docs/runbooks/connect-rights-requests.md`) |
| Records the person created as ministry staff (CRM notes, documents, campaigns and similar) | Kept, still pointing at the tombstone; screens show the generic former-member label where they already had one |

### Former member on leaving a community
`public.community_leave` now detaches the author from that community's posts, replies and channel messages. DMs keep their author; `community_dm_visible` returns the other person's name only while they are an active member, so the DM list and header show "Former member". Rejoining does not restore authorship.

### Tests (part 2)
- Integration `your-data-delete` (7, migration-owner fixture): mail and calendar revoked first, deletion stopped on a failed or unconfigured revocation; a hand-set erase flag ("on", a real deletion reference, a random uuid) opens nothing for the owner role and the app role cannot insert a grant; re-auth and typed word (service and database); sole-owner blocker and co-owner release; leave shows "Former member" with DMs kept; deletion outcome per table, DM erasure, kept audit with reference and kept hard-bounce block, unattached upload handed to the deleter; no app access to the register, flags blank afterwards.
- E2E `your-data.spec.ts` second test: sole-owner blocker, stale-session re-auth, typed confirmation, deletion, signed out, post shows "Former member"; axe at 1280 and 360, light and dark.
