# Communities PR 3 — C05 public pages + Discover, C06 joining, C08 invitations (design)

Status: design approved by the founder on 11 Nov 2026. Implementation plan: `docs/superpowers/plans/2026-11-11-communities-pr3-public-join-invites.md`.

Inputs: `docs/prd/harvest-communities.md` (§3, §5.2, §8.1, §8.3, §8.9, §8A), ADR 0013 (§2, §4, §4a, §6, §7, §11), C04 editor (#58).

## Founder decisions (11 Nov)

1. **Discover eligibility:** a community appears in Discover when it is published, Listed, the owner switched "Show in Discover" on, and its ministry has a Harvest subscription. There is no pre-approval step. A platform-admin tool to remove any listing and email the reason comes later.
   - Subscription billing does not exist yet, so eligibility goes through one function, `discoverEligible(tenantId)`. It returns `true` until SaaS billing exists; billing replaces its body.
2. **Invitations:** personal links. The owner enters an email and Harvest creates a one-time, expiring link that the owner copies and sends themselves. Only an account with that email can redeem it. Harvest-sent invitation email (Resend) comes later with notifications (C15).
3. **Joining:** the owner may add community rules (optional). A joiner accepts the current rules, if any, and confirms they are 18 or older (PRD launch policy).
   - The optional join form is delivered with applications (C07, PR 4), reusing the existing form engine (`forms`/`form_versions`). Owners will choose "answer and join" or "answer and wait for approval".

## Scope

In:
- `/communities/:slug` public page;
- open join with rules and 18+ confirmation;
- `/communities/:slug/home`, a minimal member welcome page;
- invitation create/copy/revoke/redeem;
- `discover_listings` projection;
- `/discover`, with a working Communities tab and "Coming soon" Courses/Products tabs;
- `/account/communities`, showing Joined, Invited and Hosted;
- editor additions (description, rules, Show in Discover, Invite).

Out:
- applications and join forms (C07);
- the `CommunityShell` (C09) and the feed (C10);
- Harvest-sent email (C15);
- the platform-admin removal tool;
- paid joining (C17);
- slug renaming and redirects;
- sitemap;
- Discover categories, collections and saved items.

## Data (migration 0036, `0036_community_joining`)

```
communities  (+ columns)
  description        text null, check length 1..2000
  rules              text null, check length 1..5000
  rules_version      integer not null default 0   -- +1 whenever rules change (service)
  discover_opt_in    boolean not null default false

community_memberships  (+ columns)
  rules_version_accepted  integer null
  adult_confirmed_at      timestamptz null

community_invites
  id            uuid pk default gen_random_uuid()
  tenant_id     uuid not null, (tenant_id, community_id) -> communities on delete cascade
  community_id  uuid not null
  email_hash    text not null        -- sha256 of lower(trim(email)), never the email itself
  email_hint    text not null        -- masked form for the owner's list, e.g. j•••@example.test
  token_hash    text not null unique -- sha256 of the 32-byte secret; the secret is shown once
  created_by    text null references users(id) on delete set null
  expires_at    timestamptz not null -- now() + 14 days
  redeemed_at   timestamptz null, redeemed_by text null references users(id) on delete set null
  revoked_at    timestamptz null
  created_at    timestamptz not null default now()
  unique (community_id, email_hash) where redeemed_at is null and revoked_at is null

discover_listings
  resource_type  text not null check in ('community')   -- courses/products later
  resource_id    uuid not null, primary key (resource_type, resource_id)
  tenant_id      uuid not null references workspaces(id) on delete cascade
  slug, name, tagline, host_name, pricing, admission (open|apply|invite|entitlement list as text[])
  search_text    text not null      -- lower(name || ' ' || tagline || ' ' || host_name)
  updated_at     timestamptz not null default now()
```

**Projection rule:** a row exists exactly when the community is published, `visibility = 'listed'`, `discover_opt_in`, and `discoverEligible(tenant)`. Services upsert or delete the row in the same transaction as create/update/publish/unpublish. A unit-tested `listingFor(community, hostName)` returns the row or `null`.

**RLS:**
- **Tenant tables:** FORCE RLS with `_staff` tenant policies (as in 0035) on `community_invites` and `discover_listings`.
- **Direct access:** no member or anonymous policies. Grants are SELECT, INSERT, UPDATE and DELETE (DELETE only on `discover_listings`).

**Definer functions** (`SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`, fully qualified names, `EXECUTE` granted to the app role only):

| Function | Runs as | Returns / does |
|---|---|---|
| `community_public(slug, invite_token_hash)` | anyone | Public fields (id, slug, name, tagline, description, host name, pricing, admission flags, rules text + version, visibility) when **published** and (`listed` or `unlisted`, or `hidden` with a valid, unexpired, unrevoked, unredeemed invite for that community). Otherwise nothing. |
| `discover_communities(q, open_only, cursor, limit)` | anyone | Rows from `discover_listings` only (sanitized by construction), ordered by `updated_at desc, resource_id`, at most 24 per page. |
| `community_join(slug, user_id, rules_version, adult)` | `withUser` caller | Requires: published, `allow_open`, `adult = true`, `rules_version` equals current, caller not banned. Upserts the membership (active, role member, never restores staff), inserts a `community_free_join` entitlement, and writes the audit log. Idempotent for an already-active member. |
| `community_invite_redeem(token_hash or invite_id, user_id, email_hash, rules_version, adult)` | `withUser` caller | Identifies the invite by token hash (link) or by id (from `/account/communities`; the email match is the proof). Requires a matching unexpired, unrevoked, unredeemed invite whose `email_hash` matches the caller's verified email, plus `adult` and the current rules version, and the caller not banned. Marks the invite redeemed, activates membership as member, inserts an `invitation` entitlement, and audits. Works for hidden communities and when `allow_open` is false. |
| `my_communities(user_id)` / `my_invites(email_hash)` | `withUser` caller | Joined (active memberships with name, slug, role) and pending invites (community name, slug, expiry) for the caller only. |

**Errors:** the functions raise distinct SQLSTATEs, which services map to existing `AccessError` statuses:
- `404`: not found or not visible. The same response covers a wrong, expired or revoked invite, so no oracle.
- `409`: rules changed, already redeemed, or join not allowed.
- `403`: banned.

## Server (`src/server/communities.ts` + new `src/server/community-joining.ts`)

**Owner (staff path, `communities:manage`):**
- `updateCommunity` now also accepts `description`, `rules` and `discoverOptIn`. When `rules` changes it bumps `rules_version`, and it re-syncs the listing.
- `createInvite(community, email)` returns `{ url, expiresAt }`; the URL holds the raw token, shown once.
- `listInvites` returns masked email (first letter plus domain, e.g. `j•••@example.test`), status and expiry. The full email is shown only at creation.
- `revokeInvite`.

**Member and public:**
- `getPublicCommunity(slug, inviteToken?)`;
- `joinCommunity(user, slug, { rulesVersion, adult })`;
- `redeemInvite(user, slug, { token, rulesVersion, adult })`;
- `listDiscover(query)`;
- `myCommunities(user)` for Joined, Invited and Hosted. Hosted means communities of ministries where the user is owner or admin, via `withTenant` per ministry from the existing workspace list.

**Rate limits and gating:**
- Join and redeem use the existing auth-level limiter's pattern plus the per-ministry draft limit noted in ADR §4a. The draft limit is 50 communities per ministry, enforced in `createCommunity`.
- The Communities flag gates every new route and page (404 when off).

## Pages

| Route | Who | Content |
|---|---|---|
| `/communities/[slug]` | public | Join card (C04 `CommunityJoinCard`), description, ministry name, rules (collapsible). CTA: "Join" (signed in → join dialog; signed out → sign-in, returning here). With `?invite=` the CTA is "Accept invitation". `robots: noindex` unless listed. Not visible → standard not-found page. |
| Join dialog | signed in | Rules text (if any), checkbox "I accept the community rules" (if any), checkbox "I confirm I am 18 or older", Join button. 409 "rules changed" reloads the rules. |
| `/communities/[slug]/home` | active member | Name, welcome, rules link, "Feed coming soon" empty state. Not a member → redirect to the landing. |
| `/discover` | public | Tabs: Communities (works), Courses, Products ("Coming soon"). Search box and an "Open to join" filter, URL-synced. Card grid with name, tagline, host, Free badge and View button; empty state; Load more. |
| `/account/communities` | signed in | Three sections: Joined (open home), Invited (accept directly: same join dialog, redeemed by invite id plus the account's verified email), Hosted (open editor). Each has an empty state. |
| Editor, Basics | owner/admin | + Description. |
| Editor, Joining | owner/admin | + Rules (optional textarea), + "Show in Discover" switch (enabled only when Listed). |
| Editor, People | owner/admin | "Invite" button → dialog (email) → copyable link + expiry; pending invites table (masked email, expiry, Revoke). |

**Navigation:** "Discover" and "My communities" links appear in the personal account frame (HC-08 welcome and profile pages) behind the flag.

**Design and copy:** Eden design, Studio Admin style, shared shadcn components, `messages/en.json` only. The usual rules hold:
- no helper paragraphs, except the 18+ and rules statements;
- full width;
- 44px tap targets;
- light and dark themes;
- provider-neutral copy.

## Error handling

- **Not visible or unknown slug:** Next `notFound()`. A slug with an invalid shape is never queried.
- **Join/redeem 409, rules changed:** the dialog shows the new rules and asks again.
- **Join/redeem 409, other:** "You can't join this community right now."
- **403 banned:** the same neutral text, so the page reveals nothing about the ban.
- **Invite 404 (wrong email, expired, revoked):** "This invitation isn't valid for your account." The same text for every case.

## Testing

**Integration (two ministries, two communities each):**
- hidden, draft and unlisted communities are absent from `discover_communities`;
- `community_public` returns nothing for draft, archived and hidden-without-invite, and returns the community for hidden-with-invite;
- the projection follows publish, unpublish, opt-out, visibility change and eligibility;
- join is refused for: not open, stale rules, adult false, banned;
- join is idempotent and never restores staff;
- invite redemption is refused for: wrong email, expired, revoked, reused, banned, another community's slug;
- the token and email are never stored raw;
- ministry B's staff cannot see or revoke A's invites;
- RLS denies direct table access to members;
- `my_communities` returns only the caller's rows.

**Unit:**
- `listingFor`;
- email hashing and masking;
- the slug guard;
- flag-off routes return 404.

**Browser:**
- owner adds rules, lists and publishes the community;
- a second account finds it in Discover, joins (rules + 18+) and lands on home;
- owner invites a third account to a hidden community, which redeems the link;
- a wrong account gets the invalid message;
- revoke;
- `/account/communities` sections;
- axe, no horizontal scroll, and screenshots at 390/768/1440 in light and dark.

## Not changed

- Production stays off (`HARVEST_COMMUNITIES`).
- No outbound email.
- No payments.
- HC-02 activation gates are untouched.
