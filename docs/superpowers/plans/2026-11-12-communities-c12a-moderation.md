# Communities C12a (reports, moderation page, mute/ban, held content): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** members can report posts, replies and members. Hosts work a Studio Admin moderation page: reports, held items, member mute/ban/unban and history. Owners can turn on first-post approval and a banned-words list.

**Spec:** `docs/superpowers/specs/2026-11-12-communities-c12a-moderation-design.md`

## Global Constraints

- **Branch and migration:** branch `c12a-community-moderation`; migration `0039_community_moderation`.
- **Flag:** everything sits behind `communitiesEnabled()`.
- **Copy and layout:** copy in `messages/en.json`, concise and provider-neutral; 44px targets; full width; light and dark; Studio Admin style.
- **Privacy:**
  - reporters are never exposed to the reported person;
  - members never read reports or moderation actions;
  - non-readers get 404.
- **Database pattern:** every write is an audited SECURITY DEFINER function with owner policies keyed on settings (0036–0038 pattern), plus restricted-owner tests run as `tester`.

## Tasks

### Task 1: Pure rules

**Files:** `src/lib/moderation.ts`, `tests/unit/moderation.test.ts`.

- [ ] Write the tests:
  - `canActOn`: owner over admin; admin over moderator and member; moderator over member; never on the owner, an equal rank or oneself;
  - `normaliseBannedWords`: trim, lower-case, de-duplicate, at most 100, 1–40 characters each;
  - `matchesBannedWord`: whole word only, case-insensitive, punctuation boundaries.
- [ ] Implement, then commit.

### Task 2: Migration 0039 and database tests

**Files:** `src/db/schema.ts`, `drizzle/0039_community_moderation.sql` (+ snapshot), `tests/integration/community-moderation-db.test.ts`, `tests/integration/community-joining-definer-owner.test.ts` (extended).

- [ ] Schema:
  - new columns: `hold_first_posts`, `banned_words`, `muted_until`, `held_at` and `held_reason`;
  - new tables: `community_reports` and `community_moderation_actions`;
  - generate.
- [ ] Hand-written SQL:
  - the `community_is_host` predicate;
  - RLS: staff policies, a host SELECT policy and owner policies;
  - definers: `community_report`, `community_report_decide`, `community_member_moderate` and `community_held_decide`;
  - changes to `community_post_save`, `community_comment_save` and `community_like_toggle` (muted, held, banned words);
  - grants.
- [ ] Database tests, following the spec's testing list. Then run the restricted-owner suite as `tester` and commit.

### Task 3: Services and routes

**Files:**
- `src/server/community-moderation.ts`;
- changes to `src/server/community-forum.ts` (held visibility, counts, muted state in the context) and `src/server/communities.ts` (`holdFirstPosts`, `bannedWords`);
- the routes;
- `tests/integration/community-moderation.test.ts` and the flag unit test.

- [ ] Service tests:
  - the queue groups by target with no reporter ids;
  - decisions;
  - member moderation with rank rules;
  - held visibility in list and post reads;
  - owner settings.
- [ ] Implement, then run typecheck and lint, then commit.

### Task 4: UI

**Files:**
- `src/components/communities/report-dialog.tsx`;
- `src/components/communities/moderation/*` (reports table and sheet, held table, members table and actions, history table);
- the page `src/app/communities/[slug]/(member)/moderation/page.tsx`;
- the shell rail item with a badge;
- the post, reply and member Report menus;
- the "Awaiting review" badge;
- the muted notice;
- the editor People-step Moderation card;
- `messages/en.json`.

- [ ] Build, then run lint, source guards, typecheck and unit tests, then commit.

### Task 5: Browser test, evidence, records, PR, CI, review

- [ ] `tests/e2e/community-moderation.spec.ts`, with screenshots in `docs/screenshots/communities-c12a/`.
- [ ] Regression runs: `community-forum`, `community-joining`, `community-applications`, `community-editor` and `layout`. Then the full integration suite, plus the `tester` suites.
- [ ] Records:
  - `docs/acceptance/communities-c12a.md`;
  - the ADR 0013 status;
  - `CLAUDE.md`: 0038 merged with #62, 0039 used by C12a, 0040 is the next candidate;
  - the feature-flags doc.
- [ ] Open the draft PR, then run CircleCI final review, Neon from `main` and the independent review. Do not merge without the founder's approval.
