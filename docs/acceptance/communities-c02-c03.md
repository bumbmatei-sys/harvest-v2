# Communities C02 + C03 — acceptance record

Ships in PR #57 with ADR 0013 (C01). Plan: `docs/superpowers/plans/2026-11-11-communities-c02-c03.md`. Data and access foundation only: no routes, pages or member-facing UI; Communities remain unreachable from the app.

## What shipped

- **Creator audience:** `creator` joins `church`, `ministry_nonprofit` and `evangelist_missionary` (label "Creator"); user-facing wording stays "ministry".
- **Migration `0035_communities`:**
  - `communities`: tenant-owned, globally unique lowercase slug with format and reserved-name checks; independent `status` (draft by default), `visibility` (hidden by default), `pricing` (free by default) and admission flags; optimistic `version`; `created_by` cleared if that account is deleted.
  - `community_memberships`: per-community role (owner, admin, moderator, contributor, member) and status (active, pending, banned, left, removed).
  - `entitlements`: shared access grants with a source (`community_free_join`, `admin_grant`, `invitation`, later `product_purchase`, `bundle`, `subscription`), validity window and revocation.
  - FORCE RLS on all three. Staff path: `tenant_id = app.tenant_id`. Member path: own membership and grant rows by `app.user_id`; a community row only through an **active** membership. Runtime role has SELECT, INSERT, UPDATE and no DELETE.
- **Permissions:** ministry `communities:read` (all roles) and `communities:manage` (owner, admin); community capabilities in `src/lib/community-permissions.ts`.
- **Services (`src/server/communities.ts`):** create (creator becomes active owner), list, update (optimistic version; paid pricing refused until the Commerce gate), admin access grant (activates membership; banned stays banned), revoke, and effective access (active membership plus staff role or any valid, unrevoked grant). Every write is audited.

## Validation (author-executed, local)

- Lint with source guards, typecheck, 349 unit tests (incl. community capabilities and the 0035 migration shape).
- Integration `communities` (8) and `workspace-audience` (6), with two ministries and three communities: global and reserved slugs; ministry viewers list but cannot create; another ministry gets 403 and no rows; the member path returns only the person's active community; pending and banned people read nothing; re-granting a banned member is refused; access survives revoking one of two grants and ends with the last; expired grants are ignored; paid pricing and stale versions are refused; no DELETE on any of the three tables.
- `test:rls`: all pass except the four files that cannot run as root here; those, plus `communities`, passed as the unprivileged `tester` user (16 tests), which applies 0035 as a restricted migration owner.
- Browser `ministry-audience` spec passes with the fourth option; screenshots updated and viewed.

## Not covered (later slices)

Routes, editor and pages (C04, C05), joining flows and free-join grants (C06), applications (C07), invitations and invitation grants (C08), member shell (C09), feed (C10), moderation (C12), notifications (C15), slug rename redirects (C05), the activation flag (with the first route), Discover projection (C05).

## Gates

No merge, deployment or production migration is authorized. Production migrations 0031–0034 are still unapplied; 0035 follows them.
