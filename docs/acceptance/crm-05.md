# CRM-05 acceptance record: tasks, notes, the unified timeline and notifications

Date: 2026-11-06. Scope: PRD v2.5 §5A.4 CRM-05: tasks with due dates, priority and an assignee; notes on people, companies and deals; a unified activity timeline; minimal assignment notifications; CRM outbox events.

Design: [ADR 0010](../decisions/0010-crm-tasks-notes-timeline.md). Reference study: [Twenty and v1 notes](../research/twenty-crm-reference.md#crm-05-tasks-notes-the-unified-timeline-and-ownership).

**Out of scope, unchanged:**
- CSV import, export, merge and global search (CRM-06); email and calendar sync (CRM-07);
- full notifications (PRD §24: preferences, email, push, reminders);
- Social Studio, scheduler, files, auth, and jobs-drain internals (only no-op receipt handlers for the new CRM outbox kinds were appended);
- the soft follow-ups in draft PR #14 (`feat/soft-fu-pass`), which this branch neither includes nor touches.

## What a user can do

- **Tasks page** (`/workspaces/:tenantId/crm/tasks`; "Tasks" in the CRM sidebar after Pipelines). It opens as "my open tasks".
  - Filters live in the URL: search, assignee (me, anyone, nobody, a member), status (open, done, all), due (overdue, today, upcoming, no date), linked to (person, company, deal, nothing).
  - Sort by due, priority, title, created or updated. Pages hold 20 tasks.
  - "No tasks yet" (nothing exists) is distinct from "Nothing assigned to you" and "No matching tasks" (filters hide everything; Reset filters).
- **Task row:**
  - a checkbox to complete or reopen, which Space toggles;
  - the due date and time in Europe/Berlin, plus a calm **Overdue** badge for open tasks past due;
  - the priority, the assignee ("Assigned to you" / a name / "Unassigned") and links to the person, company and deal;
  - an edit button.
- **Task dialog** (new and edit): title, due (date and time), priority, assignee (defaults to me), details, and linked person and company pickers.
  - From a record page that record is pre-linked.
  - From a deal page, the deal's person and company are pre-linked too, and any of them can be removed.
- **Tasks card** on person, company and deal pages: the open count, an Add button, and the tasks linked to that record.
- **Timeline** on person, company and deal pages: one list, grouped by Berlin day headings. It holds:
  - record events ("created this deal in New", "moved it from New to Contacted", "updated the email");
  - task events ("added task …", "completed …", "reassigned … to …");
  - notes, in full with their line breaks.

  The newest 50 items show first, with "Show older activity" for more.
- **Notes:** a plain textarea ("New note"; Ctrl/⌘+Enter or Add note). Authors can edit or delete their own notes; owners and admins can moderate any note.
- **Notifications:** a bell in the header with an unread count ("Notifications, 1 unread").
  - The popover lists "X assigned you *task*", plus a link to my overdue tasks when there are any, and "Mark all read".
  - Only assignment by someone else is stored; overdue is computed when the bell loads.
- **Viewers** see tasks, notes and timelines read-only: no Add buttons, disabled checkboxes and no note composer. The API refuses their writes with 403.

## Security and data rules verified

- FORCE RLS on `crm_tasks`, `crm_notes` and `crm_notifications`. Without tenant context the runtime role sees nothing.
- **Notifications are recipient-scoped in RLS.** A member cannot read or mark a colleague's notifications, even in the same workspace (SQL-tested).
- Composite tenant FKs on every relation. Raw inserts that point at another tenant's person, company, deal or task fail.
- **SQL guards, tested directly:**
  - the assignee must be a member;
  - a note needs exactly one target, and the target is immutable;
  - a notification's actor is the verified user;
  - there are no DELETE grants.
- **Two tenants, both directions:**
  - **Services and SQL** (`tests/integration/crm-tasks.test.ts`): task get and patch, note create, timeline, raw select, update and insert.
  - **HTTP** (`tests/e2e/crm05.spec.ts`): A's user against B's task and workspace and B's against A's (403 for a foreign workspace, 404 for foreign ids, including the person timeline and note creation).
- **Permissions:** viewers get 403 for task create, update and complete and for note create (services and API). A non-author member gets 403 editing someone else's note; an admin may.
- **Concurrency:** completing or editing a task with a stale version is a 409 that changes nothing. The UI reverts the checkbox and offers Reload.
- **Audit:** every task and note write audits in the same transaction. Metadata holds ids and field names only, never note text or task details (asserted).
- **Outbox:** `crm.task.created`, `crm.task.updated`, `crm.task.completed`, `crm.task.reassigned`, `crm.note.created`, `crm.note.updated` and `crm.note.archived` are written in the same transaction with stable keys.
  - Payloads carry `body: { redacted: true, length }`, never the text (asserted).
  - Replaying the same key is a no-op. A different payload under an existing key returns 409 `jobIdempotencyConflict` (integration-tested).
- **Erasure:**
  - tasks keep living with `contact_id = NULL` and a bumped version;
  - notes on the person are deleted;
  - `contactId` is stripped from `task.*` and `note.*` audit metadata.

  Afterwards no note body is readable, and nothing in the ledger points at the erased person. This holds on fresh and upgraded databases.
- **Timeline paging:** 54 notes plus the creation event page as 50 + 5, with no duplicates and no gaps. Cursors are microsecond-precise. A malformed cursor is a 400.

## Commands and results (this branch, 2026-11-06)

Database-backed tests used `TEST_DATABASE_URL` against a local PostgreSQL 16, as in CRM-01 to CRM-04. Browser runs used an uncommitted local Playwright config (Chromium at `/opt/pw-browsers/chromium`) against `scripts/e2e-server.ts`.

| Command | Result |
| --- | --- |
| `npm run lint` | exit 0; ESLint clean; "Source guards: no hard-coded JSX copy, feedback, or component colors." |
| `npm run typecheck` | exit 0 |
| `npm test` (unit) | 13 files, **145 passed** (new: `crm-tasks.test.ts`, 7: DST, overdue and buckets, validation, query, cursor, permissions) |
| `TEST_DATABASE_URL=… npm run test:rls` (integration) | 21 files, **210 passed** (new: `crm-tasks.test.ts`, 17, covering RLS, outbox and fingerprint 409, guards, filters, notifications, notes, timeline merge and paging, two-tenant isolation and erasure; `crm05-upgrade.test.ts`; `erasure.test.ts` extended) |
| `npx drizzle-kit check` / `generate` | "Everything's fine" / "No schema changes, nothing to migrate" |
| `npm run build` | exit 0; `public/offline.css` regenerated and committed |
| `npx playwright test` (all 10 specs, 12 tests) | Final full run after rebasing onto `55076b2`: **12/12 passed** (7.9 min). Earlier full runs on this branch hit three intermittent test-timing failures, fixed or noted below. |

Browser-test timing fixes (test-only; pages unchanged):
- `crm05.spec.ts` waits for hydration before typing a note. Before that, keystrokes made before React hydrated were lost.
- `layout.spec.ts` (not a CRM-05 file) waits for CSS colour transitions to finish after the light/dark switch before the accessibility scan. Its axe check had caught a primary button mid-fade on `/profile` and `/workspaces` (contrast 1.96 between interpolated colours); the fix passed 6 of 6 repeated runs.
- `pr01b.spec.ts` failed in 2 of 4 full runs when Next's dev "issues" badge covered the sidebar's bottom-left toggle. It passed alone twice and in the last two full runs. Browser console capture during a full run showed no new errors from CRM-05 code. The badge comes from the dev-only hydration warning that Playwright's screenshot caret hiding causes. The spec is unchanged; this is a known dev-server flake, recorded here rather than masked.

Two genuine accessibility fixes came out of the CRM-05 run:
- the timeline's day headings went from `h3` to `h2`, fixing the heading order;
- the notifications popover got an accessible name.

`npm run test:rls:neon` was **not** run (no Neon credentials; not authorized).

## Browser proof (`tests/e2e/crm05.spec.ts`)

1. From a deal, add a follow-up task (assigned to me by default) with a due date tomorrow at 10:00 Berlin and high priority. It appears on the deal's Tasks card.
2. The sidebar's Tasks link opens my tasks, where the task is listed. Focus its checkbox and press **Space**: the PATCH returns 200, the list becomes "Nothing assigned to you", and under "Done" the task is checked.
3. Add a deal note **from the keyboard** (Ctrl+Enter). The deal timeline shows the note, "completed Synthetic follow-up call", "added task Synthetic follow-up call" and "created this deal in New".
4. Add a multi-line note on the person and **reload**. The note is in the person timeline with the task history, and the task is on the person's Tasks card.
5. A second account: HTTP isolation in both directions. Once added as a member, they assign the owner a task. The owner's bell reads "Notifications, 1 unread", the popover shows "assigned you" and the task, and Mark all read clears it.
6. The second account as a viewer: a view-only notice, no Add task, a disabled checkbox, no New note, and 403 on writes.
7. At 390 px and at 1024×900 with the sidebar expanded, the tasks list and the person and deal timelines fit the full-width shell without sideways scroll.
8. **axe** finds no violations at every capture, and the page logged no errors.

Screenshots (`docs/screenshots/crm05/`, light and dark where both are listed):

- `tasks-list-{light,dark}`: my tasks.
- `deal-task-on-record-{light,dark}`: the task on the deal.
- `deal-timeline-{light,dark}`: note, task and audit together.
- `person-timeline-{light,dark}`: person note after reload, plus task history.
- `notifications-light`: the bell popover.
- `task-dialog-light` and `tasks-viewer-light`.
- `tasks-390-light` and `tasks-1024-light`.

## Migration notes

- `0018_crm_tasks_notes` (generated): the three tables, checks and indexes.
- `0019_crm_tasks_notes_policies` (hand-written):
  - RLS and grants, and erasure-owner policies;
  - the `guard_crm_task`, `guard_crm_note` and `guard_crm_notification` triggers;
  - `CREATE OR REPLACE guard_audit_contact_unlinking`: the 0008 rule unchanged, plus the narrow `contactId` strip for `task.*`/`note.*` during erasure;
  - `CREATE OR REPLACE erase_contact`: 0016's version plus task unlinking, note deletion and the audit metadata strip.
- Additive, and idempotent under the harness's double-apply. `tests/integration/crm05-upgrade.test.ts` seeds a database at 0017 (post-CRM-04) with a person, a company, a pipeline and a deal with its audit row. It then upgrades, moves the deal, adds a task and a note, checks the merged timeline order (note, task.create, opportunity.move, opportunity.create), and erases the person.
- No backfill is needed.
- Rollback before deploy:
  - drop the three tables and the three guard functions;
  - restore `guard_audit_contact_unlinking` from 0008 and `erase_contact` from 0016.

  No production data exists, and no production Neon, R2 or Vercel settings were touched.

## Deviations and limitations (documented)

- "Assigned to me, open" is the default view. There are no saved views for tasks.
- Status is open or done only. There is no rich text: notes and details are plain text.
- A deal is linked to a task only from the deal page. The dialog has person and company pickers only.
- Notifications store assignment only. Overdue is derived on read; there is no email, reminders or preferences (§24 later).
- The CRM-03 `…/activity` endpoints remain for compatibility; the record pages now use `…/timeline`.
- Times show in Europe/Berlin because there is no per-workspace time zone yet.
