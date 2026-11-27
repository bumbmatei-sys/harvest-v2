# Communities operational runbook (C24)

Status: written 27 Nov 2026 against `main` at `312650f`. **Nothing here is authorized to run in production.** Communities are hard-off in production, no community migration is applied there, and every activation step needs the founder's explicit approval for that environment. The five HC-02 activation gates (`docs/decisions/hc-02-activation-gates.md`) and the C23 release-gate decisions G1 to G7 stay open.

Items marked **pending PR #N** exist only on an open, unmerged PR and are not on `main`.

Related: [module map](../communities/README.md), [migration guide](../setup/communities-migration-guide.md), [worker role](../setup/worker-role.md), [feature flags](../setup/feature-flags.md), [production migrations](../setup/production-migrations.md), PRD `docs/prd/harvest-communities.md`, ADR `docs/decisions/0013-communities-architecture.md`.

## 1. Feature flags

The server reads every switch at request time. Merging code never switches anything on.

| Switch | Where | Production today | Notes |
|---|---|---|---|
| `HARVEST_COMMUNITIES` | `src/server/communities-mode.ts` (`communitiesEnabled`) | off (unset) | On when `NODE_ENV` is not `production`, or when the variable is `enabled`. Off: owner pages, `/communities/:slug` and its member pages, `/account/communities` and every Communities API answer 404 before sign-in is checked. |
| Chat and private messages | `communityChatEnabled` in `src/server/community-chat.ts` | off, cannot be switched on | Needs `NODE_ENV !== "production"` as well as the flag. No environment variable opens it in production; that needs a separate reviewed PR. |
| Community Live | `communityLiveEnabled` in `src/server/community-live.ts` | off, cannot be switched on | Same rule as chat. |
| Events | `eventsEnabled` in `src/server/events.ts` | off, cannot be switched on | Same rule as chat. |
| Member profile details | `memberProfilesEnabled` in `src/server/community-profile-details.ts` | off, cannot be switched on | Also off when `VERCEL_ENV=production`. |
| Classroom and Products shelf | `freeCatalogEnabled` in `src/server/free-catalog-mode.ts` | off, cannot be switched on | Also off when `VERCEL_ENV=production`. |
| Unified Discover | `DISCOVER_SERVER_ENABLED = false` in `src/server/discover/registry.ts`, `discoverGateOpen` in `src/server/discover/gate.ts` | off | A literal constant. Outside production the gate opens with the Communities flag. Production needs a reviewed code change. |
| Anonymous visit counting | `COMMUNITY_ACQUISITION_COUNTING_ENABLED = false` in `src/server/community-acquisition.ts` | off | Literal constant. |
| Live community email | `COMMUNITY_EMAIL_LIVE_DELIVERY = false` in `src/server/community-email-sender.ts` | off | Literal constant. The live sender throws. |
| Upload release | `FILES_REQUIRE_SCAN_PRIVATE`, `src/server/files/service.ts` | scan required | In production a member upload stays quarantined until the scanner says `clean`. No production scanner is wired yet. |

On the Cloudflare Workers build, API routes that use `communityRoute` (`src/server/community-route.ts`) read the flag from the request's worker settings (`src/server/worker-settings.ts`): any `HARVEST_ENV` other than `production` counts as non-production, so those routes are on in Cloudflare staging and preview. With `HARVEST_ENV=production` they need `HARVEST_COMMUNITIES=enabled` as a Worker variable. Other gates read `process.env` as in the table. Only `local`, `preview`, `staging` and `production` are accepted for `HARVEST_ENV`; any other value makes the settings invalid. Pages and the other gates read `process.env`, so on a Workers staging build the member APIs can be on while `/communities/:slug` pages answer 404, unless `HARVEST_COMMUNITIES=enabled` is also visible to `process.env`. **Founder note:** Communities member APIs are on by default in Cloudflare staging and preview.

### Switching Communities on in one environment

Only with the founder's approval for that environment:

1. Apply the community migrations there first ([migration guide](../setup/communities-migration-guide.md)). Code that reads a missing table fails.
2. Set `HARVEST_COMMUNITIES=enabled` in that environment's server settings. A staging build with `NODE_ENV=production` needs it too.
3. Check: `/workspaces/<tenantId>/communities` loads for an owner; an anonymous `GET /api/discover` answers; chat, Live, events, profiles details and the shelf still answer 404 in any environment built with `NODE_ENV=production`.

To switch off: unset the variable. Data stays; every route answers 404 again.

## 2. Worker jobs

All community jobs are off by default. Schedules in the Cloudflare job registry (`src/worker/jobs/dispatch.ts`) are proposals: `WORKER_CRON_ENABLED`, `WORKER_QUEUE_ENABLED` and each job constant are `false`, and the job port refuses production (`src/worker/jobs/execute.ts`).

| Job | Node command | Database login | Required settings | Cloudflare job (hard-off) |
|---|---|---|---|---|
| Notification email and digests (C15b) | `npm run communities:send-email` | `harvest_worker` via `WORKER_DATABASE_URL` | `HARVEST_COMMUNITY_EMAIL=test`, `HARVEST_COMMUNITY_TEST_MAILBOX=<file>`, `BETTER_AUTH_URL` on localhost, `BETTER_AUTH_SECRET`, a local `WORKER_DATABASE_URL` | none |
| Chat and private-message 30-day purge (C11d) | `npm run communities:purge-chat` (`-- check` for health) | `harvest_worker` via `WORKER_DATABASE_URL` | `HARVEST_CHAT_PURGE_WORKER_ENABLED=1`; development, test or Preview only | `chat_retention`, proposed `27 2 * * *` |
| Declined and withdrawn applications, 90 days (C07) | `npm run communities:purge-applications` | `harvest_app` via `DATABASE_URL` | none | `community_application_purge`, proposed `37 2 * * *` |
| Read notifications and email delivery rows, 90 days (C15a, C15b) | `npm run communities:purge-notifications` | `harvest_app` via `DATABASE_URL` | none | `community_notification_purge`, proposed `47 2 * * *` |
| Event cover cleanup | `node --import tsx scripts/event-cover-cleanup.ts check` or `run` | `harvest_worker` via `WORKER_DATABASE_URL` | `HARVEST_EVENT_COVER_CLEANUP_ENABLED=1`, `S3_*` storage settings; development, test or Preview only | none |

Notes:

- **Email worker.** Test mode only. It refuses anything but a local database and a local site, writes to a mailbox file and prints counts. One run at a time (session advisory lock). Retries back off 10 minutes per attempt and stop after 5; a claimed row is locked for 15 minutes. Run it every few minutes once a real sender exists; digests go out when their window has passed.
- **Chat purge.** Deletes soft-deleted channel messages and private messages after 30 days in bounded batches and skips anything under an open report. A systemd template exists for a non-production runner (`ops/systemd/harvest-chat-purge.service`, `.timer`, daily at 03:00 UTC); it is not installed anywhere. See `docs/acceptance/communities-c11d-schedule.md`.
- **The two purge commands** call the zero-argument definers as `harvest_app` and refuse any other login. The Cloudflare path uses the bounded worker-only versions from 0077 (`community_purge_applications(integer)`, `community_purge_notifications(integer)`, 250 rows per call).
- **Worker role.** `harvest_worker` is a login with no table access that can run only the worker functions granted to it. Create it, grant, verify and rotate it with `docs/setup/worker-role.md`. Each worker migration (0044, 0057, 0058, 0068, 0077, 0100) has a labelled grant block to replay if the role is created after the migration. To stop every worker at once: `ALTER ROLE harvest_worker NOLOGIN`. Never grant the worker functions back to `harvest_app`.

## 3. Moderation operations

Moderation is done by community hosts in the app, not by ops. Hosts are the community owner, admins and moderators with an active membership. All routes below answer 404 when the flag is off and to non-hosts.

| Task | Where | Rules |
|---|---|---|
| Reports | `/communities/:slug/moderation`, Reports tab; `POST /api/communities/:slug/reports` to file one | One open report per reporter per target. Reporters are never shown to the reported person. Keep or Remove closes every report on that target. |
| Held content | Held tab | First posts (when "hold first posts" is on) and banned-word matches wait for a host. Approve or Reject. |
| Mute, ban, unban | Members tab (`/api/communities/:slug/moderation/members`) | Mute 1, 7 or 30 days. A ban resets the role to member, revokes grants and declines open applications. Only owner and admins unban. Hosts act only on lower ranks, never on the owner or themselves. |
| Warnings | Members tab, Warn | Reason 1 to 500 characters. The member sees and acknowledges it; the issuer is not shown. |
| Appeals | Appeals tab | A banned member sends one appeal per ban from `/account/communities`. Any host declines; owner and admins approve, which unbans. |
| Edit history | "Edit history" on posts, replies and the Reports sheet | Hosts only; the latest 50 versions. |
| Chat and private messages | `/api/communities/:slug/chat/...` (moderate, reports, held) | Non-production only today. |
| Discover listing review | `/platform/discover` and `/api/platform/discover/...` | Harvest staff only, fresh sign-in within 15 minutes. Reviewers approve and reject; admins also suspend, reinstate and set a ministry's Discover standing. Staff are granted only with `npx tsx scripts/platform-staff.ts grant <userId> <reviewer\|admin> --by <name>` (migration owner, `DATABASE_URL_UNPOOLED`); `revoke` and `list` the same way. |

**Takedown.** There is no platform tool that removes a ministry's community or a single post. What exists:

- a host removes a post or reply (Reports or Held tab), or bans the author;
- the owner or an admin unpublishes the community (editor, or `POST /api/workspaces/:tenantId/communities/:communityId/publish` with `published: false`), which also drops its Discover listing;
- Harvest staff suspend a Discover listing or a ministry's Discover standing, which takes it out of Discover only.

A takedown against the ministry's wishes (legal request, illegal content) needs a founder decision and a reviewed procedure. Do not edit rows by hand for this.

## 4. The permanent address lock

**Pending PR #302 (migration 0128).** Today on `main` the lock is in the app only: `updateCommunity` answers 409 while a community is published. #302 adds:

- `communities.first_published_at`, set on first publish and never cleared;
- trigger `community_address_lock` (function `public.community_address_lock()`), which refuses a slug change once `first_published_at` is set, and refuses changing or clearing the marker, for every role including the superuser (SQLSTATE `23514`, constraints `community_address_locked` and `community_first_published`);
- `unsubscribe` as a reserved address in the database.

The address is meant to be permanent so links, QR codes and invitations keep working. Change it only for a real need (for example a legal complaint about the address) with the founder's approval.

**Repair path (once #302 is applied).** Only the table owner (`harvest_owner`) can disable a trigger. The owner is also under FORCE row security on `communities`, so without lifting FORCE the update sees no row and changes nothing. Do it in one reviewed transaction:

```sql
BEGIN;
ALTER TABLE public.communities DISABLE TRIGGER community_address_lock;
ALTER TABLE public.communities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.discover_listings NO FORCE ROW LEVEL SECURITY;
UPDATE public.communities SET slug = '<new-address>', updated_at = now()
 WHERE tenant_id = '<tenant-uuid>' AND id = '<community-uuid>' AND slug = '<old-address>';
-- expect UPDATE 1
-- Discover keeps its own copy of the address; only app code updates it, so update it here too.
UPDATE public.discover_listings SET slug = '<new-address>', updated_at = now()
 WHERE resource_type = 'community' AND resource_id = '<community-uuid>' AND slug = '<old-address>';
-- expect UPDATE 0 or 1
ALTER TABLE public.discover_listings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.communities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.communities ENABLE TRIGGER community_address_lock;
COMMIT;
```

- Both `ALTER TABLE` statements lock the table for the whole transaction; keep it short.
- The new address must pass the `community_slug` check and be unique.
- Check after commit: `select tgenabled from pg_trigger where tgrelid = 'public.communities'::regclass and tgname = 'community_address_lock';` returns `O`, and `select relname, relforcerowsecurity from pg_class where oid in ('public.communities'::regclass, 'public.discover_listings'::regclass);` returns `true` for both.
- Record the change, the approval and the old address in the PR or incident record. The old address stops working at once; there is no redirect.

## 5. Write limits and public read limits

| Limit | Status | What it does |
|---|---|---|
| Chat messages, edits, reactions, slow mode | on `main` (0057) | Per-person limits inside the chat definers; `rate_limited` or `slow_mode` with a retry time. |
| Private messages | on `main` (0058, 0063) | Start cap and message windows; every refusal is the same `not_available`. |
| Discover reports | on `main` (0100) | Signed-in people only, limited inside `discover_report`. |
| Forum posts, forum replies, community reports | **pending PR #303 (0129)** | Trigger `community_write_rate_guard`: 10 posts, 30 replies, 20 reports per person per community in 10 minutes. The community's owner, admins (hosts) and moderators are exempt (founder, 27 Nov; 0132). Over it: SQLSTATE `P0429`, HTTP 429 with `Retry-After`, nothing kept. The numbers are engineering defaults (C23 F8). |
| Anonymous Discover, public community page, visit beacon | **pending PR #304** | `src/server/public-read-limit.ts`: 60 a minute per visitor for `discover`, `community-page` and `community-beacon`. One-click unsubscribe is deliberately **not** throttled: mailbox providers send it from shared servers, and a bad token is rejected offline before any database call. Hashed visitor key, stored in the existing `rate_limits` table under `public-read:`; no new table. If the limiter fails, the read is served and `public_read_limit_failed` is logged. |

Still open (C23): invitations and applications across many communities have no time-window limit (F4).

To change a write limit after #303: a new migration that recreates the trigger with new arguments. To change a read limit after #304: edit `publicReadLimits` in a PR.

## 6. Erasure and rights requests

A signed-in person can download their own data and delete their own account from `/account/profile` (`docs/acceptance/your-data.md`). Handle every other request through the ministry's privacy owner, using the same steps as `docs/runbooks/connect-rights-requests.md` (receive, verify, confirm scope, act, check, close). Retention periods and the policy for public contributions (G2) are drafted in `docs/decisions/hc-02-policy-pack.md` §11 (founder direction 27 Nov: posts, replies and channel messages stay as "Former member"; DMs are deleted with the account by the `chat-erasure` hook below); the gate stays UNAPPROVED.

What self-serve account deletion does (`public.account_delete`, migration 0135; the account row stays as a scrubbed tombstone):

- **Removed:** memberships, applications, likes, warnings, appeals, notifications, email delivery rows, exit records, channel memberships, read state, reactions, private-message participation and blocks, Discover reports filed by the person.
- **Kept without the author ("Former member"):** forum posts and replies, channel messages, files attached to posts, reports filed by the person (reporter becomes null), moderation history.
- **Deleted (the `chat-erasure` hook):** every private message the person sent. The other participant keeps their own messages, in a conversation shown as "Former member". DM report evidence snapshots keep their 180-day retention.
- **On leaving a community:** posts, replies and channel messages in that community are detached at once ("Former member"); private messages keep their author but the other participant sees "Former member".

What members can do themselves:

- leave a community (`POST /api/communities/:slug/leave`);
- erase or withdraw their community profile (`DELETE` or `POST .../profile/withdraw` on `/api/communities/:slug/profile`);
- delete their own posts, replies and messages;
- switch community email off (settings sheet, or the unsubscribe link).

Automatic retention: declined and withdrawn applications 90 days after the decision; read notifications 90 days after reading; email delivery rows after 90 days; deleted chat and private messages after 30 days. Each needs its job scheduled (section 2).

## 7. Monitoring and alerts

No alerting is configured anywhere. Before activation, decide an owner and wire these:

| Signal | Source | Act when |
|---|---|---|
| `community_chat_purge_alert` (`reason` `failed` or `backlog`) | `npm run communities:purge-chat` output, nonzero exit | any occurrence |
| Chat purge health | `npm run communities:purge-chat -- check` (exit 1 when overdue after 26 hours or a failure followed the last success) | exit 1 |
| `event_cover_cleanup_alert` (`failed` or `backlog`) | event cover cleanup output | any occurrence |
| `community_email_failed`, `community_email_pool_failed` | email worker | any occurrence |
| `community_purge_failed`, `community_purge_pool_failed` | the two purge commands | any occurrence |
| `community_unsubscribe_failed` | `POST /api/communities/unsubscribe` | repeated |
| `public_read_limit_failed` (pending PR #304) | public reads | repeated |
| HTTP 429 rate on community and Discover routes | platform request logs | sudden rise |
| HTTP 5xx on `/api/communities/*` | platform request logs | sustained |
| Moderation queue size | host badge in the app | ask the ministry when it grows without review |

All logs carry fixed event names only, never addresses or member text. The email delivery log has no application grant and no read-only health function yet; checking failed deliveries needs one (gap).

## 8. Incident steps

Write down the time, the community, what you saw and every action in the incident record. Never paste member text, addresses or tokens into it.

### Spam wave

1. Tell the community's owner. Hosts act first: remove posts, ban the accounts, and turn on "hold first posts" and banned words in the editor's People step.
2. For chat, the owner can set slow mode or turn chat off for the community (data is kept).
3. Close new joins: the owner turns off open joining (`allow_open`) and keeps applications or invitations only.
4. If it spans communities or ministries, look at sign-up and 429 patterns in the request logs. With #303 and #304 merged, the write and read limits already cut the rate.
5. Last resort for one environment: unset `HARVEST_COMMUNITIES` (every community goes 404; data stays). Founder approval.

### Abusive member

1. Hosts mute (1, 7 or 30 days) or ban from the Members tab, and remove the content.
2. Members can block the person in private messages and report messages.
3. If the person is a host, the owner or an admin removes the role (rank rules stop a moderator acting on a higher rank).
4. A ban also declines their open applications. They can appeal once per ban.
5. Safeguarding, threats or illegal content: escalate to the founder. No ops procedure is approved for contacting authorities or keeping evidence beyond the built-in report evidence.

### Leaked invite link

Invitations are personal: one email address, one use, 14 days, stored as a hash.

1. The owner or an admin revokes it in the editor (or `DELETE /api/workspaces/:tenantId/communities/:communityId/invites/:inviteId`). A revoked link answers like a missing one.
2. A leaked link alone does not let someone else in: redemption needs a signed-in account with the invited, verified email.
3. If it was already used, check the member list and ban if needed, then send a new invitation to the right person.

### Email bounce storm

No live email is sent today, so this cannot happen yet. Before a real sender is approved (decision G4), build: bounce and complaint handling, suppression, and a health read of `community_email_deliveries`. Until then, if it happens after activation:

1. Stop the email worker: remove its schedule, or `ALTER ROLE harvest_worker NOLOGIN` (this also stops the chat purge and Connect retention).
2. Do not delete delivery rows; they hold no address or text and are purged after 90 days.
3. Report to the founder before turning email back on.

## 9. What stays gated

- HC-02 gates G1, retention G2, minors G3, email sender G4, payments G5 (provider UNDECIDED; Dodo stays SaaS billing only), Discover production G6, prayer requests in Live G7.
- Production malware scanner for member uploads.
- Worker role provisioning, schedules and alert owner in every hosted environment.
- No production migration is applied ([migration guide](../setup/communities-migration-guide.md)).
