# Per-feature access: server (acceptance checklist)

Founder decision, 25 Nov: "The admin who buys the account can give someone permission to any feature or to the whole account. Someone can have access only to social media, for example, or to everything. Or can be a guest or full admin." Invitations must be accepted by the invitee.

Scope of this PR: the server (capabilities in code, one central database function behind row-level security, invitations, grants, audit) plus navigation hiding. No screens for managing access, no invitation e-mail delivery. Delivery stays a constant off switch.

Written before coding; the status column is filled at the end of the work.

## 1. Model

| Role id | Meaning | Access |
| --- | --- | --- |
| `owner` | The account owner (the buyer). More than one owner can exist; the last one cannot be removed or demoted. Removable only by transferring ownership first. | Everything, including granting `admin`. |
| `admin` | Full administrator. | Everything except granting or changing `owner`/`admin`. |
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
| C4 | Guests and `campaign_guest` hold no permission except `workspace:read`. | [x] | unit |
| C5 | Server and navigation share one rule function; the role token carries a collaborator's grants so `can(workspace.role, ...)` works unchanged at the 100+ existing call sites. | [x] | unit |
| C6 | `withTenant` resolves a collaborator's grants inside the locked transaction and hands the callback the role effective for that permission. | [x] | integration |

### Database (one central function)
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| D1 | `workspace_member_access (tenant, user, area, level)` with FORCE RLS; the application role can read, never write. | [x] | integration |
| D2 | ONE function `access_role(tenant, user, area, role, read)` turns a stored role plus grants into the role that module checks already understand (`admin` for manage, `viewer` for view, `guest` for none). Legacy roles pass through unchanged. SECURITY DEFINER, fixed `search_path`, `REVOKE FROM PUBLIC`, tenant-bound. | [x] | integration |
| D3 | Every module helper and every policy that tested `role_id` calls it (ads, discover, office, social inbox and approvals, link in bio, docs, catalog, newsletter, community live/stats/chat, Connect, CRM forms and sources, follow-up cases). The migration rewrites them and a source guard keeps new inline `role_id` checks out. | [x] | integration + `tests/unit/access-guard.test.ts` |
| D4 | `view` also opens SELECT on admin tools (permissive SELECT clones of `FOR ALL` policies); sensitive tables (restricted responses, follow-up cases, docs, chat) are not opened by `view`. | [x] | integration |
| D5 | Only an owner can grant, change or remove `admin`/`owner`; an admin cannot touch an admin or owner. Enforced by trigger for the application role. The first owner of a new account is allowed. | [x] | integration |
| D6 | Nobody grants more than they hold: only owner/admin can grant, and they hold every area. A collaborator cannot change anyone's access. | [x] | integration |
| D7 | The last owner cannot be demoted or deleted (trigger, plus the existing server check). | [x] | integration |
| D8 | Grant changes only through one SECURITY DEFINER function that writes the role, the grants and the audit row in one transaction. | [x] | integration |
| D9 | The upgrade changes no existing behaviour: the full integration suite (147 files) and unit suite pass. Seven tests that simulate foreign definer owners needed `GRANT EXECUTE ON access_role` to their test role, and hc14 compares the policy text without the access_role wrapper. | [x] | whole integration project |
| D10 | Migration applies twice cleanly, also under a non-superuser migration owner; second `drizzle-kit generate` reports no schema changes. | [x] | owner test + generate |

### Invitations (accepted by the invitee)
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| I1 | `workspace_invitations` carries the intended role and area set, an e-mail, the hash of a one-time token, expiry (14 days), status. | [x] | integration |
| I2 | Creating needs owner/admin; granting `admin` needs owner. The inviter's right is re-checked at acceptance (a demoted inviter's invitations lapse). | [x] | integration |
| I3 | Accepting needs the signed-in account whose e-mail the invitation names; the token alone is not enough; a second accept, an expired or withdrawn invitation, or another account fails. | [x] | integration |
| I4 | Nothing is added before acceptance. Acceptance creates the membership and grants and audits it. An existing member invited again gets a role/area change only after accepting. | [x] | integration |
| I5 | Delivery is a constant off switch; no message is sent. Outside production a test sink holds the link. | [x] | unit |
| I6 | `PUT /members` changes existing members through the audited function. A new person can still be direct-added as member/viewer (admin by an owner only) for existing callers; `collaborator` and `guest` exist only through an invitation the invitee accepts. | [x] | integration |

### Audit
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Every grant change writes an audit row (`member.access_change`, `member.role_change`, `invitation.create`, `invitation.accept`, `invitation.revoke`) with ids and area names only. | [x] | integration |

### Navigation
| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| N1 | Navigation hides every entry the viewer has no access to (collaborator with Social only sees Social; guest sees nothing). | [x] | unit (`access.test.ts`); browser spec `feature-access-nav.spec.ts` written, NOT run (no browser build in the authoring session; CI runs it) |

## 3. Residual risk and what is not built

- No screens for choosing areas or accepting an invitation (the page at `/workspace-invitations/<token>` is a follow-up; the API exists).
- `view` on areas whose modules have no read-only capability yet (website, office mail and calendar, settings) grants no routes today; stored and enforced where a read capability exists.
- Policies added by other open PRs after this migration keep inline `role_id` checks until they call `access_role`; the source guard fails the build for any new one.
- Guests: only Docs shares reach a guest today. Campaign-scoped guest screens are PR #251's CW-07 follow-up.

## 4. Open questions for the founder (recorded, not guessed)

1. Should an area `manage` include the privacy-sensitive actions (erase a contact, attest consent, sensitive export columns, webhooks)? Built as NO (owner/admin only).
2. Should `view` mean read-only everywhere an area has data? Built as the original viewer rule: it opens the read capabilities of CRM, campaigns, the communities list and docs. Social, newsletter, connect, catalog, website and settings have no read-only tier in the code yet, so `view` there grants nothing until each module defines one.
3. Should a collaborator with `manage` on Settings be able to change time zone, audience and appearance? Built as YES; they still cannot manage people.
4. May an admin invite or change other admins? Built as NO (owner only), per "only the owner can grant admin".
5. Are `guest` and `campaign_guest` one role? Built as two ids with identical rules so PR #251 merges without a conflict; merge them later if wanted.
6. Should Giving (donations and finances) have any grantable capability now? There is no Giving module code yet; the area is stored and reserved.
8. Should the old direct add of member/viewer/admin (about 40 browser specs depend on it) be removed so EVERY new person accepts an invitation? Built as: kept for the three legacy roles; collaborator and guest are invitation-only.
7. Does a guest need a ministry-visible name and list, or only the item? Built as the account name only.

## 5. Evidence

Unit (1656 + new), integration all shards green (a Postgres file-handle flake in community-live and hc06b-owner passed on rerun), eslint and source guards clean, `drizzle-kit generate` twice: "No schema changes". Migration 0111 `when` 1795604558739, applied under a restricted (non-superuser) owner in `feature-access.test.ts`.
