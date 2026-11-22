# CRM reports acceptance

Read-only CRM aggregates: a server route and one screen. Built on the founder's 22 Nov decisions (`docs/decisions/founder-decisions-2026-11.md`, "CRM reports decisions"). **No migration** (computed from existing tables; main's last is 0079 and this PR claims no number). Nothing here is deployed or approved by an independent reviewer. All five HC-02 gates remain **UNAPPROVED**. No export, notification, outbound message or write exists.

## What is built

| Part | Behaviour |
| --- | --- |
| Route | `GET /api/workspaces/:tenantId/crm/reports?period=` (`last7`, `last30` default, `last90`, `thisMonth`, `lastMonth`). `Cache-Control: private, no-store`; 401 without a session, 403 for viewers and non-members, 400 for an unknown period, all with the existing neutral messages. |
| Service | `src/server/crm-reports.ts` runs tenant-scoped SQL aggregates through `withTenant` under the caller's role (FORCE RLS applies, every query also filters `tenant_id`). Permission `crm:reports` (owner, admin, member; viewers denied). |
| Screen | `/workspaces/[tenantId]/crm/reports`, sidebar entry "Reports" under People (Operations, permission `crm:reports`, so viewers never see a dead link). Period tabs, six summary cards (four for members), two bar-chart cards and, for owners and admins, a source card. Every chart has a table carrying every figure. Footer: window, "Times are in UTC", update time, the suppression note and "Task figures cover CRM tasks, not Connect follow-up cases". |
| Pure rules | `src/lib/crm-reports.ts`: periods, atomic regions and suppression (shared by server and tests). |

## Definitions

- **Time zone:** UTC. The `workspaces` table has no time zone (the CRM's `Europe/Berlin` constant is a fixed display setting, not a ministry setting), so the footer says UTC. Periods: last 7/30/90 days are UTC calendar days ending today, today included; this month starts on the 1st; last month is the previous calendar month.
- **Pipeline conversion:** cohort = unarchived deals created in the period (their creation time); won = currently in a won stage; created = all of them; conversion = won / created. A reopened deal counts by its original creation and, being open again, is not won. Outcomes shown: won, open, lost. Stage-to-stage movement is deferred.
- **Tasks:** population = CRM tasks (not Connect follow-up cases). Completed = completion events (`task.complete` audit rows joined to unarchived tasks), so a reopened task counts again when re-completed and a task archived afterwards no longer counts. Overdue = a live snapshot: open, unarchived tasks with a due time before now; "on time" = the other open tasks (including those with no due time). Not history.
- **Contacts (owners and admins only):** contacts created in the period; erased contacts are gone (`erased_at` set); a merge erases the merged person, so a merged pair counts once. Credit goes to the contact's first source event (earliest `occurred_at`, ties by id, reverted events ignored); contacts with no source event are "Unknown". Outcome per source: added, and how many have an unarchived deal in an open or won stage. Growth is additions, not net change.
- **Scope:** owners and admins see ministry totals. Members see only deals they own and tasks assigned to them; they get no contact or source figures (they are not "own work"; this is an interpretation of the decision). Viewers see nothing.

## Suppression strategy

Any figure whose group is smaller than five (1 to 4) is withheld and shown as "Fewer than 5"; zero is shown as zero. Member figures use the same rule. The periods overlap, so a published total of one period minus another could expose a small group; the strategy is documented in `src/lib/crm-reports.ts` and has four parts:

1. **Atomic regions.** The five periods' boundaries cut time into disjoint regions. Every period is a union of regions and every count is computed per region (and, for breakdowns, per leaf: deal outcome, task state, source by with/without deal).
2. **Row rule.** A row is published for a period only if every region inside the period has a count of 0 or at least 5 in every leaf. Hence every published number is a sum of regions that are each 0 or at least 5, and a difference between any two nested or overlapping periods is such a sum too, never a group of 1 to 4. A figure like 13 = 3 + 10 is withheld because its region split is small.
3. **Total rule.** The total is published only if every region total is 0 or at least 5.
4. **Complementary suppression.** When rows are withheld and the total is published, total minus the visible rows would reveal the hidden rows' sum. The smallest non-zero visible rows are therefore also withheld until that derivable sum is 0 or at least 5 in every region; if rows run out the total is the only figure left. Withheld figures all read "Fewer than 5", so a reader cannot tell protective hiding from small groups; the footer says some other figures may be hidden with them. The source "with a deal" and "without a deal" counts are separate leaves so that created minus with-deal cannot expose a small group.

Tested: unit tests for each rule (`tests/unit/crm-reports.test.ts`) and integration tests on seeded data, including a pairwise check that no published difference between nested periods lands in 1 to 4, complementary suppression on the source table and on a member's overdue/on-time pair.

Limits, stated plainly: this is a differencing defence for these five fixed periods and one breakdown at a time, not a differential-privacy guarantee. Repeated observations of the live overdue snapshot over time, readers who combine different roles' views (an owner's ministry totals with a member's own totals) and outside knowledge are not covered. Privacy review of the release policy is still required before real data.

## Further limits (reviewer notes, stated plainly)

- **Source evidence expires.** The report reads `contact_source_events` under RLS, and `sources_read` hides an event while its Connect response is expired or unassociated or its hosted-form response has passed `expires_at`. Contacts older than that window from a form or Connect therefore read "Unknown" (or are credited to a later source). The screen footer says so; an integration test covers an expired form response. No migration. **Decision needed (founder):** should source attribution outlive the response?
- **Windows end at now.** Every window ends at the time of the read (`generatedAt`), so two reads at different times can differ by 1 to 4 in any live figure, not only the overdue snapshot.
- **Suppression is a presentation rule, not an access boundary.** Owners and admins can already open every person, deal and task; members see only their own scope here and cannot get ministry totals from this route. The residual risks (owner totals versus member totals, repeated snapshots) are accepted; this is not protection against staff.
- **Member task credit** follows the current assignee, not who completed the task.

## Evidence (local, synthetic data)

- `npx tsc --noEmit`, `npm run lint` clean. Unit project: 116 files, all pass (one source-guard test hit its 5 s timeout once under full-suite load and passes alone).
- `tests/integration/crm-reports.test.ts` (embedded PostgreSQL as non-root, 14 tests): correct numbers on seeded data across five regions, archived excluded, reopened deal by creation, completion events (reopened counted twice, archived task excluded), live overdue snapshot, first-source credit, merged pair once, erased gone, archived deal not "with a deal", complementary suppression, subtraction check, ministry isolation (a second ministry's six deals never count), member-own scope, viewer and stranger 403, unknown period 400, route headers and no personal data in the body.
- `tests/e2e/crm-reports.spec.ts` (Chromium, 1 test, passes with shell modes on and with `HARVEST_SHELL_MODES=disabled`): sidebar entry, owner totals, member scope with "Fewer than 5", viewer denial (no link, no page, 403), arrow-key and click period changes (exactly three GETs), an empty ministry, axe (WCAG 2.0/2.1/2.2 A and AA) and no horizontal overflow at 360, 768 and 1280 in light and dark, 44 px period targets at 360.
- Navigation: `tests/unit/navigation.test.ts` and `tests/e2e/campaigns.spec.ts` (link count 12 to 13) updated. The campaigns, shell-slice2, shell-slice3a, kit-pr2-shell and settings-popup browser specs pass (settings-popup failed once at a keyboard step and passed on rerun; it does not touch this change).
- Screenshots: `docs/screenshots/crm-reports/` (device scale 1, opened and read).

## Provenance

Premium kit `admin-dashboard` commit `1631106`, `ai-analytics`: `report-stat-cards.tsx` (46% of lines identical), `report-bars-card.tsx` (15%), `report-period-tabs.tsx` (45%), measured with `scripts/ui-identical.sh`; shared `chart.tsx` reused. Recorded in `docs/ui-sources.md` and `src/lib/ui-provenance.ts`. Approval basis: the standing kit rule and the 20 Nov dashboards-use-the-kit decision; the founder has not approved these exact items, so the PR names them.

## Deferred

Stage-to-stage movement; time series inside a period; export; notifications (due and overdue events, preferences); the support and sync diagnostics screen; retention and erasure changes; approval limits; a per-ministry time zone (needs a settings change); per-pipeline or per-owner breakdowns (more cells, more suppression); an index on `audit_logs (tenant_id, action, created_at)` if the completion query ever needs it (it uses the existing tenant and time index).
