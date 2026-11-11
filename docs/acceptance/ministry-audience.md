# Ministry type (PR B) and ministry wording (PR C) — acceptance record

Design: `docs/superpowers/specs/2026-11-10-audience-typed-navigation-design.md`. Plan: `docs/superpowers/plans/2026-11-11-audience-and-ministry-wording-pr-bc.md`. Author-executed evidence; independent review pending. Founder decision (11 Nov): PR B and PR C ship together.

## Outcome

- **Ministry type.** `workspaces.audience` (migration `0033_workspace_audience`, nullable, check constraint for `church`, `ministry_nonprofit`, `evangelist_missionary`). Required by `POST /api/workspaces` and by the creation form; existing ministries stay unspecified. Owners and admins change it on the new Ministry settings page (`/workspaces/{id}/settings`) through `PATCH /api/workspaces/{id}/audience`, audited as `workspace.audience_update` with the previous value. Members and viewers see it read-only; the API refuses them (403), and non-members get the existing tenancy denial (403).
- **Navigation.** A `ministrySettings` registry entry in Settings; `AppShell` passes the ministry's audience to the resolver. No audience-specific entries ship.
- **Wording.** 74 user-facing message values changed from workspace to ministry (Ministries, Ministry name, Create ministry, Ministry navigation, …). Message keys, routes, API paths, database names and code identifiers keep `workspace`; CRM Organizations is unchanged.

## Evidence (author-executed, local)

- `tests/integration/workspace-audience.test.ts`: 5 passed (stored at creation and listed; null for callers without one; invalid values rejected in the service, in strict input and by the database constraint; owner and admin updates with audit rows; member, viewer and non-member refused).
- `tests/unit/migrations.test.ts`: 0033 changes only `public.workspaces` (new nullable `audience` column and `workspace_audience` check).
- `npm run lint` (ESLint and source guards), `npx tsc --noEmit`: pass. `npm test`: 30 files, 344 passed (navigation tests now include Ministry settings; HTTP error copy updated).
- Browser: new `ministry-audience.spec.ts` passed (API refuses a ministry without a type; create through the form; open Ministry settings from the sidebar; change and persist; viewer read-only with notice and API 403; axe and no horizontal scroll at 390, 768 and 1440 in light and dark; 18 screenshots, sampled and viewed). `foundation`, `files`, `pr01b`, `layout` and `campaigns` passed after their selectors followed the new copy; the campaigns mobile-shell test now counts 12 navigation links, all reachable by keyboard and at least 44px.

## Not covered here

Audience-specific navigation or wording, per-audience landing pages, native module selection. Production migrations 0031, 0032 and 0033 are not applied; 0033 applies after 0032.
