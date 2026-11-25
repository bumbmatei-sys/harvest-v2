# Harvest staff and Discover review: acceptance

Stacked on `feat/discover-server` (#234). Migration `0103_platform_staff`. Server only, no screens. Hard-off by the Discover literal switch (`DISCOVER_SERVER_ENABLED = false`) plus the non-production gate. The five HC-02 gates stay UNAPPROVED.

## Founder decisions applied (25 Nov)
1. **Approval before listing stays at launch** (PRD `harvest-communities.md` 8A.3). This **supersedes ADR 0013 section 7** ("no pre-approval") for launch. The unified search already required `approved`; the legacy communities-only endpoint now follows the same rule through `discover_communities_approved`, switched on together with the Discover gate (when the gate is closed the legacy list is unchanged, so nothing moves in production until launch).
2. **Harvest staff role.** `platform_staff` (user id, role reviewer or admin, granted_by, created_at, revoked_at). Granted and revoked only by `scripts/platform-staff.ts` running the owner-only SQL functions; no self-serve path, no UI to grant, no application or worker access to the table. Every staff action writes `platform_staff_audit`; decisions also write the tenant audit rows and review events from #234.
3. **Fresh sign-in.** Staff routes require a session created within the last 15 minutes (`STAFF_FRESH_SIGN_IN_MINUTES`; Better Auth's session creation time is the sign-in time, and there was no existing freshness helper). A stale session gets 401 `REAUTH_REQUIRED`. Non-staff get the neutral 404, checked before freshness, so a stale session never reveals whether someone is staff.
4. **Staff see only Discover review data.** The queue returns listing public fields, review state, report counts and the ministry's id; no member, application, payment or private ministry data. Reviewers approve and reject, read the queue and reports and resolve reports; admins also suspend, reinstate and set a ministry's Discover standing.

## Checklist
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `platform_staff` table, no self-serve grant, ops script only | BUILT | Migration; `scripts/platform-staff.ts` (grant, revoke, list); unit guards; integration: app and worker roles refused everywhere |
| 2 | Staff audit of every action | BUILT | `platform_staff_audit` via `platform_staff_log` (queue views, reports, decisions including stale attempts, report resolution, standing, grant, revoke) |
| 3 | Recent sign-in required | BUILT | `assertFreshSignIn`, `platformResponse`; unit-level test of stale, missing and future timestamps |
| 4 | Staff see Discover review data only | BUILT | Exact key list asserted; no ministry tables referenced by the migration (unit guard) |
| 5 | `POST /api/platform/discover/reviews/:id/decision`, queue and report endpoints | BUILT | `GET /api/platform/discover/queue?state=`, `GET .../reports`, `POST .../reports/:id/resolve`, `POST .../reviews/:id/decision` (body: type, version, decision, reason), `POST .../ministries/:tenantId/standing` (admin) |
| 6 | Reviewer versus admin powers | BUILT | Reviewers approve and reject; suspend, reinstate and standing are admin only (404 for a reviewer) |
| 7 | Legacy communities endpoint follows the approval rule behind the gate | BUILT | `discover_communities_approved`; integration: hidden when pending or ministry suspended, unchanged when the gate is off |
| 8 | Backfill of existing opted-in communities into review | DEFERRED | Existing projection rows have no content hash until their next save; an ops refresh script is not built. Nothing is live, so this matters only for dev data |
| 9 | Staff UI | DEFERRED | Screens PR |
| 10 | Stronger staff authentication (MFA, IP allow-list, session step-up beyond sign-in age) | DEFERRED | Founder/security decision; sign-in age is the only step-up here |

## Notes
- Reasons given by staff (reject, suspend) are stored in the review event and shown to the ministry's admins in their listing view, as in #234.
- A staff user is also a normal Harvest user; the staff role gives access only to the endpoints above.
- Granting needs the migration owner connection (`DATABASE_URL_UNPOOLED`), the same trust level as running migrations.
