# Communities PR 4a — C07 applications, shared question builder, rules list (design)

Status: design approved by the founder on 11 Nov 2026. Plan: `docs/superpowers/plans/2026-11-11-communities-pr4a-applications-questions.md`.

Inputs:
- `docs/prd/harvest-communities.md` §3.2, §8.2, §8.8;
- ADR 0013;
- PR 3 (`docs/acceptance/communities-c05-c06-c08.md`, migration 0036);
- Eden references in `Harvest-agent` `docs/prd/screenshots/05-communities/` (setup → Joining: "Rules", "Join questions") and `09-forms-signups/` (form editor).

## Founder decisions (11 Nov)

1. **Split:** PR 4 is split. PR 4a covers applications, questions and the rules list. PR 4b covers the member layout (C09) and the feed (C10).
2. **Shared question builder:** up to 10 questions, each a short answer, paragraph, single choice or checkboxes, and each can be required. It is built as a shared Harvest component so events, courses and campaigns can reuse it. Answers are stored as data. It is not a code generator; shadcn-form.com serves only as a visual reference.
3. **What happens after the answers:**
   - The owner chooses per community, using the two existing admission switches.
   - **"Anyone can join":** answers, then rules, then 18+, then member.
   - **"Apply and wait for approval":** the same steps create an application.
   - If both are on, a request goes to the approval queue. Invitations still skip the queue.
4. **Retention:** declined and withdrawn applications are deleted 90 days after the decision.
5. **UI:** Eden design, Studio Admin style.
   - The Joining step gets a **Rules** card (a list of individual rules with "Add rule") and a **Join questions** card. Each card has its own switch.
   - Question rows have a drag handle, text, a type badge, a required mark, edit and delete. Edit expands the row in place (a side sheet on phones).
   - "+ Add question" offers a menu of the four types.
   - The live preview gains a **Join** tab rendered by the same component members see.
   - There are no JSON or Code tabs.

## Data (migration 0037)

- **`communities` gains:**
  - `rules_list text[]`, replacing the free-text `rules`. 0037 copies existing `rules` into a one-item list and drops `rules`; nothing is in production.
  - `join_questions jsonb`, a validated question set (default `[]`);
  - `questions_version int` (bumped on change).
  - The rules version is bumped whenever the rules list changes.
- **`community_memberships` gains** `join_answers jsonb` (open-join answers; staff-readable).
- **`community_applications`:**
  - Fields: `id`, `tenant_id`, `community_id`, `user_id`, `status`, `answers jsonb`, `questions_version`, `rules_version`, `adult_confirmed_at`, `info_request text` (shown to the applicant), `reviewer_note text` (staff only), `decided_by`, `decided_at`, `created_at`, `updated_at`.
  - `status` is one of `pending`, `info_requested`, `approved`, `declined`, `withdrawn`.
  - One open (`pending` or `info_requested`) application per person per community.
  - Purge: rows `declined` or `withdrawn` for more than 90 days are deleted by the existing jobs drain (idempotent).
- **Entitlement source** gains `application`.
- **RLS:** FORCE RLS with staff tenant policies. Applicants never touch tables directly.
- **Definers** (same owner-policy and settings-reset pattern as 0036):
  - `community_enter` is extended: it validates answers against the current questions (server-side, using the shared schema mirrored in SQL as type, required and option checks), saves `join_answers`, and returns `applied` when approval is required.
  - `community_my_applications()`: the caller's own applications (status, info request, community name/slug) without reviewer notes.
  - `community_application_update(id, action, answers)`: the applicant withdraws, or resubmits after an info request.

## Server

- **`src/lib/questions.ts` (shared, pure):**
  - a zod schema for the question set (ids, types, labels 1–200, options 2–20 for choice types, max 10 questions);
  - `validateAnswers(questions, answers)`;
  - `answerSummary`.
  - Unit-tested. SQL re-checks required/type/options for the same rules.
- **Owner (`communities:manage`):**
  - `updateCommunity` accepts `rulesList` and `joinQuestions`.
  - `listApplications`, `decideApplication(id, { action: approve|decline|request_info, message?, note? })`.
  - Approve activates membership as member, inserts an `application` entitlement and audits. A banned person's application cannot be approved.
- **Member:** `myCommunities` gains `applications` (Pending section).

## UI

- **Shared:**
  - `src/components/forms/question-list-editor.tsx` (owner builder, reusable);
  - `src/components/forms/question-fields.tsx` (renderer used by the join dialog, account page and preview).
- **Editor:**
  - **Joining:** Rules card and Join questions card.
  - **People step:** an **Applications** table (name, applied, status), a detail sheet with answers, and Approve / Decline / Ask for more info (message) / private note.
  - **Preview:** a **Join** tab.
- **Join dialog:** questions first, then rules, then 18+. The button reads "Apply" when approval is required.
- **`/account/communities`:** a **Pending** section listing status and the info request, with Withdraw and Edit answers.
- **Copy:** concise, `messages/en.json`, no helper paragraphs except the rules, 18+ and approval statements.

## Not in PR 4a

- Notification emails (C15).
- Assignee, bulk decisions, decision templates, appeals.
- A full-page form editor.
- The member layout and feed (PR 4b).

## Testing

**Integration (two ministries):**
- answers validated server-side (missing required, wrong option, too long);
- apply vs join by switch;
- one open application;
- approve, decline, info-request and resubmit, withdraw;
- banned people refused;
- applicants cannot see reviewer notes;
- ministry B is blocked from A's applications;
- the 90-day purge;
- a rules or questions change while the dialog is open asks the person again;
- restricted owner for the changed definers.

**Unit:** the question schema and `validateAnswers`.

**Browser:**
- the owner builds questions and rules;
- one person joins with answers (open);
- another applies (approval), and the owner approves, declines and asks for info;
- the person resubmits;
- the Pending section;
- axe, no horizontal scroll, light and dark at three sizes.
