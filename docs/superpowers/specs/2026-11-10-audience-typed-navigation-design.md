# Three-audience workspace onboarding and typed module navigation — design

Status: design approved by the founder on 10 November 2026; implementation plan not yet written. Planning only: no code, migration, merge, deployment or production activation is authorized by this document.

Position in the approved sequence: item 4 of the first proposed sequence in [the audit proposal](../../plans/professional-v1-audit-proposal.md) (shared filters and HC-06 are merged). It extends the existing `AppShell`; it does not create a second shell. Harvest Connect continues with HC-08 afterwards.

## Decisions

1. **Scope:** audience chosen at workspace creation plus one typed module registry that `AppShell` renders. No new modules, no creation wizard engine, no per-workspace module toggles (native module selection stays separate work).
2. **Audience effect now:** stored and wired, minimal visible change. The registry can filter items and override labels per audience, but today's configuration shows the same items to everyone. No audience terminology is invented; any future wording is specified by the founder.
3. **Existing workspaces:** audience is nullable. Existing workspaces stay unspecified and behave exactly as today. Owners and admins can set or change it later.
4. **Approach:** a pure registry in `src/lib/navigation.ts` resolved inside `AppShell`. Rejected: a server-resolved navigation model (touches every page, no security gain) and per-workspace module flags in the database (native module selection).
5. **Delivery:** two PRs, A then B, each with independent exact-head review under the current workflow.
6. **Order:** this work first, then HC-08. The five HC activation decisions and production migrations 0031 then 0032 remain the founder's separate approvals and are not part of this work.

## Current state (inspected at main `3b6ce19`)

- Workspace creation asks for a name only (`src/components/workspace-form.tsx`, `POST /api/workspaces`); `workspaces` has `name` and `brand_theme` only.
- The sidebar is hard-coded in `src/components/app-shell.tsx`: CRM (People, Organizations, Pipelines, Tasks, Imports hidden from viewers), Workspace (Campaigns, Files), Settings (CRM fields, Pipeline settings, Appearance). The breadcrumb section label is a separate pathname chain in the same file.
- `can()` in `src/server/permissions.ts` is the permission source; `settings:write` is owner/admin.
- Next free migration is the entry after `0032_hc06b_association_foundation` in `drizzle/meta/_journal.json`; 0033 is a candidate, not a reservation.

## PR A: typed navigation registry (no behavior change, no migration)

- `src/lib/navigation.ts` holds typed plain data. Each entry: id, group (`crm`, `workspace`, `settings`), message key, icon, route builder, active-path matcher, required permission, optional `audiences`, optional per-audience label key.
- `resolveNavigation({ tenantId, role, audience })` is pure. It filters by `can(role, permission)` and by audience. A null audience means unrestricted entries only. It returns groups of items with href, label key, icon and an active flag for a given pathname.
- `AppShell` renders the resolved groups instead of its hard-coded links. The breadcrumb section label comes from the active registry entry; the profile page and the workspace switcher are unchanged.
- **Parity rule:** every current item keeps its route, label, icon and active behavior. "Imports hidden from viewers" becomes the `crm:import` permission, which is the same set of roles (owner, admin, member).
- No audience-specific entries ship. Unit tests prove filtering and label overrides with fixture entries only.
- **Reuse:** extends the existing shadcn Sidebar primitives and message catalog; records the registry in `docs/component-registry.md`.

## PR B: audience

- **Data:** migration adds `workspaces.audience text` (nullable) with a check constraint allowing `church`, `ministry_nonprofit`, `evangelist_missionary`. The column sits on an already row-secured table; RLS is verified, not assumed.
- **Create:** `POST /api/workspaces` requires `audience` (strict zod enum) and `createWorkspace` stores it in the same transaction that creates the owner membership and the `workspace.create` audit row.
- **Change later:** a new Workspace settings page (same pattern as the Appearance page) with one audience field. Owners and admins can edit it through a new route guarded by `settings:write`; others see it read-only. Each change writes a `workspace.audience_update` audit row.
- **UI:** a shadcn RadioGroup with three short labels (Church; Ministry or nonprofit; Evangelist or missionary), required at creation, no helper text. One shared audience field component serves creation and settings. 44px targets below `lg`, full-width layout, light/dark tokens.
- **Navigation:** `AppShell` receives the workspace's audience and passes it to `resolveNavigation`. A new Settings item links to the Workspace settings page.
- **Terminology:** the interface keeps its current "workspace" wording in this slice; the founder's "Organizations" rule is currently applied to CRM organizations and is not changed here. Whether "workspace" itself should become "organization" is an open founder question, not decided by this design.

## Security and error handling

- The server enforces every permission; the sidebar is presentation only.
- Member or viewer attempting to change audience: 403. Foreign tenant: 404. Invalid audience value: 400. Missing audience on create: 400.
- One workspace's audience is never readable from another tenant (existing tenant-scoped reads; tested).
- No provider names in user-facing copy; messages live in `messages/en.json`.

## Testing and evidence

- **Unit:** resolver parity with the current sidebar for owner, admin, member and viewer with a null audience; audience filtering and label overrides with fixtures; active-path matching including Imports and Pipelines/deals.
- **Integration (PR B):** create with audience; invalid and missing values rejected; owner and admin update; member, viewer and foreign tenant denied; audit rows written; migration applies twice; existing workspaces read as null.
- **Browser:** create a workspace and pick an audience; change it in settings; sidebar parity; axe, no horizontal scroll and light/dark screenshots at 390, 768 and 1440 widths. Screenshots are viewed, not only generated.
- **Docs:** acceptance record per PR; component-registry entry; Craft roadmap update; refresh the CLAUDE.md state, which still describes the HC-06C+D PR as a draft.
- Independent review by a separate fresh session for each PR; no merge or deployment without the founder's explicit approval.

## Out of scope

Native module selection and per-workspace module toggles; the shared creation wizard engine; creator-specific onboarding and public Discovery (Post-launch); audience-specific terminology; landing-page differences per audience; any provider call, payment or outbound message; the HC-02 activation decisions and production migrations.

## Risks and open items

- Today all audiences see the same three modules, so the audience has little visible effect until Communities, Courses and Social modules exist. This is intentional and recorded so the registry is ready for them.
- A required audience at creation adds one step for every new workspace; the field is a single required choice, not a wizard.
- Production migration order: 0033 must apply after 0031 and 0032, which are still pending.
