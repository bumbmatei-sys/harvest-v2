# Campaign wizard: server foundation

Plan: `docs/plans/campaign-wizard-server.md`. PRD: `docs/prd/harvest-campaign-wizard.md`. Migration 0092 (`0092_campaign_wizard`).
Server only. There is no screen in this PR because the CW-02 shell is not on main. Nothing outward is created, published or sent.

## What works

| Area | Result |
| --- | --- |
| Draft model | `campaign_drafts` holds steps 1 to 3 as columns, departments and tools as lists, and steps 6 and 7 as validated configuration. `campaign_draft_assignments` holds department leaders and members. |
| Create | `POST .../campaigns/drafts` with an `Idempotency-Key`. A retry returns the same draft (200, first call 201). The chosen type loads its template (departments and recommended tools). |
| Autosave | `PATCH .../campaigns/drafts/:id` with `{ version, step, data }`. The shape is validated per step, the version must be current, otherwise 409 and nothing is written. Two concurrent saves: one wins, one gets 409. |
| Type change | Saving a different type reloads the template and removes people placed in departments the new template drops. Saving the same type keeps customisations. |
| Leaders | Replaces the whole set per save. Only existing ministry members who can edit (owner, admin, member) can be placed; a viewer or outsider is a 400. A person who leaves the ministry drops out of every draft (cascade). |
| Validation | `validateDraft` lists every missing piece (type, name, structure, dates, time zone, country unless online/hybrid) and ties tools to fundraising, QR response and registration settings. Shown on every read as `issues` and `ready`. |
| Finish | `POST .../drafts/:id/finish`. One transaction creates the `campaigns` row (status `draft`, key `wizard-<draft id>`, owner = the creator) through the existing insert path and closes the draft. Repeats and races return the same campaign. Incomplete is a 400 naming the issues. |
| Discard | `POST .../drafts/:id/discard`. A status, never a delete. Creator or owner/admin. |
| Activate | `POST .../campaigns/:id/status` with `active` or `draft`. State only. Owner/admin (`campaigns:activate`). Needs place, dates and time zone. Nothing is published or sent. |
| Audit | `campaign.draft.create/save/discard/finish`, `campaign.create`, `campaign.activate/deactivate`. Metadata is the step number, version or campaign id only: never a name, description or place. |

## Roles

| Action | Allowed |
| --- | --- |
| Create, edit, finish a draft | the creator (`campaigns:write`: owner, admin, member), enforced by service and policy |
| Read a draft | the creator; owner/admin read every draft in the ministry; viewers and other members see none (404) |
| Discard | the creator or an owner/admin |
| Activate/deactivate | owner/admin |

## Security properties

- FORCE RLS on both tables; `harvest_app` has no DELETE, no whole-table UPDATE and PUBLIC has nothing. Updates are column-limited and policy-limited.
- No SECURITY DEFINER function is added (asserted by test).
- `campaigns` gains only `UPDATE (status, updated_at)` for owner/admin through the `campaigns_set_status` policy; names and dates stay immutable. The CW-01 test's policy assertion was updated from two runtime policies to three for this.
- No CRM contact is referenced (schema asserted), so `erase_contact` and `merge_contacts` have nothing to re-key. Leaders are workspace members only.
- Policies on one command are OR-ed, so a trigger (`campaign_drafts_guard_discard`, invoker, fixed search_path) limits an owner/admin discarding another person's draft to status, version and updated_at. The creator's update policy lets a draft become finished only for the campaign its own Finish created (owner and key `wizard-<draft id>`). Both are covered by direct-SQL tests.
- Budget and outreach settings are inert configuration: no provider call, no QR link, form, page, invitation or message is created by any transition (tests count Connect rows for a finished and activated campaign).

## Verification

Run locally with disposable embedded PostgreSQL, non-root, synthetic data. No Neon, deploy, merge or outbound message.

| Command | Result |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc --noEmit` | passed |
| `npm test` (unit) | 1525 passed, including 14 new wizard rule and route tests |
| `npx vitest run --project integration tests/integration/campaign-wizard*.test.ts tests/integration/campaigns.test.ts` | 39 passed: roles, cross-ministry isolation, stale 409, races, validation, finish and activate idempotency, direct-SQL refusals, restricted-owner migration (fresh and populated 0088) |
| `npx drizzle-kit generate` (second run) | "No schema changes, nothing to migrate" |
| Full integration project | see PR description |

## Deferred

- CW-02 screens (the wizard shell and eight steps) consuming these routes; no e2e or axe scenes because no screen is touched.
- CW-06 materialisation at Finish (department boards, tasks, milestones, post-creation checklist). Finish stores the setup on the draft only.
- CW-08 and CW-09 acting on steps 6 and 7 (draft Connect sources, budget categories); live donations (CW-10) and AI setup (CW-12).
- Cover image (files module) and links to events and communities.
- A member demoted to viewer keeps their assignment until the next step-4 save, and Finish does not re-check it.

## Decisions needed

See "Decisions needed" in the plan: creator-only finish, members-only leaders (no CRM-person invitations yet), the minimum fields to finish, activation readiness, and the copilot card.
