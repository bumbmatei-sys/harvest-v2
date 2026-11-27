# Communities: module map

A one-page map for a new engineer. State of `main` at `312650f`, 27 Nov 2026. Items marked **pending PR #N** are on open PRs only.

Communities are hard-off in production (`HARVEST_COMMUNITIES`). Chat, Live, events, profile details, the shelf and unified Discover cannot open in production at all. See the [runbook](../runbooks/communities.md) and the [migration guide](../setup/communities-migration-guide.md).

## Read first

- PRD: `docs/prd/harvest-communities.md` (roadmap C01-C24 in section 19).
- Architecture: `docs/decisions/0013-communities-architecture.md`.
- Flags: `docs/setup/feature-flags.md`. Worker login: `docs/setup/worker-role.md`.
- Release gate: `docs/acceptance/communities-c23-release-gate.md` (pending PR #303).
- UI rules: `docs/design-system.md`, `docs/plans/studio-admin-adoption.md`. "Design of Eden, style of Studio Admin."

## Words

- A **ministry** (code: workspace, tenant) owns communities. Members join a community without joining the ministry.
- A community has a **status** (`draft`, `published`, `archived`), a **visibility** (`listed`, `unlisted`, `hidden`), a price (`free` only until commerce exists) and admission switches (`allow_open`, `allow_apply`, `allow_invite`, `allow_entitlement`).
- **Hosts** are the community owner, admins and moderators.
- The **address** is the slug in `/communities/:slug`. It is locked once published (in the database from first publish: pending PR #302).

## Routes

Owner and admin (inside the ministry shell):

| Route | Purpose |
|---|---|
| `/workspaces/[tenantId]/communities` | Community list |
| `/workspaces/[tenantId]/communities/[communityId]/edit` | Editor (settings, people, moderation, invites, publish) |
| `/workspaces/[tenantId]/discover/manage` | Discover listings for the ministry |

Public and member:

| Route | Purpose |
|---|---|
| `/communities/[slug]` | Public page and join card |
| `/communities/[slug]/home` | Member home |
| `/communities/[slug]/forum`, `/posts/[postId]` | Forum |
| `/communities/[slug]/members`, `/members/[userId]` | Directory and profiles |
| `/communities/[slug]/about` | Rules and about |
| `/communities/[slug]/classroom`, `/products` | Shelf (C13, C16) |
| `/communities/[slug]/events`, `/events/[eventId]` | Events |
| `/communities/[slug]/chat`, `/messages` | Chat and private messages |
| `/communities/[slug]/moderation` | Host moderation page |
| `/communities/unsubscribe` | Email unsubscribe confirmation |
| `/account/communities` | My communities, invitations, applications, appeals |
| `/discover` | Discover (legacy communities list unless the gate is open) |
| `/platform/discover` | Harvest staff review |

`/c/` is the Harvest Connect QR landing, not Communities.

APIs live under `src/app/api/communities/[slug]/...` (member), `src/app/api/workspaces/[tenantId]/communities/...` (owner), `src/app/api/account/community-*` (the person's own), `src/app/api/discover/...` and `src/app/api/platform/discover/...`. Every one answers 404 while the flag is off, before sign-in.

## Server modules (`src/server`)

| File | Role |
|---|---|
| `communities-mode.ts` | The `HARVEST_COMMUNITIES` flag |
| `communities.ts` | Create, edit, publish, slug rules |
| `community-route.ts` | Shared route wrapper (flag, origin, session) |
| `community-joining.ts` | Join, invitations, My communities |
| `community-applications.ts` | Applications and decisions |
| `community-forum.ts`, `community-files.ts` | Forum, uploads |
| `community-moderation.ts` | Reports, held, mute, ban, warnings, appeals, history |
| `community-notifications.ts` | Bell, preferences, welcome card |
| `community-email.ts`, `community-email-sender.ts` | Email worker and senders (live sender off) |
| `community-chat.ts`, `community-dm.ts` | Chat and private messages |
| `community-chat-retention.ts`, `community-chat-purge-worker.ts` | 30-day purge and health |
| `community-member-page.ts`, `community-member-profile.ts`, `community-profile-details.ts` | Directory and profiles |
| `community-live.ts` | Community Live L1 |
| `community-shelf.ts` | Classroom and Products shelf |
| `community-stats.ts`, `community-acquisition.ts` | Stats, exits, visit counting (off) |
| `events.ts`, `event-page.ts`, `event-cover-cleanup-worker.ts` | Events in communities |
| `discover/` | Discover gate, owner listings, public search, platform review |
| `worker-role.ts` | `harvest_worker` login check |
| `public-read-limit.ts` | Anonymous read limits (pending PR #304) |

Pure rules in `src/lib`: `community-editor.ts`, `community-listing.ts`, `community-members.ts`, `community-permissions.ts`, `community-email.ts`, `community-email-token.ts`, `community-unsubscribe.ts`, `community-stats.ts`, `community-live.ts`, `moderation.ts`, `notifications.ts`, `discover*.ts`. UI: `src/components/communities/`, `src/components/discover/`.

Scripts: `scripts/send-community-email.ts`, `community-chat-purge.ts`, `purge-community-applications.ts`, `purge-community-notifications.ts`, `event-cover-cleanup.ts`, `platform-staff.ts`. Cloudflare job registry (all off): `src/worker/jobs/dispatch.ts`.

## Tables

All have FORCE RLS. The app reaches most of them through SECURITY DEFINER functions that clear `app.*` flags on entry (`community_definer_reset`).

- Core: `communities`, `community_memberships`, `community_invites`, `community_applications`, `entitlements`.
- Forum: `community_categories`, `community_posts`, `community_comments`, `community_likes`, `community_files`, `community_post_revisions`, `community_comment_revisions`.
- Moderation: `community_reports`, `community_moderation_actions`, `community_warnings`, `community_appeals`.
- Notifications: `community_notifications`, `community_email_deliveries`.
- Chat: `community_channels`, `community_channel_members`, `community_channel_reads`, `community_messages`, `community_message_reactions`, `community_chat_state`, `community_chat_purge_runs`.
- Private messages: `community_dm_conversations`, `community_dm_participants`, `community_dm_messages`, `community_dm_blocks`, `community_dm_report_evidence`.
- Profiles and stats: `community_member_profiles`, `community_exits`, `community_daily_counts`.
- Links to other modules: `community_event_links`, `community_product_links`, `community_live_events`.
- Discover: `discover_listings`, `discover_controls`, `discover_ministry_standing`, `discover_reports`, `discover_review_events`; staff in `platform_staff`, `platform_staff_audit`.

Drizzle definitions: `src/db/schema.ts`. SQL: `drizzle/0035_communities.sql` onward (list in the migration guide).

## Tests

- Unit (`npm test`): `tests/unit/communities-flag.test.ts` (every route 404 when off), `community-*.test.ts`, `moderation.test.ts`, `notifications.test.ts`, `discover-*.test.ts`.
- Integration (`npm run test:rls`, local PostgreSQL): `tests/integration/communities.test.ts`, `community-*.test.ts`, `discover-server.test.ts`, `platform-staff.test.ts`. `community-joining-definer-owner.test.ts` runs the definers as a restricted owner (production shape). Catalog rules: `community-c23-hardening.test.ts` (pending PR #303).
- Browser (`npm run test:e2e`): `tests/e2e/community-*.spec.ts`, `discover-screens.spec.ts`, `discover-staff.spec.ts`, `kit-pr7-communities.spec.ts`. Each runs axe in light and dark at phone and desktop widths.

## Acceptance records (`docs/acceptance`)

`communities-c02-c03`, `c04`, `c05-c06-c08`, `c07`, `c09-c10`, `c09b-server`, `c11a`, `c11b`, `c11c`, `c11d`, `c11d-schedule`, `c12a`, `c12b`, `c13-c16`, `c14-e01`, `c14-e02`, `c14-event-covers`, `c15a`, `c15b`, `c15c`, `dm-start-privacy`, `event-cover-cleanup`, `member-profile-followups`; `community-live-l1`, `community-stats-server`; `discover-server`, `discover-screens`, `platform-staff-discover`, `worker-db-role`. Pending: `communities-c23-release-gate` (#303), `community-address-lock` (#302), `communities-public-throttles` (#304).

## Rules that bite

- Never return a different answer for "missing" and "hidden": refusals are neutral 404s or one fixed message.
- Logs carry fixed event names only; audit metadata holds ids and enums, never member text or addresses.
- Workspace roles come from `public.access_role` in every community function and policy.
- No new UI without the founder's kit approval list (`docs/plans/shadcnuikit-adoption.md`). Reuse the shared shell, page templates and forms.
- User-facing copy says "ministry", never "workspace", and names no vendors.
