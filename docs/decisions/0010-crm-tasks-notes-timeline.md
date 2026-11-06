# ADR 0010: CRM tasks, notes, the unified timeline and assignment notifications

Accepted 2026-11-06 for CRM-05 and amended the same day for review round 1 on PR #15 (B1, F2, F3; see "Review round 1" below) (PRD v2.5 §5A.4 "Tasks, notes and a unified activity timeline on people, companies and deals"). Builds on [ADR 0007](0007-crm-companies-and-links.md), [ADR 0008](0008-crm-fields-and-views.md) and [ADR 0009](0009-crm-pipelines-and-deals.md). Twenty was studied for behaviour only ([notes](../research/twenty-crm-reference.md#crm-05-tasks-notes-the-unified-timeline-and-ownership)).

## Decision

1. **Three tenant tables**, keyed `(tenant_id, id)`, with FORCE RLS and tenant-composite foreign keys. Migrations `0018_crm_tasks_notes` (generated) and `0019_crm_tasks_notes_policies` (custom).

   | Table | Columns | Checks |
   | --- | --- | --- |
   | `crm_tasks` | title, body, status, priority, `due_at timestamptz`, `assignee_user_id`, `contact_id`, `company_id`, `opportunity_id`, `completed_at`, `archived_at`, `created_by`, version | title 1–200 characters and trimmed; body ≤ 5,000; status `open`/`done`; priority `none`/`low`/`medium`/`high`; `(status = 'done') = (completed_at IS NOT NULL)`; version ≥ 1 |
   | `crm_notes` | body, `contact_id`, `company_id`, `opportunity_id`, `edited_at`, `archived_at`, `created_by`, version | **exactly one** target: `num_nonnulls(contact_id, company_id, opportunity_id) = 1`; body 1–10,000 |
   | `crm_notifications` | `recipient_user_id`, `actor_user_id`, kind (`task_assigned` only), `task_id` (composite FK to the task), `read_at`, `created_at` | — |

   - All relations are optional on a task. A task with none is a personal to-do.
   - **Guards** (triggers):
     - Tasks: provenance (`created_by` is the verified user); immutable identity; **the assignee must be a member of this workspace**; the linked person must not be erased; **a newly linked deal must not be archived** (0020). The service checks the same rules first, so users get a readable 400 or 409. The trigger is the backstop.
     - Notes: provenance; a live person on insert; **no new note on an archived deal** (0020); **immutable target**, so a note never moves between records.
     - Notifications: the actor is the verified user; the recipient is a member; only `read_at` can change.
   - **Grants:** column-scoped UPDATE. There are **no DELETE grants**; tasks and notes are archived.
   - **Notification RLS** is tenant **and** recipient (`recipient_user_id = app.user_id`) for SELECT and UPDATE. INSERT is tenant-only, so an actor can notify a colleague but never read or mark another person's notifications.

2. **Permissions.** Same pattern as contacts and companies:

   | Permission | Who has it | What it allows |
   | --- | --- | --- |
   | `tasks:read` | all roles | see tasks, the Tasks page and the Tasks cards |
   | `tasks:write` | owner, admin, member | create, edit, complete, reopen, reassign and archive tasks |
   | `notes:read` | all roles | see notes in timelines |
   | `notes:write` | owner, admin, member | add notes |

   - **Editing and deleting a note** is limited to its author. Owners and admins may moderate any note (403 `onlyTheAuthorCanChangeThisNote` otherwise).
   - **Tasks** are team objects: any writer may edit any task in the workspace, as in Twenty.

3. **Time.** `due_at` is an instant (`timestamptz`). The UI enters and shows it as **Europe/Berlin** wall-clock time (`CRM_TIME_ZONE`).
   - The API accepts a Berlin local `YYYY-MM-DDTHH:mm`, or an ISO instant with `Z` or an offset.
   - A local time that does not exist (the spring DST gap) is refused, not shifted.
   - The "today", "overdue" and "upcoming" filters use Berlin day bounds.
   - **Overdue** is computed on read: an open task whose due instant has passed. It is shown as a calm badge. Nothing is auto-completed or escalated.

4. **The audit ledger is the source of truth for history.** Every task and note write audits in the same transaction:
   - Task actions: `task.create`, `task.update` (with changed field names), `task.complete`, `task.reopen`, `task.reassign` (`fromUserId`/`toUserId`), `task.archive` and `task.restore`.
   - Note actions: `note.create`, `note.update`, `note.archive` and `note.restore`.
   - Audit metadata carries **ids only**: the task's or note's relation ids and the field names. Never note text or a task description.

5. **Unified timeline.** `GET …/contacts/:id/timeline`, `…/companies/:id/timeline` and `…/crm/deals/:id/timeline` call `getTimeline(subject, id, before?)`. It merges:
   - the record's own audit rows (`contact.*`/`consent.*`, `company.*` or `opportunity.*` for the record);
   - `task.*` audit rows whose metadata links the record;
   - `note.archive` and `note.restore` audit rows whose metadata links the record. `note.create` and `note.update` are not listed separately, because the live note itself shows them (its time, author and "(edited)");
   - **live notes** on the record. Note bodies come from `crm_notes`, never from the ledger. **An archived note disappears from the timeline, and its `note.archive` event ("deleted a note") takes its place**, without the text. A restore brings the note back, plus a `note.restore` event.

   **Ordering and paging:**
   - Both sources are read with `(created_at, id) < cursor`, limited to 51 each, merged newest first and cut at **50**.
   - The cursor is `<UTC ISO with microseconds>_<uuid>`. It is produced by Postgres `to_char(… 'US')`, because JavaScript milliseconds would skip or repeat rows that share a millisecond.
   - An invalid cursor is a 400.
   - Permission depends on the subject (`contacts:read`, `companies:read` or `opportunities:read`), and an unknown record is a 404. Another tenant's record is denied both ways: 403 for a workspace you are not in, 404 for an id from another workspace.
   - `TimelineItem` is a discriminated union (`event` | `note`). CRM-07 (email and calendar) adds members to it and to `timelineActions` without changing the cursor contract.
   - The CRM-03 activity endpoints (`…/activity`) are kept for compatibility; the pages now use the timeline.

6. **Outbox.** `appendOutboxEvent` runs in the same transaction as the write:

   | Kind | Idempotency key |
   | --- | --- |
   | `crm.task.created` | `crm:task:{id}:created` |
   | `crm.task.updated` | `crm:task:{id}:v{version}:updated` |
   | `crm.task.completed` | `crm:task:{id}:v{version}:completed` |
   | `crm.task.reassigned` | `crm:task:{id}:v{version}:reassigned` (with `previousAssigneeId`) |
   | `crm.note.created` | `crm:note:{id}:created` |
   | `crm.note.updated` | `crm:note:{id}:v{version}:updated` |
   | `crm.note.archived` | `crm:note:{id}:v{version}:archived` |

   - **Payloads** carry ids, status, priority, due instant, assignee, relation ids and version. The body is only `{ redacted: true, length }`; note text and task descriptions are never in the outbox.
   - A replay with the same key and payload is a no-op. A different payload under the same key is a 409 (`jobIdempotencyConflict`), as for every outbox producer.
   - The drain gets **no-op receipt handlers** for these kinds, so dispatched jobs succeed instead of failing `UNSUPPORTED_JOB_KIND`. Webhooks and automation consumers come later. Drain internals are unchanged.

7. **Notifications, deliberately minimal** (not the full PRD §24).
   - The only stored kind is **`task_assigned`**. It is written when a task is created for, or reassigned to, someone other than the actor.
   - **Due-soon and overdue are computed on read**: the bell shows a count of my open overdue tasks with a link to the filtered list. Nothing is stored and there is no scheduler.
   - There is no email, no push and no preferences.
   - The API is `GET /crm/notifications` and `POST /crm/notifications {ids | "all"}` (mark read).
   - The UI is a bell popover in the header.

8. **Erasure** (`erase_contact`, SECURITY DEFINER, replaced in 0019 and again in 0020). In the same transaction as the rest of the erasure:
   - **Tasks** linked to the person get `contact_id = NULL` and a version bump. The task survives; it may still matter to the company or deal.
   - **Notes on the person are deleted.** A note's only target is the person, so it has nowhere else to live, and its text is personal data. The definer gets a narrow DELETE path through the `erasure_owner_tenant` policy; app roles still have no DELETE.
   - **`contactId` is stripped from `task.*` and `note.*` audit metadata.** The append-only audit guard (from 0008) gets a narrow extension: the definer may set `metadata = metadata - 'contactId'` on `task.*`/`note.*` rows for a contact erased in this tenant, with nothing else changing. Any other UPDATE still raises.
   - **`contactId` is set to `null` in CRM outbox and job payloads** (0020, review B1). Every `crm.task.*`/`crm.note.*` event carries the linked person's id, and dispatch copies the payload into `jobs`. The definer updates both tables in the tenant (dispatched or pending events, and their jobs) through new `erasure_owner_tenant` policies on `outbox_events` and `jobs`.
     - Fingerprints are left as written. Outbox and job payloads are scrubbed identically, so a pending dispatch recomputes the same job fingerprint. Task and note keys include the version, which erasure bumps for tasks, so no producer re-emits a scrubbed key.
   - The result is that after erasure no note body is readable, and nothing in the ledger, the outbox or the job queue points at the erased person.
   - **Known gap, accepted (review F1, soft follow-up):** a task's title or details may *name* the erased person in free text. They are kept as written, because tasks are the organisation's work and a free-text scrub needs its own design. This is tracked as a soft follow-up, not done here.

9. **UI** (shadcn only, English, light and dark, full-width shell).
   - **Tasks page** `/crm/tasks`, with "Tasks" in the CRM sidebar:
     - URL filters: assignee (me by default, anyone, nobody or a member), status (open by default, done, all), due (overdue, today, upcoming, none), related (person, company, deal or none), and text search;
     - sort by due, priority, title, created or updated (either direction); pages of 20;
     - "No tasks yet" (nothing exists) is distinct from "No matching tasks" or "Nothing assigned to you" (filters hide everything).
   - **Task dialog** (create and edit): due `datetime-local`, priority, assignee (defaults to me), and person and company pickers. A deal link comes from the deal page and can be removed. On a deal page the deal's person and company are pre-linked too, so the follow-up shows on all three records.
   - **Completion**: a checkbox, so Space toggles it. It applies optimistically and is sent with the version. A refusal reverts it and explains why; a stale version offers Reload.
   - **Tasks card** on person, company and deal pages.
   - **Timeline**: day headings (Berlin) and event sentences ("completed *Follow-up call*", "moved it from New to Contacted"). Notes have Edit and Delete for the author or moderators.
   - **Note composer**: a plain textarea; Ctrl/⌘+Enter submits.
   - **Notification bell** in the header.

10. **Archived deals take no new tasks or notes** (review F3).
    - Creating a task or note on an archived deal, linking an existing task to one, or editing or deleting a note on one returns **409 `parent_archived`**: "This deal is archived. Restore it to add or change its tasks and notes." The service locks the deal row `FOR SHARE` while it checks.
    - The SQL guards raise `deal is archived` for raw inserts and relinks.
    - Existing tasks on an archived deal can still be completed or edited elsewhere (for example from /crm/tasks), because that adds no new link.
    - The archived deal page is read-only: no Add task, no task edit or checkbox, no note composer and no note edit or delete. Restoring the deal reopens all of them.

## Review round 1 (PR #15)

- **B1, blocker, fixed:** erasure left the person's id in outbox and job payloads (§8). It is covered by the restricted-definer erasure test, which runs the definer as a `NOSUPERUSER NOBYPASSRLS` owner, and by the CRM-05 erasure test.
- **F1, accepted as a soft follow-up:** task titles and details may name an erased person; they are not scrubbed now (§8).
- **F2, fixed:** archived notes leave `note.archive` on the timeline (§5).
- **F3, fixed:** archived deals refuse new tasks and notes (§10).
- **Pinned by tests:** cross-tenant company and deal links on task create and update return 404.
- **N1–N7:** non-blocking notes, parked as soft follow-ups in the acceptance record. The full review file was not available on the build machine; the fix round followed the brief.

### Fold-extras round

A parallel local round fixed the same B1/F2/F3 findings on another checkout under an equivalent (differently-named) migration. That migration was not merged — this branch's own `0020` already covers the same ground — but its *test coverage* (a policy catalog test, explicit note archive/restore refusal assertions, a person-timeline F2 test, and an E2E deleted-note step) was folded onto this tree's existing tests. See the acceptance record's "Fold-extras round" section for detail.

## Deviations and limits (intentional)

- **The default filter is "assigned to me, open".** That is the "my tasks" view. There are no saved views for tasks; the CRM-03 views cover people and companies only.
- **Status is `open`/`done` only.** There is no "in progress" (Twenty has one); priority covers urgency.
- **No rich-text editor.** Notes and task details are plain text, rendered with preserved line breaks. Twenty's BlockNote editor was not adopted.
- **A deal is linked only from the deal page** (prefill). The dialog has pickers for person and company only. A deal picker can come with CRM-06 search.
- **Task reminders, due-soon email and recurring tasks** are not built (§24 / later).
- **The notification store holds assignment only.** Overdue state is derived on read, so it cannot be "marked read".
- **The timeline returns notes inline.** It does not paginate notes separately; a record with thousands of notes pages through them 50 merged items at a time.

## Consequences

- One ledger feeds history for every CRM object. CRM-07 extends it by adding item kinds, not new stores.
- Erasure stays a single definer call. Its new duties are covered by the erasure integration test and the CRM-05 upgrade test.
- Outbox consumers can be added later without changing producers. Their payloads are already PII-free.
