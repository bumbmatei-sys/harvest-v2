# CRM reports acceptance

Read-only CRM aggregates: a server route and one screen. Built on the founder's 22 Nov decisions (`docs/decisions/founder-decisions-2026-11.md`, "CRM reports decisions"). The first PR had **no migration**; the follow-ups (below) add migration `0091_crm_reports_followups`. Nothing here is deployed or approved by an independent reviewer. All five HC-02 gates remain **UNAPPROVED**. No notification or outbound message exists; the follow-ups add a CSV export (aggregates only).

## What is built

| Part | Behaviour |
| --- | --- |
| Route | `GET /api/workspaces/:tenantId/crm/reports?period=` (`last7`, `last30` default, `last90`, `thisMonth`, `lastMonth`). `Cache-Control: private, no-store`; 401 without a session, 403 for viewers and non-members, 400 for an unknown period, all with the existing neutral messages. |
| Service | `src/server/crm-reports.ts` runs tenant-scoped SQL aggregates through `withTenant` under the caller's role (FORCE RLS applies, every query also filters `tenant_id`). Permission `crm:reports` (owner, admin, member; viewers denied). |
| Screen | `/workspaces/[tenantId]/crm/reports`, sidebar entry "Reports" under People (Operations, permission `crm:reports`, so viewers never see a dead link). Period tabs, six summary cards (four for members), two bar-chart cards and, for owners and admins, a source card. Every chart has a table carrying every figure. Footer: window, "Times are in UTC", update time, the suppression note and "Task figures cover CRM tasks, not Connect follow-up cases". |
| Pure rules | `src/lib/crm-reports.ts`: periods, atomic regions and suppression (shared by server and tests). |

## Definitions

- **Time zone:** the ministry's own (`workspaces.time_zone`, UTC for ministries that never set one; see the follow-ups section). Periods: last 7/30/90 days are calendar days in that zone ending today, today included; this month starts on the 1st; last month is the previous calendar month. A day that is 23 or 25 hours long (a daylight-saving change) still counts as one day.
- **Pipeline conversion:** cohort = unarchived deals created in the period (their creation time); won = currently in a won stage; created = all of them; conversion = won / created. A reopened deal counts by its original creation and, being open again, is not won. Outcomes shown: won, open, lost. Stage-to-stage movement is its own table (follow-ups).
- **Tasks:** population = CRM tasks (not Connect follow-up cases). Completed = completion events (`task.complete` audit rows joined to unarchived tasks), so a reopened task counts again when re-completed and a task archived afterwards no longer counts. Overdue = a live snapshot: open, unarchived tasks with a due time before now; "on time" = the other open tasks (including those with no due time). Not history.
- **Contacts (owners and admins only):** contacts created in the period; erased contacts are gone (`erased_at` set); a merge erases the merged person, so a merged pair counts once. Credit goes to the person's durable first source (kind and first-seen date, kept after the evidence expires; follow-ups); contacts that never had a source are "Unknown". Outcome per source: added, and how many have an unarchived deal in an open or won stage. Growth is additions, not net change.
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

- **Source evidence and durability.** Raw evidence still expires (a Connect or form response with its source event after 90 days) and the contact detail history still hides it. The report no longer reads the evidence: it reads the durable first source (kind and date) introduced by migration 0091, so attribution outlives the evidence. Contacts whose evidence had already expired before 0091 (and had no hosted-form tag) read "Unknown" as before; the screen footer says so. Details: [hosted forms defaults](crm-forms-defaults.md) for the form tag.
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

## Follow-ups (24 Nov, founder-approved defaults; migration 0091)

Decisions: `docs/decisions/founder-decisions-2026-11.md` ("CRM reports follow-ups"). Nothing here is deployed, and the five HC-02 gates stay UNAPPROVED.

| Part | Behaviour |
| --- | --- |
| Durable attribution | `contact_first_sources` (tenant, contact, kind, first-seen date; no content). Definer triggers write it when a source event arrives (only if earlier than the credit the person already has), replace the provisional manual credit when a later source deletes the manual event, fall back to the earliest remaining evidence when an import row is reverted, and delete it on erase. `merge_contacts_scoped` keeps the earliest on the kept person. Expiry of a Connect response or a form response deletes the event, not this row, so the report keeps crediting the source. Backfilled from retained events and form tags at migration time. Owners and admins read it; no app role writes it. The report reads it alone (the form tag from PR #208 still serves the source filters). |
| Time zone | `workspaces.time_zone` (default UTC, check on length, IANA name validated in the app: region/city names the runtime knows, or UTC). Set at creation from the browser zone (invalid or missing: UTC), editable in Ministry settings (page and Settings pop-up) by owners and admins (`PATCH /api/workspaces/:id/time-zone`, audited). Periods, region boundaries, window labels and the footer ("Times are in <zone>") follow it; `src/lib/time-zone.ts` does the calendar arithmetic (DST days, a midnight that does not exist starts at the change). |
| Stage movement | `crm_deal_stage_moves` (deal, from, to, moved at, moved by; FORCE RLS; owners and admins read; written by a trigger on `opportunities.stage_id`, so every path is recorded; `moved_by` is left empty rather than blocking when the actor is not a known user). Backfilled from audit `opportunity.move` rows (they hold from and to stage); malformed rows and rows for deals that no longer exist are skipped. The reports (owners and admins only) show forward moves between neighbouring stages of each pipeline in the period (steps between two closed stages, such as Won to Lost, are not listed; steps between open stages and from an open stage into Won or Lost are) and the median days the deal had spent in the earlier stage (since its previous move, or its creation), as a table with every figure. A count of 1 to 4 in any region of the period reads "Fewer than 5" and withholds its median; no total is published, so complementary suppression does not apply. Archived deals are excluded. The card says "Movement is tracked from <date of the earliest recorded move>". The table holds no contact reference, so erase and merge have nothing to clean and cannot be blocked by it; rows go with the deal. |
| Export | `GET /api/workspaces/:id/crm/reports/export?table=deals\|tasks\|sources\|stages&period=` (permission `crm:reports_export`: owners and admins). Same figures, suppression and zone as the screen; each row carries the period (ministry-local dates) and the zone; formula-safe cells; file name `crm-report-<table>-<period>-<ministry-local date>.csv`; one audit row `crm.report.export` (table and period) written before the data is built. Members, viewers and strangers get 403, a bad table or period 400. |

Evidence (local, synthetic data): `tests/unit/crm-reports-time-zone.test.ts` (zone validation, DST boundaries, period windows in several zones, CSV builder escaping and suppression, permission), `tests/integration/crm-reports-followups.test.ts` (restricted-owner upgrade with backfill and FORCE RLS preserved, privileges and fixed search_path, time zone creation and settings and isolation, durable source across evidence expiry, erase and merge, stage movement recording and report, small cohorts, erase and merge not blocked, export permission and audit), `tests/integration/crm-reports.test.ts` (the expired-evidence case now keeps the form credit), `tests/e2e/crm-reports-followups.spec.ts` (Chromium: creation zone, settings, footer, stage card, downloads, member and viewer denial, axe and overflow at 360, 768, 1280 in light and dark, 44 px export target). Screenshots: `docs/screenshots/crm-reports-followups/`.

Deploy order: migration 0091 must be applied before this app code is deployed (`createWorkspace` writes `workspaces.time_zone` and the reports read the new tables). Pre-0091 test seeds use `tests/helpers/legacy-workspace.ts`.

Definer policies: `first_source_definer` and `stage_moves_definer` are created `TO PUBLIC` with `current_user <> 'harvest_app'` (the app role has only the read policy and no write privilege), so they work whichever role owns the trigger and merge functions (the migration runner here, a different owner on Neon). The erase, manual-removed and reverted triggers scope `app.tenant_id` to the row's tenant and restore the caller's; the erase trigger raises if a durable row remains.

The stage table shows neighbouring forward steps only (not backward or skipped moves, nor steps between two closed stages); a median is withheld together with its row.

Limits, stated plainly: the median is not additive, so it is not part of the differencing defence (it is withheld with its count only); a person erased before 0091 has no durable row (their events were already gone); people created before 0091 whose evidence had already expired read "Unknown" as before; moves made before the audit log existed (none known) are not backfilled.

## Deferred

Time series inside a period; notifications (due and overdue events, preferences); the support and sync diagnostics screen; retention and erasure changes beyond the above; approval limits; per-pipeline or per-owner breakdowns (more cells, more suppression); non-adjacent and backward stage moves in the stage table; an index on `audit_logs (tenant_id, action, created_at)` if the completion query ever needs it (it uses the existing tenant and time index).
