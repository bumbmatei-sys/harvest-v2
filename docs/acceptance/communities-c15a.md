# Communities C15a: in-app notifications, preferences and member onboarding

Design: `docs/superpowers/specs/2026-11-12-communities-c15a-notifications-design.md`. Plan: `docs/superpowers/plans/2026-11-12-communities-c15a-notifications.md`. Migration `0041_community_notifications`. Stacked on C12b (#65, migration 0040). C15b (email) is separate.

## Delivered

- **Pure rules** (`src/lib/notifications.ts`, unit-tested): kinds, the unread cap, which switch silences which kind, the summary message key per kind and the link each item opens.
- **Migration 0041:**
  - **New table** `community_notifications` (FORCE RLS): members read only their own rows; staff read their ministry; the owner policy is keyed on the definer tenant; one staff INSERT policy (kind `application` only) for application decisions; a purge policy for read rows older than 90 days. The app role has no other writes.
  - **New columns:** the membership gains `notify_replies`, `notify_likes`, `notify_announcements`, `notifications_muted`, `notifications_seen_at`, `welcome_dismissed_at`; the community gains `welcome_message` (1-1000) and `intro_category_id`.
  - **Helpers (not granted):** `community_user_can_read`, `community_notify`, `community_notify_hosts`.
  - **New definers:** `community_notifications_list`, `community_notifications_read`, `community_notification_prefs_save`, `community_welcome_dismiss`, `community_purge_notifications`.
  - **Changed definers (signatures kept, built on 0040/0039):** post and reply save, like toggle, report, held decision, warn, appeal submit and appeal decide.
- **Who is notified:** reply (post author), thread reply (earlier repliers, most recent 50), like (grouped per target, never on unlike), application decisions, warnings, held decisions, appeal decisions, and a grouped host queue notice for reports, held items and appeals. Never the actor; never a muted member or a switched-off kind; never someone who can no longer read the community (appeal decisions excepted).
- **Announcements** are worked out on read: posts in hosts-only categories and pinned posts created after the member last opened the bell (or joined), at most 20. Opening the bell marks them seen.
- **UI:** bell in the community header (44px, badge capped at "99+"), popover list with mark all read and an empty state, a settings sheet (replies, likes, announcements, mute), a dismissible welcome card at the top of the forum and a Welcome card in the editor's People step.
- **Server and routes:** `src/server/community-notifications.ts`; `GET /api/communities/:slug/notifications`, `POST .../read`, `PUT .../preferences`, `POST .../welcome/dismiss`, all behind the flag. `npm run communities:purge-notifications`.

## Evidence (local)

- `npx tsc --noEmit`, `npm run lint` (source guards): clean.
- `vitest --project unit`: 41 files, 422 tests passed.
- Integration (notifications DB and service tests, plus the C05-C12b community suites, 13 files): 81 tests passed.
- Restricted-owner and upgrade suites as the non-superuser `tester` (definer-owner with the new definers, tables and a test, connect-landing, hc03, hc05, hc07, community-applications upgrades): 6 files, 15 tests passed.
- Browser: `community-notifications` (axe, no horizontal scroll, light and dark at phone, tablet and desktop; screenshots in `docs/screenshots/communities-c15a/`), and regressions `community-forum`, `community-moderation`, `community-moderation-b`, `community-applications`, `community-editor` all passed. Runtime and visual evidence is author-executed; independent review is pending.

## Decisions and limits

- Application decisions notify through the staff path (one INSERT policy). Declined applicants and people still waiting cannot read the community, so they see the decision on their application status, not in a bell.
- Banned or removed members get an `appeal_decision` row (their decision is shown on `/account/communities`); the community bell is for readers only.
- A held post or reply that is later approved notifies its author (held decision) but does not send the reply notices that a visible reply would have sent. Candidate for a follow-up.
- Preference changes and welcome dismissal write audit rows; marking notifications read does not (private, high volume).
- Mention notifications, email, digests and unsubscribe are C15b or later.

## Activation gates

- Schedule `communities:purge-notifications` daily (`docs/setup/feature-flags.md`).
- Production migrations 0041 after 0040; not applied.
