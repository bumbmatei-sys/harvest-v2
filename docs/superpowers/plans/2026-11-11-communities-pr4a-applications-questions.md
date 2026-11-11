# Communities PR 4a (C07 + shared questions + rules list) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Owners add optional join questions (a shared builder) and a list of rules. People either join directly or apply for approval, as the owner chooses. Owners approve, decline or ask for more info; applicants resubmit or withdraw. Declined and withdrawn applications are deleted after 90 days.

**Architecture:**
- **Migration 0037:**
  - replaces `rules` with `rules_list text[]`;
  - adds `join_questions jsonb` plus `questions_version`, and `community_memberships.join_answers`;
  - adds a staff-only `community_applications` table;
  - adds the `application` entitlement source.
- **Definers:** `community_enter` is replaced. A new SQL helper `community_answers_valid(questions, answers)` mirrors the shared zod schema. New definers are `community_my_applications`, `community_application_update` and `community_purge_applications`, following the owner-policy and settings-reset pattern of 0036.
- **Owner decisions:** they run as staff services in `withTenant`.
- **Shared UI:** `QuestionListEditor` (owner) and `QuestionFields` (renderer), in `src/components/forms/`.

**Spec:** `docs/superpowers/specs/2026-11-11-communities-pr4a-applications-questions-design.md`

## Global Constraints

- **Branch and migration:** branch `c07-applications-questions`. Migration `0037_community_applications` follows 0036; never renumber.
- **Flag:** all routes and pages sit behind `communitiesEnabled()`.
- **Copy:** concise, in `messages/en.json`; say "ministry" for the user-facing term; full width; 44px targets; light and dark; Eden design with Studio Admin style.
- **Limits:**
  - questions: at most 10;
  - labels: 1–200 characters;
  - options: 2–20 for choice types, 1–100 characters each;
  - short answer ≤ 200 characters; paragraph ≤ 2000;
  - rules: at most 20, each 1–300 characters.
- **Refusals stay neutral:**
  - with an invite: a missing community and a bad invite give the same answer;
  - banned and not-allowed give the same answer;
  - an applicant never sees `reviewer_note`.
- **Tests:** run integration suites with Postgres started; run restricted-owner suites as `tester`; run the browser suite with `--trace off`.

## Tasks

### Task 1: Shared questions library
**Files:** `src/lib/questions.ts`, `tests/unit/questions.test.ts`

**Produces:**
- `type Question = { id: string; type: "short" | "paragraph" | "choice" | "checkboxes"; label: string; required: boolean; options?: string[] }`
- `questionSet` (zod, max 10, unique ids `^[a-z0-9]{8}$`, options only and required for choice types)
- `type Answers = Record<string, string | string[]>`
- `validateAnswers(questions, answers): { ok: true; answers: Answers } | { ok: false; questionId: string }`. It trims, drops unknown ids, enforces required, the type shape, membership in the options, lengths, and at most one value for choice.
- `newQuestionId()`.

**Steps:**
- [ ] Unit tests for every rule (valid set; 11 questions rejected; choice without options rejected; required missing; wrong option; checkboxes with an unknown option; too long; unknown ids dropped).
- [ ] Implement.
- [ ] Run, then commit.

### Task 2: Migration 0037
**Files:** `src/db/schema.ts`, `drizzle/0037_community_applications.sql`, `tests/integration/community-applications-db.test.ts`, `tests/integration/community-joining-db.test.ts` (adapt to `rules_list`), `tests/integration/community-joining-definer-owner.test.ts` (add the new definers and table)

**Schema:**
- **`communities`:** add `rulesList text[] not null default '{}'` (check: array length ≤ 20), `joinQuestions jsonb not null default '[]'` (check: `jsonb_typeof = 'array' and jsonb_array_length <= 10`) and `questionsVersion int not null default 0`. Drop `rules`.
- **Data step:** `UPDATE communities SET rules_list = ARRAY[rules] WHERE rules IS NOT NULL` runs before the drop.
- **`communityMemberships`:** add `joinAnswers jsonb`.
- **`communityApplications`:**
  - Columns: `id uuid pk`, `tenant_id`, `community_id` (FK, cascade), `user_id` (FK users cascade), `status`, `answers jsonb not null`, `questions_version int`, `rules_version int`, `adult_confirmed_at timestamptz not null`, `info_request text` (≤ 500), `reviewer_note text` (≤ 1000), `decided_by` (FK users set null), `decided_at`, `created_at`, `updated_at`.
  - `status` check: `pending`, `info_requested`, `approved`, `declined`, `withdrawn`.
  - A partial unique index on `(community_id, user_id)` where `status in ('pending','info_requested')`.
- **Entitlement source check:** add `application`.
- **RLS:** FORCE RLS with a staff tenant policy on `community_applications`. Grant SELECT, INSERT, UPDATE and DELETE (DELETE is only used by the purge definer; staff never delete). Owner-only policies keyed on `app.community_definer_tenant` (ALL) and `app.community_resolve_user` (SELECT, `user_id`).
- **Validation helper:** `public.community_answers_valid(questions jsonb, answers jsonb) returns boolean`, IMMUTABLE with a fixed `search_path`. It re-checks required, types, options and lengths. The server always validates with the zod schema first; SQL is the backstop.
- **`community_enter(p_slug, p_rules_version, p_questions_version, p_answers jsonb, p_adult, p_invite_hash, p_invite_id)`:** drop the old signature and recreate. It keeps every 0036 rule, plus:
  - a stale questions version returns `questions_changed`;
  - invalid answers return `answers_invalid`;
  - without an invite, when `allow_apply` is on and not `allow_open`, or both are on, it inserts an application (`pending`), or returns `already_applied` if one is open, and returns `applied`;
  - when only open is on, it joins and stores `join_answers`;
  - invites skip the queue, and their answers are stored as `join_answers`.
- **`community_my_applications()`:** returns `{id, slug, name, status, infoRequest, updatedAt}` for the caller; never `reviewer_note`.
- **`community_application_update(p_id, p_action, p_answers, p_questions_version)`:** works on the caller's own application only.
  - `withdraw` is allowed from `pending` or `info_requested`.
  - `resubmit` is allowed from `info_requested`: it validates the answers, sets `pending` and clears `info_request`.
  - It returns an outcome and audits.
- **`community_purge_applications()`:** deletes `declined` and `withdrawn` rows whose `decided_at` (or `updated_at` for withdrawn) is older than 90 days and returns the count. EXECUTE goes to `harvest_app`; the job script calls it.
- **Grants:** revoke from PUBLIC and grant to `harvest_app`, as in 0036.

**Steps:**
- [ ] Schema plus `npx drizzle-kit generate --name community_applications`. Check the generated SQL, then add the data step before the column drop.
- [ ] Hand-written RLS, helper and definers.
- [ ] Database tests:
  - open join with valid and invalid answers;
  - apply when approval is on;
  - one open application;
  - stale questions or rules;
  - an invite bypasses the queue;
  - my_applications hides the note;
  - withdraw and resubmit rules;
  - purge after 90 days (backdate with admin);
  - members, visitors and ministry B see nothing.
- [ ] Restricted-owner test updated for the new definers and table.
- [ ] Run the migration-upgrade suites as `tester`, then commit.

### Task 3: Services
**Files:** `src/server/communities.ts`, `src/server/community-joining.ts`, `src/server/community-applications.ts` (new), `messages/en.json` (Errors), `tests/integration/community-applications.test.ts`

**Produces:**
- `updateCommunity` accepts `rulesList: string[]` and `joinQuestions: Question[]` (validated by the shared schema). A change bumps `rulesVersion` or `questionsVersion`, using a deep compare.
- `enterCommunity(..., { rulesVersion, questionsVersion, answers, adult, invite?, inviteId? })` returns `{ outcome: "joined" | "already_member" | "applied" }`. New refusals:
  - `questions_changed` → 409 `communityQuestionsChanged`;
  - `answers_invalid` → 400 `communityAnswersInvalid`;
  - `already_applied` → 409 `communityAlreadyApplied`.
- `listApplications(db, user, workspace, communityId, { status? })` returns `{ id, name, status, answers, questionsVersion, createdAt, updatedAt, infoRequest, reviewerNote }[]` for `communities:manage`.
- `decideApplication(db, user, workspace, communityId, applicationId, { action: "approve" | "decline" | "request_info", message?, note? })`:
  - `approve`: allowed only from `pending` or `info_requested`; refused if the person is banned (409). It activates the membership as member with `join_answers` taken from the application, inserts an `application` entitlement and audits.
  - `decline`: sets `decided_*`.
  - `request_info`: needs a message (1–500 characters).
  - `note` (≤ 1000 characters) can be set with any action, or on its own via `{ action: "note" }`.
- `updateMyApplication(db, user, id, { action: "withdraw" } | { action: "resubmit", answers, questionsVersion })`.
- `myCommunities` gains `applications` (via the definer).
- `getPublicCommunity` returns `rulesList`, `joinQuestions` and `questionsVersion` instead of `rules`; `community_public` is updated in 0037 to match.

**Steps:**
- [ ] Integration tests covering everything above, plus permissions: a viewer gets 403, and ministry B gets 403 or 404.
- [ ] Implement.
- [ ] Run typecheck, lint and tests, then commit.

### Task 4: API routes
**Files:**
- `src/app/api/workspaces/[tenantId]/communities/[communityId]/applications/route.ts` (GET)
- `.../applications/[applicationId]/route.ts` (PATCH decide)
- `src/app/api/account/community-applications/[applicationId]/route.ts` (PATCH withdraw/resubmit)
- `tests/unit/communities-flag.test.ts` (add the three routes)

**Steps:**
- [ ] Extend the flag-off 404 test.
- [ ] Add the routes, using the PR 3 pattern (verifyOrigin on writes, `no-store` on GETs).
- [ ] Commit.

### Task 5: Shared question UI and editor
**Files:**
- `src/components/forms/question-list-editor.tsx`
- `src/components/forms/question-fields.tsx`
- `src/components/communities/rules-list-editor.tsx`
- `src/components/communities/community-editor.tsx` (Joining cards, Join preview tab, Applications in People)
- `src/components/communities/community-applications.tsx` (table plus detail sheet with decisions)
- `src/components/communities/join-dialog.tsx` (questions, then rules, then 18+; "Apply" label; `applied` → success state)
- `src/app/communities/[slug]/page.tsx` (rules list)
- `src/app/account/communities/page.tsx` (Pending section: status, info request, Withdraw, Edit answers dialog)
- `src/app/workspaces/[tenantId]/communities/[communityId]/edit/page.tsx` (load applications for managers)
- `messages/en.json`

**Design (approved):**
- **Cards:** the Rules card has an "Ask new members to agree" switch, a list of rule inputs, "Add rule" and remove. The Join questions card has an "Ask new members a few questions" switch.
- **Question rows:** a drag handle (keyboard-accessible Move up/Move down buttons; no drag library), the label, a type badge, a required mark, edit (expands inline; a Sheet below `md`) and delete.
- **Adding:** "+ Add question" opens a DropdownMenu with the four types.
- **The inline editor:** label, type select, an options list (add, remove, reorder) for choice types, and a Required switch.
- **Preview:** tabs "Page" and "Join"; the Join tab renders `QuestionFields` read-only.
- **Applications:** a Table of name, applied date and status badge, with View. The Sheet shows the answers (the label from the matching `questions_version`, or the stored label if the questions changed) and Approve / Decline / Ask for more info (Textarea) / Private note.
- **Turning a switch off clears the list:** turning the questions switch off saves an empty set, and turning the rules switch off saves an empty list.

**Steps:**
- [ ] Build the components with existing shadcn primitives (Card, Switch — add `src/components/ui/switch.tsx` via the shadcn CLI if missing — DropdownMenu, Sheet, Select, Table, Badge, Textarea).
- [ ] Wire the editor.
- [ ] Wire the join dialog and account page.
- [ ] Run lint, the source guards and typecheck, then commit.

### Task 6: Browser test, evidence, records, PR, CI, review
**Files:** `tests/e2e/community-applications.spec.ts`, `docs/screenshots/communities-pr4a/`, `docs/acceptance/communities-c07.md`, ADR 0013 status line, `docs/setup/feature-flags.md` (new routes), `tests/e2e/community-joining.spec.ts` (adapt to the rules list)

**Steps:**
- [ ] Browser spec:
  1. The owner builds 3 questions (short, required choice, checkboxes) and 2 rules in the editor, then publishes with open join. A member joins after answering them, and the answers show in People.
  2. The owner switches to approval. A second person applies and sees Pending in My communities. The owner asks for more info, the person edits and resubmits, and the owner approves; the person lands on home.
  3. A third person applies and the owner declines.
  4. A fourth applies and withdraws.
  5. Axe and screenshots at 390/768/1440 in light and dark, for: editor joining, editor applications, the join dialog with questions, and my communities pending.
- [ ] Run the regression set (community-joining, community-editor, account-onboarding, layout). Restore unrelated screenshots.
- [ ] Records.
- [ ] Draft PR, CircleCI final review, Neon from main, reviewer request, check-in.
