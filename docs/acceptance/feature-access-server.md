# Per-feature access: server (acceptance checklist)

Founder decision, 25 Nov: "The admin who buys the account can give someone permission to any feature or to the whole account. Someone can have access only to social media, for example, or to everything. Or can be a guest or full admin." Invitations must be accepted by the invitee.

Scope of this PR: the server (capabilities in code, one central database function behind row-level security, invitations, grants, audit) plus navigation hiding. No screens for managing access, no invitation e-mail delivery. Delivery stays a constant off switch.

Written before coding; the status column is filled at the end of the work.

## 1. Model

| Role id | Meaning | Access |
| --- | --- | --- |
| `owner` | The account owner (the buyer). More than one owner can exist; the last one cannot be removed or demoted. Removable only by transferring ownership first. | Everything, including granting `admin`. |
| `admin` | Full administrator. Created with a choice, "may manage admins" (`can_manage_admins`). | Everything except granting or changing `owner`. Without the permission it cannot grant, change or remove admins; with it, it acts like an owner for admins (still never removes or demotes the owner or transfers ownership). |
| `member` | Unchanged legacy role (the standard team member). | Exactly today's `member` rules. |
| `viewer` | Unchanged legacy role. | Exactly today's `viewer` rules. |
| `collaborator` | NEW. A member with a per-area access set. | Only the areas granted, each `view` or `manage`. Nothing else. |
| `guest` | NEW. Read-only, explicitly shared items only. | No area. Sees an item only when it was shared with them by name (Docs shares today). |
| `campaign_guest` | Exists in open PR #251 (campaign invitations). Aligned, not duplicated: the migration inserts the role id with `ON CONFLICT DO NOTHING`, and every rule treats it exactly like `guest`. | Same as `guest`. |

Areas (the founder's list; code name `area` because `feature` already means an activation flag in the navigation registry): `crm`, `giving`, `campaigns`, `communities`, `catalog` (Courses & products), `social` (planner, inbox, Auto-DM, ads, analytics), `newsletter`, `website` (Website / link in bio), `office` (mail, calendar, docs, storage, tasks), `connect`, `settings`.

Levels: `view` (read-only where the module has a read-only capability) and `manage` (everything the area offers to an administrator, except the owner/admin-only list below).

Never grantable by an area (owner/admin only): managing members and roles; erasing a contact; attesting consent for someone; the sensitive CRM export columns; outbound webhook endpoints; restricted pending Connect responses; the owner-only social approval setting. These are the same capabilities that are owner/admin today.

## 2. Checklist

Status legend: [ ] open, [x] done and evidenced by a test named in the last column.

### Code capabilities
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| C1 | Every existing `Permission` is mapped to one area (or to workspace-wide / owner-admin-only). The map is exhaustive at compile time. | [x] | `tests/unit/access.test.ts` |
| C2 | Default mapping keeps today's behaviour: for owner, admin, member, viewer and every unknown role, the new `can` equals a frozen copy of the old `can` for every permission. | [x] | `tests/unit/access.test.ts` (legacy parity) |
| C3 | Collaborator `manage` grants every permission of the area except the owner/admin-only list; `view` grants only the read-only ones; no grant means no permission. | [x] | unit |
| C4 | Guests and `campaign_guest` hold no permission except `workspace:read` and `docs:read` (the database then shows only docs shared with them by name, view only; `docRank` in code equals `docs_rank` in SQL). | [x] | unit |
| C5 | Server and navigation share one rule function; the role token carries a collaborator's grants so `can(workspace.role, ...)` works unchanged at the 100+ existing call sites. | [x] | unit |
| C6 | `withTenant` resolves a collaborator's grants inside the locked transaction and hands the callback the role effective for that permission. | [x] | integration |

### Database (one central function)
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| D1 | `workspace_member_access (tenant, user, area, level)` with FORCE RLS; the application role can read, never write. | [x] | integration |
| D2 | ONE function `access_role(tenant, user, area, role, read)` turns a stored role plus grants into the role that module checks already understand (`admin` for manage, `viewer` for view, `guest` for none). Legacy roles pass through unchanged. SECURITY DEFINER, fixed `search_path`, `REVOKE FROM PUBLIC`, tenant-bound. | [x] | integration |
| D3 | Every module helper and every policy that tested `role_id` calls it (ads, discover, office, social inbox and approvals, link in bio, docs, catalog, newsletter, community live/stats/chat, Connect, CRM forms and sources, follow-up cases). The migration rewrites them and a source guard keeps new inline `role_id` checks out. | [x] | integration + `tests/unit/access-guard.test.ts` |
| D4 | `view` also opens SELECT on admin tools (permissive SELECT clones of `FOR ALL` policies); sensitive tables (restricted responses, follow-up cases, docs, chat) are not opened by `view`. | [x] | integration |
| D5 | Only an owner touches `owner`. Only an owner or an admin with `can_manage_admins` grants, changes or removes `admin` or that permission; nobody gives the permission without holding it. Enforced by trigger for the application role and by the definers. The first owner of a new account is allowed. | [x] | integration |
| D6 | Nobody grants more than they hold: only owner/admin can grant, and they hold every area. A collaborator cannot change anyone's access. | [x] | integration |
| D7 | The last owner cannot be demoted or deleted (trigger, plus the existing server check). | [x] | integration |
| D8 | Grant changes only through one SECURITY DEFINER function that writes the role, the grants and the audit row in one transaction. | [x] | integration |
| D9 | The upgrade changes no existing behaviour: the full integration suite (147 files) and unit suite pass. Seven tests that simulate foreign definer owners needed `GRANT EXECUTE ON access_role` to their test role, and hc14 compares the policy text without the access_role wrapper. | [x] | whole integration project |
| D10 | Migration applies twice cleanly, also under a non-superuser migration owner; second `drizzle-kit generate` reports no schema changes. | [x] | owner test + generate |

### Invitations (accepted by the invitee)
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| I1 | `workspace_invitations` carries the intended role and area set, an e-mail, the hash of a one-time token, expiry (14 days), status. | [x] | integration |
| I2 | Creating needs owner/admin; inviting an `admin` (with or without the manage-admins permission) needs an owner or an admin who manages admins. The inviter's right is re-checked at acceptance (a demoted inviter's invitations lapse). | [x] | integration |
| I3 | Accepting needs the signed-in account whose e-mail the invitation names; the token alone is not enough; a second accept, an expired or withdrawn invitation, or another account fails. | [x] | integration |
| I4 | Nothing is added before acceptance. Acceptance creates the membership and grants and audits it. An existing member invited again gets a role/area change only after accepting. | [x] | integration |
| I5 | Delivery is a constant off switch; no message is sent. Outside production a test sink holds the link. | [x] | unit |
| I6 | Adding people is always by invitation the invitee accepts. `PUT /members` only changes existing members through the audited function; direct add is refused in production and everywhere unless the non-production test gate is on (`NODE_ENV` not production and the e2e mailbox variable set), which exists only for browser fixtures. The `putMember` server helper is for seeds and integration tests and no route reaches it in production. | [x] | integration |

### Audit
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Every grant change writes an audit row (`member.access_change`, `member.role_change`, `invitation.create`, `invitation.accept`, `invitation.revoke`) with ids and area names only. | [x] | integration |
| R1 | No role test lets a role through by exclusion: every `<> 'viewer'` (doc shares, page shares, the sharing guard, TS docs rank, docs screen, files page, member pickers) is a positive allow-list, so a guest or an area-less collaborator (both read as `guest`) never passes. | [x] | `feature-access.test.ts` (doc/page share, visibility, guest share read) + catalog scan of every policy and function |
| R2 | The rewrite catches every alias (`m2`, `NEW`, `OLD`); only the two new tables' own read policies keep a raw `role_id`. | [x] | `feature-access.test.ts` |
| R3 | `access_role` is SECURITY INVOKER: an ordinary member reads other people's areas as `guest`; owners/admins and definer owners see them. | [x] | `feature-access.test.ts` |
| R4 | A collaborator who loses the Connect area, or becomes a guest, has open follow-up cases returned to the queue (grants are written before the role, so the revocation trigger sees them). | [x] | `hc13-follow-up-cases.test.ts` |
| R5 | The member-only SELECT policies (campaign response links and codes: connect; catalog items: catalog; doc templates: office; forms and form versions: crm or connect) need the area. Privacy notice versions stay readable by every member on purpose (consent screens must show the notice). Free-catalog reads need the new `catalog:read` capability (catalog area), not `workspace:read`. | [x] | `feature-access.test.ts` |

### Navigation
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| N1 | Navigation hides every entry the viewer has no access to (collaborator with Social only sees Social; guest sees nothing). | [x] | unit (`access.test.ts`); browser spec `feature-access-nav.spec.ts` written, NOT run (no browser build in the authoring session; CI runs it) |

## 3. Residual risk and what is not built

- Files service and the AI CRM tools still gate on `workspace:read` plus their own row policies; a collaborator without Office/CRM is stopped by those policies, not by an area check in code (follow-up).

- No screens for choosing areas or accepting an invitation (the page at `/workspace-invitations/<token>` is a follow-up; the API exists).
- `view` on areas whose modules have no read-only capability yet (website, office mail and calendar, settings) grants no routes today; stored and enforced where a read capability exists.
- Policies added by other open PRs after this migration keep inline `role_id` checks until they call `access_role`; the source guard fails the build for any new one.
- Guests: only Docs shares reach a guest today. Campaign-scoped guest screens are PR #251's CW-07 follow-up.

## 4. Founder decisions (25 Nov) and what is still open

Decided:
1. **Admins.** When creating or inviting an admin the granter chooses whether that admin may also manage admins. With it, the admin acts like an owner for granting, changing and removing admins (never removes or demotes the owner, never transfers ownership). Without it, no admin changes. Only the owner or an admin with the permission can give it; nobody grants more than they hold; audited (`manageAdmins` in the audit metadata).
2. Sensitive actions (erase contact, attest consent, sensitive export columns, webhooks, contact merge) stay owner/admin only.
3. `view` grants nothing in areas without read-only capabilities until each module defines one.
4. Settings `manage` may change time zone, audience and appearance but not manage people.
5. Adding people is always by invitation the invitee accepts; direct add survives only behind the non-production test gate.

Still open:
- Are `guest` and `campaign_guest` one role? Built as two ids with identical rules so PR #251 merges cleanly.
- Giving has no capabilities yet; the area is stored and reserved.
- Guests see the account name only; only Docs shares reach a guest today.

## 5. Evidence

Unit (1656 + new), integration all shards green (a Postgres file-handle flake in community-live and hc06b-owner passed on rerun), eslint and source guards clean, `drizzle-kit generate` twice: "No schema changes". Migration 0111 `when` 1795604558739, applied under a restricted (non-superuser) owner in `feature-access.test.ts`.
