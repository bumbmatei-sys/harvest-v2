# CRM import and sync status screen acceptance

A read-only screen for ministry owners and admins at `/workspaces/:tenantId/crm/imports/status`, linked from the Imports page header (owners and admins only). No navigation entry was added, so sidebar link counts are unchanged.

## Behaviour

- Data comes from `GET /api/workspaces/:tenantId/crm/diagnostics` (the same service call, `crm:read_diagnostics`): record type, status, started, updated and finished timestamps, newest first, at most 50. No file names or row data are requested or shown (the e2e proves a file name never appears).
- Status vocabulary is exactly what the server returns: Mapping, Previewed, Importing, Completed, Failed, Rolled back, using the existing Imports status labels and `StatusBadge` tones. Label text carries the meaning; colour only supports it.
- Honest states: empty ("No imports yet"), loading error (the table's error slot), and a view-only alert for roles without the permission.
- Email and calendar sync status is not built; the table note says only that they are not connected yet.

## Reuse and provenance

Reuses `DataTable` (kit `tables14`, premium), `StatusBadge` (kit `badge1`, free) and `EmptyState` (kit `empty-state15`, premium). No new kit block, dependency or provenance entry is needed. Measured provenance for the reused blocks is unchanged in `docs/ui-sources.md`. Table columns collapse by container width and rows become cards below 768px; the back link is 44px.

## Tests

`tests/e2e/crm-support-screen.spec.ts`: empty state, link from Imports, one import row without its file name, axe and no horizontal overflow at 360, 768 and 1280 in light and dark, with and without `HARVEST_SHELL_MODES=disabled`. Screenshots in `docs/screenshots/crm-support-screen/`.

## Deferred

Email and calendar sync diagnostics (sync not built), any retry or rollback action from this screen, and filtering or paging beyond the latest 50.
