# Communities C02 + C03 — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Founder decision (11 Nov): C02 and C03 ship in PR #57 together with ADR 0013 (C01).

**Goal:** The data and access foundation for Communities: the `creator` audience, `communities`, `community_memberships` and shared `entitlements` tables with two-path RLS (migration 0035), ministry and community permissions, and server services for create/list/update, access grants, revocation and effective access. No routes, pages or UI beyond the new audience label.

**Architecture:** As ADR 0013. Staff path = `tenant_id = app.tenant_id` (set by `withTenant` after a ministry-role check). Member path = an active `community_memberships` row for `app.user_id` (set by `withUser`). Effective access = active membership AND (staff community role OR at least one valid, unrevoked grant). Communities stay unreachable from the app until C04/C05 add routes behind the flag.

**Tech Stack:** Drizzle + Postgres FORCE RLS, zod, Vitest (unit + integration).

## Global Constraints

- Migration `0035_communities`, generated with drizzle-kit, RLS/grants appended by hand. Next number follows the journal on main.
- Audience values become `church`, `ministry_nonprofit`, `evangelist_missionary`, `creator`; label "Creator"; wording stays "ministry".
- Slugs: lowercase `^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$`, globally unique, reserved `new`, `discover`, `search`, `create`, `settings`, `admin`, `api`, `me`, `account` refused in server and database.
- Settings stored independently: `status` (`draft`, `published`, `archived`), `visibility` (`listed`, `unlisted`, `hidden`, default `hidden`), `pricing` (`free`, `paid`, default `free`; `paid` refused by the server), admission flags `allow_open`, `allow_apply`, `allow_invite`, `allow_entitlement`.
- No DELETE grant on any new table: communities archive, memberships change status, grants are revoked.
- Paid grant sources exist in the check list but no service creates them.
- Errors through the message catalog; audit every write in `audit_logs`.

## Tasks

1. **Creator audience.** `src/lib/audience.ts` adds `creator`; `src/db/schema.ts` workspace check includes it; message `ComponentsAudienceField.creator = "Creator"`; `tests/integration/workspace-audience.test.ts` uses `influencer` as its invalid value and asserts `creator` is accepted.
2. **Schema + migration 0035.** `communities` (PK `(tenant_id, id)`, unique `slug`, checks for slug format/reserved, name 1–80, tagline 1–160 or null, status/visibility/pricing sets), `community_memberships` (PK `(tenant_id, community_id, user_id)`, FK to community and user, role and status checks, index on `user_id`), `entitlements` (PK `(tenant_id, id)`, `user_id`, `resource_type` = `community`, `resource_id`, optional `tier`, `source` set, `granted_by`, `valid_from`, `valid_until` > `valid_from`, `revoked_at`, `revoked_by`, `reason` ≤ 200, index on `(user_id, resource_type, resource_id)`). Append FORCE RLS, `REVOKE ALL`, `GRANT SELECT, INSERT, UPDATE`, staff policies (tenant) and member policies (communities: active membership; memberships and entitlements: own rows). Migration shape unit test.
3. **Permissions.** `src/lib/permissions.ts`: `communities:read` (all ministry roles) and `communities:manage` (owner/admin). New `src/lib/community-permissions.ts`: `communityRoles`, `CommunityCapability`, `communityCan()`; unit tests.
4. **Services** `src/server/communities.ts`: `communitySlug` schema; `createCommunity`, `listCommunities`, `updateCommunity` (optimistic `version`, paid refused), `grantCommunityAccess` (admin grant; refuses banned members), `revokeEntitlement`, `communityAccess` (member path, union of valid grants). Integration `tests/integration/communities.test.ts` with two ministries and two communities: global slug uniqueness and reserved names; staff isolation between ministries; member path sees only own active communities; pending/banned/left read nothing; union of grants survives revoking one; expiry; paid refused; version conflict; audits written; no DELETE right.
5. **Records.** ADR status line, CLAUDE.md state (0035 used, 0036 next), acceptance record `docs/acceptance/communities-c02-c03.md`, PR description, CI (fast checks, final review, Neon from main), independent review of the delta.
