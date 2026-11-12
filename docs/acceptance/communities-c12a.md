# Communities C12a: reports, moderation page, mute/ban, held content

Design: `docs/superpowers/specs/2026-11-12-communities-c12a-moderation-design.md`. Plan: `docs/superpowers/plans/2026-11-12-communities-c12a-moderation.md`. Migration `0039_community_moderation`.

## Founder decisions (12 Nov)

- C12 moderation is next; chat (C11) stays after the first release, as ADR 0013 orders it.
- Scope: more than the core. Split into C12a (this PR) and C12b (warnings, appeals, edit history).
- The moderation page uses the Studio Admin design.
- Platform-wide admin powers (delete anything and email the reason) remain a later platform-operator feature.

## Delivered

- **Pure rules** (`src/lib/moderation.ts`, unit-tested):
  - rank and `canActOn`;
  - report reasons and mute durations;
  - banned-word normalisation and whole-word matching, mirrored in SQL.
- **Migration 0039:**
  - **New tables:** `community_reports` (one open report per reporter per target) and `community_moderation_actions` (history). Both have FORCE RLS; staff and hosts get read-only policies through `community_is_host`; the app role has no writes.
  - **New columns:**
    - `hold_first_posts` and `banned_words` on communities;
    - `muted_until` on memberships;
    - `held_at` and `held_reason` on posts and replies.
  - **New definers:** `community_report`, `community_report_decide`, `community_held_decide`, `community_member_moderate` and `community_moderation_members`.
  - **Changed definers:**
    - post save, reply save and like refuse muted members;
    - new posts and replies are held for a first post or a banned word;
    - edits re-check banned words, and a clean edit never releases a held item;
    - held items can't be liked, replied to or reported.
- **Rank rules:**
  - hosts act only on lower ranks, never on the owner or on themselves;
  - unban is limited to the owner and admins;
  - a ban resets the role to member, revokes the person's grants and declines any open application;
  - unban leaves the person free to rejoin through the normal way in.
- **Services and routes:**
  - report;
  - queue grouped by target, never returning reporter ids;
  - held list, decisions, member list and actions, history;
  - the badge count.
  - Every route returns 404 when the flag is off (unit test); non-hosts get 404.
- **Forum:**
  - held posts are listed only for their author, and post pages show held items to the author and hosts;
  - counts exclude held replies;
  - an "Awaiting review" badge;
  - muted members see "You can't post until …" instead of the composer or reply box.
- **UI:**
  - a Report dialog on posts, replies and members;
  - a Moderation rail item (hosts only) with a review badge;
  - `/communities/:slug/moderation`: Reports (review sheet with Keep and Remove, or Manage member), Held (Approve and Reject), Members (search, row menu with mute 1, 7 or 30 days, unmute, ban with confirmation, unban) and History tabs;
  - the editor People step has a Moderation card with the first-post switch and banned-word chips.

## Evidence (local, author-executed)

- **Static checks:** lint and source guards, typecheck, and 410 unit tests.
- **Integration:**
  - `community-moderation-db` covers report rules, host-only reads, ministry B isolation, no direct writes, decisions closing every report on a target, the rank rules, a ban revoking grants, mute blocking posts, replies and likes, held content, and SQL banned-word matching.
  - `community-moderation` covers the queue without reporter ids, non-hosts getting 404, mute in the member's context, ban and rejoin after unban, history names, owner settings validation, and held visibility in lists, posts and counts.
  - The restricted-owner suite (`community-joining-definer-owner`, run as a non-superuser) runs report, decide, held, mute, unmute, ban, unban and the member list.
- **Browser (`community-moderation`):**
  - a member reports a post with a note, and reports a member;
  - members have no moderation page (404);
  - the host reviews and removes the post, opens the member from the report, mutes them (they can't post, in the UI or the API), unmutes, and keeps the member report;
  - the owner turns on first-post approval and adds a banned word;
  - a newcomer's first post is held and visible only to them;
  - a banned-word reply is held;
  - the host approves one held item and rejects the other;
  - ban (the person is sent to the public page) and unban;
  - History lists every action;
  - axe and no horizontal scroll at 390, 768 and 1440 wide, light and dark; screenshots in `docs/screenshots/communities-c12a/`.
- **Regression:** `community-forum`, `community-joining`, `community-applications`, `community-editor` and `layout`.

## Review follow-up (non-author review of `49c4bd8`: CHANGES-REQUESTED, two should-fix items, no blockers)

- **Hosts deciding about themselves:** `community_report_decide` and `community_held_decide` now refuse (`forbidden`) when the subject is the acting host. Hosts never see reports or held items about themselves or their own content in the queue, the held list or the rail badge, so free-text notes about a host never reach that host. Covered by database and service tests.
- **Rank for removal:** removing a reported post or reply, or rejecting a held item, needs a higher rank than the author (`community_member_rank`). A moderator can't remove an admin's or the owner's content; nobody removes the owner's. Keeping or approving needs only the not-yourself rule.
- **Optional, taken:**
  - the SQL banned-word check lower-cases the stored words too (test);
  - the moderation tabs have 44px targets.
- **Optional, not taken:**
  - *Non-ASCII word boundaries:* these depend on the database collation and are recorded for the activation checklist.
  - *Attachments of held posts:* random ids, listed only on the hidden post.
  - *Report rate limits:* an activation gate.
  - *List caps:* 2,000 members and 200 queue/history rows.
  - *Pre-emptive bans of non-active members:* intended.

## Deferred

- C12b: warnings, appeals by banned members, edit history.
- Notifications to reporters and moderated members (C15).
- Spam rate limits on reports and other member writes (activation gate, as before).
- Ministry staff moderating without a community host role (they can be added as community admins today).

## Gates

No merge, deployment or activation is authorized by this PR. Production migrations 0031–0039 are not applied. Communities remain off in production.
