# Communities C12b: warnings, appeals, edit history

Design: `docs/superpowers/specs/2026-11-12-communities-c12b-moderation-design.md`. Plan: `docs/superpowers/plans/2026-11-12-communities-c12b-moderation.md`. Migration `0040_community_moderation_b`. Stacked on C12a (PR #63).

## Founder decisions (12 Nov)

- C12b scope: warnings, appeals by banned members, and post/reply edit history.
- The pages use the Studio Admin design.

## Delivered

- **Pure rules** (`src/lib/moderation.ts`, unit-tested): reason and message limits, who may decide an appeal (any host declines; owners and admins approve), one appeal per ban, and when an edit leaves a revision.
- **Migration 0040:**
  - **New tables:** `community_warnings`, `community_appeals` (one open appeal per person), `community_post_revisions` and `community_comment_revisions`. All have FORCE RLS; staff and hosts get read-only policies; owner policies are keyed on the definer settings; the app role has no writes.
  - **Action list:** `community_moderation_actions` accepts `warn`, `appeal_approve` and `appeal_decline`.
  - **New definers:** `community_warn`, `community_warning_ack`, `community_my_warnings`, `community_appeal_submit`, `community_appeal_decide` and `community_my_bans`.
  - **Changed definers (signatures kept):**
    - post and reply save keep the previous version when the content changed (latest 50);
    - unban settles an open appeal as approved;
    - the member list adds each person's warning count.
- **Warnings:**
  - hosts warn lower-ranked active members with a reason (1-500 characters), under the C12a rank rules;
  - the member sees unacknowledged warnings as an Alert at the top of the forum, with Acknowledge;
  - hosts see the count in the Members tab and a Warn item in the row menu;
  - the issuer is never returned to the member.
- **Appeals:**
  - a banned member sends one appeal per ban (1-1000 characters) from `/account/communities`, which lists removals in their own section;
  - hosts get an Appeals tab (table and review sheet): decline, or approve and unban (owner and admin only), with an optional reply the member sees;
  - open appeals add to the Moderation badge;
  - an unban on the Members tab settles an open appeal as approved;
  - a decline allows no new appeal until a new ban.
- **Edit history:** hosts open "Edit history" from the edited post byline, from a reply, and from the Reports sheet. Versions render with `RichTextView` or as text, never HTML. Members never read revisions (RLS; the reply edit count is zero for them).
- **Routes** (all 404 with the flag off; unit test): `POST .../moderation/warnings`, `POST .../warnings/[warningId]`, `GET|POST .../moderation/appeals`, `GET .../moderation/revisions`, `POST /api/account/community-appeals`.
- **History tab:** warn, appeal approve and appeal decline are logged and audited like the C12a actions.

## Evidence (local, author-executed)

- **Static checks:** lint, source guards and typecheck clean; 414 unit tests pass.
- **Integration:**
  - `community-moderation-b-db` (4 tests): warn rank rules and limits, host-only reads, ministry B isolation, no direct writes, acknowledge once, appeal rules (one per ban, decide rules, unban settles, re-ban allows a new appeal), revision capture, the 50-version cap, and the new action values.
  - `community-moderation-b` (3 tests): the service layer for warnings, appeals and edit history, including non-host 404s.
  - The restricted-owner suite (`community-joining-definer-owner`, run as a non-superuser) covers the new tables and definers, with the 5 upgrade suites.
  - C12a and the other Communities suites still pass (74 tests across 12 files).
- **Browser (`community-moderation-b`):**
  - the host reads earlier versions of an edited post and reply; members have no history button and the API answers 404;
  - the host warns a member, the member sees the Alert and acknowledges it, and the count shows in the Members tab;
  - a banned member appeals from their account page (a second appeal is refused); the host declines with a reply; after unban and a new ban the member appeals again and the host approves; the member sees each decision and can rejoin;
  - the History tab lists every action;
  - axe and no horizontal scroll at 390, 768 and 1440 wide, light and dark; screenshots in `docs/screenshots/communities-c12b/`.
- **Regression:** `community-moderation`, `community-forum` and `community-editor` browser specs.

## Deferred

- Notifications for warnings and appeal decisions (C15).
- Rate limits on appeals beyond one per ban (activation gate).
- Platform-operator tools (unchanged from C12a).

## Gates

No merge, deployment or activation is authorized by this PR. Production migrations 0031-0040 are not applied. Communities remain off in production.
