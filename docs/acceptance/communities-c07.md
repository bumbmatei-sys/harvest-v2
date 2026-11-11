# Communities PR 4a — C07 applications, shared question builder, rules list

Design: `docs/superpowers/specs/2026-11-11-communities-pr4a-applications-questions-design.md`. Plan: `docs/superpowers/plans/2026-11-11-communities-pr4a-applications-questions.md`. Migration `0037_community_applications`.

## Founder decisions (11 Nov)

- **Split:** PR 4 is split into 4a (this one: applications, questions, rules list) and 4b (member layout and feed).
- **Shared question builder:** up to 10 questions of four types (short answer, paragraph, single choice, checkboxes), each optionally required. Questions are stored as data and are reusable by later modules. shadcn-form.com was a visual reference only.
- **Owner's choice per community:** "Anyone can join" means answer and join. "People apply first" means answer and wait for approval; when both are on, approval wins. Invitations skip the queue.
- **Retention:** declined and withdrawn applications are deleted 90 days after the decision.
- **UI:** Eden design, Studio Admin style. The Joining step has a Rules card and a Join questions card, each with a switch. The preview has Page and Join tabs.

## Delivered

- **`src/lib/questions.ts`:** the shared question schema and `validateAnswers`, plus unit tests. Ids are created with Web Crypto, so the builder works in the browser.
- **Shared UI:**
  - `QuestionListEditor`: rows with a type badge and required mark, Move up/down, edit in place, an add menu of the four types, options, and a Required switch.
  - `QuestionFields`: the shared renderer used by the join dialog, the account page and the preview.
  - `Switch`, the standard shadcn component on the installed Radix package.
- **Migration 0037:**
  - **Data model:**
    - `rules_list text[]` replaces `rules`; existing rules are copied under a policy that exists only inside the migration, because the owner obeys FORCE RLS;
    - `join_questions jsonb` with `questions_version`, and `community_memberships.join_answers`;
    - a staff-only `community_applications` table: one open application per person, a private reviewer note, and no DELETE for the app role;
    - the `application` entitlement source.
  - **Definer functions:**
    - `community_answers_valid` is the SQL backstop for answer checks;
    - `community_enter` adds stale-questions and invalid-answer refusals, and creates an application (`applied`) when approval is on;
    - `community_my_applications` never returns the reviewer note;
    - `community_application_update` lets applicants withdraw or resubmit;
    - `community_purge_applications` handles the 90-day retention.
- **Owner services:**
  - `listApplications` returns names only, never contact details.
  - `decideApplication` covers approve (membership plus an `application` grant; banned people are refused; a staff role is never restored), decline, ask for more information, and the private note.
- **Applicant:** `updateMyApplication` (withdraw or resubmit) and an Applications section in `/account/communities`.
- **Routes:** list and decide for managers, and the applicant's own update. All return 404 when the flag is off.
- **UI:**
  - **Editor:** Rules and Join questions cards, a Join preview tab, and an Applications table with a review sheet (answers, private note, Approve, Ask for more information, Decline).
  - **Join dialog:** questions, then rules, then 18+, with an "Apply" label and an "Application sent" state.
  - **Public page:** the rules show as a list.

## Evidence (local, author-executed)

- **Static checks:** lint and source guards, typecheck, and 376 unit tests (including `questions` and flag-off 404s for the three new routes).
- **Integration (`community-applications-db`, `community-applications`, `community-joining-db`, `community-joining`, `communities`):**
  - answers are validated in SQL and in the service, including stale questions;
  - one open application per person;
  - info request, resubmit, approve, decline and withdraw;
  - applicants never see the reviewer note;
  - banned people are refused;
  - viewers and ministry B are refused;
  - staff cannot delete applications;
  - the 90-day purge;
  - invitations skip the queue.
- **Restricted owner:**
  - `community-joining-definer-owner` runs apply, list, resubmit, withdraw and purge with a non-BYPASSRLS owner.
  - `community-applications-upgrade` proves the rules copy works as a restricted owner, and that without the temporary policy it silently loses the rules.
  - The migration-owner upgrade suites pass as `tester`.
- **Browser (`community-applications`):**
  - the owner builds two rules and three questions in the editor and publishes;
  - a member joins with answers;
  - with approval on, three people apply;
  - the owner asks one for more information with a private note; the applicant sees the request, never the note, edits and resends, and the owner approves;
  - one is declined and one withdraws.
  - Axe and no horizontal scroll at 390/768/1440 in light and dark; screenshots in `docs/screenshots/communities-pr4a/`.
- **Regression:** `community-joining`, `community-editor`, `account-onboarding` and `layout` pass.

## Deviations from the design

- **Question editing on phones:** it expands in place (full width) instead of opening a side sheet. This is simpler and accessible, with one control pattern at every size.
- **Purge scheduling:** the purge is a database function run by `npm run communities:purge-applications` (application role only). Scheduling that daily belongs to the production job setup, which does not exist yet; it must be scheduled before activation.

## Review follow-up (non-author review of `26da77f`: MERGE-OK with five should-fix items)

- **Editing answers after the questions change:** the edit dialog now starts only from answers that still match the current questions and options, so an applicant is never stuck with answers they can't see.
- **Discover's "open" label:** a community where people must apply first is no longer labelled "Open to join" in Discover (unit test).
- **Purge caller:** the purge now has a command, `npm run communities:purge-applications`, which runs only as the application role. Scheduling it remains an activation step.
- **Former admins:** a test shows that a former admin who applies again comes back as a member when approved.
- **Invitations close open applications:** joining by invitation now closes that person's open application, so the queue never shows a request from an active member (database test).
- **Optional items not taken:**
  - **Malformed questions:** the SQL check could accept questions written directly in the database with a broken shape; the server validates every question before saving, so this needs direct database access.
  - **Pricing on approval:** approving doesn't re-check pricing, but paid pricing cannot be set yet.
  - **Re-application cooldown:** declined people can apply again straight away; no cooldown has been decided.
  - **Moderators deciding applications:** waits for community roles in the member layout (PR 4b).
  - **Move up/down focus:** not handled yet; noted for the accessibility pass.

## Deferred

- Notification emails about decisions (C15).
- Assignee, bulk decisions, decision templates, appeals.
- A full-page form editor reusing the shared components.
- Rate limits (as PR 3).
- The member layout and feed (PR 4b).

## Gates

No merge, deployment or activation is authorized by this PR. Production migrations 0031–0037 are not applied. Communities remain off in production.
