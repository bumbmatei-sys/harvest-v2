# Campaign wizard: server foundation (CW-03, CW-04 and CW-05 server side, CW-06 state, CW-08/09 configuration only)

Source: `docs/prd/harvest-campaign-wizard.md` (founder decisions of 6 Nov), `docs/acceptance/cw-01.md`,
`docs/plans/professional-v1-first-eight-prs.md`. Migration 0092 (0089 to 0091 are reserved for PRs in flight).

## What the eight steps are

| Step | Id | Content (PRD) |
| --- | --- | --- |
| 1 | `type` | Crusade, mission trip, conference, local outreach or custom project. Picking a type loads its template (departments and recommended tools). |
| 2 | `basics` | Name (required), description, goal or mission, cover image (optional). |
| 3 | `place` | Country, city/region, start and end date, time zone, structure (single, multiple, online/hybrid). |
| 4 | `leaders` | Departments for the type, a leader and members per department. The creator is the Campaign Owner automatically. |
| 5 | `tools` | Feature module cards; recommended ones preselected from the type. |
| 6 | `budget` | Currency, estimated budget, fundraising on/off, goal, online donations on/off. Configuration only (founder decision 1). |
| 7 | `connect` | Registration, evangelistic response QR, free account invitations, community discovery, follow-up, church referrals. Configuration only. |
| 8 | `review` | Summary, then Finish. Nothing is published. |

## What already exists (merged)

- `campaigns` table (migration 0021, CW-01): tenant-composite PK, FORCE RLS, `harvest_app` may SELECT and INSERT only, status `draft`/`active`,
  idempotent create service (`src/server/campaigns.ts`), list/detail routes, empty dashboard, permissions `campaigns:read` / `campaigns:write`.
- Connect link tables reference `campaigns` (HC-02 to HC-05, HC-15). They are untouched.
- Shared wizard presentation (`src/components/wizard-layout.tsx`, `stepper.tsx`, `src/lib/stepper.ts`). CW-02 (the campaign shell at `/campaigns/new`)
  is not on main, so this PR adds no screens.

## What this PR delivers (server only, no screens)

- Migration 0092: `campaign_drafts` (steps 1 to 7 stored as typed columns and two validated JSON objects, a `version` for optimistic saves, a
  client key for idempotent creation) and `campaign_draft_assignments` (department leader/member, a composite FK to `workspace_members`, so a person
  who leaves the ministry drops out). Both FORCE RLS; no SECURITY DEFINER function is needed. `campaigns` gains one narrow capability: a column-level
  `UPDATE (status, updated_at)` for `harvest_app` guarded by an owner/admin policy, for the activate transition.
- Pure rules (`src/lib/campaign-wizard.ts`): step list, template catalogue (departments, recommended tools per type), per-step schemas, step validation
  and the finish and activate readiness rules.
- Services (`src/server/campaign-wizard.ts`): create (idempotent by client key), list, get, autosave a step (stale version gives 409), discard, finish,
  activate/deactivate.
- Routes under `/api/workspaces/[tenantId]/campaigns/drafts...` and `/campaigns/[campaignId]/status`.
- Audit rows carry only the action, the target id and non-content metadata (step number, version). Never names or free text.

### Role rules

| Action | Who |
| --- | --- |
| Create, edit, finish own draft | `campaigns:write` (owner, admin, member), the draft creator only |
| See drafts | creator; owner/admin see every draft in the ministry |
| Discard a draft | creator, or owner/admin |
| Activate or deactivate a campaign | new `campaigns:activate`, owner/admin |
| Viewer | nothing |

### State only

Finish creates a `campaigns` row with status `draft` through the existing insert path (idempotency key `wizard-<draft id>`), marks the draft
`finished` and stores nothing else. Activate flips `campaigns.status`. No message, page, QR link, form, donation or invitation is created or
published by either transition. Steps 6 and 7 are stored as intent and nothing reads them to act outwardly. Online donations require fundraising on;
there is no provider call anywhere.

### Links to other modules

Leaders and team members are existing ministry members (`workspace_members`), never CRM contacts, so no CRM record is read, created or changed and
`erase_contact` / `merge_contacts` have nothing to re-key (a test asserts the schema holds no contact reference). Events, communities and Connect
links are not referenced: step 5 and 7 hold flags only (see Deferred).

## Later PRs

- CW-02 wizard shell and screens for the eight steps on the shared wizard layout (consumes these routes).
- CW-06 materialisation at Finish: department boards, tasks, milestones and the post-creation checklist from the stored draft setup.
- CW-08 wiring step 7 to Connect draft sources; CW-09 budget categories; CW-10 live donations (needs a provider decision); CW-11 follow-up; CW-12 AI.
- Cover image (files module) and event/community links once the screens need them.

## Decisions needed

1. Finish is creator-only (the campaign owner is the creator). Should an admin be able to finish someone else's draft and become owner?
2. Leaders and team members are ministry members only. Inviting a CRM person who has no login would need an invitation flow (CW-05 later).
3. Required to finish: type, name, structure, dates and time zone, plus country unless online/hybrid. Confirm this minimum.
4. Activation needs the same place and date fields complete on the campaign. Activating a campaign does not publish anything.
5. The AI copilot tool card is storable but marked not recommended until CW-12.
