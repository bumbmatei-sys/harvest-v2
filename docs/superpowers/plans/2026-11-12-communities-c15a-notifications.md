# Communities C15a (in-app notifications, preferences, onboarding): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** members get in-app notifications (bell, list, preferences, mute) for replies, likes, announcements and membership/moderation events, hosts get queue notifications, and new members see a welcome checklist.

**Spec:** `docs/superpowers/specs/2026-11-12-communities-c15a-notifications-design.md`

## Global Constraints

- **Branch and migration:** branch `c15a-community-notifications` (stacked on `c12b-community-moderation`, PR #65); migration `0041_community_notifications`.
- **Flag:** everything sits behind `communitiesEnabled()`.
- **Copy and layout:** copy in `messages/en.json`; concise and provider-neutral; 44px targets; full width; light and dark; Studio Admin style.
- **Database pattern:** every member write is an audited SECURITY DEFINER function with settings-keyed owner policies (0036–0040 pattern). Changed definers are replaced from their 0040 versions with `CREATE OR REPLACE`, keeping their signatures.
- **No outbound email** in C15a.

## Tasks

### Task 1: Pure rules

**Files:** `src/lib/notifications.ts` (kinds, summary message key per kind, the `formatUnread` cap); `tests/unit/notifications.test.ts`.

### Task 2: Migration 0041 and database tests

**Files:** `src/db/schema.ts`, `drizzle/0041_community_notifications.sql` (+ snapshot), `tests/integration/community-notifications-db.test.ts`, `tests/integration/community-joining-definer-owner.test.ts` (extended).

- [ ] Schema plus generate, then the hand-written SQL:
  - RLS;
  - the `community_notify` helper;
  - the replaced definers;
  - the new definers;
  - the purge;
  - grants.
- [ ] Database tests following the spec's testing list. Run the restricted-owner suite as `tester`.

### Task 3: Services and routes

**Files:** `src/server/community-notifications.ts`; changes to `community-forum.ts` (context), `communities.ts` (welcome settings) and `community-applications.ts` (notify on decision); routes; `scripts/purge-community-notifications.ts` plus an npm script; `tests/integration/community-notifications.test.ts`; the flag unit test.

### Task 4: UI

**Files:** `src/components/communities/notification-bell.tsx`, `notification-settings-sheet.tsx`, `welcome-card.tsx`; changes to the shell header, the forum page and the editor's People step; the composer's preselected category; `messages/en.json`.

### Task 5: Browser test, evidence, records, PR

- [ ] `tests/e2e/community-notifications.spec.ts`, with screenshots in `docs/screenshots/communities-c15a/`.
- [ ] Regression runs: `community-forum`, `community-moderation`, `community-moderation-b`, `community-applications`, `community-editor`.
- [ ] Records:
  - `docs/acceptance/communities-c15a.md`;
  - `CLAUDE.md` (0041 used by C15a; 0042 is the next candidate);
  - the ADR 0013 status line;
  - the feature-flags doc (the purge schedule as an activation gate).
- [ ] Open a draft PR with base `c12b-community-moderation`.
