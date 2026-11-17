# Communities C11 — chat, channels and direct messages — design

Status: DRAFT for founder review, 17 Nov 2026. Documentation only: no code, migration or route is added by this document. The founder decisions of 17 Nov are recorded in section 1; everything else is a proposal with a recommended default. Nothing here approves a build, a deployment, production activation or any of the HC-02 privacy/legal gates, which all stay UNAPPROVED.

References:
- PRD `docs/prd/harvest-communities.md` §2A, §5, §6.2, §6.3, §6.5, §10, §13, §17, §18, §19 (C11, C14);
- ADR 0013 (`docs/decisions/0013-communities-architecture.md`) §4, §4a, §5, §11;
- house style: `docs/superpowers/specs/2026-11-11-communities-pr4b-forum-design.md`; polling decision: `docs/superpowers/specs/2026-11-16-community-live-design.md` §7;
- what exists: acceptance records `communities-c09-c10`, `communities-c12a`, `communities-c12b`, `communities-c15a`, `communities-c15b`, `worker-db-role`;
- UI sources: `docs/plans/studio-admin-adoption.md`, `docs/plans/shadcnuikit-adoption.md`, `docs/plans/communities-kit-item-list.md` (new, same branch), `docs/design-system.md`;
- Eden reference screens (read-only, not copied): `docs/design/reference/06-community-chat.jpg`, `02-community-messages.jpg`, and `harvest-agent` `docs/prd/screenshots/05-communities/` comm-008 to comm-019 (chat), comm-038 to comm-041 (messages), comm-048 (channel slow mode).

Design is Eden's, style is Studio Admin's (CLAUDE.md, 11 Nov).

## Summary (10 lines)

1. C11 adds member chat: channels (a channel list column, a message pane, threaded replies, pins, reactions, mentions, unread badges, per-channel mute) and one-to-one direct messages.
2. Transport is **polling first**: a cheap per-channel "latest revision" read answered with `ETag`/304, a visibility-aware client with backoff, and a monotonic per-channel revision number as the cursor. A push transport can replace the fetch later without a schema change.
3. DMs: the community owner or admin sets "members may message each other privately" to **on** or **off (channels only)**. Whatever the setting, owners and admins can start a conversation with any active member, and that member can always reply because the conversation sits in their own list.
4. Nobody reads DMs silently: DM tables have **no ministry or host read policy**. Hosts see a DM only as bounded evidence copied into a report by one of its two participants.
5. Retention: messages are kept until the author or a host deletes them; a deletion is soft and recoverable for 30 days, then purged by a worker-role job (the `connect-retention.ts` pattern). Reported messages are exempt from purge until the report is decided.
6. Attachments in chat are **deferred** (the file scanner is not wired for production); V1 is text, links, mentions and a fixed emoji reaction set.
7. Everything reuses what exists: `community_can_read`, C12 reports/holds/mute/ban, C15 notifications (names only, never message text), community capabilities, `communityRoute`, the shared `CommunityShell`, `EditorShell` Channels step.
8. UI is adopted, not built: Studio Admin's chat dashboard pattern (to be audited at the pinned commit) plus items from the paid Shadcn UI Kit **only after the founder approves the exact items** (`communities-kit-item-list.md`).
9. Four PRs: C11a server and migration, C11b channels and messages UI, C11c DMs, C11d retention job. Migration `0057` is the next free number after `0056_newsletter_nl01` on main as of today: a candidate, not a reservation.
10. Five open questions with recommended defaults are in section 15; no privacy/legal approval is claimed.

## 1. Founder decisions (17 Nov 2026, final)

1. **Build order:** C11 chat and channels first; then member profiles (C09b); then C14 events and RSVP. This document specifies C11 and the DM model in full and covers C09b and C14 briefly in section 16.
2. **Realtime:** polling first (short interval, visibility-aware, backoff, ETag/since-cursor), designed so a push transport can replace it later without a schema change.
3. **DMs:** a community setting "members may message each other privately: on / off (channels only)". Regardless of it, admins can always start a conversation with any member and the member can always reply. A member cannot start a DM to an admin unless the admin has messaged first or messaging is otherwise permitted by this spec. Admins do not silently read member-to-member DMs. Blocking and reporting exist. Launch is adults only, so there is no adult-to-minor DM risk.
4. **Retention:** kept until the member or an admin deletes; deleted messages are recoverable for 30 days (soft delete), then purged. Moderation evidence follows the C12 patterns.
5. **Channels are separate from admin inboxes.** Community chat is a member feature; the CRM/Studio inbox is unrelated and shares no table.
6. **UI must not be built from scratch.** Reuse Studio Admin's chat dashboard code, and, subject to founder approval, Shadcn UI Kit items, plus Harvest shared components.

## 2. Goals and non-goals

**Goals**
- Text channels with names, emoji, ordering, descriptions, access rules, slow mode and a hosts-only posting option.
- Messages: text, mentions, one level of threaded replies, pins, emoji reactions, edit and delete of own messages, host removal.
- Unread badges, read state, per-channel mute, notifications through C15.
- DMs under the founder's rules, with block, report, and a conversation list that always contains conversations a host started.
- Rate limits and spam controls that work without a shared request limiter.
- A polling protocol with a stable, transport-neutral shape.
- Retention: soft delete, 30-day recovery, purge job, evidence exemption.

**Non-goals (V1)**
- Attachments, images, voice, video, GIF pickers (section 7.7).
- Group DMs (the Eden "New group" screen, comm-040): the schema keys on a conversation with participants, so groups are an additive later slice.
- Typing indicators, read receipts, online presence ("41 here now"): cost and privacy, and they do not suit polling.
- Push or WebSocket transport, mobile push, email for chat messages beyond the C15b digest class.
- Message search (the PRD requires non-leak to non-members; search is a later slice and must be built on the same read predicate).
- Support tab (Eden comm-042): admin inbox is a non-goal by decision 5.
- Bots, webhooks, message import, cross-community conversations.
- Application-level encryption of message bodies (relies on database encryption at rest; see section 14).
- Any live provider, outbound message or production activation.

## 3. Reuse map (what exists, what is new)

| Need | Reused, unchanged or extended | New |
| --- | --- | --- |
| Who may read a community | `community_can_read(tenant, community)` (0038), membership and grants | `community_channel_can_read(tenant, community, channel)` built on it |
| Capabilities and ranks | `src/lib/permissions.ts` style, `community_is_host`, C12a rank rules (`src/lib/moderation.ts`) | `chat:*` capability keys (section 12) |
| Reports, holds, mute, ban | `community_reports`, `community_moderation_actions`, `community_member_moderate`, banned words, `muted_until` | report target types `message` and `dm_message`; held state on channel messages |
| Notifications and email | `community_notifications`, preferences, C15b digest worker | kinds `chat_mention`, `chat_reply`, `dm`; chat mute preferences |
| Route wrapper and flag | `communityRoute` (session, origin check, flag 404, no-store), `communitiesEnabled()` | `communityChatEnabled()` stronger gate (section 13) |
| Worker job pattern | `src/server/connect-retention.ts`, `harvest_worker` role, `requireWorkerRole` (0044, `docs/setup/worker-role.md`) | chat purge job and its run log |
| Owner setup UI | `EditorShell` Channels step (forum categories card, 0038) | "Chat channels" card, DM setting in the People step next to Moderation |
| Member UI | `CommunityShell` icon rail (Chat and Messages are "Coming soon" today), bottom tab bar, `NotificationBell`, `ReportDialog`, `MemberList`, `StatusBadge`, `ConfirmDialog`, `EmptyState` | `ChatLayout`, `ChannelList`, `MessagePane`, `Composer`, `ConversationList` (section 11) |
| Polling client | none shared yet; Community Live L3 plans its own | one shared `usePolling` hook (section 8.5), consumed by chat first and Live comments after |

No new abstraction is invented without two real consumers: `usePolling` is justified by chat and Live comments (both specified), the message pane by channels and DMs. If DMs land after channels, the message list/composer are extracted at that point, in C11c, with both consumers present.

## 4. Data model (proposed; migration 0057)

All tables carry `tenant_id` and, where applicable, `community_id`, use composite foreign keys `(tenant_id, community_id)` to `communities(tenant_id, id)` with `on delete cascade`, and `FORCE ROW LEVEL SECURITY`. Reads use policies; **every write goes through a narrow `SECURITY DEFINER` function** with a fixed `search_path` that returns outcomes rather than raising (ADR 0013 §4a, the 0038 to 0042 pattern). The application role has no direct write on any chat table. Owner policies for definers are keyed on settings only the definers set and clear (the `community_definer_*` pattern), and the restricted-owner suite covers them. Names are indicative; the migration fixes them.

**Migration number.** `drizzle/meta/_journal.json` on main ends at `0056_newsletter_nl01`, so `0057_community_chat` is the next free candidate. It is not a reservation; reconcile with open PRs at build time and never renumber merged migrations.

### 4.1 Channels and settings

`community_channels`
- `id`, `tenant_id`, `community_id`, `name` (1 to 60), `emoji` (at most 16, optional), `description` (at most 200, optional), `position`, `created_by`, `created_at`, `archived_at`.
- `posting` (`members` or `hosts`): `hosts` gives a read-only announcement channel for everyone else (the forum "Hosts only" idea).
- `access_mode` (`all`, `role`, `invite`, `tier`, `tag`) with `min_role` for `role`. The PRD lists all five. **`tier` and `tag` are accepted by the schema and refused by the server** until tiers (C18) and tags exist, the same pattern as the `paid` pricing value in ADR 0013 §3.
- `slow_mode_seconds` (0 to 3600; Eden comm-048), `last_rev` (bigint, the change counter, section 8.1), `last_message_at`.
- At most 30 active channels per community. Every community gets a "General" channel (migration backfill for existing communities, `createCommunity` for new ones), as forum categories did.

`community_channel_members` (invite-only channels): `tenant_id`, `community_id`, `channel_id`, `user_id`, `added_by`, `created_at`; primary key `(channel_id, user_id)`.

Additions to `communities`: `chat_enabled` boolean (default true once the module flag is on) and `dm_policy` (`channels_only` default, or `members`). The admin setting is **members may message each other privately: on / off (channels only)**, stored as `dm_policy`. Changing it is audited (`audit_logs`) like other settings.

Additions to `community_memberships`: `dm_accept_members` boolean (default true; a member-level opt-out of **new** DMs from other members, never applying to owners and admins; see open question 1).

### 4.2 Channel messages

`community_messages`
- `id`, `tenant_id`, `community_id`, `channel_id`, `author_id` (users, set null on delete), `parent_id` (self reference, **one level**; replies to a reply attach to the thread root), `client_id` (uuid; unique per `(author_id, client_id)` for idempotent retries, section 8.4).
- `body` (plain text, 1 to 2000; no HTML ever; mentions use the token `<@userId>` and are resolved to display names at read time), `mention_ids` (text array, validated active members, at most 10).
- `seq` (bigint, immutable position in the channel) and `rev` (bigint, bumped on every change; both come from `community_channels.last_rev`, section 8.1).
- `edited_at`, `pinned_at`, `pinned_by`, `reply_count` (denormalised on the root).
- `held_at`, `held_reason` (C12a banned-word hold; held messages are visible to the author and hosts only).
- `deleted_at`, `deleted_by`, `deleted_kind` (`author` or `host`), `purge_after` (= `deleted_at` + 30 days; section 10).
- Indexes: `(channel_id, seq)`, `(channel_id, rev)`, `(parent_id, seq)`, `(purge_after) where deleted_at is not null`.

`community_message_reactions`: `message_id`, `user_id`, `emoji` (a fixed allow-list of 12, in a shared constant, not free text), `created_at`; primary key `(message_id, user_id, emoji)`. A toggle bumps the message `rev`; counts are returned inline, never one row per request.

`community_channel_reads` (per member state): `tenant_id`, `community_id`, `channel_id`, `user_id`, `last_read_seq`, `mute` (`none`, `mentions_only`, `all`), `updated_at`; primary key `(channel_id, user_id)`. Unread count is the number of visible messages with `seq > last_read_seq` not authored by the member, capped at "99+". A member's mentions since `last_read_seq` are counted separately for a mention badge.

### 4.3 Direct messages

Separate tables, **not** a `channel_id`-or-`conversation_id` union on `community_messages`: the read policies differ in kind (community predicate versus participant), and keeping them apart makes it impossible for a ministry/host policy written for channels to expose a DM.

`community_dm_conversations`
- `id`, `tenant_id`, `community_id`, `pair_key` (text: the two user ids sorted and joined; **unique per community**, so a pair has one conversation and "start" is find-or-create), `origin` (`staff` or `member`), `started_by`, `created_at`, `last_rev`, `last_message_at`.
- `origin = staff` when an owner or admin started it. This flag is what lets the member reply regardless of the setting (section 6).

`community_dm_participants`: `conversation_id`, `user_id`, `last_read_seq`, `muted`, `hidden_at` (removed from my list; a new message restores it), `left_at`; primary key `(conversation_id, user_id)`. Exactly two rows in V1; the shape allows groups later.

`community_dm_messages`: as `community_messages` without channel fields: `id`, `conversation_id`, `author_id`, `client_id`, `body` (1 to 2000), `seq`, `rev`, `edited_at`, `deleted_at`, `deleted_by`, `purge_after`. No pins, no threads, no reactions in V1 (reactions can follow; they are not needed for the safety model). Deleting is **delete for everyone**, shown as a tombstone, and only the author can delete (or restore within 30 days).

`community_dm_blocks`: `tenant_id`, `community_id`, `blocker_id`, `blocked_id`, `created_at`; primary key `(community_id, blocker_id, blocked_id)`. Community-scoped: a block here does not affect any other community or the ministry.

### 4.4 Reports and evidence

- `community_reports.target_type` check is extended with `message` (channel message) and `dm_message`. Existing reason list and one-open-report-per-reporter-and-target rule are unchanged.
- `community_dm_report_evidence`: `report_id`, `tenant_id`, `community_id`, `conversation_id`, `snapshot` (jsonb: the reported message plus up to 10 preceding messages in the conversation, each with author display name, time and body), `created_at`, `expires_at`. It is written **by the reporting definer in the same transaction as the report**, copying only what the reporter could already see. It is the **only** path by which a host reads any DM text. Owner and admin read it through a definer that writes an audit row (who, which report); moderators see that a DM report exists and its reason and note but not the snapshot (open question 2).
- Channel-message reports need no snapshot: hosts can already read channels. The report keeps the message id; the C12a "removed or edited after report" behaviour applies (a removed message stays readable to hosts, as removed forum posts do).
- `community_moderation_actions` gains actions `message_remove`, `message_restore`, `message_pin`, `message_unpin`, `dm_evidence_view`, and its `target_type` check gains `message` and `dm_message`.

### 4.5 Row-level security

- **Channels, messages, reactions, channel reads:** staff tenant policy (ministry role through `withTenant`, intended and ministry-wide as in ADR 0013 §4a, narrowed by `can()` in services) plus a member read policy calling `community_channel_can_read`, which is `community_can_read(...)` **and** channel access (`all`; or `role` with rank at least `min_role`; or `invite` with a `community_channel_members` row; hosts always) **and** not archived for non-hosts. Held and deleted messages are hidden by services (so hosts can read them), with held messages additionally restricted to author and hosts in the read policy for members.
- **DM tables:** the **only** read policy is `exists (participant row for app.user_id)` on the conversation. There is **no staff tenant policy, no host policy, no ministry policy** on `community_dm_conversations`, `community_dm_participants`, `community_dm_messages`. `community_dm_blocks` is readable by the blocker only. Even a ministry owner querying through `withTenant` reads nothing. This is the schema-level expression of "admins do not silently read DMs" and it gets its own adversarial tests (section 17).
- Every table is `FORCE ROW LEVEL SECURITY`, tenant and community ownership are composite, and every definer re-checks membership status, community, ban and mute inside the function rather than trusting the caller.

### 4.6 Definer functions (proposed)

Channel setup (owner and admin): `community_channel_save`, `community_channel_delete` (archive when it has messages, hard delete only when empty), `community_channel_reorder`, `community_channel_members_set`.
Messages: `community_message_send(slug, channel_id, parent_id, body, mention_ids, client_id)`, `community_message_edit`, `community_message_delete` (own), `community_message_moderate(action pin|unpin|remove|restore, id)`, `community_reaction_toggle`, `community_channel_read(channel_id, up_to_seq)`, `community_channel_prefs_save(channel_id, mute)`.
DMs: `community_dm_start(slug, other_user_id, body, client_id)` (find-or-create plus first message), `community_dm_send`, `community_dm_read`, `community_dm_hide`, `community_dm_mute`, `community_dm_delete_message`, `community_dm_restore_message`, `community_dm_block`, `community_dm_unblock`, `community_dm_report` (creates the report and the evidence snapshot), `community_dm_accept_save` (the member opt-out).
Worker (granted to `harvest_worker` only, pattern of 0044; not to `harvest_app` or `PUBLIC`): `community_chat_purge(batch)`, `community_chat_purge_record_failure(code)`, `community_chat_purge_health()`.
Notification helpers extend `community_notify` (not granted to the app role) for the new kinds.

## 5. Channels

- **Create and edit** (owner and admin, in the editor's Channels step, "Chat channels" card beside "Forum categories"): name, emoji, description, who can read (`all`, a minimum role, invite-only with a member picker), who can post (`members` or `hosts`), slow mode, archive. Reorder with Move up and Move down (the forum categories pattern, accessible, 44px), not drag-only.
- **Access eligibility.** `all`, `role`, `invite` work at launch. `tier` and `tag` are in the schema and refused by the server with a clear "not available yet" outcome until C18 and tags exist; the UI shows them disabled with "Coming soon", never hidden, so the PRD's five modes are visibly planned.
- **Tier downgrade** (PRD edge case 10): when tiers exist, a tier-gated channel becomes unreadable immediately because the policy re-evaluates the grant on each read; history is kept.
- **Defaults:** every community starts with "General". A community may turn chat off entirely (`chat_enabled = false`), which hides the Chat rail item and returns 404 from chat routes, but keeps data.
- **Archive** keeps messages for hosts and removes the channel from member lists; hard delete only for an empty channel.
- **Channel visibility to non-members.** A channel never appears in search, Discover, sitemap or any public resolver; there is no anonymous read path at all.

## 6. Direct messages

### 6.1 Who may start and who may reply

Let a "host" mean an **owner or admin** of the community (including ministry staff acting as community owner or admin per ADR 0013 §5). Moderators have no special DM power (they are members for this purpose); see open question 2.

| Situation | Start a new conversation | Send in an existing conversation |
| --- | --- | --- |
| Host to any active member | Always, regardless of `dm_policy` | Yes, unless the member blocked the host |
| Member to a host | Only when `dm_policy = members`, or the host already started a conversation with them | Yes when the conversation is `origin = staff`; otherwise when `dm_policy = members` |
| Member to member | Only when `dm_policy = members`, and the recipient has not turned off `dm_accept_members` | Only when `dm_policy = members` (existing conversations go read-only when switched off; open question 3) |
| Either side blocked the other | No | No, and the blocked person gets a generic "can't send" with no hint of a block |
| Sender muted (C12) | No | Only in a `staff` conversation (a member can always reply to a host) |
| Sender or recipient banned, left or removed | No | No; the conversation is hidden from the other side's list for banned or removed members and returns when they rejoin |

Rules that fall out of it:
- **The member can always reply to a host-started conversation**, because (a) it appears in their conversation list the moment the first message is stored and triggers a `dm` notification, (b) `origin = staff` makes sending allowed independent of `dm_policy`, and (c) muting does not block it. Blocking by the member is the only thing that closes it, and it is the member's choice.
- **A member cannot cold-start a DM to an admin** when messaging is off: the recipient picker for members lists only people they are allowed to message (Eden's "People you can message", comm-038), computed server-side, so a forbidden recipient is not even disclosed as a member beyond what the Members directory already shows.
- **Switching the setting** never deletes anything. On to off: member-to-member conversations become read-only (visible, no new messages) and `staff` conversations stay two-way. Off to on: read-only conversations reopen.
- **No adult-to-minor path:** launch is adults only (PRD §2A, `adult_confirmed_at` on joining). Nothing in this design enables minors; a future minors program needs its own review before DMs are touched.

### 6.2 What hosts can and cannot see

- Hosts cannot list, count or open DM conversations. The Moderation page shows DM reports only as reports.
- A DM report creates a **bounded evidence snapshot** (reported message and up to 10 messages before it) written at report time from what the reporter could see. Owner and admin may open it from the report; each open is audited as `dm_evidence_view`. Later edits or deletions by the sender do not alter the snapshot.
- A host who needs to act on a DM report uses the existing tools: warn, mute, ban, remove from community (C12 rank rules apply). There is no "delete a DM" for hosts and no "read the whole conversation" button. If the founder wants a break-glass read, it is a separate, audited, owner-only decision (not proposed here).
- A host who is a **participant** in a DM naturally sees that conversation like anyone else.
- Platform operators and database administrators are outside this design; Harvest support access to message content is a founder policy item (section 14).

### 6.3 Block and report

- **Block** (community-scoped): per conversation menu and per profile menu. Blocking stops new messages in both directions from the blocked person's side (their sends fail generically), hides the conversation for the blocker if they choose, and collapses the blocked person's **channel** messages for the blocker ("Message from a blocked member", tap to show). A block never removes anyone from the community and does not hide a host's warnings or appeal notices (those are C12 notices, not DMs).
- **Report** reuses `ReportDialog` with reasons from C12a (`spam`, `harassment`, `inappropriate`, `other`) and a note. After a DM report the reporter is offered "Block this person".
- Blocking a host is allowed; hosts keep every moderation tool, which never required a DM.

### 6.4 Anti-abuse limits specific to DMs

Enforced in the definers by counting recent rows (section 9), not by a request limiter: new conversations at most 10 per member per day and 3 per hour for non-hosts; at most 3 consecutive messages to a person who has not replied; the same message-rate limits as channels; no banned-word hold on DM text (hosts do not scan private DMs; reports and rate limits are the controls).

## 7. Messages

### 7.1 Composition and display
- Plain text only, 1 to 2000 characters, Enter sends and Shift+Enter breaks a line. Display tokenises text client-side: mentions, http(s) links (rendered `rel="nofollow noopener noreferrer ugc"`, never raw HTML), line breaks. The server never stores HTML.
- Draft kept in memory and in `sessionStorage` per channel (wrapped in try/catch; it must render without it), so a failed send or reconnect loses nothing (PRD edge case 13).

### 7.2 Mentions
`@` opens a member picker limited to **members who can read that channel** (so a mention never leaks a channel's existence), up to 10 per message. A mention notifies that person through C15 (`chat_mention`), even in a channel set to "mentions only"; it does not notify muted members or those who cannot read the channel. `@everyone` is not in V1.

### 7.3 Threaded replies
One level, as in the forum. A reply attaches to the thread root, increments `reply_count`, opens in a side panel (Eden comm-016), and notifies the root author (`chat_reply`) and people already in the thread, grouped, never the actor.

### 7.4 Pins
Hosts (owner, admin, moderator) pin and unpin; at most 5 per channel; the newest pin shows in the channel header strip (Eden "Pinned message") with a list of all pins. Pin and unpin are logged in `community_moderation_actions`.

### 7.5 Reactions
A fixed set of 12 emoji, toggled per member. No custom emoji, no free-text emoji (bounds storage and moderation surface). Held, deleted and reported-and-removed messages cannot be reacted to.

### 7.6 Edit and delete
Authors edit their own messages (marked "edited"; no revision history because evidence is snapshotted at report time for DMs, and channel reports are decided against the current text, with removal leaving the original readable to hosts). Authors and hosts delete (soft, section 10). Host removal follows C12a rank rules (hosts act only on lower ranks, never on the owner or themselves) and records an action row.

### 7.7 Attachments (deferred)
Attachments and images in chat need the existing approved media pipeline (`community_files`, presigned PUT, `inspect`, `FileScanner`). In production, files stay quarantined until a real malware scanner is wired, which is an unmet activation gate for the forum already. Adding chat attachments now would add a second consumer of an unactivated pipeline. **Deferred to a follow-up slice after the scanner gate**, which would extend `community_files.kind`, add a message attachment link table and reuse the same release rules. The schema here leaves room (a nullable link table later) without any column on the message.

### 7.8 Spam and moderation of content
- Banned words (C12a) hold a **channel** message (visible only to its author and hosts, "Awaiting review"), approved or rejected from the Moderation Held tab, which gains a "Chat" source filter. `hold_first_post` does **not** apply to chat (it would make a chat feel broken); it stays a forum rule.
- Muted members cannot send in channels (C12a), banned members lose access entirely, and a ban revokes access to DMs through the same membership status checks.
- Slow mode per channel; hosts bypass it.
- Reports from the message menu (`ReportDialog`); the queue (grouped by target, no reporter ids) gains channel messages and DM messages as target types.

## 8. Polling protocol

### 8.1 Cursors
- Each channel and each DM conversation owns a counter `last_rev`. Inside a definer, a write does `update ... set last_rev = last_rev + 1 returning last_rev` and stamps the new `rev` (and `seq` on creation) on the message row **in the same transaction**. The row lock serialises writers per channel, so commit order equals `rev` order and a poller using `rev > since` **cannot miss a row that commits late**. A global sequence or timestamp cursor lacks that property (sequence values can commit out of order), which is why it is not used.
- `seq` is the message's immutable position (set on create). `rev` changes on edit, delete, restore, pin, unpin, reaction change and reply count change. Clients merge by `id`.

### 8.2 Endpoints (all behind `communityChatRoute`, JSON, `Cache-Control: private, no-store`, session and origin checks as `communityRoute`)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/communities/:slug/chat/state` | Rail state: for each readable channel `{id, latestRev, unread, mentions, mute}`, plus DM `{unreadConversations, latestRev}` and the member's own flags. `ETag` is derived from the maximum `last_rev` and read-state versions. |
| `GET /api/communities/:slug/chat/channels/:channelId/messages?since=<rev>&limit=50` | Messages and changes with `rev > since`, ascending, with inline reaction counts, pins and the new `cursor`. No `since` returns the latest 50 (initial load) with `hasMore` and a `before=<seq>` pager for history. `ETag` is `W/"<channelId>:<last_rev>"`. |
| `POST .../channels/:channelId/messages` | Send (`client_id`, `parent_id`, `body`, `mention_ids`). Returns the stored message so the client can reconcile its optimistic row. |
| `PATCH` / `DELETE .../messages/:id`, `POST .../messages/:id/reactions`, `POST .../messages/:id/moderate` | Edit, delete, react, pin/remove/restore. |
| `PUT .../channels/:channelId/read` | `{upTo: seq}`; debounced from the client when the bottom of the list is on screen. |
| `GET /api/communities/:slug/chat/dms`, `GET .../dms/:conversationId/messages?since=`, `POST .../dms`, `POST .../dms/:conversationId/messages`, `PUT .../dms/:conversationId/read`, `POST .../dms/:conversationId/block|report|mute|hide` | The DM equivalents with the same cursor shape. |

A poll whose `If-None-Match` matches answers **304 with no body after one primary-key read** of the counter (`select last_rev from community_channels where id = $1`, plus the membership check the route already performs). A changed poll runs one indexed range query on `(channel_id, rev)`.

### 8.3 Intervals and backoff (client)
- Active channel visible and focused: every **4 s** with ±1 s jitter.
- Visible but unfocused, or no new activity for 2 minutes: **15 s**; after 5 minutes of inactivity: **30 s**.
- Rail state: every **15 s** while visible (the active channel polls at its own rate).
- Tab hidden: **stop**; one immediate poll on `visibilitychange` back to visible and on `focus`.
- Offline (`navigator.onLine` false): stop and resume on the `online` event.
- Errors and 5xx: exponential backoff 2x per failure from the current interval up to **60 s**, reset on success. A `429` honours `Retry-After`. A `401` or `403` stops polling and shows the sign-in or access state; a `404` (chat off, channel archived, access lost) shows "no longer available" and stops.
- Server load note: N viewers produce N/4 requests per second per active channel; with 304 answered from a single PK read this is acceptable at launch scale. If one community's concurrency makes it a problem, the push transport below replaces it; the rate is tunable by a response header (`X-Poll-Interval`) so the server can slow clients down without a deploy.

### 8.4 Idempotency and reconnect
The composer generates a `client_id` per send. A retry after a network failure with the same `client_id` returns the original message (unique index), never a duplicate (PRD edge case 13). Optimistic rows are replaced on response or on the next poll that contains their `client_id`.

### 8.5 Shared client hook and transport neutrality
`src/hooks/use-polling.ts` (new, shared, with Community Live L3 as the second consumer) implements visibility, focus, online, jitter and backoff once. The wire shape is transport-neutral: `{ events: [...], cursor }` where `cursor` is the `rev` and each event is a full message state keyed by id. A later server-sent-events or WebSocket transport emits the same events and resumes from the same `rev` (the equivalent of `Last-Event-ID`). **No schema change is needed** to switch: the revision counters, idempotency keys and read state are already the contract. Presence and typing, which need push, are deliberately not designed here.

## 9. Rate limits and spam

There is no reusable request limiter outside sign-in (ADR 0013 §4a, still deferred). C11 therefore enforces limits **inside the definers**, deterministic and testable, by counting the author's recent rows on indexed columns:
- Channel messages: at most 5 per 10 seconds and 60 per 10 minutes per member per community; slow mode per channel (hosts exempt).
- Edits: at most 10 per minute; reactions at most 30 per minute; mentions at most 10 per message.
- DMs: section 6.4.
- A rejected send returns a stable outcome code (`rate_limited` with a retry-after), which the composer shows inline without losing the draft.
- Per-IP and global request limits, and bot detection, stay **activation gates** (same status as the Communities and Live gates), recorded in the acceptance file, not claimed.
- Notification volume is bounded by aggregation (section 10 and C15 rules): one row per channel for mentions, one per conversation for DMs.

## 10. Notifications, unread state and retention

### 10.1 Notifications (C15 reuse)
- New kinds in `community_notifications`: `chat_mention`, `chat_reply`, `dm`. Existing preferences apply: a muted community (`notifications_muted`) silences chat kinds; a per-channel mute (`none`, `mentions_only`, `all`) and per-conversation mute are new, stored in the read-state tables. Nobody is notified of ordinary channel messages in V1 (the unread badge is the signal).
- **Aggregation:** a `dm` notification is one **unread row per conversation** updated in place ("N new messages from Name"), and `chat_mention` is grouped per channel, the C15a "grouped per target" behaviour. Never the actor, never a person who can no longer read the channel or conversation, never someone who blocked the sender.
- **No message text in any notification or email.** Notifications carry the sender's display name and the channel name; the C15b renderer already limits member-written text to display names and titles, and chat does not widen that. Channel names are host-written and are sanitised like post titles.
- **Email:** chat kinds are digest-class only (members who chose `daily` or `weekly`), never instant. DMs by email are off in V1 by default: a DM notice in a digest is "You have messages from N people" with no names or text (a private-message notice should not leak the sender to a shared inbox), confirmed in open question 1. All email delivery stays hard-disabled by `COMMUNITY_EMAIL_LIVE_DELIVERY = false`.
- **Unread badges:** the rail item (Chat, Messages) shows the aggregate count, 99+, from `chat/state`; the channel list shows per-channel counts and a mention dot; "Unread" filter as in Eden. The count is cleared by `community_channel_read`, so read state syncs across devices on the next poll.

### 10.2 Retention and purge (founder decision 4)
- Messages are **kept** until the author or an authorised host deletes them. There is no automatic expiry of live messages.
- **Delete is soft:** `deleted_at`, `deleted_by`, `deleted_kind`, `purge_after = deleted_at + 30 days`. The message shows as a tombstone ("Message deleted"). Its body is withheld from every read path, including hosts, except as below.
- **Recovery (30 days):** the author can restore their own deletion from "Recently deleted" in their chat settings; owner and admin can restore a message removed in a channel (`message_restore`, audited). A DM can be restored only by its author: hosts cannot read DMs, so they cannot restore them either. After `purge_after`, the row is gone.
- **Purge job:** `community_chat_purge(batch)` deletes rows with `purge_after < now()` in batches, plus their reactions, and empties conversations with no remaining messages after both participants have hidden them (an empty conversation row is also deleted after 30 days of no messages). It follows `src/server/connect-retention.ts`: a `runChatPurge` loop that stops at an empty batch or the safety cap; `runChatPurgeJob` that records a failure outside the failed transaction (`community_chat_purge_record_failure`); `chatPurgeHealth` for a monitor (counts only, never a name, body or id). Script `scripts/community-chat-purge.ts` / `npm run communities:purge-chat`, run as `harvest_worker` via `WORKER_DATABASE_URL` and `requireWorkerRole`, refusing otherwise. The migration revokes the three worker functions from `PUBLIC` and `harvest_app` and grants them to `harvest_worker` only if that role exists, never creating it (the 0044 pattern); `docs/setup/worker-role.md` is updated. Scheduling it is an activation gate.
- **Moderation evidence follows C12:** (a) a deleted channel message that is the target of an **open** report is exempt from purge until the report is decided, then purges 30 days after the decision; (b) DM evidence snapshots are kept while the report is open and for **180 days after the decision**, then removed by the same job (proposed value, to be confirmed with the HC-DEC4-style retention review; C12 itself has no stated figure yet, see ADR 0013 open items); (c) `community_moderation_actions` and audit rows are retained as C12 retains them and never contain message text.
- **Account erasure and leaving:** a member who leaves keeps their channel messages (the "preserve owned content" rule, PRD edge case 6); on account deletion, channel messages are anonymised ("Former member", `author_id` null by the existing set-null FK) and **DM messages authored by that person are purged**, the other participant keeping their own messages in a conversation shown as "Former member". Needs legal review (open question 5).
- **Community deletion** cascades through the composite foreign keys; the purge job also sweeps orphan evidence.

## 11. UI (reuse plan)

Design is Eden's layout (icon rail, channel list column, message pane, header strip with pinned message, thread side panel, "People you can message" list); style is Studio Admin through shared shadcn components. No Eden visuals, copy or imagery; copy stays concise and provider-neutral.

**Existing Harvest components reused (inspected first, extended or configured, not duplicated):**
`CommunityShell` (the Chat and Messages rail and bottom-bar items change from "Coming soon" to live), `NotificationBell`, `ReportDialog`, `MemberList`, `ConfirmDialog`, `EmptyState`/`ui/empty`, `StatusBadge`, `Skeleton`, `Sheet` (thread panel and mobile channel list), `Dialog`, `Tabs`, `DropdownMenu`, `Avatar`, `Badge`, `Textarea`, `Field`, `ScrollArea` (a stock shadcn primitive not yet installed, see the kit list), `EditorShell` Channels step (the Chat channels card, People step for the DM setting), the Moderation page tabs (Held and Reports gain chat sources), and the shared `RichTextView` is **not** used (chat is plain text).

**Adopted sources (provenance recorded in `docs/ui-sources.md` style in each PR, license and retrieval date, changed files):**
- **Studio Admin chat dashboard** (`/dashboard/chat`, MIT, pinned commit to be audited): conversation list, message list, composer and the responsive list-to-thread behaviour are the base for `ChatLayout`, `ConversationList`, `MessagePane` and `Composer`. The repository could not be inspected from this environment (GitHub access to it was not enabled and the demo host was unreachable), so **the exact files, dependencies and fit are unverified** and the first step of C11b is a pinned-commit file audit, as the Studio Admin adoption plan requires. Its data layer is mock; Harvest keeps its own hooks, routes and permissions.
- **Shadcn UI Kit** (paid, third-party license): candidate items `chat-ui4`, `chat-ui5`, `chat-ui10` and the kit `bubble` and `attachment` primitives for message bubbles, listed in `docs/plans/communities-kit-item-list.md`. **Nothing from the kit is used until the founder approves the exact items** (the approval gate in `shadcnuikit-adoption.md` §2), and the license/public-repository question in that plan comes first. If the founder does not approve, compose from Studio Admin plus shared components.
- Every adopted file is converted in the same PR: messages catalogue instead of hard-coded English, semantic tokens, no remote avatars or vendor strings, full width inside the shell (no `mx-auto max-w-*`), 44px phone targets, 1024px sidebar breakpoint, `prefers-reduced-motion` honoured, no sample data.
- **New abstraction and exception rationale:** none beyond `usePolling` (two consumers, section 8.5). `MessagePane` and `Composer` are chat-domain components built for two real consumers (channels and DMs). `ConversationList` is channels' list and DMs' list rendered with one configuration, not two copies.

**Responsive:** desktop three columns (rail, list, pane, optional thread panel); tablet two (list collapses to a sheet); phone single column with the channel/conversation list as a screen and the pane as a pushed screen, composer pinned above the bottom tab bar, safe-area aware. Light and dark through tokens. Accessibility: the message list is a labelled `role="log"` with `aria-live="polite"` for new messages only when the user is at the bottom, focus not stolen on poll updates, composer labelled, every icon-only action named, keyboard channel switching.

**Empty and failure states:** no channels, no access, chat off, offline banner with preserved draft, "can't send" with retry, rate-limited inline hint.

## 12. Permission matrix

Capabilities are resolved server-side as named permissions, never by role name in UI or SQL (ADR 0013 §5). Proposed keys: `chat:read`, `chat:post`, `chat:manage_channels`, `chat:moderate`, `chat:restore`, `chat:dm_start_any`, `chat:dm_evidence`.

| Capability | Owner | Admin | Moderator | Contributor | Member | Not a member / pending / banned |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Read channels they are eligible for | Yes (all) | Yes (all) | Yes (all) | If eligible | If eligible | No |
| Post, reply, react, mention (not muted) | Yes | Yes | Yes | Yes | Yes (not in hosts-only channels) | No |
| Post in hosts-only channel | Yes | Yes | Yes | No | No | No |
| Edit and delete own messages | Yes | Yes | Yes | Yes | Yes | No |
| Pin, unpin, remove others' messages (rank rules) | Yes | Yes | Yes (lower ranks) | No | No | No |
| Restore removed channel messages | Yes | Yes | No | No | No | No |
| Create, edit, order, archive channels; set slow mode | Yes | Yes | No | No | No | No |
| Change the DM setting | Yes | Yes | No | No | No | No |
| Start a DM with any active member | Yes | Yes | Only if `dm_policy = members` | Same | Same | No |
| Reply in a conversation a host started | n/a | n/a | Yes | Yes | Yes, even if muted | No |
| Read DM text of others | No | No | No | No | No | No |
| Open a DM report's evidence snapshot (audited) | Yes | Yes | No (sees reason and note) | No | No | No |
| Block, report, mute, hide | Yes | Yes | Yes | Yes | Yes | No |
| See who is in invite-only channels | Yes | Yes | Yes | No | No | No |

Ministry staff reach community chat as owner or admin only through the community capability mapping already used for forum and moderation; **no ministry role reads DMs.** Capabilities are re-resolved on each request, so role changes take effect without cache invalidation.

## 13. Feature flag and production posture

- `communityChatEnabled(env)` in a new `src/server/community-chat.ts`, modelled on `communityLiveEnabled()`: true outside production; in production requires both `HARVEST_COMMUNITIES=enabled` and `HARVEST_COMMUNITY_CHAT=enabled`, **and returns 404 before authentication or database creation** (the stronger Live gate) via a `communityChatRoute` wrapper around `communityRoute`. Every page checks the flag itself (the C10 review follow-up), the Chat and Messages rail items render only when it is on, and unit tests prove every new route returns 404 when off.
- **Hard-disabled in production until the founder activates it.** Merging any C11 slice is not activation. No real outbound message, push, email or webhook is sent: C11 sends none itself, and notification email stays behind the existing C15b hard-disabled constant.
- `docs/setup/feature-flags.md` gains the flag, the purge schedule gate, the worker-role provisioning gate and the unscanned-attachment note.

## 14. Privacy, legal and security gates (flagged for the founder; no approval is claimed)

1. **DM confidentiality.** DMs are private to two people with no host read path. The privacy notice and community rules must say so, and that a participant can report a message, which shares a bounded excerpt with the community's owner and admin. Needs founder and legal sign-off before real DMs are collected.
2. **Encryption of message bodies.** V1 relies on database and disk encryption at rest; application-level encryption (the HC-DEC5 direction for prayer requests) is **not** applied to messages. HC-DEC5 itself is UNAPPROVED. Founder decision whether DM bodies need it before activation.
3. **Retention periods.** 30-day recovery is a founder decision; the 180-day evidence figure and the erasure behaviour (section 10.2) are proposals needing legal review. A scheduled purge with failure evidence is required before real data, as for HC-DEC4.
4. **Safeguarding.** Adults only at launch, with age attestation as already collected on joining; no minors program. Harassment handling relies on report, mute, ban and appeal (C12). A written escalation process for threats or self-harm in reported DMs is a community-policy and founder item.
5. **Support and platform access.** Who at Harvest, if anyone, may read message content for abuse or legal requests is a policy decision outside this design.
6. **Attachments** stay deferred until a production malware scanner exists.
7. **No consent or CRM effect.** Chat never creates or alters CRM contacts, consents, cases or Harvest Connect data, and chat content is not used by the assistant. Chat is not a consent purpose.
8. The five HC-02 privacy/security gates stay UNAPPROVED; merging C11 approves none of them.

## 15. Risks and open questions

Risks: polling load at scale (mitigated by 304 from one PK read and the server-tunable interval; push is the exit); hot-channel counter contention (one row lock per send; acceptable at launch scale, measured in C11a); definers growing complex (mitigated by per-slice restricted-owner tests); DM abuse without content scanning (mitigated by caps, block, report and the evidence path); the kit license and Studio Admin chat fit being unverified (mitigated by the approval gate and pinned-commit audit before any UI).

**Open questions (max 5, each with a recommended default):**
1. **Default for the DM setting and a member-level opt-out.** PRD §6.2 wants both members opted in; the founder's setting is community-level. *Default:* `dm_policy` starts at `channels_only`; when an admin turns it on, members can still switch off "Allow messages from members" (hosts are exempt), default allowed, with a one-time notice at turn-on and on the join screen.
2. **Moderator powers.** Can moderators start DMs and read DM evidence? *Default:* no to both; owner and admin only (the PRD says moderators lack private messages by default). Moderators still see the report and can mute or warn.
3. **Existing member-to-member conversations when the setting is switched off.** *Default:* they become read-only (history stays visible, no new messages); host-started conversations stay two-way.
4. **Attachments and images in V1.** *Default:* defer until the production malware scanner is wired; V1 ships text, links, mentions and fixed reactions.
5. **Erasure and evidence retention.** *Default:* on account deletion, channel messages are anonymised and the person's DM messages are purged; DM evidence snapshots are kept 180 days after a report's decision; reported deleted messages are held until decided. Needs legal review before activation.

## 16. Follow-on slices (scope and open questions only)

### 16.1 C09b — member profiles (second, after C11)
**Scope (PRD §6.3, Skool-style community profile page).** A profile page per member inside the community (`/communities/:slug/members/:userId`, replacing today's directory-only Members page and the profile popup) with: avatar, display name, optional bio, joined date, roles and badges (owner, admin, moderator, host labels; later achievements), recent activity (their posts and replies in this community that the viewer can read; chat messages are not listed), links, local language, a "Message" button that follows the DM rules above (shown only when allowed), and report/block in a menu. Privacy-aware: a **community profile visibility** choice per member (visible in directory and profile, visible to members only, or hidden from the directory with a profile reachable only by direct link/by hosts), no bulk contact data, no email or phone, no data from the ministry's CRM. Own profile editing and the notification, email-frequency and DM-accept controls live in "My settings" on the same page. Reuses `user_profiles` (HC-08, account-level city/region stays private), the `MemberList`, and the kit/Studio Admin profile page templates (see the kit list). Migration `community_member_profiles` (PRD §13.1) or columns on `community_memberships`, decided at build time. Closes the C09 review item about hiding from the directory.
**Open questions:** (a) is avatar upload in scope (needs the file scanner) or initials only at launch (default: initials, upload after the scanner gate); (b) is a member's activity feed on the profile visible to all members (default: yes, only content they can already read); (c) is the default directory visibility "visible" or "members only" (default: members only is the existing behaviour, keep it).

### 16.2 C14 — events and RSVP (third, after C09b)
**Scope (PRD §6.5, ADR 0013 §9).** Community event calendar with month, week and agenda views; an event has title, description, time zone, start and end, optional capacity, RSVP (going / maybe / not going), waitlist, reminders through C15 (`event_reminder`), an external join link (Zoom, Meet, Teams) shown only to members and only close to start, members-only versus public visibility, recurring events as a later increment, and "add to calendar" file (ICS) first, provider calendar linking later. Links to the **canonical `events` service**, not duplicated event content (PRD §13.1): ADR 0013 §9 says Events is its own canonical module that Communities links to, so **C14 depends on that module and is not started before it exists**; Community Live (`community_live_events`) is the existing livestream surface and is related but separate. Paid events use canonical Events/Commerce later. Reuses the Studio Admin/kit calendar (see kit list), `CommunityShell` Events rail item (currently "Coming soon"), moderation and notifications.
**Open questions:** (a) does a canonical Events module exist or does C14 define it (default: wait for it, per ADR 0013 §9, unless the founder asks C14 to own a minimal events table); (b) are waitlists in the first slice (default: RSVP and capacity only, waitlist second); (c) the relationship to Live events (default: a live event can be linked to a calendar event, no merge).

## 17. Test plan

**Unit (pure rules, `src/lib/chat.ts`):** DM eligibility matrix (every row of section 6.1, including mute, block, origin, setting changes), channel access evaluation, mention parsing and limits, reaction allow-list, message length and plain-text rules, poll interval and backoff state machine (visibility, focus, offline, errors, 429), unread counting and cap, purge-after arithmetic, rate-limit windows, flag-off 404 for every new route.

**Integration (two ministries, two communities each, adversarial fixtures):**
- *Isolation:* a member of community A reads nothing of community B's channels, messages, reactions or read state; a ministry viewer who is not a community member reads no chat unless staff access applies; pending, banned, left and removed members read nothing; two-ministry fixtures for every table.
- *DM privacy (the central test):* the owner, an admin and a ministry staff user, each through `withTenant` and `withUser`, **cannot select** any `community_dm_*` row they are not a participant of, cannot count or list conversations, and cannot read a snapshot except through the audited definer for an actual report; the snapshot contains only the reported message and at most 10 earlier ones; a sender's later edit or delete does not change it; `dm_evidence_view` is logged; a moderator gets none.
- *Role matrix:* every cell of section 12 by calling the definers as each role; hosts-only posting; invite-only membership; slow mode; rank rules for remove and pin; mute blocks channel sends and member-started DMs but not replies in a staff conversation; ban closes everything and rejoin restores access.
- *DM rules:* setting on/off transitions; host cold-start always works; member cannot cold-start a host when off; member reply to a host-started conversation works when off and when muted; block stops sends with a generic outcome; opt-out stops member-started DMs but not hosts'; the unanswered-message cap and new-conversation caps.
- *Polling correctness:* `rev` order equals commit order under two concurrent senders; a poller with `since` never misses a late-committing row; edit, delete, restore, pin and reaction changes appear in the next poll; the 304 path; idempotent retries with the same `client_id`.
- *Rate limits and holds:* each limit and its outcome code; banned-word hold on channel messages, none on DMs; held messages visible only to author and hosts.
- *Retention:* soft delete tombstones, 30-day restore by author and by admin (channels), DM restore by author only, purge removes exactly the expired rows and their reactions, open-report exemption, evidence expiry 180 days after decision, purge health and failure recording, idempotent reruns, counts-only output.
- *Notifications:* mention, reply and DM kinds, grouping per channel and per conversation, never the actor, never blocked or muted, no message text in any row or rendered email, digest-class only.
- *Restricted-owner migration suite* (`community-joining-definer-owner`, run as the non-superuser `tester`): every new definer and table with a NOCREATEROLE owner; `worker-role` tests extended so `harvest_worker` can call the three purge functions, `harvest_app` is refused (42501), and the worker has no privilege on any chat table.
- *Upgrade test:* migrating a database that already has communities, forum content and notification rows backfills "General" and `dm_policy`, with no data change elsewhere.

**Browser (Playwright):** owner creates channels (including hosts-only and invite-only) and turns DMs on and off; two members chat, mention, reply in a thread, react, pin (host), delete and restore; unread badges and mute across two sessions via polling; reconnect with preserved draft and no duplicate; a host starts a DM with a member who replies while DMs are off; a member cannot start a DM to a host when off; block and report a DM, the admin opens evidence, the moderator cannot; axe on every screen; no horizontal scroll; light and dark; widths 360, 768 and 1280 (and the repo's 390/1440 where fixtures exist); 44px targets on phone; screenshots under `docs/screenshots/communities-c11*/`.

**Evidence labelling:** runtime and visual evidence is author-executed unless a fresh non-author session runs it; independent review is a separate session (never the writing one), and no production activation, deployment or merge is claimed.

## 18. PR slices

| PR | Delivers | Migration | Exit test |
| --- | --- | --- | --- |
| **C11a — server and migration** | `0057_community_chat` (channels, messages, reactions, reads, DM tables, blocks, evidence, settings columns), definers, RLS, `src/lib/chat.ts`, `src/server/community-chat.ts`, routes behind `communityChatRoute`, notification kinds, report target types, "General" backfill, restricted-owner and isolation tests, DM-privacy tests, polling correctness tests | Yes (candidate 0057) | Two-tenant isolation, role matrix, DM privacy, restricted-owner suite |
| **C11b — channels and messages UI** | Studio Admin chat audit and (if approved) kit items, `ChatLayout`, `ChannelList`, `MessagePane`, `Composer`, thread panel, pins, reactions, unread, mute, `usePolling`, editor Chat channels card, Moderation "Chat" source, rail and bottom bar live | No | Browser multi-session, axe, light/dark, 360/768/1280 |
| **C11c — direct messages** | DM setting in the People step, conversation list and "People you can message", start/reply/hide/mute, block and report, evidence view for owner and admin, member opt-out, DM notifications | No (or a small follow-up if section 4 changes) | DM rule matrix end to end, report-evidence flow |
| **C11d — retention job** | `community_chat_purge`, run log and health, `scripts/community-chat-purge.ts`, `npm run communities:purge-chat`, worker-role grants and runbook update, "Recently deleted" UI, feature-flag doc updates | Only if a log table is added (else part of C11a) | Purge tests, worker-role tests, failure recording |

Each slice is independently reviewable. C11a may fold the purge migration in to avoid a second journal entry; the founder-approved order stays C11 then C09b then C14.

## 19. Acceptance criteria

- A member with access can read, send, reply in threads, mention, react and see unread counts in channels they are eligible for; a member without access (or in another community, or banned, pending or left) reads nothing, in the UI and the API.
- Owners and admins can create, edit, order, archive, restrict and slow channels; moderators cannot; changes apply without a deploy.
- Polling is visibility-aware, backs off on errors, honours `Retry-After`, answers unchanged polls with 304 from one primary-key read, never misses a committed message, and a retry never duplicates a message.
- DM setting off: members cannot start DMs; owner and admin can start a conversation with any active member and the member can reply, including while muted. DM setting on: members can start DMs unless the recipient opted out or blocked them. Switching never deletes data.
- No owner, admin, moderator or ministry user can read DM text except an owner or admin opening a participant-created report snapshot, which is audited.
- Block, report, mute, ban, held content and banned words behave as specified and reuse C12; reports gain channel and DM message targets.
- Deleted messages show a tombstone, are recoverable for 30 days by the allowed people, then purged by the worker-role job with health and failure evidence; messages under an open report are not purged early.
- Notifications use C15, are aggregated, contain no message text, and respect mute and block; no real email, push or outbound message is sent anywhere.
- The feature is hard-disabled in production (404 before auth) until the founder activates it; every new route has a flag-off test.
- UI reuses Studio Admin chat patterns and shared Harvest components, uses kit items only with recorded founder approval, records provenance, and passes axe, no-horizontal-scroll, light and dark, 360/768/1280, 44px phone targets.
- Docs: acceptance record `docs/acceptance/communities-c11*.md` per slice with evidence, deferrals (attachments, groups, push, presence, search) and gates; the privacy and legal gates in section 14 are listed as open, not approved.
