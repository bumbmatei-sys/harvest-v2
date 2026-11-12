# Communities C12a: reports, moderation page, mute/ban, held content (design)

Status: approved by the founder on 12 Nov 2026 ("Can you properly handle more than just the core? If so, let's go. Use the studio admin design"; two PRs, "Yes, go"). Plan: `docs/superpowers/plans/2026-11-12-communities-c12a-moderation.md`. Migration `0039_community_moderation`.

References: PRD §6.1, §6.7 and §8 (roles table); ADR 0013 §4a and §5.

The moderation page is a Studio Admin page: a table, a side sheet and tabs, built from shared shadcn components. Member-facing controls (the Report menu and dialog) follow the existing forum layout.

## Split

- **C12a (this PR):** reports, the moderation page, mute and ban, and held content (first-post approval and a banned-words list).
- **C12b (next PR):** warnings, appeals by banned members, and post/reply edit history.

The platform-operator powers (delete anything across ministries and email the reason) stay a later platform feature.

## Roles and rank

- **Hosts** are the community roles owner, admin and moderator.
- **Rank:** owner 3, admin 2, moderator 1, contributor and member 0.
- A host can mute, ban or unban only someone with a lower rank than their own. Nobody can act on the owner, and nobody can act on themselves.
- Content decisions (reports and held items) are open to any host, except about themselves or their own content. Removing or rejecting content also needs a higher rank than its author (review on #63).

## Data (migration 0039)

**`communities` gains:**
- `hold_first_posts boolean default false`;
- `banned_words text[] default '{}'`: at most 100 words, each 1–40 characters, stored lower-case and trimmed.

**`community_memberships` gains** `muted_until timestamptz`.

**`community_posts` and `community_comments` gain:**
- `held_at timestamptz`: null means published;
- `held_reason text`: `first_post` or `banned_word`.

**`community_reports`:**
- Columns: `id`, `tenant_id`, `community_id`, `reporter_id` (users, set null on delete), `target_type` (`post`, `comment` or `member`), `target_id text` (a post or comment uuid, or a user id), `reason` (`spam`, `harassment`, `inappropriate` or `other`), `note` (≤ 500 characters), `status` (`open`, `dismissed` or `actioned`), `decided_by`, `decided_at`, `created_at`.
- At most one open report per reporter per target (partial unique index).

**`community_moderation_actions`** (moderation history):
- Columns: `id`, `tenant_id`, `community_id`, `actor_id`, `action`, `target_type`, `target_id`, `subject_user_id`, `detail jsonb`, `created_at`.
- `action` is one of `report_dismiss`, `report_remove`, `held_approve`, `held_reject`, `mute`, `unmute`, `ban` or `unban`.
- Every row is also written to `audit_logs`.

**RLS:**
- Both new tables have FORCE RLS and staff tenant policies.
- Hosts get a SELECT policy through a new STABLE invoker predicate, `community_is_host(tenant, community)`: the caller has an active membership with a host role.
- Members never read reports or moderation actions. Reporters are never exposed to the person they reported.
- Writes go only through definers, with owner policies keyed on settings and the reset function extended.

**Definers** (jsonb `{outcome, id}`; same pattern as 0038):
- **`community_report(slug, target_type, target_id, reason, note)`:**
  - the caller must be a reader of the community, and the target must exist and be visible to them;
  - people can't report themselves or their own content;
  - outcomes: `ok`, `duplicate`, `not_found`, `forbidden`.
- **`community_report_decide(slug, report_id, decision keep|remove)`:**
  - hosts only;
  - `remove` soft-removes the post or reply. For member reports, `remove` is not allowed and member actions are used instead;
  - closes every open report on the same target;
  - records a moderation action.
- **`community_member_moderate(slug, user_id, action mute|unmute|ban|unban, days)`:**
  - checks the rank rules;
  - mute lasts 1, 7 or 30 days;
  - ban sets the membership to `banned`, revokes the person's active grants for the community, and declines any open application;
  - unban sets the membership to `left`, so the person can rejoin through the normal way in;
  - records a moderation action.
- **`community_held_decide(slug, target_type, id, approve|reject)`:**
  - hosts only;
  - approve clears `held_at`; reject soft-removes the item;
  - records a moderation action.
- **Changed definers:**
  - `community_post_save` and `community_comment_save` refuse muted members (`muted`). They hold a new item when the first-post rule applies (`hold_first_posts`, the author is a plain member, and the author has no published post or reply in the community) or when a banned word matches. A match is a whole word, case-insensitive, in the title, the body text or the reply.
  - Edits run the banned-words check again. Clean edits never un-hold an item.
  - `community_like_toggle` refuses muted members and held targets.

## Server

- **`src/lib/moderation.ts` (pure, unit-tested):**
  - report reasons, mute durations, the rank function and `canActOn(actorRole, targetRole)`;
  - `normaliseBannedWords`;
  - `matchesBannedWord(text, words)`, which mirrors the SQL rule.
- **`src/server/community-moderation.ts`:**
  - `reportContent`;
  - `moderationQueue(slug)`: open reports grouped by target, with an excerpt, reasons, count and first-reported date (reporter ids are never returned);
  - `heldItems`, `decideReport`, `decideHeld`;
  - `moderationMembers` (active, muted and banned; hosts only), `moderateMember`, `moderationHistory`.
- **Forum reads:**
  - `listPosts`, `getPost` and the comment lists hide held items from everyone except their author and hosts;
  - counts exclude held items;
  - the author sees an "Awaiting review" badge.
- **Owner settings:** `updateCommunity` accepts `holdFirstPosts` and `bannedWords`.
- **Routes:**
  - `POST /api/communities/[slug]/reports`;
  - `GET` and `POST /api/communities/[slug]/moderation/reports` (`POST` is decide);
  - `.../moderation/held`;
  - `.../moderation/members`;
  - `.../moderation/history`.
  - The existing `moderation` POST stays for pin/unpin/remove.
  - All routes sit behind the flag, and non-readers get 404.

## UI

- **Report:** a "Report" menu item on post pages, replies and member rows. A dialog offers a radio group of reasons and an optional note. Success shows "Thanks — the hosts will review it."
- **CommunityShell:** a "Moderation" rail item (shield icon), shown only to hosts, with a count badge of open reports plus held items.
- **`/communities/:slug/moderation`:** a Studio Admin page with tabs.
  - **Reports:** a table with item, type, top reason, reports and first reported. A row opens a side sheet with the content, the reasons and notes (anonymous), and Keep or Remove.
  - **Held:** a table with item, author, reason and date, and Approve or Reject.
  - **Members:** a table of members with role, status and "Muted until", a search box, and a row menu: Mute (1, 7 or 30 days), Unmute, Ban (with a confirmation) and Unban. Actions the rank rules don't allow are hidden.
  - **History:** a table with date, host, action and item.
- **Editor, People step:** a **Moderation** card with the "Approve new members' first post" switch and a banned-words list (chips, with add and remove).
- **Muted members:** the composer and reply box show "You can't post until {date}."

## Not in C12a

Warnings, appeals and edit history (C12b); notifications (C15); platform-operator tools; spam rate limits (an activation gate).

## Testing

**Integration (two ministries):**
- report visibility: hosts only, reporters anonymous, no reporting of oneself, duplicates refused;
- keep and remove close every report on the target;
- the rank rules for mute, ban and unban;
- a ban revokes grants, and the banned person reads nothing;
- muted members can't post, reply or like;
- first-post hold and banned-word hold, both visible only to the author and hosts; approve publishes, reject removes;
- held items are not likable;
- ministry B can't see A's reports;
- the restricted owner for the new and changed definers.

**Unit:** banned-word normalisation and matching, and `canActOn`.

**Browser:**
- a member reports a post and a reply;
- the host sees the queue, removes one item and keeps another;
- the host mutes the member, and the member can't post;
- the host enables first-post approval and adds a banned word;
- a new member's post is held, then approved; a banned-word reply is held, then rejected;
- ban and unban;
- the History tab;
- axe, no horizontal scroll, light and dark at three sizes.
