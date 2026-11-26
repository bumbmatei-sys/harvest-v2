# Campaign boards, tasks and milestones — acceptance

Founder approval: 26 Nov 2026 (item), 26 Nov 2026 (kit decision: "If CRM board is most premium and in depth, use that one. If not, board 3 and update in CRM as well.").
PRD: `docs/prd/harvest-campaign-wizard.md`, "Departments locked to campaign-scoped boards". CRM-05 `crm_tasks` is not extended or referenced.

## Delivered

- **Migration `0116_campaign_boards`** (tentative number; the coordinator renumbers at merge). Self-contained: references only `campaigns`, `users` and its own tables.
  - `campaign_boards`: one row per campaign and board key (`general` plus the 13 department keys), created the first time a task or milestone is added to it.
  - `campaign_tasks`: title, notes, column (`todo`, `in_progress`, `done`), position, assignee (a ministry member), due date, optional milestone, completion (who and when), version.
  - `campaign_milestones`: title, due date, optional board, reached (who and when), version.
  - ENABLE + FORCE RLS on all three; `REVOKE ALL` from PUBLIC and `harvest_app`, then SELECT/INSERT, DELETE on tasks and milestones, column-limited UPDATE (no key, tenant, campaign or creator columns). Boards cannot be updated or deleted by the app.
  - Policies use `public.access_role(tenant, user, 'campaigns', role_id)` (no inline `role_id` test): read for owner/admin/member/viewer (and collaborators with the campaigns area), write for owner/admin/member on an unarchived campaign, always as the caller (`created_by`, `completed_by`, `reached_by`). A new task's assignee must be able to write campaigns in the ministry. No SECURITY DEFINER function.
- **Server** `src/server/campaign-boards.ts` (all through `withTenant`): `getCampaignBoards` (`campaigns:read`; `writable` and the assignee list for writers), `createCampaignTask`, `updateCampaignTask` (edit, move across columns and boards, reorder by position), `deleteCampaignTask`, `createCampaignMilestone`, `updateCampaignMilestone` (edit, reach/unreach), `deleteCampaignMilestone` (tasks keep their place and lose the link) — all `campaigns:write`, version-checked (409 on a stale version), content-free audit rows (`campaign.task.*`, `campaign.milestone.*`). Limits: 2000 tasks and 200 milestones per campaign, 500 tasks per column.
- **Boards offered**: the campaign-wide board, then each department the finished wizard draft included, in the PRD order. A campaign made without the wizard has the campaign-wide board only.
- **API**: `GET …/campaigns/[campaignId]/boards`; `POST …/boards/tasks`; `PATCH`/`DELETE …/boards/tasks/[taskId]`; `POST …/boards/milestones`; `PATCH`/`DELETE …/boards/milestones/[milestoneId]` (origin-checked writes, `private, no-store`).
- **Dashboard figures**: `getCampaignOverview` now returns `work` (tasks total/done/in progress/overdue, milestones total/reached, progress = share of tasks done, `null` with no tasks) and `unavailable` is `["events", "funding"]`. The dashboard shows Tasks done, Progress ("No tasks yet" instead of 0%) and Milestones reached, plus an overdue line.
- **UI**: shared `KanbanBoard` (`src/components/board/kanban-board.tsx`), derived from kit item `kanban-board3` per the founder decision; campaign page `/workspaces/[tenantId]/campaigns/[campaignId]/boards` (board select, board/list toggle, Add task, column menus, card menus, task dialog, milestones card); an "Open boards" card on the campaign page. Copy in `messages/en.json` under `CampaignBoards`.
- **Provenance**: comparison table and `kanban-board3` row in `docs/ui-sources.md`; `kitProvenance` entry in `src/lib/ui-provenance.ts` (premium, retrieved and approved 2026-11-26, 17 of 185 lines identical in the shared board, 15 of 227 in the campaign screen); `docs/component-registry.md` row.

## Evidence (author-executed)

- `tests/integration/cw-boards.test.ts`: 8 tests passed (database shape, boards offered, create/order/move/reorder/complete with version checks, assignee eligibility, milestones, dashboard figures, access for viewer/outsider/other ministry, RLS for the app role).
- `tests/integration/campaign-wizard.test.ts`, `cw11-campaign-follow-up.test.ts`, `campaigns.test.ts`, `tests/unit/access-guard.test.ts`, `tests/unit/source-guards.test.ts`: 84 passed. `rls.test.ts`, `feature-access.test.ts`, `campaign-wizard-migration-owner.test.ts`: 27 passed. All unit tests: 1776 passed.
- `npx tsc --noEmit -p .` clean; eslint clean on changed files.
- `tests/e2e/campaign-wizard.spec.ts` updated for the two remaining "Not available yet" figures; **not run** (browser suite skipped for disk space). No screenshots or runtime visual check were taken: responsive and light/dark behaviour rely on the shared tokens and are unverified in a browser.

## Not included

- The CRM deal board moving onto the shared `KanbanBoard` (separate follow-up PR from main, no migration).
- Per-column sort, filters, labels, priority, task comments, attachments, department files and timelines (Gantt).
- Board access for department leaders who joined as `campaign_guest`; a collaborator assignee can be chosen only by an owner or admin (members cannot see other people's grants).
- Notifications or any outbound message; nothing is published.
- Overdue uses the server's UTC date, not the campaign's time zone.
- Events and funding dashboard figures (other builders).
