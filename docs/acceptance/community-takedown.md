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
    own owners and admins keep their staff access in the ministry settings (and the chat staff path), so they can fix what was reported.
  - Members (hosts included) opening the member area see "Paused by Harvest"; owners and admins also see the reason there and on the community's settings page.
- **Effects of a hidden post or reply:** a restrictive row policy on `community_posts` and `community_comments` shows it only to its author, the community's hosts
  and moderators, and ministry staff on the tenant path. They see a "Hidden by Harvest" marker on the post, the feed card and the reply.
- **Restore** removes every effect at once.
- **Audit:** every staff call writes `platform_staff_audit` (`community.reports`, `community.report.reviewed|dismissed`, `community.takedown.hide|restore`, with
  the target type and id and the ministry).
- `community_definer_reset` also clears `app.community_takedown`; the takedown check sets and restores only that flag (reviewed exception in the C23 test).

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
- `tests/unit/community-takedown.test.ts`: input rules and reasons identical in code, migration and copy. C23 hardening (unit and database) updated.
- `tests/e2e/community-takedown.spec.ts`: report, staff pause, public 404 and Discover, member notice, owner reason, restore, hide and restore a post;
  axe and no horizontal scroll at 1280 and 360, light and dark.

## Not included / known limits
- No appeal flow: as for giving, the owner sees the reason only. How a ministry asks Harvest for a review is a founder question.
- Joining a paused community through a direct API call is not refused by `community_enter`; a new member reads nothing and sees the notice.
- Notifications written before a takedown keep their stored title; email digests already queued are not withdrawn.
- Single chat messages and DMs cannot be hidden one by one (posts and replies only, per the decision); pausing the community closes chat to members.
- Production migration not applied; Communities stay off in production.
