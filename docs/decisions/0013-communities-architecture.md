# ADR 0013 — Communities architecture (C01)

- **Status:** Accepted by the founder, 11 Nov 2026. C02 and C03 are implemented in #57, C04 in #58, C05, C06 and C08 in #59 (migration 0036), C07 in #60 (migration 0037), C09 and C10 in #62 (migration 0038), C12a in #63 (migration 0039) and C12b in its own PR stacked on it (migration 0040); see `docs/acceptance/communities-c05-c06-c08.md`, `docs/acceptance/communities-c07.md`, `docs/acceptance/communities-c09-c10.md` and `docs/acceptance/communities-c12a.md` and `docs/acceptance/communities-c12b.md`.
- **Scope:** Architecture, ownership boundaries and slice order for Harvest Communities. Documentation only: no code, migration, route or feature is added by this ADR.
- **Inputs:** `docs/prd/harvest-communities.md` (PRD v1.1), `CLAUDE.md` founder decisions of 11 Nov (Discover + creators at launch; `/communities/:slug`; design of Eden, style of Studio Admin), ADR 0003 (RLS tenancy), ADR 0011 (Harvest Connect), `docs/plans/studio-admin-adoption.md`.

## Context

The PRD specifies a community product combining Skool-style discovery, feed and classroom with Eden-style channels, members, products and a single editor. The repository today has CRM, campaigns, forms, Harvest Connect, personal accounts (`users`, `user_profiles`) and ministries (`workspaces`, `workspace_members`, four roles). It has **no** courses, products, events, entitlements or communities tables. Row-level security (RLS) isolates every tenant table by `app.tenant_id`; personal tables are isolated by `app.user_id`.

Community members are, by design, **not** members of the owning ministry. The existing tenant RLS pattern therefore cannot express "a member of community X may read its posts".

## Decisions

### 1. Ownership and identity

- A community belongs to exactly one ministry (`tenant_id`, FK to `workspaces`). Its creator is recorded; the ministry's owners/admins manage it according to ministry roles plus community roles (§5).
- Members are Harvest accounts (`users`). Joining a community never creates a `workspace_members` row and never grants ministry permissions.
- One account can belong to many communities across many ministries.

### 2. Routes and shells

- **Public and member pages:** `/communities/:slug` (landing), with member areas beneath it (for example `/communities/:slug/feed`, `/chat`, `/members`, `/about`, `/apply`, `/join`). `/c/` remains the Harvest Connect QR landing.
- **Slugs are globally unique** across Harvest, because the public URL carries no ministry segment. Reserved slugs (route names such as `new`, `discover`, `me`) are refused. A renamed community keeps a redirect from its previous slug.
- **Owner/admin pages:** `/workspaces/[tenantId]/communities/...`, registered in the typed navigation registry (`src/lib/navigation.ts`) and rendered in the existing AppShell.
- **Member experience:** a separate `CommunityShell`. Its *design* follows the Eden reference (icon rail for Chat, Forum, Events, Products, Members, Messages; a channel/category column; content; an admin side panel for moderators). Its *style* is Studio Admin through the shared shadcn components and theme tokens. No Eden visuals, branding, imagery or copy.
- **Personal hub:** `/account/communities` (joined, pending, invited, hosted), following the personal-account routes and frame introduced with HC-08 (the PRD's illustrative `/me/communities` maps here).

### 3. Three independent access settings

Stored separately; never collapsed into a single "type":

| Setting | Values (first release) | Later |
|---|---|---|
| Visibility | `listed`, `unlisted`, `hidden` | — |
| Admission | `open`, `apply`, `invite`, `entitlement` (a community may allow several paths) | — |
| Pricing | `free` | `paid` values exist in the schema but are refused by the server until the Commerce gate (C17) |

Changing visibility away from `listed` removes the Discover listing and invalidates cached public pages in the same transaction that changes the setting (or through an idempotent job enqueued in that transaction).

### 4. Access enforcement: database RLS with two paths (approach A)

Every community content table carries `tenant_id` and `community_id` and is protected by FORCE RLS with two policy paths:

1. **Staff path:** `tenant_id = app.tenant_id` plus the caller's ministry role (via `withTenant`), for owners/admins managing the community.
2. **Member path:** the caller (`app.user_id`) has an **active** row in `community_memberships` for that `community_id`, and, where content is tier- or channel-gated, a valid grant (§6). Reads run in `withUser`; writes additionally check the community capability (§5).

Anonymous visitors never query community tables directly. Public landing metadata and Discover results come from sanitized, published-only resolvers (`SECURITY DEFINER`, fixed `search_path`, returning only approved public fields), following the pattern used by the HC-04 published landing resolver. Hidden communities reveal nothing beyond what an invitation shows.

Tests must include two-ministry, two-community adversarial fixtures: a member of community A cannot read community B; a ministry viewer who is not a community member cannot read member-only content unless their role grants staff access; banned, pending and rejected users read nothing gated.

### 4a. Implementation rules from the C02/C03 review

- **Content tables must be grant-aware.** The `communities_member` policy only needs an active membership, which is enough for the community row itself. Every member-readable *content* table (posts, channels, files) must use a shared predicate that also requires a valid grant from the community's own ministry (or a staff community role), implemented as a fixed-`search_path` SQL function used by each policy, not copied by hand.
- **Grants are ministry-bound in the database.** An `entitlements_guard` trigger refuses a community grant whose community does not belong to the same ministry, and makes revocation final. `communityAccess` also filters grants by the community's ministry.
- **Staff RLS is ministry-wide by design.** Any role of the owning ministry passes the staff policy; finer limits (viewers cannot edit) are enforced by `can()` in the services. Ministry viewers can therefore list draft and hidden communities of their own ministry. This is intended: they are ministry staff, not community members.
- **Member-initiated writes** (joining, posting, reporting) need audited paths that members cannot reach directly (`audit_logs`, `jobs` and `outbox_events` are tenant-only). They go through narrow `SECURITY DEFINER` functions introduced with C06, never through member write policies on the base tables.
- **No contact details through community paths.** `users` has no RLS; member-facing lists must never join it beyond a display name, and staff lists show name, role and status only.
- **Global slugs reveal that an address is taken.** This is accepted: public addresses are public. Hidden or draft communities still occupy their slug. PR 3 adds a per-ministry limit of 50 communities. Request rate limits for the public pages, Discover and joining are **deferred**: no reusable request limiter exists outside sign-in, and building one is separate work to schedule before activation.
- **Reactivation never restores a staff role.** Re-granting access to a former admin or moderator makes them a member; staff roles are granted explicitly.

### 5. Community roles and capabilities

- Community roles: `owner`, `admin`, `moderator`, `contributor` (teacher/pastor), `member`, plus `applicant`/`guest` states. Billing manager is a separate delegated capability, not a role.
- Capabilities are resolved server-side as named permissions (for example `community:post`, `community:moderate`, `community:manage_members`, `community:manage_settings`, `community:finance`), mirroring `src/lib/permissions.ts`. Role names are never checked directly in UI or SQL beyond the capability resolver.
- Ministry owners/admins hold community `owner`/`admin` capabilities for communities their ministry owns. Moderators get no finance, private-message or pastoral access by default.

### 6. Entitlements (shared, built in C03)

- One canonical `entitlements` table records access grants with a **source** (`community_free_join`, `admin_grant`, `invitation`, later `product_purchase`, `bundle`, `subscription`), subject account, resource (community now; course/product later), optional tier, validity window, grantor and revocation.
- Effective access is the **union of valid grants**; ending one grant never revokes access held through another.
- Communities are the first consumer. Courses and Products (built later as their own canonical modules) reuse this table rather than creating their own.
- Paid sources stay unreachable until the Commerce gate; a successful payment webhook, never a client return URL, will create paid grants.

### 7. Discover projection

- A `discover_listings` table is a **read projection**, not a second owner of data: resource type, resource id, `tenant_id`, sanitized public metadata, owner opt-in, platform approval state, locale, category, search text, version.
- A listing is visible only when the resource is published **and** `listed` **and** the owner opted in **and** the owning ministry has an active Harvest subscription (founder decision, 11 Nov: no pre-approval; a platform-admin tool to remove a listing and email the reason comes later). Subscription billing does not exist yet, so `discoverEligible()` treats every ministry as eligible until it does. Default for new resources: not listed.
- PR 3 maintains the projection in the same transaction as create/update/publish/unpublish (`syncListing`), which is simpler and immediately consistent. Jobs can replace this when other resource types or external indexes join.
- The first release lists **communities only**. The table and API shape (`resource_type`) are ready for courses and products, which join when those modules exist. Eden's social-content Discover feed is not a model for this.

### 8. Creators

- Add a fourth workspace audience value, `creator` (label "Creator"), alongside `church`, `ministry_nonprofit` and `evangelist_missionary`. One small migration extends the `workspace_audience` check; the shared `audiences` tuple, `AudienceField`, navigation registry and tests are updated together. User-facing wording stays "ministry" for every type. Delivered in C02.

### 9. Courses, Products and Events dependencies

Founder decision (11 Nov): **Communities first, links later.** The first release ships the free-community core. Courses, Products and Events are built afterwards as their own canonical modules (launch system #5 and the events service). Only then are C13 (course links), C14 (events), C16 (product shelf) and the Discover courses/products tabs added. No placeholder shelves, fake products or community-specific catalogs.

### 10. Reuse and naming

- Reuse existing tables and services instead of duplicating: `users`, `user_profiles`, `workspaces`, `audit_logs`, `outbox_events`, `jobs`, `files` (covers, icons, attachments), `forms`/`form_versions` (application forms), `privacy_notice_versions` where a notice applies, and CRM `contacts`/`contact_consents` only through explicit, consented association (never automatic).
- New tables use the `community_` prefix (for example `communities`, `community_memberships`, `community_role_grants`, `community_access_policies`, `community_applications`, `community_invites`, `community_channels`, `community_posts`, `community_comments`, `community_reactions`, `community_reports`, `community_moderation_actions`, `community_member_profiles`, `community_rules_acceptances`), plus shared `entitlements` and `discover_listings`. Final names are fixed in each slice's migration and must not collide with existing tables.
- Harvest Connect slices HC-09 to HC-12 are delivered through Communities slices (C05, C06, C13, C20), not separately.

### 11. Activation

Communities ship behind a server-side flag that is **off in production** until the founder activates it, following the Harvest Connect pattern (`src/server/connect-intake-mode.ts`). No invitation emails, public listings or charges are sent or made while the flag is off. Merging a slice is not activation.

### 12. Design system

Per `CLAUDE.md`: Eden reference screens (`bumbmatei-sys/Harvest-agent`, `docs/prd/screenshots/05-communities/`) define layout and flow; Studio Admin defines visual style. The community editor follows the existing editor pattern (step list on the left, settings in the centre, live preview on the right, always-available Save draft and Publish, a publish checklist), built as the shared `EditorShell` rather than a community-only component.

## Slice order (first release, free communities)

| Slice | Delivers | Depends on | Migration |
|---|---|---|---|
| C02 | `communities` and core tables, global slug, access settings, `creator` audience, two-ministry RLS tests | C01 | Yes |
| C03 | Community roles/capabilities, shared `entitlements`, lifecycle states | C02 | Yes |
| C04 | Shared `EditorShell` + community editor (Basics, Joining, Channels, People, Page, Publish) | C02, C03 | Possibly |
| C05 | Public landing `/communities/:slug`, visibility rules, Discover projection (communities) | C02–C04 | Yes |
| C06 | Open join, rules acceptance, member home, `/account/communities` | C03, C05 | Possibly |
| C07 | Applications and review queue | C06, forms | Yes |
| C08 | Invitations and complimentary grants | C03, C06 | Yes |
| C09 | `CommunityShell`, profiles, preferences | C06 | Possibly |
| C10 | Feed: posts, comments, reactions, categories | C09 | Yes |
| C12 | Moderation: reports, held content, mute/ban, admin panel | C10 | Yes |
| C15 | Member notifications and onboarding | C06, C10 | Possibly |

C13, C14 and C16 follow the Courses, Products and Events modules. C11 (realtime chat), C17–C18 (paid), C19–C22 and C23–C24 follow the first release, as in the PRD.

## Consequences

- Member access is enforced in the database for every content table, at the cost of more complex policies and mandatory adversarial tests per slice.
- The `entitlements` and `discover_listings` tables become shared infrastructure; changes to them need the same review bar as tenancy changes.
- The first release is deliberately narrower than the full PRD (no course/product/event links) until the canonical modules exist.
- Migrations follow the journal on main; C02/C03 use 0035, so the next candidate is 0036.

## Open items (not blocking C02)

Retention periods for applicants, departed members and moderation evidence; plan limits per Harvest subscription tier; one-time/lifetime membership policy on community closure; chat architecture (C11). These are tracked in the PRD's open decisions and must be settled before the slices that need them.
