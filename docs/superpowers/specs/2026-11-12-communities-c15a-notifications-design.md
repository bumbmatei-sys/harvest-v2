# Communities C15a: in-app notifications, preferences and member onboarding (design)

Status: approved by the founder on 12 Nov 2026. Plan: `docs/superpowers/plans/2026-11-12-communities-c15a-notifications.md`. Migration `0041_community_notifications`. Stacked on C12b (#65, migration 0040), because it changes the same forum definers.

References: PRD §6.6 (onboarding), §6.7 (notifications) and §8 (`community_notification_prefs`); ADR 0013 §4a.

Design is Eden's, style is Studio Admin's.

## Founder decisions (12 Nov)

1. **Split:** C15a covers in-app notifications, preferences and onboarding. C15b covers email (instant important events plus daily/weekly digest, unsubscribe), sent through the job queue to a local test mailbox and switched off in production until the email provider is activated.
2. **Events:**
   - replies and likes (likes grouped);
   - announcements;
   - membership and moderation (application decisions, warnings, held decisions, appeal decisions);
   - for hosts: new reports, held items and appeals.
   - @mentions are not in C15a.
3. **Onboarding:** a dismissible welcome checklist card at the top of the forum.

## Behaviour

**Who gets notified:**

| Event | Recipient | Kind |
|---|---|---|
| Reply to my post | post author | `reply` |
| Reply after mine in a thread | earlier repliers (at most 50 per reply) | `thread_reply` |
| Like on my post or reply | author; grouped per target | `like` |
| Application approved, declined or info requested | applicant | `application` |
| Warning issued | member | `warning` |
| My held post or reply approved or rejected | author | `held_decision` |
| Appeal decided | appellant | `appeal_decision` |
| New report, held item or appeal | hosts (owner, admin, moderator) | `host_queue` (grouped per community) |

**Never notify:**
- the actor about their own action;
- a member who has muted the community, or turned that kind off;
- anyone who can no longer read the community (`community_can_read`).

Banned members still receive the `appeal_decision` notification through the account page, not the community bell.

**Grouping:**
- `like` keeps one unread row per recipient and target, storing the latest actor and a count. Reading it starts a new group.
- `host_queue` keeps one unread row per host and community, with a count.

**Announcements:**
- No rows are written.
- The bell lists posts in hosts-only categories, and pinned posts, created after the member's `notifications_seen_at` (at most 20), unless announcements are turned off or the community is muted.
- Opening the bell sets `notifications_seen_at`.

**Unread count:**
- unread rows plus unseen announcements;
- shown on the bell, capped as "99+".

**Retention:** read notifications older than 90 days are deleted by the existing purge command pattern, as an idempotent function. Scheduling it is an activation step, like the applications purge.

## Data (migration 0041)

**`community_notifications`:**
- Columns:
  - `id`, `tenant_id`, `community_id`, `recipient_id` (users, cascade);
  - `kind` (the kinds above), `target_type` (`post`, `comment`, `application`, `warning`, `appeal` or `community`), `target_id text`, `post_id uuid null` (for linking);
  - `actor_id` (users, set null), `actor_count int default 1`, `detail jsonb` (small, no free text from other members);
  - `read_at`, `created_at`, `updated_at`.
- Indexes: `(recipient_id, community_id, read_at, created_at desc)`, plus a partial unique index for grouping (unread `like` per recipient and target; unread `host_queue` per recipient and community).
- RLS: FORCE RLS; a SELECT policy `recipient_id = app.user_id` for members; staff tenant SELECT; the definer owner policy keyed on `app.community_definer_tenant`. The app role gets no direct writes.

**`community_memberships` gains:**
- `notify_replies boolean default true`, `notify_likes boolean default true`, `notify_announcements boolean default true`;
- `notifications_muted boolean default false`;
- `notifications_seen_at timestamptz`;
- `welcome_dismissed_at timestamptz`.

**`communities` gains:**
- `welcome_message text` (≤ 1,000 characters, null);
- `intro_category_id uuid null` (FK to `community_categories`, set null).

**Definers:**
- A helper `community_notify(tenant, community, recipient, kind, target_type, target_id, post_id, detail)`:
  - not granted;
  - applies the never-notify rules and the member's preferences;
  - upserts grouped kinds.
- The following definers are changed with `CREATE OR REPLACE`, building on 0040's versions and keeping their signatures:
  - `community_comment_save` (`reply`, `thread_reply`, `host_queue` when held);
  - `community_post_save` (`host_queue` when held);
  - `community_like_toggle` (`like`, only on like, never on unlike);
  - `community_report` (`host_queue`);
  - `community_held_decide` (`held_decision`);
  - `community_warn` (`warning`);
  - `community_appeal_submit` (`host_queue`);
  - `community_appeal_decide` (`appeal_decision`).
- Application decisions run in the staff path (`decideApplication`, `withTenant`). That path inserts the notification under its tenant policy, so `community_notifications` needs a staff INSERT policy for this one case.
- **New member definers:**
  - `community_notifications_list(slug, limit)`: the caller's rows plus announcements;
  - `community_notifications_read(slug, ids uuid[] | null)`: null means all, and also sets `notifications_seen_at`;
  - `community_notification_prefs_save(slug, replies, likes, announcements, muted)`;
  - `community_welcome_dismiss(slug)`.
- **Purge:** `community_purge_notifications()`, run by the `communities:purge-notifications` npm script as the application role.

## Server

- **`src/server/community-notifications.ts`:** `listNotifications`, `unreadCount`, `markRead`, `savePreferences`, `dismissWelcome`.
- The forum context gains `welcome` and `prefs`.
- `updateCommunity` accepts `welcomeMessage` and `introCategoryId` (the category must belong to the community).
- **Routes** under `/api/communities/[slug]/notifications`: `GET` the list; `POST /read`; `PUT /preferences`; `POST /welcome/dismiss`. All are behind the flag, and non-readers get 404.

## UI (Studio Admin style; shared components)

- **Bell:** a `NotificationBell` in the `CommunityShell` header.
  - A 44px icon button with a badge.
  - A popover list with an avatar initial, a one-line summary from a message key per kind, relative time and an unread dot; clicking an item opens the target.
  - A "Mark all read" action and an empty state.
- **Notification settings sheet:** switches for Replies, Likes and Announcements, plus "Mute this community". It opens from the bell and from the welcome card.
- **Welcome card** at the top of the forum, shown until dismissed. It lists:
  - the owner's welcome message;
  - "Read the rules" (links to About);
  - "Introduce yourself", which opens New post preselected to the introductions category, shown only when one is set;
  - "Choose notifications".
- **Editor, People step:** a Welcome card with the message (textarea) and the introductions category (select).
- **Copy:** concise, in `messages/en.json`, with no vendor names.

## Testing

**Integration (two ministries):**
- each event notifies the right person and never the actor;
- preferences, mute and grouping work;
- announcements are worked out on read and respect `seen_at`;
- banned or left members get nothing;
- recipients read only their own notifications, and ministry B reads nothing;
- application decisions notify through the staff path;
- the purge;
- the restricted owner for the new and changed definers.

**Unit:** the summary message mapping, and the unread cap.

**Browser:**
- a member replies, likes, and sees the bell count and list;
- clicking an item opens the post;
- mark all read;
- the settings sheet mutes likes;
- a host sees a `host_queue` notification after a report;
- an announcement in a hosts-only category reaches a member;
- the welcome card with the introductions shortcut, then dismissed;
- the owner sets the welcome message in the editor;
- axe, no horizontal scroll, light and dark at three sizes.
