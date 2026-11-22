# CRM due and overdue notifications acceptance

Founder-approved defaults (22 Nov): see [founder decisions](../decisions/founder-decisions-2026-11.md#crm-notifications-22-nov).

## Behaviour

- `GET /api/workspaces/:tenantId/crm/notifications` now also returns `preferences` and generates missing `task_due` and `task_overdue` notices for the caller's open, unarchived, assigned tasks. `PUT .../crm/notifications/preferences` with `{ due?, overdue? }` switches a kind on or off for the caller in that ministry (default on).
- Dedupe key: ministry, task, recipient, kind and due time (unique partial index). Concurrent loads insert at most one row. No job, cron or queue exists: generation happens when the recipient loads the bell, so real-time delivery needs the later job slice.
- Due notices exist while the due time is under one hour old; overdue notices after that (`OVERDUE_GRACE_MS`, an engineering reading of "past due and still open").
- A notice is visible only while its task is open, unarchived, assigned to the recipient and still has the due time the notice was made for. Completing, archiving, rescheduling or reassigning therefore hides it, and a new due time or assignee gets fresh notices. Rows are never deleted. Reopening a task whose due time is unchanged shows its notice again (the same notice, not a second one).
- Generated rows are created by the recipient (actor = recipient); a trigger refuses a due or overdue row for anyone else. A person who left the ministry cannot load notices and none are generated for them.
- Email and push: `CRM_NOTIFICATION_EMAIL_ENABLED` and `CRM_NOTIFICATION_PUSH_ENABLED` are literal `false`; a unit test guards them and the absence of a sender or schedule in `crm-tasks.ts`.

## Migration 0080 (`0080_crm_task_notifications`)

Main's last was 0079; no open PR claims 0080 at the time of writing. Adds `due_at`, the dedupe index and the wider kind check to `crm_notifications`, and `crm_notification_preferences` (own-row RLS, FORCE RLS, column-limited UPDATE). New `guard_crm_due_notification` has a fixed `search_path` and `REVOKE ... FROM PUBLIC`. No new FK to contacts, tasks or users beyond the existing task FK and the preferences FKs to the ministry and user, so erase and merge are unaffected (tested). Journal `when` and snapshot chain come from `drizzle-kit generate`; a second generate reports no changes.

## Tests

- `tests/integration/crm-task-notifications.test.ts` (8): once-only, concurrent loads, reschedule reset, completion and reassignment, preferences, left ministry, other-tenant isolation, raw insert refusal, erase and merge of a linked contact.
- `tests/integration/crm-task-notifications-owner.test.ts`: restricted-owner migration, forced RLS, guard ACL.
- `tests/unit/crm-notification-channels.test.ts`: hard-off guard.
- `tests/e2e/crm-notifications.spec.ts`: bell list, once-only, preference toggle, 44px toggle rows, axe and overflow at 360, 768 and 1280 in light and dark, with and without `HARVEST_SHELL_MODES=disabled`. Screenshots in `docs/screenshots/crm-notifications/`.

No navigation entry changed, so nav link counts are unchanged.

## Deferred

Real-time delivery (needs the job slice), email and push, structured mentions, notification centre page.
