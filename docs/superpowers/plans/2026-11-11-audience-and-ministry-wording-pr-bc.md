# Ministry audience (PR B) and ministry wording (PR C) — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Founder decision (11 Nov): PR B and PR C ship together as one PR.

**Goal:** Store a nullable audience on each ministry (internally `workspaces`), require it when a ministry is created, let owners/admins change it on a new Ministry settings page, wire it into the typed navigation, and rename user-facing "workspace" to "ministry".

**Architecture:** One nullable `workspaces.audience` column (migration 0033, drizzle-kit generated) with a check constraint. Server functions in `src/server/workspaces.ts` validate with the shared `audiences` tuple from `src/lib/audience.ts`. A shared `AudienceField` (shadcn RadioGroup) is used by the creation form and the settings form. `AppShell` passes the selected ministry's audience to `resolveNavigation`; a new `ministrySettings` registry entry links to the settings page. Message values change from workspace to ministry; keys, routes, API paths and code names stay `workspace`.

**Tech Stack:** Drizzle/Postgres with RLS, Next.js App Router, next-intl, shadcn, Vitest, Playwright.

Spec: `docs/superpowers/specs/2026-11-10-audience-typed-navigation-design.md` (PR B and PR C sections).

## Global Constraints

- Audience values exactly `church`, `ministry_nonprofit`, `evangelist_missionary`; column nullable; existing rows stay null.
- `POST /api/workspaces` requires `audience`; the server function `createWorkspace(db, userId, name, audience = null)` keeps existing callers working.
- Change audience: `settings:write` (owner/admin) only; member/viewer 403; foreign tenant 404; invalid 400; audit action `workspace.audience_update` with `{ audience, previousAudience }`.
- Labels: "Church", "Ministry or nonprofit", "Evangelist or missionary". No helper text under fields. No provider names.
- User-facing workspace → ministry (Workspace → Ministry, Workspaces → Ministries). CRM "Organizations" unchanged. No route, key, API or database rename.
- 44px targets below `lg`, full-width layout, light/dark tokens unchanged. No force pushes.

## Tasks

1. **Data and server.** Add `audience` to the `workspaces` schema with a check constraint; generate `0033_workspace_audience` with drizzle-kit; extend `createWorkspace`; add `updateWorkspaceAudience`; require `audience` in `POST /api/workspaces`; add `PATCH /api/workspaces/[tenantId]/audience`. Integration test `tests/integration/workspace-audience.test.ts`: create stores audience; null by default for old callers; owner/admin update with audit row; member/viewer 403; foreign tenant 404; invalid value 400 (zod); migration applies twice (existing harness). Update `tests/unit/migrations.test.ts` with the 0033 assertion (only `public.workspaces` changes).
2. **UI.** `src/components/audience-field.tsx`; `WorkspaceForm` requires an audience; `src/components/ministry-settings-form.tsx`; page `src/app/workspaces/[tenantId]/settings/page.tsx`; registry entry `ministrySettings` in the settings group; `AppShell` workspace type gains `audience`, passed to `resolveNavigation`/`sectionLabel`. Unit tests updated for the new entry. Browser spec `tests/e2e/ministry-audience.spec.ts`: create a ministry with an audience, see it in settings, change it, axe + no horizontal scroll at 390/768/1440 light/dark, screenshots viewed.
3. **Wording (PR C).** Change message values only; update browser-test selectors that match visible text; source guards and all suites pass.
4. **Records.** Fix the spec status line (review finding), acceptance record `docs/acceptance/ministry-audience.md`, component registry, CLAUDE.md state, Craft roadmap after merge.
