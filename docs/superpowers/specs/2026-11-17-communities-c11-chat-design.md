# Communities C11 — chat, channels and direct messages — design

Status: DRAFT revised 17 Nov 2026 after independent review of PR #118 (CHANGES-REQUESTED); founder answers to open questions 1, 3 and 5 and the UI-source decisions are recorded in section 1. Documentation only: no code, migration or route is added by this document. The founder decisions of 17 Nov are recorded in section 1; everything else is a proposal with a recommended default. Nothing here approves a build, a deployment, production activation or any of the HC-02 privacy/legal gates, which all stay UNAPPROVED.

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
2. Transport is **polling first**: the cursor is a per-channel `rev` counter (the returned cursor is the maximum `rev` of the rows returned, never the channel's current counter), unchanged polls get `ETag`/304 from one cheap counter read, and the rail uses a per-community counter. The client is visibility-aware with backoff. A push transport can replace it later with no schema change.
3. DMs: the community owner or admin sets "members may message each other privately" to **on** or **off (channels only)**. Owners and admins can always start a conversation with any active member, and that member can reply for as long as a host who is **currently** owner or admin has sent in it (`staff_engaged_at`, section 6.1), including while muted.
4. Nobody reads DMs silently: DM tables have **no ministry or host read policy**. Hosts see DM text only as a bounded evidence snapshot created by one of the two participants when they report it; the reporter is always identifiable to the deciding host, and the report dialog says so.
5. Retention: deleted messages are soft-deleted and recoverable for 30 days, then purged by a worker-role job (the `connect-retention.ts` pattern). **Reported channel messages are exempt from purge until the report is decided; reported DM messages rely on the evidence snapshot instead** (DM originals are not held, because hosts cannot read them).
6. Attachments in chat are **deferred** (the file scanner is not wired for production); V1 is text, links, mentions and a fixed emoji reaction set.
7. Everything reuses what exists: `community_can_read`, C12 reports/holds/mute/ban, C15 notifications (names only, never message text), community capabilities, `communityRoute`, `CommunityShell`, the `EditorShell` Channels step and the installed shadcn primitives.
8. **Production posture:** C11 is **non-production only** like `communityLiveEnabled()` (`NODE_ENV !== "production"` and Communities on). There is no environment switch for production; a separate activation PR, approved by the founder, is the only way to change that.
9. UI is adopted, not built from scratch: **approved in principle by the founder's standing rule (17 Nov: use kit blocks wherever they fit)**; the exact block per area is named in the C11b PR with its preview. Studio Admin chat code (audited at pinned commit `c16e1af271a1c522a01feb43074b32abfe114241`, section 11) is the fallback only where the kit has nothing, and shared Harvest components wrap them.
10. Four PRs and two migrations (candidates `0057` channels, including channel moderation and the channel purge, and `0058` DMs; next free number after `0056_newsletter_nl01`, not reservations). Open questions 1, 3 and 5 are answered by the founder; 2 and 4 keep their defaults. No privacy/legal approval is claimed.

## 1. Founder decisions (17 Nov 2026, final)

1. **Build order:** C11 chat and channels first; then member profiles (C09b); then C14 events and RSVP. This document specifies C11 and the DM model in full and covers C09b and C14 briefly in section 16.
2. **Realtime:** polling first (short interval, visibility-aware, backoff, ETag/since-cursor), designed so a push transport can replace it later without a schema change.
3. **DMs:** a community setting "members may message each other privately: on / off (channels only)". Regardless of it, admins can always start a conversation with any member and the member can always reply. A member cannot start a DM to an admin unless the admin has messaged first or messaging is otherwise permitted by this spec. Admins do not silently read member-to-member DMs. Blocking and reporting exist. Launch is adults only, so there is no adult-to-minor DM risk.
4. **Retention:** kept until the member or an admin deletes; deleted messages are recoverable for 30 days (soft delete), then purged. Moderation evidence follows the C12 patterns.
5. **Channels are separate from admin inboxes.** Community chat is a member feature; the CRM/Studio inbox is unrelated and shares no table.
6. **UI must not be built from scratch.** Reuse Studio Admin's chat dashboard code, and, subject to founder approval, Shadcn UI Kit items, plus Harvest shared components.

**Founder answers after the first review (17 Nov):**
- Open question 1 **yes**: a member-level opt-out switch for new DMs from other members, plus a notice when an admin turns DMs on (section 6.1).
- Open question 3 **yes**: member-to-member conversations become read-only when an admin turns DMs off; staff-started conversations stay two-way **only while a current owner or admin has engaged them**: this narrows the answer as given, and is the B2 rule in section 6.1.
- Open question 5 **yes, subject to legal review**: DM evidence snapshots are kept 180 days after the decision.
- **Standing rule (founder, 17 Nov): "if we can use a premium component from the ui kit, use it, that is why I paid for it."** Wherever a kit block fits, the kit block is used: `chat-ui10` layout, `chat-ui4`/`chat-ui5` conversation rows, the kit composer, `bubble1` to `bubble7`, `message-scroller`, `form-layout1`, `event-calendar1`, and the `mail-app` blocks later. Those rows are recorded as "approved by founder 17 Nov (use kit)". **Studio Admin chat code is the fallback** only where the kit has no suitable item, and Harvest shared components wrap and compose them. This is the founder's explicit decision and amends `studio-admin-adoption.md` line 60 ("visual reference only"), which is updated in this branch. Harvest keeps its own data layer, routes and permissions; channel capability checks stay on the server.
- **Exit rule:** nothing is hand-built from scratch. If neither a kit block nor the audited Studio Admin code covers a needed screen, the author stops and returns to the founder.
- **Kit access:** the kit token is never printed, searched for, stored or committed; the proxy injects it. Items are fetched with plain `curl` and no `Authorization` header into a scratch directory outside the repository.

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
| Route wrapper and flag | `communityRoute` (session, origin check, flag 404, no-store), `communitiesEnabled()` | `communityChatEnabled()` non-production gate, modelled on `communityLiveEnabled()` (section 13) |
| Worker job pattern | `src/server/connect-retention.ts`, `harvest_worker` role, `requireWorkerRole` (0044, `docs/setup/worker-role.md`) | chat purge job and its run log |
| Owner setup UI | `EditorShell` Channels step (forum categories card, 0038) | "Chat channels" card, DM setting in the People step next to Moderation |
| Member UI | `CommunityShell` icon rail (Chat and Messages are "Coming soon" today), bottom tab bar, `NotificationBell`, `ReportDialog`, `MemberList`, `StatusBadge`, `ConfirmDialog`, `EmptyState` | `ChatLayout`, `ChannelList`, `MessagePane`, `Composer`, `ConversationList` (section 11) |
| Polling client | none shared yet | one shared `usePolling` hook (section 8.5), consumed by chat first; Community Live L3 adopts it (this branch amends the Live design's cursor to the same `rev` pattern, section 8.5) |

No new abstraction is invented without two real consumers: `usePolling` is justified by chat and, in its amended design, Community Live comments; the message pane by channels and DMs. If DMs land after channels, the message list/composer are extracted at that point, in C11c, with both consumers present.

## 4. Data model (proposed; migrations 0057 and 0058)

All new tables carry `tenant_id` and `community_id`, use composite foreign keys `(tenant_id, community_id)` to `communities(tenant_id, id)` with `on delete cascade`, and `FORCE ROW LEVEL SECURITY`. Reads use policies; **every write goes through a narrow `SECURITY DEFINER` function** with a fixed `search_path` that returns outcomes rather than raising (ADR 0013 §4a, the 0038 to 0042 pattern). The application role has no direct write on any chat table. Owner policies for definers are keyed on settings only the definers set and clear (the `community_definer_*` pattern), and the restricted-owner suite covers them. Names are indicative; the migrations fix them.

**Migration numbers.** `drizzle/meta/_journal.json` on main ends at `0056_newsletter_nl01` (`when` 1795400000004). The plan is **two migrations**, each independently reviewable: `0057_community_chat` (channels, channel messages, reactions, read state, settings, `community_chat_state`, notification checks, **all channel moderation**: the `message` report and action targets, `community_message_moderate`, channel-message report handling and the `community_report_decide` extension for channel messages, plus the **channel purge function**, the purge run log, record-failure and health functions) and `0058_community_dm` (DM tables, blocks, evidence, `dm_message` report target and `dm_evidence_view` action, `needs_escalation`, the `community_report_decide` extension for DM reports, the **DM purge function**, and the DM definers). Purge ownership, stated once: **`community_chat_purge_channels(batch)` belongs to 0057; `community_chat_purge_dm(batch)` belongs to 0058**; both are granted to `harvest_worker` only and log to the run log created in 0057; the script calls whichever exist. Both numbers are candidates, not reservations: reconcile with open PRs at build time, never renumber merged migrations, and give each journal entry a `when` greater than the previous entry (above 1795400000004).

### 4.1 Channels and settings (0057)

`community_channels`
- `id`, `tenant_id`, `community_id`, `name` (1 to 60), `emoji` (at most 16, optional), `description` (at most 200, optional), `position`, `created_by`, `created_at`, `archived_at`.
- `posting` (`members` or `hosts`): `hosts` gives a read-only announcement channel for everyone else.
- `access_mode` (`all`, `role`, `invite`, `tier`, `tag`) with `min_role` for `role`. The PRD lists all five. **`tier` and `tag` are accepted by the schema and refused by the server** until tiers (C18) and tags exist, the pattern of the `paid` pricing value in ADR 0013 §3.
- `slow_mode_seconds` (0 to 3600), `last_rev` (bigint, the change counter, section 8.1), `last_message_at`.
- At most 30 active channels per community. Every community gets a "General" channel (migration backfill, and `createCommunity` for new ones).

`community_channel_members` (invite-only channels): `tenant_id`, `community_id`, `channel_id`, `user_id`, `added_by`, `created_at`; primary key `(channel_id, user_id)`.

Additions to `communities`: `chat_enabled` boolean (default true), `dm_policy` (`channels_only` default, or `members`), and nothing else on the wide `communities` row: the community-wide change counter lives in a small table, `community_chat_state` (`tenant_id`, `community_id` primary key, `rev` bigint), created in 0057 (section 8.2). The admin setting is **members may message each other privately: on / off (channels only)**, stored as `dm_policy`; changes are audited. Additions to `community_memberships`: `dm_accept_members` boolean (default true; the member-level opt-out of **new** DMs from other members; it never applies to owners and admins) and `chat_state_rev` (bigint, the member's own version, bumped by their read-state, mute, DM and block writes, section 8.2).

### 4.2 Channel messages (0057)

`community_messages`
- `id`, `tenant_id`, `community_id`, `channel_id`, `author_id` (users, set null on delete), `parent_id` (self reference, **one level**; a reply to a reply attaches to the thread root), `client_id` (uuid; unique per `(author_id, client_id)`, section 8.4).
- `body` (plain text, 1 to 2000, never HTML), `mention_ids` (text array, at most 10, validated as active members who can read the channel). The body contains the token `<@userId>` only for ids in `mention_ids`; any other token is rendered as literal text (section 7.2).
- `seq` (bigint, immutable position) and `rev` (bigint, bumped on every change), both from `community_channels.last_rev`.
- `edited_at`, `pinned_at`, `pinned_by`, `reply_count` (on the root).
- `held_at`, `held_reason` (C12a banned-word hold).
- `deleted_at`, `deleted_by`, `deleted_kind` (`author` or `host`), `purge_after` (= `deleted_at` + 30 days).
- Indexes: `(channel_id, seq)`, `(channel_id, rev)`, `(parent_id, seq)`, `(purge_after) where deleted_at is not null`.

`community_message_reactions`: `tenant_id`, `community_id`, `channel_id`, `message_id`, `user_id`, `emoji` (a fixed allow-list of 12 in a shared constant), `created_at`; primary key `(message_id, user_id, emoji)`; composite tenant and community foreign keys like every other table. A toggle bumps the message `rev` and the channel counter; counts are returned inline.

`community_channel_reads`: `tenant_id`, `community_id`, `channel_id`, `user_id`, `last_read_seq`, `mute` (`none`, `mentions_only`, `all`), `updated_at`; primary key `(channel_id, user_id)`. **What `mute` changes:** `none` (default) means the channel's unread count and mention badge show and mentions notify; `mentions_only` keeps the unread dot but shows no count and notifies only for mentions and thread replies; `all` shows nothing, notifies nothing and sorts the channel below others, but never hides the channel from the member. Unread count = visible (not deleted, not held) messages with `seq > last_read_seq` not authored by the member, **counted over a limit of 100** (shown "99+") so the rail query is bounded; mentions since `last_read_seq` are counted the same way. A write to `last_read_seq` or `mute` bumps the member's `chat_state_rev`.

**Channel moderation in 0057.** `community_reports.target_type` gains `message`; `community_moderation_actions` gains `message_remove`, `message_restore`, `message_pin`, `message_unpin` and target `message`; `community_message_moderate`, channel-message report handling (queue, held tab source) and the `community_report_decide` extension for `message` targets are all in 0057, so C11a is complete without 0058.

**Notification check extensions (0057).** `community_notifications` carries CHECK constraints `community_notification_kind` and `community_notification_target` (defined in 0041). The migration drops and re-adds them with the new kinds `chat_mention`, `chat_reply`, `dm` and the new target types `message`, `dm_conversation` (and `channel` for grouping), and the C15 helper functions and the purge function learn the new kinds. Existing rows must still satisfy the new checks (upgrade test).

### 4.3 Direct messages (0058)

Separate tables, **not** a union on `community_messages`: the read policies differ in kind (community predicate versus participant), and keeping them apart makes it impossible for a ministry or host policy written for channels to expose a DM.

`community_dm_conversations`
- `id`, `tenant_id`, `community_id`, `pair_key` (the two user ids sorted and joined; **unique per community**), `origin` (`staff` or `member`; the original starter, kept for history), `started_by`, `staff_engaged_at` (nullable timestamp, section 6.1), `staff_engaged_by`, `created_at`, `last_rev`, `last_message_at`.
- `origin` alone never grants anything. Whether a member may send is decided at send time from `staff_engaged_at` **and the host's current rank** (section 6.1).

`community_dm_participants`: `tenant_id`, `community_id`, `conversation_id`, `user_id`, `last_read_seq`, `muted`, `hidden_at`, `left_at`; primary key `(conversation_id, user_id)`. Exactly two rows in V1; groups are additive later. Read and mute writes bump the member's `chat_state_rev`.

`community_dm_messages`: `tenant_id`, `community_id`, `id`, `conversation_id`, `author_id`, `client_id`, `body` (1 to 2000), `seq`, `rev`, `edited_at`, `deleted_at`, `deleted_by`, `purge_after`. No pins, threads or reactions in V1. Delete is **delete for everyone**, shown as a tombstone; only the author deletes or restores.

`community_dm_blocks`: `tenant_id`, `community_id`, `blocker_id`, `blocked_id`, `created_at`; primary key `(community_id, blocker_id, blocked_id)`. Community-scoped.

### 4.4 Reports and evidence (channel parts in 0057, DM parts in 0058)

- `community_reports.target_type` is extended with `message` in **0057** and with `dm_message` in **0058** (reasons and the one-open-report rule unchanged); 0058 also adds `needs_escalation` (boolean) and `reminded_at` to `community_reports`.
- **Who decides.** Channel-message reports are decided by any host as today. **`dm_message` reports are decided by owner and admin only; moderators see that a DM report exists, its reason and note, but not the snapshot and cannot decide it.** The report is also visible to the deciding host with the **reporter identified**: a DM has exactly two parties, so anonymity from the reported person's side is not achievable, and the report dialog and the notice at submit say so in plain words ("The community's owners and admins will see your name, the message and the few messages before it.").
- **Recusal and escalation.** An owner or admin who is a **party** to the reported conversation cannot see the snapshot or decide the report; it goes to any other non-party person who holds owner or admin capability. Per ADR 0013 §5, ministry owners and admins already hold community owner and admin capability for their ministry's communities, so "escalate to ministry owners" is **not a separate routing path**: the pool is simply every non-party holder of that capability, community or ministry. `needs_escalation = true` is the state when that pool is empty (for example the reported person is the only owner and admin). The report then waits, visibly, and the reporter is told that no reviewer is available; platform review does not exist yet. This is a founder policy item (section 14, item 4).
- **Maximum-open horizon.** An open DM report must not keep its snapshot forever: owners and admins get a grouped reminder (the C15a `host_queue` notice) at 14 and 45 days, and at **90 days** a scheduled step in the purge job closes it as `expired` (action `report_expire`, audited), setting `expires_at` to that time plus 30 days. These figures are proposals for the founder and legal review.
- `community_dm_report_evidence`: `tenant_id`, `community_id`, `report_id`, `conversation_id`, `snapshot` (jsonb: the reported message and up to **5** preceding messages, each with the author's display name, time and body), `created_at`, `expires_at` (null while the report is open). **Why 5:** enough to show what the reported message answers without importing a conversation's history; the reporter may add their note, and a participant can report again for further context. It is written by `community_dm_report` in the same transaction as the report, copying only what the reporter could see.
- **`expires_at`** is set by `community_report_decide` (extended in 0057 for `message` targets and in 0058 for `dm_message` targets) to the decision time plus 180 days (founder-approved figure, subject to legal review); it is never set while the report is open. Hosts read a snapshot only through `community_dm_evidence_view(report_id)`, a definer that checks owner/admin rank and non-party status and writes an audit row and a `dm_evidence_view` action.
- Channel-message reports need no snapshot: hosts can read channels, **removed and soft-deleted messages stay readable to hosts** (section 4.5), and a message that is the target of an open report is exempt from purge.
- `community_moderation_actions` gains `message_remove`, `message_restore`, `message_pin`, `message_unpin` and target `message` in **0057**; `dm_evidence_view`, `report_expire` and target `dm_message` in **0058**.

### 4.5 Row-level security

- **Channels, messages, reactions, channel reads:** a staff tenant policy (ministry role through `withTenant`, ministry-wide by ADR 0013 §4a and narrowed by `can()` in services) plus a member read policy calling `community_channel_can_read`, which is `community_can_read(...)` **and** channel access (`all`; `role` with rank at least `min_role`; `invite` with a `community_channel_members` row; hosts always) **and**, for non-hosts, `archived_at is null`. **Messages:** the member policy additionally requires `deleted_at is null or <the caller is a host>` and `held_at is null or author = caller or <caller is a host>`. Decision (S2): **removed messages stay readable to hosts** (restore and adjudication need them), and members never read a deleted body; the API also returns tombstones without bodies to members. Where the service must show a member a tombstone, it reads through a definer that returns id, time and kind only.
- **DM tables (`community_dm_conversations`, `community_dm_participants`, `community_dm_messages`, `community_dm_report_evidence`):** there is **no staff tenant policy, no host policy and no ministry policy**. Conversations, participants and messages are readable only by a participant (`exists participant row for app.user_id`). **`community_dm_report_evidence` has no select policy for the application role at all**; it is read only through `community_dm_evidence_view`. `community_dm_blocks` is readable by the blocker only. A ministry owner querying through `withTenant` reads nothing from any of them.
- Every table is `FORCE ROW LEVEL SECURITY`, tenant and community ownership are composite, and every definer re-checks membership status, community, ban and mute inside the function.

### 4.6 Definer functions (proposed)

Channel setup (owner and admin): `community_channel_save`, `community_channel_delete` (archive when it has messages, hard delete only when empty), `community_channel_reorder`, `community_channel_members_set`.
Messages: `community_message_send(slug, channel_id, parent_id, body, mention_ids, client_id)`, `community_message_edit`, `community_message_delete` (own), `community_message_moderate(action pin|unpin|remove|restore, id)`, `community_reaction_toggle`, `community_channel_read(channel_id, up_to_seq)` (clamps `up_to_seq` to the channel's current maximum `seq`), `community_channel_prefs_save(channel_id, mute)`.
DMs: `community_dm_start`, `community_dm_send`, `community_dm_read`, `community_dm_hide`, `community_dm_mute`, `community_dm_delete_message`, `community_dm_restore_message`, `community_dm_block`, `community_dm_unblock`, `community_dm_report`, `community_dm_evidence_view`, `community_dm_accept_save`.
Worker (granted to `harvest_worker` only, the 0044 pattern; not to `harvest_app` or `PUBLIC`): `community_chat_purge_channels(batch)`, `community_chat_purge_record_failure(code)` and `community_chat_purge_health()` in 0057; `community_chat_purge_dm(batch)` in 0058.
Notification helpers extend `community_notify` (not granted to the app role) for the new kinds.
**Account erasure.** Anonymising channel messages is handled by the existing set-null foreign key; purging a deleted person's DM messages needs a hook in the account-deletion path, which is **not part of C11a to C11d**. It belongs to the account-erasure work (the same owner as the Connect erasure engineering, HC-DEC3/HC-DEC4), as a separate slice named `chat-erasure`. Until it exists, a deleted account's DM messages are **kept**, shown as from "Former member", and the privacy notice must not promise DM purge on deletion; this is recorded as an activation gate (section 14).

## 5. Channels

- **Create and edit** (owner and admin, in the editor's Channels step, "Chat channels" card beside "Forum categories"): name, emoji, description, who can read (`all`, a minimum role, invite-only with a member picker), who can post (`members` or `hosts`), slow mode, archive. Reorder with Move up and Move down (the forum categories pattern, accessible, 44px), not drag-only.
- **Access eligibility.** `all`, `role`, `invite` work at launch. `tier` and `tag` are in the schema and refused by the server with a clear "not available yet" outcome until C18 and tags exist; the UI shows them disabled with "Coming soon", never hidden, so the PRD's five modes are visibly planned.
- **Tier downgrade** (PRD edge case 10): when tiers exist, a tier-gated channel becomes unreadable immediately because the policy re-evaluates the grant on each read; history is kept.
- **Defaults:** every community starts with "General". A community may turn chat off entirely (`chat_enabled = false`), which hides the Chat rail item and returns 404 from chat routes, but keeps data.
- **Archive** keeps messages for hosts and removes the channel from member lists; hard delete only for an empty channel.
- **Channel visibility to non-members.** A channel never appears in search, Discover, sitemap or any public resolver; there is no anonymous read path at all.

## 6. Direct messages

### 6.1 Who may start and who may reply

Let a **host** mean a person who is **currently** an owner or admin of the community (including ministry staff acting as community owner or admin per ADR 0013 §5). Moderators have no special DM power (they are members for this purpose); see open question 2.

**Staff engagement, not a lifelong flag.** `origin = staff` is only history. A conversation becomes **staff-engaged** when `community_dm_start` or `community_dm_send` is called by a host: the definer sets `staff_engaged_at` (and `staff_engaged_by`). At send time for the **other** participant, the definer evaluates: *is `staff_engaged_at` set **and** is `staff_engaged_by` **still** a host of this community (active membership, role owner or admin, not banned)?* If yes, the member may reply regardless of `dm_policy`, mute and the opt-out. A host who is later demoted, removed, banned or who leaves **stops granting** this; the conversation then follows the ordinary rules (and falls to read-only when `dm_policy = channels_only`). Another host who sends in the conversation re-engages it with their own rank. "Always reply" therefore means: for as long as a current host has engaged the conversation, and until the member blocks that host.

**Find or create.** `pair_key` is unique per community, so `community_dm_start` is find-or-create. When a host starts a conversation that already exists with `origin = member`, the existing conversation is reused (history is kept), the host's message is appended, `staff_engaged_at` and `staff_engaged_by` are set, and the member gets a `dm` notification. `origin` is not rewritten. A host starting a conversation that was hidden by the member un-hides it for the member.

| Situation | Start a new conversation | Send in an existing conversation |
| --- | --- | --- |
| Host to any active member | Always, regardless of `dm_policy` | Yes, unless the member blocked the host |
| Member to a host | Only when `dm_policy = members`, or a current host has engaged the conversation | Yes while a current host has engaged it; otherwise only when `dm_policy = members` |
| Member to member | Only when `dm_policy = members` and the recipient has not turned off `dm_accept_members` | Only when `dm_policy = members` (existing conversations are read-only when switched off; founder answer 3) |
| Either side blocked the other | No | No, and the blocked person gets a generic "can't send" with no hint of a block |
| Sender muted (C12) | No | Only where a current host has engaged the conversation |
| Sender or recipient banned, left or removed | No | No; the conversation is hidden from the other side's list for banned or removed members and returns if they rejoin |

Rules that fall out of it:
- **A single outcome for "cannot start".** `community_dm_start` returns the same `not_available` outcome for: the target is not an active member, the target opted out, the policy is off, or either side blocked the other. It never reveals which, so the call cannot be used to probe membership or opt-outs.
- **A member can reply to a host-started conversation** because it appears in their list as soon as the first message is stored (with a `dm` notification), the staff-engagement rule makes sending allowed independent of `dm_policy`, and muting does not block it. Blocking the host, or the host losing the role, are the only ways it closes.
- **A member cannot cold-start a DM to a host** when messaging is off: the recipient picker for members lists only people they may message (Eden's "People you can message"), computed server-side.
- **Switching the setting** never deletes anything. On to off: member-to-member conversations become read-only and staff-engaged ones stay two-way while the engaging host remains a host. Off to on: read-only conversations reopen.
- **Member opt-out and notice (founder answer 1):** a member can switch off "Allow messages from members" (hosts are exempt). When an admin turns DMs on, members see a one-time notice and the join screen mentions it.
- **No adult-to-minor path:** launch is adults only (PRD §2A, `adult_confirmed_at`). A future minors program needs its own review before DMs are touched.

### 6.2 What hosts can and cannot see

- Hosts cannot list, count or open DM conversations. The Moderation page shows DM reports only as reports.
- A DM report creates a **bounded evidence snapshot** (the reported message and up to 5 before it; why 5 is in section 4.4) written at report time from what the reporter could see. Owner and admin who are **not parties** to the conversation may open it through `community_dm_evidence_view`; each open is audited as `dm_evidence_view`. Later edits or deletions by the sender do not alter the snapshot. **Reported DM messages are not held back from purge:** hosts cannot read the original, so the snapshot, not the original, is the evidence. **The reporter is identifiable to the deciding host.**
- A host who needs to act on a DM report uses the existing tools: warn, mute, ban, remove from community (C12 rank rules apply). There is no "delete a DM" for hosts and no "read the whole conversation" button. If the founder wants a break-glass read, it is a separate, audited, owner-only decision (not proposed here).
- A host who is a **participant** in a DM naturally sees that conversation like anyone else.
- Platform operators and database administrators are outside this design; Harvest support access to message content is a founder policy item (section 14).

### 6.3 Block and report

- **Block** (community-scoped): per conversation menu and per profile menu. Blocking stops new messages in both directions from the blocked person's side (their sends fail generically), hides the conversation for the blocker if they choose, and collapses the blocked person's **channel** messages for the blocker ("Message from a blocked member", tap to show). A block never removes anyone from the community and does not hide a host's warnings or appeal notices (those are C12 notices, not DMs).
- **Report** reuses `ReportDialog` with reasons from C12a (`spam`, `harassment`, `inappropriate`, `other`) and a note. For a DM the dialog states that owners and admins will see the reporter's name, the message and the few before it. After a DM report the reporter is offered "Block this person". Decisions and recusal follow section 4.4.
- Blocking a host is allowed; hosts keep every moderation tool, which never required a DM.

### 6.4 Anti-abuse limits specific to DMs

Enforced in the definers by counting recent rows (section 9), not by a request limiter: new conversations at most 10 per member per day and 3 per hour for non-hosts; at most 3 consecutive messages to a person who has not replied; the same message-rate limits as channels; no banned-word hold on DM text (hosts do not scan private DMs; reports and rate limits are the controls).

## 7. Messages

### 7.1 Composition and display
- Plain text only, 1 to 2000 characters, Enter sends and Shift+Enter breaks a line. Display tokenises text client-side: mentions, http(s) links (rendered `rel="nofollow noopener noreferrer ugc"`, never raw HTML), line breaks. The server never stores HTML.
- Draft kept in memory and in `sessionStorage` per channel (wrapped in try/catch; it must render without it), so a failed send or reconnect loses nothing (PRD edge case 13).

### 7.2 Mentions
`@` opens a member picker limited to **members who can read that channel** (so a mention never leaks a channel's existence), up to 10 per message. The server accepts `mention_ids` only for active members who can read the channel, drops others, and **resolves display names only for ids that are in `mention_ids`**; a `<@id>` token whose id is not in `mention_ids` is shown as literal text, so a crafted token cannot reveal any member's name. A mention notifies that person through C15 (`chat_mention`), even in a channel set to "mentions only"; it does not notify muted members or those who cannot read the channel. `@everyone` is not in V1.

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
- Each channel and each DM conversation owns a counter `last_rev`. Inside a definer, a write does `update ... set last_rev = last_rev + 1 returning last_rev` and stamps the new `rev` (and `seq` on creation) on the message row **in the same transaction**. The row lock serialises writers per channel, so commit order equals `rev` order and a poller using `rev > since` **cannot miss a row that commits late**. A global sequence or timestamp cursor lacks that property (sequence values can commit out of order).
- `seq` is the message's immutable position. `rev` changes on edit, delete, restore, pin, unpin, reaction change and reply-count change. Clients merge by `id`.
- **The returned cursor is the maximum `rev` of the rows actually returned** (and equals the request's `since` when none were returned), **never the channel's current `last_rev`**. A page capped at `limit` therefore resumes exactly after its last row, and a change that commits between the range query and a counter read is never skipped.

### 8.2 Endpoints (all behind `communityChatRoute`, JSON, `Cache-Control: private, no-store`, session and origin checks as `communityRoute`)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/communities/:slug/chat/state` | Rail state: for each readable channel `{id, latestRev, unread, mentions, mute}`, plus DM `{unreadConversations, latestRev}`. Unread and mention counts are **bounded** (counted over a limit of 100, shown "99+"). |
| `GET /api/communities/:slug/chat/channels/:channelId/messages?since=<rev>&limit=50` | Messages and changes with `rev > since`, ascending, inline reaction counts and pins, and the `cursor` of section 8.1. No `since` returns the latest 50 with `hasMore` and a `before=<seq>` pager. `ETag` is `W/"<channelId>:<last_rev>"`. |
| `POST .../channels/:channelId/messages` | Send (`client_id`, `parent_id`, `body`, `mention_ids`). Returns the stored message. |
| `PATCH` / `DELETE .../messages/:id`, `POST .../messages/:id/reactions`, `POST .../messages/:id/moderate` | Edit, delete, react, pin/remove/restore. |
| `PUT .../channels/:channelId/read` | `{upTo: seq}`, clamped server-side to the channel's current maximum `seq`; debounced on the client when the bottom of the list is visible. |
| `GET /api/communities/:slug/chat/dms`, `GET .../dms/:conversationId/messages?since=`, `POST .../dms`, `POST .../dms/:conversationId/messages`, `PUT .../dms/:conversationId/read`, `POST .../dms/:conversationId/block|report|mute|hide` | The DM equivalents with the same cursor shape. |

**Rail change detector (replaces any "max of `last_rev`").** A maximum over channels misses changes (channel A at 5 and B at 100). The rail `ETag` is built from **exactly two versions**: `community_chat_state.rev` (the community-wide counter, below) and the member's own `community_memberships.chat_state_rev`: `ETag = W/"<state.rev>:<chat_state_rev>"`. The per-channel `ETag` uses that channel's `last_rev`, which moves on every change inside the channel.

**Which writers bump what.** Community-wide `community_chat_state.rev` is bumped by **channel** activity and structure only: channel message send, edit, delete, restore, reaction, pin and unpin; channel save, reorder, archive and delete; `community_channel_members_set`; a `dm_policy` change. **DM sends never bump it** (it is in every member's rail ETag, so a DM bump would leak DM volume and timing community-wide). The member's `chat_state_rev` is bumped by: their `community_channel_read` and `community_channel_prefs_save`; for **both participants** a DM send, DM edit/delete/restore, read, hide or mute; their own block or unblock; a change of their `dm_accept_members`; and, for each added or removed user, `community_channel_members_set`. Accepted metadata: any member polling the rail can tell that *some* channel activity happened in the community and when (not which channel, and nothing about DMs); restricted channels also bump the community counter, which is flagged in section 14.

**Lock order (no deadlocks).** Every writer takes locks in this fixed order: (1) the per-author advisory lock (sends only), (2) the `community_channels` row, or the DM conversation row (ascending id when several), (3) membership rows (ascending user id), (4) the `community_chat_state` row **last**. Channel save, reorder and `community_channel_members_set` follow the same order, so they cannot deadlock with a send. A reorder touching several channels locks them in ascending id.

**What a poll costs (stated precisely).** A 304 poll is not a single read: the route also resolves the session, the community by slug, the caller's membership and ban status and `community_can_read`/channel access, then one counter read. A changed poll adds one indexed range query on `(channel_id, rev)` and the reaction aggregate for the returned rows. These are small primary-key and index reads; load is still measured in C11a.

### 8.3 Intervals and backoff (client)
- Active channel visible and focused: every **4 s** with ±1 s jitter.
- Visible but unfocused, or no new activity for 2 minutes: **15 s**; after 5 minutes of inactivity: **30 s**.
- Rail state: every **15 s** while visible (the active channel polls at its own rate).
- Tab hidden: **stop**; one immediate poll on `visibilitychange` back to visible and on `focus`.
- Offline (`navigator.onLine` false): stop and resume on the `online` event.
- Errors and 5xx: exponential backoff 2x per failure from the current interval up to **60 s**, reset on success. A `429` honours `Retry-After`. A `401` or `403` stops polling and shows the sign-in or access state; a `404` (chat off, channel archived, access lost) shows "no longer available" and stops.
- Server load note: N viewers produce N/4 requests per second per active channel; with 304 answered after the session, membership and counter reads above this is acceptable at launch scale. If one community's concurrency makes it a problem, the push transport below replaces it; the rate is tunable by a response header (`X-Poll-Interval`) so the server can slow clients down without a deploy.

### 8.4 Idempotency and reconnect
The composer generates a `client_id` per send. A retry after a network failure with the same `client_id` returns the original message (unique index), never a duplicate (PRD edge case 13). **A replayed `client_id` with a different body, channel or parent is rejected** (`client_id_conflict`) rather than silently returning the old message. Optimistic rows are replaced on response or on the next poll that contains their `client_id`.

### 8.5 Shared client hook and transport neutrality
`src/hooks/use-polling.ts` (new, shared, with Community Live L3 as the second consumer) implements visibility, focus, online, jitter and backoff once. The wire shape is transport-neutral: `{ events: [...], cursor }` where `cursor` is the `rev` and each event is a full message state keyed by id. **Live design reconciliation.** `2026-11-16-community-live-design.md` (lines 47, 84, 88) specified a `(created_at, id)` cursor for Live comments. This branch amends those lines: Live comments use the same per-event `rev` counter and the shared `usePolling` hook, so Live L3 is a real second consumer and the two never diverge. A later server-sent-events or WebSocket transport emits the same events and resumes from the same `rev` (the equivalent of `Last-Event-ID`). **No schema change is needed** to switch: the revision counters, idempotency keys and read state are already the contract. Presence and typing, which need push, are deliberately not designed here.

## 9. Rate limits and spam

There is no reusable request limiter outside sign-in (ADR 0013 §4a, still deferred). C11 therefore enforces limits **inside the definers**, deterministic and testable, by counting the author's recent rows on indexed columns:
- Channel messages: at most 5 per 10 seconds and 60 per 10 minutes per member per community; slow mode per channel (hosts exempt).
- Edits: at most 10 per minute; reactions at most 30 per minute; mentions at most 10 per message.
- DMs: section 6.4.
- **Per-author serialisation:** each send takes `pg_advisory_xact_lock(hashtext(author_id || community_id))` before counting, so two concurrent sends from one author cannot both pass a limit.
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
- **Delete is soft:** `deleted_at`, `deleted_by`, `deleted_kind`, `purge_after = deleted_at + 30 days`. The message shows as a tombstone ("Message deleted"). Members never read a deleted body; **hosts can** (section 4.5), which restore and adjudication need.
- **Recovery (30 days):** the author can restore their own deletion from "Recently deleted" in their chat settings; owner and admin can restore a message removed in a channel (`message_restore`, audited). A DM can be restored only by its author: hosts cannot read DMs, so they cannot restore them either. After `purge_after`, the row is gone.
- **Purge job:** `community_chat_purge_channels(batch)` (0057) deletes channel rows with `purge_after < now()` in batches, plus their reactions, skipping messages that are the target of an open report; `community_chat_purge_dm(batch)` (0058) deletes expired DM rows, empties conversations with no remaining messages after both participants have hidden them (and after 30 days without messages), removes expired evidence snapshots and runs the 90-day report expiry of section 4.4. It follows `src/server/connect-retention.ts`: a `runChatPurge` loop over whichever functions exist that stops at an empty batch or the safety cap; `runChatPurgeJob` that records a failure outside the failed transaction (`community_chat_purge_record_failure`); `chatPurgeHealth` for a monitor (counts only, never a name, body or id). Script `scripts/community-chat-purge.ts` / `npm run communities:purge-chat` (added in C11d), run as `harvest_worker` via `WORKER_DATABASE_URL` and `requireWorkerRole`. Each migration revokes its worker functions from `PUBLIC` and `harvest_app` and grants them to `harvest_worker` only if that role exists, never creating it (the 0044 pattern); `docs/setup/worker-role.md` is updated. Scheduling it is an activation gate.
- **Moderation evidence follows C12:** (a) a deleted channel message that is the target of an **open** report is exempt from purge until the report is decided, then purges 30 days after the decision; (b) DM evidence snapshots are kept while the report is open and for **180 days after the decision** (founder-approved 17 Nov, subject to legal review; `expires_at` is set by `community_report_decide`, section 4.4), then removed by the same job; **reported DM messages themselves are not exempt from purge** because hosts cannot read them and the snapshot is the evidence; (c) `community_moderation_actions` and audit rows are retained as C12 retains them and never contain message text.
- **Account erasure and leaving:** a member who leaves keeps their channel messages (the "preserve owned content" rule, PRD edge case 6); on account deletion, channel messages are anonymised ("Former member", `author_id` null by the existing set-null FK) and **DM messages authored by that person are purged**, the other participant keeping their own messages in a conversation shown as "Former member". The **erasure hook is not part of C11a to C11d**: it belongs to the account-erasure work as a separate `chat-erasure` slice (section 4.6). Until it exists, a deleted account's DM messages are kept and shown from "Former member", and the privacy notice must not promise purge on deletion. Needs legal review (open question 5).
- **Community deletion** cascades through the composite foreign keys; the purge job also sweeps orphan evidence.

## 11. UI (kit first, Studio Admin fallback, shared components compose)

Design is Eden's layout (icon rail, channel list column, message pane, pinned-message strip, thread side panel, "People you can message" list); style is Studio Admin through shared shadcn components. No Eden visuals, copy or imagery; copy stays concise and provider-neutral.

**Rule (founder, 17 Nov): use the paid kit block wherever one fits; Studio Admin only where the kit has nothing suitable; nothing hand-built from scratch.** Harvest shared components wrap and compose the adopted pieces. Exit rule: if neither source covers a screen, stop and return to the founder.

**Studio Admin audit (done 17 Nov; read-only, nothing copied).** Repository `arhamkhnz/next-shadcn-admin-dashboard`, shallow clone at **commit `c16e1af271a1c522a01feb43074b32abfe114241`** (16 Nov 2026), MIT, copyright Mohammed Arham Khan. Findings:
- `src/app/(main)/dashboard/chat/page.tsx` is only a **preview page that links out** to the real chat at `src/app/(main)/chat/`.
- Chat code: `page.tsx`, `layout.tsx`, `_components/chat.tsx` (responsive list, thread and contact panel, with `Sheet` on small screens), `chat-conversation-list.tsx`, `chat-thread.tsx` (bubbles, grouped messages, reactions, `MessageScroller`, `InputGroup` composer), `chat-header.tsx`, `chat-sidebar.tsx` (inbox views and channel brand icons), `chat-profile-details.tsx` (contact panel: name, role, company, email, phone), `use-chat.ts` (zustand store over mock data), `data.ts` (1,262 lines of sample data).
- It is a **one-to-one inbox**, not channel chat: it has no channels with posting rules, no threaded replies, no mentions, no pins, no unread read-state sync and no polling. Its primitives `bubble.tsx`, `message.tsx`, `marker.tsx`, `message-scroller.tsx` and `attachment.tsx` under `src/components/ui/` are the same family the kit ships; their origin inside Studio Admin is not stated in the repository and is treated as MIT through Studio Admin's own license.
- Stack matches Harvest (Next 16, React 19, Tailwind 4, `radix-ui`, lucide 1.x). It adds `zustand`, `@shadcn/react` and `@base-ui/react`; the chat files import `cn` from `"cn"` and `@/hooks/use-lg`.
- **Fit:** useful as the fallback for the responsive list/thread composition, the conversation list row and the header; the contact panel and brand-icon sidebar are inbox features Harvest does not need for community chat.

**Kit adoption (founder-approved by the standing rule; decision column "approved by founder 17 Nov (use kit)" in `communities-kit-item-list.md`):** `chat-ui10` for the layout, `chat-ui4` and `chat-ui5` for conversation rows, the kit composer from those blocks, `bubble1` to `bubble7`, and `message-scroller`. Registry facts (verified 17 Nov against `https://shadcnuikit.com/r/<name>.json`): `bubble1` to `bubble7` are standalone `registry:component` items (free) shipping `components/ui/bubble.tsx`; `chat-ui4`, `chat-ui5` and `chat-ui10` are `registry:block` items (premium) that ship `components/ui/bubble.tsx`, `message.tsx` and `message-scroller.tsx` as dependency files. **`message-scroller` has no standalone registry name**: it arrives with a chat block (or from Studio Admin's MIT copy at the audited commit).

**How a kit block is obtained (C11b description, to be repeated in the PR).** Fetch only into a scratch directory outside the repository, with plain `curl` and **no `Authorization` header** (the network proxy supplies access; the token is never printed, searched for, stored or committed): `curl -sS https://shadcnuikit.com/r/<name>.json -o <scratch>/<name>.json`, read the JSON's `files[].content`, **convert** each adopted file (messages catalogue instead of hard-coded English, semantic tokens, no sample data or remote avatars or vendor strings, full width inside the shell with no `mx-auto max-w-*`, 44px phone targets, the 1024px sidebar breakpoint, reduced motion, `sonner` removed or adapted), and write the converted file into the repository. Provenance (item name, registry retrieval date, license, changed files, adaptations) is recorded in `src/lib/ui-provenance.ts` and `docs/ui-sources.md` in the same PR, and the PR links the approved kit decision. Raw kit source is never committed. If the kit license forbids a public repository (the open question in `shadcnuikit-adoption.md`), the licensing answer comes before any premium block lands.

**Existing Harvest components reused (verified present in `src/components/ui` and `src/components`):** `CommunityShell` (the Chat and Messages rail and bottom-bar items change from "Coming soon" to live), `NotificationBell`, `ReportDialog`, `MemberList`, `ConfirmDialog`, `StatusBadge`, `EmptyState`/`ui/empty`, `ui/item`, `ui/avatar`, `ui/badge`, `ui/scroll-area`, `ui/command` and `ui/popover` (mention picker), `ui/input-group`, `ui/field`, `ui/textarea`, `ui/sheet` (thread panel and mobile list), `ui/dialog`, `ui/tabs`, `ui/dropdown-menu`, `ui/skeleton`, `ui/spinner`, the `EditorShell` Channels step (Chat channels card) and People step (DM setting), and the Moderation page (Held and Reports gain chat sources). Also installed and available to the blocks: `toggle-group`, `collapsible`, `sonner`, `tooltip`, `kbd` and `separator`. The only stock primitive the chosen blocks need that is **not** installed is `drawer`, added from the stock shadcn registry where a block requires it. `RichTextView` is not used (chat is plain text).

**New abstractions and exception rationale:** only `usePolling` (two consumers, section 8.5). `ChatLayout`, `MessagePane`, `Composer`, `ConversationList` are thin Harvest wrappers that bind the adopted kit blocks to Harvest data and permissions, built for two consumers (channels and DMs); they are configuration of the adopted block, not a second layout system.

**Responsive:** desktop three columns (rail, list, pane, optional thread panel); tablet two (list in a sheet); phone single column with the list as one screen and the pane pushed, composer above the bottom tab bar, safe-area aware. Light and dark through tokens. Accessibility: the message list is a labelled `role="log"` with `aria-live="polite"` for new messages only when the user is at the bottom, focus not stolen on poll updates, composer labelled, icon-only actions named, keyboard channel switching.

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
| Reply in a conversation engaged by a **current** owner or admin | n/a | n/a | Yes | Yes | Yes, even if muted (until that host loses the role or is blocked) | No |
| Read DM text of others | No | No | No | No | No | No |
| Open a DM report's evidence snapshot (audited) | Yes, if not a party | Yes, if not a party | No (sees reason and note) | No | No | No |
| Block, report, mute, hide | Yes | Yes | Yes | Yes | Yes | No |
| See who is in invite-only channels | Yes | Yes | Yes | No | No | No |

**Delegable capabilities and defaults.** `chat:manage_channels` (default: owner and admin), `chat:dm_start_any` (default: owner and admin; delegating it to moderators is allowed only by the owner, and is the way open question 2's default can be changed) and `chat:dm_evidence` (default: owner and admin who are not parties to the conversation; never delegable to moderators in V1 because the PRD withholds private messages from moderators by default). `chat:moderate` (default: owner, admin, moderator) and `chat:restore` (owner, admin) are not delegable beyond those roles. Capabilities are re-resolved per request.

Ministry staff reach community chat as owner or admin only through the community capability mapping already used for forum and moderation; **no ministry role reads DMs.** Capabilities are re-resolved on each request, so role changes take effect without cache invalidation.

## 13. Feature flag and production posture

- `communityChatEnabled(env)` in a new `src/server/community-chat.ts`, modelled exactly on `communityLiveEnabled()`: **`NODE_ENV !== "production"` and `communitiesEnabled()`**. C11 is **non-production only**. There is **no environment variable that turns it on in production**; changing that is a separate activation PR approved by the founder. A `communityChatRoute` wrapper returns 404 before authentication or database creation in production, around `communityRoute`. Every page checks the flag itself (the C10 review follow-up), the Chat and Messages rail items render only when it is on, and unit tests prove every new route returns 404 in production mode.
- Merging any C11 slice is not activation. No real outbound message, push, email or webhook is sent: C11 sends none itself, and notification email stays behind the existing C15b hard-disabled constant.
- `docs/setup/feature-flags.md` gains the gate description, the purge schedule gate, the worker-role provisioning gate, the erasure-hook gate and the unscanned-attachment note.

## 14. Privacy, legal and security gates (flagged for the founder; no approval is claimed)

1. **DM confidentiality.** DMs are private to two people with no host read path. The privacy notice and community rules must say so, and that a participant can report a message, which shares a bounded excerpt with the community's owner and admin. Needs founder and legal sign-off before real DMs are collected.
2. **Encryption of message bodies.** V1 relies on database and disk encryption at rest; application-level encryption (the HC-DEC5 direction for prayer requests) is **not** applied to messages. HC-DEC5 itself is UNAPPROVED. Founder decision whether DM bodies need it before activation.
3. **Retention periods.** 30-day recovery is a founder decision; the 180-day evidence figure and the erasure behaviour (section 10.2) are proposals needing legal review. A scheduled purge with failure evidence is required before real data, as for HC-DEC4.
4. **Safeguarding.** Adults only at launch, with age attestation as already collected on joining; no minors program. Harassment handling relies on report, mute, ban and appeal (C12). A written escalation process for threats or self-harm in reported DMs is a community-policy and founder item.
5. **Support and platform access.** Who at Harvest, if anyone, may read message content for abuse or legal requests is a policy decision outside this design.
6. **Attachments** stay deferred until a production malware scanner exists.
7. **No consent or CRM effect.** Chat never creates or alters CRM contacts, consents, cases or Harvest Connect data, and chat content is not used by the assistant. Chat is not a consent purpose.
8. **Rail ETag metadata.** The community-wide counter moves on any channel activity, including in restricted (role or invite) channels, so a member polling the rail learns that some channel activity happened and when, never which channel and nothing about DMs. Accepted for V1; a per-channel-eligibility counter is the alternative if the founder objects.
9. **Documents to amend by the founder-approved build:** PRD §6.2 (it says DMs only when both members opt in and lists rich attachments; this design is a community setting plus a member opt-out for new DMs, and defers attachments) and ADR 0013, which at lines 120 and 131 places C11 after the first release (this slice follows the founder's 17 Nov order instead). Neither document is edited here beyond what is stated; the build PRs update them.
10. The five HC-02 privacy/security gates stay UNAPPROVED; merging C11 approves none of them.

## 15. Risks and open questions

Risks: polling load at scale (mitigated by 304 answered after the session, membership and counter reads and the server-tunable interval; push is the exit); hot-channel and community-state counter contention (one channel row lock and one `community_chat_state` row lock per send, in the fixed order of section 8.2; acceptable at launch scale, measured in C11a); definers growing complex (mitigated by per-slice restricted-owner tests); DM abuse without content scanning (mitigated by caps, block, report and the evidence path); the kit license question in `shadcnuikit-adoption.md` still being open (answered before any premium block lands); Studio Admin's fit is audited at `c16e1af` (section 11), and it is a one-to-one mock-data inbox, so the kit and Harvest's own server cover channels, threads, mentions and unread.

**Open questions (founder answers of 17 Nov applied):**
1. *DM setting default and member-level opt-out.* **Answered yes**: `dm_policy` starts at `channels_only`; a member-level "Allow messages from members" switch (default allowed; hosts exempt) and a notice when an admin turns DMs on.
2. *Moderator powers.* **Default kept (not yet answered):** moderators cannot start DMs and cannot read DM evidence; owner and admin only. The owner can delegate `chat:dm_start_any` (section 12).
3. *Member-to-member conversations when DMs are turned off.* **Answered yes**: read-only history; staff-engaged conversations stay two-way while the engaging host is still a host.
4. *Attachments and images in V1.* **Default kept:** deferred until the production malware scanner is wired.
5. *Erasure and evidence retention.* **Answered yes, subject to legal review**: evidence snapshots kept 180 days after the decision. The erasure hook is a separate `chat-erasure` slice; until it exists, deleted accounts' DM messages are kept as from "Former member".

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
- *DM privacy (the central test):* the owner, an admin and a ministry staff user, each through `withTenant` and `withUser`, **cannot select** any `community_dm_*` row they are not a participant of (**including `community_dm_report_evidence`, which has no select policy at all**), cannot count or list conversations, and cannot read a snapshot except through `community_dm_evidence_view` for an actual report; a party to the conversation cannot decide or view that report; a report about the only owner or admin is flagged for escalation; the snapshot contains only the reported message and at most 5 earlier ones; `community_report_decide` sets `expires_at` to the decision plus 180 days and never earlier; a sender's later edit or delete does not change it; `dm_evidence_view` is logged; a moderator gets none.
- *Role matrix:* every cell of section 12 by calling the definers as each role; hosts-only posting; invite-only membership; slow mode; rank rules for remove and pin; mute blocks channel sends and member-started DMs but not replies in a staff conversation; ban closes everything and rejoin restores access.
- *Staff engagement:* a member can reply while a current host has engaged the conversation, including while muted and with DMs off; after the engaging host is demoted, removed or banned the member's sends follow the ordinary rules; another host re-engages it; find-or-create on `pair_key` reuses an `origin = member` conversation when a host starts one; `community_dm_start` returns the same `not_available` outcome for non-member, opted-out, policy-off and blocked.
- *Counters and locks:* a DM send does not change `community_chat_state.rev` or any other member's `chat_state_rev` (ETag unchanged for non-participants); every writer in section 8.2's list bumps what it should; concurrent send, `community_channel_members_set` and channel save never deadlock (fixed lock order); open DM reports remind at 14 and 45 days and expire at 90 days with `expires_at` set.
- *Cursors and the rail:* the rail `ETag` changes when channel A (rev 5) changes while channel B is at rev 100, and when a read-state, mute or DM read write happens; the returned cursor equals the maximum `rev` of the returned rows; a `limit`-capped page resumes without skipping; `PUT .../read` clamps `upTo`; unread counts are capped at 99+; a `<@id>` token outside `mention_ids` renders literally and leaks no name; a replayed `client_id` with a different body is rejected; concurrent sends from one author cannot both pass a limit (advisory lock).
- *Reads of removed content:* members never read a deleted body, hosts do; held messages only author and hosts.
- *Notification checks:* upgrade test that existing rows satisfy the redefined `community_notification_kind` and `_target` constraints and the new kinds insert.
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
| **C11a — channels server and migration** | `0057_community_chat` (channels, messages, reactions, read state, `community_chat_state`, settings columns, notification check extensions, "General" backfill, channel moderation targets and `community_message_moderate`, `community_chat_purge_channels` and the purge run log), channel/message/read definers, RLS, `src/lib/chat.ts`, `src/server/community-chat.ts`, routes behind `communityChatRoute` (non-production gate), polling and cursor tests, restricted-owner and isolation tests | Yes (candidate 0057) | Two-tenant isolation, role matrix, cursors, restricted-owner suite |
| **C11b — channels and messages UI** | Kit blocks (`chat-ui10`, `chat-ui4`/`5`, composer, `bubble1`-`7`, `message-scroller`) fetched with plain curl into a scratch directory and converted, with provenance in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`; Studio Admin fallback only where the kit has nothing; Harvest wrappers (`ChatLayout`, `MessagePane`, `Composer`, `ConversationList`), thread panel, pins, reactions, unread, mute, `usePolling` (and the Live design amendment), editor Chat channels card, Moderation "Chat" source, rail and bottom bar live | No | Browser multi-session, axe, light/dark, 360/768/1280 |
| **C11c — direct messages** | `0058_community_dm` (DM tables, blocks, evidence, `dm_message` report target, `dm_evidence_view`, `needs_escalation`, `community_report_decide` extension for DM reports, `community_chat_purge_dm`), DM definers, DM setting in the People step, conversation list and "People you can message", staff engagement, block and report, evidence view for non-party owner and admin, member opt-out, DM notifications | Yes (candidate 0058) | DM rule matrix, DM privacy, report-evidence flow, restricted-owner suite |
| **C11d — retention job** | `scripts/community-chat-purge.ts`, `npm run communities:purge-chat`, the run loop and health wiring, worker-role runbook update, "Recently deleted" UI, feature-flag doc updates. **No migration**: `community_chat_purge_channels` is in 0057 and `community_chat_purge_dm` in 0058 | No | Purge tests, worker-role tests, failure recording |

Each slice is independently reviewable; the founder-approved order stays C11 then C09b then C14. The `chat-erasure` hook is a separate slice owned by the account-erasure work (section 4.6).

## 19. Acceptance criteria

- A member with access can read, send, reply in threads, mention, react and see unread counts in channels they are eligible for; a member without access (or in another community, or banned, pending or left) reads nothing, in the UI and the API.
- Owners and admins can create, edit, order, archive, restrict and slow channels; moderators cannot; changes apply without a deploy.
- Polling is visibility-aware, backs off on errors, honours `Retry-After`, answers unchanged polls with 304 after the session, membership and counter reads, never misses a committed message, and a retry never duplicates a message.
- DM setting off: members cannot start DMs; owner and admin can start a conversation with any active member and the member can reply, including while muted, for as long as a current owner or admin has engaged the conversation. DM setting on: members can start DMs unless the recipient opted out or blocked them. Switching never deletes data.
- No owner, admin, moderator or ministry user can read DM text except an owner or admin opening a participant-created report snapshot, which is audited.
- Block, report, mute, ban, held content and banned words behave as specified and reuse C12; reports gain channel and DM message targets.
- Deleted messages show a tombstone, are recoverable for 30 days by the allowed people, then purged by the worker-role job with health and failure evidence; messages under an open report are not purged early.
- Notifications use C15, are aggregated, contain no message text, and respect mute and block; no real email, push or outbound message is sent anywhere.
- The feature is **non-production only** (404 before auth in production, no environment switch) until a separate founder-approved activation PR; every new route has a production-mode 404 test.
- UI uses the kit blocks (founder rule 17 Nov), Studio Admin only as the audited fallback and shared Harvest components as wrappers, records provenance in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`, hand-builds nothing, and passes axe, no-horizontal-scroll, light and dark, 360/768/1280, 44px phone targets.
- Docs: acceptance record `docs/acceptance/communities-c11*.md` per slice with evidence, deferrals (attachments, groups, push, presence, search) and gates; the privacy and legal gates in section 14 are listed as open, not approved.
