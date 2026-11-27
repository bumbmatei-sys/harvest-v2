# Harvest staff takedown for communities, posts and replies

Founder decision (27 Nov 2026, `docs/decisions/founder-decisions-2026-11.md`): "Harvest staff get a takedown tool for communities and single posts, like the giving
takedown: a report button, staff admins hide and restore, in-app badge, reversible." This copies the Ways to give pattern (`docs/acceptance/cw-giving.md`,
"Reports and Harvest staff takedown") and the Harvest staff role (`docs/acceptance/platform-staff-discover.md`). It is separate from the community's own
moderation (C12a/C12b): reports to Harvest never reach the hosts' queue, and hosts cannot lift a Harvest takedown.

Migration `0137_community_takedown` (tentative; the final number is assigned at merge). Nothing here approves a merge, deployment, production migration or HC-02 gate.

## Delivered
- **Tables** (FORCE RLS, no app or worker grant; one owner policy keyed on `app.community_takedown`):
  - `community_harvest_reports`: ministry, community, target (`community` | `post` | `comment`, id), reason, optional note (≤ 500), status
    (open, reviewed, dismissed), who resolved and when. No reporter account, address or key.
  - `community_harvest_report_quotas`: one-minute buckets holding only a keyed hash, purged after two minutes.
  - `community_takedowns`: one row per hidden target with the staff reason; restore keeps the row with `hidden = false`. Owners and admins of the ministry
    (Communities at manage, through `public.access_role`) read their community's row; nothing else is granted.
- **Report button.**
  - Public community page: "Report" opens the shared `PublicReportDialog` (extracted from the Ways to give block, which now uses it too). Any visitor, no account.
    `POST /api/communities/:slug/harvest-report`: same origin, JSON, 4 KiB, honeypot. The same 404 for a missing, draft, hidden-visibility or paused community.
  - Posts and replies: the existing report dialog gains a "Send to: This community's hosts / Harvest" choice. `POST /api/communities/:slug/harvest-reports`
    (signed-in member, `communityRoute`). Only content the member can read, never their own; the same 404 otherwise.
  - Reasons: spam, harassment, inappropriate, impersonation, scam, other.
  - Rate limits as giving: 3 a minute per visitor and community, 30 a minute per community. The visitor key is the link-in-bio keyed hash of the client
    address; a member's key is a keyed hash of the account id. Neither is stored with the report.
- **Staff queue** at `/platform/communities` (Harvest staff only, sign-in within 15 minutes, neutral 404 for everyone else, off with Communities). Shared
  `StaffPageFrame` and `StaffHideDialog` (extracted from the giving screens, which now use them). DataTable with Open / Reviewed / Dismissed tabs; each row
  shows the community and ministry, what was reported, a 280-character excerpt of the post or reply (or its address for a community), reason, note, date and
  whether it is hidden. Reviewers mark reviewed or dismiss. **Only staff admins** pause a community, hide a post or reply (reason required) and restore,
  enforced in the screen, the server and `platform_community_takedown`. Staff act only on targets someone reported.
- **In-app badge:** the open-report count in the page header and on the Open tab (`platform_community_open_count`). No email or other alert.
- **Effects of a paused community** (`community_harvest_hidden`, checked in the database):
  - `community_public` returns nothing (the public page 404s like a missing one); `discover_search`, `discover_communities` and
    `discover_communities_approved` leave it out.
  - `community_can_read` is false, so every member-readable table (posts, replies, files, likes, shelf) reads nothing, and the forum write definers refuse.
    `community_user_can_read` is false, so no new notifications are written and the chat role (0057/0113) gives members no chat or DM access. The ministry's
    own owners and admins keep the ministry settings only, so they can fix what was reported (see below).
  - Members (hosts included) opening the member area see "Paused by Harvest"; owners and admins also see the reason there and on the community's settings page.
- **Effects of a hidden post or reply:** a restrictive row policy on `community_posts` and `community_comments` shows it only to its author, the community's hosts
  and moderators, and ministry staff on the tenant path. They see a "Hidden by Harvest" marker on the post, the feed card and the reply.
- **Restore** removes every effect at once.
- **Audit:** every staff call writes `platform_staff_audit` (`community.reports`, `community.report.reviewed|dismissed`, `community.takedown.hide|restore`, with
  the target type and id and the ministry).
- `community_definer_reset`, `account_self_reset` (0134) and `blog_scope_clear` (0135) also clear `app.community_takedown`; the takedown check sets and restores only that flag (reviewed exception in the C23 test).

## Founder answers (27 Nov) and review fixes
- **Request review.** On a paused community's settings page owners and admins see the staff reason and "Request review": a message of up to 1,000
  characters, one open request at a time (a concurrent second request answers "already open"), three a day per community under a per-community lock (`community_harvest_appeal`, table `community_takedown_appeals`, FORCE RLS; owners and
  admins read their own requests). The request shows in the staff queue on the community's report row, with its status. Staff admins keep the pause
  and close it (`platform_community_appeal_decline`), or restore the community, which closes it as restored. Audited: `community.takedown.appeal` in the
  ministry's audit log (no message text), `community.appeal.declined` in the staff log.
- **Settings only while paused.** Owners and admins keep the ministry settings. Forum and chat are read-only for everyone, owners and admins
  included, in the database: a trigger (`community_harvest_write_guard`) on posts, replies, likes, chat messages, reactions and private messages
  refuses new rows and changes. An update may only set user references (author, user, sender, removed by, deleted by, pinned by) to NULL, as an
  account deletion's ON DELETE SET NULL does, recount replies and revisions (a purge), or be the author's own delete (below). Hard deletions still run.
- **Own deletes while paused (founder, 27 Nov).** Members may still delete their own posts, replies, chat messages and private messages, and nothing
  else. The normal delete definers answer "not found" for a paused community, so the delete routes then call `community_harvest_delete_own`. It does the
  same soft delete as the normal path, for the author only, only while paused, and only for an active member. Restoring a deleted message stays closed.
  `community_chat_role` gives nobody a chat role while paused. Patched on its live definition, the migration fails if that definition has an unexpected shape.
- **No new joins.** `community_harvest_join_guard` on memberships and applications refuses new rows and any change to active, pending,
  info requested or approved. That covers joining, invitations, applications, resubmissions and approvals through any path. Members can still leave. The database answers
  SQLSTATE `P0404`, which the API maps to the same 404 as a missing community.
- **Reviewer fixes (#324).** The email digest (`community_email_claim`) leaves out the title of a post Harvest hid. Link in bio
  (`bio_public_page_scoped`) leaves out a paused community. Both are patched on their live definitions, so the patch also applies on top of the open link-in-bio PRs. If those
  merge first, this migration must still find the `c.status = 'published' AND c.visibility <> 'hidden'` text, or it fails loudly. No other owner-role
  reader hands post or reply text to non-staff (checked against `pg_proc`; account export returns only the person's own content).

## Reuse
- Extracted and shared with Ways to give: `PublicReportDialog`, `StaffHideDialog`, `StaffPageFrame`, `staffAreaResponse` / `asStaff` (`src/server/platform/staff-area.ts`).
- Reused: DataTable, StatusBadge, ConfirmDialog, EmptyState, Alert, Badge, RadioGroup, the community `ReportDialog`, `communityRoute`, `bioVisitorKey`,
  `platform_staff_role` and `platform_staff_log`. No new kit items and no new dependencies.

## Evidence (author-executed)
- `tests/integration/community-takedown.test.ts` (non-bypass migration owner): visitor reports, uniform 404, honeypot, origin, nothing identifying stored,
  rate limits; member reports (own, non-member, other ministry, unknown); tables closed to the app; staff list/resolve and badge count (non-staff 404);
  reviewers refused by the server and the database; only reported targets; pause hides the public page and all three Discover reads; member notice and
  owner reason; other ministry unaffected and unable to read the standing; restore; hidden post invisible to another member (also by a direct read)
  and visible with the marker to author, moderator and owner; hidden reply; audit rows; a pre-set flag opens nothing.
- Founder answers and review fixes (same integration file): review requests (roles, not paused, length, one open, decline by admins only, three a day,
  restore closes, ministry and staff audit without the message, other ministry isolated); settings still saved while paused; forum and chat
  writes refused through the member path, the ministry's staff path and a direct insert; no chat role for owners, admins, hosts or members; deletes
  still run; joins, applications, an earlier application's approval and a direct membership insert refused with the missing-community 404; leaving
  works; link in bio leaves out and brings back the community. Round 3: the product's account deletion (0136) works while paused, and a hard user delete fires ON DELETE SET NULL for accounts that removed a post, pinned or removed a chat message, or deleted a
  private message in a paused community can be deleted (their references become NULL; a reassignment is refused); members delete their own post,
  reply, chat message and private message while paused but nobody else's, and cannot edit or restore; two concurrent review requests give one
  request and one "already open". `tests/integration/community-email-db.test.ts`: the digest leaves out a hidden post's
  title and shows it again after a restore.
- `tests/unit/community-takedown.test.ts`: input rules and reasons identical in code, migration and copy. C23 hardening (unit and database) updated.
- `tests/e2e/community-takedown.spec.ts`: report, staff pause, public 404 and Discover, member notice, owner reason, restore, hide and restore a post;
  axe and no horizontal scroll at 1280 and 360, light and dark.

## Not included / known limits
- In-app notifications written before a takedown keep what they stored; digest emails sent afterwards leave out the hidden title (checked at claim time).
- Single chat messages and DMs cannot be hidden one by one (posts and replies only, per the decision); pausing the community closes chat to everyone.
- Production migration not applied; Communities stay off in production.
